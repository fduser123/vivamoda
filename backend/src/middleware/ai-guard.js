// =====================================================================
// GUARDAS DE LA IA — rate limit por cliente y presupuesto diario de LLM.
//
// 1) RATE LIMIT (F0-03)
//    Ventana fija de 60 s en memoria, por usuario autenticado o por IP.
//    Los endpoints con imagen tienen un tope más bajo porque cuestan visión
//    o generación, no solo tokens de texto. Devuelve 429 con Retry-After.
//    LÍMITE CONOCIDO: al ser memoria de proceso, con varias réplicas cada una
//    lleva su propia cuenta. Para escalar hace falta Redis (F1/F2).
//
// 2) COST GUARD (F0-03)
//    Suma el coste real registrado en `ai_usage` durante el día y bloquea las
//    rutas que generan gasto cuando se agota AI_DAILY_BUDGET_USD. Si la base
//    no responde, la guarda falla abierta: un fallo de métricas no debe dejar
//    la tienda sin asistente.
// =====================================================================
import { pool } from '../db.js';
import { config } from '../config.js';

const WINDOW_MS = 60_000;

/** Rutas con coste alto (imagen/visión/generación). */
const HEAVY = /^\/(tryon|analyze-outfit|visual-search|style-match)\b/;
/** Rutas que gastan presupuesto de LLM (las de lectura no cuentan). */
const GENERATION = /^\/(chat|chat\/stream|tryon|analyze-outfit|style-match|style-chat|visual-search)\b/;

const buckets = new Map();
let nextSweep = 0;

function sweep(now) {
  if (now < nextSweep) return;
  nextSweep = now + WINDOW_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.reset <= now) buckets.delete(key);
  }
}

function clientKey(req) {
  if (req.user?.id) return `u:${req.user.id}`;
  const ip = req.ip || req.socket?.remoteAddress || 'anon';
  return `ip:${ip}`;
}

function consume(key, limit) {
  const now = Date.now();
  sweep(now);
  let bucket = buckets.get(key);
  if (!bucket || bucket.reset <= now) {
    bucket = { count: 0, reset: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetSec: Math.max(1, Math.ceil((bucket.reset - now) / 1000)),
  };
}

/** Middleware: limita peticiones/minuto a /api/ai. */
export function aiRateLimit(req, res, next) {
  const heavy = HEAVY.test(req.path);
  const configured = heavy ? config.aiImageRateLimitPerMin : config.aiRateLimitPerMin;
  const limit = Math.max(0, Math.round(Number(configured) || 0));
  if (!limit) return next(); // 0 = desactivado

  const result = consume(`${heavy ? 'h' : 'g'}|${clientKey(req)}`, limit);
  res.set({
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(result.resetSec),
  });
  if (result.allowed) return next();

  res.set('Retry-After', String(result.resetSec));
  return res.status(429).json({
    ok: false,
    error: heavy
      ? `Demasiadas imágenes en poco tiempo. Espera ${result.resetSec} s y vuelve a intentarlo.`
      : `Demasiadas solicitudes a la IA. Espera ${result.resetSec} s y vuelve a intentarlo.`,
    code: 'RATE_LIMITED',
    limit: result.limit,
    retryAfterSec: result.resetSec,
  });
}

// ── Presupuesto diario ───────────────────────────────────────────────
const COST_TTL_MS = 30_000;
let costCache = { at: 0, spent: 0, calls: 0, error: null };

/** Gasto de hoy (USD) según `ai_usage`. Cacheado 30 s. */
export async function aiDailySpend({ forzar = false } = {}) {
  if (!forzar && Date.now() - costCache.at < COST_TTL_MS) return costCache;
  try {
    const { rows } = await pool.query(`
      SELECT COALESCE(SUM(cost_usd), 0)::float8 AS spent,
             COUNT(*)::int AS calls
      FROM ai_usage
      WHERE created_at >= date_trunc('day', now())
    `);
    costCache = {
      at: Date.now(),
      spent: Number(rows[0]?.spent) || 0,
      calls: Number(rows[0]?.calls) || 0,
      error: null,
    };
  } catch (err) {
    // Sin tabla o sin base: se conserva el último valor y se falla abierto.
    costCache = { ...costCache, at: Date.now(), error: err.message };
  }
  return costCache;
}

/** Estado del presupuesto para el panel. */
export async function aiBudgetStatus() {
  const limitUsd = Number(config.aiDailyBudgetUsd);
  const enabled = Number.isFinite(limitUsd) && limitUsd > 0;
  const { spent, calls, error } = await aiDailySpend({ forzar: true });
  return {
    enabled,
    limitUsd: enabled ? limitUsd : null,
    spentUsd: Number(spent.toFixed(4)),
    remainingUsd: enabled ? Math.max(0, Number((limitUsd - spent).toFixed(4))) : null,
    callsToday: calls,
    window: 'día UTC (00:00)',
    error: error || null,
  };
}

/** Middleware: corta la generación cuando el gasto del día supera el tope. */
export async function aiBudgetGuard(req, res, next) {
  const limitUsd = Number(config.aiDailyBudgetUsd);
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) return next();
  if (!GENERATION.test(req.path)) return next();

  const { spent, error } = await aiDailySpend();
  if (error) return next(); // fail-open: la métrica no puede tumbar la IA

  if (spent >= limitUsd) {
    const reset = new Date();
    reset.setUTCHours(24, 0, 0, 0);
    const retryAfterSec = Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000));
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      ok: false,
      error: 'El presupuesto diario de IA está agotado. El asistente volverá a estar disponible mañana.',
      code: 'AI_BUDGET_EXCEEDED',
      limitUsd,
      spentUsd: Number(spent.toFixed(4)),
      retryAfterSec,
    });
  }
  return next();
}

/** Solo para pruebas: vacía las ventanas en memoria. */
export function _resetRateLimit() {
  buckets.clear();
  nextSweep = 0;
}
