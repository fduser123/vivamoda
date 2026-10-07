import { Router } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { attachUser } from '../middleware/auth.js';
import { stylistReply, recommendSize } from '../services/stylist.js';
import { llmStatus } from '../services/llm.js';
import { loadMemory, recordEvent } from '../services/memory.js';
import { analyzeOutfitImage, personalizedRecommendations } from '../services/vision-stylist.js';
import { describePhotoForTryOn, generateTryOnImage, imagegenStatus } from '../services/imagegen.js';

// Estado del motor LLM con caché de 60 s (evita pings repetidos al proveedor)
let engineCache = { at: 0, data: null };
async function engineState() {
  if (Date.now() - engineCache.at < 60_000 && engineCache.data) return engineCache.data;
  const status = await llmStatus();
  const providerLabel = status.providerLabel || 'OpenRouter';
  const data = {
    llm: Boolean(status.ok),
    provider: status.ok ? status.provider : 'local',
    providerLabel: status.providerLabel || null,
    model: status.model || null,
    label: status.ok
      ? (String(status.model || '').split('/').pop() + ` · ${providerLabel}`)
      : 'Motor local',
    reason: status.ok ? null : (status.reason || null),
    latencyMs: status.latencyMs || null,
  };
  engineCache = { at: Date.now(), data };
  return data;
}

const router = Router();
router.use(attachUser);

// SEGURIDAD: /memory devuelve lo que Aria recuerda de cada cliente (tallas,
// presupuestos, preferencias) y /stats expone el uso interno de IA. Estaban
// accesibles SIN autenticación. Se exige admin en las rutas de lectura interna;
// el resto del router (chat, tallas, estilos) sigue siendo público porque lo
// usan clientes anónimos.
function soloAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores' });
  }
  next();
}

/**
 * Historial guardado de la sesión: así Aria recuerda la conversación entre
 * mensajes aunque el cliente no reenvíe el historial desde el navegador.
 */
async function loadHistory(key, fallback = []) {
  if (!key) return fallback;
  try {
    const { rows } = await pool.query(`SELECT messages FROM ai_sessions WHERE session_key = $1`, [key]);
    const msgs = rows[0]?.messages || [];
    const clean = msgs.filter((m) => m?.role && m?.content).slice(-8).map((m) => ({ role: m.role, content: m.content }));
    return clean.length ? clean : fallback;
  } catch {
    return fallback;
  }
}

/** Guarda el turno completo en ai_sessions (memoria conversacional). */
async function persistSession({ key, userId, productContext, message, result, history }) {
  try {
    const { rows: existing } = await pool.query(`SELECT id, messages FROM ai_sessions WHERE session_key = $1`, [key]);
    const entry = { role: 'assistant', content: result.reply, intent: result.intent, at: new Date().toISOString() };
    const userMsg = { role: 'user', content: String(message).slice(0, 600), at: new Date().toISOString() };
    if (existing[0]) {
      const msgs = [...(existing[0].messages || []), userMsg, entry].slice(-40);
      await pool.query(
        `UPDATE ai_sessions SET messages = $1, updated_at = now(), user_id = COALESCE(user_id, $3) WHERE id = $2`,
        [JSON.stringify(msgs), existing[0].id, userId || null],
      );
    } else {
      const msgs = (history || []).concat([userMsg, entry]).slice(-40);
      await pool.query(
        `INSERT INTO ai_sessions (user_id, session_key, product_sku, messages) VALUES ($1,$2,$3,$4)`,
        [userId || null, key, productContext || null, JSON.stringify(msgs)],
      );
    }
  } catch (err) {
    console.warn('[ai/chat] no pude guardar la sesión:', err.message);
  }
}

/**
 * POST /api/ai/chat
 * body: { message, productContext? (sku), sessionKey?, history? }
 * Responde con la IA estilista (memoria + contexto de BD + internet).
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, productContext, sessionKey, history = [] } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'Escribe un mensaje' });

    const key = sessionKey || `web-${crypto.randomUUID().slice(0, 8)}`;
    const pastHistory = await loadHistory(key, history);
    const userId = req.user?.id || null;

    const result = await stylistReply({
      message: String(message).slice(0, 600),
      history: pastHistory,
      productContext,
      sessionKey: key,
      userId,
    });
    result.sessionKey = key;

    await persistSession({ key, userId, productContext, message, result, history: pastHistory });
    res.json(result);
  } catch (err) {
    console.error('[ai/chat]', err);
    res.status(500).json({ error: 'Error generando respuesta de la IA' });
  }
});

/**
 * POST /api/ai/chat/stream
 * Igual que /chat pero en Server-Sent Events: el texto llega fragmento a
 * fragmento (fluidez percibida) y al final un evento `done` con todo el
 * payload (sugerencias, memoria, fuentes, motor…).
 */
router.post('/chat/stream', async (req, res) => {
  const { message, productContext, sessionKey, history = [] } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'Escribe un mensaje' });

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const key = sessionKey || `web-${crypto.randomUUID().slice(0, 8)}`;
  const userId = req.user?.id || null;
  send('start', { sessionKey: key });

  try {
    const pastHistory = await loadHistory(key, history);
    const result = await stylistReply({
      message: String(message).slice(0, 600),
      history: pastHistory,
      productContext,
      sessionKey: key,
      userId,
      onDelta: (text) => send('delta', { text }),
    });
    result.sessionKey = key;
    await persistSession({ key, userId, productContext, message, result, history: pastHistory });
    send('done', result);
  } catch (err) {
    console.error('[ai/chat/stream]', err);
    send('error', { error: 'Error generando respuesta de la IA' });
  } finally {
    res.end();
  }
});

/**
 * POST /api/ai/feedback — feedback implícito del cliente sobre una sugerencia
 * body: { sku, event: 'clicked' | 'added_to_cart' | 'purchased', sessionKey? }
 * Aria lo usa para priorizar lo que el cliente ya miró o compró.
 */
router.post('/feedback', async (req, res) => {
  try {
    const { sku, event = 'clicked', sessionKey } = req.body || {};
    const row = await recordEvent({ userId: req.user?.id || null, sessionKey, sku, event });
    res.json({ ok: Boolean(row), sku: row?.sku || null, event: row?.event || null });
  } catch (err) {
    console.error('[ai/feedback]', err);
    res.status(500).json({ error: 'No pude registrar el interés' });
  }
});

/** GET /api/ai/memory?sessionKey=… — lo que Aria ha aprendido del cliente */
router.get('/memory', soloAdmin, async (req, res) => {
  try {
    const memory = await loadMemory({ userId: req.user?.id || null, sessionKey: req.query.sessionKey || null });
    res.json({ facts: memory.rows, total: memory.rows.length });
  } catch (err) {
    console.error('[ai/memory]', err);
    res.status(500).json({ error: 'Error leyendo la memoria' });
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
 * POST /api/ai/analyze-outfit — IA #10 Estilista Visual (+ perfil de silueta)
 * body: { image: dataURL (≤450KB), palette: [{r,g,b,pct}], body?: { shape?, height?, waist?, bust?, hips? } }
 */
router.post('/analyze-outfit', async (req, res) => {
  try {
    const { image, palette, body } = req.body || {};
    const cleanBody = body && typeof body === 'object' ? {
      shape: typeof body.shape === 'string' ? body.shape : undefined,
      height: Number(body.height) || undefined,
      waist: Number(body.waist) || undefined,
      bust: Number(body.bust) || undefined,
      hips: Number(body.hips) || undefined,
      auto: body.auto && typeof body.auto === 'object' ? {
        shoulder: Number(body.auto.shoulder) || undefined,
        waist: Number(body.auto.waist) || undefined,
        hip: Number(body.auto.hip) || undefined,
      } : undefined,
    } : null;
    const analysis = await analyzeOutfitImage({ image, palette: Array.isArray(palette) ? palette : [], body: cleanBody });
    res.json({ ok: true, analysis });
  } catch (err) {
    console.error('[ai/analyze-outfit]', err);
    res.status(400).json({ error: err.message || 'No se pudo analizar la imagen' });
  }
});

/**
 * POST /api/ai/style-match — IA #11 Recomendador personalizado
 * body: { analysis } (resultado de /analyze-outfit)
 */
router.post('/style-match', async (req, res) => {
  try {
    const analysis = req.body?.analysis;
    // Modo QR (guía de producto): sin foto → se acepta garmentType sin colors
    if (!analysis || (!analysis.colors?.length && !analysis.garmentType)) return res.status(400).json({ error: 'Falta el análisis visual (envía primero la foto)' });
    const rec = await personalizedRecommendations({ analysis, user: req.user || null });
    res.json({ ok: true, ...rec });
  } catch (err) {
    console.error('[ai/style-match]', err);
    res.status(500).json({ error: 'Error generando recomendaciones personalizadas' });
  }
});

/**
 * GET /api/ai/stats — métricas del hub IA y panel admin
 */
router.get('/stats', soloAdmin, async (_req, res) => {
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

/**
 * POST /api/ai/tryon — vista previa "¿cómo me quedaría?"
 * body: { image (dataURL ≤450KB), garment: { name, category, description? } }
 * 1) LLM de visión describe la foto (cuerpo/cabello/tono/pose)
 * 2) FLUX.1-schnell genera la foto con la prenda recomendada
 * Respuesta: { ok, image (dataURL), latencyMs, engine } | { ok: false, error }
 */
router.post('/tryon', async (req, res) => {
  try {
    const { image, garment } = req.body || {};
    if (!image || !garment?.name) return res.status(400).json({ ok: false, error: 'Faltan image o garment.name' });
    if (image.length > 600_000) return res.status(400).json({ ok: false, error: 'Imagen demasiado grande' });

    const { text: photoDescription, engine: descEngine } = await describePhotoForTryOn(image);
    const result = await generateTryOnImage({
      photoDescription,
      garment: {
        name: String(garment.name).slice(0, 120),
        category: String(garment.category || '').slice(0, 60),
        description: String(garment.description || '').slice(0, 200),
      },
    });
    if (!result.ok) {
      console.warn('[ai/tryon]', result.error);
      return res.status(502).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, image: result.image, latencyMs: result.latencyMs, engine: imagegenStatus().model, descEngine });
  } catch (err) {
    console.error('[ai/tryon]', err);
    res.status(500).json({ ok: false, error: err.message || 'Error generando la vista previa' });
  }
});

export default router;
