/* Panel de almacén y ventas en vivo (admin) */
(function () {
  const { api, fmtUSD, esc, toast, requireRole } = window.VM;

  let user = null;
  let rows = [];
  let statusFilter = 'all';
  let genderFilter = 'todos';
  let qFilter = '';
  let storeId = null;      // null = todas las tiendas en KPIs
  let abcBySku = new Map(); // clasificación ABC por SKU (IA)
  const PAGE_SIZES = [10, 15, 20];
  let page = 1;            // página actual de la tabla de inventario
  let pageSize = (() => {  // elementos por página (persiste entre visitas)
    try {
      const v = Number(localStorage.getItem('vm_admin_page_size'));
      return PAGE_SIZES.includes(v) ? v : 10;
    } catch { return 10; }
  })();
  let skuCountEl = null;   // contador "X–Y de N SKU" de la cabecera

  const $ = (id) => document.getElementById(id);

  function leaf(marker, exact = false) {
    return [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (exact ? el.textContent.trim() === marker : el.textContent.includes(marker)));
  }

  // ---------- tarjetas KPI ----------
  function kpiCard(title) {
    const t = leaf(title);
    if (!t) return null;
    return t.closest('div').parentElement; // header div → card root
  }
  function kpiValue(card, regex) {
    return [...card.querySelectorAll('*')].find((el) => el.children.length === 0 && regex.test(el.textContent.trim()));
  }

  async function loadStats() {
    try {
      const period = periodForUI();
      const prm = new URLSearchParams();
      if (storeId) prm.set('storeId', storeId);
      if (period) prm.set('period', period);
      const res = await api('/admin/stats' + (prm.toString() ? '?' + prm.toString() : ''));
      const st = { ...res, period };
      // Ingresos Totales
      let card = kpiCard('Ingresos Totales');
      if (card) {
        const v = kpiValue(card, /^\$/);
        if (v) v.textContent = fmtUSD(st.revenue, true);
        const trend = [...card.querySelectorAll('span')].find((s) => /trending_up|trending_down/.test(s.textContent) || /^[+-]\d/.test(s.textContent.trim()));
        const trendChip = trend?.closest('span') || trend;
        if (trendChip && st.revenueGrowth !== null) {
          trendChip.textContent = `${st.revenueGrowth >= 0 ? '+' : ''}${st.revenueGrowth}%`;
          const icon = trendChip.querySelector('.material-symbols-outlined');
          if (icon) icon.textContent = st.revenueGrowth >= 0 ? 'trending_up' : 'trending_down';
        }
      }
      // Pedidos Procesados
      card = kpiCard('Pedidos Procesados');
      if (card) {
        const v = kpiValue(card, /^[\d.,]+/);
        if (v) v.textContent = st.ordersProcessed.toLocaleString('es-CO');
        const chip = [...card.querySelectorAll('span')].find((s) => /^[+-]\d/.test(s.textContent.trim()));
        if (chip && st.ordersGrowth !== null) chip.textContent = `${st.ordersGrowth >= 0 ? '+' : ''}${st.ordersGrowth}%`;
      }
      // Unidades en Almacén
      card = kpiCard('Unidades en Almacén');
      if (card) {
        const v = kpiValue(card, /^[\d.,]+/);
        if (v) v.textContent = st.unitsInStock.toLocaleString('es-CO');
      }
      // Alertas Críticas
      card = kpiCard('Alertas Críticas');
      if (card) {
        const v = kpiValue(card, /^\d+\s*SKU/i);
        if (v) v.textContent = `${st.lowStockVariants + st.outOfStockVariants} SKU`;
        const out = [...card.querySelectorAll('*')].find((el) => el.children.length === 0 && /agotados? hoy/.test(el.textContent));
        if (out) out.textContent = `${st.outOfStockVariants} agotados hoy`;
      }
      // valuación en el pie de la tabla
      const val = leaf('Valuación total estimada en rack:');
      if (val) {
        const strong = val.closest('div')?.querySelector('strong');
        if (strong) strong.textContent = `${fmtUSD(st.valuation, true)}`;
      }
      // orden de compra sugerida
      const sugg = leaf('Se han pre-calculado');
      if (sugg) {
        const n = st.reorderSuggestions.length;
        sugg.textContent = `Se han pre-calculado ${n} pedido${n === 1 ? '' : 's'} a proveedores clave para mitigar quiebres de stock esta semana: ${st.reorderSuggestions.map((r) => `${r.sku} (${r.name})`).join(', ')}`;
      }
      paintAiWidget();
    } catch (err) {
      toast('Error en estadísticas: ' + err.message, 'error');
    }
  }
  function periodForUI() {
    const sel = $('period-selector');
    if (!sel) return '';
    const txt = sel.options[sel.selectedIndex]?.text || '';
    if (/Hoy/i.test(txt)) return 'today';
    if (/7/.test(txt)) return '7d';
    if (/Mes/i.test(txt)) return 'month';
    if (/Q2|Trimestre|quarter/i.test(txt)) return 'quarter';
    return '7d';
  }
  async function paintAiWidget() {
    try {
      const s = await api('/ai/stats');
      const assisted = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && /\$58,568\.50/.test(el.textContent));
      if (assisted) assisted.textContent = `${fmtUSD(s.assistedSales.revenue)} (${s.assistedSales.pct}%)`;
    } catch { /* widget sin datos */ }
  }

  // =============================================================
  // ASISTENTE IA DEL PANEL (predicción · ABC · anomalías · informe · chat SQL)
  // =============================================================
  function badgeABC(cls) {
    if (!cls) return '';
    const map = {
      A: ['A · Vital', 'bg-primary-fixed text-on-primary-fixed'],
      B: ['B · Importante', 'bg-secondary-fixed text-on-secondary-fixed'],
      C: ['C · Rutinario', 'bg-surface-container-high text-on-surface-variant'],
    }[cls];
    if (!map) return '';
    return `<span class="px-1.5 py-0.5 rounded-full font-label-sm text-label-sm font-bold ${map[1]}" title="Clasificación ABC por ingresos (90 días)">${map[0]}</span>`;
  }

  async function loadAiInsights() {
    const wrap = document.getElementById('vm-ai-insights');
    if (!wrap) return;
    try {
      const ins = await api('/admin/ai/insights' + (storeId ? `?storeId=${storeId}` : ''));
      abcBySku = new Map((ins.abc?.items || []).map((i) => [i.sku, i.class]));
      renderTable();

      // badge en la cabecera de la tarjeta
      const badge = document.getElementById('vm-ai-badge');
      if (badge) {
        const crit = ins.forecast?.alertsCount || 0;
        badge.innerHTML = `<span class="w-2 h-2 rounded-full ${crit ? 'bg-tertiary animate-pulse' : 'bg-emerald-500'}"></span>${crit} riesgo de quiebre`;
      }

      const riskChip = (risk) => {
        const m = { AGOTADO: 'bg-error-container text-error', CRITICO: 'bg-error-container text-error', ALTO: 'bg-tertiary-fixed text-on-tertiary-fixed', MEDIO: 'bg-secondary-fixed text-on-secondary-fixed', BAJO: 'bg-emerald-100 text-emerald-800' }[risk] || 'bg-surface-container-high text-on-surface-variant';
        return `<span class="px-2 py-0.5 rounded-full font-label-sm text-label-sm font-bold ${m}">${esc(risk)}</span>`;
      };
      const sevColor = { critical: '#ba1a1a', warning: '#9c3f00', info: '#4b41e1' };
      const sevIcon = { critical: 'error', warning: 'warning', info: 'trending_up' };

      // Tab 1 · Predicción de demanda
      const crit = ins.forecast?.critical || [];
      const restock = (ins.forecast?.items || []).filter((f) => f.risk !== 'AGOTADO' && f.risk !== 'CRITICO').sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999)).slice(0, 5);
      wrap.querySelector('#vm-ai-tab-forecast').innerHTML = crit.length || restock.length ? `
        ${crit.map((f) => `
          <div class="flex items-start justify-between gap-2 p-2 rounded-lg bg-surface-container">
            <div class="min-w-0">
              <div class="font-label-md text-label-md font-bold truncate">${esc(f.name)} <span class="text-on-surface-variant font-normal">· ${esc(f.size || '—')}</span></div>
              <div class="font-body-sm text-body-sm text-on-surface-variant">Ritmo ${f.velocityPerDay}/día · quedan ${f.stock} uds · quiebre estimado <b>${esc(f.stockoutDate || '—')}</b></div>
            </div>
            <div class="flex flex-col items-end gap-1 shrink-0">
              ${riskChip(f.risk)}
              <button class="vm-ai-restock px-2 py-1 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm font-bold" data-sku="${esc(f.sku)}" data-qty="${f.suggestedQty}" type="button">Pedir ${f.suggestedQty} uds</button>
            </div>
          </div>`).join('')}
        ${restock.length ? `<div class="font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-surface-variant pt-1">Siguiente ola a monitorear</div>` : ''}
        ${restock.map((f) => `
          <div class="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-surface-container">
            <div class="min-w-0">
              <div class="font-label-md text-label-md font-bold truncate">${esc(f.name)}</div>
              <div class="font-body-sm text-body-sm text-on-surface-variant">${f.daysLeft ?? '—'} días de cobertura · stock ${f.stock} uds</div>
            </div>
            ${riskChip(f.risk)}
          </div>`).join('')}`
        : '<div class="p-3 rounded-lg bg-emerald-50 text-emerald-800 font-body-sm text-body-sm">Sin riesgos de quiebre en el horizonte de 30 días. 🎉</div>';

      // Tab 2 · Anomalías
      const anomalies = ins.anomalies || [];
      wrap.querySelector('#vm-ai-tab-anomalies').innerHTML = anomalies.length ? anomalies.map((a) => `
        <div class="flex items-start gap-2 p-2 rounded-lg bg-surface-container">
          <span class="material-symbols-outlined text-base shrink-0" style="color:${sevColor[a.severity] || '#5c3f45'}">${sevIcon[a.severity] || 'info'}</span>
          <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(a.message)}</div>
        </div>`).join('')
        : '<div class="p-3 rounded-lg bg-emerald-50 text-emerald-800 font-body-sm text-body-sm">Operación estable: sin picos, caídas ni quiebres detectados.</div>';

      // Tab 3 · Clasificación ABC
      const abc = ins.abc;
      wrap.querySelector('#vm-ai-tab-abc').innerHTML = `
        <div class="flex items-center gap-2 pb-2">
          ${['A', 'B', 'C'].map((k) => `<span class="px-2 py-1 rounded-lg bg-surface-container font-label-sm text-label-sm font-bold">${k}: ${abc?.summary?.[k] ?? 0} SKU</span>`).join('')}
          <span class="font-body-sm text-body-sm text-on-surface-variant ml-auto">${fmtUSD(abc?.total || 0, true)} · 90 días</span>
        </div>
        ${(abc?.items || []).slice(0, 8).map((i) => `
          <div class="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-surface-container">
            <div class="min-w-0 font-label-md text-label-md font-bold truncate">${esc(i.name)}</div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="font-body-sm text-body-sm text-on-surface-variant">${fmtUSD(i.revenue, true)} · ${i.cumPct}% acum</span>
              ${badgeABC(i.class)}
            </div>
          </div>`).join('')}`;

      // acciones de reorden sugerida
      wrap.querySelectorAll('.vm-ai-restock').forEach((b) => b.addEventListener('click', () => {
        toast(`Orden de compra generada: ${b.dataset.qty} uds de ${b.dataset.sku} (demo)`, 'local_shipping');
      }));
    } catch (err) {
      wrap.querySelector('#vm-ai-tab-forecast').innerHTML = `<div class="p-3 rounded-lg bg-error-container text-error font-body-sm text-body-sm">IA no disponible: ${esc(err.message)}</div>`;
    }
  }

  // --- Tab 4 · Tendencias & Compras (IA #12) ---
  let strategyCache = null;

  function strategyChip(text, bg, color) {
    return `<span class="px-2 py-0.5 rounded-lg font-label-sm text-label-sm font-bold" style="background:${bg};color:${color}">${esc(text)}</span>`;
  }

  function renderStrategy(r) {
    const out = document.querySelector('#vm-ai-insights #vm-ai-tab-strategy');
    if (!out) return;
    const prioStyle = { alta: ['#ffdad6', '#b3261e'], media: ['#ffdfae', '#7a5900'], baja: ['#e8e7fd', '#3b34c8'] };
    const actIcon = { compra: 'shopping_cart', marketing: 'campaign', inventario: 'inventory_2', pricing: 'sell' };
    const prioLabel = { 1: 'Prioridad 1', 2: 'Prioridad 2', 3: 'Prioridad 3' };
    const cats = r.trends?.catTrends || [];
    const colors = r.trends?.colorTrends || [];
    out.innerHTML = `
      <div class="p-2.5 rounded-lg bg-surface-container flex flex-col gap-1.5">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-base" style="color:#b60055">insights</span>
          <span class="font-label-md text-label-md font-bold">Resumen estratégico</span>
          <button id="vm-strategy-refresh" class="ml-auto px-2 py-1 rounded-lg font-label-sm text-label-sm font-bold flex items-center gap-1" style="background:#4b41e1;color:#ffffff" type="button"><span class="material-symbols-outlined text-sm">refresh</span>Recalcular</button>
        </div>
        <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(r.summary)}</div>
        <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
          ${strategyChip(`Presupuesto ${fmtUSD(r.budget, true)}`, '#fceff6', '#b60055')}
          ${strategyChip(`Comprometido ${fmtUSD(r.budgetCommitted, true)}`, '#ecebff', '#4b41e1')}
          ${r.stuck?.skus ? strategyChip(`${r.stuck.skus} SKUs estancados · ${fmtUSD(r.stuck.capital, true)}`, '#fff3e0', '#9c3f00') : ''}
          <span class="font-body-sm text-body-sm text-on-surface-variant ml-auto">Ventana ${r.windowDays}d · ${r.engine === 'llm' ? 'LLM' : 'Análisis local'}</span>
        </div>
      </div>
      ${colors.length ? `
      <div class="p-2 rounded-lg bg-surface-container flex flex-col gap-1">
        <span class="font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">Colores que venden</span>
        <div class="flex flex-wrap gap-1">${colors.map((c) => strategyChip(`${c.color} · ${c.units} uds`, '#f6f2f5', '#5c3f45')).join('')}</div>
      </div>` : ''}
      ${cats.length ? `
      <div class="p-2 rounded-lg bg-surface-container flex flex-col gap-1">
        <span class="font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">Tendencia por categoría (${r.windowDays}d vs ${r.windowDays}d previos)</span>
        ${cats.slice(0, 6).map((c) => `
          <div class="flex items-center justify-between gap-2 py-0.5">
            <span class="font-label-md text-label-md font-bold truncate">${esc(c.category)}</span>
            <span class="flex items-center gap-1.5 shrink-0 font-body-sm text-body-sm text-on-surface-variant">${fmtUSD(c.revenueNow, true)}
              <b style="color:${c.deltaPct >= 0 ? '#1b6c3a' : '#b3261e'}">${c.deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(c.deltaPct)}%</b>
            </span>
          </div>`).join('')}
      </div>` : ''}
      <div class="flex flex-col gap-1">
        <span class="font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-surface-variant px-0.5">Plan de compra sugerido</span>
        ${(r.plan || []).map((p) => `
          <div class="p-2 rounded-lg bg-surface-container flex flex-col gap-0.5">
            <div class="flex items-center justify-between gap-2">
              <span class="font-label-md text-label-md font-bold truncate">${esc(p.category)} · ${p.qty} uds</span>
              <span class="flex items-center gap-1.5 shrink-0">
                ${strategyChip(fmtUSD(p.estCost, true), '#fceff6', '#b60055')}
                ${strategyChip(prioLabel[p.priority] || `P${p.priority}`, '#f6f2f5', '#5c3f45')}
              </span>
            </div>
            <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(p.reason)}</div>
          </div>`).join('') || '<div class="p-3 rounded-lg bg-surface-container font-body-sm text-body-sm text-on-surface-variant">Sin plan: no hay ventas suficientes en la ventana.</div>'}
      </div>
      <div class="flex flex-col gap-1">
        <span class="font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-surface-variant px-0.5">Acciones recomendadas</span>
        ${(r.actions || []).map((a) => {
          const [bg, fg] = prioStyle[a.priority] || prioStyle.media;
          return `
          <div class="flex items-start gap-2 p-2 rounded-lg bg-surface-container">
            <span class="material-symbols-outlined text-base shrink-0" style="color:#4b41e1">${actIcon[a.type] || 'lightbulb'}</span>
            <div class="min-w-0 flex flex-col gap-0.5">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-label-md text-label-md font-bold">${esc(a.title)}</span>
                ${strategyChip(String(a.priority).toUpperCase(), bg, fg)}
              </div>
              <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(a.detail)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    out.querySelector('#vm-strategy-refresh')?.addEventListener('click', () => {
      strategyCache = null;
      loadStrategyTab();
    });
  }

  async function loadStrategyTab() {
    const out = document.querySelector('#vm-ai-insights #vm-ai-tab-strategy');
    if (!out) return;
    if (strategyCache) { renderStrategy(strategyCache); return; }
    out.innerHTML = '<div class="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm p-2"><span class="material-symbols-outlined animate-spin text-base">progress_activity</span>Analizando tendencias y calculando plan de compras…</div>';
    try {
      const r = await api('/admin/ai/purchase-plan', { method: 'POST', body: {} });
      strategyCache = r;
      renderStrategy(r);
    } catch (err) {
      out.innerHTML = `<div class="p-3 rounded-lg bg-error-container text-error font-body-sm text-body-sm">IA no disponible: ${esc(err.message)}</div>`;
    }
  }

  // --- Tab 5 · Memoria de Aria (qué ha aprendido y control del cliente) ---
  let memoryCache = null;
  let memoryQuery = '';
  const SOURCE_BADGE = {
    chat: ['Conversación', 'bg-primary-fixed text-on-primary-fixed'],
    compras: ['Compras', 'bg-secondary-fixed text-on-secondary-fixed'],
    admin: ['Corregido', 'bg-emerald-100 text-emerald-800'],
  };

  async function loadMemoryTab(force = false) {
    const out = document.querySelector('#vm-ai-insights #vm-ai-tab-memory');
    if (!out) return;
    if (memoryCache && !force) { renderMemory(memoryCache); return; }
    out.innerHTML = '<div class="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm p-2"><span class="material-symbols-outlined animate-spin text-base">progress_activity</span>Revisando lo que Aria ha aprendido de cada cliente…</div>';
    try {
      memoryCache = await api('/admin/ai/memory');
      renderMemory(memoryCache);
    } catch (err) {
      out.innerHTML = `<div class="p-3 rounded-lg bg-error-container text-error font-body-sm text-body-sm">No pude leer la memoria de Aria: ${esc(err.message)}</div>`;
    }
  }

  function renderMemory(data) {
    const out = document.querySelector('#vm-ai-insights #vm-ai-tab-memory');
    if (!out) return;
    const s = data.summary || {};
    const fuentes = Object.entries(s.porFuente || {}).map(([k, v]) => `${(SOURCE_BADGE[k] || [k])[0]}: ${v}`).join(' · ');

    const head = `
      <div class="flex flex-wrap items-center gap-2 p-2 rounded-lg" style="background:#f6f2f5">
        <span class="font-label-md text-label-md font-bold">${s.hechos || 0} hechos aprendidos</span>
        <span class="font-label-sm text-label-sm text-on-surface-variant">· ${s.usuarios || 0} cliente(s) · ${s.sesiones || 0} sesión(es) anónima(s)${fuentes ? ` · ${esc(fuentes)}` : ''}</span>
        <input id="vm-ai-memory-q" placeholder="Filtrar por cliente, clave o valor…" value="${esc(memoryQuery)}" style="margin-left:auto;padding:6px 10px;border-radius:9px;border:1px solid #e5e1e4;font-size:12px;background:#fff;min-width:230px"/>
      </div>`;

    const owners = (data.owners || []).map((o) => `
      <div class="vm-ai-mem-owner p-3 rounded-xl bg-white border border-outline-variant flex flex-col gap-2" data-search="${esc((o.name + ' ' + (o.email || '') + ' ' + o.facts.map((f) => f.label + ' ' + f.value).join(' ')).toLowerCase())}">
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-base" style="color:${o.kind === 'user' ? '#b60055' : '#4b41e1'}">${o.kind === 'user' ? 'person' : 'incognito'}</span>
          <span class="font-label-md text-label-md font-bold">${esc(o.name)}</span>
          ${o.email ? `<span class="font-label-sm text-label-sm text-on-surface-variant">${esc(o.email)}</span>` : ''}
          ${o.vip ? `<span class="px-1.5 py-0.5 rounded-full font-label-sm text-label-sm font-bold bg-primary-fixed text-on-primary-fixed">${esc(o.vip)}</span>` : ''}
          <button class="vm-ai-mem-clear ml-auto font-label-sm text-label-sm px-2 py-1 rounded-lg bg-error-container text-error" data-kind="${o.kind}" data-owner="${esc(o.kind === 'user' ? String(o.id) : o.sessionKey)}" type="button">Olvidar todo</button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${o.facts.map((f) => `
            <span class="vm-ai-fact inline-flex items-center gap-1 px-2 py-1 rounded-lg" style="background:#f6f2f5" data-id="${f.id}" data-search="${esc((f.label + ' ' + f.value).toLowerCase())}">
              <b class="font-label-sm text-label-sm">${esc(f.label)}:</b>
              <span class="font-label-sm text-label-sm">${esc(f.value)}</span>
              <span class="px-1.5 rounded-full font-label-sm text-label-sm ${(SOURCE_BADGE[f.source] || [null, 'bg-surface-container-high text-on-surface-variant'])[1]}" title="Fuente: ${esc(f.source)} · confianza ${Math.round((f.confidence || 0) * 100)}% · ${f.hits} vez/veces vista">${esc((SOURCE_BADGE[f.source] || [f.source])[0])}</span>
              <button class="vm-ai-fact-edit material-symbols-outlined text-sm" data-id="${f.id}" data-value="${esc(f.value)}" title="Corregir este dato" type="button" style="color:#4b41e1;background:none;border:0;cursor:pointer">edit</button>
              <button class="vm-ai-fact-del material-symbols-outlined text-sm" data-id="${f.id}" title="Olvidar este dato" type="button" style="color:#ba1a1a;background:none;border:0;cursor:pointer">delete</button>
            </span>`).join('')}
        </div>
      </div>`).join('');

    const events = (data.events || []).length ? `
      <div class="p-3 rounded-xl" style="background:#f6f2f5">
        <div class="flex items-center gap-1 mb-1">
          <span class="material-symbols-outlined text-base" style="color:#b60055">touch_app</span>
          <span class="font-label-md text-label-md font-bold">Interés reciente</span>
          <span class="font-label-sm text-label-sm text-on-surface-variant">· estos clics suben la prenda en las próximas recomendaciones</span>
        </div>
        <div class="flex flex-wrap gap-1.5">${data.events.map((e) => `<span class="px-2 py-1 rounded-lg bg-white border border-outline-variant font-label-sm text-label-sm">${esc(e.name || e.sku)} · <b>${esc(e.event)}</b> ×${e.veces}</span>`).join('')}</div>
      </div>` : '';

    out.innerHTML = head + (owners || '<div class="font-body-sm text-body-sm text-on-surface-variant p-2">Aria aún no ha aprendido nada de nadie: los hechos aparecen cuando los clientes escriben en el chat.</div>') + events;
    wireMemoryActions();
  }

  function wireMemoryActions() {
    const out = document.querySelector('#vm-ai-insights #vm-ai-tab-memory');
    if (!out) return;
    const refresh = async (msg) => {
      memoryCache = null;
      await loadMemoryTab(true);
      if (msg) toast(msg, 'check_circle');
    };

    // Filtro instantáneo (cliente): muestra u oculta dueños y hechos
    out.querySelector('#vm-ai-memory-q')?.addEventListener('input', (e) => {
      memoryQuery = e.target.value.trim().toLowerCase();
      out.querySelectorAll('.vm-ai-mem-owner').forEach((card) => {
        const hits = (card.dataset.search || '').includes(memoryQuery);
        card.style.display = hits ? 'flex' : 'none';
        card.querySelectorAll('.vm-ai-fact').forEach((f) => {
          f.style.display = !memoryQuery || (f.dataset.search || '').includes(memoryQuery) || hits ? 'inline-flex' : 'none';
        });
      });
    });

    // Olvidar un hecho
    out.querySelectorAll('.vm-ai-fact-del').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await api(`/admin/ai/memory/${b.dataset.id}`, { method: 'DELETE' });
        await refresh('Hecho olvidado');
      } catch (err) {
        b.disabled = false;
        toast(err.message, 'error');
      }
    }));

    // Corregir un hecho en línea
    out.querySelectorAll('.vm-ai-fact-edit').forEach((b) => b.addEventListener('click', () => {
      const chip = b.closest('.vm-ai-fact');
      if (!chip || chip.querySelector('.vm-ai-edit-input')) return;
      chip.innerHTML = `<input class="vm-ai-edit-input" value="${esc(b.dataset.value)}" style="width:110px;padding:3px 6px;border-radius:7px;border:1px solid #b60055;font-size:11px"/>` +
        '<button class="vm-ai-edit-save material-symbols-outlined text-sm" type="button" style="color:#0a7d43;background:none;border:0;cursor:pointer">check</button>';
      const input = chip.querySelector('.vm-ai-edit-input');
      input.focus();
      input.select();
      const save = async () => {
        const value = input.value.trim();
        if (!value) return;
        try {
          await api(`/admin/ai/memory/${b.dataset.id}`, { method: 'PATCH', body: { value } });
          await refresh('Memoria corregida');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
      chip.querySelector('.vm-ai-edit-save').addEventListener('click', save);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    }));

    // Olvidar todo lo de un cliente
    out.querySelectorAll('.vm-ai-mem-clear').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm('¿Borrar todo lo que Aria aprendió de este cliente?')) return;
      b.disabled = true;
      try {
        const r = await api('/admin/ai/memory', { method: 'DELETE', body: { kind: b.dataset.kind, id: b.dataset.owner } });
        await refresh(`${r.deleted} hecho(s) olvidado(s)`);
      } catch (err) {
        b.disabled = false;
        toast(err.message, 'error');
      }
    }));
  }

  function wireInsightsTabs() {
    const wrap = document.getElementById('vm-ai-insights');
    if (!wrap) return;
    const show = (id) => {
      for (const t of ['forecast', 'anomalies', 'abc', 'strategy', 'memory']) {
        wrap.querySelector(`#vm-ai-tab-${t}`).style.display = t === id ? 'flex' : 'none';
        const btn = wrap.querySelector(`.vm-ai-tab[data-tab="${t}"]`);
        btn.classList.toggle('bg-white', t === id);
        btn.classList.toggle('text-on-surface', t === id);
        btn.classList.toggle('shadow-sm', t === id);
        btn.classList.toggle('text-on-surface-variant', t !== id);
      }
    };
    wrap.querySelectorAll('.vm-ai-tab').forEach((b) => b.addEventListener('click', () => {
      show(b.dataset.tab);
      if (b.dataset.tab === 'strategy') loadStrategyTab();
      if (b.dataset.tab === 'memory') loadMemoryTab();
    }));
    show('forecast');
  }

  // --- Informe ejecutivo ---
  function mdToHtml(md) {
    return esc(md)
      .split('\n')
      .map((l) => {
        const t = l.trim();
        if (!t) return '';
        if (t.startsWith('- ')) return `<div style="display:flex;gap:6px;margin:2px 0"><span style="color:#b60055;font-weight:800">•</span><span>${t.slice(2).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</span></div>`;
        return `<div style="margin:${t.startsWith('**') ? '8px' : '2px'} 0">${t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</div>`;
      })
      .join('');
  }

  async function generateReport() {
    const btn = document.getElementById('vm-ai-report-btn');
    const out = document.getElementById('vm-ai-report-out');
    if (!btn || !out) return;
    btn.disabled = true;
    btn.textContent = 'Analizando…';
    out.style.display = 'block';
    out.innerHTML = '<div class="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm p-2"><span class="material-symbols-outlined animate-spin text-base">progress_activity</span>Analizando ventas, inventario y anomalías…</div>';
    try {
      const sel = $('period-selector');
      const period = periodForUI() || '7d';
      const r = await api('/admin/ai/report', { method: 'POST', body: { storeId: storeId || undefined, period } });
      const engineLabel = r.engine === 'llm' ? `LLM · ${esc(r.model || '')}` : 'Analista local (reglas)';
      out.innerHTML = `
        <div style="font-size:13px;line-height:1.55;color:#1c1b1d">${mdToHtml(r.report)}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:11px;color:#5c3f45">
          <span class="material-symbols-outlined" style="font-size:14px">auto_awesome</span>Motor: ${engineLabel} · ${esc(period)}
        </div>`;
    } catch (err) {
      out.innerHTML = `<div style="padding:8px;border-radius:10px;background:#ffdad6;color:#93000a;font-size:12px">No se pudo generar el informe: ${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generar Informe IA';
    }
  }

  // --- Chat text-to-SQL ---
  function askRowsTable(rowsIn) {
    if (!rowsIn?.length) return '<i>Sin filas.</i>';
    const cols = Object.keys(rowsIn[0]);
    return `<div style="max-height:220px;overflow:auto;margin-top:6px;border:1px solid #e5e1e4;border-radius:10px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr>${cols.map((c) => `<th style="text-align:left;padding:6px 8px;background:#f6f2f5;position:sticky;top:0">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rowsIn.map((rw) => `<tr>${cols.map((c) => `<td style="padding:5px 8px;border-top:1px solid #e5e1e4">${esc(rw[c] == null ? '—' : String(rw[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>`;
  }

  async function sendAiQuestion() {
    const input = document.getElementById('vm-ai-q');
    const out = document.getElementById('vm-ai-ask-out');
    const q = (input?.value || '').trim();
    if (!q) return toast('Escribe una pregunta para tus datos', 'error');
    out.innerHTML = '<div class="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm p-2"><span class="material-symbols-outlined animate-spin text-base">progress_activity</span>Traduciendo a SQL y consultando…</div>';
    try {
      const r = await api('/admin/ai/ask', { method: 'POST', body: { question: q } });
      const chips = [
        `<span class="px-2 py-0.5 rounded-full bg-surface-container font-label-sm text-label-sm font-bold">Motor: ${esc(r.engine)}</span>`,
        `<span class="px-2 py-0.5 rounded-full bg-surface-container font-label-sm text-label-sm font-bold">${r.rowCount} filas</span>`,
        `<span class="px-2 py-0.5 rounded-full bg-surface-container font-label-sm text-label-sm font-bold">${r.latencyMs} ms</span>`,
      ].join(' ');
      out.innerHTML = `
        <div style="font-size:12px;color:#5c3f45">Pregunta: <b style="color:#1c1b1d">${esc(r.question)}</b></div>
        <details style="margin-top:6px">
          <summary style="cursor:pointer;font-size:11px;color:#4b41e1;font-weight:700">Ver SQL ejecutado (solo lectura)</summary>
          <pre style="margin:4px 0 0;padding:8px;background:#1c1b1d;color:#d9f2e6;border-radius:8px;font-size:11px;overflow:auto;white-space:pre-wrap">${esc(r.sql)}</pre>
        </details>
        ${r.note ? `<div style="margin-top:6px;font-size:11px;color:#9c3f00">⚠ ${esc(r.note)}</div>` : ''}
        ${askRowsTable(r.rows)}
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${chips}</div>`;
    } catch (err) {
      out.innerHTML = `<div style="padding:8px;border-radius:10px;background:#ffdad6;color:#93000a;font-size:12px">${esc(err.message)}</div>`;
    }
  }

  function wireAiAsk() {
    const btn = document.getElementById('vm-ai-ask-btn');
    const input = document.getElementById('vm-ai-q');
    if (btn) btn.addEventListener('click', sendAiQuestion);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendAiQuestion(); });
    document.querySelectorAll('.vm-ai-chip-q').forEach((c) => c.addEventListener('click', () => {
      const input2 = document.getElementById('vm-ai-q');
      if (input2) input2.value = c.textContent.trim();
      sendAiQuestion();
    }));
    const reportBtn = document.getElementById('vm-ai-report-btn');
    if (reportBtn) reportBtn.addEventListener('click', generateReport);
    const exportBtn = document.getElementById('vm-ai-report-export');
    if (exportBtn) exportBtn.addEventListener('click', () => {
      const out = document.getElementById('vm-ai-report-out');
      if (!out?.innerText?.trim()) return toast('Genera primero el informe', 'error');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + out.innerText], { type: 'text/plain;charset=utf-8' }));
      a.download = 'informe-ia-vivamoda.txt';
      a.click();
      toast('Informe exportado', 'download');
    });
  }

  function injectAiSection() {
    if (document.getElementById('vm-ai-section')) return;
    const anchor = [...document.querySelectorAll('p')].find((p) => p.textContent.includes('Se han pre-calculado'));
    // Anclar ANTES de la tarjeta "Orden de Compra Automática" (no dentro de ella)
    const host = anchor?.closest('section') || anchor?.closest('.bg-surface-container-lowest') || anchor?.closest('div');
    if (!host || !host.parentElement) return;
    const sec = document.createElement('section');
    sec.id = 'vm-ai-section';
    sec.className = 'xl:col-span-8 flex flex-col gap-space-md bg-surface-container-lowest p-space-lg rounded-xl shadow-sm overflow-hidden';
    sec.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <div class="w-9 h-9 rounded-xl flex items-center justify-center" style="background:linear-gradient(135deg,#b60055,#4b41e1)"><span class="material-symbols-outlined text-white text-lg">auto_awesome</span></div>
          <div class="flex flex-col">
            <h3 class="font-headline-sm text-headline-sm font-bold leading-tight">Asistente IA del Panel</h3>
            <span id="vm-ai-badge" class="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant"><span class="w-2 h-2 rounded-full bg-emerald-500"></span>Cargando insights…</span>
          </div>
        </div>
        <button id="vm-ai-report-btn" class="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-bold hover:opacity-90 transition-opacity flex items-center gap-1" type="button"><span class="material-symbols-outlined text-base">description</span>Generar Informe IA</button>
      </div>
      <div id="vm-ai-report-out" style="display:none"></div>
      <div id="vm-ai-insights" class="flex flex-col gap-2">
        <div class="flex items-center gap-1 p-1 bg-surface-container-low rounded-xl">
          <button class="vm-ai-tab flex-1 px-2 py-1.5 rounded-lg font-label-sm text-label-sm font-bold text-on-surface-variant flex items-center justify-center gap-1" data-tab="forecast" type="button"><span class="material-symbols-outlined text-base">insights</span>Predicción de demanda</button>
          <button class="vm-ai-tab flex-1 px-2 py-1.5 rounded-lg font-label-sm text-label-sm font-bold text-on-surface-variant flex items-center justify-center gap-1" data-tab="anomalies" type="button"><span class="material-symbols-outlined text-base">troubleshoot</span>Anomalías</button>
          <button class="vm-ai-tab flex-1 px-2 py-1.5 rounded-lg font-label-sm text-label-sm font-bold text-on-surface-variant flex items-center justify-center gap-1" data-tab="abc" type="button"><span class="material-symbols-outlined text-base">domain_verification</span>Clasificación ABC</button>
          <button class="vm-ai-tab flex-1 px-2 py-1.5 rounded-lg font-label-sm text-label-sm font-bold text-on-surface-variant flex items-center justify-center gap-1" data-tab="strategy" type="button"><span class="material-symbols-outlined text-base">shopping_cart_checkout</span>Tendencias & Compras</button>
          <button class="vm-ai-tab flex-1 px-2 py-1.5 rounded-lg font-label-sm text-label-sm font-bold text-on-surface-variant flex items-center justify-center gap-1" data-tab="memory" type="button"><span class="material-symbols-outlined text-base">psychology</span>Memoria de Aria</button>
        </div>
        <div id="vm-ai-tab-forecast" class="flex-col gap-1.5 max-h-64 overflow-y-auto"></div>
        <div id="vm-ai-tab-anomalies" class="flex-col gap-1.5 max-h-64 overflow-y-auto" style="display:none"></div>
        <div id="vm-ai-tab-abc" class="flex-col gap-1.5 max-h-64 overflow-y-auto" style="display:none"></div>
        <div id="vm-ai-tab-strategy" class="flex-col gap-1.5 max-h-80 overflow-y-auto" style="display:none"></div>
        <div id="vm-ai-tab-memory" class="flex-col gap-1.5 max-h-80 overflow-y-auto" style="display:none"></div>
      </div>
      <div class="flex flex-col gap-2 p-3 rounded-xl" style="background:#f6f2f5">
        <div class="flex items-center gap-1">
          <span class="material-symbols-outlined text-base text-secondary">database</span>
          <span class="font-label-md text-label-md font-bold">Pregunta a tus datos</span>
          <span class="font-label-sm text-label-sm text-on-surface-variant">· text-to-SQL de solo lectura</span>
        </div>
        <div class="flex flex-wrap gap-1">
          ${['¿Cuáles son los productos más vendidos?', '¿Qué productos tienen menos stock?', '¿Quiénes son los mejores clientes?'].map((t) => `<button class="vm-ai-chip-q px-2 py-1 rounded-lg bg-white border border-outline-variant font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface" type="button">${t}</button>`).join('')}
        </div>
        <div class="flex gap-2">
          <input id="vm-ai-q" placeholder="Ej. ¿Cuáles fueron las ventas de este mes?" style="flex:1;padding:9px 12px;border-radius:10px;border:1px solid #e5e1e4;font-size:13px;background:#fff"/>
          <button id="vm-ai-ask-btn" class="px-4 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md font-bold hover:opacity-90 flex items-center gap-1" type="button"><span class="material-symbols-outlined text-base">send</span>Preguntar</button>
        </div>
        <div class="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant"><span class="material-symbols-outlined text-sm" style="color:#4b41e1">shield</span>Datos personales de clientes protegidos: consultas bloqueadas y resultados enmascarados automáticamente.</div>
        <div id="vm-ai-ask-out"></div>
      </div>`;
    host.parentElement.insertBefore(sec, host);

    wireInsightsTabs();
    wireAiAsk();
    loadAiInsights();
  }

  // ---------- tabla de inventario ----------
  function tbody() {
    return document.querySelector('main table tbody') || null;
  }
  const estadoChip = (e) => ({
    'En Stock': 'bg-emerald-100 text-emerald-800',
    'Stock Bajo': 'bg-tertiary-fixed text-on-tertiary-fixed',
    'Sin Stock': 'bg-error-container text-error',
  }[e] || 'bg-surface-container-high text-on-surface-variant');
  async function loadRows() {
    try {
      const res = await api(`/admin/products${storeId ? `?storeId=${storeId}` : ''}`);
      rows = res.items;
      renderTable();
    } catch (err) {
      toast('Error cargando inventario: ' + err.message, 'error');
    }
  }
  function filtered() {
    return rows.filter((r) => {
      if (statusFilter === 'in-stock' && r.estado !== 'En Stock') return false;
      if (statusFilter === 'low' && r.estado !== 'Stock Bajo') return false;
      if (statusFilter === 'out' && r.estado !== 'Sin Stock') return false;
      if (genderFilter !== 'todos') {
        const isGender = r.gender === genderFilter;
        const isCat = genderFilter === 'calzado' ? r.category === 'Calzado' : genderFilter === 'accesorios' ? r.category === 'Accesorios' : false;
        if (!isGender && !isCat) return false;
      }
      if (qFilter && !`${r.name} ${r.sku} ${r.size} ${r.color} ${r.category}`.toLowerCase().includes(qFilter)) return false;
      return true;
    });
  }
  // ---------- paginación de la tabla ----------
  function pageSlice(list) {
    const tp = Math.max(1, Math.ceil(list.length / pageSize));
    if (page > tp) page = tp;
    if (page < 1) page = 1;
    const from = (page - 1) * pageSize;
    return { slice: list.slice(from, from + pageSize), from, tp };
  }
  function pageNumbers(cur, tp) {
    const out = [];
    for (let p = 1; p <= tp; p++) {
      if (p === 1 || p === tp || Math.abs(p - cur) <= 1) out.push(p);
      else if (out[out.length - 1] !== '…') out.push('…');
    }
    return out;
  }
  function paintSkuCount(total, from, to) {
    if (skuCountEl) skuCountEl.textContent = total ? `${from}–${to} de ${total} SKU` : '0 de 0 SKU';
  }
  function scrollTableTop() {
    const sec = document.querySelector('main table')?.closest('section');
    if (!sec) return;
    const header = document.querySelector('body > header') || document.querySelector('header');
    const h = header?.getBoundingClientRect().height || 0;
    window.scrollTo({ top: Math.max(0, window.scrollY + sec.getBoundingClientRect().top - h - 16), behavior: 'smooth' });
  }
  function renderPagination(total, from, shown, tp) {
    let host = document.getElementById('vm-pagination');
    if (!host) {
      const table = document.querySelector('main table');
      if (!table) return;
      host = document.createElement('div');
      host.id = 'vm-pagination';
      host.className = 'flex flex-col sm:flex-row items-center justify-between gap-space-sm pt-space-sm mt-space-xs';
      table.parentElement.insertAdjacentElement('afterend', host);
    }
    if (tp <= 1) { host.style.display = 'none'; return; }
    host.style.display = '';
    const base = 'min-w-8 h-8 px-2 rounded-lg font-label-sm text-label-sm font-bold transition-all flex items-center justify-center';
    const off = 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface';
    const on = 'bg-primary text-on-primary shadow-sm';
    const nav = (target, icon, disabled, title) => `<button class="vm-page-btn ${base} ${disabled ? 'bg-surface-container text-on-surface-variant/40 cursor-not-allowed' : off}" data-page="${target}" title="${title}" type="button" ${disabled ? 'disabled' : ''}><span class="material-symbols-outlined text-base">${icon}</span></button>`;
    host.innerHTML = `
      <div class="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
        <span class="material-symbols-outlined text-base">view_list</span>
        <span>Página <strong class="text-on-surface font-bold">${page}</strong> de <strong class="text-on-surface font-bold">${tp}</strong> · ${total ? from + 1 : 0}–${from + shown} de ${total} SKU</span>
      </div>
      <div class="flex items-center gap-1">
        ${nav(1, 'first_page', page === 1, 'Primera')}
        ${nav(page - 1, 'chevron_left', page === 1, 'Anterior')}
        ${pageNumbers(page, tp).map((p) => p === '…' ? '<span class="px-1 font-label-sm text-label-sm text-on-surface-variant">…</span>' : `<button class="vm-page-btn ${base} ${p === page ? on : off}" data-page="${p}" title="Página ${p}" type="button" ${p === page ? 'aria-current="page"' : ''}>${p}</button>`).join('')}
        ${nav(page + 1, 'chevron_right', page === tp, 'Siguiente')}
        ${nav(tp, 'last_page', page === tp, 'Última')}
      </div>`;
    host.querySelectorAll('.vm-page-btn').forEach((b) => b.addEventListener('click', () => {
      const p = Number(b.dataset.page);
      if (!p || p === page || b.disabled) return;
      page = p;
      renderTable();
      scrollTableTop();
    }));
  }
  function renderTable() {
    const tb = tbody();
    if (!tb) return;
    const list = filtered();
    const { slice, from, tp } = pageSlice(list);
    tb.innerHTML = slice.length ? slice.map((r) => `
      <tr class="border-b border-surface-container-high/60 hover:bg-surface-container-low/60 transition-colors">
        <td class="py-space-sm px-space-sm">
          <div class="flex items-center gap-2">
            <div class="w-9 h-9 rounded-lg overflow-hidden bg-surface-container flex items-center justify-center shrink-0" style="${r.image ? '' : 'background:linear-gradient(135deg,#f6f2f5,#e5e1e4)'}">
              ${r.image ? `<img class="w-full h-full object-cover" src="${esc(r.image)}" alt=""/>` : `<span class="material-symbols-outlined text-[16px] text-on-surface-variant">checkroom</span>`}
            </div>
            <div class="flex flex-col min-w-0">
              <span class="font-label-md text-label-md text-on-surface font-bold truncate max-w-[220px]">${esc(r.name)}</span>
              <span class="font-label-sm text-label-sm text-on-surface-variant">${esc(r.sku)}${r.visibility === 'ops' ? ' · ops' : ''}</span>
            </div>
            ${badgeABC(abcBySku.get(r.sku))}
          </div>
        </td>
        <td class="py-space-sm px-space-sm font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">${esc(r.category)} · ${esc(r.gender)}</td>
        <td class="py-space-sm px-space-sm"><span class="px-2 py-0.5 rounded-md bg-surface-container font-label-sm text-label-sm font-bold">${esc(r.size)}</span> <span class="font-body-sm text-body-sm text-on-surface-variant">${esc(r.color)}</span></td>
        <td class="py-space-sm px-space-sm font-label-lg text-label-lg font-bold">${r.qty}</td>
        <td class="py-space-sm px-space-sm font-body-sm text-body-sm text-on-surface-variant">${r.reorderPoint}</td>
        <td class="py-space-sm px-space-sm font-label-md text-label-md font-bold whitespace-nowrap">${fmtUSD(r.price)}</td>
        <td class="py-space-sm px-space-sm font-body-sm text-body-sm text-on-surface-variant">${r.marginPct}%</td>
        <td class="py-space-sm px-space-sm"><span class="px-2 py-0.5 rounded-full font-label-sm text-label-sm font-bold ${estadoChip(r.estado)}">${esc(r.estado)}</span></td>
        <td class="py-space-sm px-space-sm">
          <div class="flex items-center gap-1">
            <button class="stock-edit w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant" data-variant="${r.variantId}" data-store="${storeId || ''}" data-name="${esc(r.name)} ${esc(r.size)}" data-qty="${r.qty}" data-reorder="${r.reorderPoint}" title="Editar stock" type="button"><span class="material-symbols-outlined text-sm">tune</span></button>
            <button class="stock-inc w-7 h-7 rounded-lg bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface-variant" data-variant="${r.variantId}" title="+1" type="button"><span class="material-symbols-outlined text-sm">add</span></button>
            <button class="stock-dec w-7 h-7 rounded-lg bg-surface-container hover:bg-error-container hover:text-error flex items-center justify-center text-on-surface-variant" data-variant="${r.variantId}" title="-1" type="button"><span class="material-symbols-outlined text-sm">remove</span></button>
          </div>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="9" class="py-10 text-center text-on-surface-variant font-body-sm text-body-sm">Sin resultados para los filtros actuales</td></tr>';
    tb.querySelectorAll('.stock-edit').forEach((b) => b.addEventListener('click', () => openStockModal(b.dataset)));
    tb.querySelectorAll('.stock-inc').forEach((b) => b.addEventListener('click', () => adjustStock(Number(b.dataset.variant), +1)));
    tb.querySelectorAll('.stock-dec').forEach((b) => b.addEventListener('click', () => adjustStock(Number(b.dataset.variant), -1)));
    paintSkuCount(list.length, from + (slice.length ? 1 : 0), from + slice.length);
    renderPagination(list.length, from, slice.length, tp);
  }
  async function adjustStock(variantId, delta) {
    try {
      const row = rows.find((r) => r.variantId === variantId);
      await api(`/admin/inventory/${variantId}`, { method: 'PATCH', body: { qty: Math.max(0, (row?.qty || 0) + delta) } });
      loadRows(); loadStats();
    } catch (err) { toast(err.message, 'error'); }
  }

  // ---------- modal de stock ----------
  function openStockModal(d) {
    const old = document.getElementById('vm-modal');
    old && old.remove();
    const m = document.createElement('div');
    m.id = 'vm-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(28,27,29,.55);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)';
    m.innerHTML = `
      <div class="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" style="font-family:'Plus Jakarta Sans',sans-serif">
        <div class="flex items-center justify-between mb-4">
          <h3 style="font-weight:800;font-size:16px;color:#1c1b1d">Ajustar stock — ${esc(d.name || '')}</h3>
          <button class="vm-x" style="border:none;background:none;cursor:pointer;color:#5c3f45">✕</button>
        </div>
        <label style="font-size:12px;color:#5c3f45;font-weight:700;text-transform:uppercase">Unidades</label>
        <input id="vm-qty" type="number" min="0" value="${d.qty}" style="width:100%;margin:6px 0 12px;padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px"/>
        <label style="font-size:12px;color:#5c3f45;font-weight:700;text-transform:uppercase">Punto de reorden</label>
        <input id="vm-reorder" type="number" min="0" value="${d.reorder}" style="width:100%;margin:6px 0 14px;padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px"/>
        <div style="display:flex;gap:8px">
          <button class="vm-cancel" style="flex:1;padding:10px;border-radius:10px;border:1px solid #e5e1e4;background:#fff;cursor:pointer;font-weight:700">Cancelar</button>
          <button class="vm-save" style="flex:1;padding:10px;border-radius:10px;border:none;background:#b60055;color:#fff;cursor:pointer;font-weight:700">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    m.querySelector('.vm-x').onclick = m.querySelector('.vm-cancel').onclick = () => m.remove();
    m.querySelector('.vm-save').onclick = async () => {
      try {
        await api(`/admin/inventory/${d.variant}`, {
          method: 'PATCH',
          body: {
            qty: Math.max(0, Math.floor(Number(m.querySelector('#vm-qty').value) || 0)),
            reorderPoint: Math.max(0, Math.floor(Number(m.querySelector('#vm-reorder').value) || 0)),
            storeId: d.store || undefined,
          },
        });
        toast('Stock actualizado', 'check_circle');
        m.remove(); loadRows(); loadStats();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  // ---------- modal nuevo producto ----------
  function openProductModal() {
    const old = document.getElementById('vm-modal');
    old && old.remove();
    const m = document.createElement('div');
    m.id = 'vm-modal';
    m.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(28,27,29,.55);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px)';
    m.innerHTML = `
      <div class="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl" style="font-family:'Plus Jakarta Sans',sans-serif;max-height:90vh;overflow:auto">
        <div class="flex items-center justify-between mb-4">
          <h3 style="font-weight:800;font-size:16px;color:#1c1b1d">Nuevo producto</h3>
          <button class="vm-x" style="border:none;background:none;cursor:pointer;color:#5c3f45">✕</button>
        </div>
        <div style="display:grid;gap:10px">
          <input id="np-name" placeholder="Nombre del producto *" style="padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px"/>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <select id="np-gender" style="padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px">
              <option value="damas">Damas</option><option value="caballeros">Caballeros</option>
              <option value="ninos">Niños</option><option value="unisex">Unisex</option>
            </select>
            <input id="np-category" placeholder="Categoría (ej. Vestidos)" style="padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px"/>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input id="np-price" type="number" min="1" placeholder="Precio *" style="padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px"/>
            <input id="np-sizes" placeholder="Tallas (ej. S,M,L)" style="padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px"/>
          </div>
          <input id="np-color" placeholder="Color" style="padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px"/>
          <input id="np-img" placeholder="URL de imagen (opcional)" style="padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px"/>
          <textarea id="np-desc" rows="2" placeholder="Descripción corta" style="padding:9px 10px;border-radius:10px;border:1px solid #e5e1e4;font-size:14px;resize:none"></textarea>
        </div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button class="vm-cancel" style="flex:1;padding:10px;border-radius:10px;border:1px solid #e5e1e4;background:#fff;cursor:pointer;font-weight:700">Cancelar</button>
          <button class="vm-save" style="flex:1;padding:10px;border-radius:10px;border:none;background:#b60055;color:#fff;cursor:pointer;font-weight:700">Crear</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const val = (id) => m.querySelector('#' + id)?.value.trim();
    m.querySelector('.vm-x').onclick = m.querySelector('.vm-cancel').onclick = () => m.remove();
    m.querySelector('.vm-save').onclick = async () => {
      if (!val('np-name') || !Number(val('np-price'))) return toast('Nombre y precio son obligatorios', 'error');
      try {
        await api('/admin/products', {
          method: 'POST',
          body: {
            name: val('np-name'), gender: val('np-gender'), category: val('np-category') || 'Colección',
            price: Number(val('np-price')), sizes: (val('np-sizes') || 'S,M,L').split(',').map((s) => s.trim()),
            color: val('np-color') || 'Único', imageUrl: val('np-img') || null,
            badge: 'Nuevo', description: val('np-desc') || null, isNew: true, visibility: 'store',
          },
        });
        toast('Producto creado', 'check_circle');
        m.remove(); loadRows(); loadStats();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  // ---------- filtros ----------
  function wireFilters() {
    document.querySelectorAll('.filter-status-btn').forEach((b) => b.addEventListener('click', () => {
      statusFilter = b.dataset.status;
      document.querySelectorAll('.filter-status-btn').forEach((x) => {
        const on = x === b;
        x.classList.toggle('bg-surface-container-lowest', on);
        x.classList.toggle('text-on-surface', on);
        x.classList.toggle('shadow-sm', on);
        x.classList.toggle('text-on-surface-variant', !on);
      });
      page = 1;
      renderTable();
    }));
    // géneros/categorías
    const chips = [...document.querySelectorAll('button')].filter((b) => ['Todos', 'Damas', 'Caballeros', 'Niños', 'Calzado', 'Accesorios'].includes(b.textContent.trim()) && b.textContent.trim().length < 12 && b.closest('section'));
    chips.forEach((b) => b.addEventListener('click', () => {
      const map = { Todos: 'todos', Damas: 'damas', Caballeros: 'caballeros', Niños: 'ninos', Calzado: 'calzado', Accesorios: 'accesorios' };
      genderFilter = map[b.textContent.trim()] || 'todos';
      chips.forEach((x) => {
        const on = x === b;
        x.classList.toggle('bg-primary', on);
        x.classList.toggle('text-on-primary', on);
        x.classList.toggle('text-on-surface-variant', !on);
      });
      page = 1;
      renderTable();
    }));
    // búsqueda sobre la tabla
    const input = document.createElement('input');
    input.id = 'vm-admin-search';
    input.placeholder = 'Buscar SKU, producto, talla o color…';
    input.style.cssText = 'padding:8px 12px;border-radius:10px;border:1px solid #e5e1e4;background:#f6f2f5;font-size:13px;min-width:230px';
    input.addEventListener('input', () => { qFilter = input.value.toLowerCase().trim(); page = 1; renderTable(); });
    const target = document.querySelector('.filter-status-btn')?.closest('div')?.parentElement;
    if (target) target.insertBefore(input, target.querySelector('.filter-status-btn')?.closest('div'));
    // selector de elementos por página + contador estable
    const counter = [...document.querySelectorAll('main span')].find((el) => el.children.length === 0 && /^\d+([–-]\d+)?\s*de\s+\d+\s*SKU$/.test(el.textContent.trim()));
    if (counter) {
      skuCountEl = counter;
      const label = [...counter.parentElement.children].find((el) => el.children.length === 0 && el.textContent.trim() === 'Mostrar:');
      if (label) label.textContent = 'Por página:';
      const sel = document.createElement('select');
      sel.id = 'vm-page-size';
      sel.title = 'Elementos por página';
      sel.innerHTML = PAGE_SIZES.map((n) => `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n}</option>`).join('');
      sel.style.cssText = 'padding:6px 8px;border-radius:10px;border:1px solid #e5e1e4;background:#f6f2f5;font-size:12px;font-weight:700;color:#1c1b1d;cursor:pointer';
      sel.addEventListener('change', () => {
        const n = Number(sel.value);
        pageSize = PAGE_SIZES.includes(n) ? n : 10;
        try { localStorage.setItem('vm_admin_page_size', String(pageSize)); } catch { /* modo privado */ }
        page = 1;
        renderTable();
      });
      counter.parentElement.insertBefore(sel, counter);
    }
    // selector de tienda
    const branch = $('branch-selector');
    if (branch) branch.addEventListener('change', async () => {
      const { stores } = await api('/stores');
      const s = stores.find((x) => x.name === branch.value || x.code === branch.value);
      storeId = s ? s.id : null;
      page = 1;
      loadStats(); loadRows();
    });
    const period = $('period-selector');
    if (period) period.addEventListener('change', loadStats);
    // botón nuevo producto
    [...document.querySelectorAll('button')].forEach((b) => {
      if (b.textContent.includes('Nuevo Producto')) b.addEventListener('click', openProductModal);
    });
    // exportar/descargar reporte
    [...document.querySelectorAll('button')].forEach((b) => {
      if (b.textContent.includes('Exportar SKU Filtrados')) b.addEventListener('click', () => exportCsv());
      if (b.textContent.includes('Descargar Reporte')) b.addEventListener('click', () => exportCsv());
      if (b.textContent.includes('Imprimir Código de Barras')) b.addEventListener('click', () => toast('Códigos de barra enviados a impresión (demo)', 'print'));
    });
  }
  function exportCsv() {
    const head = ['SKU', 'Producto', 'Categoría', 'Talla', 'Color', 'Stock', 'Reorden', 'Precio', 'Margen%', 'Estado'];
    const lines = filtered().map((r) => [r.sku, r.name, r.category, r.size, r.color, r.qty, r.reorderPoint, r.price, r.marginPct, r.estado]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'inventario-vivamoda.csv';
    a.click();
    toast('Reporte exportado', 'download');
  }

  // ---------- header / logout ----------
  function wireHeader() {
    const icon = [...document.querySelectorAll('.material-symbols-outlined')].find((s) => s.textContent.trim() === 'logout');
    const btn = icon?.closest('button, a');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); window.VM.clearSession(); location.href = '/iniciar-sesion'; });
    [...document.querySelectorAll('*')].forEach((el) => {
      if (el.children.length === 0 && el.textContent.trim() === 'Carlos M.') el.textContent = user?.fullName || 'Admin';
    });
    // poblar selector de sucursales
    const branch = $('branch-selector');
    if (branch) {
      api('/stores').then(({ stores }) => {
        branch.innerHTML = stores.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('');
        const headerStore = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.includes('Almacén Central'));
        const first = headerStore?.textContent.trim() || '';
        const match = stores.find((s) => first.includes(s.name.split(' (')[0]));
        if (match) branch.value = match.name;
        storeId = null; // KPIs agregados de todas las tiendas
        loadStats(); loadRows();
      });
    } else {
      loadStats(); loadRows();
    }
  }

  async function init() {
    user = await requireRole('admin');
    if (!user) return;
    wireFilters();
    wireHeader();
    injectAiSection();
  }
  init();
})();
