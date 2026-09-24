// =====================================================================
// LLM via OpenRouter (API compatible con OpenAI)
// Docs: https://openrouter.ai/docs
// Devuelve { text, model, latencyMs, error } — si `error` está presente,
// el llamador debe usar el motor local de reglas como respaldo.
// =====================================================================
import { config } from '../config.js';

const SYSTEM_PROMPT = `Eres "Aria", la estilista virtual de VivaModa, una marca de moda premium omnicanal (tienda web, POS en tienda y almacén).

REGLAS:
1. Respondes SIEMPRE en español, tono cálido, cercano y profesional, con un toque fashion-editorial.
2. Máximo 90 palabras. Los clientes navegan desde el chat del sitio.
3. Formato: usa **negritas** para resaltar prendas o conceptos clave (el frontend renderiza Markdown).
4. La marca usa dólares estadounidenses (USD): formatea precios como $89.99 (dos decimales).
5. NUNCA inventes productos. Si necesitas recomendar prendas, usa SOLO las que aparecen en CONTEXTO y cita su nombre exacto. Si no hay contexto útil, ofrece buscar por evento, color o presupuesto.
6. Si preguntan por tallas, apóyate en la calculadora de tallas de VivaModa (busto ≤84=XS, ≤90=S, ≤96=M, ≤102=L, >102=XL; si el peso supera 80 kg sube una talla). Invita al cliente a usar la calculadora exacta.
7. Envíos: express 24-48 h gratis en compras > $49.99; retiro en tienda en 2 horas; devoluciones/cambios sin costo durante 30 días naturales.
8. Cierra con una pregunta breve que invite a seguir (talla, calzado, accesorios u otra ocasión).
9. No uses emojis salvo máximo un ✨`;

function authHeaders() {
  return {
    Authorization: `Bearer ${config.openrouterApiKey}`,
    'Content-Type': 'application/json',
    // Headers recomendados por OpenRouter (opcional pero buena práctica)
    'HTTP-Referer': 'http://localhost:3000',
    'X-Title': 'VivaModa Aria',
  };
}

async function postChatCompletion(payload, timeoutMs = 45_000, attempts = 2) {
  // Reintenta ante fallos de red transitorios (fetch failed / ECONNRESET / timeout)
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: authHeaders(),
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
        console.warn(`[llm] intento ${i} falló (${err.cause?.code || err.message}), reintentando…`);
        await new Promise((r) => setTimeout(r, 1_000 * i));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** ¿Hay key configurada? (sin llamadas de red) */
export function llmAvailable() {
  return Boolean(config.openrouterApiKey);
}

/** Estado del LLM para el panel/métricas: prueba la API con un ping mínimo. */
export async function llmStatus() {
  if (!llmAvailable()) {
    return { ok: false, provider: 'local', reason: 'Sin OPENROUTER_API_KEY configurada' };
  }
  try {
    const started = Date.now();
    const { ok, status, body } = await postChatCompletion({
      model: config.openrouterModel,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    }, 12_000);
    if (!ok) {
      const reason = body?.error?.message || `HTTP ${status}`;
      return { ok: false, provider: 'openrouter', reason, httpStatus: status };
    }
    return {
      ok: true,
      provider: 'openrouter',
      model: config.openrouterModel,
      latencyMs: Date.now() - started,
      credits: body?.usage ? { prompt: body.usage.prompt_tokens, completion: body.usage.completion_tokens } : null,
    };
  } catch (err) {
    return { ok: false, provider: 'openrouter', reason: err.name === 'AbortError' ? 'Timeout' : err.message };
  }
}

/**
 * Genera la respuesta del estilista con el LLM.
 * ctx: { message, history:[{role,content}], intent, catalogText, anchorProduct, sizeHint }
 */
export async function llmStylistReply(ctx) {
  if (!llmAvailable()) return { error: 'LLM no configurado' };
  const started = Date.now();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Historial reciente (máx 6 turnos) para dar coherencia conversacional
  for (const h of (ctx.history || []).slice(-6)) {
    if (h?.role && h?.content && ['user', 'assistant'].includes(h.role)) {
      messages.push({ role: h.role, content: String(h.content).slice(0, 500) });
    }
  }

  const contextParts = [
    `Intención detectada: ${ctx.intent}`,
  ];
  if (ctx.sizeHint) contextParts.push(`Talla calculada por el motor biométrico: ${ctx.sizeHint}`);
  if (ctx.anchorProduct) {
    contextParts.push(`Producto que el cliente está viendo: ${ctx.anchorProduct.name} (${ctx.anchorProduct.category}, ${ctx.anchorProduct.gender})`);
  }
  if (ctx.catalogText) {
    contextParts.push(`CONTEXTO — prendas disponibles del catálogo real (usa solo estos nombres exactos si recomiendas):\n${ctx.catalogText}`);
  }
  messages.push({ role: 'system', content: contextParts.join('\n') });
  messages.push({ role: 'user', content: ctx.message });

  try {
    const { ok, status, body } = await postChatCompletion({
      model: config.openrouterModel,
      messages,
      max_tokens: 300,
      temperature: 0.7,
    }, 60_000);
    if (!ok) {
      const reason = body?.error?.message || `HTTP ${status}`;
      console.error('[llm] OpenRouter respondió error:', reason);
      return { error: reason, httpStatus: status };
    }
    const text = body?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error('[llm] respuesta vacía de OpenRouter');
      return { error: 'Respuesta vacía del LLM' };
    }
    return {
      text,
      model: config.openrouterModel,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'Timeout esperando al LLM' : err.message;
    console.error('[llm] fallo llamando a OpenRouter:', reason);
    return { error: reason };
  }
}
