// =====================================================================
// CONTEXTO DE ARIA — todo lo que el agente sabe antes de responder
// ---------------------------------------------------------------------
// Reúne, en una sola pasada y con consultas baratas:
//   · Memoria aprendida (preferencias del chat + historial de compras)
//   · Perfil del cliente y sus pedidos recientes (estado, guía, tracking)
//   · Carrito en vivo (para "¿qué llevo?" y no repetir recomendaciones)
//   · Stock real por talla y tienda de las prendas sugeridas
//   · Ofertas activas del catálogo
//   · Búsquedas en internet cuando la pregunta es de conocimiento
// Ese contexto alimenta tanto al LLM como al motor local de reglas.
// =====================================================================
import { pool } from '../db.js';
import { loadMemory, learnFromOrders, interestBoost, memoryBlock } from './memory.js';
import { needsWebSearch, webSearch, webResultsBlock } from './websearch.js';

// ---------------------------------------------------------------
// Consultas de apoyo
// ---------------------------------------------------------------
async function loadProfile(userId) {
  if (!userId) return null;
  try {
    const [{ rows: userRows }, { rows: orderRows }, { rows: cartRows }, { rows: wish }] = await Promise.all([
      pool.query(`SELECT id, full_name, email, role, vip_tier, interests, points FROM users WHERE id = $1`, [userId]),
      pool.query(
        `SELECT COUNT(*)::int AS pedidos, COALESCE(SUM(total), 0)::float8 AS gastado, MAX(created_at) AS ultimo
         FROM orders WHERE user_id = $1 AND paid = TRUE AND status <> 'cancelled'`,
        [userId],
      ),
      pool.query(
        `SELECT p.name, p.sku, ci.qty, p.price::float8 AS price
         FROM carts c JOIN cart_items ci ON ci.cart_id = c.id
         JOIN products p ON p.id = ci.product_id
         WHERE c.user_id = $1 ORDER BY ci.id DESC LIMIT 8`,
        [userId],
      ),
      pool.query(`SELECT COUNT(*)::int AS total FROM wishlists WHERE user_id = $1`, [userId]),
    ]);
    const u = userRows[0];
    if (!u) return null;
    return {
      name: u.full_name || u.email,
      role: u.role,
      loyalty: u.vip_tier || null,
      interests: Array.isArray(u.interests) ? u.interests : [],
      points: u.points || 0,
      orders: orderRows[0]?.pedidos || 0,
      spent: orderRows[0]?.gastado || 0,
      lastOrderAt: orderRows[0]?.ultimo || null,
      cart: cartRows,
      wishlist: wish[0]?.total || 0,
    };
  } catch (err) {
    console.warn('[chat-context] perfil falló:', err.message);
    return null;
  }
}

async function loadRecentOrders(userId) {
  if (!userId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT order_no, status, courier, tracking_no, total::float8 AS total, created_at
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3`,
      [userId],
    );
    return rows;
  } catch {
    return [];
  }
}

async function loadOffers() {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS ofertas, MIN(price)::float8 AS desde
       FROM products p
       WHERE p.is_active = TRUE AND p.compare_at IS NOT NULL AND p.compare_at > p.price
         AND EXISTS (SELECT 1 FROM product_variants v JOIN inventory i ON i.variant_id = v.id
                     WHERE v.product_id = p.id AND i.qty > 0)`,
    );
    return rows[0] || { ofertas: 0, desde: null };
  } catch {
    return { ofertas: 0, desde: null };
  }
}

/** Stock real por talla y tiendas donde hay unidades, para las prendas sugeridas. */
export async function stockForSkus(skus = []) {
  const list = [...new Set(skus.filter(Boolean))].slice(0, 6);
  if (!list.length) return new Map();
  try {
    const { rows } = await pool.query(
      `SELECT p.sku, v.size, SUM(i.qty)::int AS qty,
              STRING_AGG(DISTINCT s.name, ', ' ORDER BY s.name) FILTER (WHERE i.qty > 0) AS tiendas
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN inventory i ON i.variant_id = v.id
       LEFT JOIN stores s ON s.id = i.store_id
       WHERE p.sku = ANY($1::text[])
       GROUP BY p.sku, v.size
       ORDER BY p.sku, v.size`,
      [list],
    );
    const map = new Map();
    for (const r of rows) {
      const entry = map.get(r.sku) || { sizes: [], tiendas: new Set(), total: 0 };
      if (r.qty > 0) {
        entry.sizes.push(r.size);
        entry.total += r.qty;
        if (r.tiendas) r.tiendas.split(', ').forEach((t) => entry.tiendas.add(t));
      }
      map.set(r.sku, entry);
    }
    for (const v of map.values()) v.tiendas = [...v.tiendas];
    return map;
  } catch (err) {
    console.warn('[chat-context] stock falló:', err.message);
    return new Map();
  }
}

// ---------------------------------------------------------------
// Ranking con memoria + interés aprendido
// ---------------------------------------------------------------
const money = (n) => Number(String(n || '').replace(/[^\d.]/g, '')) || 0;

/**
 * Reordena las prendas candidatas usando lo aprendido: preferencias de color,
 * categorías compradas antes, presupuesto y clics previos. Devuelve el array
 * con `reason` (por qué subió) para poder explicarlo en la UI.
 */
export function rankProducts(products, ctx) {
  const facts = ctx?.memory?.facts || {};
  const boost = ctx?.interest || new Map();
  const liked = String(facts.color_favorito || '').toLowerCase();
  const avoided = String(facts.color_evitar || '').toLowerCase();
  const cats = String(facts.categorias_compradas || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const budget = money(facts.presupuesto);

  return products
    .map((p) => {
      const hay = `${p.name} ${p.category} ${p.badge || ''}`.toLowerCase();
      let score = 0;
      const reasons = [];
      if (liked && hay.includes(liked)) { score += 3; reasons.push(`le gusta el ${liked}`); }
      if (avoided && hay.includes(avoided)) { score -= 4; reasons.push(`evita el ${avoided}`); }
      if (cats.some((c) => c && hay.includes(c))) { score += 2; reasons.push('compra esta categoría'); }
      if (budget && Number(p.price) <= budget) { score += 1.5; reasons.push('dentro de su presupuesto'); }
      const interestScore = boost.get(p.sku) || 0;
      if (interestScore) { score += interestScore; reasons.push('lo miró antes'); }
      return { ...p, score, reason: reasons.join(' · ') || null };
    })
    // Orden ESTABLE: solo por lo aprendido. El desempate anterior por
    // `review_count` pisaba la relevancia que ya había calculado el motor
    // (prioridad de categoría según el evento, color pedido…), y por eso una
    // boda acababa encabezada por la prenda con más reseñas, no por un vestido.
    // `searchProducts` ya ordena por popularidad dentro de cada categoría.
    .sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------
// Construcción del contexto completo
// ---------------------------------------------------------------
export async function buildChatContext({ userId, sessionKey, message, intent, genderFallback = 'damas' }) {
  const memory = await loadMemory({ userId, sessionKey });
  const contextParts = [];

  // Aprender del historial de compras solo la primera vez de cada cliente.
  let signals = null;
  if (userId && !memory.facts.pedidos) {
    signals = await learnFromOrders(userId);
    if (signals) {
      const refreshed = await loadMemory({ userId, sessionKey });
      memory.rows = refreshed.rows;
      memory.facts = refreshed.facts;
    }
  }

  const [profile, orders, offers, interest] = await Promise.all([
    loadProfile(userId),
    loadRecentOrders(userId),
    loadOffers(),
    interestBoost({ userId, sessionKey }),
  ]);

  const memoryText = memoryBlock(memory, signals);
  if (memoryText) contextParts.push(memoryText);

  if (profile) {
    const bits = [`Cliente: ${profile.name}${profile.loyalty ? ` (${profile.loyalty})` : ''}`];
    bits.push(profile.orders
      ? `ha comprado ${profile.orders} vez/veces por $${profile.spent.toFixed(2)} en total`
      : 'aún no tiene compras registradas');
    if (profile.cart.length) {
      bits.push(`lleva en el carrito: ${profile.cart.map((c) => `${c.name} x${c.qty}`).join(', ')}`);
    }
    if (profile.wishlist) bits.push(`${profile.wishlist} prenda(s) en favoritos`);
    if (profile.interests.length) bits.push(`intereses declarados: ${profile.interests.join(', ')}`);
    if (profile.points) bits.push(`${profile.points} puntos de fidelidad`);
    contextParts.push('PERFIL DEL CLIENTE (datos reales de la base de datos):\n- ' + bits.join('\n- '));
  }

  if (orders.length) {
    contextParts.push('PEDIDOS RECIENTES (para consultas de estado o entrega):\n' + orders
      .map((o) => `- ${o.order_no} · ${o.status} · $${o.total.toFixed(2)} · ${o.courier || 'sin courier'}${o.tracking_no ? ` · guía ${o.tracking_no}` : ''}`)
      .join('\n'));
  }

  if (offers.ofertas) {
    contextParts.push(`PROMOCIONES ACTIVAS: ${offers.ofertas} prenda(s) con descuento real y stock disponible (desde $${Number(offers.desde || 0).toFixed(2)}).`);
  }

  // Internet solo cuando la pregunta es de conocimiento, no del catálogo.
  let web = null;
  if (needsWebSearch(message, intent)) {
    web = await webSearch(message, { limit: 4 });
    const webText = webResultsBlock(web);
    if (webText) contextParts.push(webText);
  }

  return {
    memory,
    signals,
    profile,
    orders,
    offers,
    interest,
    web,
    contextParts,
    gender: memory.facts.genero_interes || genderFallback,
  };
}
