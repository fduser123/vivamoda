#!/usr/bin/env python3
"""
Genera los embeddings del catálogo con FashionCLIP y los guarda en pgvector.

Para cada producto se calculan tres vectores de 512 dimensiones:
  · image_vec → la foto de la prenda
  · text_vec  → el TEXTO ENRIQUECIDO (título + categoría + género + los
                atributos que extrajo la visión + descripción)
  · fused_vec → la media normalizada de los dos anteriores (el "embedding
                multimodal" que describe la orden)

Se guardan los tres por separado a propósito: una consulta de texto recupera
mejor contra text_vec y una foto contra image_vec, mientras que fused_vec es
el compromiso multimodal. Así se puede MEDIR cuál rinde mejor en cada caso en
lugar de dar por hecho que la fusión es superior.

Habla con el sidecar (ai/embed_server.py) para reutilizar el modelo cargado.
Es reanudable: sin --force sólo procesa lo que falta.
"""
import base64
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import psycopg
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMGDIR = ROOT / "public" / "img" / "ext"
DSN = "postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda"
EMBED = "http://127.0.0.1:8001"
MAX_SIDE = 640
LOTE_TEXTO = 16


def get(ruta, timeout=10):
    with urllib.request.urlopen(EMBED + ruta, timeout=timeout) as r:
        return json.loads(r.read().decode())


def post(ruta, payload, timeout=180):
    req = urllib.request.Request(
        EMBED + ruta, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def mejor_imagen(sku, image_url):
    cands = []
    for ext in ("jpg", "jpeg", "png", "webp"):
        cands += list(IMGDIR.glob(f"{sku}-*.{ext}"))
    reales = [c for c in cands if c.stat().st_size > 0]
    if reales:
        f = max(reales, key=lambda p: p.stat().st_size)
        im = Image.open(f).convert("RGB")
    elif image_url and str(image_url).startswith("http"):
        try:
            req = urllib.request.Request(str(image_url), headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=25) as r:
                im = Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception:
            return None
    else:
        return None
    im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


def texto_enriquecido(p, a):
    """Construye el texto que se vectoriza: todo lo que describe la prenda.

    IMPORTANTE: FashionCLIP tiene un contexto de 77 tokens (verificado con
    model.context_length). El texto anterior medía 412 caracteres de media y
    se truncaba, dejando un vector de texto que no discriminaba: en la
    comparación de espacios, el de texto devolvía bolsos para la consulta
    "vestido elegante y fresco para una boda en la playa".

    Ahora el texto es CORTO y va ordenado por poder discriminante, de modo que
    si algo se recorta sea el final (la nota de estilo), nunca el tipo de
    prenda, el color o la ocasión.
    """
    if not a:
        a = {}
    partes = []
    if a.get("garment_type"):
        partes.append(a["garment_type"])
    if a.get("color_main"):
        partes.append(a["color_main"])
    partes.append(str(p["name"]).split(",")[0][:60])
    if a.get("material") and a["material"] != "no identificable":
        partes.append(a["material"])
    for k in ("sleeve", "length", "neckline", "pattern"):
        v = a.get(k)
        if v and v != "no aplica":
            partes.append(str(v))
    if a.get("occasion"):
        partes.append("para " + ", ".join(a["occasion"]))
    if a.get("season"):
        partes.append(", ".join(a["season"]))
    if a.get("style_notes"):
        partes.append(str(a["style_notes"]))
    partes.append(f"categoría {p['category']}, {p['gender_texto']}")
    return ". ".join(x for x in partes if x)[:260]


def normaliza(v):
    import math
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def fusiona(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return normaliza([(x + y) / 2 for x, y in zip(a, b)])


def main():
    force = "--force" in sys.argv
    limite = next((int(x) for x in sys.argv[1:] if x.isdigit()), 0)

    try:
        get("/health")
    except Exception:
        sys.exit("El sidecar de embeddings no responde en " + EMBED)

    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT p.id, p.sku, p.name, p.category, p.gender, p.description, p.image_url,
                   -- 'damas' → 'mujer', para que el texto sea lenguaje natural
                   CASE p.gender WHEN 'damas' THEN 'mujer' WHEN 'caballeros' THEN 'hombre'
                                 WHEN 'ninos' THEN 'niños' ELSE 'unisex' END AS gender_texto,
                   a.garment_type, a.sleeve, a.length, a.neckline, a.pattern,
                   a.color_main, a.material, a.occasion, a.season, a.style_notes
            FROM products p
            LEFT JOIN product_ai_attrs a ON a.product_id = p.id
            LEFT JOIN product_embeddings e ON e.product_id = p.id
            WHERE p.is_active AND (e.product_id IS NULL OR %s)
            ORDER BY p.id
        """, (force,))
        cols = [d.name for d in cur.description]
        filas = [dict(zip(cols, r)) for r in cur.fetchall()]

    if limite:
        filas = filas[:limite]
    print(f"[emb] productos a vectorizar: {len(filas)}", flush=True)

    ok = sin_imagen = fallos = 0
    t0 = time.time()

    for i, p in enumerate(filas, 1):
        attrs = {k: p.get(k) for k in
                 ("garment_type", "sleeve", "length", "neckline", "pattern",
                  "color_main", "material", "occasion", "season", "style_notes")}
        texto = texto_enriquecido(p, attrs)
        try:
            text_vec = post("/embed/text", {"texts": [texto]})["vectors"][0]

            b64 = mejor_imagen(p["sku"], p["image_url"])
            if b64:
                image_vec = post("/embed/image", {"images": [b64]})["vectors"][0]
            else:
                image_vec = None
                sin_imagen += 1

            fused = fusiona(image_vec, text_vec)
            with psycopg.connect(DSN) as conn, conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO product_embeddings (product_id, image_vec, text_vec, fused_vec, text_src, model)
                    VALUES (%s, %s::vector, %s::vector, %s::vector, %s, %s)
                    ON CONFLICT (product_id) DO UPDATE SET
                      image_vec=EXCLUDED.image_vec, text_vec=EXCLUDED.text_vec,
                      fused_vec=EXCLUDED.fused_vec, text_src=EXCLUDED.text_src, created_at=NOW()
                """, (p["id"],
                      str(image_vec) if image_vec else None,
                      str(text_vec), str(fused), texto, "Marqo-fashionCLIP"))
                conn.commit()
            ok += 1
        except Exception as e:
            fallos += 1
            print(f"  ! {p['sku']}: {str(e)[:110]}", flush=True)

        if i % 20 == 0 or i == len(filas):
            ritmo = (time.time() - t0) / max(i, 1)
            print(f"[emb] {i}/{len(filas)} · ok={ok} sin_imagen={sin_imagen} "
                  f"fallos={fallos} · {ritmo:.2f}s/ud", flush=True)

    print(f"[emb] FIN · ok={ok} sin_imagen={sin_imagen} fallos={fallos} "
          f"· {(time.time()-t0)/60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
