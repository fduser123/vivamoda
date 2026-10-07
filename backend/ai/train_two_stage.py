#!/usr/bin/env python3
"""
PASO 3 — TWO-STAGE XGBOOST (productos con historial).

La demanda en moda es INTERMITENTE: el 43 % de las combinaciones
SKU/tienda/semana de este historial venden 0. Un regresor único aprende a
predecir cero y sesga todo a la baja, por eso se separan las dos preguntas:

  Etapa 1 · ¿habrá demanda?       clasificador  → P(unidades > 0)
  Etapa 2 · ¿cuánto se venderá?   regresor sobre las filas con venta, y la
                                  probabilidad de la etapa 1 entra como feature

La predicción final combina ambas:  ŷ = P(ocurrencia) · E[magnitud | ocurre]

Métrica principal: WRMSSE (la de M5), ponderada por el peso de cada serie.
Split: las 13 últimas semanas como holdout + validación rodante (rolling origin).
"""
import json
import os
import time
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
import psycopg
import xgboost as xgb
from sklearn.metrics import roc_auc_score, mean_absolute_error

DSN = "postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda"
AQUI = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(AQUI, "artifacts")
os.makedirs(ART, exist_ok=True)
SEED = 42
HOLDOUT_SEMANAS = 13

CATEGORICAS = ["categoria", "tipo_prenda", "color", "tienda"]


def wrmsse(real: np.ndarray, pred: np.ndarray, escala: float, peso: float):
    """RMSSE de una serie: error del modelo / error del naive, escalado."""
    mse = np.mean((real - pred) ** 2)
    return peso * np.sqrt(mse / escala) if escala > 0 else 0.0


def evaluar(df_hold, pred, y):
    """WRMSSE + MAE + MAPE sobre el holdout, agregando por serie."""
    d = df_hold[["sku", "store_code", "week_start"]].copy()
    d["y"] = y
    d["p"] = pred

    # Escala naive por serie: error cuadrático medio de y_t - y_{t-1} en TODO el
    # histórico de la serie (definición M5). Si es 0 (serie plana) se usa 1.
    with psycopg.connect(DSN) as conn:
        hist = pd.read_sql("""
            SELECT sku, store_code, units_sold::float8 AS u
            FROM sales_history ORDER BY sku, store_code, week_start
        """, conn)
    hist["dif"] = hist.groupby(["sku", "store_code"])["u"].diff()
    escala = (hist.groupby(["sku", "store_code"])["dif"]
              .apply(lambda s: float((s.dropna() ** 2).mean()) if s.notna().any() else 0.0))
    # Peso = cuota de ventas de la serie sobre el total (como en M5)
    tot = hist.groupby(["sku", "store_code"])["u"].sum()
    pesos = tot / max(tot.sum(), 1e-9)

    total = 0.0
    for (sku, store), g in d.groupby(["sku", "store_code"]):
        esc = float(escala.get((sku, store), 0.0)) or 1.0
        pe = float(pesos.get((sku, store), 0.0))
        if pe <= 0:
            continue
        total += wrmsse(g["y"].to_numpy(), g["p"].to_numpy(), esc, pe)

    # MAE/MAPE sólo sobre las filas con venta (MAPE con 0 no está definido)
    con_venta = d["y"] > 0
    mae = mean_absolute_error(d["y"], d["p"]) if len(d) else float("nan")
    mape = (np.mean(np.abs(d.loc[con_venta, "y"] - d.loc[con_venta, "p"])
                    / d.loc[con_venta, "y"]) * 100) if con_venta.any() else float("nan")
    return {"wrmsse": float(total), "mae": float(mae), "mape": float(mape)}


def entrena_y_evalua(df_tr, df_ho, etiqueta, params_clf=None, params_reg=None, verbose=True):
    feats = [c for c in df_tr.columns if c not in
             ("sku", "store_code", "week_start", "target_units", "best_seller", "y")]

    Xtr = df_tr[feats]
    ytr = df_tr["target_units"].to_numpy(float)
    ocurre_tr = (ytr > 0).astype(int)

    # ── Etapa 1: clasificador de ocurrencia ──────────────────────────
    clf = xgb.XGBClassifier(
        n_estimators=(params_clf or {}).get("n_estimators", 400),
        max_depth=(params_clf or {}).get("max_depth", 6),
        learning_rate=(params_clf or {}).get("learning_rate", 0.08),
        subsample=0.9, colsample_bytree=0.9,
        enable_categorical=True, tree_method="hist",
        eval_metric="logloss", random_state=SEED, n_jobs=-1)
    clf.fit(Xtr, ocurre_tr)
    p_tr = clf.predict_proba(Xtr)[:, 1]

    # ── Etapa 2: regresor de magnitud │ ocurre ───────────────────────
    mascara = ytr > 0
    Xtr2 = Xtr[mascara].copy()
    Xtr2["p_ocurrencia"] = p_tr[mascara]     # la etapa 1 alimenta a la 2
    reg = xgb.XGBRegressor(
        n_estimators=(params_reg or {}).get("n_estimators", 500),
        max_depth=(params_reg or {}).get("max_depth", 6),
        learning_rate=(params_reg or {}).get("learning_rate", 0.06),
        subsample=0.9, colsample_bytree=0.9, reg_lambda=1.0,
        enable_categorical=True, tree_method="hist",
        random_state=SEED, n_jobs=-1)
    reg.fit(Xtr2, ytr[mascara])

    # ── Predicción combinada sobre el holdout ────────────────────────
    Xho = df_ho[feats]
    p_ho = clf.predict_proba(Xho)[:, 1]
    Xho2 = Xho.copy()
    Xho2["p_ocurrencia"] = p_ho
    mag = reg.predict(Xho2)
    pred = np.clip(p_ho * mag, 0, None)

    y_ho = df_ho["target_units"].to_numpy(float)
    met = evaluar(df_ho, pred, y_ho)
    met["auc"] = float(roc_auc_score((y_ho > 0).astype(int), p_ho))
    # Baseline: media histórica por SKU/tienda (lo que pide la orden comparar)
    media = df_tr.groupby(["sku", "store_code"])["target_units"].mean()
    base = df_ho.set_index(["sku", "store_code"]).index.map(media).to_numpy(float)
    base = np.nan_to_num(base, nan=float(np.mean(ytr)))
    met_base = evaluar(df_ho, base, y_ho)
    if verbose:
        print(f"  [{etiqueta}] WRMSSE {met['wrmsse']:.4f} (baseline media {met_base['wrmsse']:.4f}) "
              f"· AUC {met['auc']:.4f} · MAE {met['mae']:.3f} · MAPE {met['mape']:.1f} %")
    return {"clf": clf, "reg": reg, "feats": feats, "metricas": met, "baseline": met_base}, pred, p_ho


def main():
    t0 = time.time()
    pq = os.path.join(ART, "features.parquet")
    df = pd.read_parquet(pq)
    df["week_start"] = pd.to_datetime(df["week_start"])
    for c in CATEGORICAS:
        df[c] = df[c].astype("category")
    print(f"[2stage] {len(df)} filas · {df['week_start'].min().date()} → {df['week_start'].max().date()}")

    semanas = sorted(df["week_start"].unique())
    corte = semanas[-HOLDOUT_SEMANAS]
    df_tr = df[df["week_start"] < corte].copy()
    df_ho = df[df["week_start"] >= corte].copy()
    print(f"[2stage] train {len(df_tr)} filas · holdout {len(df_ho)} filas "
          f"({HOLDOUT_SEMANAS} semanas desde {pd.Timestamp(corte).date()})")

    # Best-seller por SKU (para el modelo de productos nuevos, se guarda aquí)
    mb = df_tr.groupby("sku")["target_units"].sum()
    df_ho["best_seller"] = df_ho["sku"].map(mb).fillna(0)

    print("\n[2stage] Modelo principal (holdout de 13 semanas)")
    modelo, pred_ho, p_ho = entrena_y_evalua(df_tr, df_ho, "principal")

    # ── Validación rodante (rolling origin) ──────────────────────────
    print("\n[2stage] Validación rodante (3 orígenes)")
    rodante = []
    for k in (39, 26, 13):     # 3 cortes hacia atrás
        c = semanas[-k]
        ho = df[(df["week_start"] >= c) & (df["week_start"] < semanas[-(k - 13)])].copy() \
            if k > 13 else df_ho.copy()
        tr = df[df["week_start"] < c].copy()
        if len(ho) < 100 or len(tr) < 1000:
            continue
        m, _, _ = entrena_y_evalua(tr, ho, f"origen -{k}sem")
        rodante.append(m["metricas"]["wrmsse"])
    print(f"  WRMSSE rodante: {[round(x,4) for x in rodante]} · media {np.mean(rodante):.4f}")

    # ── SHAP: qué impulsa ocurrencia y magnitud ──────────────────────
    print("\n[2stage] Explicabilidad SHAP")
    import shap
    feats = modelo["feats"]
    Xs = df_tr[feats].sample(min(3000, len(df_tr)), random_state=SEED)
    shap_ocurrencia = shap.TreeExplainer(modelo["clf"])(Xs)
    imp1 = pd.Series(np.abs(shap_ocurrencia.values).mean(0), index=feats).sort_values(ascending=False)

    m2 = df_tr["target_units"] > 0
    Xs2 = df_tr.loc[m2, feats].sample(min(3000, int(m2.sum())), random_state=SEED).copy()
    Xs2["p_ocurrencia"] = modelo["clf"].predict_proba(df_tr.loc[Xs2.index, feats])[:, 1]
    shap_magnitud = shap.TreeExplainer(modelo["reg"])(Xs2)
    imp2 = pd.Series(np.abs(shap_magnitud.values).mean(0),
                     index=list(Xs2.columns)).sort_values(ascending=False)

    print("  Top-10 OCURRENCIA: " + ", ".join(f"{k}({v:.3f})" for k, v in imp1.head(10).items()))
    print("  Top-10 MAGNITUD  : " + ", ".join(f"{k}({v:.3f})" for k, v in imp2.head(10).items()))

    # ── Persistencia ─────────────────────────────────────────────────
    joblib.dump({"clf": modelo["clf"], "reg": modelo["reg"], "feats": feats},
                os.path.join(ART, "two_stage_xgb.joblib"))
    joblib.dump({"ocurrencia": imp1, "magnitud": imp2},
                os.path.join(ART, "shap_importancias.joblib"))

    met_final = modelo["metricas"]
    run_id = "2stage-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("""
            INSERT INTO model_runs (id, phase, kind, params, metrics, artifacts, notes)
            VALUES (%s,'4','two_stage_xgb',%s,%s,%s,%s)
        """, (
            run_id,
            json.dumps({"holdout_semanas": HOLDOUT_SEMANAS, "seed": SEED,
                        "n_train": len(df_tr), "n_holdout": len(df_ho)}),
            json.dumps({**met_final, "baseline_media_wrmsse": modelo["baseline"]["wrmsse"],
                        "wrmsse_rodante_media": float(np.mean(rodante)),
                        "top10_ocurrencia": imp1.head(10).round(4).to_dict(),
                        "top10_magnitud": imp2.head(10).round(4).to_dict()}),
            json.dumps({"modelo": "two_stage_xgb.joblib", "shap": "shap_importancias.joblib"}),
            "Historial SINTÉTICO: las métricas validan el pipeline, no la demanda real",
        ))
        conn.commit()

    print(f"\n[2stage] WRMSSE holdout = {met_final['wrmsse']:.4f}  (criterio ≤ 0.35 → "
          f"{'CUMPLE' if met_final['wrmsse'] <= 0.35 else 'NO CUMPLE'})")
    print(f"[2stage] run_id = {run_id} · {(time.time()-t0)/60:.1f} min")


if __name__ == "__main__":
    main()
