// =====================================================================
// Traducción de nombres/descripciones de productos al español.
// Estrategia:
//  1) Si hay OPENROUTER_API_KEY (misma key del estilista IA), traduce con LLM
//     en lotes → devuelve null si falla (el llamador usa el fallback).
//  2) Fallback determinista: diccionario local + transliteración de marcas,
//     sin llamadas de red (siempre produce un resultado usable).
//
// Exporta:
//   translatorAvailable()            → ¿hay LLM configurado?
//   translateProducts(items)         → [{ name, description }] en español
//   localTranslateName(name)         → traducción offline de un nombre
// =====================================================================
import { config } from '../config.js';

// ---------------------------------------------------------------
// 1) Traducción con LLM (OpenRouter, misma key que el estilista)
// ---------------------------------------------------------------
export function translatorAvailable() {
  return Boolean(config.openrouterApiKey);
}

const TRANSLATE_PROMPT = `Eres un traductor del catálogo de VivaModa, marca de moda premium colombiana.
Traduce al español (es-CO, registro fashion-editorial) los nombres y descripciones de productos que llegan en JSON.

REGLAS:
1. Entrada: JSON { "items": [{ "name": "...", "description": "..." }, …] }.
2. Salida: SOLO JSON válido { "items": [{ "name": "...", "description": "..." }, …] } en el mismo orden y longitud. Sin markdown ni explicaciones.
3. Nombres: máximo 6 palabras, Elegante Capitalizado, sin comillas. Ej: "Black Women's Gown" → "Vestido de Gala Negro".
4. Descripciones: 1-2 frases naturales en español. Si la descripción llega vacía o null, devuelve "".
5. NO traduzcas marcas propias (Calvin Klein, Heshe,…): déjalas tal cual dentro del texto.
6. Términos de moda: usa "Vestido", "Camisa", "Blusa", "Bolso", "Reloj", "Zapatillas", "Tacones", "Gafas de Sol", "Collar", "Aretes", "Anillo".`;

async function postChatCompletion(payload, timeoutMs = 90_000, attempts = 2) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.openrouterApiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'VivaModa seed-external',
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const raw = await res.text();
      let body = {};
      try { body = JSON.parse(raw); } catch { /* respuesta no-JSON */ }
      return { ok: res.ok, status: res.status, body };
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        console.warn(`[translator] intento ${i} falló (${err.cause?.code || err.message}), reintentando…`);
        await new Promise((r) => setTimeout(r, 1_000 * i));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Traduce una tanda con LLM. Devuelve [{name, description}] o null si falla. */
async function llmTranslateBatch(batch) {
  try {
    const { ok, status, body } = await postChatCompletion({
      model: config.openrouterModel,
      messages: [
        { role: 'system', content: TRANSLATE_PROMPT },
        { role: 'user', content: JSON.stringify({ items: batch }) },
      ],
      max_tokens: 4000,
      temperature: 0.2,
    });
    if (!ok) {
      console.warn(`[translator] OpenRouter HTTP ${status}: ${body?.error?.message || 'error'} → uso fallback local`);
      return null;
    }
    const text = body?.choices?.[0]?.message?.content?.trim() || '';
    const jsonText = text.replace(/^```(?:json)?/m, '').replace(/```$/m, '').trim();
    let parsed;
    try { parsed = JSON.parse(jsonText); } catch {
      console.warn('[translator] respuesta no-JSON del LLM → uso fallback local');
      return null;
    }
    if (!Array.isArray(parsed?.items) || parsed.items.length !== batch.length) {
      console.warn('[translator] longitud de respuesta LLM ≠ entrada → uso fallback local');
      return null;
    }
    return parsed.items.map((it) => ({
      name: String(it?.name || '').trim() || null,
      description: String(it?.description ?? '').trim() || null,
    }));
  } catch (err) {
    console.warn(`[translator] LLM falló (${err.name === 'AbortError' ? 'timeout' : err.message}) → uso fallback local`);
    return null;
  }
}

/**
 * Traduce una lista de productos en lotes.
 * items: [{ name, description }] → devuelve [{ name, description }] traducidos.
 * Si un lote falla, sus elementos pasan por el fallback local.
 */
export async function translateProducts(items, { batchSize = 20 } = {}) {
  if (!items.length) return [];
  if (!translatorAvailable()) {
    console.log('[translator] sin OPENROUTER_API_KEY → traducción local (diccionario)');
    return items.map((it) => ({ name: localTranslateName(it.name, { dropUnknown: Boolean(it.dropUnknown) }), description: it.description }));
  }

  console.log(`[translator] traduciendo ${items.length} productos con ${config.openrouterModel} en lotes de ${batchSize}…`);
  const out = new Array(items.length);
  for (let start = 0; start < items.length; start += batchSize) {
    const slice = items.slice(start, start + batchSize);
    const batch = slice.map((it) => ({ name: it.name || '', description: it.description || '' }));
    const translated = await llmTranslateBatch(batch);
    slice.forEach((it, i) => {
      const t = translated?.[i];
      out[start + i] = {
        name: (t?.name && t.name !== it.name ? t.name : localTranslateName(it.name, { dropUnknown: Boolean(it.dropUnknown) })),
        description: (t?.description && t.description !== it.description ? t.description : it.description),
      };
    });
    console.log(`[translator] progreso: ${Math.min(start + batchSize, items.length)}/${items.length}`);
  }
  return out;
}

// ---------------------------------------------------------------
// 2) Fallback determinista (sin red)
// ---------------------------------------------------------------
const WORD_MAP = {
  // prendas
  gown: 'Vestido de Gala', dress: 'Vestido', sundress: 'Vestido de Verano',
  corset: 'Corset', skirt: 'Falda', blouse: 'Blusa', top: 'Top', shirt: 'Camisa', tshirt: 'Camiseta',
  't-shirt': 'Camiseta', polo: 'Camisa Polo', jacket: 'Chaqueta', blazer: 'Blazer', coat: 'Abrigo',
  trench: 'Trench', cardigan: 'Cardigan', sweater: 'Suéter', hoodie: 'Buzo', kimono: 'Kimono',
  jumpsuit: 'Enterizo', romper: 'Enterizo Corto', pants: 'Pantalones', trousers: 'Pantalones',
  jeans: 'Jeans', shorts: 'Shorts', leggings: 'Leggings', suit: 'Traje', vest: 'Chaleco',
  // calzado
  shoes: 'Zapatos', heel: 'Tacones', heels: 'Tacones', pumps: 'Zapatos de Tacón', sandals: 'Sandalias',
  sneakers: 'Zapatillas', boots: 'Botas', booties: 'Botines', loafers: 'Mocasines',
  slipper: 'Zapatillas de Casa', slippers: 'Zapatillas de Casa', flats: 'Bailarinas',
  wedges: 'Plataformas', wedge: 'Plataformas', mule: 'Mules', mules: 'Mules', clog: 'Zuecos',
  espadrille: 'Alpargatas', ballet: 'Bailarinas',
  // accesorios
  bag: 'Bolso', handbag: 'Bolso de Mano', tote: 'Bolso Tote', clutch: 'Bolso de Mano',
  backpack: 'Mochila', wallet: 'Billetera', watch: 'Reloj', bracelet: 'Pulsera',
  necklace: 'Collar', earring: 'Aretes', earrings: 'Aretes', ring: 'Anillo', sunglasses: 'Gafas de Sol',
  windbreaker: 'Rompevientos', snowboard: 'Snowboard', laptop: 'Portátil',
  plated: 'con Baño', flower: 'Flor', micropave: 'Anillo Micropavé', solitaire: 'Anillo Solitario',
  chain: 'Cadena', link: 'Eslabón', genuine: 'Auténtico', daypack: 'Morral', wedding: 'Boda',
  pierced: 'Aretes', stainless: 'de Acero', steel: 'de Acero', petite: 'Petite',
  princess: 'Anillo Princesa', short: 'Corto', sleeve: 'Manga', boat: 'Escote Barco',
  neck: 'Cuello', hooded: 'con Capucha', moto: 'Moto', biker: 'Biker', removable: 'Desmontable',
  moisture: 'Transpirable', climbing: 'de Montaña', raincoat: 'Impermeable', raincoats: 'Impermeable',
  coats: 'Abrigo', foldsack: 'Plegable',
  belt: 'Cinturón', scarf: 'Bufanda', hat: 'Sombrero', cap: 'Gorra', gloves: 'Guantes',
  // colores
  black: 'Negro', white: 'Blanco', red: 'Rojo', blue: 'Azul', navy: 'Azul Marino',
  green: 'Verde', olive: 'Verde Oliva', yellow: 'Amarillo', orange: 'Naranja',
  pink: 'Rosa', fuchsia: 'Fucsia', purple: 'Morado', lilac: 'Lila', brown: 'Marrón',
  beige: 'Beige', tan: 'Camel', cream: 'Crema', ivory: 'Marfil', gray: 'Gris',
  grey: 'Gris', silver: 'Plateado', gold: 'Dorado', golden: 'Dorado', rose: 'Rosa',
  burgundy: 'Vino', maroon: 'Vinotinto', teal: 'Verde Azulado', turquoise: 'Turquesa',
  // materiales / estilos
  leather: 'de Cuero', faux: 'Eco', suede: 'de Ante', denim: 'Denim', silk: 'de Seda',
  satin: 'Satinado', lace: 'de Encaje', velvet: 'de Terciopelo', knit: 'de Punto', knitted: 'Tejido',
  cotton: 'de Algodón', linen: 'de Lino', wool: 'de Lana', cashmere: 'de Cachemir', mesh: 'de Malla',
  sequin: 'con Lentejuelas', sequins: 'con Lentejuelas', 'pleated': 'Plisado', 'printed': 'Estampado', 'floral': 'Floral',
  striped: 'Rayado', plaid: 'de Cuadros', 'cropped': 'Corto', 'oversized': 'Oversize',
  slim: 'Slim', casual: 'Casual', classic: 'Clásico', vintage: 'Vintage',
  fit: 'Fit', fitted: 'Ajustado', solid: 'Liso', padded: 'Acolchado', quilted: 'Acolchado',
  rain: 'Lluvia', winter: 'Invierno', summer: 'Verano', perf: 'Perf',
  one: 'Uno', two: 'Dos', three: 'Tres',
  // números cardinales de tallas (0,2,4,6… = talla US)
  0: 'Talla 0', 2: 'Talla 2', 4: 'Talla 4', 6: 'Talla 6', 8: 'Talla 8', 10: 'Talla 10',
  14: 'Talla 14', 16: 'Talla 16', 18: 'Talla 18',
  // género/edad
  women: 'Mujer', woman: 'Mujer', womens: 'Mujer', "women's": 'Mujer', ladies: 'Damas',
  men: 'Hombre', man: 'Hombre', mens: 'Hombre', "men's": 'Hombre', unisex: 'Unisex',
  kids: 'Niños', girls: 'Niñas', boys: 'Niños',
};

const GARMENT_SET = new Set([
  'Vestido', 'Vestido de Gala', 'Vestido de Verano', 'Camisa', 'Blusa', 'Top', 'Corset', 'Falda',
  'Bolso', 'Bolso de Mano', 'Bolso Tote', 'Reloj', 'Zapatos', 'Zapatos de Tacón', 'Tacones',
  'Sandalias', 'Zapatillas', 'Botas', 'Botines', 'Mocasines', 'Zapatillas de Casa', 'Bailarinas',
  'Plataformas', 'Mules', 'Zuecos', 'Alpargatas', 'Chaqueta', 'Blazer', 'Abrigo', 'Trench',
  'Cardigan', 'Suéter', 'Buzo', 'Enterizo', 'Enterizo Corto', 'Pantalones', 'Jeans', 'Shorts',
  'Leggings', 'Traje', 'Chaleco', 'Mochila', 'Billetera', 'Pulsera', 'Collar', 'Aretes', 'Anillo',
  'Gafas de Sol', 'Cinturón', 'Bufanda', 'Sombrero', 'Gorra', 'Guantes', 'Camiseta', 'Camisa Polo', 'Kimono',
  'Anillo Princesa', 'Anillo Solitario', 'Anillo Micropavé',
]);

const COLOR_SET = new Set([
  'Negro', 'Blanco', 'Rojo', 'Azul', 'Azul Marino', 'Verde', 'Verde Oliva', 'Amarillo', 'Naranja',
  'Rosa', 'Fucsia', 'Morado', 'Lila', 'Marrón', 'Beige', 'Camel', 'Crema', 'Marfil', 'Gris',
  'Plateado', 'Dorado', 'Vino', 'Vinotinto', 'Verde Azulado', 'Turquesa',
]);

// Palabras conectoras que se descartan del nombre
const STOPWORDS = new Set(['with', 'and', 'or', 'of', 'for', 'the', 'a', 'an', 'in', 'on', 'to', 'by', 'set', 'style', '&']);

// Marcas/propios que se conservan tal cual
const KEEP_WORDS = new Set([
  'calvin', 'klein', 'michael', 'kors', 'guess', 'tommy', 'hilfiger', 'ralph', 'lauren',
  'nike', 'adidas', 'puma', 'levis', "levi's", 'zara', 'heshe', 'fossil', 'coach',
]);

const LOWERCASE_ES = new Set(['de', 'con', 'y', 'e', 'del', 'al', 'en']);

function titleEs(words) {
  const out = [];
  for (const chunk of words.filter(Boolean)) {
    for (const w of String(chunk).split(/\s+/).filter(Boolean)) {
      if (out.length > 0 && LOWERCASE_ES.has(w.toLowerCase())) {
        out.push(w.toLowerCase());
      } else {
        out.push(w.charAt(0).toUpperCase() + w.slice(1));
      }
    }
  }
  return out.join(' ');
}

/** Traducción offline de un nombre tipo "Black Women's Gown" → "Vestido de Gala Negro Mujer".
 *  dropUnknown: descarta palabras no reconocidas (títulos basura tipo marketplace). */
export function localTranslateName(name, { dropUnknown = false } = {}) {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const cleaned = raw.replace(/['’]/g, '').replace(/[^A-Za-z0-9&\s-]/g, ' ').trim();
  const tokens = cleaned.split(/[\s-]+/).filter(Boolean).map((t) => t.toLowerCase());

  const garments = [];
  const colors = [];
  const rest = [];

  const push = (arr, word) => {
    if (!arr.some((w) => w.toLowerCase() === word.toLowerCase())) arr.push(word);
  };

  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    if (KEEP_WORDS.has(t)) { push(rest, t.charAt(0).toUpperCase() + t.slice(1)); continue; }
    let es = WORD_MAP[t];
    if (!es && t.length > 3 && t.endsWith('s')) es = WORD_MAP[t.replace(/s$/, '')]; // plural → singular
    if (!es) {
      if (dropUnknown || /^\d+$/.test(t)) continue; // desconocida o número: fuera
      push(rest, t.charAt(0).toUpperCase() + t.slice(1));
      continue;
    }
    if (GARMENT_SET.has(es)) push(garments, es);
    else if (COLOR_SET.has(es)) push(colors, es);
    else push(rest, es);
  }

  // Estructura: Prenda + material/detalle/marca + color
  const pieces = [
    ...garments.slice(0, 2),
    ...rest.slice(0, 3),
    ...colors.slice(0, 2),
  ];
  // Títulos sin prenda reconocible (ej. "Mens Casual Slim Fit", "Solid Gold Petite Micropave"):
  // el genérico "Prenda" evita nombres tipo "Mujer Liso".
  if (!garments.length) pieces.unshift('Prenda');
  if (!pieces.length) return titleEs(raw.split(/[\s-]+/).slice(0, 4));
  return titleEs(pieces);
}
