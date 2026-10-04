// =====================================================================
// VivaModa · Guía del producto (aterrizaje del QR de la etiqueta)
// Mobile-first: el cliente escanea y ve cómo usar, cuidar y combinar
// su prenda. Fuente de verdad: GET /api/products/:sku (details reales).
// =====================================================================
(() => {
  const { api, esc, fmtUSD } = window.VM;
  const $ = (id) => document.getElementById(id);
  const CARE_ICONS = {
    lavar: 'local_laundry_service', planchar: 'iron', secar: 'dry',
    blanqueador: 'block', lavarseco: 'dry_cleaning', general: 'checkroom',
  };
  const careIcon = (t) => {
    const s = t.toLowerCase();
    if (/m[aá]quina/.test(s)) return CARE_ICONS.lavar;
    if (/planch/.test(s)) return CARE_ICONS.planchar;
    if (/sec/.test(s) && /sombra|secador|tender/.test(s)) return CARE_ICONS.secar;
    if (/blanque/.test(s)) return CARE_ICONS.blanqueador;
    if (/seco/.test(s)) return CARE_ICONS.lavarseco;
    return CARE_ICONS.general;
  };

  function compositionBars(comp) {
    if (!Array.isArray(comp) || !comp.length) return '';
    const colors = ['#b60055', '#e4006c', '#f472b6', '#9ca3af', '#d1d5db'];
    const total = comp.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0) || 100;
    return `
      <div class="mt-3 space-y-2">
        ${comp.map((c, i) => `
          <div>
            <div class="flex justify-between text-[11px] font-semibold mb-1">
              <span>${esc(c.name)}</span><span class="text-gray-500">${esc(c.pct)}</span>
            </div>
            <div class="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div class="h-full rounded-full" style="width:${Math.min(100, (parseFloat(c.pct) || 0) / total * 100)}%;background:${colors[i % colors.length]}"></div>
            </div>
            ${c.note ? `<div class="text-[10px] text-gray-400 mt-0.5">${esc(c.note)}</div>` : ''}
          </div>`).join('')}
      </div>`;
  }

  function render(p) {
    const d = p.details || {};
    const care = Array.isArray(d.care) ? d.care : [];
    const occasions = Array.isArray(d.occasions) ? d.occasions : (p.category ? [p.category] : []);
    const use = d.fitNote || 'Prenda de la colección VivaModa. Revisa la guía de tallas en la ficha del producto para tu calce ideal.';

    $('vm-guia-root').innerHTML = `
      <header class="flex items-center justify-between mb-4">
        <a href="/" class="flex items-center gap-1.5 font-extrabold text-[#b60055] text-lg">VM <span class="text-[#1c1b1d]">VivaModa</span></a>
        <span class="text-[10px] font-bold px-2 py-1 rounded-full bg-[#fde7f1] text-[#b60055]">escaneado ✓</span>
      </header>

      <div class="bg-white rounded-3xl shadow-lg overflow-hidden">
        <div class="aspect-square bg-[#f6f2f5]">
          <img src="${esc(p.image || '')}" alt="${esc(p.name)}" class="w-full h-full object-cover" onerror="this.style.display='none'"/>
        </div>
        <div class="p-4">
          <div class="text-[11px] font-bold tracking-wide text-[#b60055] uppercase">${esc(p.gender === 'damas' ? 'Damas' : p.gender === 'caballeros' ? 'Caballeros' : p.gender === 'ninos' ? 'Niños' : 'Unisex')} · ${esc(p.category)}</div>
          <h1 class="text-xl font-extrabold leading-tight mt-0.5">${esc(p.name)}</h1>
          <div class="flex items-center gap-2 mt-1">
            <span class="text-lg font-extrabold">${fmtUSD(p.price)}</span>
            ${p.compareAt ? `<span class="text-sm text-gray-400 line-through">${fmtUSD(p.compareAt)}</span>` : ''}
            ${p.stockTotal > 0 ? '<span class="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded">✓ disponible</span>' : '<span class="text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">sin stock</span>'}
          </div>
          <div class="flex gap-2 mt-3">
            <a href="/ver-en-tu-espacio?sku=${encodeURIComponent(p.sku)}" class="flex-1 text-center bg-[#b60055] text-white font-bold text-sm rounded-xl py-2.5">📱 Verla en 3D / AR</a>
            <a href="/detalle-de-producto?sku=${encodeURIComponent(p.sku)}" class="flex-1 text-center border-2 border-[#b60055] text-[#b60055] font-bold text-sm rounded-xl py-2.5">Comprar</a>
          </div>
        </div>
      </div>

      <section class="mt-4 bg-white rounded-3xl shadow-sm p-4 vm-tip">
        <h2 class="flex items-center gap-2 font-extrabold text-base"><span class="material-symbols-outlined text-[#b60055]">styler</span>Cómo usarla</h2>
        <p class="text-sm text-gray-600 mt-1.5">${esc(use)}</p>
        ${occasions.length ? `<div class="flex flex-wrap gap-1.5 mt-2">${occasions.map((o) => `<span class="text-[11px] font-bold px-2 py-1 rounded-full bg-[#fde7f1] text-[#b60055]">${esc(o)}</span>`).join('')}</div>` : ''}
      </section>

      <section class="mt-3 bg-white rounded-3xl shadow-sm p-4 vm-tip">
        <h2 class="flex items-center gap-2 font-extrabold text-base"><span class="material-symbols-outlined text-[#b60055]">local_laundry_service</span>Cómo cuidarla</h2>
        ${care.length ? `
          <ul class="mt-2 space-y-2">
            ${care.map((c) => `
              <li class="flex items-start gap-2.5">
                <span class="material-symbols-outlined text-[#b60055] text-xl mt-0.5">${careIcon(String(c))}</span>
                <span class="text-sm text-gray-700">${esc(c)}</span>
              </li>`).join('')}
          </ul>` : '<p class="text-sm text-gray-400 mt-1.5">Recomendaciones de cuidado no disponibles para esta prenda.</p>'}
        <div class="mt-3 pt-3 border-t border-gray-100">
          <div class="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">Composición</div>
          ${compositionBars(d.composition) || '<p class="text-sm text-gray-400">No especificada.</p>'}
        </div>
      </section>

      <section class="mt-3 bg-white rounded-3xl shadow-sm p-4 vm-tip">
        <h2 class="flex items-center gap-2 font-extrabold text-base"><span class="material-symbols-outlined text-[#b60055]">checkroom</span>Cómo combinarla</h2>
        ${d.logistics ? `<div class="flex items-start gap-2.5 mt-2 p-2.5 rounded-xl bg-[#fcf3f8]"><span class="material-symbols-outlined text-[#b60055] text-xl">local_shipping</span><span class="text-xs text-gray-600">${esc(d.logistics)}</span></div>` : ''}
        <div id="vm-guia-combos" class="mt-3"><div class="text-sm text-gray-400 py-3 text-center"><span class="material-symbols-outlined animate-spin inline align-middle mr-1">progress_activity</span>Buscando prendas que combinan…</div></div>
      </section>

      <footer class="text-center text-[10px] text-gray-400 mt-6 space-y-2">
        <div><a class="underline hover:text-[#b60052]" href="/api/products/${encodeURIComponent(p.sku)}/label" target="_blank" rel="noopener">🏷️ Imprimir etiqueta con el QR</a></div>
        <div>SKU ${esc(p.sku)} · VivaModa omnichannel</div>
      </footer>`;

    loadCombos(p);
  }

  /** Recomendaciones reales del estilista IA (mismo motor que el hub) */
  async function loadCombos(p) {
    const box = $('vm-guia-combos');
    if (!box) return;
    try {
      const r = await api('/ai/style-match', {
        method: 'POST',
        body: { analysis: { colors: [], garmentType: p.category, style: p.category, formality: null, occasions: [], body: null, gender: p.gender } },
      });
      const items = (r.products || []).filter((x) => x.sku !== p.sku).slice(0, 3);
      box.innerHTML = items.length ? `
        <div class="grid grid-cols-3 gap-2">
          ${items.map((x) => `
            <a href="/detalle-de-producto?sku=${encodeURIComponent(x.sku)}" class="rounded-xl overflow-hidden bg-[#f6f2f5]">
              <div class="aspect-square"><img src="${esc(x.image_url || '')}" class="w-full h-full object-cover" onerror="this.style.display='none'"/></div>
              <div class="p-1.5"><div class="text-[10px] font-bold leading-tight line-clamp-2">${esc(x.name)}</div>
              <div class="text-[10px] text-[#b60055] font-extrabold">${fmtUSD(x.price)}</div></div>
            </a>`).join('')}
        </div>
        <div class="text-[10px] text-gray-400 mt-1.5 flex items-center gap-1"><span class="material-symbols-outlined text-xs">auto_awesome</span>Sugerido por la IA estilista de VivaModa</div>`
        : '<p class="text-sm text-gray-400">Pronto: combinaciones para esta prenda.</p>';
    } catch {
      box.innerHTML = '<p class="text-sm text-gray-400">Pronto: combinaciones para esta prenda.</p>';
    }
  }

  async function init() {
    const sku = new URLSearchParams(location.search).get('sku');
    const root = $('vm-guia-root');
    if (!sku) {
      root.innerHTML = '<div class="text-center py-16"><span class="material-symbols-outlined text-5xl text-gray-300">qr_code_scanner</span><h1 class="font-extrabold text-lg mt-3">Escanea el QR de tu prenda</h1><p class="text-sm text-gray-500 mt-1">Cada etiqueta VivaModa trae un código que abre esta guía.</p></div>';
      return;
    }
    try {
      const { product } = await api(`/products/${encodeURIComponent(sku)}`);
      document.title = `VivaModa · ${product.name}`;
      render(product);
    } catch (e) {
      root.innerHTML = `<div class="text-center py-16"><span class="material-symbols-outlined text-5xl text-gray-300">search_off</span><h1 class="font-extrabold text-lg mt-3">Producto no encontrado</h1><p class="text-sm text-gray-500 mt-1">${esc(e.message || 'El código no corresponde a un producto activo.')}</p></div>`;
    }
  }

  init();
})();
