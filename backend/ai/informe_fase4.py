#!/usr/bin/env python3
"""
Informe de validación de la Fase 4: agrega los model_runs y contrasta cada
criterio de aceptación de la orden, incluidos los que NO se cumplen.

RETENCIÓN (F0-11)
-----------------
Antes el JSON acumulaba todas las corridas: varias ejecuciones del mismo
modelo con métricas distintas y contradictorias, sin forma de saber cuál
estaba vigente. Ahora:

  · `informe-fase4.json` guarda UNA sola corrida por tipo (la última).
  · El historial completo se archiva en `artifacts/historial-fase4.json`,
    que está ignorado por git (se regenera; no es fuente de verdad).

Así las cifras del informe son inequívocas y el repositorio no crece con
cada reentrenamiento.
"""
import json
import os
from datetime import datetime

import psycopg

DSN = "postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda"
AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(AQUI, "informe-fase4.json")
ARTEFACTOS = os.path.join(AQUI, "artifacts")
HISTORIAL = os.path.join(ARTEFACTOS, "historial-fase4.json")

CRITERIOS = [
    ("WRMSSE holdout ≤ 0.35", "wrmsse", lambda v: v <= 0.35),
    ("Mejora WAPE nuevos ≥ 10 %", "mejor_mejora_pct", lambda v: v >= 10),
    ("Coherencia jerárquica < 1 %", "coherencia_mint_pct", lambda v: v < 1),
    # Convenio: reduccion_* es POSITIVA cuando el inventario/faltantes BAJAN.
    # El valor -5.3 significa un AUMENTO del 5.3 %, y por tanto NO cumple.
    ("Reducción inventario −5..−15 %", "reduccion_inventario_pct", lambda v: 5 <= v <= 15),
    ("Reducción faltantes −15..−25 %", "reduccion_faltantes_pct", lambda v: 15 <= v <= 25),
    ("Cobertura ≥ 95 %", "cobertura_pct", lambda v: v >= 95),
]


def main():
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute("SELECT id, kind, metrics, notes, created_at FROM model_runs WHERE phase='4' ORDER BY created_at")
        runs = [{"id": r[0], "kind": r[1], "metrics": r[2], "notes": r[3],
                 "cuando": str(r[4])} for r in cur.fetchall()]
        cur.execute("""SELECT COUNT(*), MIN(week_start), MAX(week_start),
                              ROUND(100.0*COUNT(*) FILTER (WHERE units_sold=0)/COUNT(*),1)
                       FROM sales_history""")
        n, d0, d1, pct0 = cur.fetchone()
        cur.execute("SELECT COUNT(*) FROM feature_registry")
        n_feat = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM inventory_recommendations")
        n_rec = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT sku||'|'||store_code) FROM sales_history")
        n_series = cur.fetchone()[0]
        cur.execute("SELECT COUNT(DISTINCT sku||'|'||store_code) FROM demand_forecasts")
        n_fc_series = cur.fetchone()[0]

    # ── Retención: historial completo fuera del repo ─────────────────
    os.makedirs(ARTEFACTOS, exist_ok=True)
    with open(HISTORIAL, "w") as f:
        json.dump({
            "generado": datetime.now().isoformat(),
            "nota": "Historial completo de corridas de la Fase 4. Archivo de trabajo, ignorado por git.",
            "runs": runs,
        }, f, indent=2, ensure_ascii=False, default=str)

    # ── Una sola corrida vigente por modelo (la última) ──────────────
    vigentes = {}
    for r in runs:                    # ORDER BY created_at ASC
        vigentes[r["kind"]] = r
    vigentes = list(vigentes.values())

    met = {}
    for r in vigentes:
        met.update(r["metrics"] or {})

    # Cobertura: si la corrida de inventario es anterior a que la métrica se
    # persistiera, se deriva de demand_forecasts (series con forecast sobre
    # series totales). Nunca se rellena con un 100 % de conveniencia.
    if met.get("cobertura_pct") is None:
        met["cobertura_pct"] = round(n_fc_series / n_series * 100, 1) if n_series else None

    informe = {
        "generado": datetime.now().isoformat(),
        "aviso": ("HISTORIAL SINTÉTICO. Todas las filas de sales_history llevan "
                  "is_synthetic=TRUE. Estas métricas validan que el PIPELINE funciona; "
                  "NO son evidencia de capacidad predictiva sobre demanda real."),
        "retencion": ("Una corrida vigente por modelo (la última). El historial "
                      "completo vive en artifacts/historial-fase4.json."),
        "datos": {
            "filas_ventas": n, "desde": str(d0), "hasta": str(d1),
            "pct_semanas_sin_venta": float(pct0), "series_sku_tienda": n_series,
            "features_registradas": n_feat, "recomendaciones_inventario": n_rec,
            "series_con_forecast": n_fc_series,
        },
        "runs": vigentes,
        "criterios": [],
    }
    for etiqueta, clave, fn in CRITERIOS:
        v = met.get(clave)
        ok = fn(v) if isinstance(v, (int, float)) else False
        informe["criterios"].append({"criterio": etiqueta, "valor": v, "cumple": bool(ok)})
    informe["criterios"].append(
        {"criterio": "Latencia de scoring < 2 h", "valor": met.get("ms_scoring_13sem"),
         "cumple": bool((met.get("ms_scoring_13sem") or 1e9) < 7_200_000)})
    informe["criterios"].append(
        {"criterio": "Top-10 features documentados (ambas etapas)",
         "valor": f"{len(met.get('top10_ocurrencia', {}))} + {len(met.get('top10_magnitud', {}))}",
         "cumple": bool(met.get("top10_ocurrencia") and met.get("top10_magnitud"))})

    with open(SALIDA, "w") as f:
        json.dump(informe, f, indent=2, ensure_ascii=False, default=str)

    print(f"\n{'='*74}\nINFORME DE VALIDACIÓN · FASE 4\n{'='*74}")
    print(f"  historial: {n} filas · {d0} → {d1} · {pct0} % semanas sin venta")
    print(f"  features registradas: {n_feat} · recomendaciones: {n_rec}")
    print(f"  corridas vigentes: {len(vigentes)} de {len(runs)} (historial en artifacts/)")
    print()
    for c in informe["criterios"]:
        print(f"  {'✅' if c['cumple'] else '❌'} {c['criterio']:42} {c['valor']}")
    print(f"\n  → {SALIDA}\n")


if __name__ == "__main__":
    main()
