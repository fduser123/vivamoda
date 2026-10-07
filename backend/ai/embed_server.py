#!/usr/bin/env python3
"""
Sidecar de embeddings con FashionCLIP.

Por qué un servicio aparte: FashionCLIP sólo existe en Python, pero el backend
del proyecto es Node. Este proceso mínimo carga el modelo UNA vez (cargarlo
cuesta ~10-30 s) y lo expone por HTTP en 127.0.0.1:8001. Toda la lógica de
recuperación, filtrado, re-ranking y generación vive en Node, que es donde
están el catálogo, la autenticación y el carrito.

Se usa la librería estándar (http.server) en vez de FastAPI para no sumar
dependencias: el servicio sólo tiene tres rutas y no se expone a Internet.

Endpoints:
  GET  /health          → { ok, model, dim, device }
  POST /embed/text      { "texts": ["…"] }              → { vectors: [[512]] }
  POST /embed/image     { "images": ["<base64 jpeg>"] } → { vectors: [[512]] }

Los vectores salen NORMALIZADOS (norma 1): el modelo devuelve normas ~10, así
que sin normalizar la similitud coseno no sería comparable entre consultas.
"""
import base64
import io
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
import open_clip
from PIL import Image

HOST, PORT = "127.0.0.1", 8001
MODEL_HUB = "hf-hub:Marqo/marqo-fashionCLIP"
MAX_LADO = 640

model = preprocess = tokenizer = None
_device = "cpu"
_lock = threading.Lock()  # el modelo no es thread-safe en todas sus rutas


def cargar():
    global model, preprocess, tokenizer
    t0 = time.time()
    print(f"[embed] cargando {MODEL_HUB}…", flush=True)
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_HUB)
    tokenizer = open_clip.get_tokenizer(MODEL_HUB)
    model.eval()
    print(f"[embed] listo en {time.time()-t0:.1f}s · dim=512 · device={_device}", flush=True)


def normalizar(t):
    return t / t.norm(dim=-1, keepdim=True)


def embed_textos(textos):
    with _lock, torch.no_grad():
        t = tokenizer(textos)
        v = model.encode_text(t)
        return normalizar(v).tolist()


def embed_imagenes(b64s):
    ims = []
    for b in b64s:
        im = Image.open(io.BytesIO(base64.b64decode(b))).convert("RGB")
        im.thumbnail((MAX_LADO, MAX_LADO), Image.LANCZOS)
        ims.append(preprocess(im))
    lote = torch.stack(ims)
    with _lock, torch.no_grad():
        v = model.encode_image(lote)
        return normalizar(v).tolist()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # silenciar el log por petición
        pass

    def _json(self, code, obj):
        cuerpo = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json(200, {"ok": model is not None, "model": MODEL_HUB, "dim": 512, "device": _device})
        else:
            self._json(404, {"error": "no encontrado"})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            if model is None:
                return self._json(503, {"error": "modelo cargando"})

            if self.path.startswith("/embed/text"):
                textos = [str(t) for t in (body.get("texts") or []) if str(t).strip()]
                if not textos:
                    return self._json(400, {"error": "faltan textos"})
                t0 = time.time()
                vecs = embed_textos(textos)
                return self._json(200, {"vectors": vecs, "dim": 512, "ms": round((time.time()-t0)*1000)})

            if self.path.startswith("/embed/image"):
                ims = body.get("images") or []
                if not ims:
                    return self._json(400, {"error": "faltan imágenes"})
                t0 = time.time()
                vecs = embed_imagenes(ims)
                return self._json(200, {"vectors": vecs, "dim": 512, "ms": round((time.time()-t0)*1000)})

            self._json(404, {"error": "no encontrado"})
        except Exception as e:
            self._json(500, {"error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    cargar()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[embed] escuchando en http://{HOST}:{PORT}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
