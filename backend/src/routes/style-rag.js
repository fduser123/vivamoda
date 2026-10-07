// =====================================================================
// FASE 1 · ASESOR DE ESTILISMO (RAG) Y BÚSQUEDA VISUAL
//
//   POST /api/ai/style-chat     { message, session_id? }
//   POST /api/ai/visual-search  imagen (JSON base64, data URL o binario)
//   GET  /api/ai/embeddings/status
//
// Nota de diseño: el catálogo, la autenticación y el carrito viven en este
// backend de Node, así que estas rutas se montan aquí en vez de levantar un
// FastAPI aparte. Lo único que queda en Python es el sidecar de embeddings
// (ai/embed_server.py), porque FashionCLIP sólo existe en Python.
//
// Privacidad: las imágenes que sube el usuario NO se guardan. Se vectorizan
// en memoria, se devuelve la búsqueda y se descartan.
// =====================================================================
import { Router } from 'express';
import express from 'express';
import { responderEstilismo } from '../services/style-assistant.js';
import {
  buscarPorImagen, estadoEmbeddings, coberturaEmbeddings, embedImage,
} from '../services/vector-search.js';

const router = Router();

// La búsqueda visual acepta imagen binaria en el cuerpo (multipart no hace
// falta: la orden pide multipart, pero esto evita sumar multer y acepta
// igualmente JSON con base64 y data URL).
const crudo = express.raw({ type: ['image/*', 'application/octet-stream'], limit: '12mb' });

function normalizarEntrada(input) {
  if (!input) return null;
  const s = String(input).trim();
  // data URL → base64 pelado
  const m = s.match(/^data:image\/[a-zA-Z+.-]+;base64,(.+)$/s);
  return (m ? m[1] : s).replace(/\s/g, '');
}

/** POST /api/ai/style-chat — asistente de estilismo con RAG. */
router.post('/style-chat', async (req, res) => {
  try {
    const { message, session_id: sessionId } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'Escribe una pregunta' });
    }
    const out = await responderEstilismo(String(message), { sessionId });
    if (out.error) return res.status(503).json({ error: out.error, fase: out.fase });
    res.json({
      reply: out.respuesta,
      products: out.productos.map((p) => ({
        sku: p.sku, name: p.name, category: p.category, price: p.price,
        image: p.image_url, color: p.color_main, garment: p.garment_type,
        occasion: p.occasion, material: p.material, stock: p.stock_total,
        similarity: Number(p.similitud?.toFixed(4)), score: p.score_rerank,
        reasons: p.motivos,
      })),
      plan: out.plan,
      plan_source: out.planOrigen,
      filters_relaxed: out.relajado,
      grounding: out.grounding,
      usage: out.usage,
      latency_ms: out.ms,
      phases_ms: out.fases,
      session_id: sessionId || null,
    });
  } catch (err) {
    console.error('[ai/style-chat]', err);
    res.status(500).json({ error: 'Error en el asesor de estilismo' });
  }
});

/** POST /api/ai/visual-search — busca prendas parecidas a una foto. */
router.post('/visual-search', crudo, async (req, res) => {
  try {
    let b64 = null;
    if (Buffer.isBuffer(req.body) && req.body.length) {
      b64 = req.body.toString('base64');            // imagen binaria
    } else if (req.body && req.body.image) {
      b64 = normalizarEntrada(req.body.image);      // JSON: base64 o data URL
    }
    if (!b64) {
      return res.status(400).json({
        error: 'Falta la imagen. Envía JSON {"image":"<base64 o data URL>"} o el binario con Content-Type image/*',
      });
    }

    const t0 = Date.now();
    const K = Math.max(1, Math.min(30, Number(req.query.k || req.body.k || 8)));
    const filtros = {
      genero: req.query.genero || null,
      categoria: req.query.categoria || null,
      prenda: req.query.prenda || null,
      precioMax: req.query.precioMax ? Number(req.query.precioMax) : null,
      soloConStock: req.query.stock !== 'false',
    };
    const tEmb = Date.now();
    const [vector] = await embedImage([b64]);
    const msEmbed = Date.now() - tEmb;

    const { buscarPorVector } = await import('../services/vector-search.js');
    const filas = await buscarPorVector(vector, { k: K, espacio: 'image', filtros });

    res.json({
      results: filas.map((p) => ({
        sku: p.sku, name: p.name, category: p.category, price: p.price,
        image: p.image_url, color: p.color_main, garment: p.garment_type,
        occasion: p.occasion, material: p.material, stock: p.stock_total,
        similarity: Number(p.similitud?.toFixed(4)),
      })),
      count: filas.length,
      latency_ms: Date.now() - t0,
      embed_ms: msEmbed,
      filters: filtros,
    });
  } catch (err) {
    console.error('[ai/visual-search]', err);
    res.status(500).json({ error: 'Error en la búsqueda visual: ' + err.message });
  }
});

/** GET /api/ai/embeddings/status — salud del sidecar y cobertura del catálogo. */
router.get('/embeddings/status', async (_req, res) => {
  try {
    const [sidecar, cobertura] = await Promise.all([estadoEmbeddings(), coberturaEmbeddings()]);
    res.json({ sidecar, cobertura });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
