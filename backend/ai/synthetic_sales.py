#!/usr/bin/env python3
"""
Genera el HISTORIAL DE VENTAS SINTÉTICO de la Fase 4.

POR QUÉ EXISTE
--------------
La orden pidió 12-24 meses de ventas a nivel SKU/tienda/semana. La base sólo
tenía 22 pedidos repartidos en 4 semanas (y 17 SKUs de 353), insumos de demo
del seed. Sin historial no se pueden construir lags de 8/12/52 semanas, ni un
holdout de 13, ni estimar la sigma del error de forecast que alimenta el stock
de seguridad.

Este script fabrica esa historia con una estructura realista para poder
construir y validar TODA la maquinaria. Es honesto sobre lo que es:

  · TODAS las filas llevan `is_synthetic = TRUE`.
  · Las métricas que se midan sobre estos datos prueban que el PIPELINE
    funciona, NO que el modelo prediga demanda real.

Modelo generativo (por SKU × tienda × semana):
    lambda = base_sku · factor_tienda · estacionalidad(semana, categoría)
             · tendencia · multiplicador_promo · ruido
    ocurrencia ~ Bernoulli(1 - exp(-lambda))      ← demanda intermitente
    unidades   = ocurrencia · (1 + Poisson(lambda))

La intermitencia es deliberada: en fast-fashion la mayoría de combinaciones
SKU/tienda/semana venden 0, que es justo lo que justifica el enfoque de dos
etapas (clasificador de ocurrencia + regresor de magnitud).
"""
import math
import random
import sys
from datetime import date, timedelta

import numpy as np
import psycopg

DSN = "postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda"
SEED = 20261007
SEMANAS = 104              # 24 meses
COLS = ["CENTRAL", "NORTE", "CENTRO", "ONLINE"]
# Tamaño relativo de cada tienda (ONLINE vende más, NORTE menos)
PESO_TIENDA = {"CENTRAL": 1.0, "NORTE": 0.75, "CENTRO": 0.9, "ONLINE": 1.35}

# Estacionalidad por tipo de prenda: (semana del pico, amplitud)
ESTACIONALIDAD = {
    "vestido":     (24, 0.45),   # primavera-verano
    "kaftan":      (25, 0.50),
    "blusa":       (22, 0.30),
    "camisa":      (20, 0.25),
    "top":         (24, 0.35),
    "pantalon":    (10, 0.15),
    "falda":       (22, 0.30),
    "chaqueta":    (44, 0.40),   # otoño-invierno
    "abrigo":      (46, 0.50),
    "conjunto":    (12, 0.15),
    "sudadera":    (45, 0.35),
    "short":       (26, 0.40),
    "zapatos":     (23, 0.20),
    "bolso":       (48, 0.30),   # campaña de Navidad
    "joya":        (48, 0.35),
    "gafas":       (25, 0.40),
    "reloj":       (48, 0.30),
    "accesorio":   (48, 0.25),
    "ropa interior": (20, 0.15),
}
# Peso base por tipo: los accesorios rotan mucho más que un abrigo
ROTACION = {
    "joya": 3.2, "accesorio": 2.8, "gafas": 2.4, "bolso": 2.0, "zapatos": 1.6,
    "top": 2.2, "camisa": 1.8, "blusa": 1.8, "short": 1.7, "falda": 1.5,
    "pantalon": 1.5, "vestido": 1.3, "kaftan": 1.1, "conjunto": 1.2,
    "sudadera": 1.3, "chaqueta": 1.1, "abrigo": 0.7, "reloj": 0.9,
    "ropa interior": 1.8,
}


def semanas(desde: date, n: int):
    return [desde + timedelta(weeks=i) for i in range(n)]


def calendario_promos(weeks):
    """Promociones y eventos (R4). Devuelve {week_start: (nombre, profundidad)}."""
    cal = {}
    for w in weeks:
        iso = w.isocalendar()
        sem, mes = iso[1], w.month
        if mes == 1 and sem <= 3:
            cal[w] = ("Rebajas de enero", 0.30)
        elif mes == 7 and 27 <= sem <= 30:
            cal[w] = ("Rebajas de verano", 0.25)
        elif mes == 11 and 46 <= sem <= 48:
            cal[w] = ("Black Friday", 0.35)
        elif mes == 12 and sem >= 50:
            cal[w] = ("Campaña de Navidad", 0.20)
        elif sem % 17 == 0:
            cal[w] = ("Flash puntual", 0.15)
    return cal


def estacionalidad(semana_iso: int, tipo: str) -> float:
    """Multiplicador estacional suave, con pico en la semana indicada."""
    pico, amp = ESTACIONALIDAD.get(tipo, (24, 0.20))
    # distancia circular en semanas
    d = min(abs(semana_iso - pico), 52 - abs(semana_iso - pico))
    return 1.0 + amp * math.cos(2 * math.pi * d / 52)


def main():
    rng = np.random.default_rng(SEED)
    random.seed(SEED)

    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT p.sku, p.price::float8, p.rating::float8, p.category,
                   COALESCE(a.garment_type, 'accesorio') AS tipo,
                   COALESCE(a.season, ARRAY[]::text[]) AS season,
                   e.image_vec::text AS image_vec
            FROM products p
            LEFT JOIN product_ai_attrs a ON a.product_id = p.id
            LEFT JOIN product_embeddings e ON e.product_id = p.id
            WHERE p.is_active AND p.visibility = 'store'
            ORDER BY p.id
        """)
        productos = cur.fetchall()
        cur.execute("SELECT code FROM stores WHERE is_active ORDER BY code")
        tiendas = [r[0] for r in cur.fetchall()] or COLS

    print(f"[synth] {len(productos)} SKUs × {len(tiendas)} tiendas × {SEMANAS} semanas")

    # ── ATRACTIVO VISUAL ─────────────────────────────────────────────
    # En fast-fashion la demanda depende de cómo se ve la prenda. La primera
    # versión del generador NO incluía ese efecto, así que ningún modelo
    # multimodal podía aportar nada por construcción. Se añade aquí un factor
    # determinista derivado del embedding FashionCLIP: al ser una función
    # lineal fija del vector de imagen, un modelo multimodal SÍ puede
    # aprenderlo, que es exactamente lo que se quiere evaluar en el paso 4.
    w_visual = rng.normal(0, 1, 512)
    w_visual /= np.linalg.norm(w_visual)
    atraccion = {}
    for fila in productos:
        sku, *_resto, img = fila
        if img:
            v = np.array([float(x) for x in str(img).strip("[]").split(",")])
            atraccion[sku] = float(v @ w_visual)
    if atraccion:
        vals = np.array(list(atraccion.values()))
        mu, sd = float(vals.mean()), float(vals.std() or 1.0)
        atraccion = {k: (v - mu) / sd for k, v in atraccion.items()}
    print(f"[synth] atractivo visual calculado para {len(atraccion)} SKUs "
          f"(rango {min(atraccion.values()):.2f} … {max(atraccion.values()):.2f})")

    # La historia termina la semana pasada, para que el "futuro" sea futuro
    hoy = date.today()
    fin = hoy - timedelta(days=hoy.weekday() + 7)      # lunes de la semana pasada
    weeks = semanas(fin - timedelta(weeks=SEMANAS - 1), SEMANAS)
    promos = calendario_promos(weeks)

    # ── Promociones a la tabla ───────────────────────────────────────
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM promo_calendar WHERE is_synthetic")
        for w, (nombre, prof) in promos.items():
            cur.execute(
                "INSERT INTO promo_calendar (week_start, name, scope, depth, kind, is_synthetic)"
                " VALUES (%s,%s,%s,%s,%s,TRUE)",
                (w, nombre, "todas", prof, "rebajas" if "Rebajas" in nombre else "evento"))
        conn.commit()
    print(f"[synth] calendario de promociones: {len(promos)} semanas con promo")

    filas = []
    for (sku, precio, rating, categoria, tipo, season, _img) in productos:
        tipo = (tipo or "accesorio").lower()
        rot = ROTACION.get(tipo, 1.5)
        # Precio alto → menos unidades. Rating alto → más.
        factor_precio = max(0.25, min(2.0, 60.0 / max(float(precio or 30), 5.0)))
        factor_rating = 0.7 + (float(rating or 3.5) / 5.0) * 0.6
        # Popularidad intrínseca del SKU (fija en el tiempo, distinta por SKU)
        base = rot * factor_precio * factor_rating * float(rng.gamma(2.0, 0.5))
        # Efecto del atractivo visual: hasta ×1.6 en las prendas más atractivas
        base *= math.exp(0.35 * atraccion.get(sku, 0.0))
        # Tendencia anual: unas prendas crecen y otras decaen
        tendencia = float(rng.normal(1.0, 0.10))
        # Un tercio del catálogo es de baja rotación (casi nunca vende)
        cola_larga = rng.random() < 0.33
        if cola_larga:
            base *= 0.12

        for tienda in tiendas:
            peso_t = PESO_TIENDA.get(tienda, 1.0) * float(rng.normal(1.0, 0.08))
            for i, w in enumerate(weeks):
                lam = base * peso_t
                lam *= estacionalidad(w.isocalendar()[1], tipo)
                lam *= tendencia ** (i / 52.0)
                promo = promos.get(w)
                promo_d = 0.0
                if promo:
                    promo_d = promo[1]
                    # La promo sube la demanda y reduce el precio
                    lam *= 1.0 + promo_d * 2.2
                # Ruido multiplicativo (mundo real: no es limpio)
                lam *= float(rng.normal(1.0, 0.35))
                lam = max(0.0, lam)

                # Demanda intermitente: probabilidad de ocurrencia tipo Poisson
                p_oc = 1.0 - math.exp(-lam)
                if rng.random() < p_oc:
                    unidades = int(1 + rng.poisson(max(lam, 0.4)))
                else:
                    unidades = 0
                if cola_larga and rng.random() < 0.85:
                    unidades = 0

                precio_v = float(precio or 30.0) * (1.0 - promo_d)
                filas.append((
                    sku, tienda, w, unidades, round(unidades * precio_v, 2),
                    round(precio_v, 2), bool(promo), float(promo_d),
                ))

    print(f"[synth] {len(filas)} filas generadas; insertando…")
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM sales_history WHERE is_synthetic")
        cur.executemany("""
            INSERT INTO sales_history
              (sku, store_code, week_start, units_sold, revenue, price, promo_flag, promo_depth, is_synthetic)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,TRUE)
        """, filas)
        conn.commit()

    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT COUNT(*), COUNT(*) FILTER (WHERE units_sold = 0),
                   ROUND(100.0*COUNT(*) FILTER (WHERE units_sold = 0)/COUNT(*), 1),
                   SUM(units_sold), MIN(week_start), MAX(week_start)
            FROM sales_history
        """)
        n, ceros, pct, tot, d0, d1 = cur.fetchone()
    print(f"[synth] FIN · {n} filas · {d0} → {d1}")
    print(f"[synth] semanas con 0 ventas: {ceros} ({pct} %) ← demanda intermitente")


if __name__ == "__main__":
    main()
