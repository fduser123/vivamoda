/* Consola POS / pedidos en vivo (staff) */
(function () {
  const { api, fmtUSD, esc, toast, requireRole, getUser } = window.VM;

  let user = null;
  let products = [];
  let activeFilter = 'all';
  let cart = [];            // { sku, size, name, price, qty }
  let cartSeq = 1;
  let paymentMethod = 'tarjeta';

  const $ = (id) => document.getElementById(id);
  const cartEl = $('pos-cart-items');

  // ---------- helpers de DOM ----------
  function leaf(marker, contains = true) {
    return [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (contains ? el.textContent.includes(marker) : el.textContent.trim() === marker));
  }
  function columnBody(title) {
    const t = leaf(title);
    if (!t) return null;
    const header = t.closest('div');
    const column = header?.parentElement;
    if (!column) return null;
    return [...column.children].find((c) => c !== header && c.classList.contains('overflow-y-auto')) || [...column.children].find((c) => c !== header) || null;
  }
  const badgeChip = (title) => {
    const t = leaf(title);
    const header = t?.closest('div');
    const count = header?.parentElement?.querySelector('span.px-2');
    return count || null;
  };
  const COLUMNS = {
    picking: { title: 'Despachos Pendientes', statuses: ['pendiente', 'picking'], color: '#b60055' },
    packed: { title: 'Empacado / Listo', statuses: ['packed'], color: '#4b41e1' },
    transit: { title: 'En Tránsito', statuses: ['in_transit'], color: '#4b41e1' },
    delivered: { title: 'Entregados Hoy', statuses: ['delivered'], color: '#10b981' },
  };
  const CHANNEL_LABEL = { web: 'Web', mostrador: 'POS', whatsapp: 'WhatsApp', shopify: 'Shopify', app: 'App Móvil', retiro: 'Retiro Tienda' };

  // ==================== PRODUCTOS / CATÁLOGO ====================
  function productGridEl() {
    return [...document.querySelectorAll('div.grid')].find((g) => /grid-cols-2/.test(g.className) && /grid-cols-3/.test(g.className));
  }
  function variantSummary(p) {
    return {
      sku: p.sku,
      size: (p.sizes && p.sizes[0]) || 'U',
      label: `${p.category} · ${p.gender}`,
      name: p.name,
      price: p.price,
    };
  }
  async function loadProducts() {
    try {
      const res = await api('/pos/products');
      products = res.items;
      renderProducts();
    } catch (err) {
      toast('No se pudo cargar el catálogo POS: ' + err.message, 'error');
    }
  }
  function filteredProducts() {
    if (activeFilter === 'all') return products;
    if (activeFilter === 'accesorios') return products.filter((p) => p.category === 'Accesorios' || p.category === 'Calzado');
    return products.filter((p) => p.gender === activeFilter);
  }
  function renderProducts() {
    const grid = productGridEl();
    if (!grid) return;
    const list = filteredProducts();
    grid.innerHTML = list.length ? list.map((p) => {
      const v = variantSummary(p);
      const color = p.image ? '' : 'background:linear-gradient(135deg,#f6f2f5,#eae7ea)';
      return `
      <div class="bg-surface-container-lowest rounded-xl p-space-sm shadow-sm hover:shadow-md cursor-pointer transition-all flex flex-col group pos-tile" data-sku="${esc(p.sku)}" data-size="${esc(v.size)}" data-name="${esc(p.name)}" data-price="${p.price}">
        <div class="w-full h-24 rounded-lg bg-surface-container-low overflow-hidden relative mb-2 flex items-center justify-center" style="${color}">
          ${p.image
            ? `<img class="w-full h-full object-cover group-hover:scale-105 transition-all" src="${esc(p.image)}" loading="lazy" alt="${esc(p.name)}"/>`
            : `<span class="material-symbols-outlined text-3xl text-on-surface-variant">${p.category === 'Calzado' ? 'steps' : 'checkroom'}</span>`}
          ${p.stockTotal <= 0 ? '<span class="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-error text-on-error font-label-sm text-label-sm">0</span>' : ''}
        </div>
        <div class="flex items-center justify-between gap-1">
          <span class="px-1.5 py-0.5 rounded-md bg-surface-container font-label-sm text-label-sm text-on-surface-variant font-bold">${esc(v.size)}</span>
          <span class="font-label-sm text-label-sm text-on-surface-variant truncate">${esc(v.category)}</span>
        </div>
        <h4 class="font-label-lg text-label-lg text-on-surface font-bold leading-snug line-clamp-2 mt-1">${esc(p.name)}</h4>
        <div class="flex items-center justify-between mt-auto pt-1">
          <span class="font-price-prominent text-price-prominent text-primary">${fmtUSD(p.price)}</span>
          <span class="font-label-sm text-label-sm text-on-surface-variant">stock ${p.stockTotal}</span>
        </div>
      </div>`;
    }).join('') : '<p class="col-span-full text-center text-on-surface-variant py-8">Sin productos para este filtro</p>';

    grid.querySelectorAll('.pos-tile').forEach((tile) => {
      tile.addEventListener('click', () => {
        if (Number(tile.dataset.price) && tile.dataset.sku) {
          addPos(tile.dataset.sku, tile.dataset.size, tile.dataset.name, Number(tile.dataset.price));
        }
      });
    });
    // busca
    const search = $('pos-product-input');
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase().trim();
        grid.querySelectorAll('.pos-tile').forEach((tile) => {
          tile.style.display = !q || tile.dataset.name.toLowerCase().includes(q) || tile.dataset.sku.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }
  }

  // ==================== CARRITO ====================
  function addPos(sku, size, name, price) {
    const ex = cart.find((i) => i.sku === sku && i.size === size);
    if (ex) ex.qty += 1;
    else cart.push({ id: cartSeq++, sku, size, name, price, qty: 1 });
    renderCart();
  }
  function renderCart() {
    if (!cartEl) return;
    cartEl.innerHTML = cart.length ? cart.map((i) => `
      <div class="flex items-center justify-between p-2 rounded-xl bg-surface-container-low" data-id="${i.id}">
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <div class="w-9 h-9 rounded-lg bg-surface-container-high flex items-center justify-center text-primary font-bold"><span class="material-symbols-outlined text-base">checkroom</span></div>
          <div class="flex flex-col min-w-0">
            <span class="font-label-md text-label-md text-on-surface font-bold truncate">${esc(i.name)}</span>
            <span class="font-label-sm text-label-sm text-on-surface-variant">Talla ${esc(i.size)} • ${esc(i.sku)}</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button class="w-6 h-6 rounded-md bg-surface-container flex items-center justify-center hover:bg-surface-variant qty-minus" data-id="${i.id}" type="button"><span class="material-symbols-outlined text-sm">remove</span></button>
          <span class="font-label-md text-label-md font-bold w-6 text-center">${i.qty}</span>
          <button class="w-6 h-6 rounded-md bg-surface-container flex items-center justify-center hover:bg-surface-variant qty-plus" data-id="${i.id}" type="button"><span class="material-symbols-outlined text-sm">add</span></button>
          <span class="font-label-md text-label-md text-on-surface font-bold ml-1">${fmtUSD(i.price * i.qty)}</span>
          <button class="text-on-surface-variant hover:text-error transition-colors ml-1 cart-remove" data-id="${i.id}" type="button"><span class="material-symbols-outlined text-lg">close</span></button>
        </div>
      </div>`).join('')
      : '<div class="text-center text-on-surface-variant py-6 font-body-sm text-body-sm">Escanea o toca un producto para agregarlo</div>';
    cartEl.querySelectorAll('.qty-plus').forEach((b) => b.addEventListener('click', () => updateQty(Number(b.dataset.id), 1)));
    cartEl.querySelectorAll('.qty-minus').forEach((b) => b.addEventListener('click', () => updateQty(Number(b.dataset.id), -1)));
    cartEl.querySelectorAll('.cart-remove').forEach((b) => b.addEventListener('click', () => removePosItem(Number(b.dataset.id))));
    updateTotals();
  }
  function updateQty(id, delta) {
    const item = cart.find((i) => i.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) cart = cart.filter((i) => i.id !== id);
    renderCart();
  }
  function removePosItem(id) {
    cart = cart.filter((i) => i.id !== id);
    renderCart();
  }
  function clearPosCart() {
    cart = [];
    renderCart();
    toast('Carrito vaciado', 'delete');
  }
  function updateTotals() {
    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const tax = Math.round(subtotal * 0.19);
    const discount = 0;
    const total = subtotal + tax;
    ['pos-subtotal', 'pos-tax', 'pos-discount', 'pos-total'].forEach((id) => {
      const el = $(id);
      if (el) el.textContent = fmtUSD({ 'pos-subtotal': subtotal, 'pos-tax': tax, 'pos-discount': discount, 'pos-total': total }[id]);
    });
    // estado botón cobrar
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Cobrar e Imprimir Factura'));
    if (btn) btn.disabled = !cart.length;
  }
  function selectPayment(method) {
    paymentMethod = method;
    ['tarjeta', 'efectivo', 'enlace'].forEach((m) => {
      const b = $(`pay-${m}`);
      if (!b) return;
      const active = m === method;
      b.classList.toggle('bg-primary', active);
      b.classList.toggle('text-on-primary', active);
      b.classList.toggle('shadow-md', active);
      b.classList.toggle('border', !active);
      b.classList.toggle('border-surface-container-high', !active);
    });
  }

  // ==================== VENTA ====================
  async function processSale() {
    if (!cart.length) return toast('Agrega productos a la venta', 'error');
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Cobrar e Imprimir Factura'));
    if (btn) { btn.disabled = true; }
    try {
      const customerName = $('pos-customer')?.value.trim() || 'Cliente de mostrador';
      const res = await api('/pos/orders', {
        method: 'POST',
        body: {
          items: cart.map((i) => ({ sku: i.sku, size: i.size, qty: i.qty })),
          customerName,
          paymentMethod,
          channel: 'mostrador',
          paid: true,
        },
      });
      toast(`Venta ${res.order.orderNo} registrada · Total ${fmtUSD(res.order.total)}`, 'check_circle');
      clearPosCart();
      loadOrders();
      loadSummary();
      const note = $('#toast-notification');
      if (note) { note.classList.remove('translate-y-32', 'opacity-0'); setTimeout(() => note.classList.add('translate-y-32', 'opacity-0'), 4000); }
    } catch (err) {
      toast(err.message, 'error');
      if (btn) btn.disabled = false;
    }
  }

  // ==================== PEDIDOS ====================
  async function loadOrders() {
    try {
      const { orders } = await api('/pos/orders');
      const grouped = { picking: [], packed: [], transit: [], delivered: [] };
      orders.forEach((o) => {
        if (o.status === 'pendiente' || o.status === 'picking') grouped.picking.push(o);
        else if (o.status === 'packed') grouped.packed.push(o);
        else if (o.status === 'in_transit') grouped.transit.push(o);
        else if (o.status === 'delivered' && new Date(o.createdAt) >= new Date(new Date().setHours(0, 0, 0, 0))) grouped.delivered.push(o);
      });
      Object.entries(COLUMNS).forEach(([key, col]) => {
        const body = columnBody(col.title);
        if (!body) return;
        const list = grouped[key];
        const count = badgeChip(col.title);
        if (count) count.textContent = list.length;
        body.innerHTML = list.length ? list.map((o) => orderCard(o, key)).join('') : `<div class="text-center text-on-surface-variant py-6 font-body-sm text-body-sm bg-surface-container-lowest rounded-xl">Sin pedidos</div>`;
        body.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => orderAction(b.dataset.orderNo, b.dataset.action, b.dataset.status, b.dataset.retiro === '1')));
      });
    } catch (err) {
      toast('Error cargando pedidos: ' + err.message, 'error');
    }
  }
  function orderCard(o, col) {
    const chan = CHANNEL_LABEL[o.channel] || o.channel;
    const itemsText = o.items.map((i) => `${esc(i.productName)} (${esc(i.size)}) ×${i.qty}`).join(', ');
    const actions = {
      picking: `
        <button class="flex-1 py-1.5 px-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-bold flex items-center justify-center gap-1" data-action="picking" data-order-no="${esc(o.orderNo)}" data-status="${o.status}" data-retiro="${o.channel === 'retiro' ? 1 : 0}"><span class="material-symbols-outlined text-sm">inventory_2</span>${o.status === 'pendiente' ? 'Iniciar Picking' : 'Confirmar Picking'}</button>`,
      packed: `
        <button class="flex-1 py-1.5 px-2 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md font-bold flex items-center justify-center gap-1" data-action="packed" data-order-no="${esc(o.orderNo)}" data-status="${o.status}" data-retiro="${o.channel === 'retiro' ? 1 : 0}"><span class="material-symbols-outlined text-sm">departure_board</span>${o.channel === 'retiro' ? 'Marcar Entregado (Retiro)' : 'Marcar Despachado'}</button>`,
      transit: `
        <button class="flex-1 py-1.5 px-2 rounded-lg bg-emerald-600 text-white font-label-md text-label-md font-bold flex items-center justify-center gap-1" data-action="transit" data-order-no="${esc(o.orderNo)}" data-status="${o.status}"><span class="material-symbols-outlined text-sm">local_shipping</span>Marcar Entregado</button>`,
      delivered: `<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-label-sm text-label-sm font-bold">${esc(o.notes || 'Entregado')}</span>`,
    }[col] || '';
    return `
    <div class="bg-surface-container-lowest rounded-xl p-space-sm shadow-sm flex flex-col gap-1">
      <div class="flex items-center justify-between">
        <span class="font-label-md text-label-md text-on-surface font-bold">#${esc(o.orderNo)}</span>
        <span class="px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm font-bold">${esc(chan)}</span>
      </div>
      <div class="flex items-center justify-between">
        <span class="font-label-sm text-label-sm text-on-surface-variant truncate">${esc(o.customerName)}</span>
        <span class="font-price-prominent text-price-prominent text-primary">${fmtUSD(o.total)}</span>
      </div>
      <p class="font-label-sm text-label-sm text-on-surface-variant leading-snug line-clamp-2">${itemsText}</p>
      <div class="flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm">
        <span class="truncate">${esc(o.city || '')}${o.notes ? ' · ' + esc(o.notes) : ''}</span>
        <span>${window.VM.timeAgo(o.createdAt)}</span>
      </div>
      <div class="flex gap-1.5 mt-1">${actions}</div>
    </div>`;
  }
  async function orderAction(orderNo, action, currentStatus, isRetiro) {
    // determina la transición correcta según el estado actual del pedido
    let target;
    if (action === 'picking') target = currentStatus === 'pendiente' ? 'picking' : 'packed';
    else if (action === 'packed') target = isRetiro ? 'delivered' : 'in_transit';
    else target = 'delivered';
    try {
      const res = await api(`/pos/orders/${orderNo}/status`, { method: 'PATCH', body: { status: target } });
      toast(`#${orderNo} → ${res.order.statusLabel}`, 'check_circle');
      loadOrders();
      loadSummary();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ==================== RESUMEN / HEADER ====================
  async function loadSummary() {
    try {
      const s = await api('/pos/summary');
      const pend = leaf('14 Pedidos') || leaf('Pedidos', false);
      const pendCount = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && /\d+\s*Pedidos?/.test(el.textContent));
      if (pendCount && s.pending !== undefined) pendCount.textContent = `${s.pending} ${s.pending === 1 ? 'Pedido' : 'Pedidos'}`;
      const daily = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && /^\$\d/.test(el.textContent) && /USD|,/.test(el.textContent));
      if (daily && s.salesToday !== undefined) daily.textContent = `${fmtUSD(s.salesToday)} USD`;
      void pend;
    } catch { /* sin resumen */ }
  }

  // ==================== VISTAS (POS / Pedidos) ====================
  function switchView(view) {
    const views = { orders: 'view-orders', pos: 'view-pos' };
    Object.entries(views).forEach(([name, id]) => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', name !== view);
    });
    ['orders', 'pos'].forEach((name) => {
      const tab = $(`tab-${name}`);
      if (!tab) return;
      const active = name === view;
      tab.classList.toggle('bg-primary', active);
      tab.classList.toggle('text-on-primary', active);
      tab.classList.toggle('shadow-sm', active);
      tab.classList.toggle('text-on-surface-variant', !active);
    });
  }

  // ==================== globales (referenciadas por el markup) ====================
  window.switchView = switchView;
  window.filterCatalog = (g) => {
    activeFilter = g;
    renderProducts();
    const chips = [...document.querySelectorAll('button')].filter((b) => /Colecciones|Damas|Caballeros|Niños|Accesorios/.test(b.textContent) && b.textContent.length < 24);
    chips.forEach((b) => {
      const map = { 'Todas las Colecciones': 'all', 'Damas': 'damas', 'Caballeros': 'caballeros', 'Niños & Jóvenes': 'ninos', 'Accesorios / Calzado': 'accesorios' };
      const active = (map[b.textContent.trim()] || '') === g;
      b.classList.toggle('bg-on-background', active);
      b.classList.toggle('text-surface', active);
      b.classList.toggle('font-bold', active);
    });
  };
  window.triggerBarcodeScan = () => { $('pos-product-input')?.focus(); };
  window.printDailyZReport = () => toast('Reporte Z generado (demo PDF)', 'print');
  window.printShippingLabel = (no) => toast(`Guía de ${no} enviada a imprimir`, 'print');
  window.confirmPicking = async (no) => orderAction(no, 'picking', 'picking', false);
  window.quickBarcodeScanItem = (no) => toast(`Escaneado ${no}`, 'qr_code_scanner');
  window.markDispatched = async (no) => orderAction(no, 'packed', 'packed', false);
  window.addPosItem = (name, price, tallaLabel, img) => {
    const m = String(tallaLabel).match(/Talla\s+([\w-]+)/i);
    const size = m ? m[1] : 'U';
    const prod = products.find((p) => p.name === name);
    if (prod) { addPos(prod.sku, size, name, price); return; }
    const sku = `POS-${cartSeq}-${Date.now()}`;
    addPos(sku, size, name, price);
    void img;
  };
  window.handleBarcodeEnter = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addCurrentScannedItem();
  };
  window.addCurrentScannedItem = () => {
    const q = $('pos-product-input')?.value.trim().toLowerCase() || '';
    if (!q) return;
    const exact = products.find((p) => p.sku.toLowerCase() === q);
    if (exact) { addPos(exact.sku, (exact.sizes && exact.sizes[0]) || 'U', exact.name, exact.price); $('pos-product-input').value = ''; toast(`${exact.name} agregado`, 'check_circle'); return; }
    const found = products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    if (found.length === 1) {
      const p = found[0];
      addPos(p.sku, (p.sizes && p.sizes[0]) || 'U', p.name, p.price);
      $('pos-product-input').value = '';
      toast(`${p.name} agregado`, 'check_circle');
    } else if (found.length > 1) {
      toast(`${found.length} productos coinciden; toca uno en la cuadrícula`, 'info');
    } else {
      toast('Producto no encontrado', 'error');
    }
  };
  window.updateQty = updateQty;
  window.removePosItem = removePosItem;
  window.clearPosCart = clearPosCart;
  window.selectPayment = selectPayment;
  window.processSale = processSale;
  window.logoutUser = () => { window.VM.clearSession(); location.href = '/iniciar-sesion'; };

  // ==================== logout / identidad ====================
  function wireLogout() {
    const icon = [...document.querySelectorAll('.material-symbols-outlined')].find((s) => s.textContent.trim() === 'logout');
    const btn = icon?.closest('button, a');
    if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); window.logoutUser(); });
    // nombre de usuario en header
    [...document.querySelectorAll('*')].forEach((el) => {
      if (el.children.length === 0 && el.textContent.trim() === 'Carlos M.') el.textContent = user?.fullName || 'Carlos M.';
      if (el.children.length === 0 && /^Admin$/i.test(el.textContent.trim())) el.textContent = 'Staff';
    });
  }
  function wireInitTabs() {
    ['orders', 'pos'].forEach((name) => {
      const tab = $(`tab-${name}`);
      if (tab) tab.addEventListener('click', () => switchView(name));
    });
    ['tarjeta', 'efectivo', 'enlace'].forEach((m) => {
      const b = $(`pay-${m}`);
      if (b) b.addEventListener('click', () => selectPayment(m));
    });
  }

  // ==================== init ====================
  async function init() {
    user = await requireRole('staff', 'admin');
    if (!user) return;
    selectPayment('tarjeta');
    wireInitTabs();
    wireLogout();
    renderCart();
    await Promise.all([loadProducts(), loadOrders(), loadSummary()]);
  }
  init();
})();
