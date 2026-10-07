#!/usr/bin/env python3
"""
Extrae metadatos de prenda a partir de las IMÁGENES del catálogo.

Por qué existe: el requisito R3 de la Fase 1 (material, largo, cuello, manga,
ocasión, temporada) NO existía en la base. El campo `details.composition` era
relleno genérico ("Fibra principal 95%") en 353 de 354 productos. Se generan
aquí mirando la foto con el modelo de visión, que ya está operativo.

Escribe en `product_ai_attrs`. Es reanudable: salta lo ya extraído.
"""
import base64
import io
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

import psycopg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent          # backend/
IMGDIR = ROOT / "public" / "img" / "ext"
ENV = ROOT / ".env"
DS_URL = "https://api.deepseek.com/chat/completions"
DS_MODEL = "deepseek-flash"
MAX_SIDE = 640          # se reduce antes de enviar: menos tokens, misma señal
LOTE_LOG = 10

PROMPT = """Eres un experto en moda. Analiza la PRENDA de la foto y devuelve SOLO un JSON válido, sin markdown ni texto extra, con estas claves exactas:

{
  "garment_type": "tipo de prenda en una palabra (vestido, blusa, camisa, pantalon, falda, chaqueta, abrigo, sudadera, top, body, conjunto, bolso, zapatos, joya, gafas, reloj, accesorio)",
  "sleeve": "manga larga | manga corta | sin mangas | tirantes | manga 3/4 | no aplica",
  "length": "mini | corto | midi | maxi | largo | no aplica",
  "neckline": "tipo de cuello o escote (redondo, pico, cuadrado, strapless, camisero, alto, halter, no aplica)",
  "pattern": "liso | estampado | rayas | cuadros | floral | animal print | encaje | brillante | otro",
  "color_main": "color dominante en español, una o dos palabras (azul, negro, rojo, blanco, beige, verde, rosa, morado, gris, marron, dorado, plateado, multicolor)",
  "material": "material aparente (algodon, lino, seda, saten, piel, denim, punto, licra, encaje, lana, poliester, no identificable)",
  "occasion": ["elige los que encajen: formal, casual, fiesta, noche, oficina, playa, deporte, boda, diario"],
  "season": ["elige los que encajen: verano, invierno, entretiempo"],
  "style_notes": "una frase breve en español sobre para qué sirve la prenda",
  "confidence": 0.0
}

Reglas:
- Rellena TODAS las claves. Si algo no se distingue, usa "no aplica" o "no identificable".
- "confidence" es un número entre 0 y 1 según lo clara que sea la foto.
- No inventes marca ni precio."""


def leer_env() -> dict:
    out = {}
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def mejor_imagen(sku: str, image_url: str | None = None):
    """Devuelve (bytes, mime) de la mejor imagen disponible del SKU.

    1) Archivos locales de public/img/ext (los del seed): se elige el más
       pesado, que es el de mayor resolución (el -0 es 300px y el -1 1000px).
    2) Si no hay copia local, se descarga `image_url` (los productos demo
       originales apuntan a un CDN externo).
    """
    cands = []
    for ext in ("jpg", "jpeg", "png", "webp"):
        cands += list(IMGDIR.glob(f"{sku}-*.{ext}"))
    reales = [c for c in cands if c.stat().st_size > 0]
    if reales:
        f = max(reales, key=lambda p: p.stat().st_size)
        return reduzca(Image.open(f))

    if image_url and str(image_url).startswith("http"):
        try:
            req = urllib.request.Request(str(image_url), headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=25) as r:
                datos = r.read()
            return reduzca(Image.open(io.BytesIO(datos)))
        except Exception as e:
            print(f"    (no se pudo descargar la imagen de {sku}: {str(e)[:60]})", flush=True)
    return None


def reduzca(origen):
    """Reescala a MAX_SIDE y devuelve JPEG en bytes. Acepta ruta o imagen PIL."""
    im = origen if isinstance(origen, Image.Image) else Image.open(origen)
    im = im.convert("RGB")
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=85)
    return buf.getvalue(), "image/jpeg"


def llamar_vision(api_key: str, img_bytes: bytes, mime: str) -> dict:
    b64 = base64.b64encode(img_bytes).decode()
    body = {
        "model": DS_MODEL,
        # OJO: sin esto DeepSeek gasta el presupuesto de tokens razonando y
        # devuelve `content` vacío (bug ya documentado en el proyecto).
        "thinking": {"type": "disabled"},
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
            ],
        }],
        "max_tokens": 700,
        "temperature": 0.2,
    }
    req = urllib.request.Request(
        DS_URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.loads(r.read().decode())
    txt = (data.get("choices", [{}])[0].get("message", {}) or {}).get("content", "") or ""
    txt = re.sub(r"^```(?:json)?|```$", "", txt.strip(), flags=re.M).strip()
    return json.loads(txt)


def main():
    limite = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    force = "--force" in sys.argv
    api_key = leer_env().get("DEEPSEEK_API_KEY")
    if not api_key:
        sys.exit("Falta DEEPSEEK_API_KEY en backend/.env")

    dsn = "postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda"
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.id, p.sku, p.name, p.category, p.image_url
                FROM products p
                LEFT JOIN product_ai_attrs a ON a.product_id = p.id
                WHERE p.is_active AND (a.product_id IS NULL OR %s)
                ORDER BY p.id
            """, (force,))
            filas = cur.fetchall()

    if limite:
        filas = filas[:limite]
    print(f"[attrs] productos a procesar: {len(filas)}", flush=True)

    ok = sin_imagen = fallos = 0
    t0 = time.time()
    for i, (pid, sku, nombre, categoria, image_url) in enumerate(filas, 1):
        img = mejor_imagen(sku, image_url)
        if not img:
            sin_imagen += 1
            continue
        try:
            attrs = llamar_vision(api_key, img[0], img[1])
            with psycopg.connect(dsn) as conn, conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO product_ai_attrs
                      (product_id, garment_type, sleeve, length, neckline, pattern,
                       color_main, material, occasion, season, style_notes, model, confidence)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (product_id) DO UPDATE SET
                      garment_type=EXCLUDED.garment_type, sleeve=EXCLUDED.sleeve,
                      length=EXCLUDED.length, neckline=EXCLUDED.neckline,
                      pattern=EXCLUDED.pattern, color_main=EXCLUDED.color_main,
                      material=EXCLUDED.material, occasion=EXCLUDED.occasion,
                      season=EXCLUDED.season, style_notes=EXCLUDED.style_notes,
                      model=EXCLUDED.model, confidence=EXCLUDED.confidence,
                      created_at=NOW()
                """, (
                    pid,
                    attrs.get("garment_type"), attrs.get("sleeve"), attrs.get("length"),
                    attrs.get("neckline"), attrs.get("pattern"), attrs.get("color_main"),
                    attrs.get("material"),
                    attrs.get("occasion") if isinstance(attrs.get("occasion"), list) else None,
                    attrs.get("season") if isinstance(attrs.get("season"), list) else None,
                    attrs.get("style_notes"), DS_MODEL, attrs.get("confidence"),
                ))
                conn.commit()
            ok += 1
        except Exception as e:
            fallos += 1
            print(f"  ! {sku}: {str(e)[:110]}", flush=True)

        if i % LOTE_LOG == 0 or i == len(filas):
            ritmo = (time.time() - t0) / max(i, 1)
            print(f"[attrs] {i}/{len(filas)} · ok={ok} sin_imagen={sin_imagen} "
                  f"fallos={fallos} · {ritmo:.1f}s/ud", flush=True)

    print(f"[attrs] FIN · ok={ok} sin_imagen={sin_imagen} fallos={fallos} "
          f"· {(time.time()-t0)/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
