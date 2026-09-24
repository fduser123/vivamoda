import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { toLight } from '../services/products.js';

const router = Router();
router.use(requireAuth);

async function getOrCreateCart(userId) {
  const { rows } = await pool.query(
    `INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING id`,
    [userId],
  );
  return rows[0].id;
}

async function fullCart(userId) {
  const cartId = await getOrCreateCart(userId);
  const { rows } = await pool.query(
    `SELECT ci.id, ci.qty, ci.variant_id, ci.product_id,
            p.sku, p.name, p.image_url, p.category, p.gender,
            p.price::float8 AS unit_price, p.compare_at::float8 AS compare_at,
            v.size, v.color,
            COALESCE((SELECT SUM(i.qty) FROM inventory i WHERE i.variant_id = v.id), 0)::int AS stock_total
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN product_variants v ON v.id = ci.variant_id
     WHERE ci.cart_id = $1
     ORDER BY ci.id`,
    [cartId],
  );
  const items = rows.map((r) => ({
    id: r.id,
    product: { id: r.product_id, sku: r.sku, name: r.name, image: r.image_url, category: r.category, gender: r.gender, price: Number(r.unit_price), compareAt: r.compare_at != null ? Number(r.compare_at) : null },
    variantId: r.variant_id,
    size: r.size,
    color: r.color,
    qty: r.qty,
    stockTotal: Number(r.stock_total),
    available: Number(r.stock_total) > 0,
    lineTotal: Math.round(r.qty * Number(r.unit_price)),
  }));
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  return { cartId, items, count: items.reduce((s, i) => s + i.qty, 0), subtotal };
}

/** GET /api/cart */
router.get('/', async (req, res) => {
  try {
    res.json(await fullCart(req.user.id));
  } catch (err) {
    console.error('[cart]', err);
    res.status(500).json({ error: 'Error leyendo el carrito' });
  }
});

async function resolveVariant(skuOrId, size) {
  const { rows } = await pool.query(
    `SELECT pv.id, p.id AS product_id
     FROM product_variants pv JOIN products p ON p.id = pv.product_id
     WHERE (p.sku = $1 OR p.id::text = $1) AND pv.size = $2 AND p.is_active = TRUE
     LIMIT 1`,
    [String(skuOrId), size],
  );
  return rows[0] || null;
}

/** POST /api/cart/items  body: { sku, size, qty } */
router.post('/items', async (req, res) => {
  try {
    const { sku, size, qty = 1 } = req.body || {};
    if (!sku || !size) return res.status(400).json({ error: 'Faltan sku o talla' });
    const v = await resolveVariant(sku, size);
    if (!v) return res.status(404).json({ error: 'Producto o talla no encontrado' });
    const cartId = await getOrCreateCart(req.user.id);
    await pool.query(
      `INSERT INTO cart_items (cart_id, product_id, variant_id, qty) VALUES ($1,$2,$3,$4)
       ON CONFLICT (cart_id, product_id, variant_id) DO UPDATE SET qty = LEAST(cart_items.qty + EXCLUDED.qty, 50)`,
      [cartId, v.product_id, v.id, Math.max(1, Math.min(50, Math.floor(qty)))],
    );
    res.status(201).json(await fullCart(req.user.id));
  } catch (err) {
    console.error('[cart/items]', err);
    res.status(500).json({ error: 'Error agregando al carrito' });
  }
});

/** PATCH /api/cart/items/:id  body: { qty } */
router.patch('/items/:id', async (req, res) => {
  try {
    const qty = Math.max(1, Math.min(50, Math.floor(Number(req.body?.qty) || 1)));
    const { rowCount } = await pool.query(
      `UPDATE cart_items ci SET qty = $1
       FROM carts c WHERE c.id = ci.cart_id AND c.user_id = $2 AND ci.id = $3`,
      [qty, req.user.id, req.params.id],
    );
    if (!rowCount) return res.status(404).json({ error: 'Ítem no encontrado' });
    res.json(await fullCart(req.user.id));
  } catch (err) {
    console.error('[cart/patch]', err);
    res.status(500).json({ error: 'Error actualizando el carrito' });
  }
});

/** DELETE /api/cart/items/:id */
router.delete('/items/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM cart_items ci USING carts c WHERE c.id = ci.cart_id AND c.user_id = $1 AND ci.id = $2`,
      [req.user.id, req.params.id],
    );
    res.json(await fullCart(req.user.id));
  } catch (err) {
    console.error('[cart/delete]', err);
    res.status(500).json({ error: 'Error quitando del carrito' });
  }
});

export default router;
