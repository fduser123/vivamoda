// =====================================================================
// Rutas IA del panel admin (requiere rol admin, montadas bajo /api/admin)
//   GET  /api/admin/ai/insights   → predicción de demanda + ABC + anomalías
//   POST /api/admin/ai/report     → informe ejecutivo (LLM con fallback local)
//   POST /api/admin/ai/ask        → chat text-to-SQL de SOLO LECTURA
// =====================================================================
import { Router } from 'express';
import { pool } from '../db.js';
import { llmProvider, callChat } from '../services/llm-provider.js';
import { FACT_LABELS } from '../services/memory.js';
import { demandForecast, abcClassification, detectAnomalies, executiveReport, validateReadOnlySql, maskPiiRows } from '../services/admin-ai.js';
import { detectSalesTrends, buildPurchasePlan } from '../services/strategic-advisor.js';

const router = Router();

const SYSTEM_SQL = `Eres el analista de datos de VivaModa (PostgreSQL). Convierte la pregunta del gerente en UNA consulta SELECT de solo lectura.

ESQUEMA (tablas y columnas relevantes):
- stores(id, code, name, city, channel)
- users(id, email, full_name, role, vip_tier, points, created_at)
- products(id, sku, name, gender, category, badge, price, cost, rating, review_count, is_active, visibility, created_at)
- product_variants(id, product_id, size, color, sku)
- inventory(id, variant_id, store_id, qty, reorder_point)
- orders(id, order_no, user_id, store_id, channel, status, customer_name, payment_method, paid, subtotal, discount, tax, total, ai_assisted, created_at)
- order_items(id, order_id, product_id, variant_id, product_name, sku, size, unit_price, qty)
- ai_sessions(id, user_id, session_key, product_sku, messages, rating, csat)

REGLAS ESTRICTAS:
1. Genera SOLO la consulta SQL, sin markdown, sin explicaciones, sin punto y coma final.
2. Una única sentencia SELECT (o WITH). Prohibido INSERT/UPDATE/DELETE/DDL.
3. PROHIBIDO seleccionar datos personales de clientes: email, phone, full_name, customer_name, address, employee_code, password_hash. Para preguntas sobre clientes usa SIEMPRE agregados (COUNT, SUM, AVG, GROUP BY) o atributos no identificables (vip_tier, points, role). Ejemplo CORRECTO: SELECT vip_tier, COUNT(*) FROM users GROUP BY vip_tier. Ejemplo INCORRECTO: SELECT full_name, email FROM users.
4. Usa JOINs correctos. Los importes están en dólares (columna total de orders, unit_price*qty en order_items).
5. Limita resultados a 20 filas cuando la pregunta pida listados ("top", "mejores", "mayores").
6. Para "ventas" usa orders.total con orders.paid = TRUE y status <> 'cancelled', salvo que pidan unidades (order_items.qty).
7. Si la pregunta no puede responderse con estas tablas, responde exactamente: NO_SQL`;

/** GET /api/admin/ai/insights */
router.get('/insights', async (req, res) => {
  try {
    const storeId = req.query.storeId ? Number(req.query.storeId) : null;
    const days = Math.min(Number(req.query.days) || 90, 365);
    const [forecast, abc, anomalies] = await Promise.all([
      demandForecast({ storeId }),
      abcClassification({ days }),
      detectAnomalies({ storeId }),
    ]);
    res.json({
      forecast: { horizonDays: forecast.horizonDays, generatedAt: forecast.generatedAt, alertsCount: forecast.alertsCount, critical: forecast.critical, items: forecast.items.slice(0, 30) },
      abc: { summary: abc.summary, total: abc.total, items: abc.items.slice(0, 30) },
      anomalies: anomalies.anomalies,
      stuck: { count: anomalies.stuckCount, value: anomalies.stuckValue },
    });
  } catch (err) {
    console.error('[admin-ai/insights]', err);
    res.status(500).json({ error: 'Error generando insights' });
  }
});

/**
 * GET /api/admin/ai/memory — qué ha aprendido Aria de cada cliente
 * Agrupa por dueño (usuario registrado o sesión anónima) e incluye las
 * señales de interés recientes (aprendizaje por clics sobre las sugerencias).
 * Query: ?q= (filtra por cliente, clave o valor) &limit=
 */
router.get('/memory', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const like = q ? `%${q}%` : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

    const { rows } = await pool.query(
      `SELECT m.id, m.user_id, m.session_key, m.key, m.value,
              m.confidence::float8 AS confidence, m.hits, m.source, m.updated_at,
              u.full_name, u.email, u.vip_tier
       FROM ai_memory m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE ($1::text IS NULL
              OR LOWER(m.key) LIKE $1 OR LOWER(m.value) LIKE $1
              OR LOWER(COALESCE(u.full_name, '')) LIKE $1
              OR LOWER(COALESCE(u.email, '')) LIKE $1
              OR LOWER(COALESCE(m.session_key, '')) LIKE $1)
       ORDER BY m.user_id NULLS LAST, m.updated_at DESC
       LIMIT $2`,
      [like, limit],
    );

    const owners = new Map();
    for (const r of rows) {
      const kind = r.user_id ? 'user' : 'session';
      const mapKey = `${kind}:${r.user_id || r.session_key}`;
      if (!owners.has(mapKey)) {
        owners.set(mapKey, {
          kind,
          id: r.user_id || null,
          sessionKey: r.session_key || null,
          name: r.full_name || (kind === 'session' ? `Visitante ${String(r.session_key || '').replace(/^web-/, '')}` : `Usuario ${r.user_id}`),
          email: r.email || null,
          vip: r.vip_tier || null,
          facts: [],
        });
      }
      owners.get(mapKey).facts.push({
        id: r.id,
        key: r.key,
        label: FACT_LABELS[r.key] || r.key,
        value: r.value,
        confidence: r.confidence,
        hits: r.hits,
        source: r.source,
        updatedAt: r.updated_at,
      });
    }

    // Señales de interés: lo que el cliente miró/añadió y que reordena sus recomendaciones
    const { rows: events } = await pool.query(
      `SELECT e.sku, p.name, e.event, COUNT(*)::int AS veces, MAX(e.created_at) AS ultimo,
              COALESCE(u.full_name, e.session_key) AS cliente
       FROM ai_events e
       LEFT JOIN products p ON p.sku = e.sku
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.created_at > now() - interval '30 days'
       GROUP BY e.sku, p.name, e.event, cliente
       ORDER BY ultimo DESC
       LIMIT 12`,
    ).catch(() => ({ rows: [] }));

    const list = [...owners.values()];
    const porFuente = rows.reduce((acc, r) => { acc[r.source] = (acc[r.source] || 0) + 1; return acc; }, {});
    res.json({
      summary: {
        hechos: rows.length,
        usuarios: list.filter((o) => o.kind === 'user').length,
        sesiones: list.filter((o) => o.kind === 'session').length,
        porFuente,
      },
      owners: list,
      events: events.map((e) => ({
        sku: e.sku, name: e.name, event: e.event, veces: e.veces, cliente: e.cliente, ultimo: e.ultimo,
      })),
    });
  } catch (err) {
    console.error('[admin-ai/memory]', err);
    res.status(500).json({ error: 'Error consultando la memoria de Aria' });
  }
});

/** PATCH /api/admin/ai/memory/:id — corregir un hecho aprendido  body: { value } */
router.patch('/memory/:id', async (req, res) => {
  try {
    const value = String(req.body?.value ?? '').trim();
    if (!value) return res.status(400).json({ error: 'El valor no puede estar vacío' });
    const { rows } = await pool.query(
      `UPDATE ai_memory
       SET value = $2, confidence = 1.0, source = 'admin', updated_at = now()
       WHERE id = $1
       RETURNING id, key, value, source`,
      [Number(req.params.id) || 0, value.slice(0, 200)],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Hecho no encontrado' });
    res.json({ ok: true, fact: { ...rows[0], label: FACT_LABELS[rows[0].key] || rows[0].key } });
  } catch (err) {
    console.error('[admin-ai/memory/patch]', err);
    res.status(500).json({ error: 'Error corrigiendo la memoria' });
  }
});

/** DELETE /api/admin/ai/memory/:id — olvidar un hecho */
router.delete('/memory/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM ai_memory WHERE id = $1', [Number(req.params.id) || 0]);
    if (!rowCount) return res.status(404).json({ error: 'Hecho no encontrado' });
    res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    console.error('[admin-ai/memory/delete]', err);
    res.status(500).json({ error: 'Error borrando el hecho' });
  }
});

/** DELETE /api/admin/ai/memory — olvida todo lo de un cliente  body/query: { kind, id } */
router.delete('/memory', async (req, res) => {
  try {
    const kind = String(req.body?.kind || req.query.kind || '');
    const id = String(req.body?.id || req.query.id || '');
    if (!['user', 'session'].includes(kind) || !id) {
      return res.status(400).json({ error: 'Indica kind=user|session e id' });
    }
    const { rowCount } = kind === 'user'
      ? await pool.query('DELETE FROM ai_memory WHERE user_id = $1', [Number(id) || 0])
      : await pool.query('DELETE FROM ai_memory WHERE session_key = $1', [id]);
    res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    console.error('[admin-ai/memory/reset]', err);
    res.status(500).json({ error: 'Error borrando la memoria del cliente' });
  }
});

/** POST /api/admin/ai/report  body: { storeId?, period? } */
router.post('/report', async (req, res) => {
  try {
    const storeId = req.body?.storeId ? Number(req.body.storeId) : null;
    const period = ['today', '7d', 'month', 'quarter'].includes(req.body?.period) ? req.body.period : '7d';
    const out = await executiveReport({ storeId, period });
    res.json(out);
  } catch (err) {
    console.error('[admin-ai/report]', err);
    res.status(500).json({ error: 'Error generando el informe' });
  }
});

/** GET /api/admin/ai/trends?days=30 — tendencias de venta (categorías/colores/canales) */
router.get('/trends', async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 14), 180);
    const trends = await detectSalesTrends({ days });
    res.json(trends);
  } catch (err) {
    console.error('[admin-ai/trends]', err);
    res.status(500).json({ error: 'Error detectando tendencias' });
  }
});

/** POST /api/admin/ai/purchase-plan  body: { days?, budget? } — IA #12 asesor estratégico */
router.post('/purchase-plan', async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.body?.days) || 30, 14), 180);
    const budget = req.body?.budget ? Math.max(Number(req.body.budget), 50) : null;
    const planOut = await buildPurchasePlan({ days, budget });
    res.json(planOut);
  } catch (err) {
    console.error('[admin-ai/purchase-plan]', err);
    res.status(500).json({ error: 'Error generando el plan de compra' });
  }
});

/** POST /api/admin/ai/ask  body: { question, storeId? } → text-to-SQL de solo lectura */
router.post('/ask', async (req, res) => {
  const question = String(req.body?.question || '').slice(0, 500);
  if (!question.trim()) return res.status(400).json({ error: 'Escribe una pregunta' });

  const started = Date.now();
  let sql = null;
  let rows = [];
  let engine = 'local';
  let note = null;

  // --- Motor local: interpretación heurística por palabras clave (funciona sin LLM) ---
  const q = question.toLowerCase();
  const limit = 10;
  const wantsUnits = /unidades|uds|piezas|cantidad/.test(q);
  const storeMatch = /(central|centro|norte|online)/.exec(q);

  async function localQuery() {
    const storeJoin = storeMatch ? 'JOIN stores s ON s.id = o.store_id' : '';
    const storeCond = storeMatch ? `AND s.code ILIKE '%${storeMatch[1]}%'` : '';
    if (/más vendido|mas vendido|top|mejor|popular/.test(q)) {
      return {
        sql: `SELECT p.name, SUM(oi.qty) AS unidades, ROUND(SUM(oi.qty*oi.unit_price)::numeric,2) AS ingresos
              FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id ${storeJoin}
              WHERE o.paid = TRUE AND o.status <> 'cancelled' ${storeCond}
              GROUP BY p.name ORDER BY unidades DESC LIMIT ${limit}`,
      };
    }
    if (/stock|inventario|disponible|quiebre|agotad/.test(q)) {
      return {
        sql: `SELECT p.sku, p.name, SUM(i.qty) AS stock_total
              FROM products p JOIN product_variants v ON v.product_id = p.id JOIN inventory i ON i.variant_id = v.id
              WHERE p.is_active = TRUE
              GROUP BY p.sku, p.name ORDER BY stock_total ASC LIMIT ${limit}`,
      };
    }
    if (/cliente|comprador|vip/.test(q)) {
      return {
        sql: `SELECT u.vip_tier, COUNT(DISTINCT u.id) AS clientes, COUNT(o.id) AS pedidos, ROUND(SUM(o.total)::numeric,2) AS gastado
              FROM orders o JOIN users u ON u.id = o.user_id
              WHERE o.paid = TRUE AND o.status <> 'cancelled' AND u.id IS NOT NULL ${storeMatch ? 'AND o.store_id IN (SELECT id FROM stores WHERE code ILIKE ' + `'${'%' + storeMatch[1] + '%'}'` + ')' : ''}
              GROUP BY u.vip_tier ORDER BY gastado DESC`,
      };
    }
    // default: resumen de ventas del mes
    return {
      sql: `SELECT COUNT(*) AS pedidos, ROUND(SUM(o.total)::numeric,2) AS ingresos
            FROM orders o WHERE o.paid = TRUE AND o.status <> 'cancelled'
            AND o.created_at >= date_trunc('month', now())`,
    };
  }

  // --- LLM: traduce la pregunta a SQL ---
  const provider = llmProvider();
  if (provider) {
    try {
      const { ok, body } = await callChat(provider, {
        model: provider.model,
        messages: [
          { role: 'system', content: SYSTEM_SQL },
          { role: 'user', content: question },
        ],
        max_tokens: 300,
        temperature: 0,
      }, { timeoutMs: 45_000, attempts: 1, tag: 'admin-ask' });
      if (ok) {
        const raw = body?.choices?.[0]?.message?.content?.trim() || '';
        const cleaned = raw.replace(/```sql|```/gi, '').trim();
        if (/^NO_SQL$/i.test(cleaned)) {
          note = 'El LLM determinó que la pregunta no es respondible con el esquema; se usó la consulta aproximada local.';
        } else if (cleaned) {
          sql = cleaned;
          engine = 'llm';
        }
      }
    } catch { /* cae a local */ }
  }

  if (!sql) {
    const local = await localQuery();
    sql = local.sql;
    engine = engine === 'llm' ? 'llm+local' : 'local';
  }

  // --- Validación estricta y ejecución ---
  const check = validateReadOnlySql(sql);
  if (!check.ok) {
    return res.status(400).json({ error: `Consulta rechazada: ${check.reason}`, question });
  }
  try {
    const result = await pool.query(check.sql);
    rows = result.rows;
  } catch (err) {
    // La consulta del LLM falló → reintento con la heurística local
    const local = await localQuery();
    const fallback = validateReadOnlySql(local.sql);
    rows = (await pool.query(fallback.sql)).rows;
    engine = 'local';
    note = `La consulta generada falló (${String(err.message).slice(0, 80)}) → se respondió con el motor local.`;
  }

  // --- Defensa final: enmascarar PII en los resultados antes de enviarlos ---
  const { rows: safeRows, masked } = maskPiiRows(rows);
  if (masked > 0 && !note) note = `${masked} campo(s) de datos personales enmascarados por política de privacidad.`;
  else if (masked > 0) note = `${note} | ${masked} campo(s) de datos personales enmascarados.`;

  res.json({
    question,
    sql: check.sql,
    engine,
    note,
    rowCount: safeRows.length,
    rows: safeRows,
    latencyMs: Date.now() - started,
  });
});

export default router;
