#!/usr/bin/env node
/* =====================================================================
   VALIDACIÓN DE LA FASE 1
   Mide los criterios de aceptación de la orden contra la API en vivo.

     node ai/validar_fase1.mjs [--base http://localhost:3001] [--visual N]

   Criterios comprobados:
     · Precisión RAG  → % de productos recomendados que existen en el catálogo
     · Latencia chat  → p50 y p95
     · Búsqueda visual→ % de consultas con una prenda similar en el top-3
     · Latencia visual→ p50 y p95
     · Cobertura      → SKUs con embedding generado
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const IMGDIR = path.join(ROOT, '..', 'public', 'img', 'ext');
const BASE = (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1] || 'http://localhost:3001';
const N_VISUAL = Number((process.argv.find((a) => a.startsWith('--visual=')) || '').split('=')[1] || 25);

const CONSULTAS = [
  '¿Qué me pongo para una boda en la playa?',
  'outfit casual para la oficina',
  'vestido para Nochevieja',
  'look playero para hombre',
  'algo elegante para una cena de noche',
  'necesito una blusa para el trabajo por menos de 40 dólares',
  'busco un bolso para una boda',
  'ropa deportiva para entrenar',
  'un conjunto para una entrevista de trabajo',
  'qué me pongo para una fiesta de cumpleaños en tonos fríos',
];

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

async function jpost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

// ── 1) Cobertura ─────────────────────────────────────────────────────
const est = await fetch(`${BASE}/api/ai/embeddings/status`).then((r) => r.json());
const cob = est.cobertura || {};
const coberturaPct = cob.activos ? (cob.con_vector / cob.activos) * 100 : 0;

console.log('\n═══ COBERTURA DEL CATÁLOGO ═══');
console.log(`  sidecar        : ${est.sidecar?.ok ? 'OK' : 'CAÍDO'} · ${est.sidecar?.model} · ${est.sidecar?.device}`);
console.log(`  SKUs activos   : ${cob.activos}`);
console.log(`  con embedding  : ${cob.con_vector} (${coberturaPct.toFixed(1)} %)  [criterio ≥ 95 %]`);
console.log(`  con vector img : ${cob.con_imagen}`);
console.log(`  con metadatos  : ${cob.con_metadatos}`);

// ── 2) Chat RAG ──────────────────────────────────────────────────────
console.log('\n═══ ASISTENTE RAG ═══');
const latChat = [];
let citadosTotal = 0;
let inventadosTotal = 0;
let consultasOk = 0;
const detalleChat = [];

for (const q of CONSULTAS) {
  const t0 = Date.now();
  const { status, data } = await jpost(`${BASE}/api/ai/style-chat`, { message: q });
  const ms = Date.now() - t0;
  if (status !== 200) {
    console.log(`  ✗ ${q}\n      HTTP ${status}: ${data.error}`);
    detalleChat.push({ q, error: data.error });
    continue;
  }
  latChat.push(ms);
  const g = data.grounding || {};
  citadosTotal += g.totalCitados || 0;
  inventadosTotal += (g.inventados || []).length;
  if (g.groundingOk) consultasOk++;
  detalleChat.push({
    q, ms, plan: data.plan, planSource: data.plan_source, relajado: data.filters_relaxed,
    productos: (data.products || []).map((p) => p.name),
    citados: g.citados || [], inventados: g.inventados || [],
    reply: data.reply,
  });
  console.log(`  ${g.groundingOk ? '✓' : '✗'} ${String(ms).padStart(5)} ms · ${data.plan_source} · ${(data.products || []).length} prod · citados ${g.totalCitados} · inventados ${(g.inventados || []).length}`);
  console.log(`      ${q}`);
}

const precisionRAG = citadosTotal ? ((citadosTotal) / (citadosTotal + inventadosTotal)) * 100 : 0;
console.log(`\n  Precisión (productos citados que existen): ${precisionRAG.toFixed(1)} %  [criterio 100 %]`);
console.log(`  Consultas sin invenciones: ${consultasOk}/${CONSULTAS.length}`);
console.log(`  Latencia chat p50: ${pct(latChat, 50)} ms · p95: ${pct(latChat, 95)} ms  [criterio p95 < 3000 ms]`);

// ── 3) Búsqueda visual ───────────────────────────────────────────────
console.log('\n═══ BÚSQUEDA VISUAL ═══');
const archivos = fs.readdirSync(IMGDIR).filter((f) => /-1\.(jpg|jpeg|png|webp)$/i.test(f));
const muestra = [];
const vistos = new Set();
for (const f of archivos.sort()) {
  const sku = f.replace(/-1\.[a-z]+$/i, '');
  if (vistos.has(sku)) continue;
  vistos.add(sku);
  muestra.push({ sku, file: path.join(IMGDIR, f) });
  if (muestra.length >= N_VISUAL * 2) break;
}

const latVisual = [];
let hitsTop3 = 0;
let probados = 0;
let evaluados = 0;
let sinReferencia = 0;
const detalleVisual = [];

for (const m of muestra) {
  if (probados >= N_VISUAL) break;
  const b64 = fs.readFileSync(m.file).toString('base64');
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/ai/visual-search?k=6`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: b64 }),
  });
  const ms = Date.now() - t0;
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.results) { console.log(`  ✗ ${m.sku}: ${data.error}`); continue; }
  probados++;
  latVisual.push(ms);

  // Se excluye la propia prenda. La referencia de "visualmente similar" es el
  // tipo de prenda que identificó la visión; si la imagen no tiene tipo claro
  // ("no aplica") el caso NO se evalúa, porque dos desconocidos que coinciden
  // no demuestran nada. Así la métrica no se infla sola.
  const otros = data.results.filter((x) => x.sku !== m.sku);
  const propia = data.results.find((x) => x.sku === m.sku);
  const tipo = propia?.garment;
  const top3 = otros.slice(0, 3);

  if (!tipo || tipo === 'no aplica') {
    sinReferencia++;
    detalleVisual.push({ sku: m.sku, tipo: tipo || null, evaluado: false });
    continue;
  }
  const hit = top3.some((x) => x.garment === tipo);
  if (hit) hitsTop3++;
  evaluados++;
  detalleVisual.push({ sku: m.sku, tipo, evaluado: true, hit, top3: top3.map((x) => `${x.name} (${x.garment}, ${x.similarity})`) });
  console.log(`  ${hit ? '✓' : '✗'} ${String(ms).padStart(5)} ms · ${m.sku} · tipo=${tipo} · top3: ${top3.slice(0, 2).map((x) => x.garment).join(', ')}`);
}

const hitRate = evaluados ? (hitsTop3 / evaluados) * 100 : 0;
console.log(`\n  Casos con tipo de prenda identificable: ${evaluados} (de ${probados} probados; ${sinReferencia} sin tipo claro, no evaluables)`);
console.log(`  Acierto top-3 (misma familia visual): ${hitRate.toFixed(1)} %  [criterio ≥ 80 %]`);
console.log(`  Latencia visual p50: ${pct(latVisual, 50)} ms · p95: ${pct(latVisual, 95)} ms  [criterio p95 < 5000 ms]`);

// ── 4) Informe ───────────────────────────────────────────────────────
const informe = {
  generado: new Date().toISOString(),
  base: BASE,
  cobertura: { ...cob, porcentaje: Number(coberturaPct.toFixed(2)) },
  rag: {
    consultas: CONSULTAS.length,
    precision_pct: Number(precisionRAG.toFixed(2)),
    consultas_sin_invenciones: consultasOk,
    latencia_p50_ms: pct(latChat, 50),
    latencia_p95_ms: pct(latChat, 95),
    latencia_media_ms: Math.round(media(latChat)),
    detalle: detalleChat,
  },
  visual: {
    probadas: probados,
    evaluables: evaluados,
    sin_tipo_claro: sinReferencia,
    acierto_top3_pct: Number(hitRate.toFixed(2)),
    latencia_p50_ms: pct(latVisual, 50),
    latencia_p95_ms: pct(latVisual, 95),
    latencia_media_ms: Math.round(media(latVisual)),
    detalle: detalleVisual,
  },
  criterios: {
    precision_rag_100: precisionRAG >= 100,
    latencia_chat_p95_menor_3s: pct(latChat, 95) < 3000,
    visual_top3_80: hitRate >= 80 && evaluados >= 10,
    latencia_visual_p95_menor_5s: pct(latVisual, 95) < 5000,
    cobertura_95: coberturaPct >= 95,
  },
};
fs.writeFileSync(path.join(ROOT, 'informe-validacion.json'), JSON.stringify(informe, null, 2));
console.log('\n  → informe escrito en backend/ai/informe-validacion.json\n');
