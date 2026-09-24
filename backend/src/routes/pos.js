import { Router } from 'express';
import { pool, tx } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { toLight, getVariantsWithStock } from '../services/products.js';
import { orderToJson } from './orders.js';

const router = Router();
router.use(requireRole('staff', 'admin'));

const ORDER_STATUS_FLOW = ['pendiente', 'picking', 'packed', 'in_transit', 'delivered'];
const ALLOWED_TRANSITIONS = {
  pendiente: ['picking', 'cancelled'],
  picking: ['packed', 'cancelled'],
  packed: ['in_transit', 'delivered', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/** Tienda operativa del usuario (o la indicada por query si es admin) */
function scopeStore(req) {
  if (req.query.storeId) return Number(req.query.storeId);
  if (req.user.storeId) return req.user.storeId;
  return null; // admin sin tienda → todas
}

/** GET /api/pos/summary — contadores de la consola */
router.get('/summary', async (req, res) => {
  try {
    const storeId = scopeStore(req);
    const storeFilter = storeId ? 'AND store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const q = async (sql, extra) => (await pool.query(sql, params)).rows[0];
    const [pending, picking, packed, inTransit, deliveredToday, salesToday, openTurns] = await Promise.all([
      q(`SELECT COUNT(*)::int AS c FROM orders WHERE status IN ('pendiente') ${storeFilter}`),
      q(`SELECT COUNT(*)::int AS c FROM orders WHERE status = 'picking' ${storeFilter}`),
      q(`SELECT COUNT(*)::int AS c FROM orders WHERE status = 'packed' ${storeFilter}`),
      q(`SELECT COUNT(*)::int AS c FROM orders WHERE status = 'in_transit' ${storeFilter}`),
      q(`SELECT COUNT(*)::int AS c FROM orders WHERE status = 'delivered' AND created_at >= CURRENT_DATE ${storeFilter}`),
      q(`SELECT COALESCE(SUM(total),0)::float8 AS total FROM orders WHERE paid = TRUE AND created_at >= CURRENT_DATE ${storeFilter}`),
      q(`SELECT COUNT(*)::int AS c FROM orders WHERE status NOT IN ('delivered','cancelled') ${storeFilter}`),
    ]);
    res.json({
      storeId: storeId ?? null,
      pending: pending.c,
      picking: picking.c,
      packed: packed.c,
      inTransit: inTransit.c,
      deliveredToday: deliveredToday.c,
      openOrders: openTurns.c,
      salesToday: Number(salesToday.total),
    });
  } catch (err) {
    console.error('[pos/summary]', err);
    res.status(500).json({ error: 'Error con el resumen POS' });
  }
});

/**
 * GET /api/pos/products — búsqueda para el mostrador.
 * query: q, gender, category, storeId, includeOut
 */
router.get('/products', async (req, res) => {
  try {
    const storeId = scopeStore(req);
    const where = ['p.is_active = TRUE'];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    if (req.query.q) where.push(`(p.name ILIKE ${p(`%${req.query.q}%`)} OR p.sku ILIKE ${p(`%${req.query.q}%`)} OR p.category ILIKE ${p(`%${req.query.q}%`)})`);
    if (req.query.gender && req.query.gender !== 'todos') where.push(`p.gender = ${p(req.query.gender)}`);
    if (req.query.category && req.query.category !== 'todas') where.push(`p.category = ${p(req.query.category)}`);
    if (req.query.includeOut !== 'true') where.push(`EXISTS (SELECT 1 FROM product_variants vv JOIN inventory ii ON ii.variant_id = vv.id WHERE vv.product_id = p.id AND ii.qty > 0 ${storeId ? `AND ii.store_id = ${p(storeId)}` : ''})`);

    const { rows } = await pool.query(
      `SELECT p.id, p.sku, p.name, p.gender, p.category, p.badge, p.image_url,
              p.price::float8 AS price, p.compare_at::float8 AS compare_at, p.rating::float8 AS rating,
              COALESCE((SELECT SUM(ii.qty) FROM product_variants vv JOIN inventory ii ON ii.variant_id = vv.id WHERE vv.product_id = p.id ${storeId ? 'AND ii.store_id = $' + (params.length + 1) : ''}),0)::int AS stock_total
       FROM products p WHERE ${where.join(' AND ')}
       ORDER BY p.name LIMIT 120`,
      storeId ? [...params, storeId] : params,
    );
    res.json({ items: rows.map(toLight) });
  } catch (err) {
    console.error('[pos/products]', err);
    res.status(500).json({ error: 'Error buscando productos' });
  }
});

/** GET /api/pos/orders?status=picking|pendiente|packed|in_transit|delivered&q= */
router.get('/orders', async (req, res) => {
  try {
    const storeId = scopeStore(req);
    const where = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    if (storeId) where.push(`o.store_id = ${p(storeId)}`);
    if (req.query.status) {
      const statuses = String(req.query.status).split(',');
      where.push(`o.status = ANY(${p(statuses)})`);
    }
    if (req.query.q) where.push(`(o.order_no ILIKE ${p(`%${req.query.q}%`)} OR o.customer_name ILIKE ${p(`%${req.query.q}%`)})`);
    if (req.query.today === 'true') where.push(`o.created_at >= CURRENT_DATE`);

    const { rows } = await pool.query(
      `SELECT o.id FROM orders o WHERE ${where.length ? where.join(' AND ') : 'TRUE'}
       ORDER BY o.created_at DESC LIMIT 80`, params);
    const orders = [];
    for (const r of rows) {
      const o = await orderToJson(r.id);
      if (o) orders.push(o);
    }
    res.json({ orders });
  } catch (err) {
    console.error('[pos/orders]', err);
    res.status(500).json({ error: 'Error consultando pedidos' });
  }
});

/** GET /api/pos/orders/:orderNo */
router.get('/orders/:orderNo', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM orders WHERE order_no = $1', [req.params.orderNo]);
    if (!rows[0]) return res.status(404).json({ error: 'Orden no encontrada' });
    const o = await orderToJson(rows[0].id);
    o.nextStatuses = ALLOWED_TRANSITIONS[o.status] || [];
    res.json({ order: o });
  } catch (err) {
    console.error('[pos/orders/get]', err);
    res.status(500).json({ error: 'Error consultando la orden' });
  }
});

/** PATCH /api/pos/orders/:orderNo/status  body: { status } */
router.patch('/orders/:orderNo/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    const { rows } = await pool.query('SELECT id, status FROM orders WHERE order_no = $1', [req.params.orderNo]);
    if (!rows[0]) return res.status(404).json({ error: 'Orden no encontrada' });
    const allowed = ALLOWED_TRANSITIONS[rows[0].status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Transición inválida de "${rows[0].status}" a "${status}". Permitidas: ${allowed.join(', ')}` });
    }
    await pool.query(`UPDATE orders SET status = $1, updated_at = now() WHERE id = $2`, [status, rows[0].id]);
    res.json({ order: await orderToJson(rows[0].id) });
  } catch (err) {
    console.error('[pos/status]', err);
    res.status(500).json({ error: 'Error actualizando estado' });
  }
});

/**
 * POST /api/pos/orders  — venta de mostrador (o cualquier canal gestionado por staff).
 * body: { items:[{sku,size,qty}], customerName, phone?, address?, city?, channel='mostrador',
 *         paymentMethod='tarjeta', paid=true, discount?, sellerId? }
 */
router.post('/orders', async (req, res) => {
  try {
    const storeId = scopeStore(req) || (await pool.query("SELECT id FROM stores WHERE code='CENTRO'")).rows[0].id;
    const { items, customerName = 'Cliente de mostrador', phone, address, city, channel = 'mostrador', paymentMethod = 'tarjeta', paid = true, discount = 0, sellerId } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'La venta no tiene ítems' });

    const result = await tx(async (client) => {
      const lines = [];
      for (const it of items) {
        const prod = await client.query(
          `SELECT p.id, p.name, p.sku, p.price::float8 AS price, pv.id AS variant_id
           FROM products p JOIN product_variants pv ON pv.product_id = p.id
           WHERE p.sku = $1 AND pv.size = $2 AND p.is_active = TRUE LIMIT 1`,
          [it.sku, it.size]);
        if (!prod.rows[0]) throw Object.assign(new Error(`Producto no encontrado: ${it.sku} (${it.size})`), { status: 404 });
        lines.push({ ...prod.rows[0], size: it.size, qty: Math.max(1, Math.floor(Number(it.qty) || 1)) });
      }
      // Stock y descuento
      for (const l of lines) {
        const stock = await client.query(
          'SELECT COALESCE(SUM(qty),0)::int AS q FROM inventory WHERE variant_id = $1 AND store_id = $2', [l.variant_id, storeId]);
        if (stock.rows[0].q < l.qty) throw Object.assign(new Error(`Stock insuficiente de ${l.name} (${l.size}): disponible ${stock.rows[0].q}`), { status: 409 });
      }
      for (const l of lines) {
        await client.query('UPDATE inventory SET qty = qty - $1 WHERE variant_id = $2 AND store_id = $3', [l.qty, l.variant_id, storeId]);
      }
      const subtotal = Math.round(lines.reduce((s, l) => s + l.price * l.qty, 0));
      const disc = Math.min(Math.round(Number(discount) || 0), subtotal);
      const tax = Math.round((subtotal - disc) * 0.19);
      const total = subtotal - disc + tax;
      const { rows: last } = await client.query('SELECT order_no FROM orders ORDER BY order_no DESC LIMIT 1');
      const orderNo = `VM-${Math.max(9000, Number(last[0]?.order_no.replace(/\D/g, '') || 8990) + 1)}`;

      const { rows } = await client.query(
        `INSERT INTO orders (order_no, store_id, channel, status, customer_name, customer_phone, address, city, payment_method, paid, subtotal, discount, tax, total, cashier_id, notes)
         VALUES ($1,$2,$3,'delivered',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [orderNo, storeId, channel, customerName, phone || null, address || null, city || null, paymentMethod, paid, subtotal, disc, tax, total, sellerId || req.user.id, `Venta ${channel} registrada por ${req.user.fullName}`],
      );
      const orderId = rows[0].id;
      for (const l of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, sku, size, color, unit_price, qty)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8)`,
          [orderId, l.id, l.variant_id, l.name, l.sku, l.size, l.price, l.qty]);
      }
      return orderId;
    });

    const order = await orderToJson(result);
    res.status(201).json({
      order,
      message: `Venta ${order.orderNo} registrada. Total: $${order.total.toLocaleString('es-CO')}`,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[pos/orders/create]', err);
    res.status(500).json({ error: 'Error registrando la venta' });
  }
});

/** GET /api/pos/variants?productId=&storeId= — tallas disponibles de un producto en tienda */
router.get('/variants', async (req, res) => {
  try {
    const productId = Number(req.query.productId);
    if (!productId) return res.status(400).json({ error: 'Falta productId' });
    const storeId = scopeStore(req);
    const rows = await getVariantsWithStock(productId, storeId);
    res.json({ variants: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error consultando variantes' });
  }
});

export default router;
