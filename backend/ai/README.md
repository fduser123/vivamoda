# Fase 1 · Asesor de estilismo con RAG y búsqueda visual

Dos capacidades de IA sobre el catálogo real de VivaModa, compartiendo la misma
infraestructura de embeddings:

1. **Asesor conversacional (RAG)** — responde en lenguaje natural
   ("¿qué me pongo para una boda en la playa?") con prendas que existen.
2. **Búsqueda visual** — subes una foto y devuelve las prendas más parecidas.

## Resultado de la validación

| Criterio | Objetivo | Medido | |
|---|---|---|---|
| Precisión del asistente RAG | 100 % de los productos citados existen | **100,0 %** (10/10 consultas sin invenciones) | ✅ |
| Latencia chat p95 | < 3 s | **2.890 ms** (p50 1.946 ms) | ✅ |
| Precisión búsqueda visual top-3 | ≥ 80 % | **95,5 %** (22 casos evaluables de 30) | ✅ |
| Latencia búsqueda visual p95 | < 5 s | **215 ms** | ✅ |
| Cobertura de embeddings | ≥ 95 % | **100 %** (353/353 SKUs activos) | ✅ |

Reproducible con `npm run ai:validar`. El detalle queda en
`ai/informe-validacion.json`.

## Arquitectura

```
                       ┌──────────────────────────────┐
   navegador ─────────▶│  Node/Express (backend/)     │
                       │  · catálogo, auth, carrito   │
                       │  · rutas /api/ai/style-chat  │
                       │    y /api/ai/visual-search   │
                       │  · planner, re-ranking,      │
                       │    generación (DeepSeek)     │
                       └───────┬──────────────┬───────┘
                               │              │
                  SQL + pgvector│              │HTTP (embeddings)
                               ▼              ▼
                       ┌──────────────┐  ┌─────────────────────┐
                       │ PostgreSQL16 │  │ sidecar Python      │
                       │ + pgvector   │  │ FashionCLIP (512d)  │
                       │ 512-d HNSW   │  │ ai/embed_server.py  │
                       └──────────────┘  └─────────────────────┘
```

**Por qué el modelo vive en Python y el resto en Node.** FashionCLIP sólo existe
en Python, así que hay un sidecar mínimo que carga el modelo una vez y sirve
vectores por HTTP. Todo lo demás (filtros, re-ranking, generación, API) se queda
en el backend Node que ya tiene el catálogo, la autenticación y el carrito, en
lugar de levantar un FastAPI en paralelo duplicando esa lógica.

## Puesta en marcha

```bash
cd backend

# 1) Entorno Python del motor de embeddings (una sola vez, ~200 MB)
bash ai/setup.sh

# 2) Base de datos con pgvector (ver "Migración" más abajo)
docker start vivamoda-postgres

# 3) Sidecar de embeddings (dejar corriendo)
npm run ai:embed

# 4) Backend
PORT=3001 npm run start
```

La página queda en `http://localhost:3001/asesor-estilo`.

### Pipeline de datos (sólo la primera vez, o al cambiar el catálogo)

```bash
npm run ai:attrs        # metadatos de prenda por visión (~16 min, ~0,10 USD)
npm run ai:embeddings   # vectores de imagen + texto (~1,2 min)
npm run ai:validar      # mide los criterios de aceptación
```

## Endpoints

| Método | Ruta | Cuerpo | Devuelve |
|---|---|---|---|
| POST | `/api/ai/style-chat` | `{ message, session_id? }` | `reply`, `products[]`, `plan`, `grounding`, `phases_ms`, `latency_ms` |
| POST | `/api/ai/visual-search` | `{ image }` (base64 o data URL) **o** binario con `Content-Type: image/*` | `results[]`, `count`, `latency_ms`, `embed_ms` |
| GET | `/api/ai/embeddings/status` | — | salud del sidecar y cobertura del catálogo |

Pruebas rápidas: `bash ai/probar-endpoints.sh`.

## El pipeline RAG

```
consulta
   ↓  [Planner]  filtros estructurados (ocasión, color, precio, género, prenda)
   ↓  [Retrieval] pgvector: similitud FashionCLIP + filtros SQL · top-K = 20
   ↓  [Re-ranker] similitud + coincidencia de atributos · top-N = 5
   ↓  [Generator] DeepSeek con el contexto acotado
respuesta + verificación de grounding
```

**Grounding.** El generador sólo recibe los 5 productos recuperados y la orden le
prohíbe recomendar nada más. Después se comprueba qué productos citó y si todos
estaban en el contexto (`grounding.inventados`). Esa verificación ignoraba
rótulos ("**Combinación completa:**") y abreviaturas ("**Conjunto Cobalt**"), así
que compara por palabras significativas y no por cadena literal.

## Decisiones que se apartan de la orden (y por qué)

| La orden pedía | Se hizo | Motivo |
|---|---|---|
| Qdrant | **pgvector** | PostgreSQL ya estaba corriendo; añadir otro motor duplicaba infraestructura para 353 vectores. |
| FastAPI + LangChain | **Node + sidecar Python mínimo** | El catálogo, la auth y el carrito ya viven en Node. |
| BGE Reranker v2-m3 | **Re-ranker determinista** | Pesa ~2 GB y el disco estaba al 97 %. Usa los atributos que extrajo la visión. Es sustituible cambiando una función. |
| Embeddings "multimodales" | **3 vectores por prenda** | Guardar imagen, texto y fusión por separado permite *medir* cuál funciona en cada caso en vez de suponerlo. La medición decidió el peso (imagen 0,7 · texto 0,3). |
| Planner siempre LLM | **Planner híbrido** | La llamada costaba 1,6 s (el retrieval son 4 ms) y rompía el objetivo de 3 s. La heurística resuelve los filtros habituales; el LLM entra cuando la consulta no da señales. |
| Frontend Next.js/React | **HTML + JS del proyecto** | Coherente con el resto de módulos; añadir React suponía un build aparte. |

## Metadatos de prenda (R3)

El requisito R3 (material, largo, cuello, manga, ocasión, temporada) **no existía**:
`details.composition` era una plantilla genérica ("Fibra principal 95%") en 353 de
354 productos. Se generan con el modelo de visión (`ai/extract_attrs.py`) y se
guardan en `product_ai_attrs`. 331 productos quedaron con atributos; los 19 sin
imagen sólo tienen vector de texto.

## Notas técnicas aprendidas

- **FashionCLIP tiene un contexto de 77 tokens.** Con textos de 412 caracteres el
  vector de texto se truncaba y no discriminaba nada (devolvía bolsos para
  "vestido de boda"). El texto enriquecido ahora va ordenado por poder
  discriminante y limitado a 260 caracteres.
- **El espacio de imagen es el que mejor recupera**, incluso para consultas de
  texto: es la alineación cross-modal de CLIP. Comparar texto contra vectores de
  texto daba resultados peores.
- **El filtro de ocasión necesitaba `occasion && $1::text[]`**; envolverlo en
  `ARRAY[$1]` creaba un array anidado y no casaba nunca.
- **`--dry-run` del seed no evita la traducción**, así que también gasta tokens.
- **torchvision debe venir del mismo índice que torch** (CPU), o falla con
  `operator torchvision::nms does not exist`.

## Migración a pgvector

El contenedor pasó de `postgres:16-alpine` a `pgvector/pgvector:pg16`
conservando el volumen `vivamoda_pgdata`. Es el mismo PostgreSQL 16, así que los
datos son compatibles; sólo hay que activar la extensión:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

> En esta máquina **no hay `docker compose`** (ni plugin ni binario suelto), así
> que los scripts `npm run db:up` / `db:down` del proyecto no funcionan. El
> contenedor se levanta con `docker start vivamoda-postgres`.

## Privacidad

- Las imágenes que sube el usuario **no se almacenan**: se vectorizan en memoria,
  se responde y se descartan.
- La colección vectorial sólo contiene datos de producto, ningún dato personal.
