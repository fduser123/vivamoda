// =====================================================================
// ADMINISTRACIÓN DE LA IA — endpoints del panel
//
//   GET    /api/admin/ia/metricas        → rendimiento (llamadas, coste, latencia)
//   GET    /api/admin/ia/ajustes         → configuración en vigor
//   PUT    /api/admin/ia/ajustes         → cambiarla desde el panel
//   GET    /api/admin/ia/conocimiento    → base de conocimiento y reglas
//   POST   /api/admin/ia/conocimiento    → crear
//   PATCH  /api/admin/ia/conocimiento/:id→ editar
//   DELETE /api/admin/ia/conocimiento/:id→ borrar
//   GET    /api/admin/ia/estado          → salud del motor y de los proveedores
//
// Todo detrás de requireRole('admin').
// =====================================================================
import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { config } from '../config.js';
import {
  metricasIA, leerAjustes, guardarAjustes, listarConocimiento, crearConocimiento,
  actualizarConocimiento, borrarConocimiento, CATEGORIAS,
} from '../services/ai-admin.js';
import { llmProvider, ajustesEnVigor } from '../services/llm-provider.js';
import { estadoEmbeddings } from '../services/vector-search.js';

const router = Router();
router.use(requireRole('admin'));

/** GET /metricas — rendimiento de la IA en los últimos N días. */
router.get('/metricas', async (req, res) => {
  try {
    const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
    res.json(await metricasIA({ dias }));
  } catch (err) {
    console.error('[admin/ia/metricas]', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /ajustes — configuración efectiva + de dónde sale cada valor. */
router.get('/ajustes', async (_req, res) => {
  try {
    const deBD = await leerAjustes({ forzar: true });
    const provider = llmProvider();
    res.json({
      ajustes: deBD,
      en_vigor: {
        proveedor: provider?.name || null,
        etiqueta: provider?.label || null,
        modelo: provider?.model || null,
        motor_local: !provider,
        url_embeddings: config.embedServiceUrl,
      },
      // El .env sigue siendo el respaldo: se muestra para saber qué manda
      desde_entorno: {
        llm_provider: config.llmProvider,
        deepseek_model: config.deepseekModel,
        gemini_model: config.geminiModel,
        openrouter_model: config.openrouterModel,
        use_local_ai: config.useLocalAi,
      },
      cache: ajustesEnVigor(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /ajustes — cambia la configuración sin tocar el .env ni reiniciar. */
router.put('/ajustes', async (req, res) => {
  try {
    const permitidos = ['llm_model', 'llm_provider', 'temperature', 'max_tokens_chat', 'use_local_ai', 'rag_top_k', 'rag_top_n'];
    const cambios = Object.fromEntries(
      Object.entries(req.body || {}).filter(([k]) => permitidos.includes(k)));
    if (!Object.keys(cambios).length) {
      return res.status(400).json({ error: 'Nada que cambiar', permitidos });
    }
    if (cambios.llm_provider && !['', 'gemini', 'deepseek', 'openrouter'].includes(String(cambios.llm_provider))) {
      return res.status(400).json({ error: 'Proveedor no válido (gemini | deepseek | openrouter | vacío)' });
    }
    const ajustes = await guardarAjustes(cambios);
    res.json({ ok: true, ajustes, en_vigor: llmProvider()?.model || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /conocimiento — reglas y base de conocimiento. */
router.get('/conocimiento', async (_req, res) => {
  try {
    res.json({ categorias: CATEGORIAS, items: await listarConocimiento() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /conocimiento */
router.post('/conocimiento', async (req, res) => {
  try {
    const { category, title, content, active, priority } = req.body || {};
    if (!category || !title || !content) {
      return res.status(400).json({ error: 'Faltan categoría, título o contenido' });
    }
    if (!CATEGORIAS.includes(category)) {
      return res.status(400).json({ error: `Categoría no válida. Usa: ${CATEGORIAS.join(', ')}` });
    }
    const item = await crearConocimiento({
      category, title, content,
      active: active !== false,
      priority: Number(priority) || 100,
    });
    res.status(201).json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /conocimiento/:id */
router.patch('/conocimiento/:id', async (req, res) => {
  try {
    const item = await actualizarConocimiento(Number(req.params.id), req.body || {});
    if (!item) return res.status(404).json({ error: 'Entrada no encontrada' });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /conocimiento/:id */
router.delete('/conocimiento/:id', async (req, res) => {
  try {
    const ok = await borrarConocimiento(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Entrada no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /estado — salud del proveedor de IA y del motor de embeddings. */
router.get('/estado', async (_req, res) => {
  try {
    const provider = llmProvider();
    const emb = await estadoEmbeddings();
    res.json({
      proveedor: provider
        ? { ok: true, nombre: provider.name, etiqueta: provider.label, modelo: provider.model, vision: provider.visionModel }
        : { ok: false, motivo: 'sin proveedor: se usa el motor local de reglas' },
      embeddings: emb,
      motor_local: !provider,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
