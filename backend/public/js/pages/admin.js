/* Panel de almacén y ventas en vivo (admin) */
(function () {
  const { api, fmtUSD, esc, toast, requireRole } = window.VM;

  let user = null;
  let rows = [];
  let statusFilter = 'all';
  let genderFilter = 'todos';
  let qFilter = '';
  let storeId = null;      // null = todas las tiendas en KPIs

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
      const count = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && /^\d+\s*de\s+\d+\s*SKU/.test(el.textContent));
      if (count) count.textContent = `${filtered().length} de ${rows.length} SKU`;
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
  function renderTable() {
    const tb = tbody();
    if (!tb) return;
    const list = filtered();
    tb.innerHTML = list.length ? list.map((r) => `
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
      renderTable();
    }));
    // búsqueda sobre la tabla
    const input = document.createElement('input');
    input.id = 'vm-admin-search';
    input.placeholder = 'Buscar SKU, producto, talla o color…';
    input.style.cssText = 'padding:8px 12px;border-radius:10px;border:1px solid #e5e1e4;background:#f6f2f5;font-size:13px;min-width:230px';
    input.addEventListener('input', () => { qFilter = input.value.toLowerCase().trim(); renderTable(); });
    const target = document.querySelector('.filter-status-btn')?.closest('div')?.parentElement;
    if (target) target.insertBefore(input, target.querySelector('.filter-status-btn')?.closest('div'));
    // selector de tienda
    const branch = $('branch-selector');
    if (branch) branch.addEventListener('change', async () => {
      const { stores } = await api('/stores');
      const s = stores.find((x) => x.name === branch.value || x.code === branch.value);
      storeId = s ? s.id : null;
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
  }
  init();
})();
