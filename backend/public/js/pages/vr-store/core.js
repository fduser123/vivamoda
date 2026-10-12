/* ============================================================
   VivaModa · Tienda VR — NÚCLEO
   Motor 3D (Three.js), paleta, zonas, catálogo y orquestador
   de "partes" de la tienda. Cada módulo registra una parte con
   VRStore.part('nombre', fn) y el núcleo la construye en orden.
   ============================================================ */
window.VRStore = (function () {
  const S = {};

  // ── Paleta VivaModa ─────────────────────────────────────
  S.VM = {
    primary: 0xe4006c,
    primaryDeep: 0xb60055,
    secondary: 0x4b41e1,
    bg: 0x170f1c,
    floor: 0xf4ebf0,
    wall: 0x241724,
    dark: 0x1c121f,
  };

  // ── Zonas de la tienda ──────────────────────────────────
  S.ZONES = [
    { id: 'damas', label: 'Damas', color: '#e4006c', zone: 0xe4006c, pos: { x: 0, z: -7.4 }, view: { p: [0, 3.1, 8.8], t: [0, 1.9, -4.4] } },
    { id: 'caballeros', label: 'Caballeros', color: '#2f54d0', zone: 0x2f54d0, pos: { x: -6.8, z: -7.4 }, view: { p: [-8.6, 3.0, 8.0], t: [-6.8, 1.8, -6.4] } },
    { id: 'ninos', label: 'Niños', color: '#f0a832', zone: 0xf0a832, pos: { x: 6.8, z: -7.4 }, view: { p: [8.6, 3.0, 8.0], t: [6.8, 1.6, -6.4] } },
    { id: 'novedades', label: 'Novedades', color: '#ff8a3c', zone: 0xff8a3c, pos: { x: -10.8, z: 0.6 }, view: { p: [-12.2, 2.9, 7.4], t: [-10.6, 1.2, 0.9] } },
    { id: 'ofertas', label: 'Ofertas Flash', color: '#ff4d4d', zone: 0xff4d4d, pos: { x: 10.8, z: 0.6 }, view: { p: [12.2, 2.9, 7.4], t: [10.6, 1.2, 0.9] } },
    // Vitrina del catálogo interno (almacén/POS): productos que NO están en la
    // vitrina pública. No se cuelga con las demás: mk-ropa le monta su propia
    // vitrina y corrige aquí `pos`/`view` cuando sabe dónde ha cabido.
    { id: 'interno', label: 'Catálogo interno', color: '#6c5ce7', zone: 0x6c5ce7, pos: { x: 46.5, z: -6.0 }, view: { p: [43.0, 2.4, -6.0], t: [46.5, 1.6, -6.0] } },
  ];

  // ── Catálogo (productos reales del seed VivaModa) ──────
  S.CATALOG = [
    { sku: 'VM-DAM-ATELIER', name: 'Vestido Asimétrico Magenta Atelier', category: 'Vestidos de Noche', color: 'Magenta Eléctrico', price: 189900, compareAt: 249900, badge: 'Edición Limitada', zone: 'damas', c3d: 0xe4006c, emoji: '👗' },
    { sku: 'VM-DAM-8870', name: 'Conjunto Blazer & Pantalón Cobalt', category: 'Oficina', color: 'Cobalt', price: 119000, badge: 'Top Ventas', zone: 'damas', c3d: 0x2447c9, emoji: '👔' },
    { sku: 'VM-DAM-8810', name: 'Vestido Satinado Fuchsia Night', category: 'Fiesta', color: 'Fuchsia', price: 49900, zone: 'damas', c3d: 0xe4006c, emoji: '👗' },
    { sku: 'VM-DAM-8840', name: 'Abrigo Oversized Magenta Wool', category: 'Abrigos', color: 'Magenta', price: 89900, zone: 'damas', c3d: 0xb60055, emoji: '🧥' },
    { sku: 'VM-CAB-8880', name: 'Bomber Jacket Stealth Pro', category: 'Athleisure', color: 'Negro Stealth', price: 69900, zone: 'caballeros', c3d: 0x2a2f3a, emoji: '🧥' },
    { sku: 'VM-CAB-8820', name: 'Blazer Índigo Desestructurado', category: 'Sastrería', color: 'Índigo', price: 79900, zone: 'caballeros', c3d: 0x3b4b9e, emoji: '🤵' },
    { sku: 'VM-CAB-8850', name: 'Camisa Oxford Cuello Mao', category: 'Casual', color: 'Blanco Hueso', price: 39900, zone: 'caballeros', c3d: 0xe9e4da, emoji: '👔' },
    { sku: 'VM-NIN-8890', name: 'Hoodie Colorblock Active Kids', category: 'Streetwear', color: 'Multicolor', price: 27900, zone: 'ninos', c3d: 0xf0a832, emoji: '🧒' },
    { sku: 'VM-NIN-8830', name: 'Chaqueta Utility Terra Kids', category: 'Urbano', color: 'Terra', price: 34900, zone: 'ninos', c3d: 0xa9714b, emoji: '🧥' },
    { sku: 'VM-NIN-8860', name: 'Vestido Plisado Soft Blossom', category: 'Vestidos', color: 'Soft Blossom', price: 29900, zone: 'ninos', c3d: 0xf49fb6, emoji: '🎀' },
    { sku: 'VM-CAL-8811', name: 'Stiletto Vernice Noir 95mm', category: 'Calzado', color: 'Negro Laca', price: 79900, badge: 'Look IA', zone: 'novedades', c3d: 0x111111, emoji: '👠' },
    { sku: 'VM-ACC-8812', name: 'Clutch Geométrico Brass Doré', category: 'Accesorios', color: 'Brass Doré', price: 49900, badge: 'Look IA', zone: 'novedades', c3d: 0xd4af37, emoji: '👜' },
    { sku: 'VM-ACC-006', name: 'Cinturón Cuero Magenta', category: 'Accesorios', color: 'Magenta', price: 49000, zone: 'novedades', c3d: 0xa02a5e, emoji: '📿' },
    { sku: 'VM-DAM-8942', name: 'Vestido Satinado Drapeado', category: 'Vestidos', color: 'Satinado', price: 8990, badge: 'Oferta', zone: 'ofertas', c3d: 0xd7d7d7, emoji: '👗' },
    { sku: 'VM-CAB-3109', name: 'Bomber Jacket Cobalt Neo', category: 'Chaquetas', color: 'Cobalt Neo', price: 11500, badge: 'Oferta', zone: 'ofertas', c3d: 0x2f54d0, emoji: '🧥' },
    { sku: 'VM-NIN-7721', name: 'Conjunto Active Warm', category: 'Conjuntos', color: 'Active Warm', price: 4450, badge: 'Oferta', zone: 'ofertas', c3d: 0xf7a35c, emoji: '🧒' },
    { sku: 'VM-CAL-9910', name: 'Sneakers Platform Cyber', category: 'Calzado', color: 'Cyber', price: 12900, badge: 'Oferta', zone: 'ofertas', c3d: 0xf5f5f5, emoji: '👟' },
  ];
  S.bySku = (sku) => S.CATALOG.find((p) => p.sku === sku) || S.CATALOG_INTERNO.find((p) => p.sku === sku);
  // Productos fuera de la vitrina pública (almacén/POS y desactivados).
  // Los llena S.loadInternalCatalog() y los monta la vitrina de mk-ropa.
  S.CATALOG_INTERNO = [];
  // Emoji por categoría para los SKU que llegan EN VIVO desde la API (sin emoji propio)
  const CATEGORY_EMOJI = {
    'Vestidos': '👗', 'Vestidos de Noche': '👗', 'Blusas': '👚', 'Camisas': '👔',
    'Pantalones': '👖', 'Denim': '👖', 'Chaquetas': '🧥', 'Abrigos': '🧥',
    'Sastrería': '🤵', 'Calzado': '👟', 'Accesorios': '👜', 'Ropa Exterior': '🧥',
    'Conjuntos': '🧥', 'Oficina': '👔', 'Fiesta': '💃', 'Casual': '👕',
  };
  S.emojiFor = (p) => p.emoji || CATEGORY_EMOJI[p && p.category] || '🛍️';

  // ── Registro de partes ──────────────────────────────────
  S.builders = [];
  S.parts = {};
  S.part = (name, fn) => S.builders.push({ name, fn });

  S.clickables = [];
  S.addClickable = (m) => S.clickables.push(m);

  S.animateHooks = [];
  S.addAnimate = (fn) => S.animateHooks.push(fn);

  S.tour = false;
  S.tourAngle = 0;

  // ── Catálogo EN VIVO por zona (tallas + stock reales) ───
  // La lista S.CATALOG de arriba es el respaldo de demo. Al arrancar se le
  // pide a la API el catálogo real de cada zona y se reemplaza; si la API no
  // responde (servidor apagado, sin base), la tienda sigue con el respaldo.
  S.catalogReady = null; // promesa que resuelve cuando el catálogo en vivo terminó (o falló)
  const PALETA_C3D = [0xe4006c, 0x2f54d0, 0xf0a832, 0x4b41e1, 0x2f9e73, 0xd4af37, 0xa02a5e, 0x5b8dd6, 0xe07a5f, 0x6c5ce7, 0x00b894, 0x8e44ad];
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
  const MAX_POR_ZONA = 6, MIN_POR_ZONA = 4;

  // El orden importa: novedades/ofertas son las más curadas y reclaman sus SKU
  // primero; las zonas por género se llenan con lo que quede (así la misma
  // prenda no cuelga dos veces salvo que una zona se quede muy corta).
  const ZONAS_API = [
    ['novedades', (n) => `novedades=true&sort=news&limit=${n}`],
    ['ofertas', (n) => `ofertas=true&sort=pop&limit=${n}`],
    ['damas', (n) => `gender=damas&sort=news&limit=${n}`],
    ['caballeros', (n) => `gender=caballeros&sort=news&limit=${n}`],
    ['ninos', (n) => `gender=ninos&sort=news&limit=${n}`],
  ];

  S.loadRealCatalog = async function () {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const previos = new Map(S.CATALOG.map((p) => [p.sku, p]));
    const usados = new Set();
    const nuevos = [];
    try {
      const lotes = await Promise.all(ZONAS_API.map(async ([zone, q]) => {
        const res = await fetch('/api/products?' + q(MAX_POR_ZONA * 3), { signal: ctrl.signal });
        if (!res.ok) throw new Error('API ' + res.status);
        const j = await res.json();
        return { zone, items: Array.isArray(j.items) ? j.items : [] };
      }));
      for (const { zone, items } of lotes) {
        const sel = [];
        for (const it of items) {         // primero: sin repetir SKU entre zonas
          if (sel.length >= MAX_POR_ZONA) break;
          if (usados.has(it.sku)) continue;
          sel.push(it); usados.add(it.sku);
        }
        if (sel.length < MIN_POR_ZONA) {  // zona corta: se admite reuso de SKU
          for (const it of items) {
            if (sel.length >= MIN_POR_ZONA) break;
            if (!sel.includes(it)) sel.push(it);
          }
        }
        for (const it of sel) {
          const prev = previos.get(it.sku) || {};
          nuevos.push({
            sku: it.sku,
            name: it.name || prev.name || it.sku,
            category: it.category || prev.category || 'Moda',
            color: (Array.isArray(it.colors) && it.colors[0]) || prev.color || 'VivaModa',
            price: Number.isFinite(Number(it.price)) ? Number(it.price) : (prev.price || 0),
            compareAt: it.compareAt != null ? Number(it.compareAt) : (prev.compareAt != null ? prev.compareAt : null),
            badge: it.badge || null,
            zone,
            c3d: prev.c3d || PALETA_C3D[hash((it.category || '') + '|' + (it.name || '')) % PALETA_C3D.length],
            emoji: prev.emoji || S.emojiFor(it),
            image: it.image || prev.image || null,
            sizes: Array.isArray(it.sizes) ? it.sizes : [],
            stockBySize: it.stockBySize && typeof it.stockBySize === 'object' ? it.stockBySize : {},
            stockTotal: Number.isFinite(Number(it.stockTotal)) ? Number(it.stockTotal) : null,
          });
        }
      }
      if (nuevos.length >= 8) {
        S.CATALOG = nuevos;
        console.info(`[TiendaVR] catálogo en vivo: ${nuevos.length} prendas repartidas en ${ZONAS_API.length} zonas`);
      } else {
        console.warn('[TiendaVR] la API devolvió muy pocas prendas; se conserva el catálogo local');
      }
    } finally {
      clearTimeout(timer);
    }
  };

  // ── Catálogo interno (almacén/POS) ──────────────────────
  // Los productos que no están en la vitrina pública no pueden colgarse en los
  // 5 rieles, pero tampoco se quedan sin ver: la tienda les monta su propia
  // vitrina. El endpoint los sirve aparte para no cambiar el catálogo público
  // (web, buscador, estilista y POS siguen viendo lo mismo).
  S.loadInternalCatalog = async function () {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch('/api/vr/catalogo-interno?limit=40', { signal: ctrl.signal });
      if (!res.ok) throw new Error('API ' + res.status);
      const j = await res.json();
      const items = Array.isArray(j.items) ? j.items : [];
      S.CATALOG_INTERNO = items.map((it) => ({
        sku: it.sku,
        name: it.name || it.sku,
        category: it.category || 'Moda',
        color: (Array.isArray(it.colors) && it.colors[0]) || 'VivaModa',
        price: Number.isFinite(Number(it.price)) ? Number(it.price) : 0,
        compareAt: it.compareAt != null ? Number(it.compareAt) : null,
        badge: it.badge || null,
        zone: 'interno',
        c3d: PALETA_C3D[hash((it.category || '') + '|' + (it.name || '')) % PALETA_C3D.length],
        emoji: S.emojiFor(it),
        image: it.image || null,
        sizes: Array.isArray(it.sizes) ? it.sizes : [],
        stockBySize: it.stockBySize && typeof it.stockBySize === 'object' ? it.stockBySize : {},
        stockTotal: Number.isFinite(Number(it.stockTotal)) ? Number(it.stockTotal) : null,
        // Un producto desactivado se expone pero no se puede comprar.
        missing: it.isActive === false,
      }));
      console.info(`[TiendaVR] catálogo interno: ${S.CATALOG_INTERNO.length} productos fuera de la vitrina pública`);
    } catch (err) {
      console.warn('[TiendaVR] catálogo interno no disponible:', err.message);
    } finally {
      clearTimeout(timer);
    }
  };

  const canvas = document.getElementById('sceneCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  S.renderer = renderer;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(S.VM.bg);
  scene.fog = new THREE.Fog(S.VM.bg, 22, 46);
  S.scene = scene;

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 90);
  camera.position.set(0, 4.6, 13.5);
  S.camera = camera;

  const controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0, 2.0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;
  controls.maxDistance = 26;
  controls.maxPolarAngle = 1.45;
  controls.autoRotate = false;
  S.controls = controls;

  S.clock = new THREE.Clock();

  // ── Iluminación base ────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a1b2b, 0.8));
  const sun = new THREE.DirectionalLight(0xfff3f8, 0.55);
  sun.position.set(7, 11, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
  scene.add(sun);

  const centerSpot = new THREE.SpotLight(0xe4006c, 1.6, 20, 0.55, 0.55, 1.2);
  centerSpot.position.set(0, 7.2, 0);
  centerSpot.target.position.set(0, 1.4, 0);
  scene.add(centerSpot); scene.add(centerSpot.target);

  S.zoneLights = S.ZONES.map((z) => {
    const l = new THREE.PointLight(z.zone, 0.55, 12, 2);
    l.position.set(z.pos.x, 4.6, z.pos.z - 1.0);
    scene.add(l);
    return l;
  });

  // ── Helpers compartidos ─────────────────────────────────
  S.mat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0.12 }, o));

  S.roundRect = function (x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  };

  S.textSprite = function (text, o = {}) {
    const w = o.w || 512, h = o.h || 140;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    S.roundRect(x, 3, 3, w - 6, h - 6, 24);
    x.fillStyle = o.bg || 'rgba(20,12,22,0.92)';
    x.fill();
    x.lineWidth = 3; x.strokeStyle = o.border || 'rgba(228,0,108,0.8)'; x.stroke();
    const size = o.size || 44;
    x.fillStyle = o.fg || '#ffffff';
    x.font = `${o.weight || 700} ${size}px "Plus Jakarta Sans", Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    if (o.lines && o.lines.length) {
      const lh = size * 1.4;
      const startY = h / 2 - ((o.lines.length - 1) * lh) / 2;
      o.lines.forEach((ln, i) => x.fillText(ln, w / 2, startY + i * lh + 1));
    } else {
      x.fillText(text, w / 2, h / 2 + 1);
    }
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const sc = o.scale || [2.6, 0.71, 1];
    s.scale.set(sc[0], sc[1], sc[2] || 1);
    return s;
  };

  // ── Orquestador: construye cada parte en orden ──────────
  S.build = function () {
    S.builders.forEach((b) => {
      const group = new THREE.Group();
      try {
        b.fn(S, group);
      } catch (err) {
        console.error('[TiendaVR] La parte "' + b.name + '" falló:', err);
      }
      if (group.children.length) scene.add(group);
      S.parts[b.name] = group;
    });
  };

  // ── Bucle de render ─────────────────────────────────────
  let started = false;
  const loader = document.getElementById('loader');
  function firstFrame() {
    if (started) return;
    started = true;
    const hide = () => { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 650); };
    if (window.__MK_WAIT__) {
      // el escenario GLB sigue descargando: se espera a mk:ready (con tope de seguridad)
      window.addEventListener('mk:ready', hide, { once: true });
      setTimeout(hide, 20000);
    } else {
      setTimeout(hide, 400);
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(S.clock.getDelta(), 0.05);
    const t = S.clock.elapsedTime;

    if (S.tour) {
      S.tourAngle += dt * 0.11;
      // Recorrido adaptado al interior MK (elipse DENTRO del local)
      const mk = S.MK;
      if (mk) {
        const cx = mk.cx, cz = mk.cz;
        camera.position.set(
          cx + Math.sin(S.tourAngle) * 8.5,
          2.2 + Math.sin(S.tourAngle * 2) * 0.3,
          cz + Math.cos(S.tourAngle) * 3.6,
        );
        camera.lookAt(cx, 1.7, cz);
      } else {
        camera.position.set(Math.sin(S.tourAngle) * 14, 4.9 + Math.sin(S.tourAngle * 2) * 0.5, Math.cos(S.tourAngle) * 14);
        camera.lookAt(0, 1.9, 0);
      }
    } else {
      controls.update();
    }

    // pulso sutil de luces por zona
    S.zoneLights.forEach((l, i) => { l.intensity = 0.5 + 0.12 * Math.sin(t * 1.4 + i * 1.7); });

    // hooks por fotograma registrados por cada parte
    S.animateHooks.forEach((fn) => fn(dt, t));

    renderer.render(scene, camera);
    firstFrame();
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // ── Inicio ──────────────────────────────────────────────
  S.init = function () {
    // Catálogo REAL por zona (tallas + stock) antes de montar la escena:
    // mk-ropa espera esta promesa para colgar las prendas en los rieles.
    // Si la API no responde, la promesa resuelve igual (se usa el respaldo).
    S.catalogReady = S.loadRealCatalog().catch((err) => {
      console.warn('[TiendaVR] catálogo en vivo no disponible, uso el respaldo local:', err.message);
    });
    // Los productos fuera de la vitrina pública (almacén/POS) se piden aparte;
    // si la API no responde, la tienda simplemente no monta esa vitrina.
    S.catalogInternoReady = S.loadInternalCatalog();
    S.build();
    animate();
  };

  return S;
})();