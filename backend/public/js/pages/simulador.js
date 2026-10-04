/* ============================================================
   SIMULADOR DE TIENDA VIVAMODA (juego con avatar)
   ------------------------------------------------------------
   Mundo: interior "TIENDA ROPA MK IT" (CC-BY · Christophe Caro
   Alcalde / yohnchrastt) como ÚNICA geometría del entorno.
   Three.js aporta: avatar en 3ª persona, pedestales de producto,
   cámara orbital y colocación.
   Comercio: API real de VivaModa (catálogo, carrito y checkout
   que descuenta inventario en PostgreSQL).
   Geometría medida del local: X ∈ [-1, 49.5] · Z ∈ [-13.7, +1.3]
   · techo ≈3.9 · piso normalizado a Y=0.
   ============================================================ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = window.VM.api, fmtUSD = window.VM.fmtUSD;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const canvas = $('world');

  /* ── Motor ─────────────────────────────────────────────── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14101a);

  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 400);

  // Contraste y volumen: hemisferio suave + "sol" interior con sombras
  // reales + focos cálidos cercanos (la luz plana anterior lo lavaba todo).
  scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x2e252b, 0.5));
  const sunSim = new THREE.DirectionalLight(0xfff1e0, 1.3);
  sunSim.position.set(47, 12, 5);
  sunSim.target.position.set(36.5, 0, -6);
  sunSim.castShadow = true;
  sunSim.shadow.mapSize.set(2048, 2048);
  sunSim.shadow.camera.left = -16; sunSim.shadow.camera.right = 16;
  sunSim.shadow.camera.top = 11; sunSim.shadow.camera.bottom = -11;
  sunSim.shadow.bias = -0.0004;
  scene.add(sunSim); scene.add(sunSim.target);
  for (const x of [28, 34, 40, 46]) {
    const l = new THREE.PointLight(0xffe2c4, 0.8, 13, 1.8);
    l.position.set(x, 3.45, -6);
    scene.add(l);
  }

  // Entorno PBR suave para los materiales del interior
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0xffffff);
    scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
  } catch (e) { console.warn('[sim] env', e); }

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  });

  /* ── Mundo: el interior MK IT ──────────────────────────── */
  // ÚNICA área explorable: el interior cerrado del local (tras la fachada).
  // La acera exterior (x<25) queda fuera de los límites del avatar.
  const bounds = { minX: 25.3, maxX: 48.5, minZ: -12.4, maxZ: 0.8 };
  const FLOOR_Y = 0.30; // altura real del piso interior del modelo
  let worldReady = false;

  // ── Navegación: colisiones y suelo alcanzable, extraídas del PROPIO modelo ──
  const blockers = [];   // AABBs {x1,x2,z1,z2} de muros internos y mobiliario
  const AV_R = 0.28;     // radio del avatar (pasa por puertas de ~0.8 m)
  const CELL = 0.45;     // resolución de la malla de navegación
  let reach = null, navCols = 0, navRows = 0;
  function hitsObstacle(x, z, margin = AV_R, list = blockers) {
    for (const o of list) {
      if (x + margin > o.x1 && x - margin < o.x2 && z + margin > o.z1 && z - margin < o.z2) return true;
    }
    return false;
  }
  function extractBlockers(root) {
    const bb = new THREE.Box3();
    root.traverse((o) => {
      if (!o.isMesh) return;
      bb.setFromObject(o);
      if (!isFinite(bb.min.x)) return;
      if (bb.max.y < 0.55 || bb.min.y > 1.15) return;    // pisos y altos: no bloquean
      const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
      if (w > 18 && d > 8) return;                        // losas completas (piso/fachada)
      if (bb.max.x < bounds.minX || bb.min.x > bounds.maxX ||
          bb.max.z < bounds.minZ || bb.min.z > bounds.maxZ) return; // exterior
      blockers.push({ x1: bb.min.x, x2: bb.max.x, z1: bb.min.z, z2: bb.max.z });
    });
  }
  // BFS desde el spawn: reach = celdas de suelo realmente alcanzables caminando
  function buildNav(seedX, seedZ) {
    navCols = Math.round((bounds.maxX - bounds.minX) / CELL);
    navRows = Math.round((bounds.maxZ - bounds.minZ) / CELL);
    const cellX = (i) => bounds.minX + (i + 0.5) * CELL;
    const cellZ = (j) => bounds.minZ + (j + 0.5) * CELL;
    let s0 = null, sd = 1e9;
    for (let j = 0; j < navRows; j++) for (let i = 0; i < navCols; i++) {
      if (hitsObstacle(cellX(i), cellZ(j))) continue;
      const d = (cellX(i) - seedX) ** 2 + (cellZ(j) - seedZ) ** 2;
      if (d < sd) { sd = d; s0 = [i, j]; }
    }
    reach = new Set();
    if (!s0) return;
    const idx = (i, j) => i + j * navCols;
    const q = [s0]; reach.add(idx(s0[0], s0[1]));
    while (q.length) {
      const [i, j] = q.shift();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= navCols || nj >= navRows) continue;
        const k = idx(ni, nj);
        if (reach.has(k) || hitsObstacle(cellX(ni), cellZ(nj))) continue;
        reach.add(k); q.push([ni, nj]);
      }
    }
  }
  // Celdas libres+alcanzables ordenadas por cercanía al punto pedido
  function freeSpots(x, z, clear = 0.8, avoid = []) {
    const out = [];
    for (let j = 0; j < navRows; j++) for (let i = 0; i < navCols; i++) {
      if (!reach.has(i + j * navCols)) continue;
      const cx = bounds.minX + (i + 0.5) * CELL, cz = bounds.minZ + (j + 0.5) * CELL;
      if (hitsObstacle(cx, cz, clear) || hitsObstacle(cx, cz, clear, avoid)) continue;
      out.push({ x: cx, z: cz, d: (cx - x) ** 2 + (cz - z) ** 2 });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  // Losa de garantía SOLO bajo el interior (piso del modelo a Y≈0.30)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 15.5),
    new THREE.MeshStandardMaterial({ color: 0xcfcfd2, roughness: 0.9, metalness: 0.03 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(36.9, 0.28, -6.2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Paredes: gris piedra medio-oscuro para CONTRASTAR con piso claro, ropa
  // y pedestales (antes el conjunto quedaba blanco quemado, sin volumen).
  const WALL_TINT = '#9aa0a8';
  let wallsPrepared = false;
  function tintWalls(root) {
    let n = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => {
        if (mat && /estuco/i.test(mat.name || '')) {
          mat.color.set(WALL_TINT);
          if (!wallsPrepared) {
            mat.roughness = 0.95;
            mat.metalness = 0;
            mat.needsUpdate = true;
          }
          n++;
        }
      });
      if (o.isMesh && !wallsPrepared) { o.receiveShadow = true; o.castShadow = true; }
    });
    wallsPrepared = true;
    console.log(`[sim] paredes → ${WALL_TINT} (${n} meshes, sombras reales)`);
  }

  new THREE.GLTFLoader().load(
    '/models/mk-it.glb',
    (glb) => {
      const m = glb.scene;
      const box = new THREE.Box3().setFromObject(m);
      m.position.y -= box.min.y; // piso a Y=0
      m.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
      tintWalls(m);
      // Navegación real: colisiones + suelo alcanzable, y spawn validado
      extractBlockers(m);
      buildNav(26.8, -3.2);
      const sp = freeSpots(26.8, -3.2, AV_R + 0.05)[0];
      if (sp) avatar.position.set(sp.x, FLOOR_Y + 0.01, sp.z);
      console.log(`[sim] navegación: ${blockers.length} obstáculos · ${reach ? reach.size : 0} celdas alcanzables · spawn (${avatar.position.x.toFixed(1)}, ${avatar.position.z.toFixed(1)})`);
      scene.add(m);
      worldReady = true;
      startGame();
    },
    (xhr) => {
      if (xhr.total) $('loaderText').textContent = `Cargando el interior… ${((xhr.loaded / xhr.total) * 100).toFixed(0)}%`;
    },
    (err) => {
      console.error('[sim] mundo no disponible', err);
      $('loaderText').textContent = 'No se pudo cargar el interior — reintentar más tarde';
      setTimeout(() => startGame(), 1200); // igual deja jugar sobre el piso base
    },
  );

  /* ── Avatar en tercera persona ─────────────────────────── */
  const avatar = new THREE.Group();
  {
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.55, 12),
      new THREE.MeshStandardMaterial({ color: 0xe4006c, roughness: 0.6 }));
    torso.position.y = 0.55; torso.castShadow = true; avatar.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xf1d4b8, roughness: 0.7 }));
    head.position.y = 1.05; head.castShadow = true; avatar.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x4b41e1, emissive: 0x4b41e1, emissiveIntensity: 0.7 }));
    visor.position.set(0, 1.08, 0.14); avatar.add(visor);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.7 }));
    legs.position.y = 0.25; legs.castShadow = true; avatar.add(legs);
  }
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.32, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; avatar.add(blob);
  avatar.position.set(26.8, FLOOR_Y + 0.01, -3.2);
  scene.add(avatar);

  /* ── Controles: WASD + ratón orbital ───────────────────── */
  const keys = {};
  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyE') tryInteract();
    if (e.code === 'Escape') { closeProduct(); closeCart(); }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });

  let camYaw = -Math.PI / 2, camPitch = 0.3, camDist = 4.4;
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointermove', (e) => {
    if (!dragging) return;
    camYaw -= (e.clientX - lastX) * 0.005;
    camPitch = clamp(camPitch + (e.clientY - lastY) * 0.004, -0.05, 1.05);
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener('wheel', (e) => {
    camDist = clamp(camDist + e.deltaY * 0.003, 2.2, 8);
    e.preventDefault();
  }, { passive: false });

  /* ── Catálogo real + pedestales ────────────────────────── */
  // SKUs de la tienda VR (el listado /api/products no trae "zone":
  // se usa el mapeo curado del proyecto y se consulta el detalle
  // real de cada SKU para precio, stock, foto y tallas vivos).
  const VR_SKUS = [
    { sku: 'VM-DAM-ATELIER', zone: 'damas', c3d: 0xe4006c, emoji: '👗' },
    { sku: 'VM-DAM-8870', zone: 'damas', c3d: 0x2447c9, emoji: '👔' },
    { sku: 'VM-DAM-8810', zone: 'damas', c3d: 0xe4006c, emoji: '👗' },
    { sku: 'VM-DAM-8840', zone: 'damas', c3d: 0xb60055, emoji: '🧥' },
    { sku: 'VM-CAB-8880', zone: 'caballeros', c3d: 0x2a2f3a, emoji: '🧥' },
    { sku: 'VM-CAB-8820', zone: 'caballeros', c3d: 0x3b4b9e, emoji: '🤵' },
    { sku: 'VM-CAB-8850', zone: 'caballeros', c3d: 0xe9e4da, emoji: '👔' },
    { sku: 'VM-NIN-8890', zone: 'ninos', c3d: 0xf0a832, emoji: '🧒' },
    { sku: 'VM-NIN-8830', zone: 'ninos', c3d: 0xa9714b, emoji: '🧥' },
    { sku: 'VM-NIN-8860', zone: 'ninos', c3d: 0xf49fb6, emoji: '🎀' },
    { sku: 'VM-CAL-8811', zone: 'novedades', c3d: 0x111111, emoji: '👠' },
    { sku: 'VM-ACC-8812', zone: 'novedades', c3d: 0xd4af37, emoji: '👜' },
    { sku: 'VM-ACC-006', zone: 'novedades', c3d: 0xa02a5e, emoji: '📿' },
    { sku: 'VM-DAM-8942', zone: 'ofertas', c3d: 0xd7d7d7, emoji: '👗' },
    { sku: 'VM-CAB-3109', zone: 'ofertas', c3d: 0x2f54d0, emoji: '🧥' },
    { sku: 'VM-NIN-7721', zone: 'ofertas', c3d: 0xf7a35c, emoji: '🧒' },
    { sku: 'VM-CAL-9910', zone: 'ofertas', c3d: 0xf5f5f5, emoji: '👟' },
  ];
  // Pedestales DENTRO del local: posición deseada por zona y ajustada en
  // vivo a una celda libre y alcanzable (nunca dentro de muros ni muebles).
  const STANDS = [
    { zone: 'damas', label: 'Damas', color: 0xe4006c, x: 30, z: -11 },
    { zone: 'caballeros', label: 'Caballeros', color: 0x2f54d0, x: 39, z: -11 },
    { zone: 'ninos', label: 'Niños', color: 0xf0a832, x: 45, z: -11 },
    { zone: 'novedades', label: 'Novedades', color: 0xff8a3c, x: 29, z: -2.2 },
    { zone: 'ofertas', label: 'Ofertas Flash', color: 0xff4d4d, x: 43, z: -2.2 },
  ];
  const interactables = []; // { mesh (pedestal), prod }
  let near = null;          // producto cercano actual
  let heading = Math.PI / 2; // mirando a +X

  function buildStands(catalog) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.6, roughness: 0.4 });
    const taken = []; // huellas de pedestales ya colocados
    for (const st of STANDS) {
      const prods = catalog.filter((p) => p.zone === st.zone).slice(0, 4);
      if (!prods.length) continue;
      const spot = (reach ? freeSpots(st.x, st.z, 0.85, taken)[0] : null) || st;
      st.x = spot.x; st.z = spot.z;
      taken.push({ x1: st.x - 0.9, x2: st.x + 0.9, z1: st.z - 0.9, z2: st.z + 0.9 });

      // pedestal
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.16, 24),
        new THREE.MeshStandardMaterial({ color: 0x2a2430, roughness: 0.5, metalness: 0.25 }));
      ped.position.set(st.x, FLOOR_Y + 0.08, st.z);
      ped.castShadow = true;
      scene.add(ped);
      // aro de color de zona
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.22, 40),
        new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(st.x, FLOOR_Y + 0.02, st.z);
      scene.add(ring);
      // poste + letrero
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 8), poleMat);
      pole.position.set(st.x, FLOOR_Y + 1.05, st.z - 0.7); scene.add(pole);
      const sign = makeSign(st.label, st.color);
      sign.position.set(st.x, FLOOR_Y + 2.6, st.z - 0.7);
      scene.add(sign);
      // luz del stand
      const pl = new THREE.PointLight(st.color, 0.5, 7, 2);
      pl.position.set(st.x, FLOOR_Y + 2.8, st.z); scene.add(pl);

      // productos en arco
      prods.forEach((prod, i) => {
        const a = (i - (prods.length - 1) / 2) * 0.45;
        const px = st.x + Math.sin(a) * 0.55, pz = st.z + Math.cos(a) * 0.15;
        const disp = productDisplay(prod, st.color);
        disp.position.set(px, FLOOR_Y + 0.18, pz);
        disp.userData.product = prod;
        disp.userData.baseY = disp.position.y;
        scene.add(disp);
        interactables.push({ mesh: disp, prod });
        const halo = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.4, 28),
          new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
        halo.rotation.x = -Math.PI / 2; halo.position.set(px, FLOOR_Y + 0.19, pz);
        scene.add(halo);
      });
    }
  }

  function productDisplay(prod, color) {
    const g = new THREE.Group();
    const c = prod.c3d || 0xdddddd;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
    body.position.y = 0.3; body.castShadow = true; g.add(body);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 18),
      new THREE.MeshStandardMaterial({ color: 0x1c1820, roughness: 0.6 }));
    g.add(base);
    return g;
  }

  function makeSign(text, color) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(18,12,22,0.92)';
    x.beginPath(); x.roundRect ? x.roundRect(4, 4, 504, 120, 28) : x.rect(4, 4, 504, 120); x.fill();
    x.strokeStyle = '#' + color.toString(16).padStart(6, '0'); x.lineWidth = 6; x.stroke();
    x.fillStyle = '#fff'; x.font = '800 52px "Plus Jakarta Sans", Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text.toUpperCase(), 256, 68);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(2.6, 0.65, 1);
    return s;
  }

  /* ── Movimiento + cámara + proximidad ──────────────────── */
  const clock = new THREE.Clock();
  function update(dt) {
    const fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    const speed = ((keys['ShiftLeft'] || keys['ShiftRight']) ? 6.4 : 3.3) * dt;
    if (fwd || strafe) {
      const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
      const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
      const mx = fx * fwd + rx * strafe, mz = fz * fwd + rz * strafe;
      const len = Math.hypot(mx, mz) || 1;
      const stepX = (mx / len) * speed, stepZ = (mz / len) * speed;
      const nx = clamp(avatar.position.x + stepX, bounds.minX, bounds.maxX);
      const nz = clamp(avatar.position.z + stepZ, bounds.minZ, bounds.maxZ);
      // colisión contra muros internos y mobiliario (ejes separados para deslizar)
      if (!hitsObstacle(nx, nz)) { avatar.position.x = nx; avatar.position.z = nz; }
      else if (!hitsObstacle(nx, avatar.position.z)) avatar.position.x = nx;
      else if (!hitsObstacle(avatar.position.x, nz)) avatar.position.z = nz;
      heading = Math.atan2(mx, mz);
    }
    // giro suave del avatar
    let d = heading - avatar.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    avatar.rotation.y += d * Math.min(1, dt * 10);
    // bobbing al caminar
    avatar.children[0].position.y = 0.55 + ((fwd || strafe) ? Math.abs(Math.sin(clock.elapsedTime * 9)) * 0.035 : 0);

    // cámara orbital
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    camera.position.set(
      avatar.position.x + camDist * Math.sin(camYaw) * cp,
      1.35 + camDist * sp,
      avatar.position.z + camDist * Math.cos(camYaw) * cp,
    );
    camera.lookAt(avatar.position.x, avatar.position.y + 1.3, avatar.position.z);

    // producto cercano
    let best = null, bestD = 1.6;
    for (const it of interactables) {
      const dx = it.mesh.position.x - avatar.position.x;
      const dz = it.mesh.position.z - avatar.position.z;
      const dd = Math.hypot(dx, dz);
      if (dd < bestD) { bestD = dd; best = it; }
    }
    if (best !== near) {
      near = best;
      if (near) {
        $('promptText').textContent = `Ver ${near.prod.name} · ${fmtUSD(near.prod.price)}`;
        $('prompt').classList.remove('hidden');
      } else $('prompt').classList.add('hidden');
    }
    // halo del cercano
    interactables.forEach((it) => {
      const halo = it.mesh.children[2];
      if (halo) halo.material.opacity = (it === near) ? 0.95 : 0.5;
      it.mesh.position.y = it.mesh.userData.baseY + Math.sin(clock.elapsedTime * 2 + it.mesh.position.x) * 0.02;
    });
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (worldReady) update(dt);
    renderer.render(scene, camera);
  }
  loop();

  /* ── Interacción (E) y modal producto ──────────────────── */
  function tryInteract() {
    if (near) openProduct(near.prod);
  }
  $('pmClose').addEventListener('click', closeProduct);
  $('prompt').addEventListener('click', () => near && openProduct(near.prod));

  function openProduct(prod) {
    $('pmName').textContent = prod.name;
    $('pmMeta').textContent = `${prod.category} · ${prod.color || '—'}`;
    $('pmPrice').textContent = fmtUSD(prod.price);
    $('pmStock').textContent = prod.stockTotal > 0 ? `· ${prod.stockTotal} uds disponibles` : '· sin stock';
    $('pmZone').textContent = (STANDS.find((s) => s.zone === prod.zone) || {}).label || prod.zone;
    const img = $('pmImg'), emo = $('pmEmoji');
    if (prod.image) {
      img.src = prod.image; img.classList.remove('hidden'); emo.classList.add('hidden');
    } else {
      img.classList.add('hidden'); emo.classList.remove('hidden'); emo.textContent = prod.emoji || '🛍️';
    }
    // tallas
    const wrap = $('pmSizes'); wrap.innerHTML = '';
    const sizes = prod.sizes && prod.sizes.length ? prod.sizes : ['Única'];
    lastSizes = sizes;
    window.__pmSize = sizes[0];
    sizes.slice(0, 8).forEach((s) => {
      const b = document.createElement('button');
      b.className = 'px-3 py-1.5 rounded-xl text-sm font-bold border border-white/20 hover:border-white/60';
      b.textContent = s;
      if (s === sizes[0]) b.classList.add('bg-white', 'text-black');
      b.addEventListener('click', () => {
        window.__pmSize = s;
        [...wrap.children].forEach((c) => c.classList.remove('bg-white', 'text-black'));
        b.classList.add('bg-white', 'text-black');
      });
      wrap.appendChild(b);
    });
    $('pmAdd').disabled = prod.stockTotal <= 0;
    $('pmAdd').onclick = () => addToCart(prod);
    $('productModal').classList.remove('hidden');
  }
  function closeProduct() { $('productModal').classList.add('hidden'); }

  /* ── Carrito + checkout reales ─────────────────────────── */
  // El checkout web de la API toma las líneas del CARRITO persistente
  // (/api/cart/items) y luego POST /orders las convierte en pedido
  // con descuento de inventario en transacción.
  const cart = []; // { prod, size }
  let lastSizes = ['U'];
  function addToCart(prod) {
    cart.push({ prod, size: (window.__pmSize || (prod.sizes && prod.sizes[0]) || 'U') });
    refreshCart();
    toast(`🛒 ${prod.name} añadido`);
    closeProduct();
  }
  function refreshCart() {
    const n = cart.length;
    $('cartCount').textContent = n;
    const total = cart.reduce((s, l) => s + Number(l.prod?.price || 0), 0);
    $('simTotal').textContent = total.toFixed(2);
    $('cartTotal').textContent = total.toFixed(2);
    const box = $('cartItems'); box.innerHTML = '';
    if (!n) box.innerHTML = '<p class="text-white/40 text-center py-6">Aún no añadiste nada.<br>Camina hasta un pedestal y pulsa <b>E</b>.</p>';
    cart.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2 glass rounded-xl px-3 py-2';
      row.innerHTML = `<span class="flex-1 truncate">${p.prod.name} <span class="text-white/40 text-xs">· ${p.size}</span></span>
        <b class="text-[#ff5c9d]">${fmtUSD(p.prod.price)}</b>
        <button data-i="${i}" class="text-white/40 hover:text-red-400">✕</button>`;
      row.querySelector('button').addEventListener('click', () => { cart.splice(i, 1); refreshCart(); });
      box.appendChild(row);
    });
    $('cartCheckout').disabled = !n;
  }
  $('btnCart').addEventListener('click', () => { refreshCart(); $('cartModal').classList.remove('hidden'); });
  $('cartClose').addEventListener('click', closeCart);
  function closeCart() { $('cartModal').classList.add('hidden'); }

  $('cartCheckout').addEventListener('click', async () => {
    const btn = $('cartCheckout');
    btn.disabled = true; btn.textContent = 'Procesando…';
    try {
      const user = window.VM.getUser();
      if (!user || user.role !== 'client') throw new Error('Inicia sesión como cliente (elena.rossi@vivamoda.com) para completar la compra');
      // 1) llenar el carrito persistente con cada línea
      for (const line of cart) {
        await api('/cart/items', { method: 'POST', body: { sku: line.prod.sku, size: line.size, qty: 1 } });
      }
      // 2) checkout: valida stock, descuenta inventario y crea el pedido
      const res = await api('/orders', {
        method: 'POST',
        body: {
          address: 'Compra en Simulador de Tienda VR',
          city: 'Central',
          paymentMethod: 'tarjeta',
        },
      });
      toast(`✅ Pedido ${res.order?.orderNo || ''} confirmado — inventario descontado`, 4200);
      cart.length = 0;
      refreshCart();
      closeCart();
    } catch (e) {
      toast('⚠️ ' + e.message, 4200);
    } finally {
      btn.disabled = false; btn.textContent = '✅ Finalizar compra';
    }
  });

  /* ── UI auxiliar ───────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  /* ── Inicio: usuario + catálogo ────────────────────────── */
  window.__SIM = { avatar, interactables, get near() { return near; }, STANDS, cart, bounds, get blockers() { return blockers; }, get reach() { return reach; } }; // debug/pruebas
  async function startGame() {
    try {
      const me = window.VM.getUser();
      if (me) {
        const { user } = await api('/auth/me');
        $('simUser').textContent = `${user.fullName || user.full_name || 'Usuario'} · ${user.role === 'client' ? 'cliente ' + (user.vipTier || '') : user.role}`;
        if (user.role !== 'client') toast('Tip: inicia sesión como cliente para comprar', 3500);
      } else {
        $('simUser').textContent = 'Invitado · inicia sesión para comprar';
      }
    } catch (e) { $('simUser').textContent = 'Invitado'; }
    try {
      // Detalle real por SKU (precio, stock, foto, tallas) + zona/curación visual
      const details = await Promise.all(VR_SKUS.map(async (v) => {
        try {
          const { product } = await api(`/products/${encodeURIComponent(v.sku)}`);
          return { ...product, zone: v.zone, c3d: v.c3d, emoji: v.emoji };
        } catch (e) { console.warn('[sim] sku caído', v.sku); return null; }
      }));
      buildStands(details.filter(Boolean));
    } catch (e) {
      console.error('[sim] catálogo', e);
      toast('No se pudo cargar el catálogo', 3000);
    }
    $('loader').style.opacity = '0';
    setTimeout(() => $('loader').remove(), 600);
    toast('🎮 Camina con WASD · acércate a un pedestal y pulsa E', 4200);
  }
})();
