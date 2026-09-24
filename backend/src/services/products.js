import { pool } from '../db.js';

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'U', '30', '32', '34', '36', '38', '39', '40', '4A', '6A', '8A', '10A'];

function sortOrderFor(sort) {
  const orders = {
    pop: 'p.review_count DESC, p.rating DESC, p.id',
    'price-asc': 'p.price ASC, p.id',
    'price-desc': 'p.price DESC, p.id',
    news: 'p.is_new DESC, p.created_at DESC, p.id',
  };
  return orders[sort] || orders.pop;
}

/** Devuelve un producto ligero listo para la API */
export function toListItem(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    gender: row.gender,
    category: row.category,
    badge: row.badge,
    price: row.price,
    compareAt: row.compare_at,
    rating: row.rating,
    reviewCount: row.review_count,
    image: row.image_url,
    isNew: row.is_new,
    isFeatured: row.is_featured,
    sizes: row.sizes || [],
    colors: row.colors || [],
    stockTotal: row.stock_total,
    stockBySize: row.stock_by_size || {},
  };
}

export const toLight = (p) => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  gender: p.gender,
  category: p.category,
  badge: p.badge,
  price: Number(p.price),
  compareAt: p.compare_at ? Number(p.compare_at) : null,
  rating: Number(p.rating),
  reviewCount: p.review_count,
  image: p.image_url,
  isNew: p.is_new,
  isFeatured: p.is_featured,
  stockTotal: Number(p.stock_total ?? 0),
});

/**
 * Listado del catálogo (vitrina pública).
 * filters: { gender, category, q, minPrice, maxPrice, sizes[], badge, sort, novedades, ofertas, storeId, limit, offset }
 */
export async function listProducts(filters = {}) {
  const where = ["p.is_active = TRUE", "p.visibility = 'store'"];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (filters.gender && filters.gender !== 'todos') where.push(`p.gender = ${p(filters.gender)}`);
  if (filters.category) where.push(`p.category ILIKE ${p(filters.category)}`);
  if (filters.q) where.push(`(p.name ILIKE ${p(`%${filters.q}%`)} OR p.category ILIKE ${p(`%${filters.q}%`)} OR p.sku ILIKE ${p(`%${filters.q}%`)})`);
  if (filters.minPrice) where.push(`p.price >= ${p(Number(filters.minPrice))}`);
  if (filters.maxPrice) where.push(`p.price <= ${p(Number(filters.maxPrice))}`);
  if (filters.badge) where.push(`p.badge ILIKE ${p(`%${filters.badge}%`)}`);
  if (filters.novedades === 'true') where.push(`(p.is_new = TRUE OR p.badge = 'Nuevo')`);
  if (filters.ofertas === 'true') where.push(`(p.compare_at IS NOT NULL OR p.badge ILIKE '%flash%' OR p.badge ILIKE '%pack%')`);

  if (filters.sizes?.length) {
    params.push(filters.sizes);
    const sizesIdx = params.length;
    let exists = `EXISTS (SELECT 1 FROM product_variants vv WHERE vv.product_id = p.id AND vv.size = ANY($${sizesIdx})`;
    if (filters.storeId) {
      params.push(filters.storeId);
      exists += ` AND EXISTS (SELECT 1 FROM inventory ii WHERE ii.variant_id = vv.id AND ii.store_id = $${params.length} AND ii.qty > 0)`;
    } else {
      exists += ` AND EXISTS (SELECT 1 FROM inventory ii WHERE ii.variant_id = vv.id AND ii.qty > 0)`;
    }
    where.push(`${exists})`);
  } else if (filters.storeId) {
    where.push(`EXISTS (SELECT 1 FROM product_variants vv2 JOIN inventory ii2 ON ii2.variant_id = vv2.id WHERE vv2.product_id = p.id AND ii2.store_id = ${p(filters.storeId)} AND ii2.qty > 0)`);
  }

  const limit = Math.min(Number(filters.limit) || 100, 500);
  const offset = Number(filters.offset) || 0;

  const idsSql = `
    SELECT p.id, p.sku, p.name, p.slug, p.gender, p.category, p.badge, p.image_url,
           p.price::float8 AS price, p.compare_at::float8 AS compare_at,
           p.rating::float8 AS rating, p.review_count, p.is_new, p.is_featured
    FROM products p
    WHERE ${where.join(' AND ')}
    ORDER BY ${sortOrderFor(filters.sort)}
    LIMIT ${limit} OFFSET ${offset}`;
  const { rows: base } = await pool.query(idsSql, params);
  if (!base.length) return [];

  const ids = base.map((r) => r.id);
  const { rows: agg } = await pool.query(
    `SELECT v.product_id,
            COALESCE(array_agg(DISTINCT v.size), '{}') AS sizes,
            COALESCE(array_agg(DISTINCT v.color), '{}') AS colors,
            COALESCE(SUM(i.qty) FILTER (WHERE i.qty IS NOT NULL), 0)::int AS stock_total
     FROM product_variants v
     LEFT JOIN inventory i ON i.variant_id = v.id ${filters.storeId ? 'AND i.store_id = $2' : ''}
     WHERE v.product_id = ANY($1)
     GROUP BY v.product_id`,
    filters.storeId ? [ids, filters.storeId] : [ids],
  );

  const aggMap = new Map(agg.map((r) => [r.product_id, r]));

  // stock por talla (para marcar disponibilidad) en la misma tienda consultada
  const { rows: bySize } = await pool.query(
    `SELECT v.product_id, v.size, COALESCE(SUM(i.qty), 0)::int AS qty
     FROM product_variants v
     LEFT JOIN inventory i ON i.variant_id = v.id ${filters.storeId ? 'AND i.store_id = $2' : ''}
     WHERE v.product_id = ANY($1)
     GROUP BY v.product_id, v.size`,
    filters.storeId ? [ids, filters.storeId] : [ids],
  );
  const stockBySize = new Map();
  for (const r of bySize) {
    if (!stockBySize.has(r.product_id)) stockBySize.set(r.product_id, {});
    stockBySize.get(r.product_id)[r.size] = r.qty;
  }

  return base.map((r) => {
    const a = aggMap.get(r.id) || {};
    return toListItem({ ...r, sizes: a.sizes, colors: a.colors, stock_total: a.stock_total ?? 0, stock_by_size: stockBySize.get(r.id) || {} });
  });
}

/** Busca un producto por id o sku (retorna la fila ligera) */
export async function findProduct(ident) {
  const col = /^\d+$/.test(String(ident)) ? 'p.id' : 'p.sku';
  const { rows } = await pool.query(
    `SELECT p.*, p.price::float8 AS price, p.compare_at::float8 AS compare_at, p.rating::float8 AS rating,
            COALESCE((SELECT SUM(i.qty) FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.product_id = p.id), 0)::int AS stock_total
     FROM products p WHERE ${col} = $1`,
    [ident],
  );
  return rows[0] || null;
}

/**
 * Detalle completo: imágenes, tallas con stock por tienda, descripción, etc.
 */
export async function getProductDetail(ident) {
  const base = await findProduct(ident);
  if (!base) return null;

  const { rows: inv } = await pool.query(
    `SELECT v.id AS variant_id, v.size, v.color, v.sku AS variant_sku,
            s.id AS store_id, s.name AS store_name, s.code AS store_code,
            COALESCE(i.qty, 0)::int AS qty
     FROM product_variants v
     LEFT JOIN inventory i ON i.variant_id = v.id
     LEFT JOIN stores s ON s.id = i.store_id
     WHERE v.product_id = $1
     ORDER BY v.size, s.id`,
    [base.id],
  );

  const { rows: images } = await pool.query('SELECT url FROM product_images WHERE product_id = $1 ORDER BY position', [base.id]);

  // Inicializar estructura por talla y color
  const variants = new Map();
  for (const r of inv) {
    const key = `${r.size}__${r.color}`;
    if (!variants.has(key)) {
      variants.set(key, { size: r.size, color: r.color, variantId: r.variant_id, variantSku: r.variant_sku, stockByStore: {} });
    }
    const entry = variants.get(key);
    entry.stockByStore[r.store_code || 'sin-tienda'] = { storeId: r.store_id, storeName: r.store_name, qty: r.qty };
    entry.total = Object.values(entry.stockByStore).reduce((s, x) => s + x.qty, 0);
  }
  const variantList = [...variants.values()];
  variantList.sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a.size);
    const ib = SIZE_ORDER.indexOf(b.size);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const sizes = [...new Set(variantList.map((v) => v.size))];
  const colors = [...new Set(variantList.map((v) => v.color))];

  // Productos complementarios del "look completo"
  let companions = [];
  const companionSkus = base.details?.companionSkus;
  if (Array.isArray(companionSkus) && companionSkus.length) {
    const { rows: comp } = await pool.query(
      `SELECT p.*, p.price::float8 AS price, p.compare_at::float8 AS compare_at,
              COALESCE((SELECT SUM(i.qty) FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.product_id = p.id),0)::int AS stock_total
       FROM products p WHERE p.sku = ANY($1) AND p.is_active = TRUE`,
      [companionSkus],
    );
    companions = comp.map(toLight);
  }

  return {
    ...toLight(base),
    gallery: images.map((x) => x.url),
    description: base.description,
    details: base.details,
    fitNote: base.details?.fitNote || null,
    variants: variantList.map((v) => ({
      id: v.variantId,
      size: v.size,
      color: v.color,
      sku: v.variantSku,
      total: v.total,
      stockByStore: v.stockByStore,
    })),
    sizes,
    colors,
    inventoryByStore: [...new Map(inv.map((r) => [r.store_code, { storeId: r.store_id, storeCode: r.store_code, storeName: r.store_name }])).values()],
    companions,
  };
}

/** Variantes + stock de un producto en una tienda concreta (POS/almacén) */
export async function getVariantsWithStock(productId, storeId = null) {
  const { rows } = await pool.query(
    `SELECT v.id, v.size, v.color, v.sku,
            COALESCE(i.qty, 0)::int AS qty, i.reorder_point
     FROM product_variants v
     LEFT JOIN inventory i ON i.variant_id = v.id AND ($2::int IS NULL OR i.store_id = $2)
     WHERE v.product_id = $1
     ORDER BY v.size`,
    [productId, storeId],
  );
  return rows;
}
