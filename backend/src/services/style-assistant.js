// =====================================================================
// ASESOR DE ESTILISMO CON RAG
//
// Pipeline (el que describe la orden de la Fase 1):
//
//   consulta del usuario
//        ↓
//   [Planner]      el LLM traduce la pregunta a filtros estructurados
//                  (categoría, color, ocasión, precio, género)
//        ↓
//   [Retrieval]    pgvector: similitud FashionCLIP + filtros de metadatos
//                  (top-K = 20)
//        ↓
//   [Re-ranker]    reordena por coincidencia semántica Y de atributos
//                  (top-N = 5)
//        ↓
//   [Generator]    el LLM redacta la recomendación
//        ↓
//   respuesta + los productos reales usados
//
// Regla de oro: el generador SÓLO puede recomendar lo que le llega en el
// contexto. Después se comprueba qué productos citó y si todos existen.
// =====================================================================
import { llmProvider, callChat, chatErrorReason } from './llm-provider.js';
import { buscarPorVector, embedText, estadoEmbeddings } from './vector-search.js';

const TOP_K = 20; // candidatos que recupera el vectorial
const TOP_N = 5;  // productos que pasan al generador

// ── 1) PLANNER ───────────────────────────────────────────────────────
const PROMPT_PLANNER = `Eres el planificador de un buscador de moda. Traduce la petición del cliente a un JSON de filtros.

Devuelve SOLO JSON válido, sin markdown, con esta forma exacta:
{
  "genero": "damas" | "caballeros" | "ninos" | null,
  "categoria": "categoría del catálogo o null",
  "prenda": "tipo de prenda o null (vestido, blusa, camisa, pantalon, falda, chaqueta, abrigo, bolso, zapatos, accesorio)",
  "color": "color principal o null",
  "ocasion": ["formal","casual","fiesta","noche","oficina","playa","deporte","boda","diario"],
  "precioMax": número o null,
  "consulta_semantica": "la petición reformulada como búsqueda de prendas, en español"
}

Reglas:
- Si el cliente no menciona un filtro, usa null (o lista vacía).
- "para mi novio" → genero "caballeros". "para mi hija" → "ninos". "para mí" y sin más datos → null.
- Traduce precios a número: "menos de 50 dólares" → 50.
- En "consulta_semantica" describe la PRENDA buscada, no la conversación.`;

function filtrosVacios() {
  return { genero: null, categoria: null, prenda: null, color: null, ocasion: [], precioMax: null, consulta_semantica: null };
}

// Vocabulario del planificador heurístico. Cuanto mejor cubra esto, menos
// veces hay que llamar al LLM (que costaba 1,6 s por consulta).
const OCASIONES = [
  [/boda|novia|novio|casad|casamiento|enlace|invitad/, 'boda'],
  [/playa|mar\b|veranieg|tropical|resort/, 'playa'],
  [/fiesta|cumplea|nochevieja|año nuevo|celebra|guateque|discoteca/, 'fiesta'],
  [/noche|nocturn|cena|gala|c[oó]ctel/, 'noche'],
  [/oficina|trabajo|laboral|entrevista|reuni[oó]n|ejecutiv|corporativ/, 'oficina'],
  [/formal|elegante|protocolo|etiqueta|ceremonia/, 'formal'],
  [/casual|diario|informal|finde|c[oó]mod/, 'casual'],
  [/deport|entrenar|entrenamiento|gym|gimnasio|yoga|running|correr|fitness|athleisure/, 'deporte'],
];

const PRENDAS = [
  [/vestido/, 'vestido'],
  [/blusa|blus[oó]n/, 'blusa'],
  [/camisa|camiseta/, 'camisa'],
  [/\btop\b/, 'top'],
  [/pantal[oó]n|jeans?\b|vaquero/, 'pantalon'],
  [/falda/, 'falda'],
  [/chaqueta|chaquet[oó]n|bomber/, 'chaqueta'],
  [/abrigo|parka|trenca|anorak/, 'abrigo'],
  [/conjunto|traje|blazer|sastre|americano/, 'conjunto'],
  [/sudadera|hoodie|jersey|su[eé]ter/, 'sudadera'],
  [/short/, 'short'],
  [/kaft[aá]n|caft[aá]n/, 'kaftan'],
  [/zapat|tac[oó]n|sandalia|bot[ií]n|zapatilla|sneaker|mocas[ií]n|bailarina|stiletto/, 'zapatos'],
  [/bolso|cartera|clutch|mochila|bandolera/, 'bolso'],
  [/joya|collar|arete|pulsera|anillo|pendiente|tocado/, 'joya'],
  [/gafas|lentes|anteojos/, 'gafas'],
  [/reloj/, 'reloj'],
  [/gorra|sombrero|gorro|bufanda|cintur[oó]n/, 'accesorio'],
  [/ropa interior|sujetador|braga|lencer[ií]a|pijama|ba[nñ]ador|bikini/, 'ropa interior'],
];

const COLORES = ['negro', 'blanco', 'azul', 'rojo', 'verde', 'rosa', 'fucsia', 'beige', 'gris',
  'dorado', 'plateado', 'marron', 'marrón', 'morado', 'amarillo', 'naranja', 'turquesa',
  'lila', 'vino', 'camel', 'crema', 'mostaza', 'coral', 'nude'];

/** Heurística de respaldo si el LLM no está disponible o devuelve basura. */
export function planHeuristico(mensaje) {
  const m = String(mensaje || '').toLowerCase();
  const f = filtrosVacios();

  f.ocasion = [...new Set(OCASIONES.filter(([re]) => re.test(m)).map(([, v]) => v))];
  const prenda = PRENDAS.find(([re]) => re.test(m));
  if (prenda) f.prenda = prenda[1];

  if (/\b(novio|marido|esposo|hombre|caballero|chico|él)\b/.test(m)) f.genero = 'caballeros';
  else if (/\b(ni[nñ]a|ni[nñ]o|hija|hijo|kids|infantil)\b/.test(m)) f.genero = 'ninos';
  else if (/\b(mujer|dama|ella|novia|esposa|chica|invitada)\b/.test(m)) f.genero = 'damas';

  const col = m.match(new RegExp(`\\b(${COLORES.join('|')})\\b`));
  if (col) f.color = col[1];
  // "tonos fríos/cálidos" no es un color concreto: se deja al vectorial
  if (/tonos?\s+(fr[ií]os?|c[aá]lidos?)/.test(m)) f.color = null;

  const pr = m.match(/(?:menos de|hasta|m[aá]ximo|por debajo de|no m[aá]s de|inferior a)\s*\$?\s*(\d+)/)
    || m.match(/\$\s*(\d+)/);
  if (pr) f.precioMax = Number(pr[1]);

  f.consulta_semantica = String(mensaje || '').slice(0, 300);
  return f;
}

/**
 * Planner híbrido.
 *
 * La orden describe un planner LLM. Medido, esa llamada costaba ~1,6 s y era,
 * junto a la generación, prácticamente toda la latencia (el retrieval son
 * 4 ms): el total quedaba en ~3,5 s y rompía el criterio de p95 < 3 s.
 *
 * Como la heurística acierta los filtros habituales (ocasión, color, precio,
 * género, tipo de prenda), se usa ella primero y el LLM sólo entra cuando la
 * consulta no da ninguna señal ("busco algo bonito"). Así se conserva el
 * planner LLM donde aporta valor y se cumple el objetivo de latencia.
 */
export async function planificar(mensaje) {
  const heur = planHeuristico(mensaje);
  const senales = (heur.ocasion.length ? 1 : 0) + (heur.color ? 1 : 0)
    + ((heur.prenda || heur.categoria) ? 1 : 0) + (heur.precioMax ? 1 : 0)
    + (heur.genero ? 1 : 0);
  if (senales >= 1) return { plan: heur, origen: 'heuristica' };

  const provider = llmProvider();
  if (!provider) return { plan: heur, origen: 'heuristica' };
  try {
    const { ok, status, body } = await callChat(provider, {
      model: provider.model,
      messages: [
        { role: 'system', content: PROMPT_PLANNER },
        { role: 'user', content: String(mensaje).slice(0, 600) },
      ],
      max_tokens: 400,
      temperature: 0,
    }, { timeoutMs: 25_000, attempts: 1, tag: 'planner' });
    if (!ok) throw new Error(chatErrorReason({ status, body }));
    const txt = (body?.choices?.[0]?.message?.content || '').replace(/^```(?:json)?|```$/gm, '').trim();
    const j = JSON.parse(txt);
    return {
      plan: { ...filtrosVacios(), ...j, ocasion: Array.isArray(j.ocasion) ? j.ocasion : [] },
      origen: 'llm',
    };
  } catch (err) {
    console.warn('[rag] planner LLM falló, uso heurística:', err.message);
    return { plan: planHeuristico(mensaje), origen: 'heuristica' };
  }
}

// ── 2) RE-RANKER ─────────────────────────────────────────────────────
/**
 * Reordena los candidatos combinando la similitud vectorial con la
 * coincidencia EXPLÍCITA de atributos.
 *
 * Nota de honestidad: la orden recomienda un cross-encoder (BGE Reranker
 * v2-m3). No se ha instalado porque pesa ~2 GB y el disco está al 97 %;
 * en su lugar se usa este reordenado determinista, que sí aprovecha los
 * metadatos que extrajo la visión. Es sustituible sin tocar el resto del
 * pipeline: basta con cambiar esta función.
 */
// El catálogo está dominado por complementos (joyería 83, accesorios 78,
// bolsos 50 frente a un puñado de vestidos). En una pregunta de outfit,
// ordenar solo por similitud llena el top-5 de bolsos y toccados, así que el
// re-ranker distingue qué es prenda principal y qué es complemento.
const PRENDA_PRINCIPAL = new Set([
  'vestido', 'blusa', 'camisa', 'top', 'pantalon', 'pantalón', 'falda', 'chaqueta',
  'abrigo', 'conjunto', 'sudadera', 'body', 'jersey', 'short', 'traje', 'enterizo', 'kaftan', 'kaftán',
]);
const COMPLEMENTO = new Set([
  'bolso', 'joya', 'gafas', 'reloj', 'accesorio', 'cinturon', 'cinturón', 'sombrero',
  'gorra', 'tocado', 'bufanda', 'gorro',
]);
const RE_OUTFIT = /(qu[eé] me pongo|look|outfit|conjunto|combinar|vestir|atuendo|invitada|invitado)/i;

export function reordenar(candidatos, plan, consulta) {
  const q = String(consulta || '').toLowerCase();
  const esOutfit = RE_OUTFIT.test(q);
  return candidatos
    .map((c) => {
      const motivos = [];
      let score = Number(c.similitud || 0) * 0.62; // base: similitud FashionCLIP

      // Jerarquía prenda / complemento para preguntas de outfit
      const g = String(c.garment_type || '').toLowerCase();
      if (esOutfit && g) {
        if (PRENDA_PRINCIPAL.has(g)) { score += 0.16; motivos.push('prenda principal'); }
        else if (g === 'zapatos') { score += 0.06; motivos.push('calzado'); }
        else if (COMPLEMENTO.has(g)) { score -= 0.05; }
      }

      // Coincidencia de ocasión (el atributo con más peso estilístico)
      const ocs = Array.isArray(c.occasion) ? c.occasion : [];
      const pedidas = plan.ocasion || [];
      const ocsComunes = ocs.filter((o) => pedidas.includes(o));
      if (ocsComunes.length) {
        score += 0.16 * Math.min(1, ocsComunes.length / 2);
        motivos.push(`ocasión ${ocsComunes.join('/')}`);
      } else if (pedidas.length && ocs.length) {
        score -= 0.06; // pide una ocasión y la prenda declara otra
      }

      // Coincidencia de color
      if (plan.color && c.color_main) {
        const a = String(c.color_main).toLowerCase();
        const b = String(plan.color).toLowerCase();
        if (a.includes(b) || b.includes(a)) { score += 0.12; motivos.push(`color ${c.color_main}`); }
      }

      // Tipo de prenda
      if (plan.prenda && c.garment_type) {
        const a = String(c.garment_type).toLowerCase();
        const b = String(plan.prenda).toLowerCase();
        if (a.includes(b) || b.includes(a)) { score += 0.10; motivos.push(`es ${c.garment_type}`); }
      }

      // La consulta menciona el tipo o el color y la prenda lo cumple
      for (const campo of ['garment_type', 'color_main', 'material', 'pattern']) {
        const v = c[campo];
        if (v && q.includes(String(v).toLowerCase().split(' ')[0])) { score += 0.04; }
      }

      // Disponibilidad real y buena valoración como desempate suave
      if (Number(c.stock_total) > 0) score += 0.02;
      if (Number(c.rating) >= 4) score += 0.02;

      return { ...c, score_rerank: Number(score.toFixed(4)), motivos };
    })
    .sort((a, b) => b.score_rerank - a.score_rerank);
}

// ── 3) GENERADOR ─────────────────────────────────────────────────────
export const PROMPT_GENERADOR = `Eres un estilista personal de la tienda VivaModa.
Tienes acceso ÚNICAMENTE a los siguientes productos del catálogo:

{contexto_productos}

Reglas:
1. Solo puedes recomendar productos de la lista anterior. NO inventes ninguno.
2. Si ningún producto es adecuado, di: "No tengo productos que encajen con esa solicitud, pero puedo ayudarte con..."
3. Explica POR QUÉ cada producto encaja (ocasión, color, combinación).
4. Sugiere una combinación completa (top + bottom + calzado + accesorio) cuando sea posible.
5. Responde en el idioma del usuario, en español salvo que escriba en otro idioma.
6. Sé breve: máximo 130 palabras. Precios en USD con dos decimales.
7. Usa **negritas** para el nombre de cada prenda recomendada.`;

/** Formatea los productos que verá el generador. */
export function contextoProductos(productos) {
  return productos.map((p, i) => {
    const partes = [
      `${i + 1}. ${p.name}`,
      `categoría: ${p.category}`,
      `precio: $${Number(p.price).toFixed(2)}`,
    ];
    if (p.color_main) partes.push(`color: ${p.color_main}`);
    if (p.garment_type) partes.push(`tipo: ${p.garment_type}`);
    if (p.material && p.material !== 'no identificable') partes.push(`material: ${p.material}`);
    if (Array.isArray(p.occasion) && p.occasion.length) partes.push(`ocasión: ${p.occasion.join('/')}`);
    if (p.style_notes) partes.push(`nota: ${p.style_notes}`);
    partes.push(`tallas: ${(p.sizes || []).join('/') || 'consultar'}`);
    partes.push(`stock: ${p.stock_total}`);
    partes.push(`sku: ${p.sku}`);
    return '- ' + partes.join(' · ');
  }).join('\n');
}

/**
 * Comprueba el grounding: qué productos nombró el modelo y si todos existen
 * en el contexto. Es el criterio de aceptación del 100 %.
 *
 * Ojo con los falsos positivos: el modelo escribe en negrita tanto productos
 * como rótulos ("**Combinación completa:**") y a veces abrevia el nombre
 * ("**Conjunto Cobalt**" por "Conjunto Blazer & Pantalón Cobalt"). Comparar
 * cadenas literales marcaba ambas cosas como invención, así que se ignoran los
 * rótulos y se compara por palabras significativas.
 */
const _norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const _STOP = new Set(['de', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'the', 'and',
  'combinacion', 'completa', 'look', 'total', 'outfit', 'estilo', 'opcion', 'opciones']);

const _tokens = (s) => _norm(s).split(' ').filter((w) => w.length > 2 && !_STOP.has(w));

export function verificarCitados(texto, productos) {
  const t = _norm(texto);
  const citados = productos.filter((p) => t.includes(_norm(p.name)));

  const enNegrita = [...String(texto || '').matchAll(/\*\*([^*]{3,80})\*\*/g)].map((m) => m[1].trim());
  const nombres = productos.map((p) => ({ name: p.name, toks: _tokens(p.name) }));

  const inventados = [];
  for (const frase of enNegrita) {
    if (/[:：]\s*$/.test(frase)) continue;          // rótulo, no producto
    const ft = _tokens(frase);
    if (!ft.length) continue;
    const cubierto = nombres.some((n) => {
      if (!n.toks.length) return false;
      const comunes = ft.filter((w) => n.toks.includes(w)).length;
      return comunes / ft.length >= 0.6;           // abreviatura razonable
    });
    if (!cubierto) inventados.push(frase);
  }

  return {
    citados: citados.map((p) => ({ sku: p.sku, name: p.name })),
    totalCitados: citados.length,
    inventados,
    groundingOk: inventados.length === 0,
  };
}

// ── 4) PIPELINE COMPLETO ─────────────────────────────────────────────
export async function responderEstilismo(mensaje, opts = {}) {
  const t0 = Date.now();
  const emb = await estadoEmbeddings();
  if (!emb.ok) {
    return { error: `Búsqueda vectorial no disponible: ${emb.reason}`, fase: 'embeddings' };
  }

  // 1) Planner y embedding EN PARALELO.
  // El vector se calcula sobre el mensaje original mientras el LLM extrae los
  // filtros: encadenarlos costaba una ida y vuelta extra al LLM y disparaba la
  // latencia por encima del objetivo de 3 s.
  const [planRes, vectores] = await Promise.all([
    planificar(mensaje),
    embedText([String(mensaje).slice(0, 400)]),
  ]);
  const { plan, origen } = planRes;
  const vectorConsulta = vectores[0];
  const msPlanEmbed = Date.now() - t0;

  // 2) Retrieval con filtros de metadatos
  const filtros = {
    genero: plan.genero || opts.genero || null,
    categoria: plan.categoria || null,
    prenda: plan.prenda || null,
    color: plan.color || null,
    ocasion: plan.ocasion && plan.ocasion.length ? plan.ocasion : null,
    precioMax: Number.isFinite(plan.precioMax) ? plan.precioMax : null,
  };
  const buscar = (f) => buscarPorVector(vectorConsulta, { k: TOP_K, espacio: 'mixto', filtros: f });
  let candidatos = await buscar(filtros);

  // Si los filtros dejan la búsqueda sin nada, se relajan por pasos para no
  // devolver "no tengo nada" cuando el problema era un filtro demasiado fino.
  let relajado = null;
  if (!candidatos.length) {
    const intentos = [
      ['ocasion', { ...filtros, ocasion: null }],
      ['color', { ...filtros, ocasion: null, color: null }],
      ['prenda', { ...filtros, ocasion: null, color: null, prenda: null }],
      ['categoria', { ...filtros, ocasion: null, color: null, prenda: null, categoria: null }],
      ['precio', { genero: filtros.genero }],
    ];
    for (const [que, f] of intentos) {
      const r = await buscar(f);
      if (r.length) { candidatos = r; relajado = que; break; }
    }
  }

  const msRetrieval = Date.now() - t0;

  // 3) Re-ranking
  const rankeados = reordenar(candidatos, plan, mensaje).slice(0, TOP_N);
  if (!rankeados.length) {
    return {
      respuesta: 'No tengo productos que encajen con esa solicitud, pero puedo ayudarte con otra ocasión o presupuesto.',
      productos: [], plan, relajado, ms: Date.now() - t0, grounding: { groundingOk: true, citados: [], inventados: [] },
    };
  }

  // 4) Generación anclada al contexto
  const provider = llmProvider();
  if (!provider) {
    return { error: 'No hay proveedor LLM configurado', productos: rankeados, plan, fase: 'generacion' };
  }
  const contexto = contextoProductos(rankeados);
  const { ok, status, body } = await callChat(provider, {
    model: provider.model,
    messages: [
      { role: 'system', content: PROMPT_GENERADOR.replace('{contexto_productos}', contexto) },
      { role: 'user', content: String(mensaje).slice(0, 800) },
    ],
    max_tokens: 500,
    temperature: 0.6,
  }, { timeoutMs: 60_000, attempts: 2, tag: 'rag' });

  if (!ok) {
    return { error: chatErrorReason({ status, body }), productos: rankeados, plan, fase: 'generacion', ms: Date.now() - t0 };
  }

  const respuesta = body?.choices?.[0]?.message?.content?.trim() || '';
  const grounding = verificarCitados(respuesta, rankeados);
  const msTotal = Date.now() - t0;

  return {
    respuesta,
    productos: rankeados,
    plan,
    planOrigen: origen,
    relajado,
    grounding,
    usage: body?.usage || null,
    ms: msTotal,
    // Desglose para saber dónde se va el tiempo (criterio: p95 < 3 s)
    fases: { plan_y_embedding: msPlanEmbed, retrieval: msRetrieval - msPlanEmbed, generacion: msTotal - msRetrieval },
  };
}
