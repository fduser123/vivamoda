/* ============================================================
   BOLSA DE COMPRA DENTRO DE LA TIENDA VR
   ------------------------------------------------------------
   La tienda VR no tenía carrito: tocar una prenda solo abría una
   tarjeta informativa. Aquí vive la bolsa, que funciona igual
   para invitado y para cliente:

   - La bolsa se guarda en localStorage, así que sobrevive a un
     recargado y no exige sesión para ir llenándola.
   - Al pagar SÍ hace falta sesión de cliente: el carrito y los
     pedidos de la API están detrás de requireAuth (ver
     src/routes/cart.js y src/routes/orders.js). Es el mismo
     camino que usa el Simulador de Tienda: se vuelca cada línea
     al carrito real y luego se crea el pedido, que valida stock y
     descuenta inventario.
   ============================================================ */
(function () {
  'use strict';

  const S = window.VRStore;
  const VM = window.VM || {};
  const KEY = 'vivamoda_vr_bag';
  const FREE_SHIPPING = 49.99; // mismo umbral que el resto de la tienda

  const $ = (id) => document.getElementById(id);
  const money = (n) => (VM.fmtUSD
    ? VM.fmtUSD(n)
    : '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  let items = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((l) => l && l.sku) : [];
    } catch (_) { return []; }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (_) {}
  }

  const count = () => items.reduce((n, l) => n + l.qty, 0);
  const total = () => items.reduce((n, l) => n + Number(l.price || 0) * l.qty, 0);

  // ── Añadir ───────────────────────────────────────────────
  function add(prod, size, qty = 1) {
    if (!prod) return false;
    if (prod.missing) {
      nota('Esta prenda ya no está en la tienda y no se puede comprar.', 'error');
      return false;
    }
    const talla = size || (prod.sizes && prod.sizes[0]) || '';
    if (!talla) {
      nota('Esta prenda no tiene tallas con stock.', 'error');
      return false;
    }
    const igual = items.find((l) => l.sku === prod.sku && l.size === talla);
    if (igual) igual.qty = Math.min(50, igual.qty + qty);
    else {
      items.push({
        sku: prod.sku, size: talla, qty,
        name: prod.name, price: Number(prod.price || 0),
        image: prod.image || null, emoji: prod.emoji || '🛍️', zone: prod.zone || null,
      });
    }
    save(); render();
    nota(`${prod.name} (${talla}) añadido a la bolsa`, 'check_circle');
    return true;
  }

  function remove(i) {
    items.splice(i, 1);
    save(); render();
  }

  function setQty(i, q) {
    const n = Math.max(1, Math.min(50, Math.floor(Number(q) || 1)));
    if (!items[i]) return;
    items[i].qty = n;
    save(); render();
  }

  function clear() { items = []; save(); render(); }

  // ── Pintado ──────────────────────────────────────────────
  function render() {
    const n = count();
    const badge = $('bagCount');
    if (badge) {
      badge.textContent = String(n);
      badge.classList.toggle('hidden', n === 0);
      badge.classList.toggle('flex', n > 0);
    }
    const pc = $('bagPanelCount');
    if (pc) pc.textContent = n ? `· ${n} ${n === 1 ? 'prenda' : 'prendas'}` : '';

    const hay = items.length > 0;
    $('bagEmpty')?.classList.toggle('hidden', hay);
    $('bagFoot')?.classList.toggle('hidden', !hay);
    $('bagItems')?.classList.toggle('hidden', !hay);
    if (!hay) { const bi = $('bagItems'); if (bi) bi.innerHTML = ''; return; }

    const lista = $('bagItems');
    if (lista) {
      lista.innerHTML = items.map((l, i) => `
        <div class="flex gap-3 rounded-2xl bg-white/5 border border-white/10 p-2.5">
          <div class="w-14 h-14 rounded-xl bg-white/10 overflow-hidden flex items-center justify-center shrink-0">
            ${l.image
              ? `<img src="${l.image}" alt="" class="w-full h-full object-cover" onerror="this.style.display='none'"/>`
              : `<span class="text-2xl">${l.emoji || '🛍️'}</span>`}
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[12px] font-bold text-white leading-tight line-clamp-2">${l.name}</div>
            <div class="text-[10px] text-white/55 mt-0.5">Talla ${l.size} · ${l.sku}</div>
            <div class="flex items-center justify-between mt-1.5">
              <div class="flex items-center gap-1.5">
                <button data-qty="-1" data-i="${i}" class="w-6 h-6 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold leading-none">−</button>
                <span class="text-[12px] font-bold text-white w-5 text-center">${l.qty}</span>
                <button data-qty="1" data-i="${i}" class="w-6 h-6 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold leading-none">+</button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-[12px] font-extrabold text-[#ff8ab5]">${money(Number(l.price) * l.qty)}</span>
                <button data-del="${i}" class="text-white/40 hover:text-white/90" title="Quitar">
                  <span class="material-symbols-outlined text-base">delete</span>
                </button>
              </div>
            </div>
          </div>
        </div>`).join('');
    }

    const t = total();
    const tot = $('bagTotal');
    if (tot) tot.textContent = money(t);
    const sh = $('bagShipping');
    if (sh) {
      sh.textContent = t >= FREE_SHIPPING
        ? '✅ Envío express gratis (24-48 h)'
        : `Te faltan ${money(FREE_SHIPPING - t)} para el envío express gratis`;
    }
  }

  // ── Avisos ───────────────────────────────────────────────
  function nota(msg, icon) {
    if (VM.toast) { VM.toast(msg, icon || 'info'); return; }
    const el = $('bagMsg');
    if (el) el.textContent = msg;
  }

  function msgPanel(txt) {
    const el = $('bagMsg');
    if (el) el.textContent = txt || '';
  }

  // ── Abrir / cerrar ───────────────────────────────────────
  const abrir = () => { $('bagPanel')?.classList.remove('hidden'); render(); };
  const cerrar = () => $('bagPanel')?.classList.add('hidden');
  const alternar = () => ($('bagPanel')?.classList.contains('hidden') ? abrir() : cerrar());

  // ── Pago ─────────────────────────────────────────────────
  async function checkout() {
    if (!items.length) return;
    const user = VM.getUser && VM.getUser();
    if (!user || user.role !== 'client') {
      msgPanel('🔐 Necesitas iniciar sesión como cliente para cerrar el pedido.');
      nota('Inicia sesión como cliente para completar la compra', 'lock');
      return;
    }
    const address = ($('bagAddress')?.value || '').trim();
    const city = ($('bagCity')?.value || '').trim();
    const paymentMethod = $('bagPayment')?.value || 'tarjeta';
    if (!address || !city) {
      msgPanel('Escribe la dirección y la ciudad de entrega.');
      return;
    }
    const btn = $('bagCheckout');
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = 'Procesando…'; }
    msgPanel('');
    try {
      // 1) volcar cada línea al carrito real
      for (const l of items) {
        await VM.api('/cart/items', { method: 'POST', body: { sku: l.sku, size: l.size, qty: l.qty } });
      }
      // 2) crear el pedido: valida stock, descuenta inventario y da número
      const res = await VM.api('/orders', { method: 'POST', body: { address, city, paymentMethod } });
      const no = (res && res.order && res.order.orderNo) || '';
      items = []; save(); render();
      msgPanel(`✅ Pedido ${no} confirmado. Inventario descontado.`);
      nota(`Pedido ${no} confirmado`, 'check_circle');
    } catch (err) {
      msgPanel('⚠️ ' + (err.message || 'No se pudo completar la compra'));
      nota(err.message || 'Error en la compra', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
  }

  // ── Cableado de la interfaz ──────────────────────────────
  function wire() {
    $('bagBtn')?.addEventListener('click', alternar);
    $('bagClose')?.addEventListener('click', cerrar);
    $('bagCheckout')?.addEventListener('click', checkout);

    // Delegación: botones +, − y borrar de cada línea
    $('bagItems')?.addEventListener('click', (e) => {
      const q = e.target.closest('[data-qty]');
      if (q) { const i = Number(q.dataset.i); setQty(i, (items[i]?.qty || 1) + Number(q.dataset.qty)); return; }
      const d = e.target.closest('[data-del]');
      if (d) remove(Number(d.dataset.del));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cerrar();
      // B alterna la bolsa (salvo si se está escribiendo)
      const t = e.target;
      const escribiendo = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (!escribiendo && (e.key === 'b' || e.key === 'B')) alternar();
    });

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  // Expuesto a los demás módulos (la tarjeta de producto lo usa)
  S.bag = { add, remove, setQty, clear, count, total, items: () => items, open: abrir, close: cerrar, render };
})();
