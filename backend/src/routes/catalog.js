import { Router } from 'express';
import os from 'node:os';
import QRCode from 'qrcode';
import { pool } from '../db.js';
import { listProducts, getProductDetail } from '../services/products.js';

const router = Router();

/**
 * Host público que se codifica en el QR de las etiquetas.
 * Prioridad:
 *   1) ?host= (override por petición, p. ej. para pruebas)
 *   2) PUBLIC_BASE_URL (env — dominio permanente para etiquetas impresas:
 *      túnel de Cloudflare, dominio desplegado…)
 *   3) IP de red local (demo en la misma WiFi; cambia con DHCP)
 *   4) localhost (fallback)
 */
function publicBaseUrl(req) {
  const nets = os.networkInterfaces();
  let lanIp = null;
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) { lanIp = n.address; break; }
    }
    if (lanIp) break;
  }
  const port = process.env.PORT || '3000';
  return req.query.host
    ? String(req.query.host)
    : (process.env.PUBLIC_BASE_URL || (lanIp ? `http://${lanIp}:${port}` : `http://localhost:${port}`));
}

const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * GET /api/products/:sku/qr
 * Genera el QR de etiqueta/cuidado del producto (PNG). Al escanearlo abre la
 * página guía con el uso, cuidado y combinaciones de la prenda.
 * Usa la IP de red local para que el QR funcione desde el celular (misma WiFi).
 */
router.get('/products/:sku/qr', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT sku, name FROM products WHERE sku = $1', [req.params.sku]);
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    const base = publicBaseUrl(req);
    const url = `${base}/guia-de-producto?sku=${encodeURIComponent(rows[0].sku)}`;
    const png = await QRCode.toBuffer(url, { width: 512, margin: 2, errorCorrectionLevel: 'M' });
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `inline; filename="qr-${rows[0].sku}.png"`);
    res.set('X-QR-Url', url);
    res.send(png);
  } catch (err) {
    console.error('[catalog/qr]', err);
    res.status(500).json({ error: 'Error generando el QR' });
  }
});

/**
 * GET /api/products/:sku/label
 * Hoja A4 imprimible con las etiquetas de la prenda: QR + nombre + SKU + talla,
 * lista para recortar y coser/pegar en la ropa. El QR se incrusta como data URI
 * para que la etiqueta se imprima sin depender de la red.
 * Params: ?size=M&copies=6  |  ?sizes=S,M,L  |  ?host= (override de host)
 */
router.get('/products/:sku/label', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT sku, name, price, gender, category, details FROM products WHERE sku = $1',
      [req.params.sku],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    const p = rows[0];

    const base = publicBaseUrl(req);
    const url = `${base}/guia-de-producto?sku=${encodeURIComponent(p.sku)}`;
    const qr = await QRCode.toDataURL(url, { width: 512, margin: 1, errorCorrectionLevel: 'M' });

    const sizes = String(req.query.sizes || req.query.size || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const copies = Math.min(Math.max(parseInt(req.query.copies, 10) || 1, 1), 24);
    const details = p.details || {};
    const care = Array.isArray(details.care) ? details.care.join(' · ') : '';

    const label = (size, i) => `
    <figure class="label">
      <div class="brand"><span class="vm">VM</span><span>VivaModa</span></div>
      <div class="body">
        <div class="info">
          <p class="name">${escHtml(p.name)}</p>
          <p class="meta">SKU ${escHtml(p.sku)}${size ? ` · Talla <b>${escHtml(size)}</b>` : ''}</p>
          ${care ? `<p class="care">${escHtml(care)}</p>` : ''}
        </div>
        <div class="qrbox">
          <img src="${qr}" alt="QR ${escHtml(p.sku)}"/>
          <p class="scan">Escanea para ver<br/><b>uso · cuidado · combinación</b></p>
        </div>
      </div>
      <figcaption class="url">${escHtml(url.replace(/^https?:\/\//, ''))}</figcaption>
    </figure>`;

    const labels = Array.from({ length: copies }, (_, i) =>
      label(sizes.length ? sizes[i % sizes.length] : '', i)).join('\n');

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-QR-Url', url);
    res.send(`<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Etiquetas · ${escHtml(p.name)} · VivaModa</title>
<style>
  :root { --vm: #b60055; --vm-soft: #fcf8fb; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: #eae7ea; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; color: #1c1b1d; }
  .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; max-width: 190mm; margin: 0 auto; }
  .label { margin: 0; background: #fff; border: 1px dashed #c9c4c8; border-radius: 6px; padding: 5mm 4mm; display: flex; flex-direction: column; gap: 3mm; }
  .brand { display: flex; align-items: center; gap: 2mm; font-weight: 800; font-size: 11pt; color: var(--vm); }
  .brand .vm { background: var(--vm); color: #fff; border-radius: 3px; padding: 1px 4px; font-size: 8pt; letter-spacing: .5px; }
  .body { display: flex; align-items: center; gap: 3mm; }
  .info { flex: 1; min-width: 0; }
  .name { margin: 0; font-size: 10.5pt; font-weight: 700; line-height: 1.2; }
  .meta { margin: 1mm 0 0; font-size: 8pt; color: #5c585c; }
  .care { margin: 1.5mm 0 0; font-size: 7pt; color: #6d696d; line-height: 1.25; }
  .qrbox { text-align: center; }
  .qrbox img { width: 26mm; height: 26mm; display: block; }
  .scan { margin: 1mm 0 0; font-size: 6.5pt; color: #6d696d; line-height: 1.2; }
  .url { margin: 0; font-size: 6.5pt; color: #9a969a; word-break: break-all; }
  .toolbar { max-width: 190mm; margin: 0 auto 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .toolbar button { background: var(--vm); color: #fff; border: 0; border-radius: 999px; padding: 10px 18px; font-weight: 700; cursor: pointer; }
  .toolbar span { font-size: 12px; color: #5c585c; }
  @page { size: A4 portrait; margin: 10mm; }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none; }
    .sheet { max-width: none; gap: 6mm; }
    .label { break-inside: avoid; }
  }
</style></head>
<body>
<div class="toolbar">
  <button onclick="window.print()">🖨️ Imprimir etiquetas</button>
  <span>${copies} etiqueta(s)${sizes.length ? ` · tallas: ${escHtml(sizes.join(', '))}` : ''} · recorta por la línea punteada y fíjala en la prenda.</span>
</div>
<div class="sheet">${labels}</div>
</body></html>`);
  } catch (err) {
    console.error('[catalog/label]', err);
    res.status(500).json({ error: 'Error generando las etiquetas' });
  }
});

/** GET /api/products?gender=&category=&q=&minPrice=&maxPrice=&sizes=&sort=&novedades=&ofertas=&storeId=&limit= */
router.get('/products', async (req, res) => {
  try {
    const sizes = typeof req.query.sizes === 'string' && req.query.sizes ? req.query.sizes.split(',') : undefined;
    const items = await listProducts({
      gender: req.query.gender,
      category: req.query.category,
      q: req.query.q,
      minPrice: req.query.minPrice,
      maxPrice: req.query.maxPrice,
      sizes,
      badge: req.query.badge,
      sort: req.query.sort,
      novedades: req.query.novedades,
      ofertas: req.query.ofertas,
      storeId: req.query.storeId || req.user?.storeId || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ items, count: items.length });
  } catch (err) {
    console.error('[catalog/products]', err);
    res.status(500).json({ error: 'Error consultando el catálogo' });
  }
});

/** GET /api/products/:id | :sku  (detalle completo) */
router.get('/products/:id', async (req, res) => {
  try {
    const product = await getProductDetail(req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ product });
  } catch (err) {
    console.error('[catalog/product]', err);
    res.status(500).json({ error: 'Error consultando el producto' });
  }
});

/** GET /api/categories  → estructura de navegación/filtros */
router.get('/categories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT gender, category, COUNT(*)::int AS total
       FROM products WHERE is_active = TRUE
       GROUP BY gender, category ORDER BY gender, total DESC`,
    );
    const nav = [
      { gender: 'damas', label: 'Damas' },
      { gender: 'caballeros', label: 'Caballeros' },
      { gender: 'ninos', label: 'Niños' },
    ].map((g) => ({
      gender: g.gender,
      label: g.label,
      categories: rows.filter((r) => r.gender === g.gender).map((r) => ({ name: r.category, total: r.total })),
      total: rows.filter((r) => r.gender === g.gender).reduce((s, r) => s + r.total, 0),
    }));
    res.json({ nav });
  } catch (err) {
    console.error('[catalog/categories]', err);
    res.status(500).json({ error: 'Error consultando categorías' });
  }
});

/** GET /api/stores  → sucursales disponibles (selector POS/admin/registro) */
router.get('/stores', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, code, name, city, channel FROM stores ORDER BY id');
    res.json({ stores: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error consultando tiendas' });
  }
});

export default router;
