/* Detalle de producto en vivo + estilista IA conectado */
(function () {
  const { api, fmtUSD, esc, toast, addToCart, refreshCartBadge, paintUserChip, getUser, modelChipHtml } = window.VM;

  const MOCK_NAME = 'Vestido Asimétrico Magenta Atelier';
  let product = null;
  let selectedSize = null;

  const $ = (id) => document.getElementById(id);
  const mainImg = $('main-img');
  const gallery = [];
  const galleryIdx = 0;

  // ---------- utilidades de texto en el DOM (sin romper iconos) ----------
  function patchTextNodes(root, regex, replace) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      if (regex.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(regex, replace);
    });
  }
  function findElByText(text, exact = false, skip = 0) {
    const matches = [...document.querySelectorAll('*')].filter((el) => {
      if (el.children.length !== 0) return false;
      const t = el.textContent.trim();
      return text instanceof RegExp ? text.test(t) : (exact ? t === text : t.includes(text));
    });
    return matches[skip] || null;
  }

  function setProductData(p) {
    // nombre (h1) + etiquetas
    const heading = [...document.querySelectorAll('h1,h2')].find((h) => h.textContent.includes(MOCK_NAME));
    if (heading) heading.textContent = p.name;
    document.title = `${p.name} · VivaModa`;

    // rating y reseñas
    patchTextNodes(document.body, /\(148 reseñas\)/, `(${p.reviewCount} reseñas)`);

    // precio
    const priceEl = findElByText(/^\$[\d.,]+$/, true) || findElByText('$48.00', true);
    if (priceEl) priceEl.textContent = fmtUSD(p.price);
    const oldEl = findElByText(/^\$[\d.,]+$/, true, 1);
    if (oldEl && p.compareAt) oldEl.textContent = fmtUSD(p.compareAt);
    if (!p.compareAt) {
      const saveEl = findElByText('Ahorras');
      if (saveEl) saveEl.closest('div') && saveEl.parentElement && (saveEl.parentElement.style.display = 'none');
    } else {
      const pct = Math.round((1 - p.price / p.compareAt) * 100);
      patchTextNodes(document.body, /Ahorras \d+%/, `Ahorras ${pct}%`);
    }
    const priceChip = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && /^\$\d/.test(el.textContent.trim()) && el.textContent.includes('$189.900'));
    if (priceChip) priceChip.textContent = fmtUSD(p.price);

    // inventario omnicanal
    const stockLine = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && /unidades en tu centro de distribución/.test(el.textContent));
    if (stockLine) {
      const total = p.variants.reduce((s, v) => s + (v.stockByStore.CENTRAL?.qty || 0), 0);
      stockLine.textContent = stockLine.textContent.replace(/\d+ unidades/, `${total || p.stockTotal} unidades`);
    }
    // galería
    const thumbs = document.querySelectorAll('.thumb-btn img');
    if (p.gallery.length) {
      thumbs.forEach((img, i) => { img.src = p.gallery[i % p.gallery.length] || img.src; });
      if (mainImg) { mainImg.src = p.gallery[0] || p.image || mainImg.src; }
    }
    // color seleccionado
    const colorName = $('selected-color-name');
    if (colorName && p.colors.length) colorName.textContent = p.colors[0];

    // "Completa el look": precios y nombres con los companions reales de la API.
    // En productos sin companions (mockup estático) se muestran los valores demo ya convertidos a USD.
    const comps = p.companions || [];
    const COMP_STATIC = { '$79.900': 0, '$49.900': 1, '$129.900': 2 };
    const FALLBACK_USD = ['$19.99', '$12.49', '$32.99'];
    [...document.querySelectorAll('*')].forEach((el) => {
      if (el.children.length !== 0) return;
      const idx = COMP_STATIC[el.textContent.trim()];
      if (idx === undefined) return;
      el.textContent = comps[idx] ? fmtUSD(comps[idx].price) : FALLBACK_USD[idx];
    });
    const compNames = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0 && /Stiletto|Clutch Geom|Blazer Cropped/.test(el.textContent));
    compNames.forEach((el, i) => { if (comps[i]) el.textContent = comps[i].name; });
    const totalEl = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && /^\$419\.600$/.test(el.textContent.trim()));
    if (totalEl) totalEl.textContent = comps.length ? fmtUSD(comps.reduce((s, c) => s + Number(c.price), 0) + Number(p.price)) : '$113.46';

    // tallas
    const sizeBox = $('size-options');
    if (sizeBox) {
      const sizes = p.variants.map((v) => ({
        size: v.size,
        stock: v.total,
      }));
      selectedSize = null;
      sizeBox.innerHTML = '';
      sizes.forEach((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = s.size;
        b.className = 'size-btn py-space-xs rounded-xl font-label-lg text-label-lg transition-all ' +
          (s.stock > 0 ? 'bg-surface-container text-on-surface hover:bg-surface-container-high cursor-pointer' : 'bg-surface-container text-on-surface-variant opacity-50 cursor-not-allowed');
        b.title = s.stock > 0 ? `${s.stock} unidades disponibles` : 'Agotado';
        b.addEventListener('click', () => {
          if (s.stock <= 0) return toast(`La talla ${s.size} está agotada`, 'error');
          selectSize(s.size, b);
        });
        sizeBox.appendChild(b);
      });
      // preselección
      const firstAvail = sizes.find((s) => s.stock > 0);
      if (firstAvail) {
        const btn = [...sizeBox.querySelectorAll('button')].find((b) => b.textContent.trim() === firstAvail.size);
        selectSize(firstAvail.size, btn);
      }
    }
    // descripción
    patchTextNodes(document.body, /^Diseño estructurado con caída envolvente[\s\S]*$/, () => '');
    const descEl = findElByText('caída envolvente');
    if (descEl && p.description) {
      const anchor = descEl.closest('p, span, div');
      if (anchor) anchor.textContent = p.description;
    }
  }

  // funciones globales usadas por el markup original
  window.selectSize = (size, btn) => {
    selectedSize = size;
    document.querySelectorAll('#size-options .size-btn').forEach((b) => {
      b.classList.remove('bg-primary', 'text-on-primary', 'font-bold', 'shadow-md');
      b.classList.add('bg-surface-container', 'text-on-surface');
    });
    if (btn) {
      btn.classList.remove('bg-surface-container', 'text-on-surface');
      btn.classList.add('bg-primary', 'text-on-primary', 'font-bold', 'shadow-md');
    }
  };
  window.changeMedia = (idx) => {
    if (mainImg && product?.gallery?.[idx]) mainImg.src = product.gallery[idx];
    document.querySelectorAll('.thumb-btn').forEach((t, i) => {
      const ind = t.querySelector('.thumb-indicator');
      if (ind) ind.style.opacity = i === idx ? '1' : '0';
    });
  };
  window.toggleSizeModal = (open) => {
    const modal = $('size-guide-modal');
    if (!modal) return;
    modal.classList.toggle('hidden', !open);
    modal.classList.toggle('flex', open);
    modal.classList.toggle('items-center', open);
    modal.classList.toggle('justify-center', open);
  };

  async function calculateSize() {
    const val = (id) => Number($(id)?.value);
    const height = val('input-height'), weight = val('input-weight'), bust = val('input-bust'), hip = val('input-hip');
    if (!(height || bust)) return toast('Ingresa al menos tu estatura o contorno de busto', 'error');
    try {
      const res = await api('/ai/size', { auth: false, method: 'POST', body: { height, weight, bust, hips: hip } });
      const recEl = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && /Talla S \(98% de precisión\)/.test(el.textContent));
      if (recEl) recEl.textContent = `Talla ${res.size} (${res.confidence}% de precisión)`;
      const msg = findElByText('calce óptimo en función');
      const root = msg ? (msg.closest('div') || document.body) : document.body;
      patchTextNodes(root, /motor biométrico[\s\S]*?precisión\./, res.message.replace(/\*\*/g, ''));
      toast(`Talla recomendada: ${res.size}`, 'straighten');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function initSizeModal() {
    const modal = $('size-guide-modal');
    if (!modal) return;
    const inputs = ['input-height', 'input-weight', 'input-bust', 'input-hip'].map($);
    inputs.forEach((i) => i && i.addEventListener('input', () => calculateSize()));
    const calcBtns = [...modal.querySelectorAll('button')].filter((b) => /calcula|estimar/i.test(b.textContent));
    calcBtns.forEach((b) => b.addEventListener('click', calculateSize));
  }

  function wireActions() {
    const addBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Añadir al Carrito'));
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        if (!product) return;
        if (!selectedSize) return toast('Selecciona primero tu talla', 'straighten');
        addToCart(product.sku, selectedSize);
      });
    }
    const buyBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Comprar en 1 Clic Express'));
    if (buyBtn) {
      buyBtn.addEventListener('click', async () => {
        if (!product) return;
        if (!selectedSize) return toast('Selecciona primero tu talla', 'straighten');
        await addToCart(product.sku, selectedSize);
        const user = getUser();
        if (user && user.role === 'client') location.href = '/carrito-de-compras';
        else toast('Inicia sesión para checkout express', 'login');
      });
    }
    const favBtn = [...document.querySelectorAll('button')].find((b) => b.querySelector('.material-symbols-outlined')?.textContent === 'favorite');
    if (favBtn) {
      favBtn.addEventListener('click', () => {
        const icon = favBtn.querySelector('.material-symbols-outlined');
        const active = icon.style.fontVariationSettings && icon.style.fontVariationSettings.includes("'FILL' 1");
        icon.style.fontVariationSettings = active ? "'FILL' 0" : "'FILL' 1";
        favBtn.classList.toggle('text-primary', !active);
        toast(active ? 'Quitado de favoritos' : 'Guardado en favoritos', 'favorite');
      });
    }
  }

  // ---------- chat estilista ----------
  function wireChat() {
    const box = $('chat-messages');
    const input = $('chat-input');
    if (!box || !input) return;
    const useOwnSend = !input.getAttribute('onkeydown');
    const sendBtn = [...(input.closest('div')?.querySelectorAll('button') || [])].find((b) => b.querySelector('.material-symbols-outlined')?.textContent === 'send') || input.closest('div')?.querySelector('button');

    function bubble(role, text) {
      const row = document.createElement('div');
      row.className = 'flex gap-space-xs items-start max-w-lg';
      if (role === 'user') row.style.justifyContent = 'flex-end';
      row.innerHTML = role === 'user'
        ? `<div class="p-space-sm rounded-2xl rounded-tr-none bg-primary text-on-primary font-body-sm text-body-sm" style="white-space:pre-wrap">${esc(text)}</div>`
        : `<div class="w-7 h-7 rounded-full bg-secondary/15 text-secondary flex items-center justify-center shrink-0 mt-1"><span class="material-symbols-outlined text-sm">smart_toy</span></div>
           <div class="flex flex-col gap-1 max-w-[80%]"><div class="p-space-sm rounded-2xl rounded-tl-none bg-surface-container text-on-surface font-body-sm text-body-sm" style="white-space:pre-wrap">${esc(text).replace(/\*\*/g, '')}</div></div>`;
      box.appendChild(row);
      box.scrollTop = box.scrollHeight;
    }
    function suggestionChips(list) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;padding-left:32px';
      list.forEach((p) => {
        const a = document.createElement('a');
        a.href = `/detalle-de-producto?sku=${encodeURIComponent(p.sku)}`;
        a.textContent = `${p.name} · ${fmtUSD(p.price)}`;
        a.style.cssText = 'font:600 11px/1.2 "Plus Jakarta Sans";padding:6px 10px;border-radius:10px;border:1px solid #f0c1cd;color:#8f0041;text-decoration:none;background:#fff';
        wrap.appendChild(a);
      });
      box.appendChild(wrap);
      box.scrollTop = box.scrollHeight;
    }
    async function send() {
      const msg = input.value.trim();
      if (!msg || !product) return;
      bubble('user', msg);
      input.value = '';
      bubble('assistant', '…');
      try {
        const res = await api('/ai/chat', { auth: false, method: 'POST', body: { message: msg, productContext: product.sku } });
        box.lastChild.remove();
        bubble('assistant', res.reply);
        if (res.suggestions?.length) suggestionChips(res.suggestions);
        const meta = document.createElement('div');
        meta.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;gap:6px;padding:0 0 2px 32px';
        meta.innerHTML = modelChipHtml(res);
        box.appendChild(meta);
        box.scrollTop = box.scrollHeight;
        const pills = document.querySelectorAll('.ai-suggestion-pill, .chat-prompt-pill');
        pills.forEach((p) => p.remove());
      } catch (err) {
        box.lastChild.remove();
        bubble('assistant', 'Ups, no pude responder: ' + err.message);
      }
    }
    window.handleChatSubmit = () => { if (input.value.trim()) send(); };
    window.sendQuickPrompt = (txt) => { input.value = String(txt).trim(); send(); };
    if (useOwnSend) {
      if (sendBtn && !sendBtn.getAttribute('onclick')) sendBtn.addEventListener('click', send);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    }
    document.querySelectorAll('.chat-quick').forEach((p) => p.addEventListener('click', () => { input.value = p.textContent.trim(); }));
  }

  // funciones globales adicionales requeridas por el markup original
  window.selectColor = (name, el) => {
    const label = $('selected-color-name');
    if (label) label.textContent = name;
    document.querySelectorAll('.color-swatch').forEach((sw) => {
      const on = sw === el;
      sw.classList.toggle('scale-110', on);
      sw.classList.toggle('shadow-sm', on);
      const chk = sw.querySelector('.material-symbols-outlined');
      if (chk) chk.classList.toggle('hidden', !on);
    });
  };
  window.applySmartSize = (sz) => {
    const btn = [...document.querySelectorAll('#size-options .size-btn')].find((b) => b.textContent.trim() === sz);
    if (btn) btn.click();
    else toast(`Talla ${sz} no disponible`, 'error');
  };
  window.switchTab = (tab) => {
    document.querySelectorAll('.tab-pane').forEach((p) => {
      p.style.display = p.id === `tab-${tab}` ? '' : 'none';
    });
    document.querySelectorAll('.product-tab-btn').forEach((b) => {
      const on = b.textContent.includes({ desc: 'Descripción', comp: 'Materiales', care: 'Cuidados', ship: 'Envíos' }[tab] || '');
      b.classList.toggle('bg-primary', on);
      b.classList.toggle('text-on-primary', on);
      b.classList.toggle('shadow-sm', on);
      b.classList.toggle('bg-surface-container', !on);
      b.classList.toggle('text-on-surface-variant', !on);
    });
  };

  async function init() {
    const params = new URLSearchParams(location.search);
    const sku = params.get('sku') || 'VM-DAM-ATELIER';
    try {
      const { product: p } = await api(`/products/${encodeURIComponent(sku)}`);
      product = p;
      setProductData(p);
    } catch (err) {
      toast('Producto no encontrado: ' + err.message, 'error');
      document.querySelector('h1, h2') && (document.querySelector('h1, h2').textContent = 'Producto no disponible');
    }
    wireActions();
    wireChat();
    initSizeModal();
    refreshCartBadge();
    const user = getUser();
    if (user) window.VM.refreshMe().then((u) => paintUserChip(u));
  }

  init();
})();
