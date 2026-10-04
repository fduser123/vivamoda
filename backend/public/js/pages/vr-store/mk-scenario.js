/* ============================================================
   ESCENARIO MK IT (interior profesional de tienda de ropa)
   ------------------------------------------------------------
   - Carga TIENDA ROPA MK IT (CC-BY · Christophe Caro Alcalde /
     yohnchrastt, Sketchfab) como escenario base.
   - Interior real medido: X ∈ [~-1, 49.5] (50.5 m), Z ∈ [-13.7, +1.3]
     (15.1 m), techo Y≈3.9, piso Y≈0.12 (se normaliza a 0).
   - Este módulo define S.MK (geometría + zonas recalculadas) y
     degrada con elegancia: si el GLB no carga, se emite mk:ready
     igualmente y la tienda base procedural sigue en pie.
   ============================================================ */
VRStore.part('mk-escenario', function (S, g) {
  const LOADER_URL = '/models/mk-it.glb';
  const loaderEl = document.getElementById('loaderText');
  window.__MK_WAIT__ = true; // el loader espera a mk:ready

  // ── Geometría del interior (medida con el visor) ─────────
  // SOLO el local cerrado: la acera exterior (x<25) queda fuera del área
  // explorable (límites del modo FPS y vistas de zona).
  const MK = {
    minX: 25.3, maxX: 48.5,          // interior real (muros en x≈25 y x≈48.6)
    minZ: -12.4, maxZ: 0.9,          // muro trasero z≈-12.6, frente z≈+0.2
    floorY: 0.30, ceilY: 3.8,        // piso del modelo a Y≈0.30
  };
  MK.cx = (MK.minX + MK.maxX) / 2;   // ≈ 24.2
  MK.cz = (MK.minZ + MK.maxZ) / 2;   // ≈ -6.2
  S.MK = MK;

  // ── Zonas deseadas (se AJUSTAN a suelo libre real al cargar el GLB) ──
  const MK_ZONES = [
    { id: 'damas',      x: 28.5, z: -10.5, color: 0xe4006c },
    { id: 'caballeros', x: 37.5, z: -10.5, color: 0x2f54d0 },
    { id: 'ninos',      x: 45.5, z: -10.5, color: 0xf0a832 },
    { id: 'novedades',  x: 28.5, z: -3.5,  color: 0xff8a3c },
    { id: 'ofertas',    x: 44.5, z: -3.5,  color: 0xff4d4d },
  ];

  // ── Navegación del interior: colisiones extraídas del PROPIO modelo ──
  // (misma técnica que el simulador: AABBs del GLB + BFS de celdas
  //  alcanzables → TODO lo añadido se adapta a las dimensiones reales)
  const nav = { blockers: [], reach: null, cols: 0, rows: 0, ready: false };
  S.mkNav = nav;
  nav.hits = function (x, z, margin = 0.3, list = nav.blockers) {
    for (const o of list) {
      if (x + margin > o.x1 && x - margin < o.x2 && z + margin > o.z1 && z - margin < o.z2) return true;
    }
    return false;
  };
  nav.freeSpots = function (x, z, clear = 0.8, avoid = []) {
    const out = [];
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      if (!nav.reach.has(i + j * nav.cols)) continue;
      const cx = MK.minX + (i + 0.5) * 0.45, cz = MK.minZ + (j + 0.5) * 0.45;
      if (nav.hits(cx, cz, clear) || nav.hits(cx, cz, clear, avoid)) continue;
      out.push({ x: cx, z: cz, d: (cx - x) ** 2 + (cz - z) ** 2 });
    }
    return out.sort((a, b) => a.d - b.d);
  };
  function extractBlockers(root) {
    const bb = new THREE.Box3();
    root.traverse((o) => {
      if (!o.isMesh) return;
      bb.setFromObject(o);
      if (!isFinite(bb.min.x)) return;
      if (bb.max.y < MK.floorY + 0.25 || bb.min.y > MK.floorY + 1.15) return;
      const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
      if (w > 18 && d > 8) return; // losas completas (piso/fachada)
      if (bb.max.x < MK.minX || bb.min.x > MK.maxX || bb.max.z < MK.minZ || bb.min.z > MK.maxZ) return;
      nav.blockers.push({ x1: bb.min.x, x2: bb.max.x, z1: bb.min.z, z2: bb.max.z });
    });
  }
  function buildNav(seedX, seedZ) {
    nav.cols = Math.round((MK.maxX - MK.minX) / 0.45);
    nav.rows = Math.round((MK.maxZ - MK.minZ) / 0.45);
    const cellX = (i) => MK.minX + (i + 0.5) * 0.45;
    const cellZ = (j) => MK.minZ + (j + 0.5) * 0.45;
    let s0 = null, sd = 1e9;
    for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
      if (nav.hits(cellX(i), cellZ(j))) continue;
      const d = (cellX(i) - seedX) ** 2 + (cellZ(j) - seedZ) ** 2;
      if (d < sd) { sd = d; s0 = [i, j]; }
    }
    nav.reach = new Set();
    if (!s0) return;
    const idx = (i, j) => i + j * nav.cols;
    const q = [s0]; nav.reach.add(idx(s0[0], s0[1]));
    while (q.length) {
      const [i, j] = q.shift();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nav.cols || nj >= nav.rows) continue;
        const k = idx(ni, nj);
        if (nav.reach.has(k) || nav.hits(cellX(ni), cellZ(nj))) continue;
        nav.reach.add(k); q.push([ni, nj]);
      }
    }
  }

  // Aplica posiciones de zona al motor (deseadas como fallback, luego ajustadas)
  function applyZones() {
    MK_ZONES.forEach((z, i) => {
      const orig = S.ZONES[i];
      if (!orig) return;
      orig.pos = { x: z.x, z: z.z };
      orig.railW = z.railW || 4.4; // ancho de riel adaptado al hueco disponible
      orig.view = {
        p: [z.x, 2.6, Math.min(z.z + 4.5, MK.maxZ - 0.6)],
        t: [z.x, 1.5, z.z],
      };
      orig.color = '#' + z.color.toString(16).padStart(6, '0');
      if (S.zoneLights && S.zoneLights[i]) {
        S.zoneLights[i].position.set(z.x, 3.4, z.z < -6 ? z.z + 1.5 : z.z - 1.4);
      }
    });
  }
  applyZones(); // fallback inmediato (el GLB aún está descargando)

  // Ajuste de zonas al suelo libre: celda alcanzable donde el riel completo
  // quepa sin tocar mobiliario; si no cabe, prueba anchos menores (adapta)
  function snapZones() {
    const taken = [];
    MK_ZONES.forEach((z) => {
      let chosen = null;
      for (const w of [4.4, 3.4, 2.4]) {
        for (const c of nav.freeSpots(z.x, z.z, 0.55, taken)) {
          const h = w / 2;
          const line = [[c.x - h, c.z], [c.x - h / 2, c.z], [c.x, c.z], [c.x + h / 2, c.z], [c.x + h, c.z]];
          if (line.every(([px, pz]) => !nav.hits(px, pz, 0.4)) &&
              !nav.hits(c.x, c.z + 0.45, 0.35) && !nav.hits(c.x, c.z - 0.45, 0.35)) {
            chosen = { x: c.x, z: c.z, w };
            break;
          }
        }
        if (chosen) break;
      }
      if (!chosen) chosen = { x: z.x, z: z.z, w: 4.4 };
      z.x = chosen.x; z.z = chosen.z; z.railW = chosen.w;
      taken.push({ x1: z.x - chosen.w / 2 - 0.5, x2: z.x + chosen.w / 2 + 0.5, z1: z.z - 0.9, z2: z.z + 0.9 });
    });
    applyZones();
  }

  // ── Cámara y controles al interior real ──────────────────
  // A la altura del ojo, en el pasillo central, mirando a lo largo
  S.camera.position.set(38.5, 1.9, -7.6);
  S.controls.target.set(30, 1.4, -4);
  S.controls.minDistance = 1.2;
  S.controls.maxDistance = 30;
  S.controls.maxPolarAngle = 1.52;

  // ── Luces del motor dentro de la tienda ──────────────────
  // (spot central + luces de zona se mueven al interior)
  if (S.zoneLights && S.zoneLights.length) {
    S.zoneLights.forEach((l, i) => {
      const z = MK_ZONES[i] || MK_ZONES[0];
      l.position.set(z.x, 3.4, z.z + 1.5);
      l.distance = 11;
      l.intensity = 0.65;
    });
  }
  const central = S.scene.children.find((o) => o.isSpotLight);
  if (central) {
    central.visible = false; // el spot rosado original lavaba el interior
  }
  // "Sol" interior con sombras REALES: proyecta mobiliario y ropa contra
  // el piso y los muros → contraste y volumen (antes todo plano).
  const sunMK = new THREE.DirectionalLight(0xfff1e0, 1.15);
  sunMK.position.set(47, 11, 4);
  sunMK.target.position.set(36.5, 0, -6);
  sunMK.castShadow = true;
  sunMK.shadow.mapSize.set(2048, 2048);
  sunMK.shadow.camera.left = -14; sunMK.shadow.camera.right = 14;
  sunMK.shadow.camera.top = 10; sunMK.shadow.camera.bottom = -10;
  sunMK.shadow.bias = -0.0004;
  g.add(sunMK); g.add(sunMK.target);

  // ── Iluminación de entorno PBR para los materiales ───────
  try {
    const pmrem = new THREE.PMREMGenerator(S.renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0xffffff);
    S.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    S.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    S.renderer.toneMappingExposure = 1.15;
  } catch (e) { console.warn('[MK] environment', e); }

  // ── Piso base de garantía SOLO bajo el interior (piso del modelo a Y≈0.30) ──
  const baseFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(25, 15.5),
    new THREE.MeshStandardMaterial({ color: 0xcfcfd2, roughness: 0.9, metalness: 0.03 }),
  );
  baseFloor.rotation.x = -Math.PI / 2;
  baseFloor.position.set(36.9, 0.28, -6.2);
  baseFloor.receiveShadow = true;
  g.add(baseFloor);

  // ── Iluminación interior reforzada (focos cálidos cercanos) ──
  for (const x of [28, 34, 40, 46]) {
    const aisle = new THREE.PointLight(0xffe2c4, 0.85, 13, 1.8);
    aisle.position.set(x, 3.45, -6);
    g.add(aisle);
  }
  const hemiUp = new THREE.HemisphereLight(0xdfe6f0, 0x2e252b, 0.5);
  hemiUp.position.set(36, 6, -6);
  g.add(hemiUp);

  // ── Carga del modelo ─────────────────────────────────────
  // ── Paredes: gris piedra medio-oscuro para contraste y volumen ──
  const MK_WALL_TINT = '#8f959e';
  function tintWalls(root) {
    let n = 0;
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((mat) => {
        if (mat && /estuco/i.test(mat.name || '')) {
          mat.color.set(MK_WALL_TINT);
          mat.roughness = 0.95; mat.metalness = 0; mat.needsUpdate = true;
          n++;
        }
      });
      if (o.isMesh) { o.receiveShadow = true; o.castShadow = true; }
    });
    console.log(`[MK] paredes → ${MK_WALL_TINT} (${n} meshes, sombras reales)`);
  }

  new THREE.GLTFLoader().load(
    LOADER_URL,
    (glb) => {
      const m = glb.scene;
      const box = new THREE.Box3().setFromObject(m);
      m.position.y -= box.min.y; // piso a Y=0
      m.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
      tintWalls(m);
      // ── Adaptar TODO lo añadido a las dimensiones reales del interior ──
      extractBlockers(m);
      buildNav(31, -7.5);
      snapZones();
      nav.ready = true;
      console.log(`[MK] navegación: ${nav.blockers.length} obstáculos · ${nav.reach ? nav.reach.size : 0} celdas · zonas ajustadas a suelo libre`);
      window.dispatchEvent(new CustomEvent('mk:zones'));
      g.add(m);
      // El build solo añade grupos NO vacíos: como el GLB llega async,
      // hay que montar el grupo explícitamente al terminar la carga.
      if (!g.parent) S.scene.add(g);
      S.mkLoaded = true;
      S.scene.fog = null; // la niebla apagaría el interior a distancia
      if (loaderEl) loaderEl.textContent = 'Tienda lista ✨';
      window.dispatchEvent(new CustomEvent('mk:ready'));
    },
    (xhr) => {
      if (xhr.total && loaderEl) {
        loaderEl.textContent = `Cargando interior MK IT… ${((xhr.loaded / xhr.total) * 100).toFixed(0)}%`;
      }
    },
    (err) => {
      console.error('[MK] escenario no disponible, se usa la base procedural', err);
      if (loaderEl) loaderEl.textContent = 'Escenario MK no disponible — usando base';
      window.dispatchEvent(new CustomEvent('mk:zones')); // que la ropa se construya igual
      window.dispatchEvent(new CustomEvent('mk:ready'));
    },
  );
});
