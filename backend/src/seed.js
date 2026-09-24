// =====================================================================
// Semilla de datos demo.
// - Los productos de vitrina y el producto estrella se extraen del HTML
//   original de los mockups (frontends/tienda-catalogo y
//   frontends/detalle-producto-ia), de modo que la base siempre
//   refleja fielmente lo que muestran los diseños.
// - El resto (accesorios, calzado, ítems operativos, pedidos POS,
//   usuarios, tiendas, sesiones IA) se define aquí abajo.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { pool, tx } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function readPage(dir) {
  try {
    return fs.readFileSync(path.join(ROOT, dir, 'code.html'), 'utf8');
  } catch {
    return '';
  }
}

function parseMoney(str) {
  const m = String(str).match(/[\d.,]+/);
  if (!m) return null;
  return Number(m[0].replace(/\./g, '').replace(',', '.'));
}

function cleanText(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------
// 1) Productos de la vitrina (tarjetas del catálogo)
// ---------------------------------------------------------------
function scrapeStorefrontProducts() {
  const html = readPage('frontends/tienda-catalogo');
  const start = html.indexOf('id="catalogGrid"');
  if (start < 0) return [];
  const grid = html.slice(start);
  const cards = grid.match(/<article[\s\S]*?<\/article>/g) || [];
  const out = [];
  let n = 0;
  for (const card of cards) {
    const txt = cleanText(card).replace(/&amp;/g, '&');
    const img = (card.match(/https:\/\/lh3\.googleusercontent\.com\/[^"'\s\\]+/) || [null])[0];
    const prices = txt.match(/\$\s?([\d.,]+)/g) || [];
    const price = parseMoney(prices[0]);
    const compareAt = prices.length > 1 ? parseMoney(prices[1]) : null;
    const ratingMatch = txt.match(/star\s+([\d.,]+)\s*\((\d+)\)/);
    const rating = ratingMatch ? Number(ratingMatch[1].replace(',', '.')) : 4.9;
    const reviews = ratingMatch ? Number(ratingMatch[2]) : 0;
    // El nombre aparece después de "star x.x (n)" y antes del precio
    const afterStar = txt.slice((ratingMatch?.index ?? txt.indexOf('star')) + ratingMatch?.[0].length || 0);
    const nameMatch = afterStar.match(/([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ&.\- ]{4,60}?)(?=\s\$\d)/);
    const name = nameMatch ? nameMatch[1].trim() : '';
    const genderRaw = (txt.match(/(Damas|Caballeros|Niños|Niñas)/) || [null])[0];
    const gender = genderRaw
      ? (genderRaw === 'Niñas' || genderRaw === 'Niños' ? 'ninos' : genderRaw.toLowerCase())
      : 'unisex';
    const catRaw = (txt.match(/(?:Damas|Caballeros|Niños|Niñas)\s*[•·]\s*([A-Za-zÁÉÍÓÚÑáéíóúñ&.\- ]{2,40}?)(?=\s)/) || [null])[0];
    const badgeRaw = (txt.match(/^(Nuevo|Trending|Eco-Friendly|-?\d+%\s*Flash|Básico|Top Ventas|Últimas|Pack)/) || [null])[0];
    const prefix = { damas: 'VM-DAM', caballeros: 'VM-CAB', ninos: 'VM-NIN', unisex: 'VM-ACC' }[gender];
    n += 10;
    out.push({
      order: n,
      sku: `${prefix}-${8800 + n}`,
      name: name || `Prenda VivaModa ${n}`,
      gender,
      category: (catRaw ? catRaw.split(/[•·]/).pop()?.trim() : 'Colección') || 'Colección',
      badge: badgeRaw ? badgeRaw.replace('-', '') : null,
      price,
      compareAt,
      rating,
      reviewCount: reviews,
      image: img,
    });
  }
  return out;
}

// ---------------------------------------------------------------
// 2) Producto estrella: Vestido Asimétrico Magenta Atelier
// ---------------------------------------------------------------
function scrapeDetailProduct() {
  const html = readPage('frontends/detalle-producto-ia');
  if (!html) return null;
  const imgs = html.match(/https:\/\/lh3\.googleusercontent\.com\/[^"'\s\\]+/g) || [];
  // En el detalle: img 2-4 son las vistas del vestido (thumb-0..2)
  const gallery = imgs.slice(2, 5);
  return {
    order: 0,
    sku: 'VM-DAM-ATELIER',
    name: 'Vestido Asimétrico Magenta Atelier',
    gender: 'damas',
    category: 'Vestidos de Noche',
    badge: 'Edición Limitada',
    price: 189900,
    compareAt: 249900,
    rating: 4.9,
    reviewCount: 148,
    image: gallery[0] || imgs[2] || null,
    gallery,
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    colors: ['Magenta Eléctrico'],
    visibility: 'store',
    isFeatured: true,
    companionSkus: ['VM-CAL-8811', 'VM-ACC-8812', 'VM-DAM-8813'],
    description:
      'Inspirado en los pliegues cinéticos de la escultura posmoderna, este vestido de gala reinterpreta la asimetría con una precisión de patronaje impecable. Su escote inclinado descubre sutilmente la clavícula izquierda, mientras que el drapeado envolvente desciende hacia una elegante abertura lateral que otorga fluidez y dinamismo a cada paso.',
    composition: [
      { name: 'Crepe de Seda Mulberry', pct: '78%', note: 'Hilado en Como, Italia. Lustre satinado mate ultra suave y transpirable.' },
      { name: 'Poliamida Reciclada', pct: '18%', note: 'Fibra circular certificada GRS con memoria estructural.' },
      { name: 'Elastano Invisible', pct: '4%', note: 'Elasticidad bi-axial en cintura y cadera.' },
    ],
    modelInfo: { name: 'Elena Rossi', height: '1.78 m', size: 'S', bust: '86 cm', waist: '63 cm', hip: '91 cm' },
    care: ['Limpieza en seco profesional', 'Planchado a vapor a baja temperatura', 'No utilizar blanqueador', 'Guardar colgado en funda textil'],
    logistics: 'Entrega protegida con embalaje rígido Atelier. Cambio de talla o color con recogida en domicilio sin cargo durante los primeros 30 días naturales. Retiro express en tiendas VivaModa disponible en 2 horas.',
    fitNote: 'Corte columna con drapeado sesgado y abertura lateral de 42 cm. Cierre cremallera invisible lateral YKK.',
  };
}

// ---------------------------------------------------------------
// 3) Productos operativos (POS, almacén y looks complementarios)
// ---------------------------------------------------------------
const OPS_PRODUCTS = [
  { sku: 'VM-CAL-8811', name: 'Stiletto Vernice Noir 95mm', gender: 'damas', category: 'Calzado', price: 79900, sizes: ['36', '37', '38', '39'], color: 'Negro Laca', badge: 'Look IA', isFeatured: true },
  { sku: 'VM-ACC-8812', name: 'Clutch Geométrico Brass Doré', gender: 'damas', category: 'Accesorios', price: 49900, sizes: ['U'], color: 'Brass Doré', badge: 'Look IA', isFeatured: true },
  { sku: 'VM-DAM-8813', name: 'Blazer Cropped Smoking Noir', gender: 'damas', category: 'Sastrería', price: 129900, sizes: ['XS', 'S', 'M', 'L'], color: 'Negro', badge: 'Look IA', isFeatured: true },
  { sku: 'VM-DAM-001', name: 'Vestido Coctel Magenta', gender: 'damas', category: 'Vestidos', price: 189900, sizes: ['XS', 'S', 'M', 'L'], color: 'Magenta' },
  { sku: 'VM-CAB-002', name: 'Camisa Slim Cobalto', gender: 'caballeros', category: 'Camisas', price: 129000, sizes: ['S', 'M', 'L', 'XL'], color: 'Azul Cobalto' },
  { sku: 'VM-CAB-003', name: 'Pantalón Chino Beige', gender: 'caballeros', category: 'Pantalones', price: 145000, sizes: ['30', '32', '34', '36'], color: 'Beige' },
  { sku: 'VM-DAM-004', name: 'Blusa Seda Neón', gender: 'damas', category: 'Blusas', price: 115000, sizes: ['XS', 'S', 'M', 'L'], color: 'Fucsia Neón' },
  { sku: 'VM-NIN-005', name: 'Chaqueta Denim Kids', gender: 'ninos', category: 'Ropa Exterior', price: 95000, sizes: ['4A', '6A', '8A', '10A'], color: 'Denim' },
  { sku: 'VM-ACC-006', name: 'Cinturón Cuero Magenta', gender: 'unisex', category: 'Accesorios', price: 49000, sizes: ['U'], color: 'Magenta' },
  { sku: 'VM-ACC-007', name: 'Cinturón Cuero Fucsia Neón', gender: 'unisex', category: 'Accesorios', price: 39900, sizes: ['U'], color: 'Fucsia Neón' },
  { sku: 'VM-CAB-008', name: 'Chaqueta Bomber Satinada', gender: 'caballeros', category: 'Chaquetas', price: 199000, sizes: ['S', 'M', 'L'], color: 'Satinada' },
  { sku: 'VM-NIN-009', name: 'Conjunto Niña + Moño', gender: 'ninos', category: 'Vestidos', price: 159900, sizes: ['4A', '6A', '8A'], color: 'Rosa VivaModa' },
  { sku: 'VM-CAB-010', name: 'Camisa Slim Caballero Azul Cobalto', gender: 'caballeros', category: 'Camisas', price: 139000, sizes: ['L', 'XL'], color: 'Cobalto' },
  { sku: 'VM-CAB-011', name: 'Pantalón Chino Khaki', gender: 'caballeros', category: 'Pantalones', price: 149000, sizes: ['32', '34'], color: 'Khaki' },

  // Filas de ejemplo del panel de almacén (stock/reorden específicos)
  { sku: 'VM-DAM-8942', name: 'Vestido Satinado Drapeado', gender: 'damas', category: 'Vestidos', price: 8990, sizes: ['M'], color: 'Satinado', adminStock: { qty: 4, reorder: 15 } },
  { sku: 'VM-CAB-3109', name: 'Bomber Jacket Cobalt Neo', gender: 'caballeros', category: 'Chaquetas', price: 11500, sizes: ['L'], color: 'Cobalt Neo', adminStock: { qty: 142, reorder: 30 } },
  { sku: 'VM-NIN-7721', name: 'Conjunto Active Warm', gender: 'ninos', category: 'Conjuntos', price: 4450, sizes: ['8A'], color: 'Active Warm', adminStock: { qty: 68, reorder: 20 } },
  { sku: 'VM-CAL-9910', name: 'Sneakers Platform Cyber', gender: 'unisex', category: 'Calzado', price: 12900, sizes: ['39'], color: 'Cyber', adminStock: { qty: 0, reorder: 25 } },
  { sku: 'VM-ACC-1102', name: 'Crossbody Mini Quilted', gender: 'damas', category: 'Accesorios', price: 5500, sizes: ['U'], color: 'Quilted', adminStock: { qty: 32, reorder: 10 } },
].map((p) => ({
  ...p,
  visibility: 'ops',
  rating: 4.8,
  reviewCount: 20,
  badge: p.badge || 'Operativo',
}));

// ---------------------------------------------------------------
// 4) Tiendas y usuarios demo
// ---------------------------------------------------------------
const STORES = [
  { code: 'CENTRAL', name: 'Almacén Central (Bodega A-12)', city: 'Bogotá', channel: 'fisica' },
  { code: 'NORTE', name: 'Boutique Norte (Showroom)', city: 'Medellín', channel: 'fisica' },
  { code: 'ONLINE', name: 'Canal Online & Dark Store', city: 'Nacional', channel: 'online' },
  { code: 'CENTRO', name: 'Sucursal Centro', city: 'Bogotá', channel: 'fisica' },
];

async function seedUsers(client, storesById) {
  const hash = (pwd) => bcrypt.hashSync(pwd, 10);
  const users = [
    {
      email: 'elena.rossi@vivamoda.com', full_name: 'Elena R.', phone: '+57 300 111 2233',
      role: 'client', interests: ['damas', 'caballeros'], vip_tier: 'Gold', points: 320, avatar: 'female',
      password: 'Cliente123!',
    },
    {
      email: 'carlos.morales@vivamoda.com', full_name: 'Carlos M.', phone: '+57 300 444 5566',
      role: 'staff', employee_code: 'STF-84920', store_id: storesById.CENTRO.id, password: 'Staff123!',
    },
    {
      email: 'laura.gomez@vivamoda.com', full_name: 'Laura G.', phone: '+57 300 777 8899',
      role: 'staff', employee_code: 'STF-88312', store_id: storesById.CENTRO.id, password: 'Staff123!',
    },
    {
      email: 'admin@vivamoda.internal', full_name: 'Administrador VivaModa', phone: null,
      role: 'admin', password: 'Admin123!',
    },
  ];
  for (const u of users) {
    const { password, ...rest } = u;
    await client.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role, employee_code, store_id, interests, vip_tier, points)
       VALUES ($1,$2,$3,COALESCE($4,''),$5,$6,$7,COALESCE($8, ARRAY[]::text[]),COALESCE($9,'Classic'),COALESCE($10,0))`,
      [rest.email, hash(password), rest.full_name, rest.phone ?? null, rest.role, rest.employee_code || null, rest.store_id || null, rest.interests || [], rest.vip_tier || 'Classic', rest.points ?? 0],
    );
  }
}

// ---------------------------------------------------------------
// 5) Productos + variantes + inventario + imágenes
// ---------------------------------------------------------------
const DEFAULT_DETAILS = {
  composition: [
    { name: 'Fibra principal', pct: '95%', note: 'Tejido premium con caída estructurada.' },
    { name: 'Elastano', pct: '5%', note: 'Comodidad y ajuste.' },
  ],
  care: ['Lavar a máquina en frío', 'No usar blanqueador', 'Planchar a temperatura baja', 'Secar en sombra'],    logistics: 'Envío express gratis en compras mayores a $49.99 · Devoluciones sin costo durante 30 días.',
  fitNote: 'Calce estándar de la marca. Revisa la guía de tallas para más detalle.',
  modelInfo: null,
  companionSkus: null,
};

function sizesFor(p) {
  if (p.sizes && p.sizes.length) return p.sizes;
  if (p.gender === 'ninos') return ['4A', '6A', '8A', '10A'];
  if (p.category === 'Calzado') return ['36', '37', '38', '39', '40'];
  if (p.category === 'Accesorios') return ['U'];
  return ['XS', 'S', 'M', 'L', 'XL'];
}

async function insertProduct(client, p, storesById) {
  const color = p.color || 'Único';
  const price = Number(p.price);
  const cost = Math.round(price * 0.45 * 100) / 100;
  const slug = p.slug || p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const desc = p.description ||
    `${p.name}. Prenda de la colección ${p.category} ${p.gender === 'damas' ? 'Damas' : p.gender === 'caballeros' ? 'Caballeros' : p.gender === 'ninos' ? 'Niños' : 'VivaModa'} — confección contemporánea con tejidos premium y stock omnicanal sincronizado en tiempo real.`;

  const details = {
    ...DEFAULT_DETAILS,
    composition: p.composition || DEFAULT_DETAILS.composition,
    care: p.care || DEFAULT_DETAILS.care,
    logistics: p.logistics || DEFAULT_DETAILS.logistics,
    fitNote: p.fitNote || DEFAULT_DETAILS.fitNote,
    modelInfo: p.modelInfo || null,
    companionSkus: p.companionSkus || null,
  };

  const { rows } = await client.query(
    `INSERT INTO products (sku,name,slug,gender,category,badge,description,details,price,compare_at,cost,rating,review_count,image_url,is_new,is_featured,is_active,visibility)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE,$17) RETURNING id`,
    [p.sku, p.name, slug, p.gender, p.category, p.badge, desc, JSON.stringify(details), price, p.compareAt || null, cost, p.rating || 4.8, p.reviewCount || 0, p.image, Boolean(p.isNew), Boolean(p.isFeatured), p.visibility || 'store'],
  );
  const productId = rows[0].id;

  const images = p.gallery && p.gallery.length ? p.gallery : p.image ? [p.image] : [];
  for (let i = 0; i < images.length; i++) {
    await client.query('INSERT INTO product_images (product_id,url,position) VALUES ($1,$2,$3)', [productId, images[i], i]);
  }

  const sizes = sizesFor(p);
  const variantIds = [];
  for (const size of sizes) {
    const v = await client.query(
      `INSERT INTO product_variants (product_id,size,color,sku) VALUES ($1,$2,$3,$4)
       ON CONFLICT (product_id,size,color) DO UPDATE SET sku = EXCLUDED.sku RETURNING id`,
      [productId, size, color, `${p.sku}-${size}`],
    );
    variantIds.push({ size, id: v.rows[0].id });
  }

  for (const vi of variantIds) {
    const isMain = vi.size === sizes[0];
    const put = (storeCode, qty, reorder) =>
      client.query('INSERT INTO inventory (variant_id,store_id,qty,reorder_point) VALUES ($1,$2,$3,$4)', [vi.id, storesById[storeCode].id, qty, reorder]);

    if (p.adminStock) {
      const { qty, reorder } = p.adminStock;
      await put('CENTRAL', qty, reorder ?? 10);
      await put('CENTRO', Math.max(qty - 1, 0), reorder ?? 10);
      await put('NORTE', 0, 10);
      await put('ONLINE', 0, 10);
    } else {
      let central = isMain ? 18 : 9;
      let norte = isMain ? 6 : 3;
      let online = isMain ? 9 : 4;
      if (p.sku === 'VM-DAM-ATELIER') { central = 7; norte = 2; online = 5; }
      if (p.badge === 'Últimas Unidades') { central = 3; norte = 0; online = 1; }
      await put('CENTRAL', central, 10);
      await put('CENTRO', Math.max(central - 2, 1), 10);
      await put('NORTE', norte, 10);
      await put('ONLINE', online, 10);
    }
  }
  return productId;
}

// ---------------------------------------------------------------
// 6) Pedidos (POS + cliente)
// ---------------------------------------------------------------
async function seedOrders(client, storesById) {
  const getVariant = async (sku, size) => {
    const { rows } = await client.query(
      `SELECT pv.id AS variant_id, p.id AS product_id, p.name, p.sku, p.price
       FROM product_variants pv JOIN products p ON p.id = pv.product_id
       WHERE p.sku = $1 AND pv.size = $2 LIMIT 1`, [sku, size]);
    return rows[0];
  };

  const { rows: cashierRows } = await client.query(`SELECT id FROM users WHERE employee_code = 'STF-84920'`);
  const cashierId = cashierRows[0]?.id ?? null;
  const { rows: elenaRows } = await client.query(`SELECT id FROM users WHERE email = 'elena.rossi@vivamoda.com'`);
  const elenaId = elenaRows[0]?.id ?? null;

  const now = Date.now();
  const H = (h) => new Date(now - h * 3600_000);
  const M = (m) => new Date(now - m * 60_000);

  const make = async (o) => {
    const lines = [];
    for (const it of o.items) {
      const v = await getVariant(it.sku, it.size);
      if (v) lines.push({ ...v, qty: it.qty, size: it.size, color: it.color || null });
    }
    if (!lines.length) return;
    const subtotal = Math.round(lines.reduce((s, i) => s + Number(i.price) * i.qty, 0));
    const tax = Math.round(subtotal * 0.19);
    const storeId = storesById[o.storeCode]?.id ?? storesById.CENTRO.id;
    const { rows } = await client.query(
      `INSERT INTO orders (order_no,user_id,store_id,channel,status,customer_name,customer_phone,address,city,courier,tracking_no,payment_method,paid,subtotal,discount,tax,total,notes,created_at,cashier_id,ai_assisted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [o.orderNo, o.userId ?? null, storeId, o.channel, o.status, o.customer || 'Cliente VivaModa', o.phone || null, o.address || null, o.city || null, o.courier || null, o.tracking || null, o.paymentMethod || 'tarjeta', o.paid ?? true, subtotal, o.discount || 0, tax, subtotal + tax - (o.discount || 0), o.notes || null, o.createdAt ?? new Date(), o.cashierId ?? cashierId, Boolean(o.aiAssisted)],
    );
    const orderId = rows[0].id;
    for (const l of lines) {
      await client.query(
        `INSERT INTO order_items (order_id,product_id,variant_id,product_name,sku,size,color,unit_price,qty)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [orderId, l.product_id, l.variant_id, l.name, l.sku, l.size, l.color, l.price, l.qty],
      );
    }
  };

  // Despachos pendientes (Picking)
  await make({ orderNo: 'VM-9082', status: 'picking', storeCode: 'CENTRO', channel: 'web', customer: 'Mariana Restrepo', city: 'Medellín · El Poblado', address: 'Cra 33 # 7-45', paymentMethod: 'tarjeta', createdAt: M(25), items: [{ sku: 'VM-DAM-ATELIER', size: 'M', qty: 1 }, { sku: 'VM-ACC-007', size: 'U', qty: 1 }], notes: 'Express 2H', courier: 'Mensajero propio' });
  await make({ orderNo: 'VM-9085', status: 'picking', storeCode: 'CENTRO', channel: 'whatsapp', customer: 'Felipe Morales', city: 'Bogotá D.C. · Chapinero', paymentMethod: 'enlace', createdAt: M(48), items: [{ sku: 'VM-CAB-010', size: 'L', qty: 2 }, { sku: 'VM-CAB-011', size: '32', qty: 1 }] });
  await make({ orderNo: 'VM-9089', status: 'picking', storeCode: 'CENTRO', channel: 'retiro', customer: 'Camila Arango', city: 'Recoge en Caja 02', paymentMethod: 'qr', createdAt: M(70), items: [{ sku: 'VM-CAB-008', size: 'S', qty: 1 }], notes: 'Retiro en tienda' });
  await make({ orderNo: 'VM-9091', status: 'pendiente', storeCode: 'CENTRO', channel: 'app', customer: 'Sara Pérez', city: 'Bogotá · Usaquén', paymentMethod: 'tarjeta', createdAt: M(15), items: [{ sku: 'VM-DAM-001', size: 'S', qty: 1 }, { sku: 'VM-ACC-006', size: 'U', qty: 1 }], notes: 'Express 2H', courier: 'Mensajero propio' });
  await make({ orderNo: 'VM-9093', status: 'pendiente', storeCode: 'CENTRO', channel: 'shopify', customer: 'Andrés Quintero', city: 'Bogotá · Suba', paymentMethod: 'tarjeta', createdAt: M(30), items: [{ sku: 'VM-CAB-002', size: 'M', qty: 1 }] });

  // Empacado / Listo
  await make({ orderNo: 'VM-9076', aiAssisted: true, status: 'packed', storeCode: 'CENTRO', channel: 'web', customer: 'Sebastián Gil', city: 'Cali · Granada', paymentMethod: 'tarjeta', createdAt: H(5), items: [{ sku: 'VM-DAM-ATELIER', size: 'S', qty: 1 }, { sku: 'VM-ACC-8812', size: 'U', qty: 1 }], courier: 'EnviaYa', notes: 'Bolsa biodegradable #03 sellada' });
  await make({ orderNo: 'VM-9078', status: 'packed', storeCode: 'CENTRO', channel: 'web', customer: 'Valeria Henao', city: 'Barranquilla · Alto Prado', paymentMethod: 'tarjeta', createdAt: H(6), items: [{ sku: 'VM-NIN-009', size: '6A', qty: 1 }], courier: 'Coordinadora', notes: 'Caja regalo VivaModa Rosa' });

  // En tránsito
  await make({ orderNo: 'VM-9060', status: 'in_transit', storeCode: 'CENTRO', channel: 'web', customer: 'Lucas Botero', city: 'Ruta Urbana #12', paymentMethod: 'tarjeta', createdAt: H(3), items: [{ sku: 'VM-DAM-8813', size: 'S', qty: 1 }, { sku: 'VM-CAB-003', size: '32', qty: 1 }], courier: 'Mensajero: Jorge E. (en moto)', tracking: 'ETA 25 min' });
  await make({ orderNo: 'VM-9055', status: 'in_transit', storeCode: 'CENTRO', channel: 'web', customer: 'Elena Castro', city: 'Intermunicipal', paymentMethod: 'tarjeta', createdAt: H(8), items: [{ sku: 'VM-DAM-ATELIER', size: 'L', qty: 1 }, { sku: 'VM-CAL-8811', size: '37', qty: 1 }], courier: 'Coordinadora', tracking: 'SER-9938102', notes: 'Salida de hub' });

  // Entregados hoy
  const delivered = [
    { n: 'VM-9040', aiAssisted: true, customer: 'Daniela Gómez', city: 'Bogotá', when: 3, items: [{ sku: 'VM-DAM-004', size: 'S', qty: 1 }, { sku: 'VM-ACC-006', size: 'U', qty: 1 }], courier: 'EnviaYa', notes: 'Firma digital OK' },
    { n: 'VM-9037', customer: 'Carlos Duque', city: 'Bogotá · Pick-up Tienda', when: 4, items: [{ sku: 'VM-CAB-002', size: 'L', qty: 2 }], courier: 'Retiro tienda', notes: 'Entregado 13:48' },
    { n: 'VM-9035', customer: 'María José Londoño', city: 'Medellín', when: 5, items: [{ sku: 'VM-DAM-001', size: 'M', qty: 1 }], courier: 'EnviaYa', notes: 'Firma digital OK' },
    { n: 'VM-9030', customer: 'Julián Ramírez', city: 'Cali', when: 7, items: [{ sku: 'VM-NIN-005', size: '8A', qty: 1 }, { sku: 'VM-CAB-003', size: '34', qty: 1 }], courier: 'Coordinadora', notes: 'Firma digital OK' },
    { n: 'VM-9028', aiAssisted: true, customer: 'Paola Mejía', city: 'Bogotá', when: 6, items: [{ sku: 'VM-DAM-8813', size: 'M', qty: 1 }], courier: 'EnviaYa', notes: 'Firma digital OK' },
    { n: 'VM-9024', customer: 'Sofía Arenas', city: 'Barranquilla', when: 9, items: [{ sku: 'VM-ACC-8812', size: 'U', qty: 1 }, { sku: 'VM-CAL-8811', size: '38', qty: 1 }], courier: 'Coordinadora', notes: 'Firma digital OK' },
  ];
  for (const d of delivered) {
    await make({ orderNo: d.n, aiAssisted: d.aiAssisted, status: 'delivered', storeCode: 'CENTRO', channel: d.courier === 'Retiro tienda' ? 'retiro' : 'web', customer: d.customer, city: d.city, paymentMethod: 'tarjeta', createdAt: H(d.when), items: d.items, courier: d.courier, notes: d.notes });
  }

  // Pedidos web del cliente demo (Elena)
  await make({ orderNo: 'VM-9102', aiAssisted: true, userId: elenaId, status: 'picking', storeCode: 'ONLINE', channel: 'web', customer: 'Elena R.', city: 'Bogotá', paymentMethod: 'tarjeta', createdAt: M(90), items: [{ sku: 'VM-DAM-ATELIER', size: 'M', qty: 1 }, { sku: 'VM-ACC-8812', size: 'U', qty: 1 }], courier: 'EnviaYa', notes: 'Express 2H' });
  await make({ orderNo: 'VM-8990', userId: elenaId, status: 'delivered', storeCode: 'ONLINE', channel: 'web', customer: 'Elena R.', city: 'Bogotá', paymentMethod: 'tarjeta', createdAt: new Date(now - 20 * 24 * 3600_000), items: [{ sku: 'VM-CAB-002', size: 'S', qty: 1 }], courier: 'Coordinadora', notes: 'Firma digital OK' });
}

// ---------------------------------------------------------------
// 7) Carrito, wishlist y sesiones IA demo
// ---------------------------------------------------------------
async function seedClientData(client) {
  const { rows: elena } = await client.query(`SELECT id FROM users WHERE email = 'elena.rossi@vivamoda.com'`);
  if (!elena[0]) return;
  const elenaId = elena[0].id;
  const { rows: cartRows } = await client.query(
    `INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id`, [elenaId]);
  const cartId = cartRows[0]?.id;
  if (!cartId) throw new Error('No se pudo crear el carrito demo');
  const picks = [['VM-DAM-ATELIER', 'S', 1], ['VM-CAB-002', 'M', 1], ['VM-ACC-8812', 'U', 1]];
  for (const [sku, size, qty] of picks) {
    const v = await client.query(
      `SELECT pv.id, p.id AS pid FROM product_variants pv JOIN products p ON p.id = pv.product_id
       WHERE p.sku=$1 AND pv.size=$2 LIMIT 1`, [sku, size]);
    if (v.rows[0]) {
      await client.query('INSERT INTO cart_items (cart_id,product_id,variant_id,qty) VALUES ($1,$2,$3,$4)', [cartId, v.rows[0].pid, v.rows[0].id, qty]);
    }
  }
  const fav = await client.query(`SELECT id FROM products WHERE sku='VM-DAM-ATELIER'`);
  if (fav.rows[0]) {
    await client.query('INSERT INTO wishlists (user_id,product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [elenaId, fav.rows[0].id]);
  }

  const templates = {
    talla: { user: '¿Cuál es mi talla para 1.68m?', assistant: 'Según tu estatura (1.68 m) y un contorno de busto promedio, te recomiendo talla S en vestidos de gala. ¿Quieres calcularla con tus medidas exactas?' },
    evento: { user: 'Busco un outfit para cóctel de noche en terraza, algo sofisticado pero cómodo.', assistant: '¡Me encanta la idea! Para una terraza nocturna te sugiero el Vestido Satinado Fuchsia Night con calce fluido y accesorios dorados de alto impacto.' },
    envio: { user: '¿Cuánto tarda el envío?', assistant: 'El envío express llega en 24-48 h hábiles sin costo en compras superiores a $49.99. También puedes retirar en tienda en 2 horas.' },
  };
  const topics = ['talla', 'evento', 'envio', 'talla'];
  for (let i = 0; i < topics.length; i++) {
    const t = templates[topics[i]];
    const messages = [{ role: 'user', content: t.user }, { role: 'assistant', content: t.assistant }];
    await client.query(
      `INSERT INTO ai_sessions (user_id, session_key, product_sku, messages, rating, csat, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() - ($7 || ' hours')::interval, now())`,
      [elenaId, `demo-session-${i}`, i === 1 ? 'VM-DAM-ATELIER' : null, JSON.stringify(messages), 5, i < 3, 6 + i * 30],
    );
  }
}

// ---------------------------------------------------------------
// 8) Orquestador
// ---------------------------------------------------------------
export async function seedIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c > 0) return false;

  console.log('[seed] base vacía → insertando datos demo…');
  await tx(async (client) => {
    const storesById = {};
    for (const s of STORES) {
      const { rows } = await client.query('INSERT INTO stores (code,name,city,channel) VALUES ($1,$2,$3,$4) RETURNING id', [s.code, s.name, s.city, s.channel]);
      storesById[s.code] = { id: rows[0].id };
    }

    await seedUsers(client, storesById);

    const storefront = scrapeStorefrontProducts();
    const detail = scrapeDetailProduct();

    for (const p of storefront) {
      await insertProduct(client, p, storesById);
    }
    if (detail) {
      await insertProduct(client, detail, storesById);
    }
    for (const p of OPS_PRODUCTS) {
      await insertProduct(client, p, storesById);
    }

    await seedOrders(client, storesById);
    await seedClientData(client);

    const counts = await client.query('SELECT (SELECT COUNT(*) FROM products)::int AS p, (SELECT COUNT(*) FROM orders)::int AS o, (SELECT COUNT(*) FROM users)::int AS u, (SELECT COUNT(*) FROM inventory)::int AS i');
    console.log(`[seed] listo → ${counts.rows[0].p} productos · ${counts.rows[0].o} pedidos · ${counts.rows[0].u} usuarios · ${counts.rows[0].i} líneas de inventario`);
  });
  return true;
}
