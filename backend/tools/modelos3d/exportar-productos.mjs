/**
 * Exporta el catálogo de la vitrina a `perfil.json`, el archivo que consume
 * el generador de modelos 3D (Blender).
 *
 *   cd backend && node tools/modelos3d/exportar-productos.mjs
 *   cd backend && node tools/modelos3d/exportar-productos.mjs --todos   (incluye ops/inactivos)
 *
 * Incluye solo lo que hace falta para modelar: categoría/género (forma),
 * nombre y composición (materiales), precio (proporciones) y el mismo color
 * `c3d` que pinta la tienda VR (mismo hash que core.js) para que el modelo
 * salga del color que ya usa la interfaz.
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(AQUI, '..', '..');

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(BACKEND, '.env'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL no está en el entorno ni en backend/.env');
  return line.slice('DATABASE_URL='.length).trim();
}

// Mismo hash y misma paleta que public/js/pages/vr-store/core.js
const PALETA_C3D = ['#e4006c', '#2f54d0', '#f0a832', '#4b41e1', '#2f9e73', '#d4af37', '#a02a5e', '#5b8dd6', '#e07a5f', '#6c5ce7', '#00b894', '#8e44ad'];
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const colorC3D = (category, name) => PALETA_C3D[hash(`${category || ''}|${name || ''}`) % PALETA_C3D.length];

// Por defecto solo la vitrina pública (`store` + activos), que es lo que la
// tienda VR puede mostrar. Con `--todos` (o MODELOS3D_TODOS=1) entra también el
// catálogo interno (`visibility='ops'`: POS/almacén) y los inactivos, para que
// ningún producto de la base se quede sin modelo identificable.
const TODOS = process.argv.includes('--todos') || process.env.MODELOS3D_TODOS === '1';

const pool = new pg.Pool({ connectionString: databaseUrl() });
const { rows } = await pool.query(`
  SELECT sku, name, gender, category, price, details->>'composition' AS composition, details->>'fitNote' AS fit
  FROM products
  WHERE ${TODOS ? 'TRUE' : "visibility = 'store' AND is_active"}
  ORDER BY category, sku
`);

const composicion = (raw) => {
  if (!raw) return [];
  try { return JSON.parse(raw).map((c) => `${c.pct || ''} ${c.name || ''}`.trim()).filter(Boolean); } catch { return []; }
};

const productos = rows.map((r) => ({
  sku: r.sku,
  nombre: r.name,
  genero: r.gender,
  categoria: r.category,
  precio: Number(r.price) || 0,
  color: colorC3D(r.category, r.name),
  composition: composicion(r.composition),
  fit: r.fit || '',
}));

const salida = path.join(AQUI, 'perfil.json');
fs.writeFileSync(salida, JSON.stringify({ generado: new Date().toISOString(), total: productos.length, incluye_no_vitrina: TODOS, productos }, null, 1));
await pool.end();

const porGenero = productos.reduce((m, p) => ({ ...m, [p.genero]: (m[p.genero] || 0) + 1 }), {});
console.log(`perfil.json · ${productos.length} productos · ${JSON.stringify(porGenero)}`);
console.log(`categorías: ${new Set(productos.map((p) => p.categoria)).size} · ejemplos: ${productos.slice(0, 3).map((p) => `${p.sku} (${p.categoria})`).join(', ')}`);
