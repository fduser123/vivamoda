// =====================================================================
// IA Administrativa VivaModa · Panel de Almacén & Ventas
// ---------------------------------------------------------------------
// 1) PREDICCIÓN DE DEMANDA (motor local, estadística sobre SQL):
//    - velocidad de venta por variante (media móvil 30/14 días)
//    - fecha estimada de quiebre de stock + qty de reorden sugerida
// 2) CLASIFICACIÓN ABC del catálogo (ingresos 90/última ventana)
// 3) DETECCIÓN DE ANOMALÍAS: picos/caídas de venta, estancados, tiendas
// 4) INFORME EJECUTIVO: LLM (OpenRouter) con fallback a motor local
// 5) Soporte para chat text-to-SQL de SOLO LECTURA (validación estricta)
// =====================================================================
import { pool } from '../db.js';
import { llmProvider, callChat } from './llm-provider.js';

const fmtUSD = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Llamada genérica al LLM (proveedor activo). Devuelve null si falla. */
async function llmChat({ prompt, system, maxTokens = 500, temperature = 0.4, timeoutMs = 60_000 }) {
  const provider = llmProvider();
  if (!provider) return null;
  const { ok, body } = await callChat(provider, {
    model: provider.model,
    messages: [
      { role: 'system', content: system || 'Eres el analista de IA de VivaModa. Responde en español, conciso y con datos exactos.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: maxTokens,
    temperature,
  }, { timeoutMs, attempts: 1, tag: 'admin-ai' });
  if (!ok) return null;
  const text = body?.choices?.[0]?.message?.content?.trim();
  return text ? { text, model: provider.model } : null;
}

// ---------------------------------------------------------------
// 1) PREDICCIÓN DE DEMANDA + REORDEN INTELIGENTE
//    Ventana de referencia: 30 días. Media móvil diaria por variante,
//    suavizada con la última semana (peso 2:1) para capturar tendencia.
// ---------------------------------------------------------------
export async function demandForecast({ storeId = null, horizonDays = 30 } = {}) {
  const storeCond = storeId ? 'AND o.store_id = $1' : '';
  const params = storeId ? [storeId] : [];

  // Ventas por variante: últimos 30 días (total) y últimos 7 (tendencia)
  const { rows } = await pool.query(
    `SELECT p.sku,
            MAX(p.name) AS name,
            MAX(p.category) AS category,
            MAX(v.size) AS size,
            MAX(v.color) AS color,
            SUM(oi.qty) FILTER (WHERE o.created_at >= now() - INTERVAL '30 days')::int AS sold30,
            SUM(oi.qty) FILTER (WHERE o.created_at >= now() - INTERVAL '7 days')::int AS sold7,
            MAX(st.code) AS store_code
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN product_variants v ON v.id = oi.variant_id
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN stores st ON st.id = o.store_id
     WHERE o.paid = TRUE AND o.status <> 'cancelled'
       AND o.created_at >= now() - INTERVAL '30 days' ${storeCond}
     GROUP BY p.sku
     HAVING SUM(oi.qty) > 0`,
    params,
  );

  const skuSet = rows.map((r) => r.sku);
  const stockRows = skuSet.length
    ? (await pool.query(
        `SELECT p.sku, SUM(i.qty)::int AS stock, SUM(i.reorder_point)::int AS reorder_total
         FROM products p
         JOIN product_variants v ON v.product_id = p.id
         LEFT JOIN inventory i ON i.variant_id = v.id ${storeId ? 'AND i.store_id = $1' : ''}
         WHERE p.sku = ANY($${storeId ? 2 : 1})
         GROUP BY p.sku`,
        storeId ? [storeId, skuSet] : [skuSet],
      )).rows
    : [];
  const stockBySku = new Map(stockRows.map((r) => [r.sku, r]));

  const today = new Date();
  const forecast = rows.map((r) => {
    // Velocidad diaria: media 30d (peso 1) + media 7d (peso 2) → sensible a tendencia
    const v30 = r.sold30 / 30;
    const v7 = r.sold7 / 7;
    const velocity = (v30 + 2 * v7) / 3;
    const stock = Number(stockBySku.get(r.sku)?.stock ?? 0);
    const daysLeft = velocity > 0 ? Math.floor(stock / velocity) : Infinity;
    const stockoutDate = Number.isFinite(daysLeft)
      ? new Date(today.getTime() + daysLeft * 86400000)
      : null;
    // Reorden sugerida: cubrir el horizonte + 20% de seguridad, respetando mínimo del punto de reorden
    const target = Math.ceil(velocity * horizonDays * 1.2);
    const reorderTotal = Number(stockBySku.get(r.sku)?.reorder_total ?? 10);
    const suggestedQty = Math.max(target - stock, Math.ceil(reorderTotal / Math.max(1, 4)) * 2, 0);
    const risk = stock <= 0 ? 'AGOTADO'
      : daysLeft < 7 ? 'CRITICO'
      : daysLeft < 14 ? 'ALTO'
      : daysLeft < 30 ? 'MEDIO' : 'BAJO';
    return {
      sku: r.sku,
      name: r.name,
      category: r.category,
      size: r.size,
      color: r.color,
      store: r.store_code || (storeId ? null : 'MULTI'),
      sold30: r.sold30,
      sold7: r.sold7,
      velocityPerDay: Math.round(velocity * 100) / 100,
      stock,
      daysLeft: Number.isFinite(daysLeft) ? daysLeft : null,
      stockoutDate: stockoutDate ? stockoutDate.toISOString().slice(0, 10) : null,
      suggestedQty,
      risk,
    };
  });

  forecast.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
  return {
    horizonDays,
    generatedAt: today.toISOString(),
    items: forecast,
    critical: forecast.filter((f) => f.risk === 'CRITICO' || f.risk === 'AGOTADO').slice(0, 10),
    alertsCount: forecast.filter((f) => f.risk === 'CRITICO' || f.risk === 'AGOTADO' || f.risk === 'ALTO').length,
  };
}

// ---------------------------------------------------------------
// 2) CLASIFICACIÓN ABC (Pareto por ingresos, ventana configurable)
// ---------------------------------------------------------------
export async function abcClassification({ days = 90 } = {}) {
  const { rows } = await pool.query(
    `SELECT p.sku, MAX(p.name) AS name, MAX(p.category) AS category,
            SUM(oi.unit_price * oi.qty)::float8 AS revenue,
            SUM(oi.qty)::int AS units
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.paid = TRUE AND o.status <> 'cancelled'
       AND o.created_at >= now() - ($1 || ' days')::interval
     GROUP BY p.sku
     HAVING SUM(oi.unit_price * oi.qty) > 0
     ORDER BY revenue DESC`,
    [String(days)],
  );
  const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
  let acc = 0;
  const classified = rows.map((r) => {
    const share = Number(r.revenue) / (total || 1);
    acc += share;
    const cls = acc <= 0.8 ? 'A' : acc <= 0.95 ? 'B' : 'C';
    return {
      sku: r.sku, name: r.name, category: r.category,
      revenue: Math.round(Number(r.revenue)), units: r.units,
      sharePct: Math.round(share * 1000) / 10, cumPct: Math.round(acc * 1000) / 10, class: cls,
    };
  });
  const summary = { A: 0, B: 0, C: 0 };
  for (const c of classified) summary[c.class] += 1;
  return { days, total: Math.round(total), items: classified, summary };
}

// ---------------------------------------------------------------
// 3) DETECCIÓN DE ANOMALÍAS y estancados
// ---------------------------------------------------------------
export async function detectAnomalies({ storeId = null } = {}) {
  const out = [];
  const storeCond = storeId ? 'AND o.store_id = $1' : '';
  const params = storeId ? [storeId] : [];

  // 3a. Comparación semana actual vs 4 semanas previas por tienda
  const { rows: stores } = await pool.query(
    `SELECT s.id, s.code,
            COALESCE(SUM(oi.qty * oi.unit_price) FILTER (WHERE o.created_at >= now() - INTERVAL '7 days'),0)::float8 AS last7,
            COALESCE(SUM(oi.qty * oi.unit_price) FILTER (WHERE o.created_at >= now() - INTERVAL '35 days' AND o.created_at < now() - INTERVAL '7 days'),0)::float8 AS prev28
     FROM stores s
     LEFT JOIN orders o ON o.store_id = s.id AND o.paid = TRUE AND o.status <> 'cancelled' ${storeCond ? 'AND o.store_id = $1' : ''}
     LEFT JOIN order_items oi ON oi.order_id = o.id
     GROUP BY s.id, s.code`,
    params,
  );
  for (const s of stores) {
    const avgPrev = s.prev28 / 4;
    if (avgPrev > 0) {
      const delta = (s.last7 - avgPrev) / avgPrev;
      if (delta >= 0.5) out.push({ type: 'pico_ventas', severity: 'info', store: s.code,
        message: `Ventas de ${s.code} +${Math.round(delta * 100)}% vs media semanal previa (${fmtUSD(s.last7)}). Verifica stock para sostener el ritmo.` });
      if (delta <= -0.4) out.push({ type: 'caida_ventas', severity: 'warning', store: s.code,
        message: `Ventas de ${s.code} ${Math.round(delta * 100)}% vs media semanal previa (${fmtUSD(s.last7)}). Revisar tráfico, precios o promociones.` });
    }
  }

  // 3b. SKUs con ventas fuertes que empiezan a agotarse (opportunidad en riesgo)
  const { rows: burn } = await pool.query(
    `SELECT p.sku, MAX(p.name) AS name, SUM(oi.qty) FILTER (WHERE o.created_at >= now() - INTERVAL '7 days')::int AS sold7,
            SUM(i.qty)::int AS stock
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id ${storeCond}
     JOIN product_variants v ON v.id = oi.variant_id
     JOIN products p ON p.id = oi.product_id
     LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE o.paid = TRUE AND o.status <> 'cancelled' AND o.created_at >= now() - INTERVAL '7 days'
     GROUP BY p.sku HAVING SUM(oi.qty) >= 3
     ORDER BY sold7 DESC LIMIT 6`,
    params,
  );
  for (const b of burn) {
    if (b.stock !== null && b.stock / Math.max(b.sold7, 1) < 7) {
      out.push({ type: 'quiebre_inminente', severity: 'critical', store: null, sku: b.sku,
        message: `"${b.name}" vende ${b.sold7} uds/sem y quedan ${b.stock} uds → menos de 1 semana de cobertura. Priorizar reorden.` });
    }
  }

  // 3c. Estancados: sin ventas en 45 días pero con stock
  const { rows: stuck } = await pool.query(
    `SELECT p.sku, MAX(p.name) AS name, SUM(i.qty)::int AS stock, MAX(p.price)::float8 AS price
     FROM products p
     JOIN product_variants v ON v.product_id = p.id
     LEFT JOIN inventory i ON i.variant_id = v.id
     WHERE p.is_active = TRUE
     GROUP BY p.sku
     HAVING SUM(i.qty) > 0
     AND NOT EXISTS (
       SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.sku = p.sku AND o.created_at >= now() - INTERVAL '45 days')`,
  );
  const stuckValue = stuck.reduce((s, r) => s + Number(r.stock) * Number(r.price), 0);
  if (stuck.length) {
    out.push({ type: 'estancados', severity: 'warning', store: null,
      message: `${stuck.length} SKUs sin ventas en 45 días retienen ${fmtUSD(stuckValue)} en inventario. Considera moverlos a Ofertas Flash.` });
  }

  return { generatedAt: new Date().toISOString(), anomalies: out, stuckCount: stuck.length, stuckValue: Math.round(stuckValue) };
}

// ---------------------------------------------------------------
// 4) INFORME EJECUTIVO (LLM con fallback local)
// ---------------------------------------------------------------
export async function executiveReport({ storeId = null, period = '7d' } = {}) {
  // Agregados base (los mismos criterios de /api/admin/stats)
  const rangeStart = period === 'today' ? 'CURRENT_DATE' : period === 'month' ? "date_trunc('month', now())" : "now() - INTERVAL '7 days'";
  const storeCond = storeId ? 'AND o.store_id = $1' : '';
  const params = storeId ? [storeId] : [];

  const { rows: sales } = await pool.query(
    `SELECT COUNT(*)::int AS orders, COALESCE(SUM(o.total),0)::float8 AS revenue,
            COALESCE(AVG(o.total),0)::float8 AS ticket
     FROM orders o WHERE o.paid = TRUE AND o.status <> 'cancelled' AND o.created_at >= ${rangeStart} ${storeCond}`, params);
  const { rows: top } = await pool.query(
    `SELECT p.name, SUM(oi.qty)::int AS units, SUM(oi.qty * oi.unit_price)::float8 AS revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
     WHERE o.paid = TRUE AND o.status <> 'cancelled' AND o.created_at >= ${rangeStart} ${storeCond}
     GROUP BY p.name ORDER BY revenue DESC LIMIT 5`, params);
  const { rows: chan } = await pool.query(
    `SELECT o.channel, COUNT(*)::int AS n, COALESCE(SUM(o.total),0)::float8 AS revenue
     FROM orders o WHERE o.paid = TRUE AND o.status <> 'cancelled' AND o.created_at >= ${rangeStart} ${storeCond}
     GROUP BY o.channel ORDER BY revenue DESC`, params);
  const fc = await demandForecast({ storeId });
  const an = await detectAnomalies({ storeId });

  const data = {
    periodo: period,
    pedidos: sales[0].orders,
    ingresos: Math.round(Number(sales[0].revenue)),
    ticketPromedio: Math.round(Number(sales[0].ticket) * 100) / 100,
    topProductos: top.map((t) => `${t.name} (${t.units} uds, ${fmtUSD(t.revenue)})`),
    canales: chan.map((c) => `${c.channel}: ${c.n} pedidos, ${fmtUSD(c.revenue)}`),
    alertasStock: fc.critical.map((c) => `${c.name} (${c.size}) queda sin stock el ${c.stockoutDate}`),
    anomalias: an.anomalies.map((a) => a.message),
  };

  // --- LLM (opcional) ---
  if (llmProvider()) {
    try {
      const prompt = `Eres el analista de negocios de VivaModa (moda premium omnicanal, cifras en USD).
Con estos datos reales del período, escribe un INFORME EJECUTIVO en español para el gerente de operaciones.
Estructura EXACTA con Markdown (sin saludos):
**Resumen** — 2 frases con el pulso del negocio (ingresos, pedidos, ticket).
**Lo que funciona** — 2-3 bullets con productos/canales destacados citando cifras.
**Riesgos** — 2-3 bullets con alertas de stock/anomalías y su impacto.
**Acciones recomendadas** — 3 bullets concretos y accionables (inventario, pricing, marketing).
Máximo 180 palabras en total. Datos:\n${JSON.stringify(data)}`;
      const llm = await llmChat({ prompt, maxTokens: 500, temperature: 0.35 });
      if (llm?.text) {
        return { report: llm.text, engine: 'llm', model: llm.model, data };
      }
    } catch (e) {
      console.warn('[admin-ai] LLM falló → informe local:', e.message);
    }
  }

  // --- Fallback local determinista ---
  const growth = data.ingresos > 0 ? '' : '';
  const lines = [
    `**Resumen** — En el período se registraron **${data.pedidos} pedidos** por **${fmtUSD(data.ingresos)}** (ticket promedio ${fmtUSD(data.ticketPromedio)}). ${data.alertasStock.length ? 'La operación sigue estable pero hay riesgo de quiebre en productos de alta rotación.' : 'Sin alertas críticas de inventario en el horizonte analizado.'}`,
    `**Lo que funciona**\n${data.topProductos.slice(0, 3).map((t) => `- ${t}`).join('\n')}\n${data.canales.slice(0, 2).map((c) => `- Canal ${c}`).join('\n')}`,
    `**Riesgos**\n${(data.alertasStock.slice(0, 2).map((a) => `- Quiebre próximo: ${a}`).concat(data.anomalias.slice(0, 2).map((a) => `- ${a}`))).join('\n') || '- Sin riesgos relevantes detectados.'}`,
    `**Acciones recomendadas**\n- Generar orden de compra para los ${fc.critical.length} SKUs en riesgo crítico antes del ${fc.critical[0]?.stockoutDate || 'próximo ciclo'}.\n- Destacar los 3 productos top en la vitrina y en campañas del canal con mejor desempeño.\n- Revisar los ${an.stuckCount} SKUs estancados (${fmtUSD(an.stuckValue)}) y activar descuentos flash para liberar capital.`,
  ];
  return { report: lines.join('\n\n'), engine: 'local', model: 'analista-local-v1', data };
}

// ---------------------------------------------------------------
// 5) Validador de SQL de solo lectura (para el chat text-to-SQL)
//    + protección de datos personales (PII) de clientes
// ---------------------------------------------------------------
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|call|do|set|reset|listen|notify|prepare|execute)\b/i;
const MUST_SELECT = /^\s*(with|select)\b/i;
const MULTI = /;/;
// Columnas con datos personales o credenciales: prohibidas incluso en agregados
const SENSITIVE_COLUMNS = /\b(password_hash|password|email|e-mail|correo|electr[oó]nico|phone|tel[eé]fono|m[oó]vil|celular|address|direcci[oó]n|employee_code)\b/i;
// Funciones y catálogos del sistema: exfiltración o DoS
const DANGEROUS_FNS = /\b(pg_sleep|pg_read_file|pg_ls_dir|pg_read_binary_file|dblink|dblink_connect|lo_import|lo_export|lo_get|lo_put|current_setting|set_config|query_to_xml|database_to_xml|table_to_xml|crypt|pg_terminate_backend|pg_stat_)\b/i;
const SYSTEM_CATALOG = /\b(pg_catalog|information_schema)\b|\bpg_\w+/i;

export function validateReadOnlySql(sql) {
  const s = String(sql || '').trim();
  if (!MUST_SELECT.test(s)) return { ok: false, reason: 'Solo se permiten consultas SELECT/WITH' };
  if (MULTI.test(s)) return { ok: false, reason: 'No se permiten múltiples sentencias' };
  if (FORBIDDEN.test(s)) return { ok: false, reason: 'Palabra clave no permitida en modo solo lectura' };
  if (DANGEROUS_FNS.test(s)) return { ok: false, reason: 'Funciones del sistema no permitidas' };
  if (SYSTEM_CATALOG.test(s)) return { ok: false, reason: 'Catálogos del sistema no accesibles' };
  if (SENSITIVE_COLUMNS.test(s)) return { ok: false, reason: 'La consulta toca datos personales de clientes (protegido por política de privacidad)' };
  // Límite de filas: envolver en subconsulta con LIMIT si no trae
  if (!/\blimit\b/i.test(s)) return { ok: true, sql: `SELECT * FROM (${s}) _q LIMIT 100` };
  return { ok: true, sql: s };
}

// --- Enmascarado PII de resultados (defensa en profundidad) ---
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /\+?\d{9,}/g; // 9+ dígitos seguidos (fechas y precios no calzan)

function maskEmail(v) {
  return v.replace(EMAIL_RE, (m) => {
    const [user, dom] = m.split('@');
    return `${user.slice(0, 2)}***@${dom}`;
  });
}
function maskName(v) {
  // "Elena Rossi Gómez" → "Elena R. G."
  return v.split(/\s+/).map((w, i) => (i === 0 ? w : w ? `${w[0]}.` : w)).join(' ');
}
function maskPhone(v) {
  return v.replace(PHONE_RE, (m) => `••••${m.slice(-2)}`);
}

/** Enmascara PII en las filas devueltas por el chat. Devuelve { rows, masked }. */
export function maskPiiRows(rows) {
  let masked = 0;
  const out = (rows || []).map((row) => {
    const r = { ...row };
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v == null) continue;
      if (/pass/i.test(k)) { r[k] = '••••••'; masked++; continue; }
      if (/e-?mail|correo/i.test(k) && typeof v === 'string') { r[k] = maskEmail(v); masked++; continue; }
      if (/phone|tel[eé]fono|m[oó]vil|celular/i.test(k) && typeof v === 'string') { r[k] = maskPhone(v); masked++; continue; }
      if (/full_name|customer_name|nombre|cliente/i.test(k) && typeof v === 'string') { r[k] = maskName(v); masked++; continue; }
      if (/address|direcci[oó]n/i.test(k) && typeof v === 'string') { r[k] = '••••••'; masked++; continue; }
      // Enmascarado por contenido: captura alias renombrados (SELECT email AS dato)
      if (typeof v === 'string') {
        const s2 = maskPhone(maskEmail(v));
        if (s2 !== v) { r[k] = s2; masked++; }
      } else if (typeof v === 'object') {
        // JSONB (ej. ai_sessions.messages): enmascarar strings anidados
        const before = JSON.stringify(v);
        const after = maskPhone(maskEmail(before));
        if (after !== before) { try { r[k] = JSON.parse(after); masked++; } catch { /* intacto */ } }
      }
    }
    return r;
  });
  return { rows: out, masked };
}
