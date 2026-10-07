// =====================================================================
// FASE 4 · API DEL PANEL DE DEMANDA E INVENTARIO
//
// La Fase 4 se entregó como scripts de Python y tablas, sin interfaz. Estas
// rutas exponen lo que ya está calculado en Postgres para poder revisarlo en
// el navegador: KPIs, forecast vs. real, recomendaciones de inventario y la
// explicabilidad SHAP.
//
// AVISO que viaja en todas las respuestas: el historial es SINTÉTICO.
// =====================================================================
import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
// Vive dentro del área de administración: el panel de almacén exige sesión de
// admin, así que los datos de demanda e inventario se protegen igual.
router.use(requireRole('admin'));

const AVISO = 'Historial SINTÉTICO (is_synthetic=TRUE en sales_history): las métricas validan el pipeline, no la demanda real.';

/** GET /api/demand/summary — KPIs, criterios de aceptación y estado de los datos. */
router.get('/summary', async (_req, res) => {
  try {
    const { rows: [datos] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM sales_history)::int AS filas_ventas,
        (SELECT MIN(week_start) FROM sales_history) AS desde,
        (SELECT MAX(week_start) FROM sales_history) AS hasta,
        (SELECT ROUND(100.0*COUNT(*) FILTER (WHERE units_sold=0)/COUNT(*),1) FROM sales_history)::float AS pct_ceros,
        (SELECT COUNT(DISTINCT sku||'|'||store_code) FROM sales_history)::int AS series,
        (SELECT COUNT(DISTINCT sku) FROM sales_history)::int AS skus,
        (SELECT COUNT(*) FROM feature_registry)::int AS features,
        (SELECT COUNT(*) FROM inventory_recommendations)::int AS recomendaciones,
        (SELECT COUNT(*) FROM demand_forecasts)::int AS forecasts,
        (SELECT COUNT(*) FROM promo_calendar WHERE is_synthetic)::int AS promos
    `);

    const { rows: runs } = await pool.query(`
      SELECT id, kind, metrics, notes, created_at
      FROM model_runs WHERE phase='4' ORDER BY created_at DESC
    `);

    // El informe de validación se recalcula desde los model_runs
    const met = {};
    for (const r of runs) Object.assign(met, r.metrics || {});

    const criterios = [
      { criterio: 'WRMSSE holdout ≤ 0.35', valor: met.wrmsse, cumple: met.wrmsse <= 0.35 },
      { criterio: 'Mejora WAPE productos nuevos ≥ 10 %', valor: met.mejor_mejora_pct, cumple: met.mejor_mejora_pct >= 10 },
      { criterio: 'Coherencia jerárquica < 1 %', valor: met.coherencia_mint_pct, cumple: met.coherencia_mint_pct < 1 },
      { criterio: 'Reducción de inventario −5..−15 %', valor: met.reduccion_inventario_pct, cumple: met.reduccion_inventario_pct >= 5 && met.reduccion_inventario_pct <= 15 },
      { criterio: 'Reducción de faltantes −15..−25 %', valor: met.reduccion_faltantes_pct, cumple: met.reduccion_faltantes_pct >= 15 && met.reduccion_faltantes_pct <= 25 },
      { criterio: 'Cobertura ≥ 95 %', valor: met.cobertura_pct, cumple: met.cobertura_pct >= 95 },
      { criterio: 'Latencia de scoring < 2 h', valor: met.ms_scoring_13sem, unidad: 'ms', cumple: met.ms_scoring_13sem < 7200000 },
    ];

    res.json({
      aviso: AVISO,
      datos,
      criterios,
      metricas: met,
      runs: runs.map((r) => ({ id: r.id, tipo: r.kind, cuando: r.created_at, notas: r.notes })),
    });
  } catch (err) {
    console.error('[demand/summary]', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/demand/skus — SKUs disponibles para el selector, con su volumen. */
router.get('/skus', async (req, res) => {
  try {
    const limite = Math.min(200, Number(req.query.limit) || 40);
    const { rows } = await pool.query(`
      SELECT s.sku, p.name, p.category,
             SUM(s.units_sold)::int AS unidades,
             COUNT(*) FILTER (WHERE s.units_sold = 0)::int AS semanas_sin_venta,
             COUNT(*)::int AS semanas
      FROM sales_history s
      JOIN products p ON p.sku = s.sku
      GROUP BY s.sku, p.name, p.category
      ORDER BY unidades DESC
      LIMIT $1
    `, [limite]);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/demand/series?sku=&store= — real vs. predicho semana a semana. */
router.get('/series', async (req, res) => {
  try {
    const { sku, store } = req.query;
    if (!sku) return res.status(400).json({ error: 'Falta el SKU' });

    const { rows: tiendas } = await pool.query(
      `SELECT DISTINCT store_code FROM sales_history WHERE sku=$1 ORDER BY store_code`, [sku]);
    const codigo = store || tiendas[0]?.store_code;
    if (!codigo) return res.status(404).json({ error: 'SKU sin historial' });

    const { rows } = await pool.query(`
      SELECT f.week_start, f.target_units AS real,
             d.units_point AS predicho, f.promo_flag, f.promo_depth
      FROM demand_features f
      LEFT JOIN demand_forecasts d
        ON d.sku = f.sku AND d.store_code = f.store_code AND d.week_start = f.week_start
      WHERE f.sku = $1 AND f.store_code = $2
      ORDER BY f.week_start
    `, [sku, codigo]);

    const conPred = rows.filter((r) => r.predicho !== null);
    const err = conPred.map((r) => Number(r.real) - Number(r.predicho));
    const mae = err.length ? err.reduce((a, b) => a + Math.abs(b), 0) / err.length : null;
    const sigma = err.length > 1
      ? Math.sqrt(err.reduce((a, b) => a + b * b, 0) / err.length) : null;

    res.json({
      sku, store: codigo,
      tiendas: tiendas.map((t) => t.store_code),
      serie: rows.map((r) => ({
        semana: r.week_start, real: Number(r.real),
        predicho: r.predicho === null ? null : Number(r.predicho),
        promo: r.promo_flag, descuento: Number(r.promo_depth || 0),
      })),
      metricas: { mae, sigma, semanas: rows.length, semanas_con_forecast: conPred.length },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/demand/inventory — recomendaciones, con la comparación de políticas. */
router.get('/inventory', async (req, res) => {
  try {
    const limite = Math.min(300, Number(req.query.limit) || 30);
    const { rows } = await pool.query(`
      SELECT r.sku, p.name, p.category, r.store_code,
             ROUND(r.avg_weekly_demand::numeric, 2)::float AS demanda_semanal,
             ROUND(r.sigma_error::numeric, 2)::float AS sigma,
             ROUND(r.safety_stock::numeric, 2)::float AS ss_dinamico,
             ROUND((0.20 * r.avg_weekly_demand * r.lead_time_weeks)::numeric, 2)::float AS ss_plano,
             ROUND(r.reorder_point::numeric, 2)::float AS punto_pedido,
             ROUND(r.order_up_to::numeric, 2)::float AS pedir_hasta,
             ROUND(r.eoq::numeric, 2)::float AS eoq,
             COALESCE((SELECT SUM(i.qty) FROM inventory i
                       JOIN product_variants v ON v.id = i.variant_id
                       JOIN stores st ON st.id = i.store_id
                       WHERE v.product_id = p.id AND st.code = r.store_code), 0)::int AS stock_actual
      FROM inventory_recommendations r
      JOIN products p ON p.sku = r.sku
      ORDER BY (r.safety_stock - 0.20 * r.avg_weekly_demand * r.lead_time_weeks) DESC
      LIMIT $1
    `, [limite]);

    const { rows: [resumen] } = await pool.query(`
      SELECT COUNT(*)::int AS total,
             ROUND(AVG(safety_stock)::numeric,2)::float AS ss_dinamico_medio,
             ROUND(AVG(0.20*avg_weekly_demand*lead_time_weeks)::numeric,2)::float AS ss_plano_medio,
             ROUND(AVG(sigma_error)::numeric,2)::float AS sigma_media
      FROM inventory_recommendations
    `);

    res.json({ items: rows, resumen });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/demand/explain — top-10 SHAP de ocurrencia y magnitud. */
router.get('/explain', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT metrics FROM model_runs WHERE phase='4' AND metrics ? 'top10_ocurrencia'
      ORDER BY created_at DESC LIMIT 1
    `);
    const m = rows[0]?.metrics || {};
    const aLista = (o) => Object.entries(o || {}).map(([feature, valor]) => ({ feature, valor }))
      .sort((x, y) => y.valor - x.valor);
    res.json({ ocurrencia: aLista(m.top10_ocurrencia), magnitud: aLista(m.top10_magnitud) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/demand/drift — PSI por feature (entrenamiento vs. reciente).
 * PSI < 0.10 estable · < 0.25 vigilar · >= 0.25 drift.
 *
 * OJO al leerlo: las features de CALENDARIO (semana_iso, mes, trimestre,
 * antiguedad_semanas) siempre salen con drift alto, porque comparar una
 * ventana de entrenamiento con otra posterior cambia de estación por
 * definición. El drift que importa es el de precio, descuento y tendencia.
 */
router.get('/drift', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT feature, kind, train_mean, prod_mean, psi, drift, created_at
      FROM drift_metrics WHERE kind = 'psi' ORDER BY psi DESC
    `);
    const calendario = ['semana_iso', 'mes', 'trimestre', 'antiguedad_semanas'];
    res.json({
      items: rows.map((r) => ({ ...r, es_calendario: calendario.includes(r.feature) })),
      resumen: {
        evaluadas: rows.length,
        con_drift: rows.filter((r) => r.drift).length,
        con_drift_real: rows.filter((r) => r.drift && !calendario.includes(r.feature)).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/demand/futuro — previsión de las próximas N semanas. */
router.get('/futuro', async (req, res) => {
  try {
    const semanas = Math.min(12, Number(req.query.semanas) || 12);
    const { rows } = await pool.query(`
      SELECT f.week_start, f.horizon,
             COUNT(*)::int AS series,
             ROUND(SUM(f.units_point)::numeric, 0)::float AS unidades,
             ROUND(AVG(f.p_occurrence)::numeric, 3)::float AS prob
      FROM demand_forecasts f
      WHERE f.run_id LIKE 'futuro-%' AND f.horizon <= $1
      GROUP BY f.week_start, f.horizon ORDER BY f.week_start
    `, [semanas]);

    const { rows: top } = await pool.query(`
      SELECT f.sku, p.name, SUM(f.units_point)::numeric(10,1)::float AS unidades
      FROM demand_forecasts f JOIN products p ON p.sku = f.sku
      WHERE f.run_id LIKE 'futuro-%' AND f.horizon <= $1
      GROUP BY f.sku, p.name ORDER BY unidades DESC LIMIT 10
    `, [semanas]);

    const { rows: [tot] } = await pool.query(`
      SELECT COUNT(*)::int AS predicciones, COUNT(DISTINCT sku)::int AS skus,
             MIN(week_start) AS desde, MAX(week_start) AS hasta
      FROM demand_forecasts WHERE run_id LIKE 'futuro-%'
    `);
    res.json({ semanas: rows, top, total: tot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/demand/proveedores — proveedores, lead times y compras.
 * Cubre el hueco R3 de la Fase 4: no había lead times por proveedor y el
 * stock de seguridad se calculó con un supuesto plano de 2 semanas.
 */
router.get('/proveedores', async (req, res) => {
  try {
    const { rows: proveedores } = await pool.query(`
      SELECT s.id, s.code, s.name, s.country, s.category_focus,
             s.lead_time_days, s.min_order_qty, s.payment_terms,
             s.reliability::float AS reliability,
             (SELECT COUNT(*) FROM products p
               WHERE p.supplier_id = s.id AND p.is_active)::int AS skus,
             (SELECT COUNT(*) FROM purchase_orders po
               WHERE po.supplier_id = s.id)::int AS pedidos,
             (SELECT COALESCE(ROUND(SUM(po.total)::numeric, 0), 0)
                FROM purchase_orders po WHERE po.supplier_id = s.id)::float AS valor,
             (SELECT ROUND(AVG(po.received_at - po.ordered_at)::numeric, 1)
                FROM purchase_orders po
               WHERE po.supplier_id = s.id AND po.received_at IS NOT NULL)::float AS dias_reales
      FROM suppliers s
      WHERE s.is_active
      ORDER BY valor DESC
    `);

    const { rows: porEstado } = await pool.query(`
      SELECT status, COUNT(*)::int AS pedidos, ROUND(SUM(total)::numeric,0)::float AS valor
      FROM purchase_orders GROUP BY status ORDER BY valor DESC
    `);

    const { rows: porMes } = await pool.query(`
      SELECT to_char(date_trunc('month', ordered_at), 'YYYY-MM') AS mes,
             COUNT(*)::int AS pedidos, ROUND(SUM(total)::numeric,0)::float AS valor
      FROM purchase_orders GROUP BY 1 ORDER BY 1
    `);

    const { rows: [tot] } = await pool.query(`
      SELECT COUNT(*)::int AS pedidos, COALESCE(SUM(total),0)::float AS valor,
             COALESCE(SUM(qty),0)::bigint AS unidades,
             ROUND(AVG(received_at - ordered_at)::numeric,1)::float AS lead_real
      FROM purchase_orders
    `);

    res.json({ proveedores, por_estado: porEstado, por_mes: porMes, total: tot });
  } catch (err) {
    console.error('[demand/proveedores]', err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/demand/promos — calendario de promociones del historial. */
router.get('/promos', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT week_start, name, depth::float AS profundidad, kind
      FROM promo_calendar WHERE is_synthetic ORDER BY week_start
    `);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
