// =====================================================================
// Proveedor LLM activo — API compatible con OpenAI, intercambiable por entorno.
//
// Prioridad de resolución:
//   1) LLM_BASE_URL + LLM_API_KEY  → cualquier API compatible (Groq, Cerebras,
//      Mistral, Ollama local, un proxy propio…)
//   2) LLM_PROVIDER                → proveedor forzado (gemini | deepseek | openrouter);
//      si se fuerza uno sin llave, NO se cae a otro (error explícito)
//   3) GEMINI_API_KEY / GOOGLE_API_KEY → Gemini
//   4) DEEPSEEK_API_KEY            → DeepSeek
//   5) OPENROUTER_API_KEY / OPENAI_API_KEY → OpenRouter
//   6) Sin nada → null (el llamador usa el motor local de reglas)
// =====================================================================
import { config } from '../config.js';
import { registrarUso, leerAjustes } from './ai-admin.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEEPSEEK_BASE = 'https://api.deepseek.com';

/** Proveedores conocidos; devuelve null si no tienen llave. */
const KNOWN = {
  gemini: () => (config.geminiApiKey ? {
    name: 'gemini',
    label: 'Gemini',
    keyVar: 'GEMINI_API_KEY',
    baseUrl: config.geminiBaseUrl || GEMINI_BASE,
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
    visionModel: config.geminiVisionModel,
    extraHeaders: {},
  } : null),
  deepseek: () => (config.deepseekApiKey ? {
    name: 'deepseek',
    label: 'DeepSeek',
    keyVar: 'DEEPSEEK_API_KEY',
    baseUrl: config.deepseekBaseUrl || DEEPSEEK_BASE,
    apiKey: config.deepseekApiKey,
    model: config.deepseekModel,
    // Solo deepseek-flash acepta imágenes; deepseek-v4-pro es solo texto.
    visionModel: config.deepseekVisionModel,
    extraHeaders: {},
    // DeepSeek V4 razona por defecto y esos tokens consumen el presupuesto de
    // `max_tokens` antes de escribir la respuesta: con topes bajos (300) el
    // `content` llega VACÍO y el chat caía en silencio al motor local.
    // Desactivar el razonamiento devuelve texto dentro del mismo presupuesto.
    extraBody: { thinking: { type: 'disabled' } },
  } : null),
  openrouter: () => (config.openrouterApiKey ? {
    name: 'openrouter',
    label: 'OpenRouter',
    keyVar: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: config.openrouterApiKey,
    model: config.openrouterModel,
    visionModel: config.openrouterVisionModel,
    extraHeaders: { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'VivaModa Aria' },
  } : null),
};

const ORDER = ['gemini', 'deepseek', 'openrouter'];

// ── Configuración editable desde el panel ────────────────────────────
// llmProvider() es SÍNCRONO y lo llaman muchos sitios, así que no se puede
// consultar la base de datos en cada llamada. Se mantiene una copia en memoria
// que se refresca de forma perezosa (como mucho cada 15 s, que es el TTL que
// ya aplica leerAjustes) y el respaldo sigue siendo backend/.env.
let _ajustes = {};
let _refrescando = false;

function refrescarAjustes() {
  if (_refrescando) return;
  _refrescando = true;
  leerAjustes()
    .then((a) => { _ajustes = a || {}; })
    .catch(() => { /* si la BD falla, se usa .env */ })
    .finally(() => { _refrescando = false; });
}

/** Ajustes en vigor (para mostrarlos en el panel y depurar). */
export function ajustesEnVigor() { return _ajustes; }

/**
 * Proveedor activo, o null si no hay ninguno configurado.
 * USE_LOCAL_AI=true fuerza el motor local de reglas aunque haya llaves.
 */
export function llmProvider() {
  refrescarAjustes();
  // El panel manda sobre el .env cuando hay valor
  const desdePanel = (v, env) => (v !== undefined && v !== null && String(v).trim() !== '' ? v : env);

  if (String(desdePanel(_ajustes.use_local_ai, String(config.useLocalAi))).toLowerCase() === 'true') return null;
  const forced = String(desdePanel(_ajustes.llm_provider, config.llmProvider) || '').trim().toLowerCase();
  if (config.llmBaseUrl && config.llmApiKey) {
    const model = config.llmModel || 'gpt-4o-mini';
    return {
      name: 'custom',
      label: 'API compatible',
      keyVar: 'LLM_API_KEY',
      baseUrl: String(config.llmBaseUrl).replace(/\/+$/, ''),
      apiKey: config.llmApiKey,
      model,
      visionModel: config.llmModel || model,
      extraHeaders: {},
    };
  }
  const modeloPanel = _ajustes.llm_model;
  const conModelo = (p) => (p && modeloPanel ? { ...p, model: String(modeloPanel) } : p);

  if (forced) return conModelo(KNOWN[forced] ? KNOWN[forced]() : null);
  for (const name of ORDER) {
    const provider = conModelo(KNOWN[name]());
    if (provider) return provider;
  }
  return null;
}

/** Motivo legible cuando no hay proveedor (para el chip "Motor local"). */
export function llmUnavailableReason() {
  if (config.useLocalAi) return 'USE_LOCAL_AI=true → motor local forzado';
  const forced = String(config.llmProvider || '').trim().toLowerCase();
  if (forced && KNOWN[forced]) return `LLM_PROVIDER=${forced} pero falta ${KNOWN[forced]()?.keyVar || 'su llave'}`;
  if (config.llmBaseUrl && !config.llmApiKey) return 'LLM_BASE_URL definido pero falta LLM_API_KEY';
  return 'Sin proveedor LLM: configura GEMINI_API_KEY, DEEPSEEK_API_KEY u OPENROUTER_API_KEY';
}

/**
 * POST {baseUrl}/chat/completions con reintentos ante fallos de red.
 * Devuelve { ok, status, body } — nunca lanza si agota los intentos: devuelve
 * { networkError } para que el llamador decida el respaldo.
 */
export async function callChat(provider, payload, { timeoutMs = 45_000, attempts = 2, tag = 'llm' } = {}) {
  const url = `${provider.baseUrl}/chat/completions`;
  let lastErr = null;
  for (let i = 1; i <= Math.max(1, attempts); i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
          ...(provider.extraHeaders || {}),
        },
        body: JSON.stringify({ ...(provider.extraBody || {}), ...payload }),
        signal: ctrl.signal,
      });
      const raw = await res.text();
      let body = {};
      try { body = JSON.parse(raw); } catch { /* respuesta no-JSON (proxy/intermitente) */ }
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(`[${tag}] intento ${i} falló (${err.cause?.code || err.message}), reintentando…`);
        await new Promise((r) => setTimeout(r, 1_000 * i));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  const motivo = lastErr?.name === 'AbortError' ? 'Timeout esperando al LLM' : (lastErr?.message || 'Error de red');
  registrarUso({ tag, provider: provider.name, model: provider.model, ok: false, error: motivo, latencyMs: null });
  return { ok: false, status: 0, body: null, networkError: motivo };
}

/** Texto de error del proveedor, normalizado para logs y UI. */
export function chatErrorReason({ status, body, networkError }) {
  return networkError || body?.error?.message || body?.message || `HTTP ${status}`;
}

// =====================================================================
// Consumo y costo — tarifas oficiales de DeepSeek Flash en USD por 1M tokens.
// Fuente: https://api-docs.deepseek.com/quick_start/pricing/
// Las horas pico (01:00-04:00 y 06:00-10:00 UTC, de lunes a viernes) cuestan
// el doble que las valle; sábados, domingos y festivos son valle todo el día.
// =====================================================================
const PRICES = {
  deepseek: {
    peak: { inputHit: 0.006, inputMiss: 0.30, output: 1.20 },
    offPeak: { inputHit: 0.003, inputMiss: 0.15, output: 0.60 },
  },
};

/** ¿Estamos en horario pico de DeepSeek? (UTC, L-V) */
export function isPeakHour(date = new Date()) {
  const day = date.getUTCDay(); // 0=domingo, 6=sábado
  if (day === 0 || day === 6) return false;
  const hour = date.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/**
 * Costo estimado en USD de una respuesta, o null si el proveedor no tiene
 * tarifas cargadas. Usa el desglose cache-hit/cache-miss cuando el proveedor
 * lo devuelve, que es lo que realmente factura DeepSeek.
 */
export function estimateCost(providerName, usage, date = new Date()) {
  const table = PRICES[providerName];
  if (!table || !usage) return null;
  const rate = isPeakHour(date) ? table.peak : table.offPeak;
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? Math.max(0, (usage.prompt_tokens || 0) - hit);
  const out = usage.completion_tokens || 0;
  return (hit * rate.inputHit + miss * rate.inputMiss + out * rate.output) / 1_000_000;
}

/** Una línea de log por respuesta: tokens, caché, costo y tarifa aplicada. */
export function logUsage(tag, provider, usage, latencyMs) {
  if (!usage) return;
  const cost = estimateCost(provider.name, usage);
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? Math.max(0, (usage.prompt_tokens || 0) - hit);
  const rate = cost === null ? '' : ` · tarifa ${isPeakHour() ? 'PICO' : 'valle'}`;
  const money = cost === null ? 'sin tarifas' : `$${cost.toFixed(5)}`;
  console.log(
    `[${tag}] ${provider.label} · entrada ${usage.prompt_tokens} (caché ${hit}/${hit + miss})` +
    ` · salida ${usage.completion_tokens} · total ${usage.total_tokens}` +
    ` · ${money}${rate} · ${Math.round(latencyMs)}ms`
  );
  // Telemetría persistida: sin esto no hay histórico de rendimiento que
  // mostrar en el panel (antes sólo se imprimía en consola).
  registrarUso({
    tag, provider: provider.name, model: provider.model, usage,
    latencyMs, costUsd: cost, ok: true,
  });
}
