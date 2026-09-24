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
  S.bySku = (sku) => S.CATALOG.find((p) => p.sku === sku);
  S.emojiFor = (p) => p.emoji || '🛍️';

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

  // ── Motor ───────────────────────────────────────────────
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
    setTimeout(() => { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 650); }, 400);
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(S.clock.getDelta(), 0.05);
    const t = S.clock.elapsedTime;

    if (S.tour) {
      S.tourAngle += dt * 0.11;
      camera.position.set(Math.sin(S.tourAngle) * 14, 4.9 + Math.sin(S.tourAngle * 2) * 0.5, Math.cos(S.tourAngle) * 14);
      camera.lookAt(0, 1.9, 0);
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
    // fotos reales desde la API (se rellenan en el catálogo)
    fetch('/api/products?limit=100')
      .then((r) => r.json())
      .then((j) => { (j.items || []).forEach((p) => { const v = S.bySku(p.sku); if (v && p.image) v.image = p.image; }); })
      .catch(() => {});
    S.build();
    animate();
  };

  return S;
})();