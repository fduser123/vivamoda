import { Router } from 'express';
import { pool } from '../db.js';
import { listProducts, getProductDetail } from '../services/products.js';

const router = Router();

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
