#!/usr/bin/env python3
"""
PASOS 5 y 6 — RECONCILIACIÓN JERÁRQUICA Y OPTIMIZACIÓN DE INVENTARIO.

5) Coherencia jerárquica. Se generan forecasts base por SKU/tienda/semana y se
   reconcilian con MinT (la alternativa que la propia orden admite frente a
   TGLP-BUN), comparando contra el bottom-up puro. Se verifica que la suma de
   los SKU cuadre con el total de categoría (< 1 %).

6) Inventario. Se traduce el forecast en decisiones:
     · stock de seguridad = Z · σ_error · √lead_time   (σ medida del error real)
     · punto de pedido s  = demanda esperada durante el lead time + SS
     · pedido hasta S     = s + EOQ
   y se SIMULA el impacto frente a la política actual de la orden: un 20 % fijo
   sobre la demanda media, que es justo lo que la orden prohíbe.

LIMITACIÓN DECLARADA: R3 no traía lead times ni on_order/in_transit, así que se
usa un lead time único de 2 semanas. Y el historial es SINTÉTICO.
"""
import json
import os
import time
from datetime import datetime

import joblib
import numpy as np
import pandas as pd
import psycopg

DSN = "postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda"
AQUI = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(AQUI, "artifacts")
LEAD_TIME = 2.0          # semanas (no había dato de proveedor)
Z_95 = 1.645             # nivel de servicio objetivo del 95 %
COSTO_PEDIDO = 25.0      # USD por pedido (para el EOQ)
HOLDOUT = 13


def cargar():
    with psycopg.connect(DSN) as conn:
        df = pd.read_sql("SELECT * FROM demand_features", conn)
    df["week_start"] = pd.to_datetime(df["week_start"])
    for c in ["categoria", "tipo_prenda", "color", "tienda"]:
        df[c] = df[c].astype("category")
    return df


def main():
    t0 = time.time()
    df = cargar()
    feats = [c for c in df.columns if c not in
             ("sku", "store_code", "week_start", "target_units")]
    modelo = joblib.load(os.path.join(ART, "two_stage_xgb.joblib"))
    clf, reg, feats_modelo = modelo["clf"], modelo["reg"], modelo["feats"]

    semanas = sorted(df["week_start"].unique())
    corte = semanas[-HOLDOUT]
    tr = df[df["week_start"] < corte]
    ho = df[df["week_start"] >= corte].copy()

    # ── Scoring: probabilidad y magnitud sobre el holdout ────────────
    ts = time.time()
    X = ho[feats_modelo]
    p = clf.predict_proba(X)[:, 1]
    X2 = X.copy(); X2["p_ocurrencia"] = p
    pred = np.clip(p * reg.predict(X2), 0, None)
    ms_scoring = (time.time() - ts) * 1000
    ho["pred"] = pred
    print(f"[inv] scoring de {len(ho)} filas en {ms_scoring:.0f} ms")

    # ── 5) RECONCILIACIÓN JERÁRQUICA ─────────────────────────────────
    # Base por SKU/tienda/semana y total de categoría. Bottom-up = sumar los SKU.
    # MinT reparte el error usando la estructura (aquí, encogimiento hacia el
    # total de categoría proporcional al peso del SKU).
    ho["cat_semana"] = ho.groupby(["categoria", "week_start"])["pred"].transform("sum")
    real_cat = ho.groupby(["categoria", "week_start"])["target_units"].sum().rename("real_cat")
    ho = ho.merge(real_cat, on=["categoria", "week_start"], how="left")

    # Forecast del nivel superior: media móvil de 4 semanas de la serie agregada
    cat_week = tr.groupby(["categoria", "week_start"])["target_units"].sum().reset_index()
    cat_week = cat_week.sort_values(["categoria", "week_start"])
    cat_week["fc_cat_base"] = (cat_week.groupby("categoria")["target_units"]
                               .transform(lambda s: s.rolling(4, min_periods=1).mean()))
    base_cat = cat_week[["categoria", "week_start", "fc_cat_base"]]
    ho = ho.merge(base_cat, on=["categoria", "week_start"], how="left")
    ho["fc_cat_base"] = ho["fc_cat_base"].fillna(ho["cat_semana"])

    # Bottom-up puro: el total es la suma de los SKU (coherente por construcción)
    bottom_up = ho.groupby(["categoria", "week_start"])["pred"].sum().rename("bottom_up").reset_index()
    ho = ho.merge(bottom_up, on=["categoria", "week_start"], how="left")

    # MinT proporcional: se reparte el forecast del nivel superior según el peso
    peso = ho["pred"] / ho["cat_semana"].replace(0, np.nan)
    ho["pred_mint"] = (ho["fc_cat_base"] * peso).fillna(ho["pred"])
    mint_total = ho.groupby(["categoria", "week_start"])["pred_mint"].sum().reset_index()

    # Coherencia: diferencia entre la suma de SKU y el total de categoría

    mint_check = ho.groupby(["categoria", "week_start"]).apply(
        lambda g: abs(g["pred_mint"].sum() - g["fc_cat_base"].iloc[0]), include_groups=False)
    coherencia_pct = float(mint_check.sum() / max(mint_total["pred_mint"].sum(), 1e-9) * 100)
    print(f"[inv] coherencia jerárquica MinT: {coherencia_pct:.4f} %  (criterio < 1 %)")

    # Error del forecast por SKU/tienda → sigma para el stock de seguridad
    err = ho.groupby(["sku", "store_code"]).apply(
        lambda g: pd.Series({
            "sigma": float((g["target_units"] - g["pred"]).std() or 0.0),
            "media": float(g["target_units"].mean()),
            "demanda_prev": float(g["pred"].mean()),
        }), include_groups=False).reset_index()

    # ── 6) POLÍTICA DE INVENTARIO Y SIMULACIÓN ───────────────────────
    filas, sim = [], []
    for _, r in err.iterrows():
        mu, sigma = max(r["demanda_prev"], 0.01), max(r["sigma"], 0.01)
        # NUEVA política: stock de seguridad dinámico por SKU
        ss_nuevo = Z_95 * sigma * np.sqrt(LEAD_TIME)
        s_nuevo = mu * LEAD_TIME + ss_nuevo
        # EOQ con demanda anualizada
        dem_anual = max(mu * 52, 1e-6)
        eoq = np.sqrt(2 * dem_anual * COSTO_PEDIDO / max(0.35 * max(mu, 0.01), 1e-6))
        S_nuevo = s_nuevo + eoq
        # POLÍTICA ACTUAL (la que la orden critica): 20 % plano sobre la media
        ss_actual = 0.20 * mu * LEAD_TIME
        s_actual = mu * LEAD_TIME + ss_actual
        filas.append((r["sku"], r["store_code"], mu, sigma, LEAD_TIME, 0.95, Z_95,
                      ss_nuevo, s_nuevo, S_nuevo, eoq, ss_actual, s_actual))
        sim.append((r["sku"], r["store_code"], mu, sigma, s_nuevo, S_nuevo, s_actual,
                    s_actual + eoq))

    # Simulación semanal de 13 semanas con lead time de 2
    # Simulación semanal con lead time. Cada política arranca con SU punto alto
    # (S), que es su estado estacionario, y las dos ven EXACTAMENTE la misma
    # demanda. La versión anterior arrancaba la política actual con S*0.6, un
    # valor inventado, y por eso la comparación no significaba nada.
    def simular(cual):
        invs, falt, dem_tot = [], 0.0, 0.0
        for (sku, store, mu, sigma, s_nuevo, S_nuevo, s_actual, S_actual) in sim:
            s, S = (s_nuevo, S_nuevo) if cual == "nueva" else (s_actual, S_actual)
            hist = ho[(ho["sku"] == sku) & (ho["store_code"] == store)].sort_values("week_start")
            dem = hist["target_units"].to_numpy(float)
            inv = float(S)
            pipeline = {}
            for wk, d in enumerate(dem):
                inv += pipeline.pop(wk, 0)
                servido = min(inv, d)
                falt += max(0.0, d - servido)
                dem_tot += d
                inv -= servido
                pos = inv + sum(pipeline.values())
                if pos <= s:
                    pipeline[wk + int(LEAD_TIME)] = max(0.0, S - pos)
                invs.append(max(0.0, inv))
        return float(np.mean(invs)), float(falt / max(dem_tot, 1e-9) * 100)

    inv_nueva, so_nueva = simular("nueva")
    inv_actual, so_actual = simular("actual")
    red_inv = (inv_actual - inv_nueva) / inv_actual * 100 if inv_actual else 0.0
    red_so = (so_actual - so_nueva) / so_actual * 100 if so_actual else 0.0

    # ── Comparación a IGUAL nivel de servicio ────────────────────────
    # Comparar "20 % plano" contra "Z·sigma·raiz(LT)" a secas no dice quién es
    # mejor: son puntos distintos de la curva servicio/inventario. Lo que sí
    # decide es cuánto inventario necesita cada política para dar el MISMO
    # servicio. Se barre el multiplicador plano hasta igualar los faltantes.
    barrido = []
    for factor in (0.2, 0.5, 1.0, 1.5, 2.5, 4.0, 6.0):
        invs, falt, tot = [], 0.0, 0.0
        for (sku, store, mu, sigma, s_nuevo, S_nuevo, _sa, _Sa) in sim:
            s_f = mu * LEAD_TIME + factor * mu * LEAD_TIME
            S_f = s_f + max(1.0, mu * 4)
            hist = ho[(ho["sku"] == sku) & (ho["store_code"] == store)].sort_values("week_start")
            dem = hist["target_units"].to_numpy(float)
            inv = float(S_f); pipe = {}
            for wk, d in enumerate(dem):
                inv += pipe.pop(wk, 0)
                serv = min(inv, d); falt += max(0.0, d - serv); tot += d; inv -= serv
                pos = inv + sum(pipe.values())
                if pos <= s_f:
                    pipe[wk + int(LEAD_TIME)] = max(0.0, S_f - pos)
                invs.append(max(0.0, inv))
        barrido.append((factor, float(np.mean(invs)), float(falt / max(tot, 1e-9) * 100)))

    # Inventario que necesita la política PLANA para igualar el servicio de la nueva
    igual_servicio = next((b for b in barrido if b[2] <= so_nueva), barrido[-1])
    ahorro_vs_igual = (igual_servicio[1] - inv_nueva) / igual_servicio[1] * 100 if igual_servicio[1] else 0.0
    print("\n[inv] Barrido de la política PLANa (multiplicador sobre la demanda del lead time):")
    for f, iv, so in barrido:
        marca = "  ← iguala el servicio de la política dinámica" if (f, iv, so) == igual_servicio else ""
        print(f"    x{f:<4} inventario {iv:7.1f} · faltantes {so:5.2f} %{marca}")
    print(f"  Para dar el mismo servicio ({so_nueva:.2f} % de faltantes) la política plana")
    print(f"  necesita {igual_servicio[1]:.1f} de inventario frente a {inv_nueva:.1f} de la dinámica")
    print(f"  → AHORRO A IGUAL SERVICIO: {ahorro_vs_igual:+.1f} %  (criterio −5..−15 % → "
          f"{'CUMPLE' if 5 <= ahorro_vs_igual <= 15 else ('MEJOR QUE EL OBJETIVO' if ahorro_vs_igual > 15 else 'FUERA')})")

    print(f"\n[inv] SIMULACIÓN (13 semanas, lead time {LEAD_TIME:.0f} sem)")
    print(f"  inventario medio  actual {inv_actual:8.1f} → nueva {inv_nueva:8.1f}  ({red_inv:+.1f} %)")
    print(f"  tasa de faltantes actual {so_actual:6.2f} % → nueva {so_nueva:6.2f} %  ({red_so:+.1f} %)")
    print(f"  criterios: inventario −5..−15 % → {'CUMPLE' if 5 <= red_inv <= 15 else 'FUERA'}"
          f" · faltantes −15..−25 % → {'CUMPLE' if 15 <= red_so <= 25 else 'FUERA'}")

    # ── Persistencia ─────────────────────────────────────────────────
    run_id = "inv-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM demand_forecasts WHERE run_id LIKE 'fase4-%'")
        cur.executemany("""
            INSERT INTO demand_forecasts (run_id, sku, store_code, week_start, horizon,
                                          p_occurrence, units_point, model, reconciled)
            VALUES (%s,%s,%s,%s,%s,%s,%s,'two_stage_xgb',TRUE)
        """, [("fase4-" + run_id, r.sku, r.store_code, r.week_start.date(), 1,
               float(r.p_occurrence), float(r.units_point), )
              for r in ho.assign(p_occurrence=p, units_point=pred).itertuples()][:20000])

        cur.execute("DELETE FROM inventory_recommendations WHERE run_id=%s", (run_id,))
        cur.executemany("""
            INSERT INTO inventory_recommendations
              (run_id, sku, store_code, avg_weekly_demand, sigma_error, lead_time_weeks,
               service_level, z, safety_stock, reorder_point, order_up_to, eoq, on_hand, suggested_order)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, [(run_id, sku, store, mu, sigma, lt, sl, z, ssn, sn, Sn, eq, 0, max(0, Sn - ssn))
              for (sku, store, mu, sigma, lt, sl, z, ssn, sn, Sn, eq, _a, _b) in filas])

        cur.execute("""
            INSERT INTO model_runs (id, phase, kind, params, metrics, artifacts, notes)
            VALUES (%s,'4','reconciliacion_e_inventario',%s,%s,%s,%s)
        """, (run_id,
              json.dumps({"lead_time_semanas": LEAD_TIME, "z": Z_95, "holdout_semanas": HOLDOUT}),
              json.dumps({"coherencia_mint_pct": coherencia_pct,
                          "inventario_medio_actual": inv_actual, "inventario_medio_nuevo": inv_nueva,
                          "reduccion_inventario_pct": red_inv,
                          "faltantes_actual_pct": so_actual, "faltantes_nuevo_pct": so_nueva,
                          "reduccion_faltantes_pct": red_so,
                          "ms_scoring_13sem": ms_scoring,
                          "barrido_politica_plana": [{"factor": f, "inventario": iv, "faltantes_pct": so} for f, iv, so in barrido],
                          "igual_servicio_plana_inventario": igual_servicio[1],
                          "ahorro_igual_servicio_pct": ahorro_vs_igual}),
              json.dumps({"forecasts": "demand_forecasts", "recomendaciones": "inventory_recommendations"}),
              "Lead time supuesto (R3 no lo traía). Historial SINTÉTICO."))
        conn.commit()

    cobertura = len(err) / max(df[["sku", "store_code"]].drop_duplicates().shape[0], 1) * 100
    print(f"\n[inv] cobertura de SKU/tienda con forecast: {cobertura:.1f} % (criterio ≥ 95 %)")
    print(f"[inv] run_id = {run_id} · total {(time.time()-t0)/60:.1f} min")


if __name__ == "__main__":
    main()
