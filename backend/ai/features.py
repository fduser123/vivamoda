#!/usr/bin/env python3
"""
PASO 2 — PIPELINE DE FEATURES (SKU / tienda / semana).

Construye la matriz de features y la deja en dos sitios:
  · `demand_features` (Postgres, formato ancho) → el "feature store" para
    inferencia, consultable con SQL.
  · `ai/artifacts/features.parquet`             → la matriz para entrenar.

REGLA ANTI-LEAKAGE
------------------
Todas las features usan información ESTRICTAMENTE anterior a la semana que se
predice. Los lags se construyen con `shift(n)` sobre la serie ordenada, y los
agregados rodantes se desplazan una semana antes de calcularlos. Se deja
constancia del riesgo de cada feature en `feature_registry`, que es lo que la
orden pide documentar.
"""
import json
import os
from datetime import date

import numpy as np
import pandas as pd
import psycopg

DSN = "postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda"
AQUI = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(AQUI, "artifacts")
os.makedirs(ART, exist_ok=True)

LAGS = [1, 2, 4, 8, 12, 52]

# Documentación exigida por la orden: tipo, fuente, ventana y riesgo de leakage
REGISTRO = [
    ("lag_1", "lag", "float", "sales_history", "t-1 semana", "Unidades vendidas la semana anterior", "Ninguno: usa pasado"),
    ("lag_2", "lag", "float", "sales_history", "t-2 semanas", "Unidades vendidas hace 2 semanas", "Ninguno: usa pasado"),
    ("lag_4", "lag", "float", "sales_history", "t-4 semanas", "Unidades vendidas hace 4 semanas (mismo mes)", "Ninguno: usa pasado"),
    ("lag_8", "lag", "float", "sales_history", "t-8 semanas", "Unidades vendidas hace 8 semanas", "Ninguno: usa pasado"),
    ("lag_12", "lag", "float", "sales_history", "t-12 semanas", "Unidades vendidas hace 12 semanas (mismo trimestre)", "Ninguno: usa pasado"),
    ("lag_52", "lag", "float", "sales_history", "t-52 semanas", "Unidades vendidas hace 52 semanas (estacionalidad anual)", "ALTO si se calcula sin shift: debe ser pasado"),
    ("roll_4_mean", "lag", "float", "sales_history", "t-1..t-4", "Media móvil de 4 semanas, desplazada", "Medio: se desplaza 1 semana antes de agregar"),
    ("roll_8_mean", "lag", "float", "sales_history", "t-1..t-8", "Media móvil de 8 semanas, desplazada", "Medio: se desplaza 1 semana antes de agregar"),
    ("roll_4_std", "lag", "float", "sales_history", "t-1..t-4", "Desviación de las 4 semanas previas (volatilidad)", "Medio: se desplaza 1 semana antes de agregar"),
    ("roll_12_std", "lag", "float", "sales_history", "t-1..t-12", "Desviación de las 12 semanas previas", "Medio: se desplaza 1 semana antes de agregar"),
    ("semana_iso", "temporal", "int", "calendario", "t", "Semana del año (estacionalidad)", "Ninguno"),
    ("mes", "temporal", "int", "calendario", "t", "Mes del año", "Ninguno"),
    ("trimestre", "temporal", "int", "calendario", "t", "Trimestre", "Ninguno"),
    ("antiguedad_semanas", "temporal", "int", "sales_history", "t - lanzamiento", "Semanas desde la primera venta del SKU", "Ninguno: usa pasado"),
    ("precio", "producto", "float", "sales_history", "t", "Precio de venta de esa semana", "Ninguno: se conoce al planificar"),
    ("descuento", "promocion", "float", "sales_history", "t", "Profundidad de descuento aplicada", "Ninguno: el calendario es futuro conocido"),
    ("promo_flag", "promocion", "int", "sales_history", "t", "1 si hay promoción activa esa semana", "Ninguno: el calendario es futuro conocido"),
    ("promo_depth", "promocion", "float", "sales_history", "t", "Profundidad de la promoción", "Ninguno"),
    ("categoria", "producto", "str", "products", "estático", "Categoría del catálogo", "Ninguno"),
    ("tipo_prenda", "producto", "str", "product_ai_attrs", "estático", "Tipo de prenda extraído por visión (Fase 1)", "Ninguno"),
    ("color", "producto", "str", "product_ai_attrs", "estático", "Color principal extraído por visión", "Ninguno"),
    ("tienda", "tienda", "str", "stores", "estático", "Código de tienda", "Ninguno"),
    ("tendencia_categoria", "externa", "float", "derivada", "t-1", "Índice semanal de la categoría, desplazado. SUSTITUTO de Google Trends: aquí se deriva del agregado del propio historial (no hay API de Trends en esta instalación)", "Medio: se desplaza 1 semana"),
    ("rating", "producto", "float", "products", "estático", "Valoración media del SKU", "Ninguno"),
    ("coste", "producto", "float", "products", "estático", "Coste unitario", "Ninguno"),
    ("margen", "producto", "float", "products", "estático", "Margen unitario (precio - coste)", "Ninguno"),
]


def main():
    with psycopg.connect(DSN) as conn:
        df = pd.read_sql("""
            SELECT s.sku, s.store_code, s.week_start, s.units_sold, s.revenue,
                   s.price, s.promo_flag, s.promo_depth,
                   p.category, p.rating::float8 AS rating, p.cost::float8 AS cost,
                   COALESCE(a.garment_type,'desconocido') AS tipo_prenda,
                   COALESCE(a.color_main,'desconocido') AS color
            FROM sales_history s
            JOIN products p ON p.sku = s.sku
            LEFT JOIN product_ai_attrs a ON a.product_id = p.id
            ORDER BY s.sku, s.store_code, s.week_start
        """, conn)

    print(f"[feat] {len(df)} filas de ventas cargadas")
    df["week_start"] = pd.to_datetime(df["week_start"])
    df["unidades"] = df["units_sold"].astype(float)

    # ── Tendencia de categoría (sustituto de Google Trends) ──────────
    # Se calcula sobre el total semanal de la categoría y se DESPLAZA una
    # semana: la semana t sólo puede ver lo que pasó hasta t-1.
    tot_cat = df.groupby(["category", "week_start"])["unidades"].sum().reset_index()
    tot_cat["tendencia_categoria"] = (
        tot_cat.groupby("category")["unidades"]
        .transform(lambda s: s.rolling(4, min_periods=1).mean())
    )
    tot_cat["tendencia_categoria"] = (
        tot_cat.groupby("category")["tendencia_categoria"].shift(1)
    )
    # Normalizado 0-100 para que sea interpretable como un índice de tendencia
    mx = tot_cat["tendencia_categoria"].max() or 1.0
    tot_cat["tendencia_categoria"] = (tot_cat["tendencia_categoria"] / mx * 100).fillna(0)
    df = df.merge(tot_cat[["category", "week_start", "tendencia_categoria"]],
                  on=["category", "week_start"], how="left")

    # ── Lags y rodantes POR SKU/TIENDA (nunca cruzando series) ───────
    g = df.groupby(["sku", "store_code"], sort=False)["unidades"]
    for L in LAGS:
        df[f"lag_{L}"] = g.shift(L)

    # Los rodantes van con transform POR GRUPO: si se desplaza antes de agrupar,
    # la serie pierde los niveles y rolling() revienta (o peor, mezcla SKUs).
    gb = df.groupby(["sku", "store_code"], sort=False)["unidades"]
    df["roll_4_mean"] = gb.transform(lambda s: s.shift(1).rolling(4, min_periods=1).mean())
    df["roll_8_mean"] = gb.transform(lambda s: s.shift(1).rolling(8, min_periods=1).mean())
    df["roll_4_std"] = gb.transform(lambda s: s.shift(1).rolling(4, min_periods=2).std())
    df["roll_12_std"] = gb.transform(lambda s: s.shift(1).rolling(12, min_periods=2).std())

    # ── Temporales ───────────────────────────────────────────────────
    iso = df["week_start"].dt.isocalendar()
    df["semana_iso"] = iso["week"].astype(int)
    df["mes"] = df["week_start"].dt.month
    df["trimestre"] = df["week_start"].dt.quarter
    primera = df.groupby(["sku", "store_code"])["week_start"].transform("min")
    df["antiguedad_semanas"] = ((df["week_start"] - primera).dt.days // 7).astype(int)

    df["promo_flag"] = df["promo_flag"].astype(int)
    df["descuento"] = df["promo_depth"].astype(float)
    df["tienda"] = df["store_code"]
    df["margen"] = df["price"].astype(float) - df["cost"].astype(float)
    df["target_units"] = df["units_sold"].astype(int)
    # Los nombres del registro son los nombres de la feature
    df = df.rename(columns={"price": "precio", "category": "categoria", "cost": "coste"})

    features = [c for c, *_ in REGISTRO]

    # ── Registro de features ─────────────────────────────────────────
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        for (nombre, kind, dtype, src, win, desc, leak) in REGISTRO:
            cur.execute("""
                INSERT INTO feature_registry (name, kind, dtype, source, time_window, description, leakage_risk)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (name) DO UPDATE SET
                  kind=EXCLUDED.kind, dtype=EXCLUDED.dtype, source=EXCLUDED.source,
                  time_window=EXCLUDED.time_window, description=EXCLUDED.description,
                  leakage_risk=EXCLUDED.leakage_risk
            """, (nombre, kind, dtype, src, win, desc, leak))
        conn.commit()
    print(f"[feat] {len(REGISTRO)} features registradas en feature_registry")

    # ── Persistencia ─────────────────────────────────────────────────
    cols_sql = ["sku", "store_code", "week_start", "target_units"] + features
    salida = df[cols_sql].copy()
    salida["week_start"] = salida["week_start"].dt.date

    pq = os.path.join(ART, "features.parquet")
    salida.to_parquet(pq, index=False)
    print(f"[feat] parquet: {pq} ({os.path.getsize(pq)/1e6:.1f} MB)")

    registros = [tuple(None if pd.isna(v) else v for v in fila)
                 for fila in salida.itertuples(index=False, name=None)]
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE demand_features")
        cols = ",".join(cols_sql)
        ph = ",".join(["%s"] * len(cols_sql))
        # Se inserta en tandas para no montar una transacción gigante
        for i in range(0, len(registros), 5000):
            cur.executemany(f"INSERT INTO demand_features ({cols}) VALUES ({ph})",
                            registros[i:i + 5000])
        conn.commit()

    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*), COUNT(target_units) FROM demand_features")
        n, con_target = cur.fetchone()
    print(f"[feat] demand_features: {n} filas ({con_target} con target)")

    # Sin lags no hay aprendizaje supervisado: se informa de la pérdida
    sin_lags = int(df["lag_52"].isna().sum())
    print(f"[feat] filas sin lag_52 (primera anualidad): {sin_lags} ({100*sin_lags/len(df):.1f} %)")


if __name__ == "__main__":
    main()
