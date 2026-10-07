/* ============================================================
   ADMINISTRACIÓN DE LA IA (dentro del panel de almacén)
   Tres bloques: métricas de rendimiento, base de conocimiento
   y reglas, y configuración. Consume /api/admin/ia/*.
   ============================================================ */
(function () {
  'use strict';
  const { esc, api, toast } = window.VM || {};
  const $ = (id) => document.getElementById(id);
  const num = (n, d = 2) => Number(n ?? 0).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });

  const ETIQUETA_TAG = {
    llm: 'Chat de Aria', rag: 'Asesor RAG', planner: 'Planificador',
    vision: 'Visión (atributos)', translate: 'Traducción', tag: 'Etiquetado',
    '(sin etiqueta)': 'Sin etiqueta',
  };
  const ETIQUETA_CAT = {
    regla: 'Regla del negocio', politica: 'Política', tono: 'Tono y estilo',
    faq: 'Pregunta frecuente', producto: 'Producto', operacion: 'Operación',
  };

  function kpi(t, v, s, color) {
    return `<div class="bg-surface-container-low rounded-xl p-space-md">
      <div class="font-label-sm text-label-sm font-bold uppercase text-on-surface-variant">${esc(t)}</div>
      <div class="text-xl font-extrabold ${color || ''}">${v}</div>
      <div class="font-label-sm text-label-sm text-on-surface-variant">${esc(s || '')}</div>
    </div>`;
  }

  // ── Métricas ─────────────────────────────────────────────────────
  async function cargarMetricas() {
    const dias = $('ia-dias').value;
    try {
      const m = await api(`/admin/ia/metricas?dias=${dias}`);
      const t = m.total;
      $('ia-kpis').innerHTML = [
        kpi('Llamadas', Number(t.llamadas).toLocaleString('es-ES'), `en ${dias} día(s)`),
        kpi('Coste', '$' + Number(t.coste).toFixed(4), `${num(t.tokens_entrada / 1000, 1)}k in / ${num(t.tokens_salida / 1000, 1)}k out`),
        kpi('Latencia', `${t.p50 ?? '—'} ms`, `p95 ${t.p95 ?? '—'} ms · media ${t.latencia_media ?? '—'}`),
        kpi('Errores', `${t.errores}`, `${num(t.tasa_error_pct, 1)} % de las llamadas`, t.errores ? 'text-error' : 'text-on-surface'),
        kpi('Caché de prompt', `${num(t.cache_pct, 1)} %`, `${Number(t.cache_hit).toLocaleString('es-ES')} tokens servidos de caché`),
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
        </div>`).join('') || '<p class="text-on-surface-variant py-2">Sin errores. 🎉</p>';
    } catch (e) {
      $('ia-kpis').innerHTML = `<p class="text-error col-span-full font-body-sm">No se pudieron cargar las métricas: ${esc(e.message)}</p>`;
    }
  }

  // ── Conocimiento ─────────────────────────────────────────────────
  async function cargarConocimiento() {
    try {
      const d = await api('/admin/ia/conocimiento');
      $('ia-nueva-cat').innerHTML = d.categorias
        .map((c) => `<option value="${c}">${esc(ETIQUETA_CAT[c] || c)}</option>`).join('');
      $('ia-conoc-lista').innerHTML = (d.items || []).map((i) => `
        <div class="rounded-xl border border-outline-variant px-3 py-2 ${i.active ? '' : 'opacity-50'}">
          <div class="flex items-start gap-2">
            <input type="checkbox" data-activo="${i.id}" ${i.active ? 'checked' : ''} class="mt-1"/>
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2 flex-wrap">
                <span class="font-label-sm text-label-sm font-bold uppercase text-primary">${esc(ETIQUETA_CAT[i.category] || i.category)}</span>
                <span class="font-body-sm text-body-sm font-bold">${esc(i.title)}</span>
                <span class="font-label-sm text-label-sm text-on-surface-variant">prioridad ${i.priority}</span>
              </div>
              <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(i.content)}</div>
            </div>
            <button data-borrar="${i.id}" class="material-symbols-outlined text-on-surface-variant hover:text-error text-lg">delete</button>
          </div>
        </div>`).join('') || '<p class="text-on-surface-variant font-body-sm">Sin entradas.</p>';
    } catch (e) {
      $('ia-conoc-lista').innerHTML = `<p class="text-error font-body-sm">Error: ${esc(e.message)}</p>`;
    }
  }

  async function crearConocimiento() {
    const cuerpo = {
      category: $('ia-nueva-cat').value,
      title: $('ia-nueva-titulo').value.trim(),
      content: $('ia-nueva-contenido').value.trim(),
      priority: Number($('ia-nueva-prio').value) || 100,
    };
    if (!cuerpo.title || !cuerpo.content) {
      $('ia-msg').textContent = 'Título y contenido son obligatorios.';
      return;
    }
    try {
      await api('/admin/ia/conocimiento', { method: 'POST', body: cuerpo });
      $('ia-nueva-titulo').value = ''; $('ia-nueva-contenido').value = '';
      $('ia-msg').textContent = '✓ Añadido. Aria lo usará en el próximo mensaje.';
      cargarConocimiento();
    } catch (e) {
      $('ia-msg').textContent = 'Error: ' + e.message;
    }
  }

  // ── Configuración ────────────────────────────────────────────────
  async function cargarAjustes() {
    try {
      const d = await api('/admin/ia/ajustes');
      const a = d.ajustes || {};
      $('ia-cfg-provider').value = a.llm_provider || '';
      $('ia-cfg-model').value = a.llm_model || '';
      $('ia-cfg-local').value = String(a.use_local_ai) === 'true' ? 'true' : 'false';
      $('ia-cfg-temp').value = a.temperature || '';
      $('ia-cfg-tokens').value = a.max_tokens_chat || '';

      const v = d.en_vigor || {};
      $('ia-cfg-estado').innerHTML = v.proveedor
        ? `En vigor: <b>${esc(v.etiqueta)}</b> · modelo <b>${esc(v.modelo)}</b> · embeddings en ${esc(v.url_embeddings)}`
        : `<b>Motor local de reglas</b> activo: no se está llamando a ningún LLM.`;
    } catch (e) {
      $('ia-cfg-estado').innerHTML = `<span class="text-error">Error: ${esc(e.message)}</span>`;
    }
  }

  async function guardarAjustes() {
    const cuerpo = {
      llm_provider: $('ia-cfg-provider').value,
      llm_model: $('ia-cfg-model').value.trim(),
      use_local_ai: $('ia-cfg-local').value,
      temperature: $('ia-cfg-temp').value,
      max_tokens_chat: $('ia-cfg-tokens').value,
    };
    try {
      await api('/admin/ia/ajustes', { method: 'PUT', body: cuerpo });
      $('ia-cfg-msg').textContent = '✓ Guardado y aplicado sin reiniciar.';
      cargarAjustes();
      cargarEstado();
    } catch (e) {
      $('ia-cfg-msg').textContent = 'Error: ' + e.message;
    }
  }

  async function cargarEstado() {
    try {
      const d = await api('/admin/ia/estado');
      const p = d.proveedor || {}, e = d.embeddings || {};
      const chip = $('ia-estado-chip');
      chip.textContent = (p.ok ? `IA: ${p.etiqueta}` : 'IA: motor local') + (e.ok ? ` · ${e.model?.split(':').pop() || 'embeddings'} OK` : ' · embeddings caídos');
      chip.className = 'font-label-sm text-label-sm font-bold px-2 py-1 rounded-full ' +
        (p.ok && e.ok ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900');
    } catch { /* noop */ }
  }

  function init() {
    if (!$('ia-panel')) return;
    cargarEstado(); cargarMetricas(); cargarConocimiento(); cargarAjustes();
    $('ia-dias').addEventListener('change', cargarMetricas);
    $('ia-crear').addEventListener('click', crearConocimiento);
    $('ia-guardar').addEventListener('click', guardarAjustes);

    // Activar/desactivar y borrar entradas de conocimiento
    $('ia-conoc-lista').addEventListener('change', async (ev) => {
      const id = ev.target.dataset.activo;
      if (!id) return;
      try { await api(`/admin/ia/conocimiento/${id}`, { method: 'PATCH', body: { active: ev.target.checked } }); cargarConocimiento(); }
      catch (e) { toast?.(e.message, 'error'); }
    });
    $('ia-conoc-lista').addEventListener('click', async (ev) => {
      const id = ev.target.closest('[data-borrar]')?.dataset.borrar;
      if (!id || !confirm('¿Borrar esta entrada?')) return;
      try { await api(`/admin/ia/conocimiento/${id}`, { method: 'DELETE' }); cargarConocimiento(); }
      catch (e) { toast?.(e.message, 'error'); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
