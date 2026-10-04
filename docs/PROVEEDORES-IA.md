# 🔌 Proveedores de IA — cambiar de LLM sin tocar código

> Toda la IA conversacional y de análisis de VivaModa habla la **API compatible con OpenAI**.
> El proveedor activo se resuelve en un único módulo: `backend/src/services/llm-provider.js`.

## Cómo se elige el proveedor

Prioridad (la primera que exista gana):

| # | Variable de entorno | Proveedor | Modelo por defecto |
|---|---|---|---|
| 1 | `LLM_BASE_URL` + `LLM_API_KEY` | Cualquier API compatible (Groq, Cerebras, Mistral, Ollama…) | `LLM_MODEL` |
| 2 | `LLM_PROVIDER=gemini\|openrouter` | Forzado (si le falta la llave **no** se cae a otro) | el del proveedor |
| 3 | `GEMINI_API_KEY` (o `GOOGLE_API_KEY`) | Google Gemini (tier gratuito) | `gemini-2.5-flash` |
| 4 | `OPENROUTER_API_KEY` (o `OPENAI_API_KEY`) | OpenRouter | `meta-llama/llama-3.3-70b-instruct` |
| 5 | — | **Motor local de reglas** (el sistema sigue operando) | `aria-local-v1` |

## Activar Gemini (recomendado: gratis)

1. Crea una llave en [Google AI Studio](https://aistudio.google.com/apikey).
2. Añádela a `backend/.env`:

   ```env
   GEMINI_API_KEY=AIza...
   GEMINI_MODEL=gemini-2.5-flash        # opcional
   GEMINI_VISION_MODEL=gemini-2.5-flash # opcional (análisis de fotos)
   ```

3. Reinicia la API: `systemctl --user restart vivamoda-api` (o `npm start`).
4. Verifica el motor activo: `curl http://localhost:3000/api/ai/stats` →
   `{ "llm": true, "provider": "gemini", "label": "gemini-2.5-flash · Gemini" }`.

La UI lo refleja sola: el encabezado del Hub muestra `Motor: gemini-2.5-flash · Gemini`,
cada respuesta del chat lleva el chip del modelo y su tooltip nombra el proveedor.

## Qué usa el proveedor activo

| Función | Servicio | Ruta |
|---|---|---|
| Chat de Aria (texto) | `services/llm.js` | `POST /api/ai/chat` |
| Estilista visual (foto) | `services/vision-stylist.js` | `POST /api/ai/analyze-outfit` |
| Descripción para el probador virtual | `services/imagegen.js` | `POST /api/ai/tryon` |
| Informe ejecutivo | `services/admin-ai.js` | `POST /api/admin/ai/report` |
| Text-to-SQL (solo lectura) | `routes/admin-ai.js` | `POST /api/admin/ai/ask` |
| Asesor de compras | `services/strategic-advisor.js` | `POST /api/admin/ai/purchase-plan` |
| Traductor del catálogo | `services/translator.js` | `scripts/seed-external` |

La generación de **imágenes** (probador virtual) no depende del LLM: usa Cloudflare
Workers AI · FLUX (`services/imagegen.js`), con su propio cupo diario.

## Alternativas gratuitas comprobadas (octubre 2026)

| Proveedor | `LLM_BASE_URL` | Notas |
|---|---|---|
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | tier gratuito; en 2026 sus términos apuntan a uso de negocio |
| Groq | `https://api.groq.com/openai/v1` | el más rápido; tier gratuito generoso |
| Cerebras | `https://api.cerebras.ai/v1` | Qwen3 235B gratis; no revender llaves |
| Mistral | `https://api.mistral.ai/v1` | tier de experimentación; uso interno permitido |
| Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts/<ID>/ai/v1` | ya se usa para imágenes; incluye Llama 3.3 70B y visión Llama 3.2 11B |
| Ollama (local) | `http://localhost:11434/v1` | sin cuota ni terceros; consumo de tu CPU/GPU |

> ⚠️ Los tiers gratuitos son para desarrollo y demo: los límites cambian cada semana y
> varios proveedores prohíben producción. El motor local de reglas sigue siendo el respaldo.

## Evidencia de verificación (2026-10-01)

Con un proveedor simulado apuntado por `GEMINI_BASE_URL` se verificó la cadena completa
sin gastar cuota real:

| Prueba | Resultado |
|---|---|
| `POST /api/ai/chat` | `reply` del proveedor · `model: gemini-2.5-flash` · `providerLabel: Gemini` |
| `POST /api/ai/analyze-outfit` | `engine: llm` · `garmentType: Blazer estructurado` · 3 ocasiones |
| `POST /api/admin/ai/report` | `engine: llm` · `model: gemini-2.5-flash` |
| `POST /api/admin/ai/ask` | `engine: llm` · SQL validado y ejecutado (1 fila) |
| `POST /api/admin/ai/purchase-plan` | `engine: llm` |
| `describePhotoForTryOn()` | `engine: vision` |
| `translatorAvailable()` | `true` |
| Sin llave configurada | `provider: local`, `reason` explícito y Aria responde con reglas (sin errores) |

El proveedor recibía `POST /chat/completions` con `Authorization: Bearer <llave>` y el
modelo configurado, confirmando URL, cabeceras y prompt de Aria.
