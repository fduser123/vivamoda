/* ============================================================
   DEMANDA E INVENTARIO dentro del PANEL DE ADMINISTRACIÓN — Fase 4
   Consume /api/demand/* y dibuja KPIs, criterios, forecast vs
   real, explicabilidad SHAP y recomendaciones de inventario.
   ============================================================ */
(function () {
  'use strict';
    // Se resuelven en CADA llamada, no al evaluar el módulo: este script se
    // sirve ANTES que common.js, así que window.VM aún no existe aquí y un
    // destructuring dejaría esc en undefined para siempre (el catch también
    // fallaba, por eso la tabla quedaba vacía sin ningún mensaje).
    const esc = (v) => (window.VM?.esc ? window.VM.esc(v) : String(v ?? ''));
  const $ = (id) => document.getElementById(id);
  const P = 'dm-'; // prefijo de los ids dentro del panel de almacén
  const num = (n, d = 2) => Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
  let chartSerie = null, chartOc = null, chartMag = null;

  // Se usa VM.api para que viaje el token de admin: las rutas /api/demand/*
  // están detrás de requireRole('admin').
  const jget = async (url) => {
    if (!window.VM?.api) throw new Error('La página aún no ha cargado (VM.api no disponible)');
    return window.VM.api(url.replace(/^\/api/, ''));
  };

  function kpi(titulo, valor, sub, color) {
    return `<div class="bg-surface-container-lowest rounded-xl shadow-sm p-space-md">
      <div class="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">${esc(titulo)}</div>
      <div class="text-2xl font-extrabold kpi ${color || 'text-[#1c1b1d]'} mt-0.5">${valor}</div>
      <div class="text-[10px] text-gray-500 mt-0.5">${esc(sub || '')}</div>
    </div>`;
  }

  async function init() {
    const cont = $(P + 'kpis');
    try {
      const s = await jget('/api/demand/summary');
      pintarKPIs(s);
      pintarCriterios(s);
    } catch (e) {
      if (cont) cont.innerHTML = `<p class="text-sm text-primary col-span-full">Error cargando el resumen: ${esc(e.message)}</p>`;
    }
    try {
      const sk = await jget('/api/demand/skus?limit=60');
      const sel = $(P + 'sku');
      sel.innerHTML = sk.items.map((i) =>
        `<option value="${esc(i.sku)}">${esc(i.name).slice(0, 42)} — ${i.unidades} uds</option>`).join('');
      sel.addEventListener('change', () => cargarSerie(sel.value));
      if (sk.items.length) cargarSerie(sk.items[0].sku);
    } catch (e) {
      const sel = $(P + 'sku');
      if (sel) sel.innerHTML = `<option>Sin SKUs: ${esc(e.message)}</option>`;
    }

    // OJO: antes estos dos catch se tragaban el error con un /* noop */, así que
    // cualquier fallo dejaba la tabla y la gráfica VACÍAS sin ningún mensaje.
    // Ahora el motivo se escribe donde el usuario lo va a ver.
    try {
      pintarInventario(await jget('/api/demand/inventory?limit=25'));
    } catch (e) {
      const tb = $(P + 'inv-rows');
      if (tb) tb.innerHTML = `<tr><td colspan="8" class="py-3 text-center text-error">
        No se pudieron cargar las recomendaciones: <b>${esc(e.message)}</b>
        ${e.status === 401 || e.status === 403 ? '<br><span class="text-on-surface-variant">Necesitas sesión de administrador.</span>' : ''}
      </td></tr>`;
      const rs = $(P + 'inv-resumen');
      if (rs) rs.textContent = '';
    }

    try {
      pintarShap(await jget('/api/demand/explain'));
    } catch (e) {
      console.warn('[demanda] SHAP:', e.message);
    }
    cargarFuturo(); cargarDrift();
  }

  function pintarKPIs(s) {
    const d = s.datos || {};
    $(P + 'kpis').innerHTML = [
      kpi('Filas de historial', Number(d.filas_ventas).toLocaleString('es-ES'), `${d.desde} → ${d.hasta}`),
      kpi('Series SKU/tienda', Number(d.series).toLocaleString('es-ES'), `${d.skus} SKUs · 4 tiendas`),
      kpi('Semanas sin venta', `${d.pct_ceros} %`, 'demanda intermitente', 'text-[#b60055]'),
      kpi('Features registradas', d.features, `${d.promos} semanas con promo`),
      kpi('Recomendaciones', Number(d.recomendaciones).toLocaleString('es-ES'), `${Number(d.forecasts).toLocaleString('es-ES')} forecasts`),
    ].join('');
  }

  function pintarCriterios(s) {
    const u = (c) => (c.criterio.includes('Latencia') ? `${Math.round(c.valor)} ms` : num(c.valor, c.criterio.includes('Coherencia') ? 6 : 2));
    $(P + 'criterios').innerHTML = (s.criterios || []).map((c) => `
      <div class="flex items-center gap-2 text-[12px] py-1.5 border-b border-[#f6f2f5] last:border-0">
        <span class="material-symbols-outlined text-base ${c.cumple ? 'text-green-600' : 'text-[#b60055]'}">${c.cumple ? 'check_circle' : 'cancel'}</span>
        <span class="flex-1 ${c.cumple ? '' : 'text-gray-500'}">${esc(c.criterio)}</span>
        <span class="font-extrabold kpi ${c.cumple ? 'text-green-700' : 'text-[#b60055]'}">${u(c)}</span>
      </div>`).join('');
  }

  async function cargarSerie(sku) {
    try {
      const d = await jget(`/api/demand/series?sku=${encodeURIComponent(sku)}`);
      const etiquetas = d.serie.map((p) => String(p.semana).slice(0, 10));
      const real = d.serie.map((p) => p.real);
      const pred = d.serie.map((p) => p.predicho);
      const promos = d.serie.map((p) => (p.promo ? p.real : null));

      if (chartSerie) chartSerie.destroy();
      chartSerie = new Chart($(P + 'chart-serie'), {
        type: 'line',
        data: {
          labels: etiquetas,
          datasets: [
            { label: 'Real', data: real, borderColor: '#b60055', backgroundColor: 'rgba(182,0,85,.08)', borderWidth: 2, pointRadius: 0, tension: .25, fill: true },
            { label: 'Predicho', data: pred, borderColor: '#4b41e1', borderWidth: 2, borderDash: [5, 3], pointRadius: 0, tension: .25, spanGaps: false },
            { label: 'Semana con promo', data: promos, borderColor: 'transparent', backgroundColor: '#f0a832', pointRadius: 4, showLine: false },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { labels: { boxWidth: 12, font: { size: 10 } } } },
          scales: {
            x: { ticks: { maxTicksLimit: 10, font: { size: 9 } }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { font: { size: 9 } } },
          },
        },
      });
      const m = d.metricas;
      $(P + 'serie-meta').innerHTML = `Tienda <b>${esc(d.store)}</b> · ${m.semanas} semanas · ` +
        `<b>${m.semanas_con_forecast}</b> con forecast · MAE <b>${m.mae === null ? '—' : num(m.mae)}</b> · σ del error <b>${m.sigma === null ? '—' : num(m.sigma)}</b>`;
    } catch (e) {
      $(P + 'serie-meta').textContent = 'No se pudo cargar la serie: ' + e.message;
    }
  }

  function pintarInventario(d) {
    const r = d.resumen || {};
    $(P + 'inv-resumen').innerHTML = `${r.total} recomendaciones · SS dinámico medio <b>${num(r.ss_dinamico_medio)}</b> vs plano <b>${num(r.ss_plano_medio)}</b> · σ media ${num(r.sigma_media)}`;
    $(P + 'inv-rows').innerHTML = (d.items || []).map((x) => {
      const exceso = x.ss_dinamico - x.ss_plano;
      const color = exceso > 0 ? 'text-[#b60055]' : 'text-green-700';
      return `<tr class="border-b border-[#f6f2f5] last:border-0">
        <td class="py-2 pr-3"><div class="font-bold">${esc(String(x.name).slice(0, 34))}</div><div class="text-[10px] text-gray-400">${esc(x.sku)} · ${esc(x.category)}</div></td>
        <td class="text-gray-500">${esc(x.store_code)}</td>
        <td class="text-right kpi">${num(x.demanda_semanal)}</td>
        <td class="text-right kpi">${num(x.sigma)}</td>
        <td class="text-right kpi ${color} font-bold">${num(x.ss_dinamico)}</td>
        <td class="text-right kpi text-gray-500">${num(x.ss_plano)}</td>
        <td class="text-right kpi">${num(x.punto_pedido)}</td>
        <td class="text-right kpi">${Number(x.stock_actual).toLocaleString('es-ES')}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="py-3 text-center text-gray-400">Sin recomendaciones.</td></tr>';
  }

  function barras(canvas, items, color, titulo) {
    if (!items || !items.length) return null;
    return new Chart($(canvas), {
      type: 'bar',
      data: {
        labels: items.map((i) => i.feature),
        datasets: [{ label: titulo, data: items.map((i) => i.valor), backgroundColor: color, borderRadius: 4 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, title: { display: true, text: titulo, font: { size: 11 }, color: '#5c3f45' } },
        scales: {
          x: { ticks: { font: { size: 9 } } },
          y: { ticks: { font: { size: 10 } }, grid: { display: false } },
        },
      },
    });
  }

  function pintarShap(d) {
    if (chartOc) chartOc.destroy();
    if (chartMag) chartMag.destroy();
    chartOc = barras(P + 'chart-shap-oc', (d.ocurrencia || []).slice(0, 10), 'rgba(182,0,85,.75)', 'Etapa 1 · ¿habrá demanda? (|SHAP| medio)');
    chartMag = barras(P + 'chart-shap-mag', (d.magnitud || []).slice(0, 10), 'rgba(75,65,225,.75)', 'Etapa 2 · ¿cuánto se venderá? (|SHAP| medio)');
  }

  // El arranque espera a que common.js haya definido window.VM: sin esto el
  // módulo se ejecuta antes y no pinta nada (ni siquiera el mensaje de error).
  function arrancar(intentos = 0) {
    if (window.VM?.api) { init(); return; }
    if (intentos > 120) { console.error('[demanda] window.VM nunca apareció'); return; }
    setTimeout(() => arrancar(intentos + 1), 50);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => arrancar());
  else arrancar();
})();
