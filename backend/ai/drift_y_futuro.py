#!/usr/bin/env python3
"""
Completa los datos que faltaban en el panel de previsión de demanda.

1) DRIFT. La tabla `drift_metrics` estaba vacía: se creó el esquema pero nunca
   se calculó el PSI (Population Stability Index). Se compara la distribución
   de cada feature entre el periodo de entrenamiento y el reciente.

       PSI < 0.10  → estable
       PSI < 0.25  → cambio moderado, vigilar
       PSI >= 0.25 → drift, conviene reentrenar

2) FUTURO. `demand_forecasts` sólo tenía el backtest de 13 semanas (para medir
   el WRMSSE), no la previsión hacia delante que es lo que se usa para decidir
   compras. Se generan 12 semanas futuras por serie, de forma recursiva: para
   h > 1 el lag_1 es la propia predicción de la semana anterior.
"""
import json
import os
from datetime import datetime, timedelta

import joblib
import numpy as np
import pandas as pd
import psycopg

DSN = "postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda"
AQUI = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(AQUI, "artifacts")
HORIZONTE = 12
CATEGORICAS = ["categoria", "tipo_prenda", "color", "tienda"]
NUMERICAS = ["lag_1", "lag_2", "lag_4", "lag_8", "lag_12", "lag_52",
             "roll_4_mean", "roll_8_mean", "roll_4_std", "roll_12_std",
             "semana_iso", "mes", "trimestre", "antiguedad_semanas",
             "precio", "descuento", "promo_flag", "promo_depth",
             "tendencia_categoria", "rating", "coste", "margen"]


def psi(base: np.ndarray, actual: np.ndarray, cubos: int = 10) -> float:
    """Population Stability Index con cortes por cuantiles de la base."""
    base = base[~np.isnan(base)]
    actual = actual[~np.isnan(actual)]
    if len(base) < 50 or len(actual) < 50:
        return 0.0
    cortes = np.unique(np.quantile(base, np.linspace(0, 1, cubos + 1)))
    if len(cortes) < 3:
        return 0.0
    cortes[0], cortes[-1] = -np.inf, np.inf
    pb = np.histogram(base, bins=cortes)[0] / len(base)
    pa = np.histogram(actual, bins=cortes)[0] / len(actual)
    pb = np.clip(pb, 1e-6, None)
    pa = np.clip(pa, 1e-6, None)
    return float(np.sum((pa - pb) * np.log(pa / pb)))


def drift():
    df = pd.read_parquet(os.path.join(ART, "features.parquet"))
    df["week_start"] = pd.to_datetime(df["week_start"])
    corte = df["week_start"].quantile(0.80)
    base = df[df["week_start"] <= corte]
    reciente = df[df["week_start"] > corte]
    print(f"[drift] base {len(base)} filas · reciente {len(reciente)} filas")

    filas = []
    for f in NUMERICAS:
        if f not in df.columns:
            continue
        v = psi(base[f].to_numpy(float), reciente[f].to_numpy(float))
        filas.append((f, "psi", float(np.nanmean(base[f])), float(np.nanmean(reciente[f])), v, v >= 0.25))
        estado = "DRIFT" if v >= 0.25 else ("vigilar" if v >= 0.10 else "estable")
        print(f"  {f:22} PSI {v:6.4f}  {estado}")

    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM drift_metrics WHERE kind = 'psi'")
        cur.executemany("""
            INSERT INTO drift_metrics (run_id, feature, kind, train_mean, prod_mean, psi, drift)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
        """, [("drift-" + datetime.now().strftime("%Y%m%d-%H%M%S"), f, k, tb, pb, v, d)
              for (f, k, tb, pb, v, d) in filas])
        conn.commit()
    n_drift = sum(1 for *_, d in filas if d)
    print(f"[drift] {len(filas)} features evaluadas · {n_drift} con drift")
    return {"features": len(filas), "con_drift": n_drift, "detalle": {f: round(v, 4) for (f, _, _, _, v, _) in filas}}


def futuro():
    modelo = joblib.load(os.path.join(ART, "two_stage_xgb.joblib"))
    clf, reg, feats = modelo["clf"], modelo["reg"], modelo["feats"]

    df = pd.read_parquet(os.path.join(ART, "features.parquet"))
    df["week_start"] = pd.to_datetime(df["week_start"])
    for c in CATEGORICAS:
        df[c] = df[c].astype("category")
    ultima = df.sort_values("week_start").groupby(["sku", "store_code"], as_index=False).tail(1)
    print(f"[futuro] {len(ultima)} series · horizonte {HORIZONTE} semanas")

    with psycopg.connect(DSN) as conn:
        promos = pd.read_sql("SELECT week_start, depth FROM promo_calendar", conn)
    promos["week_start"] = pd.to_datetime(promos["week_start"])
    promo_map = dict(zip(promos["week_start"], promos["depth"]))

    arranque = ultima["week_start"].max() + timedelta(weeks=1)
    semanas = [arranque + timedelta(weeks=i) for i in range(HORIZONTE)]

    filas = []
    for _, base in ultima.iterrows():
        fila = base.to_dict()
        hist = [float(fila.get(f"lag_{L}") or 0) for L in (1, 2, 4, 8, 12)]
        for h, w in enumerate(semanas, start=1):
            nueva = dict(fila)
            nueva["week_start"] = w
            nueva["semana_iso"] = int(w.isocalendar()[1])
            nueva["mes"] = w.month
            nueva["trimestre"] = w.quarter
            nueva["antiguedad_semanas"] = float(fila.get("antiguedad_semanas") or 0) + h
            nueva["lag_1"] = hist[0]
            nueva["lag_2"] = hist[0]
            nueva["lag_4"] = hist[3] if h <= 4 else hist[0]
            nueva["lag_8"] = hist[3]
            nueva["lag_12"] = hist[4]
            nueva["roll_4_mean"] = float(np.mean([hist[0], hist[1], hist[0], hist[0]]))
            nueva["roll_8_mean"] = float(np.mean([hist[0], hist[0], hist[1], hist[3]]))
            nueva["roll_4_std"] = float(np.std([hist[0], hist[1], hist[0], hist[0]]))
            nueva["roll_12_std"] = float(np.std([hist[0], hist[1], hist[3], hist[4]]))
            prof = float(promo_map.get(w, 0.0) or 0.0)
            nueva["promo_flag"] = 1 if prof > 0 else 0
            nueva["promo_depth"] = prof
            nueva["descuento"] = prof

            x = pd.DataFrame([{f: nueva.get(f) for f in feats}])
            for c in CATEGORICAS:
                if c in x.columns:
                    x[c] = x[c].astype("category")
            p = float(clf.predict_proba(x)[:, 1][0])
            x2 = x.copy(); x2["p_ocurrencia"] = p
            mag = float(reg.predict(x2)[0])
            pred = max(0.0, p * mag)
            filas.append((base["sku"], base["store_code"], w.date(), h, p, pred))
            hist = [pred] + hist[:-1]

    run_id = "futuro-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM demand_forecasts WHERE run_id LIKE 'futuro-%'")
        for i in range(0, len(filas), 5000):
            cur.executemany("""
                INSERT INTO demand_forecasts (run_id, sku, store_code, week_start, horizon,
                                              p_occurrence, units_point, model, reconciled)
                VALUES (%s,%s,%s,%s,%s,%s,%s,'two_stage_xgb',TRUE)
            """, [(run_id, s, st, w, h, p, u) for (s, st, w, h, p, u) in filas[i:i + 5000]])
        conn.commit()
    print(f"[futuro] {len(filas)} predicciones · {arranque.date()} → {semanas[-1].date()} · run_id {run_id}")
    return {"predicciones": len(filas), "desde": str(arranque.date()), "hasta": str(semanas[-1].date()), "run_id": run_id}


if __name__ == "__main__":
    d = drift()
    f = futuro()
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO model_runs (id, phase, kind, params, metrics, artifacts, notes)
            VALUES (%s,'4','drift_y_futuro',%s,%s,'{}','PSI sobre features y previsión a 12 semanas')
        """, (f["run_id"], json.dumps({"horizonte": HORIZONTE}),
              json.dumps({"drift": d, "futuro": f})))
        conn.commit()
    print("\n[ok] drift_metrics y demand_forecasts completados")
