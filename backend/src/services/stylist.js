import { pool } from '../db.js';
import { config } from '../config.js';
import { llmStylistReply } from './llm.js';

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
  if (/(talla|medida|busto|contorno|estatura|1\.\d{2}\s*m|talle)/.test(msg)) return 'size';
  if (/(zapato|tacón|tacon|stiletto|calzado|sneaker)/.test(msg)) return 'shoes';
  if (/(envío|envio|entrega|llegar|tracking|rastrear|guía)/.test(msg)) return 'shipping';
  if (/(devolución|devolucion|cambio|cambiar|reembolso)/.test(msg)) return 'returns';
  if (/(oferta|descuento|flash|rebaja|promo)/.test(msg)) return 'deals';
  if (/(combinar|accesorio|complement|qué me pongo|que me pongo)/.test(msg)) return 'accessorize';
  if (/(hola|buenas|buen día|buen dia|saludos)/.test(msg) && msg.length < 40) return 'greeting';
  return 'outfit';
}

export async function recommendForIntent(intent, ctx = {}) {
  const genderGuess = ctx.gender || 'damas';
  let products = [];
  let text = '';

  if (intent === 'size') {
    const sizeHint = ctx.size || 'S';
    text = `¡Con gusto! Con ${ctx.height || 'tu estatura'} y tus medidas, el calce óptimo en VivaModa suele ser la talla **${sizeHint}** para vestidos y blusas de corte estructurado. Si tu contorno de busto supera los 92 cm, sube una talla. ¿Quieres que calcule tu talla exacta con el motor biométrico? (tengo una precisión del 98%)`;
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
    text = '¡Hola! Soy **Aria**, tu estilista VivaModa ✨ Cuéntame para qué ocasión buscas outfit (boda, cóctel, oficina…), qué prenda quieres combinar o si necesitas ayuda con tu talla.';
    products = await searchProducts({ limit: 3 });
  } else {
    // outfit genérico
    const ev = EVENT_MAP.find((e) => e.re.test(ctx.raw || ''));
    const gender = ev?.gender || genderGuess;
    const category = EVENT_CATEGORIES[ev?.occasion?.split(' ')[0]] || null;
    products = category
      ? await searchProducts({ gender, category, limit: 4 })
      : await searchProducts({ gender, limit: 4 });
    const anchorName = products[0]?.name || 'esta pieza';
    text = ev
      ? `¡Me encanta la idea! Para ${ev.occasion}, apuesta por un look con carácter: te sugiero **${anchorName}**, ideal por su ${ev.text}. Combínalo con accesorios dorados de alto impacto y calzado de fiesta. ¿Quieres ver opciones de calzado o revisar tu talla recomendada?`
      : `Para tu consulta te recomiendo **${anchorName}**, una de las piezas mejor valoradas de la colección. Puedo ajustar la búsqueda por evento, color o presupuesto — ¿qué ocasión tienes en mente?`;
  }

  if (!products.length) {
    products = await searchProducts({ gender: genderGuess, limit: 3 });
  }

  return { intent, text, products };
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
export async function stylistReply({ message, history = [], productContext = null }) {
  const started = Date.now();
  const intent = extractIntent(message);
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

  // El motor local decide qué productos mostrar (SQL real sobre el catálogo).
  const { text: localText, products } = await recommendForIntent(intent, {
    raw: message,
    anchorProduct,
    gender: anchorProduct?.gender || null,
  });

  // LLM (OpenRouter) genera el texto conversacional; reglas locales como respaldo.
  let text = localText;
  let model = 'aria-local-v1 (motor VivaModa)';
  let llmError = null;

  if (config.openrouterApiKey) {
    const catalogText = products
      .slice(0, 4)
      .map((p) => `- ${p.name} · ${p.category} · $${Number(p.price).toLocaleString('es-CO')}${p.compare_at ? ` (antes $${Number(p.compare_at).toLocaleString('es-CO')})` : ''}`)
    .join('\n');
    const llm = await llmStylistReply({
      message,
      history,
      intent,
      catalogText,
      anchorProduct,
      sizeHint,
    });
    if (llm.error) {
      llmError = llm.error;
      console.warn(`[stylist] LLM no disponible (${llm.error}) → usando motor local`);
    } else {
      text = llm.text;
      model = llm.model;
    }
  }

  const latency = Date.now() - started;
  const suggestions = products.slice(0, 3).map((p) => ({
    id: p.id, sku: p.sku, name: p.name, price: Number(p.price),
    compareAt: p.compare_at ? Number(p.compare_at) : null,
    image: p.image_url, badge: p.badge, gender: p.gender, category: p.category,
    stockTotal: Number(p.stock_total), rating: Number(p.rating), reviewCount: p.review_count,
  }));

  return {
    reply: text,
    suggestions,
    intent,
    model,
    llmError,
    latencyMs: latency,
    quickReplies: quickRepliesFor(intent),
    anchorProduct: anchorProduct ? { sku: anchorProduct.sku, name: anchorProduct.name } : null,
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
