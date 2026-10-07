#!/usr/bin/env node
/* Compara los tres espacios vectoriales (text / image / fused) para consultas
   de texto, y muestra si el filtro de ocasión ya funciona. */
import pg from 'pg';

const pool = new pg.Pool({ connectionString: 'postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda' });
const EMBED = 'http://127.0.0.1:8001';

const CONSULTAS = [
  'vestido elegante y fresco para una boda en la playa',
  'outfit formal para ir a la oficina',
  'vestido para una fiesta de noche',
];

async function vector(t) {
  const r = await fetch(`${EMBED}/embed/text`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: [t] }),
  });
  return (await r.json()).vectors[0];
}

const vec = (v) => `[${v.join(',')}]`;

async function top(espacio, v, k = 5, ocasion = null) {
  const col = { text: 'text_vec', image: 'image_vec', fused: 'fused_vec' }[espacio];
  const params = [vec(v)];
  let where = "p.is_active = TRUE AND p.visibility='store' AND EXISTS (SELECT 1 FROM product_variants v2 JOIN inventory i2 ON i2.variant_id=v2.id WHERE v2.product_id=p.id AND i2.qty>0)";
  if (ocasion) { params.push(ocasion); where += ` AND a.occasion && $${params.length}::text[]`; }
  const { rows } = await pool.query(
    `SELECT p.name, a.garment_type, a.color_main, p.price::float8 AS price,
            1 - (e.${col} <=> $1::vector) AS sim
     FROM product_embeddings e JOIN products p ON p.id=e.product_id
     LEFT JOIN product_ai_attrs a ON a.product_id=p.id
     WHERE e.${col} IS NOT NULL AND ${where}
     ORDER BY e.${col} <=> $1::vector LIMIT ${k}`, params);
  return rows;
}

for (const q of CONSULTAS) {
  const v = await vector(q);
  console.log('\n' + '═'.repeat(78));
  console.log('CONSULTA:', q);
  for (const esp of ['text', 'fused', 'image']) {
    const rows = await top(esp, v);
    console.log(`\n  [${esp}]`);
    for (const r of rows) console.log(`    ${r.sim.toFixed(3)}  ${String(r.garment_type).padEnd(12)} ${String(r.name).slice(0, 42)}`);
  }
  // con filtro de ocasión
  const rows = await top('text', v, 5, ['boda', 'playa']);
  console.log(`\n  [text + ocasión boda|playa] → ${rows.length} resultados`);
  for (const r of rows) console.log(`    ${r.sim.toFixed(3)}  ${String(r.garment_type).padEnd(12)} ${String(r.name).slice(0, 42)}`);
}

await pool.end();
