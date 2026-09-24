import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { orderToJson } from './orders.js';
import { findProduct } from '../services/products.js';

const router = Router();
router.use(requireRole('admin'));

function periodRange(period) {
  switch (period) {
    case 'today':
      return { start: 'CURRENT_DATE', prev: "CURRENT_DATE - INTERVAL '1 day'" };
    case '7d':
      return { start: "now() - INTERVAL '7 days'", prev: "now() - INTERVAL '14 days'" };
    case 'month':
      return { start: "date_trunc('month', now())", prev: "date_trunc('month', now()) - INTERVAL '1 month'" };
    case 'quarter':
      return { start: "date_trunc('quarter', now())", prev: "date_trunc('quarter', now()) - INTERVAL '1 quarter'" };
    default:
      return { start: "now() - INTERVAL '7 days'", prev: "now() - INTERVAL '14 days'" };
  }
}

/** GET /api/admin/stats?period=&storeId= */
router.get('/stats', async (req, res) => {
  try {
    const period = req.query.period || '7d';
    const { start, prev } = periodRange(period);
    const storeId = req.query.storeId ? Number(req.query.storeId) : null;
    const storeFilter = storeId ? 'AND store_id = $1' : '';
    const baseParams = storeId ? [storeId] : [];
    const storeCond = (col) => (storeId ? ` AND ${col} = $1` : '');

    const rev = async (rangeStart) => {
      const { rows } = await pool.query(
        `SELECT COALESCE(SUM(total),0)::float8 AS revenue,
                COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS processed,
                COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered
         FROM orders WHERE paid = TRUE AND created_at >= ${rangeStart} ${storeFilter}`, baseParams);
      return rows[0];
    };
    const cur = await rev(start);
    const prevv = await rev(prev);

    const units = await pool.query(
      `SELECT COALESCE(SUM(i.qty),0)::int AS units,
              COUNT(DISTINCT CASE WHEN i.qty > 0 THEN v.product_id END)::int AS active_skus,
              COUNT(*) FILTER (WHERE i.qty = 0)::int AS out_of_stock,
              COUNT(*) FILTER (WHERE i.qty > 0 AND i.qty <= i.reorder_point)::int AS low_stock,
              COALESCE(SUM(i.qty * p.cost),0)::float8 AS valuation
       FROM inventory i
       JOIN product_variants v ON v.id = i.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE p.is_active = TRUE ${storeCond('i.store_id')}`,
      storeId ? [storeId] : []);

    const dept = await pool.query(
      `SELECT CASE WHEN p.gender IN ('ninos','unisex') THEN 'ninos' ELSE p.gender END AS grupo,
              SUM(oi.unit_price * oi.qty)::float8 AS amount
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.paid = TRUE AND o.status <> 'cancelled' AND o.created_at >= ${start} ${storeFilter}
       GROUP BY grupo`, baseParams);
    const deptTot = dept.rows.reduce((s, d) => s + Number(d.amount), 0);
    const deptLabels = { damas: 'Damas', caballeros: 'Caballeros', ninos: 'Niños & Calzado' };
    const departments = dept.rows.map((d) => ({
      name: deptLabels[d.grupo] || d.grupo,
      amount: Math.round(Number(d.amount)),
      pct: deptTot > 0 ? Math.round((Number(d.amount) / deptTot) * 100) : 0,
    }));

    const low = await pool.query(
      `SELECT p.sku, p.name, p.category, p.image_url, v.size, v.color, i.qty, i.reorder_point,
              (p.price::float8 - p.cost::float8) / NULLIF(p.price::float8, 0) * 100 AS margin
       FROM inventory i
       JOIN product_variants v ON v.id = i.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE p.is_active = TRUE AND i.qty <= i.reorder_point ${storeCond('i.store_id')}
       ORDER BY i.qty ASC LIMIT 8`, storeId ? [storeId] : []);

    const current = Number(cur.revenue);
    const previous = Number(prevv.revenue);
    const growth = previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

    // Orden de compra sugerida (heurística simple sobre quiebres de stock)
    const suppliers = ['Tejidos Premium S.A.', 'Urban Footwear Ltd', 'Moda Kids Distribuciones'];
    const reorderSuggestions = low.rows.filter((r) => r.qty === 0 || r.qty <= 3).slice(0, 3).map((r, i) => ({
      supplier: suppliers[i % suppliers.length],
      sku: r.sku,
      name: r.name,
      size: r.size,
      suggestedQty: Math.max(r.reorder_point * 2 - r.qty, r.reorder_point),
      reason: r.qty === 0 ? 'Agotado — quiebre de stock inminente' : 'Stock bajo el punto de reorden',
    }));

    res.json({
      period,
      revenue: Math.round(current),
      revenueGrowth: growth,
      ordersProcessed: cur.processed,
      ordersGrowth: previous > 0 ? Math.round(((cur.processed - prevv.processed) / prevv.processed) * 1000) / 10 : null,
      onTimeRate: cur.processed > 0 ? Math.round((cur.delivered / cur.processed) * 1000) / 10 : 98.4,
      unitsInStock: units.rows[0].units,
      activeSkus: units.rows[0].active_skus,
      lowStockVariants: units.rows[0].low_stock,
      outOfStockVariants: units.rows[0].out_of_stock,
      valuation: Math.round(Number(units.rows[0].valuation)),
      departments,
      lowStock: low.rows.map((r) => ({ ...r, margin: Math.round(Number(r.margin)) })),
      reorderSuggestions,
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ error: 'Error calculando estadísticas' });
  }
});

/** GET /api/admin/products?q=&status=&gender=&storeId=  (tabla de inventario) */
router.get('/products', async (req, res) => {
  try {
    // La tabla de inventario es por sucursal; por defecto Almacén Central.
    let storeId = req.query.storeId ? Number(req.query.storeId) : null;
    if (!storeId) {
      const def = await pool.query(`SELECT id FROM stores WHERE code = 'CENTRAL'`);
      storeId = def.rows[0]?.id ?? null;
    }
    const filter = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    if (req.query.q) filter.push(`(p.name ILIKE ${p(`%${req.query.q}%`)} OR p.sku ILIKE ${p(`%${req.query.q}%`)} OR v.color ILIKE ${p(`%${req.query.q}%`)})`);
    if (req.query.gender && req.query.gender !== 'todos') filter.push(`p.gender = ${p(req.query.gender)}`);
    if (req.query.visibility && req.query.visibility !== 'todas') filter.push(`p.visibility = ${p(req.query.visibility)}`);
    if (storeId) filter.push(`i.store_id = ${p(storeId)}`);

    const { rows } = await pool.query(
      `SELECT i.id AS inventory_id, v.id AS variant_id, p.id AS product_id,
              p.sku, p.name, p.category, p.gender, p.image_url, p.badge, p.visibility,
              v.size, v.color, v.sku AS variant_sku,
              COALESCE(i.qty, 0)::int AS qty, COALESCE(i.reorder_point, 10) AS reorder_point,
              p.price::float8 AS price, p.cost::float8 AS cost
       FROM products p
       JOIN product_variants v ON v.product_id = p.id
       LEFT JOIN inventory i ON i.variant_id = v.id ${storeId ? 'AND i.store_id = $' + (params.length + 1) : ''}
       WHERE p.is_active = TRUE ${filter.length ? 'AND ' + filter.join(' AND ') : ''}
       ORDER BY p.sku, v.size`,
      storeId ? [...params, storeId] : params,
    );

    let items = rows.map((r) => {
      const qty = Number(r.qty);
      const price = Number(r.price);
      const estado = qty <= 0 ? 'Sin Stock' : qty <= r.reorder_point ? 'Stock Bajo' : 'En Stock';
      return {
        inventoryId: r.inventory_id,
        variantId: r.variant_id,
        productId: r.product_id,
        sku: r.sku,
        variantSku: r.variant_sku,
        name: r.name,
        category: r.category,
        gender: r.gender,
        image: r.image_url,
        badge: r.badge,
        visibility: r.visibility,
        size: r.size,
        color: r.color,
        qty,
        reorderPoint: r.reorder_point,
        price: Math.round(price),
        cost: Math.round(Number(r.cost)),
        marginPct: price > 0 ? Math.round(((price - Number(r.cost)) / price) * 100) : 0,
        estado,
      };
    });

    const status = req.query.status;
    if (status && status !== 'todos') {
      const map = { en_stock: 'En Stock', bajo: 'Stock Bajo', agotado: 'Sin Stock' };
      items = items.filter((i) => i.estado === (map[status] || status));
    }

    // totales para el encabezado de la tabla
    const counters = {
      total: rows.length,
      enStock: items.filter((i) => i.estado === 'En Stock').length,
      stockBajo: items.filter((i) => i.estado === 'Stock Bajo').length,
      agotado: items.filter((i) => i.estado === 'Sin Stock').length,
      valuation: items.reduce((s, i) => s + i.qty * i.cost, 0),
    };
    res.json({ items, counters });
  } catch (err) {
    console.error('[admin/products]', err);
    res.status(500).json({ error: 'Error consultando inventario' });
  }
});

/** POST /api/admin/products  (nuevo producto con variantes) */
router.post('/products', async (req, res) => {
  try {
    const b = req.body || {};
    const { name, gender = 'damas', category = 'Colección', price, compareAt, color = 'Único', sizes = ['S', 'M', 'L'], imageUrl, badge, description, visibility = 'store', isNew = false, sku } = b;
    if (!name?.trim() || !(Number(price) > 0)) return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
    const prefix = { damas: 'VM-DAM', caballeros: 'VM-CAB', ninos: 'VM-NIN', unisex: 'VM-ACC' }[gender] || 'VM-ACC';
    const finalSku = sku?.trim() || `${prefix}-${Math.floor(1000 + Math.random() * 8999)}`;
    const slug = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const store = await pool.query(`SELECT id FROM stores WHERE code = 'CENTRAL'`);
    const centralId = store.rows[0]?.id;

    const { rows } = await pool.query(
      `INSERT INTO products (sku,name,slug,gender,category,badge,price,compare_at,image_url,is_new,is_active,visibility,cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12) RETURNING id`,
      [finalSku, name.trim(), slug, gender, category, badge || null, Number(price), compareAt ? Number(compareAt) : null, imageUrl || null, isNew, visibility, Math.round(Number(price) * 0.45)],
    );
    const productId = rows[0].id;
    for (const size of sizes) {
      const v = await pool.query(
        `INSERT INTO product_variants (product_id,size,color,sku) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
        [productId, size, color, `${finalSku}-${size}`]);
      if (v.rows[0] && centralId) {
        await pool.query('INSERT INTO inventory (variant_id,store_id,qty,reorder_point) VALUES ($1,$2,0,10)', [v.rows[0].id, centralId]);
      }
    }
    res.status(201).json({ product: await findProduct(productId), message: `Producto ${finalSku} creado` });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'El SKU ya existe' });
    console.error('[admin/products/create]', err);
    res.status(500).json({ error: 'Error creando el producto' });
  }
});

/** PUT /api/admin/products/:id  (edición) */
router.put('/products/:id', async (req, res) => {
  try {
    const allowed = ['name', 'price', 'compareAt', 'category', 'gender', 'badge', 'imageUrl', 'description', 'isActive', 'visibility'];
    const fields = [];
    const params = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        const col = k === 'compareAt' ? 'compare_at' : k === 'imageUrl' ? 'image_url' : k === 'isActive' ? 'is_active' : k;
        params.push(req.body[k]);
        fields.push(`${col} = $${params.length}`);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
    params.push(req.params.id);
    const { rowCount } = await pool.query(`UPDATE products SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    if (!rowCount) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ product: await findProduct(req.params.id) });
  } catch (err) {
    console.error('[admin/products/update]', err);
    res.status(500).json({ error: 'Error actualizando producto' });
  }
});

/**
 * PATCH /api/admin/inventory/:variantId  body: { qty?, reorderPoint?, storeId? }
 * Ajusta stock de una variante en una tienda (por defecto Almacén Central).
 */
router.patch('/inventory/:variantId', async (req, res) => {
  try {
    const { qty, reorderPoint, storeId } = req.body || {};
    const variantId = Number(req.params.variantId);
    let target = storeId ? Number(storeId) : null;
    if (!target) {
      const store = await pool.query(`SELECT id FROM stores WHERE code = 'CENTRAL'`);
      target = store.rows[0]?.id;
    }
    if (!target || !variantId) return res.status(400).json({ error: 'variantId y storeId son obligatorios' });
    const fields = [];
    const params = [variantId, target];
    if (qty !== undefined) { params.push(Math.max(0, Math.floor(Number(qty)))); fields.push(`qty = $${params.length}`); }
    if (reorderPoint !== undefined) { params.push(Math.max(0, Math.floor(Number(reorderPoint)))); fields.push(`reorder_point = $${params.length}`); }
    if (!fields.length) return res.status(400).json({ error: 'Indica qty o reorderPoint' });

    const { rows } = await pool.query(
      `INSERT INTO inventory (variant_id, store_id, qty, reorder_point)
       VALUES ($1,$2,0,10)
       ON CONFLICT (variant_id, store_id) DO UPDATE SET ${fields.join(', ')}
       RETURNING id, qty, reorder_point`,
      params,
    );
    res.json({ inventory: rows[0], message: 'Stock actualizado' });
  } catch (err) {
    console.error('[admin/inventory]', err);
    res.status(500).json({ error: 'Error ajustando inventario' });
  }
});

/** GET /api/admin/orders  (visión omnicanal) */
router.get('/orders', async (req, res) => {
  try {
    const where = [];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };
    if (req.query.status) where.push(`o.status = ANY(${p(String(req.query.status).split(','))})`);
    if (req.query.q) where.push(`(o.order_no ILIKE ${p(`%${req.query.q}%`)} OR o.customer_name ILIKE ${p(`%${req.query.q}%`)})`);
    if (req.query.storeId) where.push(`o.store_id = ${p(Number(req.query.storeId))}`);
    const { rows } = await pool.query(
      `SELECT o.id FROM orders o ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.created_at DESC LIMIT 200`, params);
    const orders = [];
    for (const r of rows) {
      const o = await orderToJson(r.id);
      if (o) orders.push(o);
    }
    res.json({ orders });
  } catch (err) {
    console.error('[admin/orders]', err);
    res.status(500).json({ error: 'Error consultando pedidos' });
  }
});

export default router;
