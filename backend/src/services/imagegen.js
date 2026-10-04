// =====================================================================
// IA #11 · PROBADOR VIRTUAL — vista previa "¿cómo me quedaría?"
// Motor de imagen: Cloudflare Workers AI · FLUX.1-schnell
//   POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/black-forest-labs/flux-1-schnell
//   Free tier: 10.000 Neurons/día (≈40 imágenes 1024px). Reset 00:00 UTC.
// Credenciales: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (.env)
// Pipeline: la foto del cliente se describe con el LLM de visión
//   (mismo motor de visión del estilista) y esa descripción + la prenda
//   recomendada se convierten en el prompt de FLUX.
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
 * Devuelve { text, engine } — engine: 'vision' | 'generic'. Si el LLM
 * no está disponible, cae a una descripción genérica (patrón llm→local)
 * para que el try-on siga funcionando.
 */
const GENERIC_DESCRIPTION = 'young adult person standing in a relaxed natural pose, casual posture, neutral expression, plain light studio background';

export async function describePhotoForTryOn(dataUrl) {
  const provider = llmProvider();
  if (!provider) return { text: GENERIC_DESCRIPTION, engine: 'generic' };
  const { ok, status, body, networkError } = await callChat(provider, {
    model: provider.visionModel || provider.model,
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe in English, neutrally and briefly (max 80 words), ONLY the physical appearance visible in this photo for an image-generation prompt: body build and posture, hair (length/color/style), skin tone, clothing currently worn (in general terms), pose and background. Do NOT guess or include identity, name, age, or any personal information. Output plain English text only.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  }, { timeoutMs: 45_000, attempts: 1, tag: 'imagegen' });
  const text = body?.choices?.[0]?.message?.content;
  if (!ok || !text) {
    console.warn(`[imagegen] descripción con ${provider.label} no disponible (${networkError || `HTTP ${status}`}); uso descripción genérica`);
    return { text: GENERIC_DESCRIPTION, engine: 'generic' };
  }
  return { text: String(text).replace(/\s+/g, ' ').trim().slice(0, 700), engine: 'vision' };
}

/** Prompt del try-on: misma persona descrita + prenda recomendada de VivaModa. */
function buildTryOnPrompt(description, garment) {
  const g = [garment.name, garment.category, garment.description]
    .filter(Boolean).join(' — ').slice(0, 300);
  return [
    'Full body fashion photograph of a person wearing this garment:',
    g + '.',
    'Preserve exactly the same face features, hairstyle, skin tone and body shape described.',
    'Keep the same pose and a plain light studio background.',
    'Realistic e-commerce virtual try-on photo, soft professional lighting, high detail.',
    'Person: ' + description,
  ].join(' ');
}

/**
 * Genera la vista previa del try-on.
 * @param {{photoDescription: string, garment: {name, category, description}}} p
 * @returns {{ok: true, image: string, latencyMs: number} | {ok: false, error: string}}
 */
export async function generateTryOnImage({ photoDescription, garment }) {
  const t0 = Date.now();
  try {
    if (!config.cloudflareAccountId || !config.cloudflareApiToken) {
      return { ok: false, error: 'Probador no configurado: faltan CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN' };
    }
    const b64 = await runFlux(buildTryOnPrompt(photoDescription, garment));
    return { ok: true, image: `data:image/jpeg;base64,${b64}`, latencyMs: Date.now() - t0 };
  } catch (err) {
    const msg = /429|rate|quota/i.test(err.message)
      ? 'Se alcanzó el límite diario del tier gratuito de Workers AI (reinicia a las 00:00 UTC)'
      : `No se pudo generar la imagen: ${err.message}`;
    return { ok: false, error: msg };
  }
}
