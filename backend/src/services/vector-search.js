// =====================================================================
// BÚSQUEDA VECTORIAL SOBRE EL CATÁLOGO (pgvector + FashionCLIP)
//
// Los vectores los produce el sidecar Python (ai/embed_server.py); aquí se
// guardan y se consultan con pgvector. Cada producto tiene tres vectores de
// 512 dimensiones (ver ai/build_embeddings.py):
//   image_vec · text_vec · fused_vec
//
// El filtrado por metadatos NO es opcional: la similitud vectorial por sí
// sola devuelve prendas semánticamente parecidas pero agotadas, de otra
// categoría o fuera de presupuesto. Los filtros se aplican en el SQL, sobre
// las columnas reales, no después en memoria.
// =====================================================================
import { pool } from '../db.js';
import { config } from '../config.js';

// Espacios de comparación. El ORDEN de preferencia salió de medir, no de
// suponer (ver ai/comparar-espacios.mjs): para la consulta "vestido elegante
// para una boda en la playa", comparar el texto contra los vectores de IMAGEN
// devolvía vestidos, mientras que compararlo contra los vectores de TEXTO
// devolvía bolsos y adornos de zapatos. Es la alineación cross-modal de CLIP.
// Por eso el modo por defecto ('mixto') pesa más la imagen, y el texto queda
// como señal secundaria y como único recurso para las 19 prendas sin foto.
const PESO_IMAGEN = 0.7;
const PESO_TEXTO = 0.3;

function expresionSimilitud(espacio) {
  if (espacio === 'image') return '1 - (e.image_vec <=> $1::vector)';
  if (espacio === 'text') return '1 - (e.text_vec <=> $1::vector)';
  if (espacio === 'fused') return '1 - (e.fused_vec <=> $1::vector)';
  // mixto (por defecto)
  return `(${PESO_IMAGEN} * COALESCE(1 - (e.image_vec <=> $1::vector), 0)`
    + ` + ${PESO_TEXTO} * COALESCE(1 - (e.text_vec <=> $1::vector), 0))`;
}

function condicionVector(espacio) {
  if (espacio === 'image') return 'e.image_vec IS NOT NULL';
  if (espacio === 'text') return 'e.text_vec IS NOT NULL';
  if (espacio === 'fused') return 'e.fused_vec IS NOT NULL';
  return '(e.image_vec IS NOT NULL OR e.text_vec IS NOT NULL)';
}

/** ¿Responde el sidecar de embeddings? */
export async function estadoEmbeddings() {
  try {
    const res = await fetch(`${config.embedServiceUrl}/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const j = await res.json();
    return { ok: Boolean(j.ok), model: j.model, dim: j.dim, device: j.device };
  } catch (err) {
    return { ok: false, reason: `sidecar no disponible en ${config.embedServiceUrl}: ${err.message}` };
  }
}

async function pedir(ruta, payload) {
  const res = await fetch(`${config.embedServiceUrl}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`sidecar ${ruta} → HTTP ${res.status}`);
  return res.json();
}

/** Vectoriza texto. Devuelve un array de vectores (512 dims, normalizados). */
export async function embedText(textos) {
  const { vectors } = await pedir('/embed/text', { texts: textos });
  return vectors;
}

/** Vectoriza imágenes en base64 (JPEG/PNG). */
export async function embedImage(b64s) {
  const { vectors } = await pedir('/embed/image', { images: b64s });
  return vectors;
}

const aVector = (v) => `[${v.join(',')}]`;

/**
 * Búsqueda por similitud con filtros de metadatos.
 * filtros: { genero, categoria, prenda, color, ocasion, precioMax, precioMin,
 *            soloConStock, soloVisibles }
 */
export async function buscarPorVector(vector, {
  k = 20, espacio = 'mixto', filtros = {},
} = {}) {
  const sim = expresionSimilitud(espacio);
  const where = [condicionVector(espacio)];
  const params = [aVector(vector)];

  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (filtros.soloVisibles !== false) {
    where.push('p.is_active = TRUE');
    where.push("p.visibility = 'store'");
  }
  if (filtros.genero) where.push(`p.gender = ${p(filtros.genero)}`);
  if (filtros.categoria) where.push(`p.category ILIKE ${p(`%${filtros.categoria}%`)}`);
  if (filtros.prenda) where.push(`a.garment_type ILIKE ${p(`%${filtros.prenda}%`)}`);
  if (filtros.color) where.push(`a.color_main ILIKE ${p(`%${filtros.color}%`)}`);
  // OJO: el driver ya convierte un array de JS a text[]. Envolverlo en
  // ARRAY[$1] creaba un array ANIDADO y la comparación no casaba nunca, así
  // que el filtro de ocasión dejaba la búsqueda vacía y se relajaba solo.
  if (filtros.ocasion) where.push(`a.occasion && ${p(filtros.ocasion)}::text[]`);
  if (Number.isFinite(filtros.precioMax)) where.push(`p.price <= ${p(filtros.precioMax)}`);
  if (Number.isFinite(filtros.precioMin)) where.push(`p.price >= ${p(filtros.precioMin)}`);
  if (filtros.soloConStock !== false) {
    where.push(`EXISTS (SELECT 1 FROM product_variants v JOIN inventory i ON i.variant_id = v.id
                WHERE v.product_id = p.id AND i.qty > 0)`);
  }

  const { rows } = await pool.query(
    `SELECT p.id, p.sku, p.name, p.category, p.gender, p.badge,
            p.price::float8 AS price, p.compare_at::float8 AS compare_at,
            p.image_url, p.rating::float8 AS rating, p.review_count,
            COALESCE((SELECT SUM(i2.qty) FROM inventory i2
                      JOIN product_variants v2 ON v2.id = i2.variant_id
                      WHERE v2.product_id = p.id), 0)::int AS stock_total,
            a.garment_type, a.color_main, a.material, a.sleeve, a.length,
            a.neckline, a.pattern, a.occasion, a.season, a.style_notes,
            ${sim} AS similitud
     FROM product_embeddings e
     JOIN products p ON p.id = e.product_id
     LEFT JOIN product_ai_attrs a ON a.product_id = p.id
     WHERE ${where.join(' AND ')}
     ORDER BY ${sim} DESC
     LIMIT ${Math.max(1, Math.min(100, Number(k) || 20))}`,
    params,
  );
  return rows;
}

/** Atajo: buscar por texto libre. */
export async function buscarPorTexto(consulta, opts = {}) {
  const [vec] = await embedText([consulta]);
  return buscarPorVector(vec, opts);
}

/** Atajo: buscar por imagen (base64). */
export async function buscarPorImagen(b64, opts = {}) {
  const [vec] = await embedImage([b64]);
  return buscarPorVector(vec, { ...opts, espacio: opts.espacio || 'image' });
}

/** Cuántos productos tienen ya vector generado (para el informe de cobertura). */
export async function coberturaEmbeddings() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM products WHERE is_active)::int AS activos,
      (SELECT COUNT(*) FROM product_embeddings)::int AS con_vector,
      (SELECT COUNT(*) FROM product_embeddings WHERE image_vec IS NOT NULL)::int AS con_imagen,
      (SELECT COUNT(*) FROM product_ai_attrs)::int AS con_metadatos
  `);
  return rows[0];
}
