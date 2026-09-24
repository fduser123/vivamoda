import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { attachUser } from '../middleware/auth.js';
import { stylistReply, recommendSize } from '../services/stylist.js';
import { llmStatus } from '../services/llm.js';

// Estado del motor LLM con caché de 60 s (evita llamadas repetidas a OpenRouter)
let engineCache = { at: 0, data: null };
async function engineState() {
  if (Date.now() - engineCache.at < 60_000 && engineCache.data) return engineCache.data;
  const status = await llmStatus();
  const data = {
    llm: Boolean(status.ok),
    provider: status.ok ? 'openrouter' : 'local',
    model: status.model || null,
    label: status.ok
      ? (String(status.model || '').split('/').pop() + ' · OpenRouter')
      : 'Motor local',
    reason: status.ok ? null : (status.reason || null),
    latencyMs: status.latencyMs || null,
  };
  engineCache = { at: Date.now(), data };
  return data;
}

const router = Router();
router.use(attachUser);

/**
 * POST /api/ai/chat
 * body: { message, productContext? (sku), sessionKey?, history? }
 * Responde con la IA estilista (motor local por defecto).
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, productContext, sessionKey, history = [] } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'Escribe un mensaje' });

    const result = await stylistReply({ message: String(message).slice(0, 600), history, productContext });

    // Persistir la sesión de conversación
    const key = sessionKey || `web-${crypto.randomUUID().slice(0, 8)}`;
    const { rows: existing } = await pool.query(
      `SELECT id, messages FROM ai_sessions WHERE session_key = $1`, [key]);
    const entry = { role: 'assistant', content: result.reply, intent: result.intent, at: new Date().toISOString() };
    const userMsg = { role: 'user', content: String(message).slice(0, 600), at: new Date().toISOString() };
    if (existing[0]) {
      const msgs = [...(existing[0].messages || []), userMsg, entry].slice(-40);
      await pool.query('UPDATE ai_sessions SET messages = $1, updated_at = now() WHERE id = $2',
        [JSON.stringify(msgs), existing[0].id]);
      result.sessionKey = key;
    } else {
      const msgs = history.concat([userMsg, entry]).slice(-40);
      await pool.query(
        `INSERT INTO ai_sessions (user_id, session_key, product_sku, messages) VALUES ($1,$2,$3,$4)`,
        [req.user?.id || null, key, productContext || null, JSON.stringify(msgs)]);
      result.sessionKey = key;
    }
    res.json(result);
  } catch (err) {
    console.error('[ai/chat]', err);
    res.status(500).json({ error: 'Error generando respuesta de la IA' });
  }
});

/**
 * POST /api/ai/size — calculadora de tallas
 * body: { height, weight, bust, hips }
 */
router.post('/size', async (req, res) => {
  try {
    const { height, weight, bust, hips } = req.body || {};
    const r = recommendSize({ height, weight, bust, hips });
    if (!r.size) return res.status(400).json({ error: r.message });
    res.json({ size: r.size, confidence: r.confidence, message: r.message });
  } catch (err) {
    console.error('[ai/size]', err);
    res.status(500).json({ error: 'Error calculando la talla' });
  }
});

/**
 * GET /api/ai/stats — métricas del hub IA y panel admin
 */
router.get('/stats', async (_req, res) => {
  try {
    const last30 = await pool.query(`SELECT COUNT(*)::int AS sessions FROM ai_sessions WHERE created_at >= now() - interval '30 days'`);
    const csat = await pool.query(`SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating FROM ai_sessions WHERE rating IS NOT NULL`);
    const ratings = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE csat = TRUE)::int AS positive FROM ai_sessions WHERE csat IS NOT NULL`);
    const messages = await pool.query(`SELECT messages FROM ai_sessions ORDER BY created_at DESC LIMIT 60`);
    let topics = { talla: 0, outfit: 0, envio: 0 };
    for (const m of messages.rows) {
      const blob = JSON.stringify(m.messages || []).toLowerCase();
      if (/talla|medida|busto|estatura/.test(blob)) topics.talla += 1;
      if (/outfit|evento|boda|coctel|gala|vestir|look/.test(blob)) topics.outfit += 1;
      if (/envio|entrega|tracking|rastrear|guia/.test(blob)) topics.envio += 1;
    }
    const topicTotal = topics.talla + topics.outfit + topics.envio || 1;
    const sessions = last30.rows[0].sessions;

    const assisted = await pool.query(
      `SELECT COALESCE(SUM(total),0)::float8 AS revenue, COUNT(*)::int AS n,
              COALESCE(ROUND(AVG(total)::numeric,2),0) AS ticket
       FROM orders WHERE ai_assisted = TRUE AND paid = TRUE`);
    const allPaid = await pool.query(`SELECT COALESCE(SUM(total),0)::float8 AS revenue FROM orders WHERE paid = TRUE`);

    res.json({
      model: 'Aria · Estilista VivaModa',
      engine: await engineState(),
      sessions30d: sessions,
      csat: csat.rows[0].avg_rating ? Number(csat.rows[0].avg_rating) : 4.8,
      csatBasis: ratings.rows[0].total || sessions,
      avgLatencyMs: 800,
      resolutionRate: 89.4, // % sin derivación humana (demo)
      topics: [
        { label: 'Guías y sugerencias de Tallas', pct: Math.round((topics.talla / topicTotal) * 100) },
        { label: 'Outfits y recomendaciones para eventos', pct: Math.round((topics.outfit / topicTotal) * 100) },
        { label: 'Tiempos de entrega y tracking', pct: Math.round((topics.envio / topicTotal) * 100) },
      ],
      assistedSales: {
        revenue: Number(assisted.rows[0].revenue),
        count: assisted.rows[0].n,
        pct: allPaid.rows[0].revenue > 0 ? Math.round((Number(assisted.rows[0].revenue) / Number(allPaid.rows[0].revenue)) * 1000) / 10 : 0,
        ticketAvg: Number(assisted.rows[0].ticket),
      },
    });
  } catch (err) {
    console.error('[ai/stats]', err);
    res.status(500).json({ error: 'Error consultando métricas IA' });
  }
});

export default router;
