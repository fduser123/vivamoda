/* ============================================================
   VivaModa · helpers comunes para los frontends conectados
   ============================================================ */
(function () {
  const API = '/api';
  const TOKEN_KEY = 'vm_token';
  const USER_KEY = 'vm_user';
  const CART_KEY = 'vm_cart_guest';

  // ---------- utilidades ----------
  // La tienda opera en USD: 1 decimal no, 2 cuando se piden (o siempre que el valor no sea entero)
  function fmtUSD(n, decimals) {
    const v = Number(n || 0);
    const useDecimals = decimals === undefined ? !Number.isInteger(v) : Boolean(decimals);
    return '$' + v.toLocaleString('en-US', {
      minimumFractionDigits: useDecimals ? 2 : 0,
      maximumFractionDigits: useDecimals ? 2 : 0,
    });
  }
  const fmtCOP = fmtUSD; // alias retrocompatible
  function fmtQty(n) { return Number(n || 0).toLocaleString('es-CO'); }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function initials(name) {
    return String(name || '?').split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  }
  function timeAgo(iso) {
    if (!iso) return '';
    const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return 'hace un momento';
    const m = Math.floor(s / 60);
    if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    return d === 1 ? 'ayer' : `hace ${d} días`;
  }
  function qs(params = {}) {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, v);
    const s = u.toString();
    return s ? `?${s}` : '';
  }

  // ---------- sesión ----------
  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setSession(token, user) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user || null));
    window.dispatchEvent(new CustomEvent('vm:auth'));
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new CustomEvent('vm:auth'));
  }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  }

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* vacío */ }
    if (!res.ok) {
      const err = new Error(data.error || `Error ${res.status}`);
      err.code = data.code;
      err.status = res.status;
      if (res.status === 401 && path !== '/auth/login') clearSession();
      throw err;
    }
    return data;
  }

  async function refreshMe() {
    try {
      const { user } = await api('/auth/me');
      setSession(getToken(), user);
      return user;
    } catch {
      return null;
    }
  }

  /** Navegación por rol */
  function homeForRole(role) {
    return role === 'staff' ? '/pedidos-y-pos' : role === 'admin' ? '/panel-de-almacen-y-ventas' : '/catalogo-de-productos';
  }

  /** Guard: roles permitidos o redirige al login */
  async function requireRole(...roles) {
    const user = getUser();
    if (user && roles.includes(user.role)) return user;
    if (!user) {
      const fresh = await refreshMe();
      if (fresh && roles.includes(fresh.role)) return fresh;
    }
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/iniciar-sesion?next=${next}`;
    return null;
  }

  // ---------- carrito (badge del header en páginas de tienda) ----------
  const guestCart = {
    get() { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; } },
    add(item) { const c = this.get(); c.push(item); localStorage.setItem(CART_KEY, JSON.stringify(c)); this.bump(); },
    clear() { localStorage.removeItem(CART_KEY); this.bump(); },
    count() { return this.get().length; },
    bump() { window.dispatchEvent(new CustomEvent('vm:cart')); },
  };

  function updateCartBadge(force = 0) {
    const user = getUser();
    const badge = document.querySelector('a[data-path="carrito-de-compras"] .rounded-full, a[href="/carrito-de-compras"] .rounded-full');
    if (!badge) return;
    let n = force;
    if (force === 0) n = user ? Number(localStorage.getItem('vm_cart_count') || 0) : guestCart.count();
    badge.textContent = String(n);
    badge.classList.toggle('animate-pulse', n > 0);
  }

  async function refreshCartBadge() {
    const user = getUser();
    if (user && user.role === 'client') {
      try {
        const cart = await api('/cart');
        localStorage.setItem('vm_cart_count', String(cart.count));
        updateCartBadge(cart.count);
        return cart;
      } catch { /* sin sesión */ }
    }
    updateCartBadge();
    return null;
  }

  async function addToCart(sku, size, qty = 1) {
    const user = getUser();
    if (user && user.role === 'client') {
      try {
        const cart = await api('/cart/items', { method: 'POST', body: { sku, size, qty } });
        localStorage.setItem('vm_cart_count', String(cart.count));
        updateCartBadge(cart.count);
        toast('Agregado a tu bolsa', 'check_circle');
        return true;
      } catch (err) {
        toast(err.message, 'error');
        return false;
      }
    }
    guestCart.add({ sku, size, qty });
    updateCartBadge();
    toast('Agregado a tu bolsa (invitado)', 'check_circle');
    return true;
  }

  // ---------- identidad del usuario en el header ----------
  function paintUserChip(user) {
    const chip = document.querySelector('a[data-path="perfil-de-usuario"]');
    if (!chip) return;
    if (!user) {
      // sesión anónima → muestra acceso
      const wrap = chip.parentElement;
      chip.setAttribute('href', '/iniciar-sesion');
      chip.innerHTML = `<span class="material-symbols-outlined text-[20px] text-primary">login</span>
        <span class="hidden md:block font-label-sm text-label-sm">Iniciar Sesión</span>`;
      if (wrap) {
        const gold = chip.querySelector('.font-label-sm + .font-label-sm');
        if (gold) gold.remove();
      }
      return;
    }
    const nameEl = chip.querySelector('.font-label-md, span.font-label-md');
    if (nameEl) nameEl.textContent = user.fullName;
    const sub = [...chip.querySelectorAll('span')].find((s) => /Socio|Gold|Classic|Staff|Admin/i.test(s.textContent));
    if (sub) sub.textContent = user.vipTier && user.role === 'client' ? `Socio ${user.vipTier}` : user.role === 'staff' ? user.employeeCode || 'Staff' : 'Admin';
    const img = chip.querySelector('img');
    if (img) {
      img.src = '';
      img.removeAttribute('src');
      img.style.background = 'linear-gradient(135deg,#b60055,#4b41e1)';
      img.style.display = 'flex';
      img.style.alignItems = 'center';
      img.style.justifyContent = 'center';
      img.style.color = '#fff';
      img.style.fontWeight = '700';
      img.alt = user.fullName;
      img.src = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="%23b60055"/><text x="32" y="41" font-size="22" font-family="Arial" fill="white" text-anchor="middle" font-weight="bold">${initials(user.fullName)}</text></svg>`)}`;
    }
  }

  // ---------- toast ----------
  function toast(message, icon = 'info', title) {
    let box = document.getElementById('vm-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'vm-toast';
      box.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:8px;background:#1c1b1d;color:#fff;padding:10px 16px;border-radius:12px;font:600 13px/1.2 "Plus Jakarta Sans",sans-serif;box-shadow:0 10px 24px rgba(0,0,0,.18);animation:vmfade .2s ease';
    el.innerHTML = icon ? `<span class="material-symbols-outlined" style="font-size:18px;color:${icon === 'error' ? '#ffb4ab' : '#7ef0b0'}">${icon === 'error' ? 'error' : icon}</span>` : '';
    el.appendChild(document.createTextNode(message));
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 420); }, 3200);
  }
  const style = document.createElement('style');
  style.textContent = '@keyframes vmfade{from{opacity:0;transform:translateY(8px)}to{opacity:1}}';
  document.head.appendChild(style);

  // ---------- IA: indicador del modelo activo ----------
  const LOCAL_AI_LABEL = 'aria-local-v1 (motor VivaModa)';
  function modelShortName(model) {
    if (!model || model === LOCAL_AI_LABEL) return 'Motor local';
    const tail = String(model).split('/').pop();
    if (/llama/i.test(tail)) return 'Llama · OpenRouter';
    if (/gpt|o\d|openai/i.test(tail)) return 'GPT · OpenRouter';
    if (/claude/i.test(tail)) return 'Claude · OpenRouter';
    if (/mistral|mixtral/i.test(tail)) return 'Mistral · OpenRouter';
    if (/gemma/i.test(tail)) return 'Gemma · OpenRouter';
    if (/deepseek/i.test(tail)) return 'DeepSeek · OpenRouter';
    if (/qwen/i.test(tail)) return 'Qwen · OpenRouter';
    return tail.replace(/[-_]/g, ' ').slice(0, 24) + ' · OpenRouter';
  }
  /** Etiqueta pequeña que se añade bajo cada burbuja del asistente */
  function modelChipHtml(res) {
    const isLocal = !res || !res.model || res.model === LOCAL_AI_LABEL;
    const color = isLocal ? '#6b7280' : '#059669';
    const icon = isLocal ? 'settings_suggest' : 'auto_awesome';
    const title = isLocal
      ? 'Respuesta generada por el motor de reglas local (LLM no disponible)'
      : 'Respuesta generada por ' + (res.model || 'LLM') + ' vía OpenRouter';
    const err = res && res.llmError ? ` · fallback: ${esc(String(res.llmError).slice(0, 60))}` : '';
    return `<span class="vm-model-chip" title="${esc(title)}${esc(err)}" style="display:inline-flex;align-items:center;gap:3px;font:600 10px/1 'Plus Jakarta Sans',sans-serif;color:${color};background:${color}14;border:1px solid ${color}33;border-radius:8px;padding:3px 7px;letter-spacing:.2px"><span class="material-symbols-outlined" style="font-size:11px">${icon}</span>${modelShortName(res && res.model)}${err}</span>`;
  }

  // ---------- helpers DOM ----------
  function findRow(container, needle) {
    // ubica un elemento cuyo texto contiene needle y retorna el ancestro más cercano con class 'flex' etc
    return [...container.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.trim().includes(needle));
  }
  function elFromText(needle) {
    return [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent.includes(needle));
  }
  function closestByTag(start, tag) {
    let n = start;
    while (n && n.tagName !== tag.toUpperCase()) n = n.parentElement;
    return n;
  }
  function plural(n, singular, pluralW) { return `${n} ${n === 1 ? singular : pluralW}`; }

  // ---------- rutas amigables de la navegación ----------
  const ROUTES = {
    'catalogo-de-productos': '/catalogo-de-productos', 'catalogo-caballeros': '/catalogo-caballeros',
    'catalogo-ninos': '/catalogo-ninos', 'novedades': '/novedades', 'ofertas-flash': '/ofertas-flash',
    'detalle-de-producto': '/detalle-de-producto?sku=VM-DAM-ATELIER', 'hub-agente-ia': '/hub-agente-ia',
    'tienda-virtual-realidad': '/tienda-virtual-realidad',
    'pedidos-y-pos': '/pedidos-y-pos', 'panel-de-almacen-y-ventas': '/panel-de-almacen-y-ventas',
    'iniciar-sesion': '/iniciar-sesion', 'lista-de-deseos': '/lista-de-deseos', 'carrito-de-compras': '/carrito-de-compras',
    'perfil-de-usuario': '/perfil-de-usuario', 'seguimiento-de-pedidos': '/seguimiento-de-pedidos',
    'politica-de-devoluciones': '/politica-de-devoluciones', 'sucursales-y-tiendas': '/sucursales-y-tiendas',
    'guia-de-tallas': '/guia-de-tallas',
  };
  function fixLinks() {
    document.querySelectorAll('a[data-path]').forEach((a) => {
      const dp = a.dataset.path;
      if (ROUTES[dp] && a.getAttribute('href') === '#') a.setAttribute('href', ROUTES[dp]);
    });
  }

  window.VM = {
    api, refreshMe, getUser, getToken, setSession, clearSession, requireRole, homeForRole, ROUTES, fixLinks,
    fmtUSD, fmtCOP, fmtQty, esc, initials, timeAgo, qs, toast, addToCart, updateCartBadge, refreshCartBadge,
    modelShortName, modelChipHtml,
    paintUserChip, guestCart, elFromText, closestByTag, plural,
  };

  // Al cargar: rutas, identidad y badge
  document.addEventListener('DOMContentLoaded', () => {
    fixLinks();
    paintUserChip(getUser());
    // Banners estáticos de los mockups: la tienda opera en USD (envío gratis > $49.99)
    document.querySelectorAll('span,div').forEach((el) => {
      if (el.children.length === 0 && /env[ií]os express gratis.*\$49\.900/i.test(el.textContent)) {
        el.textContent = el.textContent.replace(/\$49\.900/g, '$49.99');
      }
    });
    updateCartBadge();
  });
})();
