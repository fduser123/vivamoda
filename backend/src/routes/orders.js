import { Router } from 'express';
import { pool, tx } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

const STATUS_LABELS = {
  pendiente: 'Pendiente de confirmación',
  picking: 'En preparación',
  packed: 'Empacado / Listo',
  in_transit: 'En tránsito',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export const orderStatusLabel = (s) => STATUS_LABELS[s] || s;

export async function orderToJson(orderId) {
  const { rows } = await pool.query(
    `SELECT o.*, s.name AS store_name, s.code AS store_code,
            o.subtotal::float8 AS subtotal, o.tax::float8 AS tax, o.discount::float8 AS discount, o.total::float8 AS total
     FROM orders o JOIN stores s ON s.id = o.store_id WHERE o.id = $1`,
    [orderId],
  );
  if (!rows[0]) return null;
  const o = rows[0];
  const items = await pool.query(
    `SELECT product_name, sku, size, color, qty, unit_price::float8 AS unit_price
     FROM order_items WHERE order_id = $1`, [orderId]);
  return {
    id: o.id,
    orderNo: o.order_no,
    channel: o.channel,
    status: o.status,
    statusLabel: orderStatusLabel(o.status),
    customerName: o.customer_name,
    customerPhone: o.customer_phone,
    address: o.address,
    city: o.city,
    courier: o.courier,
    trackingNo: o.tracking_no,
    store: { id: o.store_id, name: o.store_name, code: o.store_code },
    paymentMethod: o.payment_method,
    paid: o.paid,
    subtotal: Number(o.subtotal),
    discount: Number(o.discount),
    tax: Number(o.tax),
    total: Number(o.total),
    aiAssisted: o.ai_assisted,
    notes: o.notes,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    items: items.rows.map((i) => ({ ...i, unitPrice: Number(i.unit_price) })),
  };
}

async function nextOrderNo() {
  const { rows } = await pool.query(`SELECT order_no FROM orders ORDER BY order_no DESC LIMIT 1`);
  const last = rows[0] ? Number(rows[0].order_no.replace(/\D/g, '')) : 8990;
  return `VM-${Math.max(9000, last + 1)}`;
}

/**
 * POST /api/orders  — checkout con el carrito del cliente (canal web).
 * body: { address, city, phone, paymentMethod, notes?, discount? }
 */
router.post('/', requireAuth, async (req, res) => {
  const { address, city, phone, paymentMethod = 'tarjeta', notes, discount = 0 } = req.body || {};
  try {
    const result = await tx(async (client) => {
      const cart = await client.query(
        `SELECT ci.*, p.price::float8 AS price, p.name, p.sku, v.size, v.color
         FROM cart_items ci
         JOIN carts c ON c.id = ci.cart_id AND c.user_id = $1
         JOIN products p ON p.id = ci.product_id
         LEFT JOIN product_variants v ON v.id = ci.variant_id
         ORDER BY ci.id`, [req.user.id]);
      if (!cart.rows.length) throw Object.assign(new Error('Tu bolsa está vacía'), { status: 400 });

      const online = await client.query(`SELECT id FROM stores WHERE code = 'ONLINE'`);
      const storeId = online.rows[0]?.id ?? (await client.query('SELECT id FROM stores LIMIT 1')).rows[0].id;

      // Verificar stock y descontarlo (canal online)
      const out = [];
      for (const item of cart.rows) {
        const stock = await client.query(
          `SELECT COALESCE(SUM(qty),0)::int AS qty FROM inventory WHERE variant_id = $1 AND store_id = $2`,
          [item.variant_id, storeId]);
        if (stock.rows[0].qty < item.qty) {
          out.push({ name: item.name, size: item.size, available: stock.rows[0].qty });
        }
      }
      if (out.length) {
        throw Object.assign(new Error(`Stock insuficiente: ${out.map((x) => `${x.name} (${x.size}) — disponible ${x.available}`).join(', ')}`), { status: 409 });
      }
      for (const item of cart.rows) {
        await client.query(
          `UPDATE inventory SET qty = qty - $1 WHERE variant_id = $2 AND store_id = $3`,
          [item.qty, item.variant_id, storeId]);
      }

      const subtotal = Math.round(cart.rows.reduce((s, i) => s + i.price * i.qty, 0));
      const disc = Math.min(Math.round(Number(discount) || 0), subtotal);
      const tax = Math.round((subtotal - disc) * 0.19);
      const total = subtotal - disc + tax;
      const orderNo = await nextOrderNo();

      const order = await client.query(
        `INSERT INTO orders (order_no, user_id, store_id, channel, status, customer_name, customer_phone, address, city, payment_method, paid, subtotal, discount, tax, total, notes)
         VALUES ($1,$2,$3,'web','picking',$4,$5,$6,$7,$8,FALSE,$9,$10,$11,$12,$13) RETURNING id`,
        [orderNo, req.user.id, storeId, req.user.fullName, phone || req.user.phone, address, city, paymentMethod, subtotal, disc, tax, total, notes],
      );
      for (const item of cart.rows) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, sku, size, color, unit_price, qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [order.rows[0].id, item.product_id, item.variant_id, item.name, item.sku, item.size, item.color, item.price, item.qty]);
      }
      await client.query('DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)', [req.user.id]);
      return order.rows[0].id;
    });

    res.status(201).json({ order: await orderToJson(result), message: `Orden ${(await pool.query('SELECT order_no FROM orders WHERE id=$1', [result])).rows[0].order_no} creada. Pago pendiente de confirmación (demo).` });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[orders/create]', err);
    res.status(500).json({ error: 'Error creando la orden' });
  }
});

/** GET /api/orders/mine  → pedidos del cliente autenticado */
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM orders WHERE user_id = $1 ORDER BY created_at DESC`, [req.user.id]);
    const orders = [];
    for (const r of rows) {
      const o = await orderToJson(r.id);
      if (o) orders.push(o);
    }
    res.json({ orders });
  } catch (err) {
    console.error('[orders/mine]', err);
    res.status(500).json({ error: 'Error consultando tus pedidos' });
  }
});

/** GET /api/orders/:orderNo → detalle/tracking (dueño o staff/admin) */
router.get('/:orderNo', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, user_id FROM orders WHERE order_no = $1', [req.params.orderNo]);
    if (!rows[0]) return res.status(404).json({ error: 'Orden no encontrada' });
    const isOwner = req.user.role === 'client' && rows[0].user_id === req.user.id;
    const isStaff = ['staff', 'admin'].includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'No puedes ver esta orden' });
    res.json({ order: await orderToJson(rows[0].id) });
  } catch (err) {
    console.error('[orders/get]', err);
    res.status(500).json({ error: 'Error consultando la orden' });
  }
});

export default router;
export { requireRole };
