import { pool } from '../db.js';
import { llmAvailable, llmStylistReply, llmStylistStream } from './llm.js';
import { buildChatContext, rankProducts, stockForSkus } from './chat-context.js';
import { learnFromMessage, FACT_LABELS } from './memory.js';
import { needsWebSearch } from './websearch.js';

// ---------------------------------------------------------------
// Búsqueda semántica ligera sobre el catálogo (reglas + SQL)
// ---------------------------------------------------------------
async function searchProducts({ gender, category, q, limit = 4, onlyStock = true, visibility = 'store' }) {
  const where = ['p.is_active = TRUE'];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (visibility) where.push(`p.visibility = ${p(visibility)}`);
  if (gender) where.push(`p.gender = ${p(gender)}`);
  if (category) where.push(`p.category ILIKE ${p(`%${category}%`)}`);
  if (q) where.push(`(p.name ILIKE ${p(`%${q}%`)} OR p.category ILIKE ${p(`%${q}%`)} OR p.badge ILIKE ${p(`%${q}%`)})`);
  if (onlyStock) where.push(`EXISTS (SELECT 1 FROM product_variants vv JOIN inventory ii ON ii.variant_id = vv.id WHERE vv.product_id = p.id AND ii.qty > 0)`);

  const { rows } = await pool.query(
    `SELECT p.id, p.sku, p.name, p.gender, p.category, p.badge, p.price::float8 AS price,
            p.compare_at::float8 AS compare_at, p.rating::float8 AS rating, p.review_count, p.image_url,
            COALESCE((SELECT SUM(i.qty) FROM inventory i JOIN product_variants v ON v.id = i.variant_id WHERE v.product_id = p.id), 0)::int AS stock_total
     FROM products p
     WHERE ${where.join(' AND ')}
     ORDER BY p.review_count DESC, p.rating DESC
     LIMIT ${limit}`,
    params,
  );
  return rows;
}

const EVENT_MAP = [
  { re: /(boda|novia|ceremonia|gala)/i, gender: 'damas', text: 'elegancia de ceremonia', occasion: 'una boda o gala' },
  { re: /(cóctel|coctel|terraza|fiesta|noche|gala)/i, gender: 'damas', text: 'alta noche', occasion: 'un cóctel o evento nocturno' },
  { re: /(entrevista|oficina|trabajo|formal|negocio)/i, gender: 'damas', text: 'poder femenino formal', occasion: 'la oficina o una entrevista' },
  { re: /(deporte|gym|gimnasio|entrenar)/i, gender: 'unisex', text: 'athleisure', occasion: 'entrenar o un look athleisure' },
  { re: /(casual|diario|outfit|look|vestir|conjunto|combinar)/i, gender: 'damas', text: 'versatilidad urbana', occasion: 'un look versátil de diario' },
  { re: /(niñ|niño|niña|hijo|hija|kids)/i, gender: 'ninos', text: 'diversión infantil', occasion: 'los más pequeños' },
  { re: /(hombre|él|caballero|novio)/i, gender: 'caballeros', text: 'sastrería moderna', occasion: 'un look masculino' },
];

const EVENT_CATEGORIES = {
  boda: 'Vestidos de Noche', coctel: 'Vestidos', gala: 'Vestidos de Noche', oficina: 'Sastrería', casual: 'Blusas', formal: 'Sastrería',
};

export function extractIntent(message) {
  const msg = ` ${String(message).toLowerCase()} `;
  // Intenciones personales: se resuelven con la base de datos del propio cliente.
  if (/(qu[eé] sabes de m[ií]|qu[eé] recuerdas|mis preferencias|mi perfil|qu[eé] tengo guardado)/.test(msg)) return 'memory';
  if (/(mi[s]? pedidos?|mi orden|mi compra|d[oó]nde est[áa]|estado de mi|n[uú]mero de pedido|rastrea|gu[ií]a|tracking)/.test(msg)) return 'orders';
  if (/(carrito|qu[eé] llevo|que llevo|mi bolsa|mi cesta)/.test(msg)) return 'cart';
  if (/(talla|medida|busto|contorno|estatura|1\.\d{2}\s*m|talle)/.test(msg)) return 'size';
  if (/(zapato|tacón|tacon|stiletto|calzado|sneaker)/.test(msg)) return 'shoes';
  if (/(envío|envio|entrega|llegar|domicilio)/.test(msg)) return 'shipping';
  if (/(devolución|devolucion|cambio|cambiar|reembolso)/.test(msg)) return 'returns';
  if (/(oferta|descuento|flash|rebaja|promo)/.test(msg)) return 'deals';
  if (/(combinar|accesorio|complement|qué me pongo|que me pongo)/.test(msg)) return 'accessorize';
  if (/(hola|buenas|buen día|buen dia|saludos)/.test(msg) && msg.length < 40) return 'greeting';
  return 'outfit';
}

export async function recommendForIntent(intent, ctx = {}) {
  // El género recordado ("busco para mi novio") tiene prioridad sobre el genérico
  const genderGuess = ctx.gender || 'damas';
  const facts = ctx.memory || {};
  let products = [];
  let text = '';

  // Frase corta con lo aprendido, para que el cliente note que Aria lo recuerda.
  const remembered = [];
  const rememberedOther = []; // sin la talla: evita repetirla cuando ya se habla de tallas
  if (facts.talla) remembered.push(`tu talla **${facts.talla}**`);
  if (facts.presupuesto) { const s = `tu presupuesto de ${facts.presupuesto}`; remembered.push(s); rememberedOther.push(s); }
  if (facts.color_favorito) { const s = `que te gusta el **${facts.color_favorito}**`; remembered.push(s); rememberedOther.push(s); }
  const recall = remembered.length ? `Recuerdo ${remembered.join(', ')}. ` : '';
  const recallOther = rememberedOther.length ? `Recuerdo ${rememberedOther.join(', ')}. ` : '';

  if (intent === 'memory') {
    const rows = ctx.memoryRows || [];
    text = rows.length
      ? `Esto es lo que he aprendido de ti: ${rows.slice(0, 8).map((r) => `**${FACT_LABELS[r.key] || r.key}**: ${r.value}`).join(' · ')}. ` +
        '¿Quieres corregir o añadir algo? Lo aprendo al instante.'
      : 'Todavía no sé nada de ti 🙂 Cuéntame tu talla, tus colores favoritos o para qué ocasión buscas, y lo recordaré para tus próximas visitas.';
  } else if (intent === 'cart') {
    const cart = ctx.profile?.cart || [];
    const total = cart.reduce((s, c) => s + (Number(c.price) || 0) * c.qty, 0);
    text = cart.length
      ? `Llevas ${cart.length} prenda(s) en el carrito: ${cart.map((c) => `**${c.name}** x${c.qty}`).join(', ')}. ` +
        `Total aproximado **$${total.toFixed(2)}**${total >= 49.99 ? ' (ya tiene envío express gratis)' : ' — te faltan $' + (49.99 - total).toFixed(2) + ' para el envío gratis'}. ` +
        '¿Buscamos algo que combine con ese look?'
      : 'Tu carrito está vacío. Dime la ocasión y te armo un look completo con stock real.';
    products = cart.length ? [] : await searchProducts({ gender: genderGuess, limit: 3 });
  } else if (intent === 'orders') {
    const orders = ctx.orders || [];
    if (!orders.length) {
      text = 'No veo pedidos asociados a tu cuenta. Si compraste como invitado, dime tu número de pedido (**VM-XXXX**) y lo reviso al instante.';
    } else if (orders.length === 1) {
      const o = orders[0];
      text = `Tu pedido **${o.order_no}** está **${o.status}**${o.courier ? ` con ${o.courier}` : ''}` +
        `${o.tracking_no ? ` (guía **${o.tracking_no}**)` : ''}. Total $${Number(o.total).toFixed(2)}. ` +
        'Si necesitas cambiarlo o devolverlo, tienes 30 días sin costo.';
    } else {
      text = `Estos son tus últimos pedidos: ${orders.map((o) => `**${o.order_no}** (${o.status}, $${Number(o.total).toFixed(2)})`).join(' · ')}. ` +
        '¿Te doy el detalle de alguno?';
    }
  } else if (intent === 'knowledge') {
    const web = ctx.web;
    const hits = web?.results || [];
    if (hits.length) {
      text = `${recall}Aquí está lo que encontré en internet sobre **${web.query}**:\n\n` +
        hits.slice(0, 3).map((h, i) => `${i + 1}. ${h.snippet || h.title}`).join('\n') +
        `\n\n_Fuentes: ${hits.slice(0, 3).map((h) => h.title).join(' · ')}._ ` +
        'Si quieres, te muestro prendas del catálogo que encajan con ese estilo.';
      products = await searchProducts({ gender: genderGuess, limit: 3 });
    } else {
      text = 'No pude consultar internet en este momento, pero conozco el catálogo real de VivaModa al detalle: dime la ocasión, el color o el presupuesto y te armo el look.';
      products = await searchProducts({ gender: genderGuess, limit: 3 });
    }
  } else if (intent === 'size') {
    const rememberedSize = facts.talla;
    const sizeHint = ctx.size || rememberedSize || 'S';
    text = rememberedSize
      ? `${recallOther}Guardo tu talla **${rememberedSize}**: en vestidos y blusas estructuradas voy directo a esa medida. Si tus medidas cambiaron, dime estatura o contorno de busto y la recalculo al instante con el motor biométrico (98% de precisión).`
      : '¡Con gusto! Dime tu estatura (por ejemplo 1.68 m) o tu contorno de busto y calculo tu talla exacta con el motor biométrico (98% de precisión). Como referencia, en vestidos y blusas estructuradas el calce habitual es la talla **' + sizeHint + '**.';
    products = await searchProducts({ gender: ctx.gender || 'damas', category: 'Vestidos', limit: 3 });
  } else if (intent === 'shoes') {
    products = await searchProducts({ category: 'Calzado', limit: 3, visibility: null });
    if (!products.length) products = await searchProducts({ q: 'Stiletto', limit: 2, visibility: null });
    text = 'Para un evento de noche, un **stiletto de más de 8.5 cm** estiliza la silueta de forma espectacular. En VivaModa tenemos opciones en piel lúcida que combinan con casi todo el catálogo de gala.';
  } else if (intent === 'shipping') {
    text = 'El **envío express llega en 24-48 h** hábiles sin costo en compras mayores a $49.99. Puedes rastrear tu pedido con la guía que llega por correo, o elegir **retiro en tienda en 2 horas** si estás cerca de una sucursal.';
  } else if (intent === 'returns') {
    text = 'Tranquilo/a: tienes **30 días naturales** para cambios o devoluciones sin costo. Si la prenda no te queda, nuestro mensajero la recoge en tu domicilio y el cambio de talla/color es directo en cualquier punto físico.';
  } else if (intent === 'deals') {
    products = await searchProducts({ visibility: null });
    products = products.filter((p) => p.compare_at || /flash|pack/i.test(p.badge || '')).slice(0, 3);
    text = '¡Momento ideal! Hoy están activas las **Ofertas Flash**: prendas con hasta 30% menos y packs con descuento adicional. Te dejé las mejores opciones con stock disponible abajo.';
  } else if (intent === 'accessorize') {
    const anchor = ctx.anchorProduct || null;
    if (anchor?.companionSkus) {
      products = anchor.companions || [];
      text = `Para potenciar tu **${anchor.name}**, te recomiendo completar el look con estos complementos seleccionados por nuestro equipo de estilismo.`;
    } else {
      products = await searchProducts({ category: 'Accesorios', limit: 3, visibility: null });
      text = 'Los accesorios correctos transforman cualquier prenda: un **clutch geométrico**, un cinturón en cuero de color o un blazer cropped elevan el conjunto al instante.';
    }
  } else if (intent === 'greeting') {
    text = `¡Hola${ctx.profile?.name ? `, **${ctx.profile.name.split(' ')[0]}**` : ''}! Soy **Aria**, tu estilista VivaModa ✨ ` +
      (remembered.length ? `${recall}` : '') +
      'Cuéntame para qué ocasión buscas outfit (boda, cóctel, oficina…), qué prenda quieres combinar o si necesitas ayuda con tu talla.';
    products = await searchProducts({ gender: genderGuess, limit: 3 });
  } else {
    // outfit genérico
    const ev = EVENT_MAP.find((e) => e.re.test(ctx.raw || ''));
    const gender = ev?.gender || genderGuess;
    const category = EVENT_CATEGORIES[ev?.occasion?.split(' ')[0]] || null;
    products = category
      ? await searchProducts({ gender, category, limit: 4 })
      : await searchProducts({ gender, limit: 4 });
    const anchorName = products[0]?.name || 'esta pieza';
    const sizeNote = facts.talla ? ` En tu talla **${facts.talla}** tengo disponibilidad confirmada.` : '';
    text = ev
      ? `${recall}¡Me encanta la idea! Para ${ev.occasion}, apuesta por un look con carácter: te sugiero **${anchorName}**, ideal por su ${ev.text}.${sizeNote} Combínalo con accesorios dorados de alto impacto y calzado de fiesta. ¿Quieres ver opciones de calzado o revisar tu talla recomendada?`
      : `${recall}Para tu consulta te recomiendo **${anchorName}**, una de las piezas mejor valoradas de la colección. Puedo ajustar la búsqueda por evento, color o presupuesto — ¿qué ocasión tienes en mente?`;
  }

  if (!products.length) {
    products = await searchProducts({ gender: genderGuess, limit: 3 });
  }

  return { intent, text, products };
}

/**
 * Emite el texto del motor local por trozos pequeños: el chat se siente
 * fluido (efecto de escritura) aunque no haya proveedor LLM configurado.
 */
async function streamLocal(text, onDelta) {
  const parts = String(text).match(/\S+\s*/g) || [String(text)];
  let buffer = '';
  for (let i = 0; i < parts.length; i++) {
    buffer += parts[i];
    const last = i === parts.length - 1;
    if (buffer.length >= 16 || last) {
      onDelta(buffer);
      buffer = '';
      if (!last) await new Promise((r) => setTimeout(r, 24));
    }
  }
  if (buffer) onDelta(buffer);
}

// ---------------------------------------------------------------
// Calculadora de tallas (motor biométrico simple)
// ---------------------------------------------------------------
export function recommendSize({ height, weight, bust, hips }) {
  const h = Number(height);
  const w = Number(weight);
  const b = Number(bust);
  if (!(h > 120 && h < 220) && !(b > 40 && b < 160)) {
    return { size: null, confidence: 0, message: 'Ingresa al menos tu estatura (cm) o contorno de busto (cm) para estimar tu talla.' };
  }
  let score = 0;
  let size;
  const bustRef = b || h * 0.52;
  if (bustRef <= 84) { size = 'XS'; score = 98; }
  else if (bustRef <= 90) { size = 'S'; score = 96; }
  else if (bustRef <= 96) { size = 'M'; score = 94; }
  else if (bustRef <= 102) { size = 'L'; score = 92; }
  else { size = 'XL'; score = 90; }
  if (w && w > 0) {
    if (w > 80 && score >= 96) { size = size === 'XS' ? 'S' : size; score -= 2; }
    if (w > 95 && ['S', 'M'].includes(size)) { size = size === 'S' ? 'M' : 'L'; score -= 3; }
  }
  return {
    size,
    confidence: score,
    message: `Según tus dimensiones (${b ? `busto ${b} cm` : `estatura ${h} cm`}), el motor biométrico VivaModa recomienda talla **${size}** con ${score}% de precisión estimada.`,
  };
}

// ---------------------------------------------------------------
// Motor conversacional
// ---------------------------------------------------------------
export async function stylistReply({ message, history = [], productContext = null, sessionKey = null, userId = null, onDelta = null }) {
  const started = Date.now();
  const PERSONAL = ['memory', 'cart', 'orders', 'size', 'shipping', 'returns', 'deals', 'shoes'];
  let intent = extractIntent(message);
  // Preguntas de cultura de moda (no del catálogo) se resuelven consultando internet.
  if (!PERSONAL.includes(intent) && needsWebSearch(message, intent)) intent = 'knowledge';

  // 1) Primero aprende del mensaje actual (talla, presupuesto, colores, ocasión…)…
  const learned = await learnFromMessage({ userId, sessionKey, message });
  // … y luego arma el contexto, para que lo recién aprendido ya influya en esta respuesta
  const context = await buildChatContext({ userId, sessionKey, message, intent });
  let anchorProduct = null;

  // La calculadora de tallas (determinística) se ejecuta SIEMPRE en local:
  // si el cliente da sus medidas, la respuesta del LLM se ancla a ese resultado.
  let sizeHint = null;
  if (intent === 'size') {
    const m = String(message).match(/1\.(\d{2})\s*m/i);
    if (m) sizeHint = recommendSize({ height: Number(`1.${m[1]}`) * 100 }).size;
  }

  if (productContext) {
    const { rows } = await pool.query(
      `SELECT p.*, p.details->'companionSkus' AS companion_skus_json FROM products p WHERE p.sku = $1 OR p.id::text = $1`,
      [productContext]);
    if (rows[0]) {
      const skus = rows[0].companion_skus_json || [];
      const companions = Array.isArray(skus) && skus.length
        ? await searchProducts({ visibility: null }).then((all) => all.filter((x) => skus.includes(x.sku)))
        : [];
      anchorProduct = {
        id: rows[0].id,
        sku: rows[0].sku,
        name: rows[0].name,
        category: rows[0].category,
        gender: rows[0].gender,
        companionSkus: skus,
        companions,
      };
    }
  }

  // 2) El motor local decide qué productos mostrar (SQL real sobre el catálogo).
  const { text: localText, products } = await recommendForIntent(intent, {
    raw: message,
    anchorProduct,
    gender: anchorProduct?.gender || context.gender,
    memory: context.memory?.facts || {},
    memoryRows: context.memory?.rows || [],
    profile: context.profile,
    orders: context.orders,
    web: context.web,
  });

  // 3) La memoria y los clics previos reordenan las sugerencias (aprendizaje)
  const ranked = rankProducts(products, context);

  // 4) Stock real por talla y tienda de las prendas sugeridas (contexto de BD)
  const stock = await stockForSkus(ranked.slice(0, 3).map((p) => p.sku));
  const catalogText = ranked.slice(0, 4).map((p) => {
    const s = stock.get(p.sku);
    const sizes = s?.sizes?.length ? `tallas disponibles ${s.sizes.join('/')}` : 'sin tallas con stock';
    const stores = s?.tiendas?.length ? ` · en tiendas: ${s.tiendas.join(', ')}` : '';
    const why = p.reason ? ` · motivo de la sugerencia: ${p.reason}` : '';
    return `- ${p.name} · ${p.category} · $${Number(p.price).toFixed(2)}${p.compare_at ? ` (antes $${Number(p.compare_at).toFixed(2)})` : ''} · ${sizes}${stores}${why}`;
  }).join('\n');

  // LLM (proveedor activo) genera el texto conversacional; reglas locales como respaldo.
  let text = localText;
  let model = 'aria-local-v1 (motor VivaModa)';
  let providerLabel = null;
  let llmError = null;

  const llmCtx = { message, history, intent, catalogText, anchorProduct, sizeHint, extraContext: context.contextParts };

  if (llmAvailable() && onDelta) {
    // Streaming: el cliente ve el texto mientras el modelo lo escribe.
    const llm = await llmStylistStream(llmCtx, onDelta);
    if (llm.error) {
      llmError = llm.error;
      console.warn(`[stylist] streaming del LLM falló (${llm.error})`);
      // Si no se alcanzó a emitir nada, enviamos la respuesta del motor local.
      if (!llm.emitted) { text = localText; await streamLocal(localText, onDelta); }
    } else {
      text = llm.text;
      model = llm.model;
      providerLabel = llm.providerLabel || null;
    }
  } else if (llmAvailable()) {
    const llm = await llmStylistReply(llmCtx);
    if (llm.error) {
      llmError = llm.error;
      console.warn(`[stylist] LLM no disponible (${llm.error}) → usando motor local`);
    } else {
      text = llm.text;
      model = llm.model;
      providerLabel = llm.providerLabel || null;
    }
  } else if (onDelta) {
    // Sin proveedor: el motor local responde igual, y el cliente lo ve fluido.
    text = localText;
    await streamLocal(localText, onDelta);
  }

  const latency = Date.now() - started;
  const suggestions = ranked.slice(0, 3).map((p) => ({
    id: p.id, sku: p.sku, name: p.name, price: Number(p.price),
    compareAt: p.compare_at ? Number(p.compare_at) : null,
    image: p.image_url, badge: p.badge, gender: p.gender, category: p.category,
    stockTotal: Number(p.stock_total), rating: Number(p.rating), reviewCount: p.review_count,
    sizes: stock.get(p.sku)?.sizes || [],
    reason: p.reason || null,
  }));

  return {
    reply: text,
    suggestions,
    intent,
    model,
    providerLabel,
    llmError,
    latencyMs: latency,
    quickReplies: quickRepliesFor(intent),
    anchorProduct: anchorProduct ? { sku: anchorProduct.sku, name: anchorProduct.name } : null,
    // Lo aprendido en este mensaje (la UI lo muestra como "🧠 Recordé…")
    learned,
    memoryFacts: (context.memory?.rows || []).slice(0, 8).map((r) => ({
      key: r.key, label: FACT_LABELS[r.key] || r.key, value: r.value, source: r.source, hits: r.hits,
    })),
    // Fuentes de internet usadas en la respuesta
    sources: (context.web?.results || []).slice(0, 3).map((r) => ({ title: r.title, url: r.url })),
    contextUsed: {
      profile: Boolean(context.profile),
      orders: context.orders?.length || 0,
      cart: context.profile?.cart?.length || 0,
      offers: context.offers?.ofertas || 0,
      web: context.web?.results?.length || 0,
      memory: context.memory?.rows?.length || 0,
    },
  };
}

function quickRepliesFor(intent) {
  const base = {
    outfit: ['¿Qué zapatos le van mejor?', '¿Cuál es mi talla para 1.68m?', '¿Adecuado para boda de noche?'],
    size: ['Ver guía de tallas', '¿Me recomiendas un vestido?', 'Calcular con mis medidas'],
    shoes: ['Mostrar vestidos de gala', '¿Cuál es mi talla?'],
    shipping: ['Rastrear mi pedido', '¿Cuánto cuesta el envío?'],
    returns: ['Política de devolución', 'Cambiar por otra talla'],
    deals: ['Mostrar ofertas flash', 'Outfit de oficina'],
    accessorize: ['Ver el look completo', 'Agregar todo al carrito'],
    greeting: ['Outfit para cóctel', 'Buscar vestido de gala', '¿Cuál es mi talla?'],
  };
  return base[intent] || base.outfit;
}
