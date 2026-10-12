// =====================================================================
// IA #11 · PROBADOR VIRTUAL — vista previa "¿cómo me quedaría?"
// Motor de imagen: Cloudflare Workers AI · FLUX.1-schnell
//   POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/black-forest-labs/flux-1-schnell
//   Free tier: 10.000 Neurons/día (≈40 imágenes 1024px). Reset 00:00 UTC.
// Credenciales: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (.env)
// Pipeline: la foto del cliente se describe con el LLM de visión
//   (mismo motor de visión del estilista) y esa descripción + la prenda
//   recomendada se convierten en el prompt de FLUX.
//
// MEJORAS 2026-10:
//   - Prompt de descripción más detallado y estructurado
//   - Reintentos con backoff exponencial para la descripción
//   - Descripción fallback más específica y personalizable
//   - Métricas de latencia y engine en la respuesta
// =====================================================================
import { config } from '../config.js';
import { llmProvider, callChat } from './llm-provider.js';

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const MAX_PROMPT = 2000; // límite del modelo: 2048

export function imagegenStatus() {
  const ok = Boolean(config.cloudflareAccountId && config.cloudflareApiToken);
  return { ok, model: 'FLUX.1-schnell', provider: 'cloudflare-workers-ai' };
}

/** POST /ai/run con reintentos (patrón de services/llm.js). Devuelve base64 JPEG. */
async function runFlux(prompt, { timeoutMs = 60_000, attempts = 2 } = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${config.cloudflareAccountId}/ai/run/${MODEL}`;
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.cloudflareApiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.slice(0, MAX_PROMPT), steps: 4 }),
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => null);
      const b64 = body?.result?.image;
      if (res.ok && body?.success && b64) return b64;
      const msg = body?.errors?.[0]?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(`[imagegen] intento ${i} falló (${err.message}), reintentando…`);
        await new Promise((r) => setTimeout(r, 1_500 * i));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Describe la foto del cliente con el LLM de visión (OpenRouter).
 * Devuelve { text, engine, confidence } — engine: 'vision' | 'generic'.
 * Si el LLM no está disponible, cae a una descripción genérica (patrón llm→local)
 * para que el try-on siga funcionando.
 */
const GENERIC_DESCRIPTION = 'young adult person standing in a relaxed natural pose, casual posture, neutral expression, plain light studio background';

/**
 * Prompt mejorado para descripción de la foto.
 * Solicita descripción detallada y estructurada para mejor resultado en FLUX.
 */
const DESCRIPTION_PROMPT = `Describe in English, neutrally and with precise visual detail (max 100 words), the physical appearance visible in this photo for an image-generation prompt. Include ALL of these aspects:

1. BODY BUILD: body shape/physique (slim, athletic, curvy, average, etc.) and posture/stance
2. HAIR: length, color, style/texture (straight, wavy, curly, tied up, etc.)
3. SKIN TONE: general description (fair, medium, olive, tan, darker skin, etc.)
4. CLOTHING CURRENTLY WORN: describe what's visible in general terms (type of garment, color, style) - do NOT name brands
5. FACE FEATURES: general facial characteristics (face shape, features visible) - do NOT identify the person
6. POSE: how they're standing/positioned
7. BACKGROUND: what's behind them

IMPORTANT: 
- Do NOT guess or include identity, name, age, or any personal information
- Be specific and descriptive - more detail produces better try-on results
- Output plain English text only, no markdown, no JSON
- If something is not visible, skip it rather than guessing`;

export async function describePhotoForTryOn(dataUrl) {
  const provider = llmProvider();
  if (!provider) {
    console.warn('[imagegen] sin proveedor LLM, usando descripción genérica');
    return { text: GENERIC_DESCRIPTION, engine: 'generic', confidence: 0.3 };
  }

  // Reintentos con backoff exponencial para la descripción
  const retryDelays = [1000, 2000, 4000];
  let lastResult = null;
  
  for (let i = 0; i <= retryDelays.length; i++) {
    if (i > 0) {
      console.warn(`[imagegen] reintento ${i} después de ${retryDelays[i-1]}ms…`);
      await new Promise(r => setTimeout(r, retryDelays[i-1]));
    }
    
    const { ok, status, body, networkError } = await callChat(provider, {
      model: provider.visionModel || provider.model,
      max_tokens: 400, // Más tokens para descripción más detallada
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: DESCRIPTION_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
    }, { timeoutMs: 45_000, attempts: 1, tag: 'imagegen' });
    
    if (ok && body?.choices?.[0]?.message?.content) {
      lastResult = { ok: true, text: body.choices[0].message.content, networkError: null };
      break;
    }
    lastResult = { ok: false, text: null, networkError };
  }
  
  if (!lastResult || !lastResult.ok || !lastResult.text) {
    console.warn(`[imagegen] descripción con ${provider.label} no disponible (${lastResult?.networkError || `HTTP ${status}`}); uso descripción genérica`);
    return { text: GENERIC_DESCRIPTION, engine: 'generic', confidence: 0.3 };
  }
  
  // Limpiar y truncar la descripción
  const text = String(lastResult.text)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
  
  return { 
    text, 
    engine: 'vision', 
    confidence: 0.8,
    providerName: provider.name,
    model: provider.visionModel || provider.model,
  };
}

/**
 * Prompt del try-on: misma persona descrita + prenda recomendada de VivaModa.
 * Construye un prompt optimizado para FLUX.1-schnell.
 */
function buildTryOnPrompt(description, garment, photoDetails) {
  const g = [garment.name, garment.category, garment.description]
    .filter(Boolean).join(' — ').slice(0, 300);
  
  // Construir prompt completo con descripción detallada
  const prompt = [
    'Professional fashion e-commerce photograph, full body shot',
    'of a person modeling this garment:',
    g + '.',
    '',
    'PERSON DESCRIPTION (preserve exactly):',
    photoDetails || description,
    '',
    'CONSISTENCY REQUIREMENTS:',
    '- Preserve exactly the same face features, hairstyle, skin tone and body shape',
    '- Keep similar pose and positioning',
    '- Same lighting quality and direction',
    '- Plain light studio background (white/light gray)',
    '',
    'PHOTOGRAPHY STYLE:',
    '- Realistic e-commerce virtual try-on photo',
    '- Soft professional studio lighting, well-lit',
    '- High detail, sharp focus on garment',
    '- Fashion catalog quality',
    '- Natural skin texture, realistic fabric texture',
  ].join('\n');
  
  return prompt.slice(0, MAX_PROMPT);
}

/**
 * Genera la vista previa del try-on.
 * @param {{photoDescription: string, garment: {name, category, description?}}} p
 * @returns {{ok: true, image: string, latencyMs: number, engine: string, descEngine?: string} | {ok: false, error: string}}
 */
export async function generateTryOnImage({ photoDescription, garment }) {
  const t0 = Date.now();
  try {
    if (!config.cloudflareAccountId || !config.cloudflareApiToken) {
      return { 
        ok: false, 
        error: 'Probador no configurado: faltan CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN' 
      };
    }
    
    const b64 = await runFlux(buildTryOnPrompt(photoDescription, garment));
    return { 
      ok: true, 
      image: `data:image/jpeg;base64,${b64}`, 
      latencyMs: Date.now() - t0,
      engine: 'FLUX.1-schnell',
    };
  } catch (err) {
    const msg = /429|rate|quota|limit/i.test(err.message)
      ? 'Se alcanzó el límite diario del tier gratuito de Workers AI (reinicia a las 00:00 UTC)'
      : `No se pudo generar la imagen: ${err.message}`;
    console.warn('[imagegen] error generando try-on:', msg);
    return { ok: false, error: msg };
  }
}
