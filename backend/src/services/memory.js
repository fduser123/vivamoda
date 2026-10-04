// =====================================================================
// MEMORIA DE ARIA — lo que el agente aprende de cada cliente
// ---------------------------------------------------------------------
// Dos fuentes de aprendizaje:
//   1) La conversación: extrae preferencias de lo que el cliente escribe
//      (talla, presupuesto, colores, ocasiones, para quién busca…).
//   2) La base de datos: señales de su historial de compras (talla más
//      comprada, colores, categorías, ticket medio) y de sus clics sobre
//      las recomendaciones (ai_events → feedback implícito).
// Todo se guarda en `ai_memory` y se inyecta en cada respuesta, de modo
// que Aria "recuerda" entre mensajes, sesiones y dispositivos.
// =====================================================================
import { pool } from '../db.js';

const COLORS = ['negro', 'blanco', 'azul', 'rojo', 'verde', 'rosa', 'fucsia', 'beige', 'gris',
  'morado', 'violeta', 'amarillo', 'naranja', 'dorado', 'plateado', 'marfil', 'vino', 'camel',
  'marrón', 'marron', 'crema', 'turquesa', 'lila', 'mostaza', 'terracota'];
const OCCASIONS = ['boda', 'matrimonio', 'cóctel', 'coctel', 'gala', 'entrevista', 'oficina', 'trabajo',
  'graduación', 'graduacion', 'fiesta', 'quinceañera', 'bautizo', 'gimnasio', 'entrenar', 'viaje',
  'playa', 'universidad', 'cita', 'cumpleaños', 'navidad'];
const STYLES = ['clásico', 'clasico', 'romántico', 'romantico', 'minimalista', 'urbano', 'boho',
  'elegante', 'deportivo', 'streetwear', 'vintage', 'casual'];

/** Etiquetas legibles para mostrar en la UI ("🧠 Recordé: …"). */
export const FACT_LABELS = {
  talla: 'talla', presupuesto: 'presupuesto', color_favorito: 'color favorito',
  color_evitar: 'color a evitar', ocasion: 'ocasión', estilo: 'estilo',
  genero_interes: 'para quién busca', estatura: 'estatura', medidas: 'medidas',
  ticket_medio: 'ticket medio', colores_comprados: 'colores que compra',
  categorias_compradas: 'categorías que compra', pedidos: 'pedidos',
};

// ---------------------------------------------------------------
// 1) Extracción desde el mensaje (reglas determinísticas, sin coste)
// ---------------------------------------------------------------
function findColor(text) {
  return COLORS.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(text)) || null;
}

/** Devuelve [{key, value, confidence}] con lo aprendido en el mensaje. */
export function extractFacts(message) {
  const msg = String(message || '');
  const low = msg.toLowerCase();
  const facts = [];
  const add = (key, value, confidence = 0.7) => {
    if (value && !facts.some((f) => f.key === key)) facts.push({ key, value: String(value), confidence });
  };

  // Talla ("uso talla M", "mi talla es L", "talla: 38")
  const size = low.match(/\btalla\s*:?\s*(xs|s|m|l|xl|xxl|\d{2})\b/i);
  if (size) add('talla', size[1].toUpperCase(), 0.85);

  // Medidas ("busto 92 cm", "cintura de 70")
  const bust = low.match(/\bbusto\s*(?:de\s*)?(\d{2,3})\s*(?:cm)?/);
  if (bust) add('medidas', `busto ${bust[1]} cm`, 0.9);
  const waist = low.match(/\bcintura\s*(?:de\s*)?(\d{2,3})\s*(?:cm)?/);
  if (waist) add('medidas', `cintura ${waist[1]} cm`, 0.85);

  // Estatura en metros ("mido 1.68")
  const height = msg.match(/\b1[.,](\d{2})\s*(?:m\b|metros)?/i);
  if (height) add('estatura', `1.${height[1]} m`, 0.8);

  // Presupuesto ("presupuesto 80", "hasta $120", "no más de 50")
  const budget = low.match(/\b(?:presupuesto|puedo gastar|tengo|cuento con|hasta|máximo|maximo|no\s+m[áa]s\s+de|menos\s+de)\s*(?:unos\s*)?(?:de\s*)?\$\s*(\d{2,5})\b/)
    || low.match(/\b(?:presupuesto|puedo gastar|cuento con)\s*(?:de\s*)?(\d{2,5})\b/);
  if (budget) add('presupuesto', `$${budget[1]}`, 0.75);

  // Vetos primero: "no me gusta el amarillo" NO es que le guste el amarillo.
  const NEGACION = /(?:no\s+me\s+(?:gusta|gustan)|no\s+le\s+(?:gusta|gustan)|odio|odia|odian|evita|evitar|nada\s+de)\s+([^.;,]{0,40})/;
  const dislikes = low.match(NEGACION);
  if (dislikes) {
    const color = findColor(dislikes[1]);
    if (color) add('color_evitar', color, 0.8);
  }
  // Los gustos se buscan en el texto SIN las frases negativas
  // (cubre "me gusta el negro" y "para mi hermana le gusta el azul").
  const sinNegaciones = low.replace(new RegExp(NEGACION.source, 'g'), ' ');
  const likes = sinNegaciones.match(/(?:me\s+(?:gusta|gustan|encanta|encantan)|le\s+(?:gusta|gustan|encanta|encantan)|prefiero|prefiere|amo|me\s+va)\s+([^.;,]{3,40})/);
  if (likes) {
    const color = findColor(likes[1]);
    if (color) add('color_favorito', color, 0.8);
  }

  // Ocasión recurrente
  const occasion = OCCASIONS.find((o) => new RegExp(`\\bpara\\s+(?:una?\\s+|mi\\s+|el\\s+|la\\s+)?${o}`, 'i').test(low))
    || OCCASIONS.find((o) => new RegExp(`\\b${o}\\b`, 'i').test(low) && /\bpara\b/.test(low));
  if (occasion) add('ocasion', occasion, 0.7);

  // Estilo declarado
  const style = low.match(/\b(?:estilo|look)\s+([a-záéíóúñ]+)/i)?.[1];
  if (style && STYLES.some((s) => style.startsWith(s.slice(0, 5)))) add('estilo', style, 0.7);

  // Para quién busca
  if (/\bpara\s+(?:mi\s+)?(?:novio|esposo|marido|hermano|pap[áa]|padre|hijo|amigo|abuelo)\b/i.test(low)) add('genero_interes', 'caballeros', 0.75);
  else if (/\bpara\s+(?:mi\s+)?(?:novia|esposa|mujer|hermana|mam[áa]|madre|hija|amiga|abuela)\b/i.test(low)) add('genero_interes', 'damas', 0.75);
  else if (/\bpara\s+(?:el\s+|la\s+)?(?:ni[ñn][oa]|kids)\b/i.test(low)) add('genero_interes', 'ninos', 0.7);

  return facts;
}

// ---------------------------------------------------------------
// 2) Persistencia
// ---------------------------------------------------------------
/** Un cliente registrado guarda memoria por usuario; un visitante, por sesión. */
function owner({ userId, sessionKey }) {
  return { userId: userId || null, sessionKey: userId ? null : (sessionKey || null) };
}

/** Inserta o actualiza un hecho aprendido (sube confianza con cada repetición). */
export async function upsertFact({ userId, sessionKey, key, value, confidence = 0.6, source = 'chat' }) {
  const own = owner({ userId, sessionKey });
  const { rows } = await pool.query(
    `INSERT INTO ai_memory (user_id, session_key, key, value, confidence, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ((COALESCE(user_id, 0)), (COALESCE(session_key, '')), key)
     DO UPDATE SET value        = EXCLUDED.value,
                   hits         = ai_memory.hits + 1,
                   confidence   = LEAST(1.0, ai_memory.confidence + 0.10),
                   source       = EXCLUDED.source,
                   updated_at   = now()
     RETURNING key, value, hits, confidence`,
    [own.userId, own.sessionKey, key, value, confidence, source],
  );
  return rows[0];
}

/** Aprende de un mensaje del cliente. Devuelve [{key, value}] recién aprendido. */
export async function learnFromMessage({ userId, sessionKey, message }) {
  const learned = [];
  for (const fact of extractFacts(message)) {
    try {
      const row = await upsertFact({ ...fact, userId, sessionKey, source: 'chat' });
      if (row) learned.push({ key: fact.key, label: FACT_LABELS[fact.key] || fact.key, value: row.value, hits: row.hits });
    } catch (err) {
      console.warn('[memory] no pude guardar', fact.key, err.message);
    }
  }
  return learned;
}

/** Lee la memoria del cliente (usuario registrado o sesión anónima). */
export async function loadMemory({ userId, sessionKey }) {
  const own = owner({ userId, sessionKey });
  if (!own.userId && !own.sessionKey) return { rows: [], facts: {} };
  try {
    const { rows } = await pool.query(
      `SELECT key, value, confidence::float8 AS confidence, hits, source, updated_at
       FROM ai_memory
       WHERE (user_id = $1) OR ($1::int IS NULL AND session_key = $2)
       ORDER BY confidence DESC, updated_at DESC
       LIMIT 30`,
      [own.userId, own.sessionKey],
    );
    const facts = {};
    for (const r of rows) facts[r.key] = r.value;
    return { rows, facts };
  } catch (err) {
    console.warn('[memory] lectura falló:', err.message);
    return { rows: [], facts: {} };
  }
}

// ---------------------------------------------------------------
// 3) Aprendizaje desde la base de datos (compras reales)
// ---------------------------------------------------------------
/**
 * Analiza el historial de compras y guarda lo aprendido con fuente 'compras'.
 * Devuelve también las señales en crudo para que el ranking local las use.
 */
export async function learnFromOrders(userId) {
  if (!userId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT oi.size, oi.color, oi.product_name, oi.sku, oi.qty,
              oi.unit_price::float8 AS unit_price, p.category, p.gender,
              o.total::float8 AS total, o.created_at
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON p.id = oi.product_id
       WHERE o.user_id = $1 AND o.paid = TRUE AND o.status <> 'cancelled'
       ORDER BY o.created_at DESC
       LIMIT 60`,
      [userId],
    );
    if (!rows.length) return null;

    const count = (arr) => arr.reduce((m, v) => (v ? m.set(v, (m.get(v) || 0) + 1) : m), new Map());
    const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const topList = (map, n = 3) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

    const sizeTop = top(count(rows.map((r) => r.size)));
    const colorTop = topList(count(rows.map((r) => (r.color && r.color !== 'Único' ? String(r.color).toLowerCase() : null))));
    const catTop = topList(count(rows.map((r) => r.category)));
    const tickets = [...new Set(rows.map((r) => r.total))];
    const avgTicket = tickets.length ? tickets.reduce((s, t) => s + t, 0) / tickets.length : 0;
    const ordersCount = tickets.length;

    if (sizeTop) await upsertFact({ userId, key: 'talla', value: String(sizeTop).toUpperCase(), confidence: 0.85, source: 'compras' });
    if (colorTop.length) await upsertFact({ userId, key: 'colores_comprados', value: colorTop.join(', '), confidence: 0.8, source: 'compras' });
    if (catTop.length) await upsertFact({ userId, key: 'categorias_compradas', value: catTop.join(', '), confidence: 0.8, source: 'compras' });
    if (avgTicket > 0) await upsertFact({ userId, key: 'ticket_medio', value: `$${avgTicket.toFixed(2)}`, confidence: 0.75, source: 'compras' });
    if (ordersCount) await upsertFact({ userId, key: 'pedidos', value: String(ordersCount), confidence: 0.9, source: 'compras' });

    return { sizeTop, colorTop, catTop, avgTicket, ordersCount, recent: rows.slice(0, 5) };
  } catch (err) {
    console.warn('[memory] historial falló:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------
// 4) Feedback implícito (clics y compras sobre las recomendaciones)
// ---------------------------------------------------------------
const EVENT_WEIGHT = { recommended: 0, clicked: 1, added_to_cart: 2.5, purchased: 4 };

/** Registra una señal de interés del cliente sobre una prenda. */
export async function recordEvent({ userId, sessionKey, sku, event = 'clicked' }) {
  if (!sku) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO ai_events (user_id, session_key, sku, event) VALUES ($1, $2, $3, $4)
       RETURNING id, sku, event, created_at`,
      [userId || null, sessionKey || null, String(sku).slice(0, 40), String(event).slice(0, 24)],
    );
    return rows[0];
  } catch (err) {
    console.warn('[memory] evento falló:', err.message);
    return null;
  }
}

/** Refuerzo de interés por prenda (sube lo que el cliente miró o compró). */
export async function interestBoost({ userId, sessionKey }) {
  try {
    const { rows } = await pool.query(
      `SELECT sku, event, COUNT(*)::int AS times
       FROM ai_events
       WHERE created_at > now() - interval '30 days'
         AND ((user_id = $1) OR ($1::int IS NULL AND session_key = $2))
       GROUP BY sku, event`,
      [userId || null, userId ? null : (sessionKey || null)],
    );
    const boost = new Map();
    for (const r of rows) {
      const w = (EVENT_WEIGHT[r.event] || 0.5) * Math.min(r.times, 5);
      boost.set(r.sku, (boost.get(r.sku) || 0) + w);
    }
    return boost;
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------
// 5) Bloque de contexto para el prompt del LLM
// ---------------------------------------------------------------
export function memoryBlock(memory, signals) {
  const lines = [];
  const f = memory?.facts || {};
  const label = (k, txt) => { if (f[k]) lines.push(`- ${txt}: ${f[k]}`); };

  label('talla', 'Talla');
  label('medidas', 'Medidas');
  label('estatura', 'Estatura');
  label('presupuesto', 'Presupuesto que mencionó');
  label('color_favorito', 'Le gusta');
  label('color_evitar', 'Prefiere evitar (NO lo propongas como primera opción)');
  label('ocasion', 'Ocasión frecuente');
  label('estilo', 'Estilo');
  label('genero_interes', 'Busca para');
  if (signals?.ordersCount) {
    lines.push(`- Historial: ${signals.ordersCount} pedido(s), ticket medio $${signals.avgTicket.toFixed(2)}` +
      (signals.catTop.length ? `, categorías habituales: ${signals.catTop.join(', ')}` : ''));
  }
  label('colores_comprados', 'Colores que suele comprar');

  if (!lines.length) return null;
  return 'MEMORIA DEL CLIENTE (aprendida de conversaciones y compras anteriores; úsala con naturalidad, sin enumerarla):\n' + lines.join('\n');
}
