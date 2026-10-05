// =====================================================================
// TAXONOMÍA DE COLOR — capa que faltaba entre el catálogo y el LLM.
//
// El problema que resuelve: la tabla `products` no tiene columna de color,
// así que el motor de recomendación nunca filtraba por color y el LLM
// recibía solo el nombre de la prenda. Resultado real: a una clienta que
// pedía "tonos fríos" se le ofrecía un vestido magenta, y el modelo lo
// justificaba inventando que "el magenta frío favorece".
//
// El color SÍ existe, en dos sitios que ahora unificamos:
//   1) `product_variants.color` — valores crudos y en inglés ("Black",
//      "Hot Pink", "Ink-blue Colour", "HOT PINK", "Único"…).
//   2) El nombre del producto ("Vestido Asimétrico Magenta Atelier").
//
// Cada color se normaliza a un nombre canónico en español con su
// temperatura (frío / cálido / neutro), que es lo que permite responder a
// "tonos fríos" o respetar un color que el cliente quiere evitar.
// =====================================================================

/** Sin acentos y en minúsculas, para comparar de forma robusta. */
const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

// El ORDEN importa: gana la primera regla que coincide, así que las formas
// compuestas ("yellow gold", "coral pink") van antes que las simples.
const RULES = [
  // --- Dorados (cálido) — antes que "yellow"/"rose" sueltos ---
  { name: 'dorado', temp: 'calido', re: /yellow\s*gold|rose\s*gold|brass|\bgold\b|dorado|dorada|dore/ },

  // --- Rosas y afines (cálido). El magenta/fucsia entra aquí: es justo
  //     el color que el modelo clasificaba mal como frío. ---
  { name: 'rosa', temp: 'calido', re: /hot\s*pink|dusty\s*pink|coral\s*pink|transparent\s*pink|\bpink\b|\brosa\b|fucsia|fuchsia|magenta/ },

  // --- Fríos ---
  { name: 'azul', temp: 'frio', re: /blue\s*denim|ink-?\s*blue|cobalt|cobalto|\bdenim\b|\bnavy\b|medium\s*blue|\bblue\b|\bazul\b/ },
  { name: 'celeste', temp: 'frio', re: /celeste|sky\s*blue|light\s*blue/ },
  { name: 'turquesa', temp: 'frio', re: /turquesa|turquoise|\bteal\b|\baqua\b/ },
  { name: 'verde', temp: 'frio', re: /\bgreen\b|\bverde\b|esmeralda|emerald|\bmint\b|menta|olive|oliva/ },
  { name: 'morado', temp: 'frio', re: /\bpurple\b|\bviolet\b|violeta|\blila\b|lavender|lavanda|\bmorado\b/ },

  // --- Neutros ---
  { name: 'gris', temp: 'neutro', re: /\bgrey\b|\bgray\b|\bgris\b|silver|plateado|plateada/ },
  { name: 'negro', temp: 'neutro', re: /\bblack\b|\bnegro\b|\bnegra\b|onyx/ },
  { name: 'blanco', temp: 'neutro', re: /\bwhite\b|\bblanco\b|\bblanca\b|ivory|marfil/ },
  { name: 'beige', temp: 'neutro', re: /\bbeige\b|\bnude\b|\bcrema\b|\bcream\b|khaki|\bcamel\b|\bsand\b|\barena\b/ },

  // --- Cálidos restantes ---
  { name: 'marron', temp: 'calido', re: /\bbrown\b|marron|mocha|chocolate|terracotta|terracota|\bcopper\b|\bcobre\b/ },
  { name: 'rojo', temp: 'calido', re: /\bred\b|\brojo\b|\broja\b|\bvino\b|burgundy|granate|\bwine\b/ },
  { name: 'naranja', temp: 'calido', re: /\borange\b|naranja|\bcoral\b|mandarin/ },
  { name: 'amarillo', temp: 'calido', re: /\byellow\b|amarillo|mustard|mostaza/ },
];

/** Nombre canónico en español de un color crudo (BD o nombre de prenda). */
export function canonicalColor(raw) {
  const t = norm(raw);
  if (!t) return null;
  const rule = RULES.find((r) => r.re.test(t));
  return rule ? rule.name : null;
}

/** Temperatura de un color canónico: 'frio' | 'calido' | 'neutro' | null. */
export function temperatureOf(canonical) {
  const rule = RULES.find((r) => r.name === canonical);
  return rule ? rule.temp : null;
}

/**
 * Todos los colores canónicos mencionados en un texto libre.
 * Sirve para "quiero algo en azul y gris" o para los nombres de prenda.
 */
export function colorsInText(text) {
  const t = norm(text);
  if (!t) return [];
  const found = new Set();
  for (const rule of RULES) if (rule.re.test(t)) found.add(rule.name);
  return [...found];
}

/**
 * ¿El cliente pide una temperatura de color concreta?
 * "tonos fríos", "paleta fría", "colores cálidos", "gama neutra"…
 * Se aceptan las formas masculina y femenina (tono frío / paleta fría).
 */
export function requestedTemperature(message) {
  const t = norm(message);
  if (/\b(tonos?|colores?|paleta|gama|escala)\s+fri[oa]s?\b/.test(t) || /\bfri[oa]s\b/.test(t)) return 'frio';
  if (/\b(tonos?|colores?|paleta|gama|escala)\s+calid[oa]s?\b/.test(t) || /\bcalid[oa]s\b/.test(t)) return 'calido';
  if (/\b(tonos?|colores?|paleta|gama|escala)\s+neutr[oa]s?\b/.test(t) || /\bneutr[oa]s\b/.test(t)) return 'neutro';
  return null;
}

// Marcas de negación que convierten un color mencionado en un color a EVITAR:
// "que no sea amarillo", "nada de rojo", "sin negro", "evito el rosa"…
const NEGACION = 'no\\s+(?:sea|es|quiero|queria|me\\s+gusta[n]?|me\\s+va[n]?|prefiero)|sin|nada\\s+de|evitar|evito|evita|excepto|menos|odio|nunca|jamas';

/** Separa los colores que gustan de los que el cliente pide evitar. */
export function colorsPreferredAndAvoided(message) {
  const t = norm(message);
  const prefer = new Set();
  const avoid = new Set();
  if (!t) return { prefer: [], avoid: [] };
  for (const rule of RULES) {
    const negada = new RegExp(
      `(?:${NEGACION})\\s+(?:(?:el|la|los|las)\\s+)?(?:${rule.re.source})`,
    ).test(t);
    if (negada) avoid.add(rule.name);
    else if (rule.re.test(t)) prefer.add(rule.name);
  }
  return { prefer: [...prefer], avoid: [...avoid] };
}

/**
 * Preferencias de color para una consulta: temperatura pedida, colores que
 * le gustan (de la memoria o del propio mensaje) y colores a evitar.
 */
export function buildColorPreference(message, facts = {}) {
  const fromMsg = colorsPreferredAndAvoided(message);

  const prefer = new Set(fromMsg.prefer);
  if (facts.color_favorito) {
    const c = canonicalColor(facts.color_favorito);
    if (c) prefer.add(c);
  }

  const avoid = new Set(fromMsg.avoid);
  if (facts.color_evitar) {
    const c = canonicalColor(facts.color_evitar);
    if (c) avoid.add(c);
  }
  // Un color no puede ser deseado y evitado a la vez: gana la evitación.
  for (const a of avoid) prefer.delete(a);

  return {
    temperature: requestedTemperature(message),
    prefer: [...prefer],
    avoid: [...avoid],
  };
}

/** ¿Esta preferencia sirve para algo? */
export function isActive(pref) {
  return Boolean(pref && (pref.temperature || pref.prefer?.length || pref.avoid?.length));
}

// Puntajes: positivo = encaja mejor, -100 = el cliente pidió evitarlo.
const SCORE_AVOID = -100;
const SCORE_PREFER = 20;
const SCORE_TEMP = 8;
const SCORE_TEMP_OPUESTA = -3;

/** Temperatura contraria. Los neutros combinan con todo, así que no tienen. */
const OPUESTA = { frio: 'calido', calido: 'frio' };

/** Puntúa un producto (con `colors` canónicos) frente a una preferencia. */
export function colorScore(colors, pref) {
  if (!isActive(pref) || !colors?.length) return 0;
  if (pref.avoid?.some((a) => colors.includes(a))) return SCORE_AVOID;
  let score = 0;
  for (const c of colors) {
    if (pref.prefer?.includes(c)) score += SCORE_PREFER;
    const t = temperatureOf(c);
    if (pref.temperature && t === pref.temperature) score += SCORE_TEMP;
    // Un dorado no es un tono frío: si el cliente pidió fríos, el cálido baja,
    // pero sin llegar a excluirse (queda por si no hay nada mejor).
    else if (pref.temperature && t === OPUESTA[pref.temperature]) score += SCORE_TEMP_OPUESTA;
  }
  return score;
}

/**
 * Reordena los productos según la preferencia de color, descartando los que
 * el cliente pidió evitar SIEMPRE que queden alternativas. Si el filtro
 * dejaría la lista vacía, se devuelve la original: es preferible sugerir algo
 * fuera de la preferencia que no sugerir nada.
 */
export function applyColorPreference(products, pref) {
  if (!isActive(pref) || !products?.length) return products;
  const scored = products.map((p, i) => ({ p, i, s: colorScore(p.colors, pref) }));
  const kept = scored.filter((x) => x.s > SCORE_AVOID);
  const base = kept.length ? kept : scored;
  // Orden estable: por puntaje y, en empate, por el orden original del motor.
  return base
    .slice()
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.p);
}
