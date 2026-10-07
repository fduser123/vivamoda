import 'dotenv/config';

const bool = (v, def = false) => (v === undefined ? def : String(v).toLowerCase() === 'true');

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://vivamoda:vivamoda_dev@localhost:5432/vivamoda',
  jwtSecret: process.env.JWT_SECRET || 'vivamoda-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  // --- IA Estilista ---
  // Proveedor LLM activo (ver services/llm-provider.js). Cualquiera de estos
  // habla la API compatible con OpenAI, así que cambiar de proveedor es solo
  // cuestión de variables de entorno.
  llmProvider: process.env.LLM_PROVIDER || null, // 'gemini' | 'deepseek' | 'openrouter' (forzado)
  llmBaseUrl: process.env.LLM_BASE_URL || null, // API compatible propia (Groq, Cerebras, Ollama…)
  llmApiKey: process.env.LLM_API_KEY || null,
  llmModel: process.env.LLM_MODEL || null,
  // Google Gemini (AI Studio) — tier gratuito. La llave también se acepta en GOOGLE_API_KEY.
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null,
  geminiBaseUrl: process.env.GEMINI_BASE_URL || null,
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  geminiVisionModel: process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  // OpenRouter (API compatible con OpenAI). La clave también se acepta en OPENAI_API_KEY.
  openrouterApiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || null,
  openrouterModel: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct',
  openrouterVisionModel: process.env.OPENROUTER_VISION_MODEL || 'meta-llama/llama-3.2-11b-vision-instruct',
  // DeepSeek (API compatible con OpenAI). Ojo: solo deepseek-flash acepta imágenes;
  // deepseek-v4-pro es solo texto, así que no debe usarse como visionModel.
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || null,
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || null,
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  deepseekVisionModel: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash',
  useLocalAi: bool(process.env.USE_LOCAL_AI, false), // true → fuerza el motor local de reglas
  // --- Fase 1: asesor de estilismo con RAG y búsqueda visual ---
  // Sidecar Python que sirve los embeddings de FashionCLIP (ai/embed_server.py).
  // FashionCLIP sólo existe en Python, así que el modelo vive ahí y Node sólo
  // consume los vectores por HTTP; el resto del pipeline (filtros, re-ranking,
  // generación) se queda en Node, junto al catálogo y la autenticación.
  embedServiceUrl: process.env.EMBED_SERVICE_URL || 'http://127.0.0.1:8001',
  // --- IA #11 Probador Virtual (Cloudflare Workers AI · FLUX.1-schnell) ---
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || null,
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || null,
};
