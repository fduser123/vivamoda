// =====================================================================
// ADMINISTRACIÓN DE LA IA (Fase 5)
//
// Tres cosas que antes no existían:
//   1) TELEMETRÍA. Hasta ahora el consumo de cada llamada al LLM se imprimía
//      en consola y se devolvía en la respuesta, pero no se guardaba: sin
//      histórico no puede haber métricas de rendimiento.
//   2) CONFIGURACIÓN editable desde el panel. Antes vivía sólo en .env, así
//      que cambiar de modelo obligaba a editar el archivo y reiniciar.
//   3) CONOCIMIENTO Y REGLAS DE NEGOCIO. Estaban hardcodeadas en el
//      SYSTEM_PROMPT de services/llm.js.
//
// Las inserciones de telemetría son "fire and forget": si fallan, la respuesta
// al cliente NO debe romperse por no poder registrar una métrica.
// =====================================================================
import { pool } from '../db.js';

// ── 1) Telemetría ────────────────────────────────────────────────────
/** Guarda una llamada al LLM. Nunca lanza: la métrica no puede tumbar la IA. */
export function registrarUso({ tag, provider, model, usage, latencyMs, costUsd, ok = true, error = null }) {
  const u = usage || {};
  const hit = u.prompt_cache_hit_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? null;
  pool.query(
    `INSERT INTO ai_usage (tag, provider, model, prompt_tokens, completion_tokens,
                           cache_hit, cache_miss, cost_usd, latency_ms, ok, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [tag || null, provider || null, model || null,
     u.prompt_tokens ?? null, u.completion_tokens ?? null,
     hit, miss, costUsd ?? null,
     latencyMs != null ? Math.round(latencyMs) : null, ok, error],
  ).catch((e) => console.warn('[ai-usage] no se pudo registrar la métrica:', e.message));
}

/** Resumen para el panel: totales, latencias y desglose. */
export async function metricasIA({ dias = 30 } = {}) {
  const { rows: [tot] } = await pool.query(`
    SELECT COUNT(*)::int AS llamadas,
           COUNT(*) FILTER (WHERE NOT ok)::int AS errores,
           COALESCE(SUM(prompt_tokens),0)::bigint AS tokens_entrada,
           COALESCE(SUM(completion_tokens),0)::bigint AS tokens_salida,
           COALESCE(SUM(cache_hit),0)::bigint AS cache_hit,
           COALESCE(SUM(cache_miss),0)::bigint AS cache_miss,
           COALESCE(SUM(cost_usd),0)::float AS coste,
           ROUND(AVG(latency_ms))::int AS latencia_media,
           ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms))::int AS p50,
           ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95,
           COUNT(DISTINCT model)::int AS modelos
    FROM ai_usage WHERE created_at >= now() - ($1 || ' days')::interval
  `, [dias]);

  const { rows: porTag } = await pool.query(`
    SELECT COALESCE(tag,'(sin etiqueta)') AS tag, COUNT(*)::int AS llamadas,
           COALESCE(SUM(cost_usd),0)::float AS coste,
           ROUND(AVG(latency_ms))::int AS latencia_media,
           ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95,
           COUNT(*) FILTER (WHERE NOT ok)::int AS errores
    FROM ai_usage WHERE created_at >= now() - ($1 || ' days')::interval
    GROUP BY 1 ORDER BY llamadas DESC
  `, [dias]);

  const { rows: porModelo } = await pool.query(`
    SELECT COALESCE(provider,'?') AS provider, COALESCE(model,'?') AS model,
           COUNT(*)::int AS llamadas, COALESCE(SUM(cost_usd),0)::float AS coste,
           COALESCE(SUM(prompt_tokens+completion_tokens),0)::bigint AS tokens
    FROM ai_usage WHERE created_at >= now() - ($1 || ' days')::interval
    GROUP BY 1,2 ORDER BY llamadas DESC
  `, [dias]);

  const { rows: porDia } = await pool.query(`
    SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') AS dia,
           COUNT(*)::int AS llamadas, COALESCE(SUM(cost_usd),0)::float AS coste,
           ROUND(AVG(latency_ms))::int AS latencia
    FROM ai_usage WHERE created_at >= now() - ($1 || ' days')::interval
    GROUP BY 1 ORDER BY 1
  `, [dias]);

  const { rows: errores } = await pool.query(`
    SELECT COALESCE(error,'(sin detalle)') AS error, COUNT(*)::int AS veces, MAX(created_at) AS ultima
    FROM ai_usage WHERE NOT ok AND created_at >= now() - ($1 || ' days')::interval
    GROUP BY 1 ORDER BY veces DESC LIMIT 10
  `, [dias]);

  const cachePct = (tot.cache_hit + (tot.cache_miss || 0)) > 0
    ? (tot.cache_hit / (tot.cache_hit + tot.cache_miss) * 100) : 0;

  return {
    dias, total: { ...tot, tasa_error_pct: tot.llamadas ? (tot.errores / tot.llamadas * 100) : 0, cache_pct: cachePct },
    por_tag: porTag, por_modelo: porModelo, por_dia: porDia, errores,
  };
}

// ── 2) Configuración ─────────────────────────────────────────────────
// Se cachea unos segundos porque se consulta en cada llamada al LLM.
const AJUSTES_DEFECTO = {
  llm_model: '', llm_provider: '', temperature: '0.7',
  max_tokens_chat: '1200', use_local_ai: 'false', rag_top_k: '20', rag_top_n: '5',
};
let cacheAjustes = null, cacheCuando = 0;
const TTL_AJUSTES = 15_000;

/** Ajustes efectivos. Respaldo: backend/.env (vía config.js). */
export async function leerAjustes({ forzar = false } = {}) {
  if (!forzar && cacheAjustes && Date.now() - cacheCuando < TTL_AJUSTES) return cacheAjustes;
  try {
    const { rows } = await pool.query('SELECT key, value FROM ai_settings');
    const deBD = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    cacheAjustes = { ...AJUSTES_DEFECTO, ...deBD };
  } catch {
    cacheAjustes = { ...AJUSTES_DEFECTO };
  }
  cacheCuando = Date.now();
  return cacheAjustes;
}

export async function guardarAjustes(cambios = {}) {
  const permitidas = Object.keys(AJUSTES_DEFECTO);
  const entradas = Object.entries(cambios).filter(([k]) => permitidas.includes(k));
  for (const [k, v] of entradas) {
    await pool.query(
      `INSERT INTO ai_settings (key, value, updated_at) VALUES ($1,$2,NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [k, String(v)]);
  }
  await leerAjustes({ forzar: true });
  return cacheAjustes;
}

// ── 3) Conocimiento y reglas ─────────────────────────────────────────
export const CATEGORIAS = ['regla', 'politica', 'tono', 'faq', 'producto', 'operacion'];

export async function listarConocimiento({ soloActivas = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id, category, title, content, active, priority, created_at, updated_at
     FROM ai_knowledge ${soloActivas ? 'WHERE active' : ''}
     ORDER BY category, priority, id`);
  return rows;
}

export async function crearConocimiento({ category, title, content, active = true, priority = 100 }) {
  const { rows: [r] } = await pool.query(
    `INSERT INTO ai_knowledge (category, title, content, active, priority)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [category, title, content, active, priority]);
  return r;
}

export async function actualizarConocimiento(id, campos = {}) {
  const map = { category: 'category', title: 'title', content: 'content', active: 'active', priority: 'priority' };
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(campos)) {
    if (!map[k]) continue;
    vals.push(v); sets.push(`${map[k]} = $${vals.length}`);
  }
  if (!sets.length) return null;
  vals.push(id);
  const { rows: [r] } = await pool.query(
    `UPDATE ai_knowledge SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $${vals.length} RETURNING *`, vals);
  await bloqueConocimiento({ forzar: true });
  return r || null;
}

export async function borrarConocimiento(id) {
  const { rowCount } = await pool.query('DELETE FROM ai_knowledge WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * Bloque de reglas que se inyecta en el prompt. Es el "conocimiento" que el
 * modelo recibe siempre. Se ordena por prioridad (menor número = antes).
 */
let _conoc = '', _conocCuando = 0;
/**
 * Versión cacheada: se llama en CADA mensaje del chat, así que no puede ir a
 * la base de datos cada vez. Se refresca cada 60 s (o al editar el panel).
 */
export async function bloqueConocimiento({ forzar = false } = {}) {
  if (!forzar && _conoc && Date.now() - _conocCuando < 60_000) return _conoc;
  _conoc = await _construirBloque();
  _conocCuando = Date.now();
  return _conoc;
}

async function _construirBloque() {
  const filas = await listarConocimiento({ soloActivas: true });
  if (!filas.length) return '';
  const porCat = {};
  for (const f of filas) (porCat[f.category] ||= []).push(f);
  const etiquetas = {
    regla: 'REGLAS DEL NEGOCIO', politica: 'POLÍTICAS VIGENTES', tono: 'TONO Y ESTILO',
    faq: 'PREGUNTAS FRECUENTES', producto: 'INFORMACIÓN DE PRODUCTO', operacion: 'OPERACIÓN',
  };
  return Object.entries(porCat).map(([cat, items]) =>
    `### ${etiquetas[cat] || cat.toUpperCase()}\n` +
    items.map((i) => `- ${i.title}: ${i.content}`).join('\n')
  ).join('\n\n');
}
