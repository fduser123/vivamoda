/* ============================================================
   AVATAR DEL CLIENTE EN LA TIENDA VR (3ª persona)
   ------------------------------------------------------------
   La tienda solo tenía una cámara orbital y un modo FPS sin
   cuerpo. Aquí se añade un personaje real —el mismo avatar
   riggeado de la asesora, con sus clips Idle/Walk— que el cliente
   pasea con WASD y que avisa de la prenda que tiene delante para
   poder verla y añadirla a la bolsa.

   Decisiones:
   - La cámara sigue al avatar reutilizando OrbitControls: se
     desplaza el target y la cámara el mismo delta, así se conserva
     el ángulo que haya elegido el usuario y no hay que escribir un
     segundo sistema de órbita.
   - El movimiento se valida contra S.mkNav (el navmesh que ya
     extrae los obstáculos del propio GLB), de modo que el avatar no
     atraviesa paredes, mesas ni percheros.
   - El giro se suaviza: al cambiar de dirección el modelo rota hacia
     donde camina en lugar de saltar de golpe (antes giraba hasta 180°
     en un solo fotograma y se veía como un teletransporte).
   - Al pararse el avatar no gira solo: la única rotación del personaje
     viene de caminar. Sí mantiene el aviso de la prenda más cercana,
     para poder abrirla con E.
   ============================================================ */
VRStore.part('avatar', function (S, g) {
  const MODEL_URL = '/models/asesor/asesor-vivamoda.glb';
  const IDLE = 'Idle_Neutral';
  const WALK = 'Walk';
  const SPEED = 3.1;          // m/s
  const GIRO = 11;            // rad/s de giro hacia la dirección de avance (media vuelta ≈ 0,4 s)
  const RADIO = 0.34;         // margen de colisión del cuerpo
  const ALCANCE = 3.8;        // distancia a la que señala una prenda
  const ALTURA_CAMARA = 1.15; // a qué altura mira la cámara del avatar
  // El GLB del asesor mira hacia +Z, no hacia -Z (el frente por defecto de
  // three.js). Todas las cuentas de orientación llevan por eso media vuelta de
  // más: sin ella el personaje caminaba mirando al lado contrario de su marcha
  // y el espejo lo fotografiaba de espaldas.
  const MEDIA_VUELTA = Math.PI;

  // Nombres de hueso normalizados (three.js quita los puntos: "UpperArm.R" → "UpperArmR")
  const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const A = {
    root: null, mixer: null, actions: {}, current: null,
    pos: new THREE.Vector3(), yaw: 0, ready: false,
    moving: false, target: null, lastClip: null,
    allBones: new Map(),   // todos los huesos (para colgar la prenda que se prueba)
    altura: 1.7, escala: 1, // medidas reales del modelo cargado
    prenda: null,          // { prod, tipo, partes } de la prenda puesta
    readyPromise: null, resolveReady: null,
  };

  // Resuelve cuando el GLB del avatar terminó (cargue o falle)
  A.readyPromise = new Promise((res) => { A.resolveReady = res; });

  // El grupo de la parte se añade a la escena YA: el modelo llega por red y
  // para entonces S.build() ya habría decidido no añadir un grupo vacío.
  S.scene.add(g);

  function puntoLibre(x, z, clear = 0.7) {
    const nav = S.mkNav;
    if (nav && nav.ready && nav.freeSpots) {
      const spots = nav.freeSpots(x, z, clear);
      if (spots.length) return { x: spots[0].x, z: spots[0].z };
    }
    return { x, z };
  }

  function bloqueado(x, z) {
    const nav = S.mkNav;
    if (!nav || !nav.ready) return false;
    return nav.hits(x, z, RADIO);
  }

  /**
   * Busca un sitio libre alrededor del avatar para poner la cámara y la deja
   * mirándolo. Devuelve false si no encontró ninguno (interior muy angosto).
   */
  function colocarCamara() {
    const nav = S.mkNav;
    const alturas = [2.15, 1.85, 2.45];
    const distancias = [4.2, 3.3, 5.2, 2.6];
    const angulos = [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4, Math.PI];
    for (const d of distancias) {
      for (const a of angulos) {
        const x = A.pos.x + Math.sin(a) * d;
        const z = A.pos.z + Math.cos(a) * d;
        if (nav && nav.ready && nav.hits(x, z, 0.35)) continue;
        S.controls.target.set(A.pos.x, A.pos.y + ALTURA_CAMARA, A.pos.z);
        S.camera.position.set(x, A.pos.y + alturas[0], z);
        S.controls.update();
        return true;
      }
    }
    // Último recurso: mirar desde arriba
    S.controls.target.set(A.pos.x, A.pos.y + ALTURA_CAMARA, A.pos.z);
    S.camera.position.set(A.pos.x, A.pos.y + 3.4, A.pos.z + 0.01);
    S.controls.update();
    return false;
  }

  // ── Carga del personaje ──────────────────────────────────
  new THREE.GLTFLoader().load(MODEL_URL, (gltf) => {
    const model = gltf.scene;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // el skinning saca la malla de su caja original
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m) m.side = THREE.DoubleSide; });
    });
    g.add(model);
    A.root = model;

    // Medidas reales del modelo: la ropa del probador se dimensiona con esto
    const caja = new THREE.Box3().setFromObject(model);
    const alto = caja.max.y - caja.min.y;
    A.altura = (alto > 0.6 && alto < 3) ? alto : 1.7;
    A.escala = A.altura / 1.7;

    A.mixer = new THREE.AnimationMixer(model);
    (gltf.animations || []).forEach((clip) => {
      A.actions[clip.name] = A.mixer.clipAction(clip);
    });

    // Se indexan todos los huesos: los usa el probador para colgar la prenda
    // elegida y para escalarla al cuerpo real del modelo.
    // OJO: three.js sanea los nombres de nodo al cargar el glTF (elimina los
    // caracteres reservados, entre ellos el punto), así que "UpperArm.R" llega
    // como "UpperArmR": se guardan siempre normalizados.
    const norm = normName;
    model.traverse((o) => {
      if (o.isBone) A.allBones.set(norm(o.name), o);
    });

    // Posición inicial: un punto libre cerca del centro del local
    const mk = S.MK || { cx: 36.9, cz: -5.7, floorY: 0.3 };
    const spawn = puntoLibre(mk.cx, mk.cz, 0.9);
    A.pos.set(spawn.x, mk.floorY ?? 0.3, spawn.z);
    A.yaw = Math.PI + MEDIA_VUELTA; // mirando hacia la entrada de la tienda (+Z)
    model.position.copy(A.pos);
    model.rotation.y = A.yaw;

    A.ready = true;
    cambiarClip(IDLE, 0);
    console.log('[TiendaVR] Avatar listo ·', A.actions[IDLE] ? 'con animaciones' : 'sin clips', '· huesos:', A.allBones.size);
    A.resolveReady && A.resolveReady(true);
  }, undefined, (err) => {
    console.error('[TiendaVR] No se pudo cargar el avatar del cliente', err);
    A.resolveReady && A.resolveReady(false);
  });

  function cambiarClip(nombre, fade = 0.25) {
    if (!A.mixer || !A.actions[nombre] || A.lastClip === nombre) return;
    const next = A.actions[nombre];
    next.reset();
    next.setEffectiveWeight(1);
    next.setLoop(THREE.LoopRepeat, Infinity);
    if (A.current && A.current !== next) A.current.crossFadeTo(next, fade, false);
    next.play();
    A.current = next;
    A.lastClip = nombre;
  }

  // ══════════════════════════════════════════════════════
  //  PROBADOR: la prenda elegida se viste sobre el avatar
  //  ----------------------------------------------------
  //  Cada categoría se traduce a una geometría estilizada —igual que las
  //  prendas de los rieles— del color del producto, colgada del hueso
  //  correspondiente (pecho, caderas, muslos, pies) para que acompañe el
  //  caminar. No es un modelo textil real: es una representación.
  // ══════════════════════════════════════════════════════
  const PATRONES = [
    ['vestido', /vestido/],
    ['falda', /falda/],
    ['pantalon', /pantal|chino|jean|short|legging|jogger/],
    ['calzado', /calzado|zapato|sneaker|stiletto|tenis|sandalia|bota|mocasin|zapatilla/],
    ['chaqueta', /chaqueta|abrigo|bomber|sudadera|hoodie|cardigan|blazer|sastre|parka|trench|chamarra|exterior|sueter|sweater|jersey/],
    ['accesorio', /accesorio|bolso|mochila|clutch|collar|pulsera|reloj|gafas|sombrero|gorro|cintur|bufanda|corbata|joyeria|aretes|anillo/],
    ['top', /blusa|camis|top|playera|polo|body|crop|tshirt|chaleco/],
  ];
  const tipoDePrenda = (prod) => {
    const blob = normName(`${prod.category || ''} ${prod.name || ''}`);
    for (const [tipo, re] of PATRONES) if (re.test(blob)) return tipo;
    return 'top';
  };

  function quitarPrenda(recuerda = true) {
    // OJO: hay que retirar el GRUPO raíz que se añadió al modelo; las piezas
    // cuelgan de él, no del modelo. Retirar las piezas directamente dejaba el
    // grupo (y su malla) en escena y las prendas se iban acumulando.
    if (A.prenda && A.prenda.grupo) {
      A.root.remove(A.prenda.grupo);
      A.prenda.grupo.traverse((o) => {
        if (!o.isMesh) return;
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m && m.dispose());
      });
    }
    A.prenda = null;
    if (recuerda) { try { localStorage.removeItem('vivamoda_vr_outfit'); } catch (_) {} }
  }

  function construirPrenda(prod) {
    const E = A.escala; // 1.0 = persona de 1,70 m
    const color = Number.isFinite(Number(prod.c3d)) ? Number(prod.c3d) : 0xe4006c;
    // envMapIntensity bajo: el entorno blanco de la tienda lavaba el color
    // del producto (un magenta oscuro se veía casi pastel)
    const tela = () => S.mat(color, { roughness: 0.9, metalness: 0.02, envMapIntensity: 0.35 });
    const remate = () => S.mat(0x222227, { roughness: 0.7, metalness: 0.1 });
    const tipo = tipoDePrenda(prod);
    const hueso = (n) => A.allBones.get(n) || null;
    const partes = [];

    const pieza = (bone, mesh, off) => {
      const grupo = new THREE.Group();
      mesh.position.set(off.x, off.y, off.z);
      mesh.castShadow = true;
      grupo.add(mesh);
      partes.push({ grupo, bone });
    };

    switch (tipo) {
      case 'vestido':
        // radios holgados: el modelo viste camisa y pantalón propios, la
        // prenda probada debe quedar por ENCIMA de esa ropa
        pieza(hueso('chest') || hueso('torso') || hueso('hips'),
          new THREE.Mesh(new THREE.CylinderGeometry(0.25 * E, 0.42 * E, 1.04 * E, 14), tela()),
          { x: 0, y: -0.52 * E, z: 0 });
        break;
      case 'falda':
        pieza(hueso('hips'),
          new THREE.Mesh(new THREE.CylinderGeometry(0.23 * E, 0.36 * E, 0.54 * E, 14), tela()),
          { x: 0, y: -0.28 * E, z: 0 });
        break;
      case 'pantalon':
        pieza(hueso('upperlegl'),
          new THREE.Mesh(new THREE.CylinderGeometry(0.105 * E, 0.09 * E, 0.74 * E, 10), tela()),
          { x: 0, y: -0.34 * E, z: 0 });
        pieza(hueso('upperlegr'),
          new THREE.Mesh(new THREE.CylinderGeometry(0.105 * E, 0.09 * E, 0.74 * E, 10), tela()),
          { x: 0, y: -0.34 * E, z: 0 });
        break;
      case 'calzado':
        pieza(hueso('footl'), new THREE.Mesh(new THREE.BoxGeometry(0.12 * E, 0.075 * E, 0.26 * E), tela()), { x: 0, y: 0.02 * E, z: -0.05 * E });
        pieza(hueso('footr'), new THREE.Mesh(new THREE.BoxGeometry(0.12 * E, 0.075 * E, 0.26 * E), tela()), { x: 0, y: 0.02 * E, z: -0.05 * E });
        break;
      case 'chaqueta': {
        pieza(hueso('chest') || hueso('torso'),
          new THREE.Mesh(new THREE.CylinderGeometry(0.26 * E, 0.29 * E, 0.64 * E, 14), tela()),
          { x: 0, y: -0.26 * E, z: 0 });
        const cuello = new THREE.Mesh(new THREE.TorusGeometry(0.085 * E, 0.02 * E, 8, 16), remate());
        cuello.rotation.x = Math.PI / 2;
        pieza(hueso('neck') || hueso('chest'), cuello, { x: 0, y: 0.03 * E, z: -0.01 * E });
        break;
      }
      case 'accesorio': {
        if (/cintur/.test(normName(prod.name))) {
          const cinto = new THREE.Mesh(new THREE.TorusGeometry(0.20 * E, 0.026 * E, 8, 22), tela());
          cinto.rotation.x = Math.PI / 2;
          pieza(hueso('abdomen') || hueso('hips'), cinto, { x: 0, y: 0, z: 0 });
        } else {
          pieza(hueso('hips') || hueso('abdomen'),
            new THREE.Mesh(new THREE.BoxGeometry(0.20 * E, 0.15 * E, 0.07 * E), tela()),
            { x: 0.27 * E, y: -0.10 * E, z: -0.02 * E });
        }
        break;
      }
      default: // top / blusa / camisa / prenda genérica
        pieza(hueso('chest') || hueso('torso') || hueso('hips'),
          new THREE.Mesh(new THREE.CylinderGeometry(0.24 * E, 0.27 * E, 0.56 * E, 14), tela()),
          { x: 0, y: -0.22 * E, z: 0 });
    }

    const grupoRaiz = new THREE.Group();
    partes.forEach((p) => grupoRaiz.add(p.grupo));
    return { grupo: grupoRaiz, partes, tipo };
  }

  // La prenda sigue al hueso del que cuelga (posición de mundo → local del avatar)
  const vSync = new THREE.Vector3();
  function sincronizarPrenda() {
    if (!A.prenda || !A.root) return;
    A.root.updateMatrixWorld(true);
    for (const p of A.prenda.partes) {
      if (!p.bone) continue;
      p.bone.getWorldPosition(vSync);
      p.grupo.position.copy(A.root.worldToLocal(vSync));
    }
  }

  S.wearGarment = function (prod, opts = {}) {
    if (!A.ready || !A.root || !prod) return false;
    quitarPrenda(false);
    const armado = construirPrenda(prod);
    A.root.add(armado.grupo);
    A.prenda = { prod, ...armado };
    try { localStorage.setItem('vivamoda_vr_outfit', prod.sku); } catch (_) {}
    sincronizarPrenda();
    if (!opts.silencioso) console.info(`[TiendaVR] Probador: "${prod.name}" puesta en el avatar`);
    return true;
  };

  S.removeGarment = function () { quitarPrenda(true); };
  S.currentGarment = () => (A.prenda ? { sku: A.prenda.prod.sku, name: A.prenda.prod.name, tipo: A.prenda.tipo } : null);

  // Instantánea frontal del avatar (para el espejo del probador)
  S.avatarSnapshot = function (w = 512, h = 768) {
    if (!A.ready || !A.root) return null;
    try {
      const centro = new THREE.Vector3(A.pos.x, A.pos.y + A.altura * 0.52, A.pos.z);
      const dist = A.altura * 1.75;

      // La línea de vista se comprueba con un rayo: si un muro, una vitrina o
      // mobiliario tapa al avatar, se prueba otro ángulo a su alrededor. Sin
      // esto, con el avatar mirando a la fachada, el espejo mostraba un muro.
      const rayo = new THREE.Raycaster();
      rayo.camera = S.camera; // three.js lo exige para poder intersectar sprites
      const dir = new THREE.Vector3();
      const tapada = (pos) => {
        dir.copy(centro).sub(pos);
        const d = dir.length();
        dir.normalize();
        rayo.set(pos, dir);
        rayo.far = Math.max(0.1, d - 0.3);
        for (const h of rayo.intersectObjects(S.scene.children, true)) {
          if (h.object.isSprite) continue;
          let o = h.object, esAvatar = false;
          while (o) { if (o === A.root) { esAvatar = true; break; } o = o.parent; }
          if (!esAvatar) return true;
        }
        return false;
      };

      const nav = S.mkNav;
      let camPos = null;
      for (const d of [dist, dist * 1.25, dist * 0.8]) {
        for (const off of [0, 0.55, -0.55, 1.1, -1.1, 1.9, -1.9, 2.6, -2.6]) {
          const ang = A.yaw + off;
          // Cámara delante del avatar: con el frente en +Z es +sin/+cos
          const p = new THREE.Vector3(
            A.pos.x + Math.sin(ang) * d,
            A.pos.y + A.altura * 0.62,
            A.pos.z + Math.cos(ang) * d,
          );
          if (nav && nav.ready && nav.hits(p.x, p.z, 0.25)) continue;
          if (tapada(p)) continue;
          camPos = p;
          break;
        }
        if (camPos) break;
      }
      if (!camPos) {
        camPos = new THREE.Vector3(
          A.pos.x + Math.sin(A.yaw) * dist,
          A.pos.y + A.altura * 0.62,
          A.pos.z + Math.cos(A.yaw) * dist,
        );
      }
      const cam = new THREE.PerspectiveCamera(40, w / h, 0.1, 60);
      cam.position.copy(camPos);
      cam.lookAt(centro);

      const rt = new THREE.WebGLRenderTarget(w, h);
      rt.texture.encoding = THREE.sRGBEncoding;
      const previo = S.renderer.getRenderTarget();
      S.renderer.setRenderTarget(rt);
      S.renderer.render(S.scene, cam);
      const buf = new Uint8Array(w * h * 4);
      S.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      S.renderer.setRenderTarget(previo);
      rt.dispose();

      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d');
      const img = x.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * w * 4, dst = y * w * 4;
        img.data.set(buf.subarray(src, src + w * 4), dst);
      }
      x.putImageData(img, 0, 0);
      return c.toDataURL('image/jpeg', 0.9);
    } catch (err) {
      console.warn('[TiendaVR] no pude tomar la instantánea del avatar:', err.message);
      return null;
    }
  };

  // Al volver a la tienda, el look guardado se pone de nuevo (si la prenda existe)
  Promise.all([A.readyPromise, S.catalogReady || Promise.resolve()]).then(([ok]) => {
    if (ok === false) return;
    try {
      const sku = localStorage.getItem('vivamoda_vr_outfit');
      if (!sku) return;
      const prod = S.bySku(sku);
      if (prod) S.wearGarment(prod, { silencioso: true });
    } catch (_) {}
  });

  // ── Entrada de teclado ───────────────────────────────────
  const teclas = {};
  document.addEventListener('keydown', (e) => {
    teclas[e.code] = true;
    if (!S.avatarMode) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyE' && A.target && A.target.userData.product) {
      e.preventDefault();
      abrirPrenda(A.target.userData.product);
    }
  });
  document.addEventListener('keyup', (e) => { teclas[e.code] = false; });

  let pointerDown = false;
  S.renderer.domElement.addEventListener('mousedown', () => { if (S.avatarMode) pointerDown = true; });
  S.renderer.domElement.addEventListener('mouseup', () => { pointerDown = false; });

  function abrirPrenda(prod) {
    if (S.showCard) S.showCard(prod);
    if (S.bag) S.bag.close();
  }

  // ── Bucle ────────────────────────────────────────────────
  const camDir = new THREE.Vector3();
  const derecha = new THREE.Vector3();
  const empuje = new THREE.Vector3();
  const deseado = new THREE.Vector3();
  const tgt = new THREE.Vector3();
  const delta = new THREE.Vector3();

  S.addAnimate((dt) => {
    if (!A.ready) return;
    const activo = !!S.avatarMode;
    // Sin modo avatar el personaje sigue respirando: antes el mixer solo corría
    // en modo avatar, así que al mirar la tienda en modo catálogo el cliente
    // quedaba congelado en pose de reposo, con los brazos abiertos.
    if (!activo) {
      A.moving = false;
      A.target = null;
      const h = document.getElementById('avatarHint');
      if (h) h.classList.add('hidden');
    }

    let mejor = null, mejorD = ALCANCE, cambio = false;

    if (activo) {
    // El navmesh se construye cuando termina de cargar el interior (63 MB),
    // así que puede llegar DESPUÉS que el avatar. Si para entonces el punto de
    // aparición resultó estar dentro de un obstáculo, se recoloca.
    if (!A.spawnOk && S.mkNav && S.mkNav.ready) {
      A.spawnOk = true;
      if (bloqueado(A.pos.x, A.pos.z)) {
        const mk = S.MK || { cx: 36.9, cz: -5.7 };
        const libre = puntoLibre(mk.cx, mk.cz, 0.9);
        A.pos.set(libre.x, A.pos.y, libre.z);
      }
    }

    // Primera colocación de la cámara: se prueba detrás del avatar y, si esa
    // posición cae dentro de un muro o de un mueble (el interior está lleno),
    // se gira alrededor hasta encontrar un hueco libre. Sin esto la cámara
    // aparecía incrustada en una pared blanca y la pantalla se veía vacía.
    if (!A.camOk && S.mkNav && S.mkNav.ready) {
      A.camOk = true;
      colocarCamara();
    }

    // 1) Movimiento relativo a la cámara
    S.camera.getWorldDirection(camDir);
    camDir.y = 0;
    if (camDir.lengthSq() < 1e-6) camDir.set(0, 0, -1);
    camDir.normalize();
    derecha.set(-camDir.z, 0, camDir.x);

    empuje.set(0, 0, 0);
    if (teclas.KeyW || teclas.ArrowUp) empuje.add(camDir);
    if (teclas.KeyS || teclas.ArrowDown) empuje.sub(camDir);
    if (teclas.KeyD || teclas.ArrowRight) empuje.add(derecha);
    if (teclas.KeyA || teclas.ArrowLeft) empuje.sub(derecha);

    // Los campos de texto (buscador, chat, ficha de producto) tienen prioridad
    // sobre el teclado; los <select>, en cambio, se sueltan en cuanto se pulsa
    // una tecla de movimiento: antes, tras usar el selector de género de la
    // barra superior, WASD quedaba muerto porque el foco seguía en el select.
    const ae = document.activeElement;
    if (ae && ae.tagName === 'SELECT' && empuje.lengthSq() > 0) ae.blur();
    const bloqueaUI = ae && ['INPUT', 'TEXTAREA'].includes(ae.tagName);
    if (bloqueaUI) empuje.set(0, 0, 0);

    A.moving = empuje.lengthSq() > 0;
    if (A.moving) {
      empuje.normalize();
      deseado.copy(A.pos).addScaledVector(empuje, SPEED * dt);
      // Se prueba eje a eje: si uno está bloqueado se desliza por el otro,
      // así no se queda pegado a las paredes.
      if (!bloqueado(deseado.x, A.pos.z)) A.pos.x = deseado.x;
      if (!bloqueado(A.pos.x, deseado.z)) A.pos.z = deseado.z;
      // El giro se interpola en vez de asignarse de golpe: un cambio de
      // dirección podía exigir hasta 180° y se veía como un salto (el personaje
      // aparecía mirando al lado contrario de repente).
      const deseadoYaw = Math.atan2(-empuje.x, -empuje.z) + MEDIA_VUELTA;
      let dif = deseadoYaw - A.yaw;
      while (dif > Math.PI) dif -= Math.PI * 2;
      while (dif < -Math.PI) dif += Math.PI * 2;
      A.yaw += dif * Math.min(1, dt * GIRO);
    }

    // 2) Prenda más cercana a la que señalar
    for (const obj of S.clickables) {
      if (!obj.userData || !obj.userData.product) continue;
      obj.getWorldPosition(tgt);
      const d = tgt.distanceTo(A.pos);
      if (d < mejorD) { mejorD = d; mejor = obj; }
    }
    cambio = mejor !== A.target;
    A.target = mejor;
    } // fin del bloque de modo avatar

    // 3) Aplicar al modelo (siempre: el personaje existe en todos los modos)
    A.root.position.set(A.pos.x, A.pos.y, A.pos.z);
    A.root.rotation.y = A.yaw;
    cambiarClip(A.moving ? WALK : IDLE);
    A.mixer.update(dt);
    sincronizarPrenda(); // la prenda probada sigue al cuerpo al caminar

    if (!activo) return;

    // 4) Cámara: sigue al avatar conservando el ángulo del usuario
    tgt.set(A.pos.x, A.pos.y + ALTURA_CAMARA, A.pos.z);
    delta.copy(tgt).sub(S.controls.target);
    S.controls.target.add(delta);
    S.camera.position.add(delta);

    // 5) Aviso en pantalla
    if (cambio) {
      const hint = document.getElementById('avatarHint');
      const txt = document.getElementById('avatarHintText');
      const key = document.getElementById('avatarHintKey');
      if (hint && txt) {
        if (mejor) {
          const p = mejor.userData.product;
          txt.textContent = `${p.name} · a ${mejorD.toFixed(1)} m`;
          key && key.classList.remove('hidden');
          hint.classList.remove('hidden');
        } else {
          hint.classList.add('hidden');
        }
      }
    }
  });

  // ── Entrar / salir del modo avatar ───────────────────────
  S.startAvatarSession = function () {
    if (S.avatarMode) return;
    S.avatarMode = true;
    S.fps = false;
    S.tour = false;
    S.controls.enabled = true;
    S.controls.enablePan = false;
    // Al entrar se vuelve a encuadrar: el bucle coloca la cámara en cuanto el
    // navmesh está listo (ver colocarCamara).
    A.camOk = false;
  };

  S.exitAvatarSession = function () {
    if (!S.avatarMode) return;
    S.avatarMode = false;
    const hint = document.getElementById('avatarHint');
    if (hint) hint.classList.add('hidden');
    S.controls.enablePan = true;
  };
});
