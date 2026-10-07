/* ============================================================
   MÉTRICAS DE RENDIMIENTO DE LA IA (panel de almacén)
   ------------------------------------------------------------
   La configuración de IA y la base de conocimiento se retiraron de aquí
   porque ya tienen su sitio en la pestaña "Asesor IA" (/hub-agente-ia).
   Este módulo se queda solo con la telemetría, que no está duplicada.
   Consume /api/admin/ia/metricas y /api/admin/ia/estado.
   ============================================================ */
(function () {
  'use strict';
  const { esc, api } = window.VM || {};
  const $ = (id) => document.getElementById(id);
  const num = (n, d = 2) => Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

  const ETIQUETA_TAG = {
    llm: 'Chat de Aria', rag: 'Asesor RAG', planner: 'Planificador',
    vision: 'Visión (atributos)', translate: 'Traducción', tag: 'Etiquetado',
    '(sin etiqueta)': 'Sin etiqueta',
  };

  function kpi(t, v, s, color) {
    return `<div class="bg-surface-container-low rounded-xl p-space-md">
      <div class="font-label-sm text-label-sm font-bold uppercase text-on-surface-variant">${esc(t)}</div>
      <div class="text-xl font-extrabold ${color || ''}">${v}</div>
      <div class="font-label-sm text-label-sm text-on-surface-variant">${esc(s || '')}</div>
    </div>`;
  }

  async function cargarMetricas() {
    const sel = $('ia-dias');
    if (!sel || !$('ia-kpis')) return;
    try {
      const m = await api(`/admin/ia/metricas?dias=${sel.value}`);
      const t = m.total;
      $('ia-kpis').innerHTML = [
        kpi('Llamadas', Number(t.llamadas).toLocaleString('es-ES'), `en ${sel.value} día(s)`),
        kpi('Coste', '$' + Number(t.coste).toFixed(4), `${num(t.tokens_entrada / 1000, 1)}k in / ${num(t.tokens_salida / 1000, 1)}k out`),
        kpi('Latencia', `${t.p50 ?? '—'} ms`, `p95 ${t.p95 ?? '—'} ms · media ${t.latencia_media ?? '—'}`),
        kpi('Errores', `${t.errores}`, `${num(t.tasa_error_pct, 1)} % de las llamadas`, t.errores ? 'text-error' : ''),
        kpi('Caché de prompt', `${num(t.cache_pct, 1)} %`, `${Number(t.cache_hit).toLocaleString('es-ES')} tokens de caché`),
      ].join('');

      $('ia-por-tag').innerHTML = (m.por_tag || []).map((x) => `
        <tr class="border-b border-surface-container last:border-0">
          <td class="py-1.5">${esc(ETIQUETA_TAG[x.tag] || x.tag)}</td>
          <td class="text-right">${x.llamadas}</td>
          <td class="text-right">$${Number(x.coste).toFixed(5)}</td>
          <td class="text-right">${x.p95 ?? '—'} ms</td>
          <td class="text-right ${x.errores ? 'text-error font-bold' : ''}">${x.errores}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="py-3 text-center text-on-surface-variant">Sin llamadas registradas todavía.</td></tr>';

      $('ia-errores').innerHTML = (m.errores || []).map((e) => `
        <div class="flex items-start gap-2 py-1.5 border-b border-surface-container last:border-0">
          <span class="material-symbols-outlined text-error text-base">error</span>
          <div><div class="font-bold">${e.veces}×</div><div class="text-on-surface-variant">${esc(String(e.error).slice(0, 120))}</div></div>
        </div>`).join('') || '<p class="text-on-surface-variant py-2">Sin errores.</p>';
    } catch (e) {
      const k = $('ia-kpis');
      if (k) k.innerHTML = `<p class="text-error col-span-full font-body-sm">No se pudieron cargar las métricas: ${esc(e.message)}</p>`;
    }
  }

  async function cargarEstado() {
    const chip = $('ia-estado-chip');
    if (!chip) return;
    try {
      const d = await api('/admin/ia/estado');
      const p = d.proveedor || {}, e = d.embeddings || {};
      chip.textContent = (p.ok ? `IA: ${p.etiqueta}` : 'IA: motor local') +
        (e.ok ? ` · ${String(e.model || 'embeddings').split(':').pop()} OK` : ' · embeddings caídos');
      chip.className = 'font-label-sm text-label-sm font-bold px-2 py-1 rounded-full ' +
        (p.ok && e.ok ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900');
    } catch { /* sin chip de estado */ }
  }

  function init() {
    if (!$('ia-panel')) return;
    cargarEstado();
    cargarMetricas();
    $('ia-dias')?.addEventListener('change', cargarMetricas);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
