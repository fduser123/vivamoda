---
title: VivaModa Embeddings
emoji: 🧵
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

# VivaModa · Sidecar de embeddings

Microservicio que sirve los vectores de **FashionCLIP** (512 dimensiones) que
usan la búsqueda visual y el asesor RAG del proyecto VivaModa.

## Endpoints

| Método | Ruta | Cuerpo | Devuelve |
|---|---|---|---|
| GET | `/health` | — | Estado del modelo y dispositivo |
| POST | `/embed/text` | `{ "texts": ["..."] }` | Vectores normalizados |
| POST | `/embed/image` | `{ "image": "<base64>" }` | Vector de 512 dimensiones |

## Configuración

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `EMBED_HOST` | `127.0.0.1` | En el Space debe ser `0.0.0.0` (ya fijado en el Dockerfile) |
| `PORT` | `8001` | Puerto de escucha (el Space inyecta `7860`) |
| `HF_HOME` | — | Dónde cachear el modelo descargado |

## Uso desde el backend

```
EMBED_SERVICE_URL=https://<usuario>-<space>.hf.space
```

La primera petición puede tardar: el Space arranca y descarga el modelo de
571 MB. Después cada vector tarda unos 190 ms en CPU.
