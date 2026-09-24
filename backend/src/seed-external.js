// =====================================================================
// Carga masiva de catálogo desde DummyJSON (https://dummyjson.com/products)
// y FakeStore API (https://fakestoreapi.com).
// - Fuentes gratuitas, sin API key: prendas y accesorios con imágenes reales.
// - Importa a products / product_images / product_variants / inventory,
//   respetando el esquema y las convenciones de SKU de VivaModa.
// - MONEDA: toda la tienda opera en USD. Los productos externos se guardan
//   en dólares directos; los productos demo heredados en COP se migran
//   automáticamente a USD (ver services/currency.js) al ejecutar este script.
//
// Uso:
//   npm run seed:external              → 60 productos (12 por categoría, defecto)
//   npm run seed:external -- --limit 30
//   npm run seed:external -- --all     → importa TODO lo disponible por categoría
//   npm run seed:external -- --dry-run       → muestra el plan sin escribir en la base
//   npm run seed:external -- --no-translate  → conserva nombres/descripciones en inglés
//
// Es idempotente: re-ejecutar no duplica productos (sku ON CONFLICT, imágenes
// y variantes se limpian antes de reinsertar). Los nombres y descripciones se
// traducen al español (LLM con OPENROUTER_API_KEY, o diccionario local sin red;
// usa --no-translate para mantener el inglés original).
// =====================================================================
import { pool, tx, waitForDb } from './db.js';
import { translateProducts, translatorAvailable } from './services/translator.js';
import { copToUsd, retailRound } from './services/currency.js';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------
// Mapeo DummyJSON → VivaModa
// ---------------------------------------------------------------
const CATEGORY_MAP = {
  'womens-dresses':    { gender: 'damas',      category: 'Vestidos',     prefix: 'VM-DAM' },
  'womens-shoes':      { gender: 'damas',      category: 'Calzado',      prefix: 'VM-CAL' },
  'womens-bags':       { gender: 'damas',      category: 'Accesorios',   prefix: 'VM-ACC' },
  'womens-jewellery':  { gender: 'damas',      category: 'Accesorios',   prefix: 'VM-ACC' },
  'womens-watches':    { gender: 'damas',      category: 'Accesorios',   prefix: 'VM-ACC' },
  'mens-shirts':       { gender: 'caballeros', category: 'Camisería',    prefix: 'VM-CAB' },
  'mens-shoes':        { gender: 'caballeros', category: 'Calzado',      prefix: 'VM-CAL' },
  'mens-watches':      { gender: 'caballeros', category: 'Accesorios',   prefix: 'VM-ACC' },
  tops:                { gender: 'damas',      category: 'Blusas y Tops', prefix: 'VM-DAM' },
  sunglasses:          { gender: 'unisex',     category: 'Accesorios',   prefix: 'VM-ACC' },
  'sports-accessories':{ gender: 'unisex',     category: 'Accesorios',   prefix: 'VM-ACC' },
};

const BADGE_POOL = [null, null, null, 'Nuevo', 'Trending', 'Top Ventas', 'Flash'];
const SKIP_TRANSLATION = process.argv.includes('--no-translate');
const DOWNLOAD_IMAGES = process.argv.includes('--download-images');
const SIZES = {
  ropa: ['XS', 'S', 'M', 'L', 'XL'],
  calzado: ['36', '37', '38', '39', '40', '41'],
  accesorio: ['U'],
};

// Doña María → dona-maria
function slugify(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------
// Rescate de red: en algunos equipos el resolver del sistema no entrega
// registros A (solo IPv6 de Cloudflare, sin ruta). Ante un fallo de fetch
// se recurre a curl + DNS-over-HTTPS (1.1.1.1) para el JSON de la API y
// para descargar imágenes a local (--download-images).
// ---------------------------------------------------------------
const execFile = promisify(execFileCb);
const dohCache = new Map();

function dohIps(host) {
  if (!dohCache.has(host)) {
    try {
      const out = execFileSync('curl', ['-s', '-m', '8', '-H', 'accept: application/dns-json', `https://1.1.1.1/dns-query?name=${host}&type=A`], { encoding: 'utf8' });
      dohCache.set(host, (JSON.parse(out).Answer || []).filter((a) => a.type === 1).map((a) => a.data));
    } catch { dohCache.set(host, []); }
  }
  return dohCache.get(host);
}

function curlArgs(url, dest) {
  const host = new URL(url).host;
  const ip = dohIps(host)[0];
  const args = ['-s', '-L', '-m', '30', '--fail'];
  if (ip) args.push('--resolve', `${host}:443:${ip}`);
  args.push('-o', dest, url);
  return args;
}

async function curlText(url) {
  const dest = path.join(os.tmpdir(), `vm-seed-${process.pid}-${Math.random().toString(36).slice(2)}`);
  execFileSync('curl', curlArgs(url, dest), { stdio: 'ignore' });
  try { return fs.readFileSync(dest, 'utf8'); } finally { fs.unlinkSync(dest); }
}

async function fetchCategory(cat, limit, all) {
  const url = all
    ? `https://dummyjson.com/products/category/${cat}`
    : `https://dummyjson.com/products/category/${cat}?limit=${limit}`;
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`DummyJSON responded ${res.status} for ${cat}`);
    data = await res.json();
  } catch {
    // Resolver del sistema sin registros A → curl + DoH (ver cabecera)
    data = JSON.parse(await curlText(url));
  }
  return data.products || [];
}

// ---------------------------------------------------------------
// Segunda fuente: FakeStore API (https://fakestoreapi.com)
// ~14 prendas reales extra (men's/women's clothing + jewelery).
// ---------------------------------------------------------------
const FAKESTORE_MAP = {
  "men's clothing":   { gender: 'caballeros', category: 'Casual',    prefix: 'VM-CAB' },
  "women's clothing": { gender: 'damas',      category: 'Casual',    prefix: 'VM-DAM' },
  jewelery:           { gender: 'damas',      category: 'Accesorios', prefix: 'VM-ACC' },
};

async function fetchFakeStore() {
  const res = await fetch('https://fakestoreapi.com/products');
  if (!res.ok) throw new Error(`FakeStore responded ${res.status}`);
  const items = await res.json();
  return items.filter((it) => FAKESTORE_MAP[it.category]);
}

function mapFakeStoreProduct(item) {
  const { gender, category, prefix } = FAKESTORE_MAP[item.category] || {};
  if (!gender) return null;
  const kind = category === 'Accesorios' ? 'accesorio' : 'ropa';
  return {
    sku: `${prefix}-FS${item.id}`,
    name: String(item.title || '').replace(/\s+/g, ' ').trim(),
    gender,
    category,
    badge: rand(BADGE_POOL),
    price: retailRound(Number(item.price) || 20),
    compareAt: null,
    rating: Math.round((item.rating?.rate ?? 4.2) * 10) / 10,
    reviewCount: item.rating?.count ?? 0,
    image: item.image || null,
    gallery: item.image ? [item.image] : [],
    description: (item.description || '').trim() || null,
    isNew: Math.random() < 0.25,
    sizes: SIZES[kind],
  };
}

// ---------------------------------------------------------------
// Tercera fuente: dataset público de Shein (Bright Data, CC0 en GitHub)
// CSV con 1000 productos reales; se filtran las categorías de moda.
// CDN de imágenes img.ltwebstatic.com accesible sin API key.
// ---------------------------------------------------------------
const SHEIN_CSV_URL = 'https://raw.githubusercontent.com/luminati-io/Shein-dataset-samples/main/shein-products.csv';

// Reglas de mapeo (root, category) → { gender, category VM, kind }.
// El género se refina con el nombre de la categoría (Women/Men/Kids).
const SHEIN_RULES = [
  { root: 'Bags & Luggage', cat: /women/i, vm: 'Bolsos', kind: 'accesorio' },
  { root: 'Bags & Luggage', cat: /men/i, vm: 'Bolsos', kind: 'accesorio' },
  { root: 'Jewelry & Watches', cat: /watch/i, vm: 'Relojes', kind: 'accesorio' },
  { root: 'Jewelry & Watches', cat: /./, vm: 'Joyería', kind: 'accesorio' },
  { root: 'Apparel Accessories', cat: /(cap|hat|beanie|bucket)/i, vm: 'Accesorios', kind: 'accesorio' },
  { root: 'Apparel Accessories', cat: /(glasses|eyewear|sunglasses)/i, vm: 'Accesorios', kind: 'accesorio' },
  { root: 'Apparel Accessories', cat: /(hair|headband|scarf|belt|handwear|keychain|keyring|veil|glove)/i, vm: 'Accesorios', kind: 'accesorio' },
  { root: 'Women Apparel', cat: /jeans/i, vm: 'Pantalones', kind: 'ropa' },
  { root: 'Women Apparel', cat: /coat/i, vm: 'Abrigos', kind: 'ropa' },
  { root: 'Women Apparel', cat: /cardigan/i, vm: 'Blusas', kind: 'ropa' },
  { root: 'Women Apparel', cat: /(bikini|cover)/i, vm: 'Traje de Baño', kind: 'ropa' },
  { root: 'Underwear & Sleepwear', cat: /men/i, vm: 'Ropa Interior', kind: 'ropa' },
  { root: 'Underwear & Sleepwear', cat: /./, vm: 'Ropa Interior', kind: 'ropa' },
  { root: 'Men', cat: /shirt/i, vm: 'Camisas', kind: 'ropa' },
  { root: 'Men', cat: /./, vm: 'Deportivo', kind: 'ropa' },
  { root: 'Shoes', cat: /./, vm: 'Calzado', kind: 'calzado' },
  { root: 'Sports & Outdoor', cat: /(shoes|sandals|slides|boots)/i, vm: 'Calzado', kind: 'calzado' },
  { root: 'Sports & Outdoor', cat: /(polo|sweatshirt|uniform)/i, vm: 'Deportivo', kind: 'ropa' },
  { root: 'Kids', cat: /watch/i, vm: 'Relojes', kind: 'accesorio' },
  { root: 'Kids', cat: /bag/i, vm: 'Bolsos', kind: 'accesorio' },
  { root: 'Kids', cat: /./, vm: 'Accesorios', kind: 'accesorio' },
];

function sheinGender(root, cat) {
  if (/kids|girls|boys|baby/i.test(cat) || root === 'Kids' || root === 'Baby') return 'ninos';
  if (/\bmen\b|men's|male/i.test(cat)) return 'caballeros';
  if (/women|ladies|girl/i.test(cat) || root === 'Women Apparel') return 'damas';
  return 'damas'; // accesorios de moda: catálogo femenino por defecto
}

const SHEIN_GENDER_PREFIX = { damas: 'VM-DAM', caballeros: 'VM-CAB', ninos: 'VM-NIN', unisex: 'VM-UNI' };

/** CSV RFC-ish: campos con comillas, comillas escapadas y saltos de línea embebidos. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; if (row.some((v) => v !== '')) rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  return rows;
}

function cleanSheinDescription(desc) {
  const cleaned = String(desc || '')
    .replace(/Free Returns.*?Shipping.*?\./gi, '')
    .replace(/[\u2713\u2714\u2717]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 25 ? cleaned : null;
}

async function fetchSheinFashion() {
  const csvText = await curlText(SHEIN_CSV_URL);
  const rows = parseCsv(csvText);
  const header = rows.shift();
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const out = [];
  for (const r of rows) {
    const root = r[idx.root_category] || '';
    const cat = r[idx.category] || '';
    const rule = SHEIN_RULES.find((x) => x.root === root && x.cat.test(cat));
    if (!rule) continue;
    if (String(r[idx.in_stock]).toLowerCase() !== 'true') continue;
    out.push({ row: r, idx, rule });
  }
  return out;
}

function mapSheinProduct({ row: r, idx, rule }) {
  const name = String(r[idx.product_name] || '').split(',')[0].trim();
  if (!name) return null;
  const gender = sheinGender(rule.root, rule.cat.source + ' ' + r[idx.category]);
  const { vm: category, kind } = rule;
  const finalPrice = Number(r[idx.final_price]) || 0;
  const initialPrice = Number(r[idx.initial_price]) || 0;
  if (finalPrice <= 0 || finalPrice > 900) return null;
  const images = [];
  try {
    const urls = JSON.parse(r[idx.image_urls] || '[]');
    if (Array.isArray(urls)) images.push(...urls);
  } catch { /* sin galería */ }
  if (r[idx.main_image] && !images.includes(r[idx.main_image])) images.unshift(r[idx.main_image]);
  const uniqImages = images.filter(Boolean).filter((u, i, a) => a.indexOf(u) === i).slice(0, 4);
  if (!uniqImages.length) return null;

  const rating = Number(r[idx.rating]) || 0;
  const reviews = Number(r[idx.reviews_count]) || 0;
  const available = (() => {
    try { return JSON.parse(r[idx.all_available_sizes] || '[]').map(String); } catch { return []; }
  })();
  const pool_ = SIZES[kind];
  const sizes = kind === 'accesorio' ? ['U'] : available.length
    ? pool_.filter((s) => available.some((a) => a.toUpperCase() === s.toUpperCase()))
    : [];

  let color = 'Único';
  try {
    const c = String(r[idx.color] || '').split(',')[0].trim();
    if (c) color = c.charAt(0).toUpperCase() + c.slice(1);
  } catch { /* color por defecto */ }

  return {
    sku: `${SHEIN_GENDER_PREFIX[gender]}-SH${r[idx.product_id]}`,
    name,
    gender,
    category,
    badge: rand(BADGE_POOL),
    price: retailRound(finalPrice),
    compareAt: initialPrice > finalPrice ? retailRound(initialPrice) : null,
    rating: rating > 0 ? Math.round(rating * 10) / 10 : Math.round((3.8 + Math.random()) * 10) / 10,
    reviewCount: reviews > 0 ? reviews : Math.floor(Math.random() * 160) + 5,
    image: uniqImages[0],
    gallery: uniqImages,
    description: cleanSheinDescription(r[idx.description]),
    isNew: Math.random() < 0.25,
    sizes: sizes.length ? sizes : SIZES[kind],
    color,
    source: 'shein',
  };
}

// ---------------------------------------------------------------
// Descarga de imágenes a public/img/ext (los clientes sin salida directa
// al CDN de Shein sirven las copias locales del propio backend)
// ---------------------------------------------------------------
const EXT_IMG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img', 'ext');

function looksLikeImage(buf) {
  if (!buf || buf.length < 5024) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50) return true; // PNG
  if (buf.slice(0, 4).toString() === 'RIFF') return true; // WEBP
  return false;
}

async function downloadImages(products, { perProduct = 2, concurrency = 10 } = {}) {
  fs.mkdirSync(EXT_IMG_DIR, { recursive: true });
  const jobs = [];
  for (const p of products) {
    p.gallery = (p.gallery || []).slice(0, perProduct);
    p.gallery.forEach((url, i) => {
      const ext = (url.match(/\.(png|jpe?g|webp)(?:\?|$)/i) || [, 'jpg'])[1].replace('jpeg', 'jpg');
      const file = path.join(EXT_IMG_DIR, `${p.sku}-${i}.${ext}`);
      jobs.push({ p, i, url, file });
    });
  }
  console.log(`[seed-external] descargando ${jobs.length} imágenes a public/img/ext…`);
  let done = 0;
  let ok = 0;
  const queue = [...jobs];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const j = queue.shift();
      if (!j) break;
      try {
        execFileSync('curl', curlArgs(j.url, j.file), { stdio: 'ignore', timeout: 45_000 });
        if (!looksLikeImage(fs.readFileSync(j.file))) throw new Error('no es imagen');
        ok++;
      } catch {
        try { fs.unlinkSync(j.file); } catch { /* no existía */ }
      }
      done++;
      if (done % 50 === 0) console.log(`[seed-external] imágenes ${done}/${jobs.length}`);
    }
  }));
  // Solo referenciamos las que bajaron bien; el resto conserva la URL remota
  for (const p of products) {
    const local = (p.gallery || []).map((url, i) => {
      const hit = jobs.find((j) => j.p === p && j.i === i && fs.existsSync(j.file));
      return hit ? `/img/ext/${path.basename(hit.file)}` : url;
    });
    p.gallery = local.filter(Boolean);
    p.image = p.gallery[0] || p.image;
  }
  console.log(`[seed-external] imágenes listas (${ok}/${jobs.length} descargadas)`);
}

// ---------------------------------------------------------------
// DummyJSON row → fila estilo insertProduct de seed.js
// ---------------------------------------------------------------
function mapProduct(item, cat) {
  const { gender, category, prefix } = CATEGORY_MAP[cat];
  const images = [item.thumbnail, ...(item.images || [])]
    .filter(Boolean).filter((u, i, a) => a.indexOf(u) === i);
  const compareAt = item.discountPercentage > 0
    ? Math.round((item.price / (1 - item.discountPercentage / 100)) * 100) / 100
    : null;
  const kind = category === 'Calzado' ? 'calzado' : category === 'Accesorios' ? 'accesorio' : 'ropa';

  return {
    sku: `${prefix}-EXT${item.id}`,
    name: item.title,
    gender,
    category,
    badge: rand(BADGE_POOL),
    // Los productos externos ya vienen en USD: se guardan tal cual con redondeo retail
    price: retailRound(item.price),
    compareAt: compareAt ? retailRound(compareAt) : null,
    rating: Math.round((item.rating ?? 4.5) * 10) / 10,
    reviewCount: Math.floor(Math.random() * 180) + 12,
    image: images[0] || null,
    gallery: images.slice(0, 4),
    description: (item.description || '').trim() || null,
    isNew: Math.random() < 0.25,
    sizes: SIZES[kind],
  };
}

// ---------------------------------------------------------------
// Inserción (espejo de insertProduct de seed.js)
// ---------------------------------------------------------------
async function insertProduct(client, p, storesById) {
  const color = p.color || 'Único';
  const price = Number(p.price);
  const cost = Math.round(price * 0.45 * 100) / 100;
  // El ID externo garantiza unicidad aunque dos productos traduzcan al mismo nombre
  const extId = p.sku.split('-EXT')[1] || p.sku.toLowerCase();
  const slug = `${slugify(p.name)}-${extId}`;

  const details = {
    composition: [{ name: 'Fibra principal', pct: '95%', note: 'Tejido premium con caída estructurada.' }, { name: 'Elastano', pct: '5%', note: 'Comodidad y ajuste.' }],
    care: ['Lavar a máquina en frío', 'No usar blanqueador', 'Planchar a temperatura baja', 'Secar en sombra'],
    logistics: 'Envío express gratis en compras mayores a $49.99 · Devoluciones sin costo durante 30 días.',
    fitNote: 'Calce estándar de la marca. Revisa la guía de tallas para más detalle.',
    modelInfo: null,
    companionSkus: null,
    source: p.source || 'dummyjson',
    currency: 'USD',
  };

  const { rows } = await client.query(
    `INSERT INTO products (sku,name,slug,gender,category,badge,description,details,price,compare_at,cost,rating,review_count,image_url,is_new,is_featured,is_active,visibility)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE,'store')
     ON CONFLICT (sku) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price,
       compare_at = EXCLUDED.compare_at, rating = EXCLUDED.rating,
       review_count = EXCLUDED.review_count, image_url = EXCLUDED.image_url,
       is_new = EXCLUDED.is_new,
       details = jsonb_set(coalesce(products.details,'{}'::jsonb), '{currency}', '"USD"'::jsonb, true)
     RETURNING id, (xmax = 0) AS inserted`,
    [p.sku, p.name, slug, p.gender, p.category, p.badge, p.description, JSON.stringify(details), price, p.compareAt, cost, p.rating, p.reviewCount, p.image, p.isNew, false],
  );
  const productId = rows[0].id;
  if (!rows[0].inserted) return { productId, created: false };

  const images = p.gallery && p.gallery.length ? p.gallery : p.image ? [p.image] : [];
  for (let i = 0; i < images.length; i++) {
    await client.query('INSERT INTO product_images (product_id,url,position) VALUES ($1,$2,$3)', [productId, images[i], i]);
  }

  const variantIds = [];
  for (const size of p.sizes) {
    const v = await client.query(
      `INSERT INTO product_variants (product_id,size,color,sku) VALUES ($1,$2,$3,$4) RETURNING id`,
      [productId, size, color, `${p.sku}-${size}`],
    );
    variantIds.push({ size, id: v.rows[0].id });
  }

  for (const vi of variantIds) {
    const isMain = vi.size === p.sizes[0];
    const put = (storeCode, qty) =>
      client.query('INSERT INTO inventory (variant_id,store_id,qty,reorder_point) VALUES ($1,$2,$3,$4)', [vi.id, storesById[storeCode].id, qty, 10]);
    const central = isMain ? 18 : 9;
    await put('CENTRAL', central);
    await put('CENTRO', Math.max(central - 2, 1));
    await put('NORTE', isMain ? 6 : 3);
    await put('ONLINE', isMain ? 9 : 4);
  }
  return { productId, created: true };
}

// ---------------------------------------------------------------
// Orquestador
// ---------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const perCategory = limitIdx >= 0 ? Math.max(1, Number(args[limitIdx + 1]) || 12) : 12;

  const plan = [];
  for (const cat of Object.keys(CATEGORY_MAP)) {
    try {
      const items = await fetchCategory(cat, perCategory, all);
      for (const item of items) plan.push({ item, cat });
      console.log(`[seed-external] dummyjson ${cat}: ${items.length} productos obtenidos`);
    } catch (err) {
      console.warn(`[seed-external] ⚠ ${cat}: ${err.message} (continúa)`);
    }
    await sleep(150);
  }

  let fsMapped = [];
  try {
    fsMapped = (await fetchFakeStore()).map(mapFakeStoreProduct).filter(Boolean);
    console.log(`[seed-external] fakestore: ${fsMapped.length} productos obtenidos`);
  } catch (err) {
    console.warn(`[seed-external] ⚠ fakestore: ${err.message} (continúa)`);
  }

  let sheinMapped = [];
  try {
    const raw = await fetchSheinFashion();
    console.log(`[seed-external] shein: ${raw.length} productos de moda en el dataset`);
    sheinMapped = raw.map(mapSheinProduct).filter(Boolean);
    // Límite opcional --shein N (defecto: todo el dataset filtrado)
    const sheinIdx = args.indexOf('--shein');
    const sheinMax = sheinIdx >= 0 ? Math.max(1, Number(args[sheinIdx + 1]) || 0) : 0;
    // Mezcla determinista por categoría para variedad (no tomar solo las primeras filas)
    const byCat = new Map();
    for (const p of sheinMapped) {
      if (!byCat.has(p.category)) byCat.set(p.category, []);
      byCat.get(p.category).push(p);
    }
    let balanced = [];
    let added = true;
    while (added) {
      added = false;
      for (const list of byCat.values()) {
        if (list.length) { balanced.push(list.shift()); added = true; }
      }
    }
    sheinMapped = sheinMax > 0 ? balanced.slice(0, sheinMax) : balanced;
    console.log(`[seed-external] shein mapeados: ${sheinMapped.length}`);
  } catch (err) {
    console.warn(`[seed-external] ⚠ shein: ${err.message} (continúa)`);
  }

  const mapped = [...plan.map(({ item, cat }) => mapProduct(item, cat)), ...fsMapped, ...sheinMapped];
  // FakeStore trae títulos basura de marketplace → el fallback descarta palabras desconocidas
  mapped.forEach((p) => { if (p.sku.includes('-FS')) p.dropUnknown = true; });

  // Imágenes locales (curl + DoH): evita que el navegador dependa del CDN externo
  if (!dryRun && mapped.length) {
    try { await downloadImages(mapped, { perProduct: 2 }); } catch (err) {
      console.warn(`[seed-external] ⚠ descarga de imágenes falló (${err.message}); se conservan URLs remotas`);
    }
  }

  // Traducción al español (LLM si hay OPENROUTER_API_KEY, si no diccionario local)
  if (SKIP_TRANSLATION) {
    console.log('[seed-external] --no-translate: se conservan nombres y descripciones en inglés');
  } else {
    const mode = translatorAvailable() ? `LLM (${process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct'})` : 'diccionario local';
    console.log(`[seed-external] traducción al español: ${mode}`);
    const translated = await translateProducts(mapped.map((p) => ({ name: p.name, description: p.description, dropUnknown: p.dropUnknown })));
    translated.forEach((t, i) => {
      if (t.name) mapped[i].name = t.name;
      if (t.description) mapped[i].description = t.description;
    });
  }

  console.log(`[seed-external] total a importar: ${mapped.length} productos${dryRun ? ' (dry-run: no se escribe en la base)' : ''}`);

  if (dryRun) {
    for (const p of mapped.slice(0, 8)) {
      console.log(`   · ${p.sku}  ${p.name}  $${p.price.toFixed(2)}${p.compareAt ? ` (antes $${p.compareAt.toFixed(2)})` : ''}`);
    }
    if (mapped.length > 8) console.log(`   … y ${mapped.length - 8} más`);
    await pool.end();
    return;
  }

  console.log('[seed-external] conectando a la base…');
  try {
    await waitForDb();
  } catch {
    throw new Error('No se pudo conectar a PostgreSQL. ¿Levantaste Docker? Ejecuta: npm run db:up');
  }

  // ---------------------------------------------------------------
  // Migración de moneda: productos heredados en COP → USD (idempotente)
  // ---------------------------------------------------------------
  const { rows: copRows } = await pool.query(
    "SELECT id, price, compare_at, cost FROM products WHERE details->>'currency' IS DISTINCT FROM 'USD'",
  );
  if (copRows.length) {
    console.log(`[seed-external] migrando ${copRows.length} productos COP → USD (tasa demo 1 USD = 3900 COP)…`);
    await tx(async (client) => {
      for (const r of copRows) {
        await client.query(
          `UPDATE products
           SET price = $1, compare_at = $2, cost = $3,
               details = jsonb_set(coalesce(details,'{}'::jsonb), '{currency}', '"USD"'::jsonb, true)
           WHERE id = $4`,
          [copToUsd(r.price), r.compare_at ? copToUsd(r.compare_at) : null, r.cost ? copToUsd(r.cost) : null, r.id],
        );
      }
    });
    console.log(`[seed-external] migración de moneda lista (${copRows.length} productos)`);
  }

  // Pedidos demo en COP → USD (guardia: los totales USD reales quedan < 1000)
  const { rows: copOrders } = await pool.query('SELECT COUNT(*)::int AS c FROM orders WHERE total > 1000');
  if (copOrders[0].c > 0) {
    console.log(`[seed-external] migrando ${copOrders[0].c} pedidos COP → USD…`);
    await tx(async (client) => {
      const { rows: allOrders } = await client.query('SELECT id, discount FROM orders');
      for (const o of allOrders) {
        const { rows: items } = await client.query('SELECT id, unit_price, qty FROM order_items WHERE order_id = $1', [o.id]);
        let subtotal = 0;
        for (const it of items) {
          const up = copToUsd(it.unit_price);
          await client.query('UPDATE order_items SET unit_price = $1 WHERE id = $2', [up, it.id]);
          subtotal += up * it.qty;
        }
        if (!items.length) {
          const { rows: cur } = await client.query('SELECT subtotal FROM orders WHERE id = $1', [o.id]);
          subtotal = copToUsd(cur[0].subtotal);
        }
        subtotal = Math.round(subtotal * 100) / 100;
        const tax = Math.round(subtotal * 0.19 * 100) / 100;
        const discount = copToUsd(o.discount || 0);
        await client.query(
          'UPDATE orders SET subtotal=$1, tax=$2, discount=$3, total=$4 WHERE id=$5',
          [subtotal, tax, discount, Math.round((subtotal + tax - discount) * 100) / 100, o.id],
        );
      }
    });
    console.log('[seed-external] pedidos migrados a USD');
  }

  const { rows: storeRows } = await pool.query('SELECT id, code FROM stores ORDER BY id');
  if (!storeRows.length) {
    throw new Error('No hay tiendas en la base. Arranca la API una vez (npm start) para que seedIfEmpty() cree tiendas y usuarios, y vuelve a ejecutar este script.');
  }
  const storesById = Object.fromEntries(storeRows.map((s) => [s.code, s]));
  console.log(`[seed-external] tiendas: ${storeRows.map((s) => s.code).join(', ')}`);

  let created = 0;
  let updated = 0;
  await tx(async (client) => {
    for (const p of mapped) {
      const { created: c } = await insertProduct(client, p, storesById);
      if (c) created++; else updated++;
    }
  });

  const { rows: counts } = await pool.query('SELECT COUNT(*)::int AS c FROM products');
  console.log(`[seed-external] listo → +${created} nuevos · ${updated} actualizados · total en catálogo: ${counts[0].c} productos`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('[seed-external] error:', err.message);
  try { await pool.end(); } catch { /* noop */ }
  process.exit(1);
});
