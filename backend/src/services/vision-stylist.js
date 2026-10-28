// =====================================================================
// IA #10 · ESTILISTA VISUAL — análisis de imagen del armario del cliente
// IA #11 · RECOMENDADOR PERSONALIZADO — análisis + perfil + historial
// ---------------------------------------------------------------------
// Flujo:
//   1) El cliente sube una foto de su prenda/outfit.
//   2) El navegador extrae la paleta dominante (canvas) y envía la imagen
//      reducida (data URL) + la paleta.
//   3) Servidor: nombra los colores, detecta armonía; si hay LLM de visión
//      (OpenRouter) analiza tipo de prenda/estilo/ocasiones; si no, usa
//      heurísticas de color (fallback local, siempre funcional).
//   4) IA #11: cruza análisis + historial de compras del usuario + stock
//      y devuelve prendas del catálogo real con explicación personalizada.
//
// MEJORAS 2026-10:
//   - Prompt más detallado con contexto de moda premium y taxonomía de prendas
//   - Output JSON expandido: material, details, temporada, confidence
//   - Fallback inteligente: análisis local enriquecido cuando el LLM falla
//   - Reintentos con backoff exponencial ante fallos transitorios
// =====================================================================
import { pool } from '../db.js';
import { llmProvider, callChat } from './llm-provider.js';
import { imageLimits } from './image-input.js';

// ---------------------------------------------------------------
// Utilidades de color
// ---------------------------------------------------------------

/** Factores de peso por posición en la paleta (primeros colores son más informativos). */
const PALETTE_WEIGHTS = [1.0, 0.85, 0.7, 0.55, 0.4, 0.3];
function colorName({ r, g, b }) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;             // luminosidad 0..1
  const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255)); // saturación aprox
  if (l < 0.12) return 'Negro';
  if (l > 0.92) return 'Blanco';
  if (s < 0.12) return l < 0.45 ? 'Gris oscuro' : l < 0.7 ? 'Gris' : 'Gris claro';
  if (l > 0.55 && l < 0.88 && s < 0.38) return 'Beige';
  if (l > 0.82 && s < 0.35) return 'Beige';
  // tono (hue) 0..360
  let h = 0;
  const d = max - min;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60); if (h < 0) h += 360;
  if (h < 15 || h >= 345) return l < 0.35 ? 'Vino' : 'Rojo';
  if (h < 40) return l < 0.4 ? 'Café' : 'Naranja';
  if (h < 65) return 'Mostaza';
  if (h < 90) return 'Verde limón';
  if (h < 160) return 'Verde';
  if (h < 200) return 'Verde azulado';
  if (h < 255) return 'Azul';
  if (h < 290) return 'Morado';
  return l < 0.5 ? 'Fucsia' : 'Rosa';
}
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/** Armonía cromática según matices dominantes. */
function harmonyOf(named) {
  const counts = {};
  for (const c of named) counts[c.name] = (counts[c.name] || 0) + c.pct;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!top.length) return { type: 'Sin determinar', desc: 'no se detectaron colores dominantes en la foto — vuelve a intentarlo con una foto más clara' };
  if (top.length === 1 || top[0][1] >= 75) return { type: 'Monocromática', desc: 'una paleta de un solo tono — elegante y fácil de accessorizar' };
  const neutrals = ['Negro', 'Blanco', 'Gris', 'Gris claro', 'Gris oscuro', 'Beige', 'Café'];
  if (top.every(([n]) => neutrals.includes(n))) return { type: 'Neutros', desc: 'base neutra — combinable con casi cualquier acento de color' };
  if (top.length >= 2 && top[0][1] < 60) return { type: 'Contrastada', desc: 'colores contrastados — permiten looks con carácter' };
  return { type: 'Análoga', desc: 'tonos cercanos entre sí — armonía suave y sofisticada' };
}

/** Heurística local: ocasiones sugeridas según paleta y saturación. */
function localOccasions(named) {
  const names = named.map((c) => c.name);
  const has = (n) => names.includes(n);
  const occ = [];
  if (has('Negro') || has('Vino') || has('Fucsia')) occ.push('Evento nocturno', 'Cóctel', 'Cena elegante');
  if (has('Beige') || has('Blanco') || has('Gris claro')) occ.push('Oficina', 'Almuerzo casual', 'Reunión de trabajo');
  if (has('Azul') || has('Gris')) occ.push('Trabajo / entrevista', 'Negocios');
  if (has('Rosa') || has('Verde limón') || has('Mostaza')) occ.push('Día / brunch', 'Weekend casual');
  if (has('Verde') || has('Azul marino')) occ.push('Evento formal', 'Ceremonia');
  if (!occ.length) occ.push('Casual versátil');
  return [...new Set(occ)].slice(0, 5);
}

/**
 * Análisis local enriquecido cuando el LLM no está disponible.
 * Detecta tipos de prenda probables según la paleta y armonía.
 */
function localAnalysis(named, harmony, body) {
  const names = named.map((c) => c.name.toLowerCase());
  const joined = names.join(' ');
  
  // Detectar tipo de prenda probable por combinaciones de color
  let guessedType = 'Prenda de vestir';
  let guessedStyle = 'Estilo a definir';
  let guessedFormality = 'Casual';
  let guessedNotes = 'Análisis local basado en la paleta de colores.';
  
  // Patrones de color para inferir tipo/estilo
  const darkElegant = ['negro', 'vino', 'azul marino', 'gris oscuro'];
  const lightCasual = ['blanco', 'beige', 'gris claro', 'rosé'];
  const vibrant = ['rojo', 'fucsia', 'naranja', 'verde limón', 'mostaza'];
  
  const hasDark = darkElegant.some(n => joined.includes(n));
  const hasLight = lightCasual.some(n => joined.includes(n));
  const hasVibrant = vibrant.some(n => joined.includes(n));
  
  if (hasDark && !hasLight && !hasVibrant) {
    guessedType = 'Prenda de noche o formal';
    guessedStyle = 'Elegante bajo en detalle';
    guessedFormality = 'Formal / noche';
    guessedNotes = 'Paleta oscura y elegante. Ideal para eventos nocturnos y ocasiones formales.';
  } else if (hasLight && !hasDark && !hasVibrant) {
    guessedType = 'Prenda casual de día';
    guessedStyle = 'Minimalista y aéreo';
    guessedFormality = 'Semi-formal';
    guessedNotes = 'Paleta clara y fresca. Perfecta para uso diurno y entornos casuales.';
  } else if (hasVibrant && named.length >= 2) {
    guessedType = 'Prenda statement';
    guessedStyle = 'Atrevido y colorido';
    guessedFormality = 'Casual';
    guessedNotes = 'Colores vibrantes que destacan. Ideal como pieza protagonista del look.';
  } else if (named.length >= 3 && hasDark) {
    guessedType = 'Outfit capas / composed';
    guessedStyle = 'Compuesto con profundidad';
    guessedFormality = 'Semi-formal';
    guessedNotes = 'Múltiples tonos con base oscura. Sugiere un outfit con capas o composición cuidada.';
  }
  
  // Considerar armonía para el estilo
  if (harmony.type === 'Monocromática') {
    guessedStyle = guessedStyle.replace('a definir', 'monocromático elegante');
    guessedNotes += ' La paleta monocromática aporta elegancia visual.';
  } else if (harmony.type === 'Análoga') {
    guessedStyle = guessedStyle.replace('a definir', 'armonioso');
    guessedNotes += ' Tonos análogos crean una transición suave entre colores.';
  } else if (harmony.type === 'Contrastada') {
    guessedStyle = guessedStyle.replace('a definir', 'con impacto visual');
    guessedNotes += ' La combinación contrastada aporta energía y carácter al outfit.';
  }
  
  return {
    garmentType: guessedType,
    style: guessedStyle,
    formality: guessedFormality,
    occasions: localOccasions(named),
    notes: guessedNotes,
    confidence: 0.5,
    method: 'local'
  };
}

/**
 * IA #10 MEJORA · PERFIL DE SILUETA
 * -----------------------------------------------------------------
 * Clasifica la figura en 5 formas (arenera/hora, pera/triángulo,
 * manzana, rectángulo, triángulo invertido) usando medidas o deducida
 * de la etiqueta elegida en la UI. Devuelve qué cortes favorecen y
 * cuáles conviene evitar, para guiar el recomendador de prendas.
 */
export const BODY_SHAPES = {
  hourglass: {
    id: 'hourglass', label: 'Arenera (reloj de arena)', emoji: '⏳',
    desc: 'Busto y caderas equilibrados con cintura marcada',
    favor: ['Cinturones para marcar la cintura', 'Vestidos ajustados en la cintura (wrap/faja)', 'Faldas lápiz y acampanadas', 'Cuello V y escotes corazón', 'Pantalones de tiro alto'],
    avoid: ['Túnicas sueltas que ocultan la cintura', 'Cortes bóxer que aplanan la figura'],
  },
  pear: {
    id: 'pear', label: 'Triángulo (pera)', emoji: '🍐',
    desc: 'Caderas más anchas que los hombros',
    favor: ['Blusas con hombros marcados o volantes arriba', 'Escotes barco y cuellos llamativos', 'Pantalones rectos o de corte recto en tonos oscuros', 'Faldas A y vestidos imperio', 'Chaquetas que terminan sobre la cadera'],
    avoid: ['Bolsillos laterales voluminosos en pantalones', 'Faldas muy ajustadas a la cadera con top pegado'],
  },
  apple: {
    id: 'apple', label: 'Óvalo (manzana)', emoji: '🍎',
    desc: 'Volumen en la zona media con buena escotadura',
    favor: ['Blusas flowing con caída suave', 'Vestidos imperio con volumen bajo el busto', 'Monocromático vertical con bufandas/largos', 'Pantalones de tiro medio con pierna recta', 'Capas y kimonos que estilizan'],
    avoid: ['Cinturones gruesos a la altura del abdomen', 'Telas muy pegadas al torso'],
  },
  rectangle: {
    id: 'rectangle', label: 'Rectángulo', emoji: '▭',
    desc: 'Hombros, cintura y caderas de anchos similares',
    favor: ['Capas y volantes que curvan la silueta', 'Faldas plisadas y pantalones con holgura', 'Cinturones para crear cintura', 'Tops con escote corazón o detalje en busto', 'Denim de tiro alto con camisa por dentro'],
    avoid: ['Looks rectos de una pieza sin forma', 'Telas rígidas que no curvan'],
  },
  inverted: {
    id: 'inverted', label: 'Triángulo invertido', emoji: '🔻',
    desc: 'Hombros más anchos que las caderas',
    favor: ['Faldas acampanadas y pantalones con volumen abajo (palazzo)', 'Escotes V profundos que alargan', 'Colores oscuros arriba y claros abajo', 'Tops suaves sin hombreras'],
    avoid: ['Hombros estructurados u hombreras', 'Cuellos barco que ensanchan arriba'],
  },
};

const approx = (a, b) => (a > 0 && b > 0 && Math.abs(a - b) <= Math.max(6, b * 0.09));

const bodyBlock = (s, method) => (s ? {
  id: s.id, label: s.label, emoji: s.emoji, desc: s.desc,
  favor: s.favor, avoid: s.avoid, method,
} : null);

/**
 * Clasifica la silueta con 3 niveles de prioridad:
 * 1) silueta elegida manualmente por el cliente,
 * 2) medidas corporales (cm) que él mismo ingresó,
 * 3) AUTO: proporciones hombro/cintura/cadera medidas sobre la silueta
 *    de la foto (visión por computadora local, y LLM de visión como
 *    respaldo cuando está configurado).
 */
export function classifyBodyShape({ shape, height, waist, bust, hips, auto } = {}) {
  if (shape && BODY_SHAPES[shape]) return { shape: BODY_SHAPES[shape], method: 'elegida por ti' };
  const w = Number(waist) > 0 ? Number(waist) : null;
  const b = Number(bust) > 0 ? Number(bust) : null;
  const h = Number(hips) > 0 ? Number(hips) : null;
  if (b && w && h) {
    const hipVsBust = h - b;
    const waistRatio = (w - b) / Math.max(b, 1);
    let id;
    if (approx(b, h) && waistRatio <= -0.22) id = 'hourglass';
    else if (hipVsBust > 8) id = 'pear';
    else if (waistRatio >= -0.04 || w >= b) id = 'apple';
    else if (b - h > 8) id = 'inverted';
    else id = 'rectangle';
    return { shape: BODY_SHAPES[id], method: `medidas (busto ${b} · cintura ${w} · caderas ${h} cm)` };
  }
  // AUTO · proporciones relativas de la silueta en la foto (px)
  const sw = Number(auto?.shoulder) > 0 ? Number(auto.shoulder) : null;
  const ww = Number(auto?.waist) > 0 ? Number(auto.waist) : null;
  const hw = Number(auto?.hip) > 0 ? Number(auto.hip) : null;
  if (sw && ww && hw) {
    const waistRel = (ww - sw) / sw; // cintura respecto a hombros
    const hipDiff = (hw - sw) / sw;  // cadera respecto a hombros
    let id;
    if (hipDiff > 0.12) id = 'pear';
    else if (hipDiff < -0.12) id = 'inverted';
    else if (waistRel >= -0.06) id = 'apple';
    else if (waistRel <= -0.24) id = 'hourglass';
    else id = 'rectangle';
    return { shape: BODY_SHAPES[id], method: 'auto · IA analizando tu foto' };
  }
  return { shape: null, method: null };
}

// El tope se define una sola vez (AI_IMAGE_MAX_KB en services/image-input.js):
// antes cada servicio repetía su propio 450/600 KB y se contradecían.
const TO_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/;
const toDataUrlOk = (s) => {
  if (typeof s !== 'string') return false;
  const prefix = s.match(TO_DATA_URL);
  if (!prefix) return false;
  // Se compara sólo el base64: el prefijo "data:image/...;base64," no cuenta
  // contra el tope de KB (si contara, una imagen justo en el límite fallaba).
  return s.length - prefix[0].length <= imageLimits().base64Chars;
};

// ---------------------------------------------------------------
// IA #10 · Análisis de la imagen
// ---------------------------------------------------------------
export async function analyzeOutfitImage({ image, palette = [], body = null } = {}) {
  if (!toDataUrlOk(image)) throw new Error(`Imagen inválida o demasiado grande (máx ${imageLimits().kb} KB)`);
  const bodyProfile = classifyBodyShape(body || {});
  const named = palette
    .filter((c) => Number(c.pct) > 1)
    .slice(0, 6)
    .map((c) => ({ name: colorName(c), hex: hex(c), pct: Math.round(c.pct) }));
  const harmony = harmonyOf(named);
  
  // Fallback local (mejorado con análisis enriquecido)
  const localFallback = localAnalysis(named, harmony, bodyProfile);
  const fallback = {
    colors: named,
    harmony: harmony.type,
    harmonyDesc: harmony.desc,
    body: bodyBlock(bodyProfile.shape, bodyProfile.method),
    ...localFallback,
    engine: 'local',
    model: null,
  };

  const provider = llmProvider();
  if (!provider) return fallback;

  try {
    const paletteTxt = named.map((c) => `${c.name} (${c.pct}%)`).join(', ');
    const bodyTxt = bodyProfile.shape
      ? ` Silueta del cliente: ${bodyProfile.shape.label} — ${bodyProfile.shape.desc}. ` +
        `Cortes que la favorecen: ${bodyProfile.shape.favor.slice(0, 3).join('; ')}.`
      : ' Si la foto muestra el cuerpo, estima su silueta. Valores válidos: hourglass, pear, apple, rectangle, inverted.';
    
    // Prompt mejorado con contexto de moda premium y taxonomía detallada
    const systemPrompt = `Eres el estilista visual de VivaModa, tienda de moda premium (USD). Tu expertise es analizar fotos de prendas y outfits para ofrecer recomendaciones de estilo precisas.

ANÁLISIS A REALIZAR:
- Identifica la prenda o outfit principal (tipo específico: blazer, vestido, camisa, pantalón, falda, mezclilla, chaqueta, top, etc.)
- Describe el estilo en 2-4 palabras (ej: "minimalista elegante", "atrevido retro", "casual urbano")
- Clasifica la formalidad: Formal / Semi-formal / Casual
- Sugiere 4-5 ocasiones específicas donde usarla
- Si la foto muestra el cuerpo completo, estima la silueta (hourglass|pear|apple|rectangle|inverted|null)
- Describe materiales visibles (lana, seda, algodón, denim, cuero, sintético, mezcla)
- Detecta detalles de diseño relevantes (estructurado, flowing, A-line, ajustado, volante, plisado, etc.)
- Estima temporada de uso (primavera-verano, otoño-invierno, todo-año)
- Da 1 frase de asesoría considerando silueta y estilo

PALETA DOMINANTE MEDIDA (para contexto de color):
${paletteTxt}
${bodyTxt}

INSTRUCCIONES:
- Responde SOLAMENTE JSON válido, sin markdown, sin explicación previa
- Usa el esquema exacto de abajo
- Mantén descripciones concisas pero informativas
- No inventes características no visibles

OUTPUT JSON (ÚNICO):
{
  "garmentType": "tipo de prenda específico",
  "style": "estilo en 2-4 palabras",
  "formality": "Formal|Semi-formal|Casual",
  "occasions": ["ocasión 1", "ocasión 2", "ocasión 3", "ocasión 4"],
  "bodyShape": "hourglass|pear|apple|rectangle|inverted|null",
  "materialHint": "material visible o null",
  "designDetails": "detalles de diseño observados o null",
  "season": "primavera-verano|otoño-invierno|todo-año|null",
  "notes": "1 frase de asesoría",
  "confidence": 0.7
}`;

    const body = {
      model: provider.visionModel || provider.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: systemPrompt },
          { type: 'image_url', image_url: { url: image } },
        ],
      }],
      max_tokens: 500,
      temperature: 0.2,
    };

    // Reintentos con backoff exponencial: 1s, 2s, 4s (3 intentos totales)
    const retryDelays = [1000, 2000, 4000];
    let lastResult = null;
    
    for (let i = 0; i <= retryDelays.length; i++) {
      if (i > 0) {
        console.warn(`[vision-stylist] reintento ${i} después de ${retryDelays[i-1]}ms…`);
        await new Promise(r => setTimeout(r, retryDelays[i-1]));
      }
      const { ok, body: data, networkError } = await callChat(provider, body, { timeoutMs: 45_000, attempts: 1, tag: 'vision' });
      if (ok && data?.choices?.[0]?.message?.content) {
        lastResult = { ok: true, data, networkError: null };
        break;
      }
      lastResult = { ok: false, data: null, networkError };
    }
    
    if (!lastResult || !lastResult.ok) {
      console.warn(`[vision-stylist] LLM no disponible (${lastResult?.networkError || 'sin respuesta'}); usando análisis local enriquecido`);
      return fallback;
    }
    
    const raw = lastResult.data?.choices?.[0]?.message?.content?.trim() || '';
    const json = raw.replace(/```json|```/g, '').trim();
    let parsed = null;
    try { parsed = JSON.parse(json); } catch { 
      console.warn('[vision-stylist] JSON inválido del LLM, usando fallback local');
      return fallback;
    }

    // Si el CV local no pudo medir la silueta, usa la estimación del LLM
    if (!bodyProfile.shape && typeof parsed.bodyShape === 'string' && BODY_SHAPES[parsed.bodyShape.trim().toLowerCase()]) {
      const detected = classifyBodyShape({ shape: parsed.bodyShape.trim().toLowerCase() });
      if (detected.shape) bodyProfile.shape = detected.shape;
      bodyProfile.method = 'auto · IA de visión';
    }
    
    // Construir output completo con todos los campos mejorados
    return {
      colors: named,
      harmony: harmony.type,
      harmonyDesc: harmony.desc,
      body: bodyBlock(bodyProfile.shape, bodyProfile.method),
      garmentType: parsed.garmentType || localFallback.garmentType,
      style: parsed.style || localFallback.style,
      formality: parsed.formality || localFallback.formality,
      occasions: Array.isArray(parsed.occasions) ? parsed.occasions.slice(0, 5) : localFallback.occasions,
      materialHint: parsed.materialHint || null,
      designDetails: parsed.designDetails || null,
      season: parsed.season || null,
      notes: parsed.notes || localFallback.notes,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
      engine: 'llm',
      model: body.model,
      providerName: provider.name,
    };
  } catch (err) {
    console.warn('[vision-stylist] error inesperado:', err.message);
    return fallback;
  }
}

// ---------------------------------------------------------------
// IA #11 · Recomendador personalizado (análisis + historial + stock)
// ---------------------------------------------------------------
async function userHistory(userId) {
  if (!userId) return null;
  const { rows } = await pool.query(
    `SELECT MAX(p.gender) AS gender, ARRAY_AGG(DISTINCT p.category) AS categories,
            ROUND(AVG(oi.unit_price)::numeric, 2)::float8 AS avg_price, COUNT(*)::int AS items
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.user_id = $1 AND o.paid = TRUE AND o.status <> 'cancelled'`,
    [userId],
  );
  return rows[0]?.items > 0 ? rows[0] : null;
}

/** Sesgo de categorías/palabras clave por silueta (IA #10 mejora). */
const SHAPE_BIAS = {
  hourglass: { cats: ['Vestidos', 'Blusas', 'Pantalones'], kw: ['faja', 'wrap', 'tiro alto', 'ajustad', 'lápiz', 'lapiz'], why: 'marca tu cintura' },
  pear: { cats: ['Blusas', 'Camisas', 'Chaquetas'], kw: ['volante', 'hombro', 'barco', 'recto', 'imperio'], why: 'equilibra tus hombros con la cadera' },
  apple: { cats: ['Blusas', 'Ropa Exterior', 'Vestidos'], kw: ['imperio', 'flow', 'caída', 'caida', 'kimono', 'capa', 'largo'], why: 'estiliza tu zona media con caída suave' },
  rectangle: { cats: ['Vestidos', 'Blusas', 'Pantalones'], kw: ['plisad', 'volante', 'capa', 'volumen', 'peplum', 'cintur'], why: 'crea curvas con capas y volumen' },
  inverted: { cats: ['Pantalones', 'Vestidos', 'Blusas'], kw: ['acampanad', 'palazzo', 'amplia', 'volumen', 'palazzo'], why: 'añade volumen abajo y equilibra tus hombros' },
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');

export async function personalizedRecommendations({ analysis, user = null, limit = 4 }) {
  const hist = await userHistory(user?.id || null);
  const colorNames = (analysis.colors || []).map((c) => c.name);
  const occText = [...(analysis.occasions || []), analysis.formality, analysis.style].join(' ').toLowerCase();

  // Sesgo de ocasión → categorías candidatas
  const rules = [
    { re: /nocturn|cóctel|coctel|gala|ceremonia/, cats: ['Vestidos de Noche', 'Vestidos', 'Calzado'] },
    { re: /oficina|trabajo|entrevista|formal/, cats: ['Sastrería', 'Blusas', 'Pantalones'] },
    { re: /casual|día|dia|brunch|almuerzo/, cats: ['Blusas', 'Denim', 'Accesorios'] },
  ];
  const cats = rules.filter((r) => r.re.test(occText)).flatMap((r) => r.cats);
  const gender = hist?.gender || analysis.gender || (/caballero|hombre/.test(occText) ? 'caballeros' : null);

  const shapeId = analysis.body?.id || null;
  const shapeCats = SHAPE_BIAS[shapeId]?.cats || [];

  const where = ['p.is_active = TRUE', `p.visibility = 'store'`];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (gender && ['damas', 'caballeros', 'ninos', 'unisex'].includes(gender)) where.push(`(p.gender = ${p(gender)} OR p.gender = 'unisex')`);
  else if (!/niñ|kids/.test(occText)) where.push(`p.gender <> 'ninos'`); // sin sesión: excluir ropa infantil
  // Con silueta definida la ocasión no filtra (solo puntúa): buscamos
  // primero prendas que favorezcan la figura del cliente.
  if (cats.length && !shapeCats.length) where.push(`p.category = ANY(${p(cats)})`);
  where.push(`EXISTS (SELECT 1 FROM product_variants vv JOIN inventory ii ON ii.variant_id = vv.id WHERE vv.product_id = p.id AND ii.qty > 0)`);

  const shapeCatParam = shapeCats.length ? p(shapeCats) : null;

  const { rows: candidates } = await pool.query(
    `SELECT p.sku, p.name, p.category, p.gender, p.badge, p.price::float8 AS price,
            p.rating::float8 AS rating, p.image_url
     FROM products p
     WHERE ${where.join(' AND ')}
     ORDER BY ${shapeCatParam ? `p.category = ANY(${shapeCatParam}) DESC,` : ''} p.rating DESC, p.review_count DESC
     LIMIT 48`,
    params,
  );

  // Garantiza presencia de prendas (no accesorios) de categorías que
  // favorecen la silueta, aunque su rating general sea menor.
  if (shapeCatParam) {
    const { rows: extra } = await pool.query(
      `SELECT p.sku, p.name, p.category, p.gender, p.badge, p.price::float8 AS price,
              p.rating::float8 AS rating, p.image_url
       FROM products p
       WHERE ${[...where, `p.category = ANY(${shapeCatParam})`].join(' AND ')}
       ORDER BY p.rating DESC, p.review_count DESC
       LIMIT 12`,
      params,
    );
    const seen = new Set(candidates.map((c) => c.sku));
    for (const e of extra) if (!seen.has(e.sku)) candidates.push(e);
  }

  // Puntaje: coincidencia de color + historial + favorabilidad según silueta
  const shapeBias = shapeId ? SHAPE_BIAS[shapeId] : null;
  const ranked = candidates.map((cand) => {
    let score = (cand.rating || 3);
    const blob = norm(`${cand.name} ${cand.category}`);
    if (colorNames.some((n) => blob.includes(norm(n)))) score += 3;
    if (hist?.categories?.some((cat) => cat === cand.category)) score += 2;
    if (hist?.avg_price && Math.abs(cand.price - hist.avg_price) <= hist.avg_price * 0.5) score += 1.5;
    if (/nuevo|trending|top ventas/i.test(cand.badge || '')) score += 1;
    if (cats.includes(cand.category)) score += 1; // afinidad con la ocasión detectada
    if (shapeBias) {
      if (shapeBias.kw.some((k) => blob.includes(k))) score += 2.5; // corte favorecedor
      else if (shapeBias.cats.includes(cand.category)) score += 2; // categoría amiga
    }
    return { ...cand, score: Math.round(score * 10) / 10, shapePick: Boolean(shapeBias && shapeBias.kw.some((k) => blob.includes(k))) };
  }).sort((a, b) => b.score - a.score);

  // Un look real se compone con ropa: garantiza ≥2 piezas de categorías
  // amigas a la silueta (si existen en el pool) en vez de puro accesorio.
  let scored = ranked.slice(0, limit);
  if (shapeBias && shapeCats.length) {
    const inShape = () => scored.filter((x) => shapeCats.includes(x.category)).length;
    const poolRest = ranked.slice(limit).filter((x) => shapeCats.includes(x.category));
    let i = 0;
    while (inShape() < 2 && poolRest[i]) {
      const idx = scored.map((x) => shapeCats.includes(x.category)).lastIndexOf(false);
      if (idx < 0) break;
      scored[idx] = poolRest[i++];
    }
  }

  const reasons = [];
  if (colorNames.length) reasons.push(`paleta ${analysis.harmony.toLowerCase()} (${colorNames.slice(0, 3).join(', ')})`);
  if (analysis.body) reasons.push(`silueta ${analysis.body.label.toLowerCase()} — corte que ${shapeBias?.why || 'favorece tu figura'}`);
  if (analysis.formality) reasons.push(analysis.formality.toLowerCase());
  if (hist) reasons.push(`tu historial de ${hist.items} compra(s)`);
  const reply = `Según tu foto (${reasons.join(' + ')}), estas prendas del catálogo realzan tu estilo y están disponibles ahora ✨`;

  return { reply, products: scored, historyUsed: Boolean(hist), bodyUsed: Boolean(shapeBias), engine: 'local' };
}
