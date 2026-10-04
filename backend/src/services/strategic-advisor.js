// =====================================================================
// IA #12 · ASESOR ESTRATÉGICO DE VENTAS Y COMPRAS (panel admin)
// ---------------------------------------------------------------------
// 1) DETECCIÓN DE TENDENCIAS: categorías/colores/canales que crecen o
//    caen (30 días vs 30 previos).
// 2) PLAN DE COMPRA Y ACCIONES: propone qué comprar (categoría, qty,
//    presupuesto estimado con costos reales), qué promover y qué frenar,
//    combinando tendencia + rotación + estancados + quiebres próximos.
//    Resumen estratégico con LLM (si hay key) o redacción local.
// =====================================================================
import { pool } from '../db.js';
import { llmProvider, callChat } from './llm-provider.js';

const fmtUSD = (n) => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const EN2ES_COLOR = {
  black: 'Negro', white: 'Blanco', beige: 'Beige', blue: 'Azul', navy: 'Azul marino', red: 'Rojo',
  pink: 'Rosa', green: 'Verde', yellow: 'Amarillo', orange: 'Naranja', purple: 'Morado', brown: 'Café',
  gray: 'Gris', grey: 'Gris', silver: 'Plateado', gold: 'Dorado', multi: 'Multicolor', ivory: 'Marfil',
  khaki: 'Caqui', teal: 'Verde azulado', burgundy: 'Vino', magenta: 'Fucsia', cobalt: 'Azul cobalto',
};
const colorEs = (c) => {
  const s = String(c || '').trim().toLowerCase();
  if (!s || s === 'n/a' || s === 'na' || s === '-') return 'Otros';
  for (const [en, es] of Object.entries(EN2ES_COLOR)) if (s.includes(en)) return es;
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const pct = (curr, prev) => (prev > 0 ? Math.round(((curr - prev) / prev) * 100) : (curr > 0 ? 100 : 0));

// ---------------------------------------------------------------
// 1) TENDENCIAS DE VENTA (30d vs 30d previos)
// ---------------------------------------------------------------
export async function detectSalesTrends({ days = 30 } = {}) {
  const half = Math.max(7, Math.floor(days / 2));
  const { rows: cats } = await pool.query(
    `SELECT p.category,
            SUM(oi.qty) FILTER (WHERE o.created_at >= now() - ($1 || ' days')::interval)::int AS units_now,
            SUM(oi.qty * oi.unit_price) FILTER (WHERE o.created_at >= now() - ($1 || ' days')::interval)::float8 AS revenue_now,
            SUM(oi.qty) FILTER (WHERE o.created_at >= now() - ($2 || ' days')::interval AND o.created_at < now() - ($1 || ' days')::interval)::int AS units_prev,
            SUM(oi.qty * oi.unit_price) FILTER (WHERE o.created_at >= now() - ($2 || ' days')::interval AND o.created_at < now() - ($1 || ' days')::interval)::float8 AS revenue_prev
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.paid = TRUE AND o.status <> 'cancelled' AND o.created_at >= now() - ($2 || ' days')::interval
     GROUP BY p.category`,
    [String(half), String(half * 2)],
  );
  const catTrends = cats.map((c) => ({
    category: c.category,
    unitsNow: c.units_now || 0,
    unitsPrev: c.units_prev || 0,
    revenueNow: Math.round(c.revenue_now || 0),
    revenuePrev: Math.round(c.revenue_prev || 0),
    deltaPct: pct(c.units_now || 0, c.units_prev || 0),
  })).sort((a, b) => b.deltaPct - a.deltaPct);

  const { rows: cols } = await pool.query(
    `SELECT COALESCE(NULLIF(oi.color, ''), NULLIF(v.color, ''), 'Otros') AS color,
            SUM(oi.qty)::int AS units, SUM(oi.qty * oi.unit_price)::float8 AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN product_variants v ON v.id = oi.variant_id
     WHERE o.paid = TRUE AND o.status <> 'cancelled' AND o.created_at >= now() - ($1 || ' days')::interval
     GROUP BY 1 HAVING SUM(oi.qty) > 0 ORDER BY units DESC LIMIT 8`,
    [String(half)],
  );
  const colorAgg = new Map();
  for (const c of cols) {
    const name = colorEs(c.color);
    const cur = colorAgg.get(name) || { color: name, units: 0, revenue: 0 };
    cur.units += c.units;
    cur.revenue += Math.round(c.revenue || 0);
    colorAgg.set(name, cur);
  }
  const colorTrends = [...colorAgg.values()].filter((c) => c.units > 0).sort((a, b) => b.units - a.units).slice(0, 8);

  const { rows: chans } = await pool.query(
    `SELECT o.channel,
            SUM(oi.qty * oi.unit_price) FILTER (WHERE o.created_at >= now() - ($1 || ' days')::interval)::float8 AS rev_now,
            SUM(oi.qty * oi.unit_price) FILTER (WHERE o.created_at >= now() - ($2 || ' days')::interval AND o.created_at < now() - ($1 || ' days')::interval)::float8 AS rev_prev
     FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE o.paid = TRUE AND o.status <> 'cancelled' AND o.created_at >= now() - ($2 || ' days')::interval
     GROUP BY o.channel`,
    [String(half), String(half * 2)],
  );
  const channelTrends = chans.map((c) => ({
    channel: c.channel,
    revenueNow: Math.round(c.rev_now || 0),
    deltaPct: pct(c.rev_now || 0, c.rev_prev || 0),
  })).sort((a, b) => b.revenueNow - a.revenueNow);

  const rising = catTrends.filter((c) => c.deltaPct > 0 && c.unitsNow > 0);
  const falling = catTrends.filter((c) => c.deltaPct < 0 && c.unitsPrev > 0);
  return { windowDays: half, generatedAt: new Date().toISOString(), catTrends, colorTrends, channelTrends, rising, falling };
}

// ---------------------------------------------------------------
// 2) PLAN DE COMPRA + ACCIONES RECOMENDADAS
// ---------------------------------------------------------------
export async function buildPurchasePlan({ days = 30, budget = null } = {}) {
  const trends = await detectSalesTrends({ days });

  // Presupuesto sugerido: 15% de los ingresos de la ventana actual si no se define
  const revenueNow = trends.catTrends.reduce((s, c) => s + c.revenueNow, 0);
  const budgetUsed = Number(budget) > 0 ? Number(budget) : Math.round(revenueNow * 0.15) || 500;

  // Costo promedio por categoría (para estimar inversión)
  const { rows: costs } = await pool.query(
    `SELECT p.category, AVG(p.cost)::float8 AS avg_cost
     FROM products p WHERE p.is_active = TRUE GROUP BY p.category`,
  );
  const costByCat = new Map(costs.map((c) => [c.category, c.avg_cost || 0]));

  // Estancados (capital dormido) y quiebres próximos (reposición urgente)
  const { rows: stuck } = await pool.query(
    `SELECT MAX(p.category) AS category, COUNT(DISTINCT p.sku)::int AS skus,
            SUM(i.qty * p.cost)::float8 AS capital
     FROM products p
     JOIN product_variants v ON v.product_id = p.id
     LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE p.is_active = TRUE
     GROUP BY p.sku
     HAVING SUM(i.qty) > 0
       AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
                       WHERE oi.sku = p.sku AND o.created_at >= now() - INTERVAL '45 days')`,
  ).catch(() => ({ rows: [] }));
  const stuckAgg = { skus: stuck.reduce((s, r) => s + (r.skus || 0), 0), capital: Math.round(stuck.reduce((s, r) => s + (r.capital || 0), 0)) };

  const { rows: burn } = await pool.query(
    `SELECT p.category, MAX(p.name) AS name, SUM(oi.qty) FILTER (WHERE o.created_at >= now() - INTERVAL '7 days')::int AS sold7,
            SUM(i.qty)::int AS stock
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN product_variants v ON v.id = oi.variant_id
     LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE o.paid = TRUE AND o.status <> 'cancelled' AND o.created_at >= now() - INTERVAL '7 days'
     GROUP BY p.category, p.sku HAVING SUM(oi.qty) >= 2
     ORDER BY sold7 DESC LIMIT 8`,
  ).catch(() => ({ rows: [] }));
  const burnAgg = {};
  for (const b of burn) {
    if (b.stock !== null && b.stock / Math.max(b.sold7, 1) < 7) {
      burnAgg[b.category] = (burnAgg[b.category] || 0) + 1;
    }
  }

  // --- Construcción del plan ---
  const plan = [];
  let budgetLeft = budgetUsed;

  // A) Reposición urgente de categorías con quiebre inminente (prioridad 1)
  for (const [cat, n] of Object.entries(burnAgg)) {
    const cost = costByCat.get(cat) || 8;
    const qty = Math.max(24, Math.ceil(40 / Math.max(cost, 1)) * 4);
    const est = Math.round(qty * cost);
    if (est > budgetLeft) continue;
    budgetLeft -= est;
    plan.push({ priority: 1, type: 'reposicion', category: cat, qty, estCost: est,
      reason: `Quiebre inminente: ${n} producto(s) de ${cat} se agotan en menos de 1 semana — reponer antes de perder ventas.` });
  }

  // B) Tendencias crecientes: ampliar surtido (prioridad 2)
  for (const t of trends.rising.slice(0, 3)) {
    const cost = costByCat.get(t.category) || 8;
    const qty = Math.max(12, Math.round(t.unitsNow * 0.6 / 4) * 4);
    const est = Math.round(qty * cost);
    if (est > budgetLeft) continue;
    budgetLeft -= est;
    plan.push({ priority: 2, type: 'tendencia', category: t.category, qty, estCost: est,
      reason: `Crecimiento de +${t.deltaPct}% en la ventana actual (${t.unitsNow} uds vs ${t.unitsPrev} previas) — ampliar surtido para capitalizar la tendencia.` });
  }

  // C) Colores de moda del período: sugerencia puntual (prioridad 3)
  const topColor = trends.colorTrends[0];
  if (topColor && budgetLeft > 30) {
    const est = Math.min(Math.round(budgetLeft * 0.25), 120);
    budgetLeft -= est;
    plan.push({ priority: 3, type: 'tendencia_color', category: 'Multicategoría', qty: Math.max(6, Math.round(est / 10)), estCost: est,
      reason: `El color ${topColor.color} concentra ${topColor.units} uds vendidas (${fmtUSD(topColor.revenue)}) — sumar 1-2 referencias nuevas en ese tono.` });
  }

  // --- Acciones accionables ---
  const actions = [];
  for (const p of plan.filter((x) => x.priority === 1)) {
    actions.push({ type: 'compra', priority: 'alta', title: `Reponer ${p.category}: ${p.qty} uds`, detail: p.reason });
  }
  for (const t of trends.rising.slice(0, 2)) {
    actions.push({ type: 'compra', priority: 'media', title: `Ampliar surtido de ${t.category}`, detail: `Tendencia +${t.deltaPct}% — sumar referencias y tallas completas antes del pico.` });
  }
  if (topColor) {
    actions.push({ type: 'compra', priority: 'media', title: `Nuevas referencias en color ${topColor.color}`, detail: `Es el tono más vendido del período (${topColor.units} uds).` });
  }
  if (trends.falling.length) {
    const f = trends.falling[0];
    actions.push({ type: 'marketing', priority: 'media', title: `Activar promoción en ${f.category}`, detail: `Caída de ${f.deltaPct}% — mover con descuento flash o bundle antes de que sea capital dormido.` });
  }
  if (stuckAgg.skus > 0) {
    actions.push({ type: 'inventario', priority: 'alta', title: `Liquidar ${stuckAgg.skus} SKUs estancados`, detail: `Retienen ${fmtUSD(stuckAgg.capital)} sin rotación en 45 días — salida por ofertas o outlet.` });
  }
  const bestChannel = trends.channelTrends[0];
  if (bestChannel && bestChannel.deltaPct > 0) {
    actions.push({ type: 'marketing', priority: 'media', title: `Reforzar inversión en canal ${bestChannel.channel}`, detail: `Creció +${bestChannel.deltaPct}% (${fmtUSD(bestChannel.revenueNow)}) — es el canal a empujar esta campaña.` });
  }
  const worstChannel = trends.channelTrends[trends.channelTrends.length - 1];
  if (worstChannel && trends.channelTrends.length > 1 && worstChannel.deltaPct < 0) {
    actions.push({ type: 'pricing', priority: 'baja', title: `Revisar estrategia del canal ${worstChannel.channel}`, detail: `Caída de ${worstChannel.deltaPct}% — auditar precios, stock visible y campañas del canal.` });
  }

  // --- Resumen estratégico ---
  const data = {
    ventanaDias: trends.windowDays,
    ingresosActuales: revenueNow,
    presupuestoPlan: budgetUsed,
    presupuestoComprometido: budgetUsed - budgetLeft,
    categoriasQueCrecen: trends.rising.slice(0, 3).map((t) => `${t.category} (+${t.deltaPct}%)`),
    categoriasQueCaen: trends.falling.slice(0, 3).map((t) => `${t.category} (${t.deltaPct}%)`),
    colorDominante: topColor ? `${topColor.color} (${topColor.units} uds)` : null,
    canalLider: bestChannel ? `${bestChannel.channel} (${fmtUSD(bestChannel.revenueNow)})` : null,
    lineasPlan: plan.map((p) => `${p.type}: ${p.category} ${p.qty} uds ≈ ${fmtUSD(p.estCost)}`),
    estancados: stuckAgg,
  };

  let summary = null;
  let engine = 'local';
  const provider = llmProvider();
  if (provider) {
    try {
      const { ok, body } = await callChat(provider, {
        model: provider.model,
        messages: [
          { role: 'system', content: 'Eres el asesor estratégico de compras y ventas de VivaModa (moda premium, USD). Escribes en español, directo y accionable.' },
          { role: 'user', content: `Con estos datos reales, escribe un PÁRRAFO ESTRATÉGICO (máx 90 palabras) que explique qué está pasando con las ventas y qué debe hacer el gerente esta semana (compras, promociones, canales). Datos: ${JSON.stringify(data)}` },
        ],
        max_tokens: 250,
        temperature: 0.4,
      }, { timeoutMs: 45_000, attempts: 1, tag: 'strategic' });
      const text = ok ? body?.choices?.[0]?.message?.content?.trim() : null;
      if (text) { summary = text; engine = 'llm'; }
    } catch { /* fallback local */ }
  }
  if (!summary) {
    const crece = data.categoriasQueCrecen.length ? data.categoriasQueCrecen.join(', ') : 'sin categorías en crecimiento';
    const cae = data.categoriasQueCaen.length ? data.categoriasQueCaen.join(', ') : 'ninguna';
    summary = `En los últimos ${data.ventanaDias} días generaste ${fmtUSD(data.ingresosActuales)} en ventas. ` +
      `Están creciendo: ${crece}; en caída: ${cae}. ` +
      `Con un presupuesto de ${fmtUSD(data.presupuestoPlan)} para compras, el plan compromete ${fmtUSD(data.presupuestoComprometido)} priorizando reposición de quiebres y tendencias. ` +
      (stuckAgg.skus ? `Atención: ${stuckAgg.skus} SKUs estancados retienen ${fmtUSD(stuckAgg.capital)} — límpialos con promociones. ` : '') +
      `Canal líder: ${data.canalLider || '—'}. Ejecuta las acciones listas por prioridad.`;
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: trends.windowDays,
    budget: budgetUsed,
    budgetCommitted: budgetUsed - budgetLeft,
    summary,
    engine,
    trends,
    plan,
    actions,
    stuck: stuckAgg,
    data,
  };
}
