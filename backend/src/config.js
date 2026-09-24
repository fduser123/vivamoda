import 'dotenv/config';

const bool = (v, def = false) => (v === undefined ? def : String(v).toLowerCase() === 'true');

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://vivamoda:vivamoda_dev@localhost:5432/vivamoda',
  jwtSecret: process.env.JWT_SECRET || 'vivamoda-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  // --- IA Estilista ---
  // OpenRouter (API compatible con OpenAI). La clave también se acepta en OPENAI_API_KEY.
  openrouterApiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || null,
  openrouterModel: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct',
  useLocalAi: bool(process.env.USE_LOCAL_AI, false), // true → fuerza el motor local de reglas
};
