/* ============================================================
   AVATAR DEL CLIENTE EN LA TIENDA VR (3ª persona)
   ------------------------------------------------------------
   La tienda solo tenía una cámara orbital y un modo FPS sin
   cuerpo. Aquí se añade un personaje real —el mismo avatar
   riggeado de la asesora, con sus clips Idle/Walk— que el cliente
   pasea con WASD y que SEÑALA la prenda que tiene delante para
   poder verla y añadirla a la bolsa.

   Decisiones:
   - La cámara sigue al avatar reutilizando OrbitControls: se
     desplaza el target y la cámara el mismo delta, así se conserva
     el ángulo que haya elegido el usuario y no hay que escribir un
     segundo sistema de órbita.
   - El movimiento se valida contra S.mkNav (el navmesh que ya
     extrae los obstáculos del propio GLB), de modo que el avatar no
     atraviesa paredes, mesas ni percheros.
   - El gesto de señalar se genera por código sobre los huesos,
     igual que el "explicando" de la asesora: el GLB no trae ningún
     clip de señalar que no sea con pistola.
   ============================================================ */
VRStore.part('avatar', function (S, g) {
  const MODEL_URL = '/models/asesor/asesor-vivamoda.glb';
  const IDLE = 'Idle_Neutral';
  const WALK = 'Walk';
  const SPEED = 3.1;          // m/s
  const GIRO = 9;             // suavizado del giro
  const RADIO = 0.34;         // margen de colisión del cuerpo
  const ALCANCE = 3.8;        // distancia a la que señala una prenda
  const ALTURA_CAMARA = 1.15; // a qué altura mira la cámara del avatar

  // Pose de señalar (radianes, sobre ejes del MUNDO → se convierte al
  // espacio local de cada hueso con el cuórum de su padre).
  const SENALA = {
    Chest:        { x: 0.0, y: -0.12 },
    Head:         { x: 0.05 },
    'UpperArm.R': { x: -0.95, z: 0.10 },
    'LowerArm.R': { x: -0.10 },
    'Wrist.R':    { x: 0.0 },
  };

  const A = {
    root: null, mixer: null, actions: {}, current: null,
    pos: new THREE.Vector3(), yaw: 0, ready: false,
    moving: false, target: null, senala: 0, objetivoSenala: 0,
    bones: new Map(), tmp: null, lastClip: null,
  };

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

    A.mixer = new THREE.AnimationMixer(model);
    (gltf.animations || []).forEach((clip) => {
      A.actions[clip.name] = A.mixer.clipAction(clip);
    });

    // Huesos que mueve el gesto de señalar.
    // OJO: three.js sanea los nombres de nodo al cargar el glTF (elimina los
    // caracteres reservados, entre ellos el punto), así que "UpperArm.R" llega
    // como "UpperArmR". Se comparan los nombres normalizados o solo enganchan
    // los que no llevan punto (Chest, Head) y el brazo no se mueve.
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const porNombre = new Map();
    model.traverse((o) => { if (o.isBone) porNombre.set(norm(o.name), o); });
    Object.keys(SENALA).forEach((n) => {
      const b = porNombre.get(norm(n));
      if (b) A.bones.set(n, b);
    });
    A.tmp = {
      q: new THREE.Quaternion(), off: new THREE.Quaternion(),
      padre: new THREE.Quaternion(), world: new THREE.Quaternion(),
      eje: new THREE.Vector3(),
    };

    // Posición inicial: un punto libre cerca del centro del local
    const mk = S.MK || { cx: 36.9, cz: -5.7, floorY: 0.3 };
    const spawn = puntoLibre(mk.cx, mk.cz, 0.9);
    A.pos.set(spawn.x, mk.floorY ?? 0.3, spawn.z);
    A.yaw = Math.PI; // mirando hacia el fondo de la tienda
    model.position.copy(A.pos);
    model.rotation.y = A.yaw;

    A.ready = true;
    cambiarClip(IDLE, 0);
    console.log('[TiendaVR] Avatar listo ·', A.actions[IDLE] ? 'con animaciones' : 'sin clips', '· huesos del gesto:', A.bones.size);
  }, undefined, (err) => {
    console.error('[TiendaVR] No se pudo cargar el avatar del cliente', err);
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

  // ── Gesto de señalar (generado por código) ───────────────
  function aplicarSenala(dt) {
    if (!A.bones.size) return;
    A.senala += (A.objetivoSenala - A.senala) * Math.min(1, dt * 6);
    if (A.senala < 0.002) return;
    const T = A.tmp;
    for (const [nombre, spec] of Object.entries(SENALA)) {
      const hueso = A.bones.get(nombre);
      if (!hueso || !hueso.parent) continue;
      T.q.identity();
      for (const [eje, ang] of Object.entries(spec)) {
        T.eje.set(eje === 'x' ? 1 : 0, eje === 'y' ? 1 : 0, eje === 'z' ? 1 : 0);
        T.q.multiply(T.off.setFromAxisAngle(T.eje, ang * A.senala));
      }
      hueso.parent.getWorldQuaternion(T.padre);
      T.world.copy(T.padre).invert().multiply(T.q).multiply(T.padre);
      hueso.quaternion.premultiply(T.world);
    }
  }

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
      A.objetivoSenala = 0;
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

    const bloqueaUI = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (bloqueaUI) empuje.set(0, 0, 0);

    A.moving = empuje.lengthSq() > 0;
    if (A.moving) {
      empuje.normalize();
      deseado.copy(A.pos).addScaledVector(empuje, SPEED * dt);
      // Se prueba eje a eje: si uno está bloqueado se desliza por el otro,
      // así no se queda pegado a las paredes.
      if (!bloqueado(deseado.x, A.pos.z)) A.pos.x = deseado.x;
      if (!bloqueado(A.pos.x, deseado.z)) A.pos.z = deseado.z;
      A.yaw = Math.atan2(-empuje.x, -empuje.z); // el modelo mira hacia -Z
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

    // Si no se mueve y hay prenda cerca, se gira hacia ella y la señala
    if (mejor && !A.moving) {
      mejor.getWorldPosition(tgt);
      const deseadoYaw = Math.atan2(-(tgt.x - A.pos.x), -(tgt.z - A.pos.z));
      let dif = deseadoYaw - A.yaw;
      while (dif > Math.PI) dif -= Math.PI * 2;
      while (dif < -Math.PI) dif += Math.PI * 2;
      A.yaw += dif * Math.min(1, dt * GIRO);
    }
    A.objetivoSenala = mejor && !A.moving ? 1 : 0;
    } // fin del bloque de modo avatar

    // 3) Aplicar al modelo (siempre: el personaje existe en todos los modos)
    A.root.position.set(A.pos.x, A.pos.y, A.pos.z);
    A.root.rotation.y = A.yaw;
    cambiarClip(A.moving ? WALK : IDLE);
    A.mixer.update(dt);
    aplicarSenala(dt);

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
    A.objetivoSenala = 0;
    const hint = document.getElementById('avatarHint');
    if (hint) hint.classList.add('hidden');
    S.controls.enablePan = true;
  };
});
