/* Catálogo en vivo: render desde /api/products con filtros locales */
(function () {    const { api, fmtUSD, esc, qs, toast, addToCart, refreshCartBadge, paintUserChip, getUser, modelChipHtml } = window.VM;

  // ---------- ruta → filtros iniciales ----------
  function initialFromPath() {
    const p = location.pathname;
    if (p === '/catalogo-caballeros') return { gender: 'caballeros' };
    if (p === '/catalogo-ninos') return { gender: 'ninos' };
    if (p === '/novedades') return { novedades: true };
    if (p === '/ofertas-flash') return { ofertas: true };
    return {};
  }
  const initial = initialFromPath();

  const state = {
    all: [],
    gender: initial.gender || 'todos',
    categories: [],       // nombres de categoría activos
    q: '',
    size: null,
    maxPrice: 150000,
    priceLimit: 150000,
    sort: 'pop',
    novedades: !!initial.novedades,
    ofertas: !!initial.ofertas,
    view: 'grid',
  };

  const $ = (id) => document.getElementById(id);
  const grid = $('catalogGrid');
  const counter = $('productCounter');
  const searchInput = $('searchInput');
  const clearSearch = $('clearSearch');
  const sortBy = $('sortBy');
  const priceRange = $('priceRange');
  const priceDisplay = $('priceDisplay');

  function matches(p) {
    if (state.gender !== 'todos' && p.gender !== state.gender) return false;
    if (state.categories.length && !state.categories.includes(p.category)) return false;
    if (state.novedades && !(p.isNew || p.badge === 'Nuevo')) return false;
    if (state.ofertas && !(p.compareAt || /flash|pack/i.test(p.badge || ''))) return false;
    if (state.q) {
      const hay = `${p.name} ${p.category} ${p.sku} ${p.badge || ''}`.toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    if (state.size && !(p.sizes || []).includes(state.size)) return false;
    if (p.price > state.maxPrice) return false;
    return true;
  }
  function sorted(list) {
    const arr = [...list];
    if (state.sort === 'price-asc') arr.sort((a, b) => a.price - b.price);
    else if (state.sort === 'price-desc') arr.sort((a, b) => b.price - a.price);
    else if (state.sort === 'news') arr.sort((a, b) => (b.isNew - a.isNew) || b.id - a.id);
    else arr.sort((a, b) => (b.reviewCount - a.reviewCount) || b.rating - a.rating);
    return arr;
  }

  const discountPct = (p) => (p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0);
  const badgeLabel = (p) => {
    if (p.compareAt) return `-${discountPct(p)}%`;
    return p.badge || '';
  };

  function card(p) {
    const sizesOk = (p.sizes || []).length;
    const stockOk = p.stockTotal > 0;
    return `
    <article class="group relative flex flex-col bg-surface-container-lowest rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300" data-sku="${esc(p.sku)}">
      <a class="relative block overflow-hidden bg-surface-container aspect-[4/5]" href="/detalle-de-producto?sku=${esc(p.sku)}">
        ${p.badge || p.compareAt ? `<span class="absolute top-space-xs left-space-xs z-10 px-2 py-0.5 rounded-full ${p.compareAt ? 'bg-error text-on-error' : 'bg-primary text-on-primary'} font-label-sm text-label-sm uppercase tracking-wide shadow-sm">${esc(badgeLabel(p))}</span>` : ''}
        ${p.image
          ? `<img class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"/>`
          : `<div class="w-full h-full flex items-center justify-center text-on-surface-variant"><span class="material-symbols-outlined text-5xl">checkroom</span></div>`}
      </a>
      <button class="like-btn absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-surface-container-lowest/90 backdrop-blur flex items-center justify-center text-on-surface-variant hover:text-primary transition-all shadow-sm" title="Guardar en deseos" type="button">
        <span class="material-symbols-outlined text-[18px]">favorite</span>
      </button>
      <div class="flex flex-col gap-1.5 p-space-md flex-1">
        <div class="flex items-center justify-between">
          <span class="font-label-sm text-label-sm uppercase tracking-wide text-on-surface-variant">${esc(p.gender === 'ninos' ? 'Niños' : p.gender.charAt(0).toUpperCase() + p.gender.slice(1))} · ${esc(p.category)}</span>
          <span class="flex items-center gap-0.5 font-label-sm text-label-sm text-on-surface-variant">
            <span class="material-symbols-outlined text-[14px] text-amber-500" style="font-variation-settings:'FILL' 1">star</span>
            <b class="text-on-surface">${p.rating}</b> (${p.reviewCount})
          </span>
        </div>
        <a class="font-headline-sm text-headline-sm text-on-surface leading-snug hover:text-primary transition-colors line-clamp-2" href="/detalle-de-producto?sku=${esc(p.sku)}">${esc(p.name)}</a>
        <div class="flex items-center gap-2 mt-auto pt-1">
          <span class="font-price-prominent text-price-prominent text-primary">${fmtUSD(p.price)}</span>
          ${p.compareAt ? `<span class="font-label-sm text-label-sm text-on-surface-variant line-through">${fmtUSD(p.compareAt)}</span>` : ''}
        </div>
        <button class="add-to-cart-btn mt-1 w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-primary/30 text-primary font-label-lg text-label-lg hover:bg-primary hover:text-on-primary transition-all ${stockOk ? '' : 'opacity-50 cursor-not-allowed'}" data-sku="${esc(p.sku)}" data-size="${esc(sizesOk ? p.sizes[0] : 'U')}" type="button" ${stockOk ? '' : 'disabled'}>
          <span class="material-symbols-outlined text-[16px]">shopping_bag</span>
          <span>${stockOk ? 'Añadir a la Bolsa' : 'Agotado'}</span>
        </button>
      </div>
    </article>`;
  }

  function render() {
    const visible = sorted(state.all.filter(matches));
    grid.innerHTML = visible.length ? visible.map(card).join('') : `
      <div class="col-span-full flex flex-col items-center gap-2 py-16 text-center text-on-surface-variant">
        <span class="material-symbols-outlined text-5xl">search_off</span>
        <p class="font-headline-sm text-headline-sm text-on-surface">No encontramos prendas</p>
        <p class="font-body-sm text-body-sm">Prueba con otros filtros o palabras clave.</p>
      </div>`;
    counter.textContent = `${visible.length} prendas`;
    if (!visible.length) return;
    paintLikes();
  }

  function paintLikes() {
    grid.querySelectorAll('.like-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const icon = btn.querySelector('.material-symbols-outlined');
        const active = icon.style.fontVariationSettings && icon.style.fontVariationSettings.includes("'FILL' 1");
        icon.style.fontVariationSettings = active ? "'FILL' 0" : "'FILL' 1";
        btn.classList.toggle('text-primary', !active);
        if (!active) toast('Guardado en deseos', 'favorite');
      });
    });
  }

  async function loadDepartments() {
    try {
      const { nav } = await api('/categories');
      const box = document.querySelector('#catalogGrid')?.closest('main');
      // contenedor del bloque Departamentos
      const span = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Departamentos');
      const wrap = span && closestByTag(span, 'div');
      if (!wrap || !nav) return;
      const container = [...wrap.parentElement.children].find((el) => el !== span && el.tagName === 'DIV' || (el.children && el !== span));
      if (!container) return;
      container.innerHTML = nav.map((g) => `
        <details class="group" ${state.gender === g.gender || state.gender === 'todos' && g.gender === 'damas' ? 'open' : ''}>
          <summary class="flex items-center justify-between cursor-pointer py-1 text-on-surface font-label-md text-label-md">
            <span>${g.label} (${g.total})</span>
            <span class="material-symbols-outlined text-sm group-open:rotate-180 transition-transform">expand_more</span>
          </summary>
          <div class="pl-space-sm flex flex-col gap-1 py-1">
            ${g.categories.map((c) => `
              <label class="flex items-center gap-2 cursor-pointer hover:text-primary">
                <input type="checkbox" value="${esc(c.name)}" class="accent-primary rounded cat-check" ${state.categories.includes(c.name) ? 'checked' : ''}/>
                ${esc(c.name)} (${c.total})
              </label>`).join('')}
          </div>
        </details>`).join('');
      container.querySelectorAll('.cat-check').forEach((cb) => {
        cb.addEventListener('change', () => {
          const name = cb.value;
          if (cb.checked) state.categories.push(name);
          else state.categories = state.categories.filter((c) => c !== name);
          render();
        });
      });
    } catch { /* sin departamentos */ }
  }
  function closestByTag(start, tag) {
    let n = start;
    while (n && n.tagName !== tag.toUpperCase()) n = n.parentElement;
    return n;
  }

  async function init() {
    try {
      const res = await api('/products?limit=200');
      state.all = res.items;
    } catch (err) {
      toast('No se pudo cargar el catálogo: ' + err.message, 'error');
    }
    // precio máximo dinámico (al menos 150k)
    if (state.all.length) {
    const maxP = Math.max(150, ...state.all.map((p) => p.price));
      state.priceLimit = maxP;
      state.maxPrice = maxP;
      if (priceRange) { priceRange.max = maxP; priceRange.value = maxP; }
      if (priceDisplay) priceDisplay.textContent = `Hasta ${fmtUSD(maxP)}`;
    }
    render();
    await loadDepartments();
  }

  // ---------- eventos ----------
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.q = e.target.value.toLowerCase().trim();
      clearSearch && clearSearch.classList.toggle('hidden', !state.q);
      render();
    });
    clearSearch && clearSearch.addEventListener('click', () => {
      searchInput.value = '';
      state.q = '';
      clearSearch.classList.add('hidden');
      render();
    });
  }
  if (sortBy) sortBy.addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  if (priceRange && priceDisplay) {
    priceRange.addEventListener('input', (e) => {
      state.maxPrice = Number(e.target.value);
      priceDisplay.textContent = `Hasta ${fmtUSD(state.maxPrice)}`;
      render();
    });
  }
  // tallas
  const SIZE_MAP = { XS: 'XS', S: 'S', M: 'M', L: 'L', XL: 'XL', XXL: 'XXL', '4-6a': '6A', '8-10a': '10A', '12-14a': '10A' };
  document.querySelectorAll('.size-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const active = chip.classList.contains('bg-primary');
      document.querySelectorAll('.size-chip').forEach((c) => {
        c.classList.remove('bg-primary', 'text-on-primary', 'shadow-sm');
        c.classList.add('bg-surface-container', 'text-on-surface');
      });
      if (active) { state.size = null; return; }
      chip.classList.remove('bg-surface-container', 'text-on-surface');
      chip.classList.add('bg-primary', 'text-on-primary', 'shadow-sm');
      state.size = SIZE_MAP[chip.textContent.trim()] || chip.textContent.trim().toUpperCase();
      render();
    });
  });
  // vista cuadrícula / lista
  const viewGrid = $('viewGrid');
  const viewList = $('viewList');
  if (viewGrid && viewList) {
    const applyView = (mode) => {
      state.view = mode;
      const isList = mode === 'list';
      grid.classList.toggle('grid-cols-1', isList);
      grid.classList.toggle('sm:grid-cols-2', !isList);
      grid.classList.toggle('xl:grid-cols-3', !isList);
      viewGrid.classList.toggle('bg-surface-container-lowest', !isList);
      viewGrid.classList.toggle('text-primary', !isList);
      viewGrid.classList.toggle('shadow-sm', !isList);
      viewList.classList.toggle('bg-surface-container-lowest', isList);
      viewList.classList.toggle('text-primary', isList);
      viewList.classList.toggle('shadow-sm', isList);
    };
    viewGrid.addEventListener('click', () => applyView('grid'));
    viewList.addEventListener('click', () => applyView('list'));
  }
  // agregar al carrito (delegación)
  grid && grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.add-to-cart-btn');
    if (btn && !btn.disabled) {
      e.preventDefault();
      addToCart(btn.dataset.sku, btn.dataset.size || 'U');
    }
  });
  // botón limpiar filtros
  const reset = document.getElementById('resetFilters');
  if (reset) reset.addEventListener('click', () => {
    state.categories = []; state.size = null; state.maxPrice = state.priceLimit; state.q = '';
    if (searchInput) searchInput.value = '';
    if (clearSearch) clearSearch.classList.add('hidden');
    if (priceRange) { priceRange.value = state.priceLimit; }
    if (priceDisplay) priceDisplay.textContent = `Hasta ${fmtUSD(state.priceLimit)}`;
    document.querySelectorAll('.size-chip').forEach((c) => { c.classList.add('bg-surface-container'); c.classList.remove('bg-primary', 'text-on-primary'); });
    document.querySelectorAll('.cat-check').forEach((c) => { c.checked = false; });
    render();
  });

  // ---------- header: rutas amigables + estado de navegación ----------
  const ROUTES = {
    'catalogo-de-productos': '/catalogo-de-productos', 'catalogo-caballeros': '/catalogo-caballeros',
    'catalogo-ninos': '/catalogo-ninos', 'novedades': '/novedades', 'ofertas-flash': '/ofertas-flash',
    'detalle-de-producto': '/detalle-de-producto?sku=VM-DAM-ATELIER', 'hub-agente-ia': '/hub-agente-ia',
    'pedidos-y-pos': '/pedidos-y-pos', 'panel-de-almacen-y-ventas': '/panel-de-almacen-y-ventas',
    'iniciar-sesion': '/iniciar-sesion', 'lista-de-deseos': '/lista-de-deseos', 'carrito-de-compras': '/carrito-de-compras',
    'perfil-de-usuario': '/perfil-de-usuario', 'seguimiento-de-pedidos': '/seguimiento-de-pedidos',
    'politica-de-devoluciones': '/politica-de-devoluciones', 'sucursales-y-tiendas': '/sucursales-y-tiendas', 'guia-de-tallas': '/guia-de-tallas',
  };
  document.querySelectorAll('a[data-path]').forEach((a) => {
    const dp = a.dataset.path;
    if (ROUTES[dp]) a.setAttribute('href', ROUTES[dp]);
  });
  // activa el nav según filtro actual
  const navLinks = document.querySelectorAll('nav a[data-path]');
  const activePath = location.pathname === '/catalogo-caballeros' ? '/catalogo-caballeros'
    : location.pathname === '/catalogo-ninos' ? '/catalogo-ninos'
    : location.pathname === '/novedades' ? '/novedades'
    : location.pathname === '/ofertas-flash' ? '/ofertas-flash' : '/catalogo-de-productos';
  navLinks.forEach((a) => {
    const matches = new URL(a.href, location.origin).pathname === activePath && !/ateli/i.test(a.href);
    a.classList.toggle('bg-primary', matches);
    a.classList.toggle('text-on-primary', matches);
    a.classList.toggle('rounded-lg', matches);
    a.classList.toggle('font-bold', matches);
    a.classList.toggle('shadow-sm', matches);
  });

  // ---------- widget de chat IA flotante ----------
  const dialog = document.getElementById('aiChatDialog');
  const input = document.getElementById('aiChatInput');
  const sendBtn = document.getElementById('sendAiMessage');
  if (dialog && input) {
    const body = dialog.querySelector('.flex.flex-col') || dialog;
    const messagesEl = body.querySelector('#aiChatMessages') || body;
    // crear área de mensajes si no existe
    let area = document.getElementById('aiChatMessages');
    if (!area) {
      area = document.createElement('div');
      area.id = 'aiChatMessages';
      area.style.cssText = 'max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:8px';
      const contentBox = [...dialog.querySelectorAll('div')].find((d) => /Hola! Soy/i.test(d.textContent) && d.querySelector) || null;
      if (contentBox) {
        const wrapper = closestByTag(contentBox, 'div');
        if (wrapper && wrapper.parentElement) {
          wrapper.style.display = 'none';
          wrapper.parentElement.insertBefore(area, wrapper.nextSibling);
        }
      } else {
        dialog.appendChild(area);
      }
      appendMsg('assistant', '¡Hola! Soy Aria, tu estilista VivaModa ✨ ¿Qué evento o estilo tienes en mente para deslumbrar hoy?');
    }
    function appendMsg(role, text) {
      const row = document.createElement('div');
      row.style.cssText = `align-self:${role === 'user' ? 'flex-end' : 'flex-start'};max-width:85%;padding:8px 12px;border-radius:14px;font:400 13px/1.45 "Plus Jakarta Sans",sans-serif;${role === 'user' ? 'background:#b60055;color:#fff;border-bottom-right-radius:4px' : 'background:#f0edf0;color:#1c1b1d;border-bottom-left-radius:4px'}`;
      row.textContent = text.replace(/\*\*/g, '');
      area.appendChild(row);
      area.scrollTop = area.scrollHeight;
    }
    async function send() {
      const msg = input.value.trim();
      if (!msg) return;
      appendMsg('user', msg);
      input.value = '';
      appendMsg('assistant', 'Escribiendo…');
      try {
        const res = await window.VM.api('/ai/chat', { auth: false, method: 'POST', body: { message: msg, productContext: location.search ? new URLSearchParams(location.search).get('sku') : null } });
        area.lastChild.remove();
        appendMsg('assistant', res.reply.replace(/\*\*/g, ''));
        if (res.suggestions && res.suggestions.length) {
          res.suggestions.forEach((p) => {
            const chip = document.createElement('a');
            chip.setAttribute('href', `/detalle-de-producto?sku=${encodeURIComponent(p.sku)}`);
            chip.textContent = `${p.name} · ${fmtUSD(p.price)}`;
            chip.style.cssText = 'align-self:flex-start;padding:6px 10px;border-radius:10px;border:1px solid #e5c0c9;color:#8f0041;font:600 12px "Plus Jakarta Sans";text-decoration:none;background:#fff';
            area.appendChild(chip);
          });
        }
        const meta = document.createElement('div');
        meta.style.cssText = 'align-self:flex-end;font:600 10px/1 "Plus Jakarta Sans",sans-serif;color:#059669;background:#05966914;border:1px solid #05966933;border-radius:8px;padding:3px 7px;display:inline-flex;align-items:center;gap:3px';
        meta.innerHTML = modelChipHtml(res);
        area.appendChild(meta);
      } catch (err) {
        area.lastChild.remove();
        appendMsg('assistant', 'Ups, no pude responder: ' + err.message);
      }
    }
    sendBtn && sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    document.querySelectorAll('.chat-prompt-pill').forEach((pill) => {
      pill.addEventListener('click', () => { input.value = pill.textContent.trim(); send(); });
    });
  }

  // ---------- identidad / badge ----------
  refreshCartBadge();
  const user = getUser();
  if (user) window.VM.refreshMe().then((u) => paintUserChip(u));
  document.addEventListener('vm:auth', () => { paintUserChip(getUser()); refreshCartBadge(); });

  init();
})();
