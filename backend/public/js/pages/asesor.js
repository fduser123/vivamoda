// =====================================================================
// VivaModa · Asesora 3D de prendas  (/asesor-de-prendas)
// ---------------------------------------------------------------------
// Nova es el personaje riggeado de backend/public/models/Suit.blend,
// exportado a GLB (62 huesos, 24 animaciones) y animado aquí con
// three.js. Explica las familias de prendas reales de la tienda
// (GET /api/categories + GET /api/products) y responde preguntas con la
// IA que ya tiene el proyecto (VM.aiChat).
// =====================================================================
(() => {
  const { api, esc, fmtUSD, aiChat, modelChipHtml, aiExtrasHtml, aiTypingHtml, toast } = window.VM;
  const $ = (id) => document.getElementById(id);

  const MODEL_URL = '/models/asesor/asesor-vivamoda.glb';
  const IDLE = 'Idle_Neutral';
  // Clips que se repiten (locomoción) mientras Nova "actúa"
  const LOOPING = new Set(['Idle', 'Idle_Neutral', 'Idle_Gun', 'Idle_Sword', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right', 'Idle_Gun_Pointing']);

  // El GLB trae 24 animaciones y la mayoría son de COMBATE (Death, Gun_Shoot,
  // Punch, Kick, Sword_Slash, HitRecieve…). Enseñarlas en una asesora de moda
  // no tiene sentido, así que el selector solo ofrece las que encajan.
  const ASESOR_CLIPS = [IDLE, 'Idle', 'Wave', 'Interact', 'Walk', 'Run'];
  // Opción sintética del selector: no es un clip del GLB, es el gesto que se
  // genera por código mientras Nova habla.
  const EXPLICANDO = '__explicando';

  // ── Gesto "explicando" (generado por código) ─────────────────────────
  // Ni el GLB ni Mixamo traen un clip de "explicar": los 24 del modelo son de
  // combate y locomoción. Y como cada explicación dura lo que dura su locución,
  // un clip de duración fija no sirve. Por eso el gesto se calcula aquí y se
  // superpone al reposo: se estira o se encoge con el audio.
  //
  // Las rotaciones se definen sobre EJES DEL MUNDO y se convierten al espacio
  // local de cada hueso con el cuórum de su padre, así no hay que adivinar la
  // orientación interna del rig (que cambia entre exports).
  //   +X = derecha de pantalla · +Y = arriba · +Z = hacia la cámara
  // La modelo mira a cámara, de modo que girar un brazo en X NEGATIVO lo lleva
  // hacia delante: la dirección natural de "explicar".
  //   pose → postura de partida (rad)   ·   wave → oscilación encima
  const GESTO = {
    Chest:      { pose: { x: 0.02 }, wave: [{ a: 'x', amp: 0.025, hz: 0.24 }] },
    Neck:       { pose: {}, wave: [{ a: 'x', amp: 0.05, hz: 0.55, ph: 0.3 }] },
    Head:       { pose: { x: 0.03 }, wave: [{ a: 'x', amp: 0.085, hz: 0.52, ph: 0.3 }, { a: 'y', amp: 0.10, hz: 0.21, ph: 1.4 }] },
    'Shoulder.R': { pose: { x: -0.02 }, wave: [{ a: 'x', amp: 0.02, hz: 0.42 }] },
    'UpperArm.R': { pose: { x: -0.08, z: 0.06 }, wave: [{ a: 'x', amp: 0.06, hz: 0.34, ph: 0.2 }, { a: 'z', amp: 0.05, hz: 0.21, ph: 1.1 }] },
    'LowerArm.R': { pose: { x: -0.40 }, wave: [{ a: 'x', amp: 0.13, hz: 0.46, ph: 0.5 }, { a: 'y', amp: 0.08, hz: 0.33, ph: 2.0 }] },
    'Wrist.R':    { pose: { x: -0.05 }, wave: [{ a: 'x', amp: 0.10, hz: 0.58, ph: 1.0 }] },
    'Shoulder.L': { pose: { x: -0.015 }, wave: [{ a: 'x', amp: 0.02, hz: 0.38 }] },
    'UpperArm.L': { pose: { x: -0.05, z: -0.04 }, wave: [{ a: 'x', amp: 0.04, hz: 0.29, ph: 1.7 }] },
    'LowerArm.L': { pose: { x: -0.26 }, wave: [{ a: 'x', amp: 0.08, hz: 0.40, ph: 2.4 }] },
    Hips:       { pose: {}, wave: [{ a: 'y', amp: 0.035, hz: 0.16 }] },
  };

  // ── Voz de Nova ──────────────────────────────────────────────────────
  // Sin archivos de audio: se usa la síntesis de voz del navegador. El gesto
  // arranca con la locución y se apaga al terminar, así que la animación y el
  // audio quedan sincronizados sin necesidad de medir duraciones.
  const VOZ = { habilitada: true, hablando: false, voces: [], elegida: null };
  const VOZ_STORAGE = 'vm-asesor-voz';

  // ── Familias de prendas de la tienda ────────────────────────────────
  // `categories` son los valores EXACTOS de products.category en la BD.
  const FAMILIES = [
    {
      id: 'vestidos', label: 'Vestidos', emoji: '👗', anim: 'Interact',
      categories: ['Vestidos', 'Vestidos de Noche', 'Fiesta'],
      say: 'El <b>vestido</b> es la pieza estrella: cubre torso y piernas en una sola prenda, así que no hay que combinar nada.',
      tips: ['Corte: recto, evasé (se abre desde el pecho), wrap (cruzado) y slip. El evasé disimula la cadera, el recto estiliza.', 'Tejido por ocasión: algodón o lino de día, satén/crepé para la noche.', 'Regla de oro: la costura del hombro debe caer justo en el borde de tu hombro.'],
    },
    {
      id: 'blusas', label: 'Blusas y tops', emoji: '👚', anim: 'Interact',
      categories: ['Blusas y Tops', 'Blusas'],
      say: 'Las <b>blusas y tops</b> son la parte superior del look: la blusa es más larga y formal (mangas, botones), el top es corto y casual.',
      tips: ['Con blazer encima, una blusa de seda sube el registro a oficina o evento.', 'Si el top es corto, el pantalón de tiro alto equilibra la silueta.', 'Estampados grandes: llévalos con la parte de abajo lisa.'],
    },
    {
      id: 'camiseria', label: 'Camisería', emoji: '👔', anim: 'Interact',
      categories: ['Camisería', 'Camisas'],
      say: 'La <b>camisa</b> se define por el cuello: es la prenda más versátil de la tienda, va del trabajo al fin de semana.',
      tips: ['Popelín (liso y fino) para formal; oxford (textura) para casual.', 'El cuello abrochado debe dejar un dedo de holgura.', 'Siempre lleva botón de repuesto y plancha el cuello por el revés.'],
    },
    {
      id: 'sastreria', label: 'Sastrería', emoji: '🤵', anim: IDLE,
      categories: ['Sastrería', 'Oficina', 'Conjuntos'],
      say: 'La <b>sastrería</b> es blazer + pantalón (o falda) del mismo tejido. Es la silueta que más estructura y la que más dura.',
      tips: ['Saco de 2 botones: abrocha solo el de arriba. De 3: el del medio.', 'El largo ideal del saco: a la altura de la cadera o media cadera.', 'Hombro estructurado = más formal; sin entretela = desestructurado y relajado.'],
    },
    {
      id: 'pantalones', label: 'Pantalones', emoji: '👖', anim: 'Walk',
      categories: ['Pantalones'],
      say: 'En <b>pantalones</b>, el tiro (la altura de la cintura) cambia por completo la proporción del cuerpo.',
      tips: ['Tiro alto + pierna recta: alarga. Skinny: marca; palazzo: fluye.', 'El largo correcto cae sobre el empeine o justo en el tobillo.', 'Cargo y utilitarios necesitan parte de arriba ajustada para no verse pesado.'],
    },
    {
      id: 'abrigos', label: 'Abrigos y chaquetas', emoji: '🧥', anim: 'Interact',
      categories: ['Abrigos', 'Chaquetas', 'Ropa Exterior'],
      say: 'El <b>abrigo</b> y la <b>chaqueta</b> son la capa exterior: son lo primero que se ve de tu look en la calle.',
      tips: ['Abrigo = largo y de tejido grueso (lana, paño). Chaqueta = corta y ligera (bomber, denim, moto).', 'Debe poder cerrarse sobre la prenda más gruesa que uses en invierno.', 'Regla de contraste: si el abrigo es oversize, lo de abajo va ajustado.'],
    },
    {
      id: 'deportivo', label: 'Deportivo y athleisure', emoji: '🏃‍♀️', anim: 'Run',
      categories: ['Deportivo', 'Athleisure'],
      say: 'El <b>deportivo</b> usa tejidos técnicos (dry-fit, licra, neopreno) para entrenar o para el athleisure: ropa de gimnasio llevada como look de calle.',
      tips: ['Busca tejidos con elasticidad y costuras planas para no rozar.', 'Una prenda técnica + una de calle = athleisure equilibrado.', 'Las zapatillas definen si el look es de gimnasio o de calle.'],
    },
    {
      id: 'urbano', label: 'Streetwear y casual', emoji: '🧢', anim: 'Walk',
      categories: ['Streetwear', 'Urbano', 'Casual'],
      say: 'El <b>streetwear y casual</b> es silueta amplia, denim, sudadera y capas. El objetivo es comodidad con intención.',
      tips: ['Oversize en una sola pieza; el resto más ceñido.', 'La sudadera gana con un cuello visible debajo (camiseta o camisa).', 'Un solo elemento protagonista: logo, print o color fuerte.'],
    },
    {
      id: 'calzado', label: 'Calzado', emoji: '👟', anim: 'Walk',
      categories: ['Calzado'],
      say: 'El <b>calzado</b> define el registro del look: el mismo vestido cambia por completo con tacón o con zapatilla.',
      tips: ['Tacón y salón: formal y noche. Balerinas y mocasines: día. Zapatilla: casual y deportivo.', 'Cuero = más formal; lona = más relajado.', 'Al probarlo: debe quedar espacio de un pulgar al frente.'],
    },
    {
      id: 'bolsos', label: 'Bolsos', emoji: '👜', anim: 'Wave',
      categories: ['Bolsos'],
      say: 'El <b>bolso</b> se elige por escala del evento: grande para el día, mínimo para la noche.',
      tips: ['Tote: trabajo y universidad. Crossbody: día práctico. Clutch: noche.', 'El color del bolso puede repetir el de los zapatos para cerrar el look.', 'Si el bolso es estampado, el resto del look va en silencio.'],
    },
    {
      id: 'joyeria', label: 'Joyería y relojes', emoji: '💎', anim: 'Wave',
      categories: ['Joyería', 'Relojes'],
      say: 'La <b>joyería</b> y el <b>reloj</b> son el remate del look: aportan luz y jerarquía sin cambiar la prenda.',
      tips: ['Metal dorado calienta los rasgos; plateado enfría. Según el subtono de piel.', 'Una pieza protagonista por zona: aretes grandes → collar discreto.', 'El reloj puede ser el único accesorio del look formal.'],
    },
    {
      id: 'accesorios', label: 'Accesorios', emoji: '🕶️', anim: 'Wave',
      categories: ['Accesorios'],
      say: 'Los <b>accesorios</b> (cinturón, gafas, bufanda, gorra) son los que rematan: ordenan la silueta y suman carácter.',
      tips: ['El cinturón debe coincidir con el registro de los zapatos.', 'Máximo tres accesorios visibles: más empieza a competir.', 'Gafas: la montura debe ser lo contrario al formato del rostro.'],
    },
    {
      id: 'base', label: 'Ropa interior y baño', emoji: '🩱', anim: IDLE,
      categories: ['Ropa Interior', 'Traje de Baño'],
      say: 'La <b>ropa interior y el traje de baño</b> son la capa base: son las que hacen que todo lo de arriba caiga bien.',
      tips: ['Cambiar de talla de copa cambia cómo cae la blusa encima.', 'Sin costuras o color piel bajo prendas claras y ajustadas.', 'En traje de baño, prioriza el soporte y el largo de tiro.'],
    },
  ];

  // Paleta para el color del traje (mismo espíritu que el motor de color de la tienda).
  // La primera muestra es siempre el color original del .blend, así que nunca se pierde.
  const SUIT_PALETTE = [
    { hex: '#b60055', name: 'Magenta VivaModa' },
    { hex: '#2f54d0', name: 'Cobalto' },
    { hex: '#efe7dd', name: 'Hueso' },
    { hex: '#7a1f2b', name: 'Borgoña' },
  ];

  // ── Estado 3D ────────────────────────────────────────────────────────
  const scene = {
    three: null, renderer: null, camera: null, controls: null, mixer: null,
    clips: new Map(), actions: new Map(), current: null, suitMats: [], model: null,
    stage: null, ready: false, autoRotate: true, returnToIdle: false, returnTimer: null,
    // Gesto "explicando": huesos resueltos, reloj propio y nivel 0..1 que sube
    // y baja suave para entrar y salir del gesto sin saltos.
    gesto: { bones: new Map(), t: 0, nivel: 0, objetivo: 0, tmp: null },
  };

  // ── Arranque ─────────────────────────────────────────────────────────
  // OJO: init() se invoca al FINAL del archivo, no aquí. Varias piezas que usa
  // (voz, gesto, QR) son `const` y todavía estarían en zona muerta temporal.

  async function init() {
    buildStage();
    wireUI();
    cargarPreferenciaVoz();
    if (vozSoportada()) {
      cargarVoces();
      // Las voces llegan de forma asíncrona en Chrome: hay que reintentar.
      window.speechSynthesis.addEventListener?.('voiceschanged', cargarVoces);
    }
    try {
      await loadAvatar();
      scene.ready = true;
    } catch (err) {
      console.error('[asesor] no se pudo cargar el avatar', err);
      $('vm-loader').innerHTML = '<p class="text-sm font-semibold text-[#b60055]">No se pudo cargar el avatar 3D</p><p class="text-[11px] text-gray-400 mt-1">Revisa que exista /models/asesor/asesor-vivamoda.glb</p>';
      $('vm-now').textContent = 'Modelo no disponible';
    }
    buildPalette();
    await loadFamilies();

    // Si llega con ?sku= (por ejemplo al escanear un QR) se abre su familia y
    // esa prenda queda fijada como objetivo del QR.
    const sku = paramUrl('sku');
    if (sku) {
      const fam = await abrirDesdeSku(sku);
      if (!fam) await selectFamily(FAMILIES[0], { silent: true });
    } else {
      await selectFamily(FAMILIES[0], { silent: true });
    }

    // ?gesto=1 deja a Nova explicando en bucle, sin locución ni interacción:
    // sirve para un modo kiosco (o para comprobar el gesto sin tocar nada).
    if (paramUrl('gesto') === '1') gestoExplicando(true);
  }

  /** Lee un parámetro de la URL (?sku=…). VM.qs construye, no lee. */
  const paramUrl = (name) => new URLSearchParams(location.search).get(name) || '';

  /**
   * Abre la asesora en la familia a la que pertenece una prenda y la fija como
   * objetivo del QR. Es el camino que sigue el móvil al escanear la etiqueta.
   */
  async function abrirDesdeSku(sku) {
    try {
      const { product } = await api(`/products/${encodeURIComponent(sku)}`, { auth: false });
      if (!product) return null;
      state.skuFijado = product.sku;
      // La familia se deduce por categoría y, si no, por parecido del nombre.
      const fam = FAMILIES.find((f) => f.categories.includes(product.category))
        || FAMILIES.find((f) => {
          const nom = `${product.name} ${product.category}`.toLowerCase();
          return f.categories.some((c) => nom.includes(c.toLowerCase().replace(/s$/, '')));
        });
      if (fam) {
        await selectFamily(fam);
        // La prenda del QR va primera, para que se vea de qué se está hablando.
        if (state.productos?.length) {
          const i = state.productos.findIndex((p) => p.sku === product.sku);
          if (i > 0) state.productos.unshift(state.productos.splice(i, 1)[0]);
        }
        if ($('vm-say')) {
          $('vm-say').insertAdjacentHTML('beforeend',
            `<div class="mt-2 pt-2 border-t border-[#f0dbe6] text-[11px] text-[#7b5468]">📱 Abierto por QR: <b>${esc(product.name)}</b></div>`);
        }
      }
      return fam || null;
    } catch (err) {
      console.warn('[asesor] no se pudo abrir el sku', sku, err);
      return null;
    }
  }

  // ── Escena three.js ──────────────────────────────────────────────────
  function buildStage() {
    const canvas = $('vm-canvas');
    const stage = $('vm-stage');
    scene.stage = stage;
    if (!window.THREE) {
      $('vm-loader').innerHTML = '<p class="text-sm font-semibold text-[#b60055]">No se pudo cargar three.js</p>';
      return;
    }
    const three = new THREE.Scene();
    scene.three = three;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene.renderer = renderer;

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 1.15, 4);
    scene.camera = camera;

    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI * 0.52; // no baja del suelo
    controls.autoRotateSpeed = 1.6;
    controls.target.set(0, 0.95, 0);
    scene.controls = controls;

    // Luces con la paleta de la marca
    scene.root = new THREE.Group();
    three.add(scene.root);
    scene.root.add(new THREE.HemisphereLight(0xffffff, 0xe7dde4, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(2.6, 4.2, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 14;
    key.shadow.camera.left = -2;
    key.shadow.camera.right = 2;
    key.shadow.camera.top = 3;
    key.shadow.camera.bottom = -0.5;
    key.shadow.radius = 3;
    scene.root.add(key);
    const rim = new THREE.DirectionalLight(0xb60055, 0.55); // contraluz magenta
    rim.position.set(-2.8, 2.4, -2.6);
    scene.root.add(rim);
    const fill = new THREE.DirectionalLight(0x4b41e1, 0.35); // relleno azul
    fill.position.set(-2.4, 1.6, 2.8);
    scene.root.add(fill);

    // Plataforma
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 64),
      new THREE.MeshStandardMaterial({ color: 0xf7f2f6, roughness: 0.95, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.root.add(floor);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.02, 1.09, 96),
      new THREE.MeshBasicMaterial({ color: 0xb60055, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    scene.root.add(ring);

    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    else window.addEventListener('resize', resize);

    // Expuesto para depurar/integrar desde consola (VMAsesor.three, .actions…)
    window.VMAsesor = scene;

    (function loop() {
      let last = performance.now();
      (function frame(now) {
        requestAnimationFrame(frame);
        // dt real (acotado): el gesto depende del tiempo, no de los FPS
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        if (scene.mixer) { scene.mixer.update(dt); aplicarGesto(dt); }
        if (scene.controls) scene.controls.update();
        if (scene.renderer && scene.camera && scene.three) scene.renderer.render(scene.three, scene.camera);
      })(last);
    })();
  }

  // ── Motor del gesto "explicando" ─────────────────────────────────────
  /** Resuelve los huesos del rig por nombre (una sola vez, tras cargar). */
  function recogerHuesos() {
    // three.js sanea los nombres de nodo del glTF y elimina los caracteres
    // reservados, entre ellos el punto: "UpperArm.R" llega como "UpperArmR".
    // Comparando en crudo solo enganchaban los huesos sin punto (Chest, Neck,
    // Head, Hips) y los brazos se quedaban quietos.
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const porNombre = new Map();
    scene.model.traverse((o) => { if (o.isBone) porNombre.set(norm(o.name), o); });
    for (const nombre of Object.keys(GESTO)) {
      const hueso = porNombre.get(norm(nombre));
      if (hueso) scene.gesto.bones.set(nombre, hueso);
    }
    if (!scene.gesto.tmp) {
      scene.gesto.tmp = {
        q: new THREE.Quaternion(), off: new THREE.Quaternion(),
        padre: new THREE.Quaternion(), world: new THREE.Quaternion(),
        eje: new THREE.Vector3(),
      };
    }
    return scene.gesto.bones.size;
  }

  /**
   * Aplica el gesto encima del clip que esté sonando. Se llama SIEMPRE después
   * de mixer.update(), que reescribe el cuórum de los 62 huesos en cada
   * fotograma; por eso multiplicar el offset no se acumula entre frames.
   */
  function aplicarGesto(dt) {
    const g = scene.gesto;
    if (!g.bones.size) return;
    g.t += dt;
    // rampa suave hacia el objetivo (0 = reposo, 1 = explicando)
    g.nivel += (g.objetivo - g.nivel) * Math.min(1, dt * 3.2);
    if (g.nivel < 0.001 && g.objetivo === 0) { g.nivel = 0; return; }

    const T = g.tmp;
    for (const [nombre, spec] of Object.entries(GESTO)) {
      const hueso = g.bones.get(nombre);
      if (!hueso || !hueso.parent) continue;

      T.q.identity();
      for (const [eje, ang] of Object.entries(spec.pose || {})) {
        T.eje.set(eje === 'x' ? 1 : 0, eje === 'y' ? 1 : 0, eje === 'z' ? 1 : 0);
        T.q.multiply(T.off.setFromAxisAngle(T.eje, ang * g.nivel));
      }
      for (const w of spec.wave || []) {
        const fase = g.t * w.hz * Math.PI * 2 + (w.ph || 0);
        // dos armónicos: el segundo quita la sensación de péndulo perfecto
        const ang = (w.amp * Math.sin(fase) + (w.amp2 || 0) * Math.sin(fase * 2.3)) * g.nivel;
        T.eje.set(w.a === 'x' ? 1 : 0, w.a === 'y' ? 1 : 0, w.a === 'z' ? 1 : 0);
        T.q.multiply(T.off.setFromAxisAngle(T.eje, ang));
      }

      // Del espacio del padre al local del hueso: local' = P⁻¹ · R · P · local
      hueso.parent.getWorldQuaternion(T.padre);
      T.world.copy(T.padre).invert().multiply(T.q).multiply(T.padre);
      hueso.quaternion.premultiply(T.world);
    }
  }

  /** Enciende o apaga el gesto (con rampa, nunca de golpe). */
  function gestoExplicando(on) {
    scene.gesto.objetivo = on ? 1 : 0;
    if (on && // el reloj arranca de cero para que el gesto empiece por el principio
      scene.gesto.nivel < 0.05) scene.gesto.t = 0;
    const chip = $('vm-now');
    if (chip && on) chip.textContent = 'Explicando…';
  }

  // ── Voz de Nova (síntesis de voz del navegador) ──────────────────────
  // Sin archivos de audio: el texto de cada familia ya existe, así que Nova lo
  // locuta con la voz del dispositivo. Si el navegador no la soporta, la página
  // sigue funcionando: solo se queda sin sonido y con el gesto.
  const vozSoportada = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  /** Elige la mejor voz en español disponible (prefiere femeninas). */
  function elegirVoz(voces) {
    if (!voces || !voces.length) return null;
    const es = voces.filter((v) => /^es\b|^es-/i.test(v.lang || ''));
    const lista = es.length ? es : voces;
    const femenina = /(m[oó]nica|paulina|helena|sabina|elvira|laura|esperanza|carmen|female|mujer|google español)/i;
    return lista.find((v) => femenina.test(v.name) && /^es-(MX|CO|US|ES)/i.test(v.lang))
      || lista.find((v) => femenina.test(v.name))
      || lista.find((v) => /^es-(MX|CO|US|ES)/i.test(v.lang))
      || lista[0];
  }

  function cargarVoces() {
    if (!vozSoportada()) { notaVoz('Este navegador no tiene voz sintética: Nova se mueve pero no habla.'); return; }
    VOZ.voces = window.speechSynthesis.getVoices() || [];
    VOZ.elegida = elegirVoz(VOZ.voces);
    notaVoz(VOZ.elegida
      ? `Voz: ${VOZ.elegida.name} (${VOZ.elegida.lang})`
      : 'Voz del sistema no disponible todavía.');
  }

  function notaVoz(txt) {
    const el = $('vm-voice-note');
    if (el) el.textContent = txt || '';
  }

  const sinHtml = (t) => String(t || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  /**
   * Locuta un texto y sincroniza el gesto: arranca al hablar y se apaga al
   * terminar. El gesto se enciende también antes del evento `start` porque en
   * algunos navegadores tarda en llegar.
   */
  function hablar(texto) {
    if (!VOZ.habilitada || !vozSoportada()) return false;
    const synth = window.speechSynthesis;
    synth.cancel(); // nunca dos locuciones a la vez
    const u = new SpeechSynthesisUtterance(sinHtml(texto));
    u.lang = (VOZ.elegida && VOZ.elegida.lang) || 'es-ES';
    if (VOZ.elegida) u.voice = VOZ.elegida;
    u.rate = 1; u.pitch = 1.05; u.volume = 1;
    u.onstart = () => { VOZ.hablando = true; gestoExplicando(true); };
    u.onend = () => { VOZ.hablando = false; gestoExplicando(false); };
    u.onerror = () => { VOZ.hablando = false; gestoExplicando(false); };
    VOZ.hablando = true;
    gestoExplicando(true);
    try { synth.speak(u); } catch { VOZ.hablando = false; return false; }
    return true;
  }

  const callarVoz = () => {
    if (!vozSoportada()) return;
    window.speechSynthesis.cancel();
    VOZ.hablando = false;
    gestoExplicando(false);
  };

  function cargarPreferenciaVoz() {
    const guardado = localStorage.getItem(VOZ_STORAGE);
    VOZ.habilitada = guardado === null ? true : guardado === '1';
    const btn = $('vm-voice');
    if (btn) {
      btn.setAttribute('aria-pressed', String(VOZ.habilitada));
      btn.textContent = VOZ.habilitada ? '🔊 Voz' : '🔇 Voz';
    }
  }

  function alternarVoz() {
    VOZ.habilitada = !VOZ.habilitada;
    localStorage.setItem(VOZ_STORAGE, VOZ.habilitada ? '1' : '0');
    cargarPreferenciaVoz();
    if (!VOZ.habilitada) {
      callarVoz();
      notaVoz('Voz silenciada: Nova sigue explicando con gestos.');
    } else {
      notaVoz(VOZ.elegida ? `Voz: ${VOZ.elegida.name} (${VOZ.elegida.lang})` : '');
    }
  }

  // ── QR: llevar la explicación al móvil ───────────────────────────────
  /** Prenda objetivo del QR: la fijada por ?sku= o la primera de la familia. */
  const skuObjetivo = () => state.skuFijado || state.productos?.[0]?.sku || '';

  async function abrirQr() {
    const sku = skuObjetivo();
    if (!sku) { toast('Elige primero una familia con piezas', 'qr'); return; }
    const modal = $('vm-qr-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    $('vm-qr-what').textContent = '';
    $('vm-qr-url').textContent = 'Generando…';
    try {
      // El backend arma la URL con la IP de la red local (la única que el móvil
      // puede alcanzar) y la devuelve en la cabecera X-QR-Url, así que la imagen
      // y el texto mostrado salen siempre de la misma fuente.
      const res = await fetch(`/api/products/${encodeURIComponent(sku)}/qr?to=asesor`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const url = res.headers.get('X-QR-Url') || '';
      const blob = await res.blob();
      const img = $('vm-qr-img');
      if (img.dataset.blob) URL.revokeObjectURL(img.dataset.blob);
      const obj = URL.createObjectURL(blob);
      img.dataset.blob = obj;
      img.src = obj;
      $('vm-qr-url').textContent = url;
      const prenda = state.productos?.find((p) => p.sku === sku);
      $('vm-qr-what').textContent = `Abre la asesora 3D con: ${prenda?.name || sku}`;
      $('vm-qr-port').textContent = location.port || '80';
    } catch (err) {
      $('vm-qr-url').textContent = 'No se pudo generar el QR: ' + (err.message || 'error');
    }
  }

  function cerrarQr() {
    const modal = $('vm-qr-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  function resize() {
    const stage = scene.stage;
    if (!stage || !scene.renderer) return;
    const w = stage.clientWidth || 1;
    const h = stage.clientHeight || 1;
    scene.renderer.setSize(w, h, false);
    scene.camera.aspect = w / h;
    scene.camera.updateProjectionMatrix();
  }

  /** Encuadra el modelo de cuerpo completo y encaja la cámara a su altura */
  function frameModel() {
    const box = new THREE.Box3().setFromObject(scene.root, true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = Math.max(size.y, 0.5);
    const fov = THREE.MathUtils.degToRad(scene.camera.fov);
    const dist = (height * 1.12) / 2 / Math.tan(fov / 2);
    scene.controls.target.set(0, center.y, 0);
    // La modelo mira hacia -Z: la cámara va en -Z para verla DE FRENTE desde el
    // primer momento. Con +Z (como estaba) lo primero que se veía era la espalda
    // y había que esperar a que el giro automático la diera la vuelta.
    scene.camera.position.set(0, center.y + height * 0.08, -dist);
    scene.controls.minDistance = dist * 0.45;
    scene.controls.maxDistance = dist * 2.6;
    scene.controls.update();
    return { height, dist };
  }

  // ── Cargar el avatar y sus animaciones ───────────────────────────────
  function loadAvatar() {
    return new Promise((resolve, reject) => {
      if (!window.THREE || !THREE.GLTFLoader) return reject(new Error('three.js/GLTFLoader no disponibles'));
      new THREE.GLTFLoader().load(MODEL_URL, (gltf) => {
        const model = gltf.scene;
        model.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false; // el skinning mueve la malla fuera de su caja original
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (!m) continue;
            m.side = THREE.DoubleSide; // tejido fino: evita agujeros al girar
            if (/^black$/i.test(m.name || '')) scene.suitMats.push(m);
          }
        });
        // Los pies quedan sobre la plataforma, centrado en x/z
        scene.root.add(model);
        const box = new THREE.Box3().setFromObject(model, true);
        model.position.x -= (box.min.x + box.max.x) / 2;
        model.position.z -= (box.min.z + box.max.z) / 2;
        model.position.y -= box.min.y;
        scene.model = model;

        scene.mixer = new THREE.AnimationMixer(model);
        for (const clip of gltf.animations || []) {
          scene.clips.set(clip.name, clip);
          scene.actions.set(clip.name, scene.mixer.clipAction(clip));
        }
        // Un gesto de un solo pase vuelve solo al reposo
        scene.mixer.addEventListener('finished', () => {
          if (!scene.returnToIdle) return;
          scene.returnToIdle = false;
          play(selectedAnim(), false);
        });

        fillAnimSelect();
        frameModel();
        play(IDLE, false);
        const huesos = recogerHuesos();
        $('vm-now').textContent = huesos
          ? `Nova en reposo · gesto listo (${huesos} huesos)`
          : 'Nova en reposo';
        const loader = $('vm-loader');
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 520);
        resolve();
      }, undefined, (err) => reject(err));
    });
  }

  function fillAnimSelect() {
    const sel = $('vm-anim');
    // Solo los clips que encajan en una asesora de moda: el GLB trae además
    // Death, Gun_Shoot, Punch_*, Kick_*, Sword_Slash y compañía, que se omiten.
    const names = ASESOR_CLIPS.filter((n) => scene.clips.has(n));
    const preferred = [IDLE, 'Wave', 'Interact', 'Walk', 'Run'];
    names.sort((a, b) => {
      const ia = preferred.indexOf(a); const ib = preferred.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
    });
    sel.innerHTML = `<option value="${EXPLICANDO}">Explicando (gesto)</option>`
      + names.map((n) => `<option value="${esc(n)}">${esc(labelFor(n))}</option>`).join('');
  }

  const ANIM_LABELS = {
    [IDLE]: 'Reposo', Idle: 'Reposo (2)', Wave: 'Saludo', Interact: 'Presentar prenda',
    Walk: 'Caminar', Run: 'Correr', Run_Left: 'Correr (izq)', Run_Right: 'Correr (der)', Run_Back: 'Correr atrás',
    Roll: 'Rodar', Death: 'Caída', Punch_Left: 'Golpe izq', Punch_Right: 'Golpe der',
    Kick_Left: 'Patada izq', Kick_Right: 'Patada der', Sword_Slash: 'Espada', Gun_Shoot: 'Disparo',
    Idle_Gun: 'Idle (pistola)', Idle_Gun_Pointing: 'Idle (señalar)', Idle_Gun_Shoot: 'Idle (disparo)',
    Idle_Sword: 'Idle (espada)', HitRecieve: 'Recibir golpe', HitRecieve_2: 'Recibir golpe (2)', Run_Shoot: 'Correr y disparar',
  };
  const labelFor = (n) => ANIM_LABELS[n] || n.replace(/_/g, ' ');

  const selectedAnim = () => ($('vm-anim') && $('vm-anim').value) || IDLE;

  /**
   * Reproduce un clip. `once` = gesto de la familia elegida:
   *   · clip de locomoción (walk/run) → se repite unos segundos y vuelve al reposo
   *   · clip de gesto (wave/interact) → un solo pase y vuelve al reposo
   * Sin `once` queda en bucle, que es lo que se espera al elegirlo a mano.
   */
  function play(name, once) {
    if (!scene.mixer || !scene.actions.size) return;
    // "Explicando" no es un clip del GLB: es el reposo + el gesto por código.
    if (name === EXPLICANDO) {
      gestoExplicando(true);
      name = IDLE;
      once = false;
    } else {
      // Cualquier clip explícito apaga el gesto para no mezclar movimientos.
      gestoExplicando(false);
    }
    const clipName = scene.clips.has(name) ? name : IDLE;
    const action = scene.actions.get(clipName);
    if (!action) return;

    clearTimeout(scene.returnTimer);
    scene.returnToIdle = false;
    const prev = scene.current;
    if (prev && prev !== action) prev.fadeOut(0.3);

    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);
    action.clampWhenFinished = false;

    if (once && LOOPING.has(clipName)) {
      action.setLoop(THREE.LoopRepeat, Infinity);
      scene.returnTimer = setTimeout(() => play(selectedAnim(), false), 3200);
    } else if (once) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      scene.returnToIdle = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }

    action.fadeIn(0.3).play();
    scene.current = action;
    $('vm-now').textContent = labelFor(clipName) + (once ? ' · gesto de la asesora' : '');
  }

  function buildPalette() {
    const box = $('vm-palette');
    const swatches = [];
    // El color que trae el modelo, tal cual (se guarda en lineal para poder restaurarlo)
    if (scene.suitMats[0]) {
      const original = scene.suitMats[0].color.clone();
      swatches.push({ hex: '#' + original.clone().convertLinearToSRGB().getHexString(), name: 'Original del modelo', linear: original });
    }
    for (const c of SUIT_PALETTE) swatches.push({ hex: c.hex, name: c.name, linear: new THREE.Color(c.hex).convertSRGBToLinear() });

    box.innerHTML = swatches.map((c, i) => `
      <button type="button" class="vm-swatch w-6 h-6 rounded-full border border-black/10 transition-transform hover:scale-110"
        style="background:${c.hex}" data-i="${i}" title="${esc(c.name)}" aria-label="Traje ${esc(c.name)}"></button>`).join('');
    markSwatch(0);

    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-i]');
      if (!btn) return;
      const sw = swatches[Number(btn.dataset.i)];
      for (const m of scene.suitMats) m.color.copy(sw.linear);
      markSwatch(Number(btn.dataset.i));
      toast(`Traje en ${sw.name}`, 'palette');
    });
  }

  function markSwatch(i) {
    for (const b of $('vm-palette').querySelectorAll('.vm-swatch')) {
      const on = Number(b.dataset.i) === i;
      b.style.outline = on ? '2px solid #b60055' : 'none';
      b.style.outlineOffset = on ? '2px' : '0';
    }
  }

  // ── Datos de la tienda ───────────────────────────────────────────────
  let counts = {};
  // Estado de la vista: familia activa, sus piezas reales y la prenda fijada
  // por la URL (?sku=), que es la que llega al escanear un QR.
  const state = { familia: null, productos: [], skuFijado: null };

  async function loadFamilies() {
    // Totales por categoría reales, para decir cuántas piezas hay de cada familia
    try {
      const { nav } = await api('/categories', { auth: false });
      for (const g of nav) for (const c of g.categories) counts[c.name] = (counts[c.name] || 0) + c.total;
    } catch { /* si falla, se muestran sin total */ }

    const box = $('vm-families');
    box.innerHTML = FAMILIES.map((f) => {
      const total = familyTotal(f);
      return `<button type="button" class="vm-chip text-[11px] font-bold rounded-full border border-[#eadfe6] px-2.5 py-1.5 text-[#7b5468]"
        data-family="${f.id}" aria-pressed="false">${f.emoji} ${esc(f.label)}${total ? ` <span class="opacity-60">${total}</span>` : ''}</button>`;
    }).join('');
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-family]');
      if (!btn) return;
      const fam = FAMILIES.find((f) => f.id === btn.dataset.family);
      if (fam) selectFamily(fam);
    });
  }

  const familyTotal = (f) => f.categories.reduce((s, c) => s + (counts[c] || 0), 0);

  async function selectFamily(fam, { silent = false } = {}) {
    for (const b of $('vm-families').querySelectorAll('[data-family]')) {
      b.setAttribute('aria-pressed', String(b.dataset.family === fam.id));
    }
    // Nova EXPLICA: el reposo como base y el gesto generado por código encima,
    // sincronizado con la locución. Al cargar la página (silent) no habla: los
    // navegadores exigen un gesto del usuario para poder reproducir audio.
    state.familia = fam;
    if (silent) {
      play(IDLE, false);
      callarVoz();
      if ($('vm-anim')) $('vm-anim').value = IDLE;
    } else {
      play(EXPLICANDO, false);
      if ($('vm-anim')) $('vm-anim').value = EXPLICANDO;
      hablar(fam.say);
    }

    $('vm-say').innerHTML = sanitizeSay(fam.say);
    $('vm-say').classList.remove('vm-fade');
    void $('vm-say').offsetWidth;
    $('vm-say').classList.add('vm-fade');

    $('vm-detail').classList.remove('hidden');
    $('vm-detail-emoji').textContent = fam.emoji;
    $('vm-detail-name').textContent = fam.label;
    const total = familyTotal(fam);
    $('vm-detail-count').textContent = total
      ? `${total} piezas en tienda · ${fam.categories.join(' · ')}`
      : fam.categories.join(' · ');
    $('vm-detail-tips').innerHTML = fam.tips
      .map((t) => `<li class="flex gap-2 text-[12px] text-[#4b3a42]"><span class="text-[#b60055] font-bold">•</span><span>${sanitizeSay(t)}</span></li>`)
      .join('');

    const grid = $('vm-products');
    grid.innerHTML = '<div class="col-span-3 text-center text-xs text-gray-400 py-3">Buscando piezas reales…</div>';
    const items = await productsOf(fam);
    state.productos = items;
    grid.innerHTML = items.length
      ? items.slice(0, 6).map((p) => `
        <a href="/detalle-de-producto?sku=${encodeURIComponent(p.sku)}" data-vm-sku="${esc(p.sku)}"
           class="rounded-xl overflow-hidden bg-[#f6f2f5] hover:ring-2 hover:ring-[#b60055] transition vm-fade">
          <div class="aspect-square bg-[#efe9ee]">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" class="w-full h-full object-cover" loading="lazy" onerror="this.style.display='none'"/>` : ''}</div>
          <div class="p-1.5">
            <div class="text-[10px] font-bold leading-tight line-clamp-2">${esc(p.name)}</div>
            <div class="text-[10px] text-[#b60055] font-extrabold">${fmtUSD(p.price)}</div>
          </div>
        </a>`).join('')
      : '<div class="col-span-3 text-center text-xs text-gray-400 py-3">Aún no hay piezas activas en esta familia.</div>';
  }

  /** Piezas reales de la familia: una consulta por categoría y se aúna sin repetir */
  async function productsOf(fam) {
    const lists = await Promise.all(fam.categories.map((c) =>
      api(`/products?category=${encodeURIComponent(c)}&limit=4`, { auth: false })
        .then((r) => r.items || [])
        .catch(() => []),
    ));
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const p of list) {
        if (seen.has(p.sku)) continue;
        seen.add(p.sku);
        out.push(p);
      }
    }
    return out;
  }

  /** Los textos de las fichas llevan <b> a propósito; el resto se escapa */
  function sanitizeSay(html) {
    return String(html).replace(/<(?!\/?b>)/g, '&lt;');
  }

  // ── UI ───────────────────────────────────────────────────────────────
  function wireUI() {
    // Cambiar de animación corta la locución: si no, Nova hablaría con el gesto
    // apagado y quedaría raro.
    $('vm-anim').addEventListener('change', () => {
      callarVoz();
      play(selectedAnim(), false);
    });

    $('vm-voice').addEventListener('click', alternarVoz);

    $('vm-replay').addEventListener('click', () => {
      if (!state.familia) return;
      play(EXPLICANDO, false);
      if ($('vm-anim')) $('vm-anim').value = EXPLICANDO;
      if (!hablar(state.familia.say)) {
        notaVoz('Este navegador no puede reproducir voz. El gesto sí funciona.');
      }
    });

    $('vm-qr').addEventListener('click', abrirQr);
    $('vm-qr-close').addEventListener('click', cerrarQr);
    $('vm-qr-modal').addEventListener('click', (e) => { if (e.target.id === 'vm-qr-modal') cerrarQr(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarQr(); });

    // Arranca girando suave para que se vea que es un modelo 3D real
    if (scene.controls) scene.controls.autoRotate = true;
    $('vm-rotate').addEventListener('click', () => {
      scene.autoRotate = !scene.autoRotate;
      if (scene.controls) scene.controls.autoRotate = scene.autoRotate;
      $('vm-rotate').setAttribute('aria-pressed', String(scene.autoRotate));
    });
    $('vm-reset').addEventListener('click', () => { if (scene.ready || scene.model) frameModel(); });

    $('vm-ask').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('vm-ask-input');
      const q = input.value.trim();
      if (!q) return;
      const box = $('vm-answer');
      box.classList.remove('hidden');
      box.innerHTML = aiTypingHtml();
      // Mientras piensa también explica, para que no se quede quieta.
      play(EXPLICANDO, false);
      input.value = '';
      try {
        const res = await aiChat({
          message: q,
          onDelta: (_t, acc) => { box.innerHTML = esc(acc); },
        });
        box.innerHTML = esc(res.reply || '(sin respuesta)')
          + `<div class="mt-2">${modelChipHtml(res)}</div>`
          + aiExtrasHtml(res);
        if (res.reply) hablar(res.reply); // Nova locuta su propia respuesta
      } catch (err) {
        box.innerHTML = `<span class="text-[#b60055]">No pude responder: ${esc(err.message || 'error')}</span>`;
        gestoExplicando(false);
      }
    });
  }

  // Arranque real: aquí ya está todo declarado (ver nota en "Arranque").
  init();
})();
