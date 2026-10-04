// =====================================================================
// Proveedor LLM activo — API compatible con OpenAI, intercambiable por entorno.
//
// Prioridad de resolución:
//   1) LLM_BASE_URL + LLM_API_KEY  → cualquier API compatible (Groq, Cerebras,
//      Mistral, Ollama local, un proxy propio…)
//   2) LLM_PROVIDER                → proveedor forzado (gemini | openrouter);
//      si se fuerza uno sin llave, NO se cae a otro (error explícito)
//   3) GEMINI_API_KEY / GOOGLE_API_KEY → Gemini
//   4) OPENROUTER_API_KEY / OPENAI_API_KEY → OpenRouter
//   5) Sin nada → null (el llamador usa el motor local de reglas)
// =====================================================================
import { config } from '../config.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

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

const ORDER = ['gemini', 'openrouter'];

/**
 * Proveedor activo, o null si no hay ninguno configurado.
 * USE_LOCAL_AI=true fuerza el motor local de reglas aunque haya llaves.
 */
export function llmProvider() {
  if (config.useLocalAi) return null;
  const forced = String(config.llmProvider || '').trim().toLowerCase();
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
  if (forced) return KNOWN[forced] ? KNOWN[forced]() : null;
  for (const name of ORDER) {
    const provider = KNOWN[name]();
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
  return 'Sin proveedor LLM: configura GEMINI_API_KEY (o OPENROUTER_API_KEY)';
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
        body: JSON.stringify(payload),
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
  return {
    ok: false,
    status: 0,
    body: null,
    networkError: lastErr?.name === 'AbortError' ? 'Timeout esperando al LLM' : (lastErr?.message || 'Error de red'),
  };
}

/** Texto de error del proveedor, normalizado para logs y UI. */
export function chatErrorReason({ status, body, networkError }) {
  return networkError || body?.error?.message || body?.message || `HTTP ${status}`;
}
