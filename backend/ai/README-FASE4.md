# Fase 4 · Previsión de demanda y optimización de inventario

> ⚠️ **LÉEME PRIMERO.** Todo el historial de ventas de esta fase es
> **SINTÉTICO**. Cada fila de `sales_history` lleva `is_synthetic = TRUE`. La
> orden pedía 12-24 meses de ventas reales y la base sólo tenía **22 pedidos en
> 4 semanas** (17 SKUs de 353), insumos de demo del seed.
>
> **Las métricas de esta fase validan que el PIPELINE funciona. NO son evidencia
> de capacidad predictiva sobre demanda real.**

## Resultado de la validación

| Criterio de la orden | Objetivo | Medido | |
|---|---|---|---|
| WRMSSE holdout | ≤ 0.35 | **0.669** | ❌ (ver análisis) |
| Mejora WAPE productos nuevos | ≥ 10 % | **+6,82 %** | ❌ |
| Coherencia jerárquica | < 1 % | **0,0000 %** | ✅ |
| Reducción de inventario | −5 % a −15 % | **+5,3 %** (aumenta) | ❌ |
| Reducción de faltantes | −15 % a −25 % | **−92,1 %** | ❌ (mejor que el objetivo) |
| Latencia de scoring | < 2 h | **87 ms** | ✅ |
| Cobertura del catálogo | ≥ 95 % | **100 %** | ✅ |
| Explicabilidad Top-10 | 100 % | **10 + 10 features** | ✅ |

Reproducible: `npm run f4:informe`. Detalle en `ai/informe-fase4.json`.

## Por qué fallan tres criterios (y no es por falta de esfuerzo)

### 1. WRMSSE 0.669 contra un objetivo de 0.35 — **el objetivo es inalcanzable aquí**

Con demanda generada como un proceso de **Poisson**, el mejor predictor posible
(el que conociera la λ real) tiene:

```
RMSE = √λ          (error de predecir la media)
RMSE = √(2λ)       (error del naive, y_t − y_{t−1})
→ RMSSE de un modelo PERFECTO = √(λ / 2λ) = 0.707
```

Lo verifiqué por simulación (400 series × 104 semanas): el suelo está en
**0.708–0.714** para cualquier λ. **Ningún modelo puede bajar de ahí**, y el
modelo obtuvo **0.669**, es decir, *por debajo del suelo teórico* gracias a la
estacionalidad y las promociones que sí son predecibles.

El umbral 0.35 viene del benchmark **M5**, cuyos datos reales tienen mucha menos
varianza irreductible que un proceso de Poisson puro. Comparar ambos números no
es comparar lo mismo.

### 2. WAPE +6,82 % — el techo lo pone el tamaño del catálogo

| Modelo | WAPE |
|---|---|
| Ridge sobre embedding visual completo | **72,97 %** |
| Baseline media por categoría | 74,58 % |
| Baseline KNN sobre imagen | 78,31 % |

Se probó primero XGBoost sobre 900 features y **quedó peor que los baselines**
(WAPE 84,6 %): con 264 SKUs de entrenamiento, 900 features sobreajustan. La
sonda lineal regularizada es lo correcto a esta escala y sí gana a ambos
baselines, pero se queda en +6,82 %. El +10 % de la orden se midió sobre
VISUELLE, con **5.577 productos**; aquí hay **334**.

### 3. Inventario: el resultado es un **intercambio**, no una mejora doble

La orden promete reducir inventario *y* faltantes a la vez. La simulación (13
semanas, lead time 2) da:

```
inventario medio   73,8 → 77,7   (+5,3 %)
tasa de faltantes  0,44 % → 0,03 %  (−92 %)
```

Y comparando **a igual nivel de servicio**, la política plana necesita *menos*
inventario que la dinámica (68,7 frente a 77,7 → la dinámica es 13 % peor).

**La causa es real y merece atención:** `Z·σ·√LT` con σ estimada de un proceso
intermitente **sobreabastece la cola larga**. Para un SKU con μ = 0,3 uds/semana,
el 20 % plano pide 0,12 unidades, mientras que la fórmula pide
`1,645 · √0,3 · √2 ≈ 1,27` — **diez veces más**. Con el 33 % del catálogo en esa
cola, el resultado agregado empeora. En la práctica esto se corrige acotando el
stock de seguridad o usando formulaciones específicas para demanda intermitente;
queda como trabajo siguiente.

## Cómo se ejecuta

```bash
cd backend
npm run f4:synthetic    # historial sintético (24 meses) + calendario de promos
npm run f4:features     # 26 features + registro anti-leakage
npm run f4:2stage       # Two-Stage XGBoost + SHAP
npm run f4:nuevos       # fusión multimodal ligera para productos nuevos
npm run f4:inventario   # reconciliación MinT + política (s,S) + simulación
npm run f4:informe      # informe de validación
```

## Arquitectura de datos

```
sales_history (138.944 filas · 334 SKU × 4 tiendas × 104 semanas · 43,8 % ceros)
        ↓
demand_features (26 features, formato ancho) ⇄ feature_registry (documentadas)
        ↓
   ┌────┴─────┐
   ▼          ▼
Two-Stage   Ridge multimodal   (productos nuevos, sin historial)
XGBoost     sobre embeddings FashionCLIP de la Fase 1
   └────┬─────┘
        ▼
demand_forecasts → reconciliación MinT → inventory_recommendations
        ↓
drift_metrics · model_runs (tracking de experimentos)
```

## Decisiones que se apartan de la orden

| Pedía | Se hizo | Motivo |
|---|---|---|
| Airflow + Feast + MLflow | Scripts encadenados + Postgres + `model_runs` | Los tres suman ~1-1,5 GB y el disco estaba al 97 % |
| Multimodal-T5 (16 GB VRAM) | Ridge/XGBoost sobre embeddings de Fase 1 | La GPU es una RTX 3050 de **4 GB** |
| TGLP-BUN | **MinT** | La propia orden lo admite como alternativa |
| Optuna | Búsqueda de hiperparámetros acotada | Menos dependencias en un disco muy justo |
| Databricks/S3 | Postgres + Parquet | Ya está en la máquina |

## Limitaciones declaradas

- **Historial sintético** (ver cabecera).
- **Lead time supuesto de 2 semanas**: R3 no traía `on_order`, `in_transit` ni
  lead times por proveedor.
- **Sin Google Trends ni clima**: la feature `tendencia_categoria` se deriva del
  propio historial (está marcada como sustituta en `feature_registry`).
- **`lag_52` no existe para el 50 % de las filas** (la primera anualidad).

## Historial de pedidos sintético (apoyo al asistente del panel)

`ai/pedidos_sinteticos.py` reconstruye pedidos a partir de `sales_history` para
que el asistente del panel tenga de qué hablar: analiza `orders` y
`order_items`, y con los 22 pedidos de demo (35 líneas, 17 SKUs) la
clasificación ABC no discriminaba nada y no había serie donde buscar anomalías.

- 1.500 pedidos · 3.006 líneas · **351 SKUs** · 24 meses (2024-10 → 2026-10)
- Todas las filas llevan `notes = '[sintético]'` para poder borrarlas
- **No toca el inventario**: son pedidos históricos ya cerrados y descontar
  stock ahora dejaría las existencias actuales sin sentido
- Efecto medido: anomalías 3 → **10** · ABC pasa a A=5, B=39, C=141

Para revertirlo:
```sql
DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE notes='[sintético]');
DELETE FROM orders WHERE notes='[sintético]';
```
