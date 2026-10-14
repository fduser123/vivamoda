/* ============================================================
   PRENDAS INTERACTIVAS SOBRE EL ESCENARIO MK IT
   ------------------------------------------------------------
   Reemplaza a las partes "constructivas" (estructura/percheros/
   estantes/mobiliario) cuando el escenario es el interior MK IT.
   Three.js aporta SOLO lo interactivo:
   - 17 SKUs reales como prendas 3D colgadas en 5 zonas
   - Podio del producto estrella + letreros flotantes
   - Todo clicable (userData.product) para la tarjeta de producto
   Geometría (S.MK): interior X ∈ [25.3, 48.5], Z ∈ [-12.4, 0.9],
   piso del modelo a Y≈0.30, techo ≈3.8.
   ============================================================ */
VRStore.part('mk-ropa', function (S, g) {
  const { VM, mat, textSprite } = S;
  const MK = S.MK || { cx: 36.9, cz: -5.7, minZ: -12.4, maxZ: 0.9, floorY: 0.30 };
  const FY = MK.floorY ?? 0.30; // piso del interior

  // Rieles ya recolocados por mk-scenario al suelo libre (leer de S.ZONES).
  // Son cinco huecos genéricos: la sección activa decide qué cuelga en ellos.
  const zones = S.ZONES;

  const hangerMat = mat(0x2a2a30, { metalness: 0.7, roughness: 0.35 });

  // ── Vitrina reconstruible ────────────────────────────────
  // TODO lo que se vuelve a montar (rieles, prendas, podio y vitrina interna)
  // vive en este grupo: al cambiar de sección o al buscar se vacía y se vuelve
  // a colgar la ropa de la nueva sección. El letrero de bienvenida queda fuera.
  const racks = new THREE.Group();
  g.add(racks);
  let vitrinaLista = false;   // ya se montó una vez (el interior está medido)

  // ── Modelos 3D reales (Blender) ─────────────────────────────────
  // Los .glb los genera `npm run models:3d` (tools/modelos3d) a partir del
  // catálogo de la base: una forma paramétrica por categoría con el color y
  // las medidas de cada producto. La escena NO espera a que lleguen: se cuelga
  // la forma procedural de siempre y, cuando el archivo está listo, se
  // sustituye dentro del mismo grupo (el clic y el producto no cambian).
  const RUTA_MODELOS = '/models/generated/';
  const cargadorGLB = new THREE.GLTFLoader();
  const plantillas = new Map();     // sku → { molde, alto }
  const enVuelo = new Map();        // sku → promesa en curso
  const TAM_MIN = 0.34;             // un anillo de 4 cm también tiene que verse
  const TAM_CAP = 1.0;              // nada más ancho que el hueco del riel
  const TAM_MAX = 1.15;
  const TOPE_GANCHO = -0.05;        // bajo el gancho del riel
  let colgadas = 0;   // prendas montadas en la tanda actual

  function cargarModelo(prod) {
    const sku = prod && prod.sku;
    if (!sku) return Promise.resolve(null);
    if (plantillas.has(sku)) return Promise.resolve(plantillas.get(sku));
    if (enVuelo.has(sku)) return enVuelo.get(sku);
    const promesa = new Promise((resolve) => {
      cargadorGLB.load(RUTA_MODELOS + encodeURIComponent(sku) + '.glb', (gltf) => {
        const raiz = gltf.scene;
        const caja = new THREE.Box3().setFromObject(raiz);
        const alto = Math.max(0.002, caja.max.y - caja.min.y);
        const ancho = Math.max(0.002, caja.max.x - caja.min.x);
        const fondo = Math.max(0.002, caja.max.z - caja.min.z);
        // Se escala por la dimensión MAYOR (no por la altura): un reloj de 6 cm
        // de alto y 37 cm tumbado se agrandaba 5,6× y quedaba de 2 m de ancho.
        // El tope de 1 m es el hueco del riel; el suelo de 34 cm, la visibilidad.
        const mayor = Math.max(alto, ancho, fondo);
        const objetivo = Math.min(TAM_MAX, Math.max(TAM_MIN, Math.min(mayor, TAM_CAP)));
        const k = Math.min(objetivo / mayor, 6);   // sin convertir el anillo en una rueda
        raiz.scale.setScalar(k);
        raiz.position.set(
          -((caja.min.x + caja.max.x) / 2) * k,
          -caja.min.y * k,
          -((caja.min.z + caja.max.z) / 2) * k,
        );
        raiz.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
        });
        const molde = new THREE.Group();
        molde.add(raiz);
        const dato = { molde, alto: alto * k, mayor: mayor * k };
        plantillas.set(sku, dato);
        resolve(dato);
      }, undefined, () => resolve(null));   // sin archivo: queda la forma procedural
    });
    enVuelo.set(sku, promesa);
    return promesa;
  }

  /**
   * Sitúa el modelo dentro de su grupo de venta.
   *   modo 'colgado' → pende del gancho del riel
   *   modo 'de-pie'  → apoyado en una balda o podio (base en y = 0)
   * `limites` (opcional: { alto, mayor }) recorta el modelo para que quepa en su
   * balda: ni más alto que la fila ni más largo que la columna.
   */
  function ponerModelo(destino, prod, modo = 'colgado', limites = null) {
    return cargarModelo(prod).then((dato) => {
      // El modelo puede llegar DESPUÉS de un cambio de sección: en ese caso se
      // añade a un grupo ya retirado de la escena (inofensivo) y no se cuenta.
      if (dato && !destino.userData.modelo) {
        destino.userData.modelo = true;
        if (destino.userData.placeholder) destino.remove(destino.userData.placeholder);
        const clon = dato.molde.clone(true);   // comparte geometría y materiales
        if (limites) {
          // Los cinturones, por ejemplo, miden 1 m de largo: sin este recorte se
          // salían por los lados de su balda y pisaban la columna vecina.
          const k2 = Math.min(1,
            limites.alto ? limites.alto / dato.alto : 1,
            limites.mayor ? limites.mayor / dato.mayor : 1);
          if (k2 < 1) clon.scale.multiplyScalar(k2);
        }
        if (modo === 'colgado') {
          clon.rotation.y = (Math.random() - 0.5) * 0.6;   // colgadas algo torcidas
          clon.position.y = TOPE_GANCHO - dato.alto;
        }
        destino.add(clon);
      }
      // El resumen de la tanda lo imprime `montarVitrina`; aquí no se registra
      // nada porque los modelos llegan de uno en uno y ensuciaría la consola.
      return dato;
    });
  }

  function garmentMesh(prod) {
    const c = prod.c3d || 0xcccccc;
    const grp = new THREE.Group();
    // Forma provisional (la que se ve mientras carga el .glb)
    const forma = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.30, 0.78, 10),
      mat(c, { roughness: 0.85, metalness: 0.02 }),
    );
    body.position.y = -0.42;
    body.castShadow = true;
    forma.add(body);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 18), mat(0x222227, { roughness: 0.6 }));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.05;
    forma.add(collar);
    grp.add(forma);
    grp.userData.placeholder = forma;
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), hangerMat);
    hook.position.y = 0.08;
    grp.add(hook);
    return grp;
  }

  function hangZone(zone, prods) {
    if (!prods.length) return;   // riel sin prendas (p. ej. búsqueda sin resultados)
    const zx = zone.pos.x, zz = zone.pos.z;
    // Los rieles no tienen cartel propio: el color de referencia es el de la
    // sección activa (anillos y luces), que cambia con ella.
    const hex = (S.tema && S.tema.acento) || 0xe4006c;
    const railW = zone.railW || 4.4; // ancho adaptado al hueco libre real

    // riel superior con pies (apoyado en el piso del modelo, Y≈0.30)
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, railW, 8), hangerMat);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(zx, FY + 2.05, zz);
    racks.add(rail);
    const footL = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.35, 8), hangerMat);
    footL.position.set(zx - railW / 2, FY + 0.87, zz); racks.add(footL);
    const footR = footL.clone(); footR.position.x = zx + railW / 2; racks.add(footR);

    // prendas colgadas (hasta 5 cuando el hueco del riel lo permite)
    const items = prods.slice(0, railW >= 4.2 ? 5 : 4);
    const gap = items.length > 1 ? Math.min(1.1, (railW - 1.2) / (items.length - 1)) : 0;
    items.forEach((prod, i) => {
      const m = garmentMesh(prod);
      m.position.set(zx - gap * (items.length - 1) / 2 + i * gap, FY + 2.0, zz);
      m.userData.product = prod;
      m.userData.ringScale = 0.55;
      m.userData.sway = Math.random() * Math.PI * 2;
      m.userData.vitrina = true;   // la retira `rebuildRopa` al cambiar de sección
      S.addClickable(m);
      racks.add(m);
      S.addAnimate((dt, t) => { m.rotation.z = Math.sin(t * 1.1 + m.userData.sway) * 0.02; });
      colgadas++;
      ponerModelo(m, prod);   // cuando llegue el .glb, sustituye la forma provisional
    });

    // (Los carteles por sección se retiraron: ahora la tienda muestra una sola
    //  sección cada vez y su color ya lo llevan anillos, luces y paredes.)

    // anillo guía en el piso
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 2.05, 48),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(zx, FY + 0.02, zz + 1.2);
    ring.scale.setScalar(railW / 4.4); // el anillo también se adapta al hueco
    racks.add(ring);
    S.addAnimate((dt, t) => { ring.material.opacity = 0.22 + 0.08 * Math.sin(t * 1.6 + zx); });

    // Nota: sin foco puntual propio. El riel se ve con las luces de zona del
    // núcleo (tenues y del color de la sección), que es lo que mantiene el
    // interior oscuro en vez de lavado.
  }

  // ── Contenido por zona + podio ───────────────────────────
  // Se construyen cuando la navegación del interior está lista, para que
  // TODO quede en suelo libre real y con el ancho de riel que el hueco
  // disponible permita (adaptado a las dimensiones del modelo descargado).
  function buildPodium(lista) {
    // El podio muestra la prenda estrella DE LA SECCIÓN activa: la primera de
    // la vitrina ya viene ordenada con los colores de la sección delante.
    const star = (lista && lista[0]) || null;
    if (!star) return;
    let px = MK.cx, pz = MK.cz + 2;
    if (S.mkNav && S.mkNav.ready && S.mkNav.freeSpots) {
      const spot = S.mkNav.freeSpots(px, pz, 1.15)[0];
      if (spot) { px = spot.x; pz = spot.z; }
    }
    const podium = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.9, 0.55, 32),
      mat(VM.primaryDeep, { roughness: 0.4, metalness: 0.2 }),
    );
    podium.position.set(px, FY + 0.28, pz);
    podium.castShadow = true;
    racks.add(podium);
    // Vitrina del producto estrella: la forma provisional es el cono de
    // siempre y el modelo real se pone de pie encima del podio.
    const vitrina = new THREE.Group();
    vitrina.position.set(px, FY + 0.55, pz);
    vitrina.userData.product = star;
    vitrina.userData.ringScale = 1.2;
    const provisional = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.25, 14), mat(star.c3d, { roughness: 0.75 }));
    provisional.position.y = 0.62;
    provisional.castShadow = true;
    vitrina.add(provisional);
    vitrina.userData.placeholder = provisional;
    vitrina.userData.vitrina = true;
    S.addClickable(vitrina);
    racks.add(vitrina);
    colgadas++;
    podioPos = { x: px, z: pz };
    ponerModelo(vitrina, star, 'de-pie');
    const glow = new THREE.PointLight((S.tema && S.tema.acento) || VM.primary, 0.7, 5, 2);
    glow.position.set(px, FY + 2.4, pz);
    racks.add(glow);
  }

  // ── Vitrina del catálogo interno (almacén/POS) ──────────
  // Los productos que NO están en la vitrina pública (`visibility='ops'` y los
  // desactivados) no caben en los 5 rieles, pero tampoco se quedan sin ver:
  // tienen su propia estantería de 5 columnas por 4 filas, montada en el primer
  // hueco que no pise mobiliario, rieles ni podio.
  // 4 filas × 5 columnas = 20 huecos; el paso y la altura de fila dejan respirar
  // el letrero bajo el techo interior (3,8 m de la escena).
  const VIT_FILAS = 4, VIT_COLS = 5, VIT_PASO = 0.80, VIT_ALTO_FILA = 0.76;
  const VIT_ALTO_MAX = 0.70, VIT_ANCHO_MAX = 0.66;   // hueco real de cada balda
  let podioPos = null;

  function buildVitrinaInterna() {
    // Solo los productos de almacén/POS de la SECCIÓN activa (y que pasen el
    // buscador): la vitrina interna tampoco puede dar acceso a otra categoría.
    const prods = (S.vitrinaInterna ? S.vitrinaInterna() : (S.CATALOG_INTERNO || []))
      .slice(0, VIT_FILAS * VIT_COLS);
    if (!prods.length) return;
    const ancho = VIT_COLS * VIT_PASO + 0.5;
    const semi = ancho / 2;

    // Lo que no puede pisar: rieles de zona y podio (la altura de cada fila
    // ya queda por debajo del techo interior).
    const ocupados = zones
      .filter((z) => z.id !== 'interno' && z.railW)
      .map((z) => ({
        x1: z.pos.x - z.railW / 2 - 0.5, x2: z.pos.x + z.railW / 2 + 0.5,
        z1: z.pos.z - 1.1, z2: z.pos.z + 1.1,
      }));
    if (podioPos) ocupados.push({ x1: podioPos.x - 1.5, x2: podioPos.x + 1.5, z1: podioPos.z - 1.5, z2: podioPos.z + 1.5 });

    function cabe(px, pz, yaw) {
      const ux = Math.cos(yaw), uz = -Math.sin(yaw);   // eje de ancho del mueble
      for (let k = -1; k <= 1.001; k += 0.25) {
        if (S.mkNav && S.mkNav.ready && S.mkNav.hits(px + ux * semi * k, pz + uz * semi * k, 0.35)) return false;
      }
      const bb = { x1: px - semi - 0.2, x2: px + semi + 0.2, z1: pz - 0.85, z2: pz + 0.85 };
      return !ocupados.some((o) => bb.x1 < o.x2 && bb.x2 > o.x1 && bb.z1 < o.z2 && bb.z2 > o.z1);
    }

    // El mueble mira hacia dentro desde el muro del que está más cerca: en la
    // nave rectangular siempre queda ortogonal (nada en diagonal bloqueando el
    // pasillo) y de frente al visitante.
    function yawHaciaDentro(x, z) {
      const d = { minZ: z - MK.minZ, maxZ: MK.maxZ - z, minX: x - MK.minX, maxX: MK.maxX - x };
      const menor = Math.min(d.minZ, d.maxZ, d.minX, d.maxX);
      if (menor === d.minZ) return 0;             // pegado al fondo → frente +Z
      if (menor === d.maxZ) return Math.PI;       // pegado a la entrada → frente -Z
      if (menor === d.minX) return Math.PI / 2;   // pegado a la izquierda → frente +X
      return -Math.PI / 2;                        // pegado a la derecha → frente -X
    }

    let base = null;
    const cands = (S.mkNav && S.mkNav.ready)
      ? S.mkNav.freeSpots(MK.cx, MK.cz, 0.55)
      : [{ x: MK.cx, z: MK.cx }];
    // huecos pegados a los muros primero (dejan libre el centro de la tienda) y
    // sin invadir la franja de la entrada.
    const orden = cands
      .filter((c) => c.z < MK.maxZ - 1.6)
      .sort((a, b) => (cercaDeMuro(a) - cercaDeMuro(b)) || (a.d - b.d));
    function cercaDeMuro(c) {
      return Math.min(c.z - MK.minZ, MK.maxZ - c.z, c.x - MK.minX, MK.maxX - c.x);
    }
    for (const c of orden.slice(0, 160)) {
      const yaw = yawHaciaDentro(c.x, c.z);
      if (cabe(c.x, c.z, yaw)) { base = { x: c.x, z: c.z, yaw }; break; }
    }
    if (!base) {   // sin hueco libre: mejor no dejar un mueble atravesado
      console.warn('[TiendaVR] vitrina interna: no hay hueco libre para el mueble');
      return;
    }

    const mueble = new THREE.Group();
    mueble.position.set(base.x, FY, base.z);
    mueble.rotation.y = base.yaw;
    racks.add(mueble);

    const techoBalda = 0.2 + VIT_ALTO_FILA * (VIT_FILAS - 1);   // balda más alta
    const altoPanel = techoBalda + 0.3;
    const madera = mat(0x2b2333, { roughness: 0.55, metalness: 0.15 });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(ancho, altoPanel, 0.08), madera);
    panel.position.set(0, 0.05 + altoPanel / 2, -0.16);
    panel.castShadow = true; panel.receiveShadow = true;
    mueble.add(panel);
    const zocalo = new THREE.Mesh(new THREE.BoxGeometry(ancho, 0.2, 0.62), madera);
    zocalo.position.set(0, 0.1, 0.05);
    zocalo.castShadow = true; zocalo.receiveShadow = true;
    mueble.add(zocalo);
    for (const sx of [-1, 1]) {
      const lado = new THREE.Mesh(new THREE.BoxGeometry(0.08, altoPanel, 0.5), madera);
      lado.position.set(sx * (ancho / 2 - 0.04), 0.05 + altoPanel / 2, 0.03);
      lado.castShadow = true;
      mueble.add(lado);
    }

    const baldaMat = mat(0x3a2e42, { roughness: 0.5, metalness: 0.25 });
    const inicioX = -((VIT_COLS - 1) * VIT_PASO) / 2;
    for (let fila = 0; fila < VIT_FILAS; fila++) {
      const y = 0.2 + VIT_ALTO_FILA * fila;
      const balda = new THREE.Mesh(new THREE.BoxGeometry(ancho - 0.12, 0.05, 0.44), baldaMat);
      balda.position.set(0, y, 0.05);
      balda.castShadow = true; balda.receiveShadow = true;
      mueble.add(balda);
      for (let col = 0; col < VIT_COLS; col++) {
        const prod = prods[fila * VIT_COLS + col];
        if (!prod) continue;
        const sitio = new THREE.Group();
        sitio.position.set(inicioX + col * VIT_PASO, y + 0.03, 0.06);
        sitio.rotation.y = Math.PI;              // de cara al pasillo
        sitio.userData.product = prod;
        sitio.userData.ringScale = 0.5;
        sitio.userData.vitrina = true;
        S.addClickable(sitio);
        mueble.add(sitio);
        colgadas++;
        // La fila de arriba se recorta más: si no, las prendas altas tapan el letrero.
        const alto = fila === VIT_FILAS - 1 ? 0.45 : VIT_ALTO_MAX;
        ponerModelo(sitio, prod, 'de-pie', { alto, mayor: VIT_ANCHO_MAX });
      }
    }

    const cartel = textSprite('CATÁLOGO INTERNO', {
      bg: 'rgba(20,12,22,0.92)', border: 'rgba(108,92,231,0.9)', size: 36,
      scale: [2.3, 0.55, 1], lines: ['CATÁLOGO INTERNO', 'Almacén · POS'],
    });
    cartel.position.set(0, 0.05 + altoPanel + 0.24, 0.0);
    mueble.add(cartel);
    const foco = new THREE.PointLight(0x6c5ce7, 0.45, 7, 2);
    foco.position.set(0, 0.05 + altoPanel + 0.1, 1.1);
    mueble.add(foco);

    // La zona 'interno' del núcleo apunta a donde ha cabido el mueble, para
    // que el chip y la cámara del recorrido lleven aquí.
    const zona = S.ZONES.find((z) => z.id === 'interno');
    if (zona) {
      zona.pos = { x: base.x, z: base.z };
      zona.view = {
        p: [base.x + Math.sin(base.yaw) * 3.6, 2.3, base.z + Math.cos(base.yaw) * 3.6],
        t: [base.x, 1.6, base.z],
      };
      const iz = S.ZONES.indexOf(zona);
      if (S.zoneLights && S.zoneLights[iz]) S.zoneLights[iz].position.set(base.x, FY + 2.8, base.z);
    }
    console.log(`[TiendaVR] vitrina interna: ${Math.min(prods.length, VIT_FILAS * VIT_COLS)} productos en (${base.x.toFixed(1)}, ${base.z.toFixed(1)})`);
  }

  // ── Montaje de la vitrina (sección activa + buscador) ────
  // Los cinco rieles se reparten las prendas de la sección activa en el orden
  // que devuelve el núcleo (primero los colores de la sección). Al cambiar de
  // sección o buscar, `S.rebuildRopa` vacía `racks` y vuelve a montarlo todo.
  function montarVitrina() {
    // fuera lo anterior (prendas, anillos, podio y vitrina interna)
    S.clearClickables((o) => o.userData && o.userData.vitrina);
    for (let i = racks.children.length - 1; i >= 0; i--) racks.remove(racks.children[i]);
    colgadas = 0; podioPos = null;

    const lista = S.vitrinaActual ? S.vitrinaActual() : S.CATALOG.slice();
    const rieles = zones.filter((z) => z.id !== 'interno');
    const porRiel = Math.max(1, Math.ceil(lista.length / (rieles.length || 1)));
    rieles.forEach((z, i) => hangZone(z, lista.slice(i * porRiel, (i + 1) * porRiel)));
    buildPodium(lista);
    buildVitrinaInterna();
    firmaVitrina = firmaDeVitrina();
    console.info(`[TiendaVR] vitrina sección ${S.seccion}: ${colgadas} prendas de ${lista.length} en ${rieles.length} rieles`);
  }

  // Firma de lo que hay colgado (sección + SKUs): evita volver a montar la
  // misma vitrina dos veces seguidas (el arranque y un cambio de sección al
  // mismo SKU la pedirían repetida) pero sí reacciona a cualquier cambio real.
  function firmaDeVitrina() {
    const lista = S.vitrinaActual ? S.vitrinaActual() : [];
    return S.seccion + '#' + lista.map((p) => p.sku).join('|');
  }
  let firmaVitrina = '';

  // Vuelve a montar la vitrina (cambio de sección o búsqueda). Si el interior
  // todavía se está midiendo, se ignora: el montaje inicial ya usará la
  // sección y la búsqueda vigentes en ese momento.
  S.rebuildRopa = function (forzar) {
    if (!vitrinaLista) return;
    if (!forzar && firmaDeVitrina() === firmaVitrina) return;
    montarVitrina();
  };

  // La ropa se cuelga cuando el interior está medido Y el catálogo en vivo
  // está listo (o falló): así los rieles muestran prendas reales con stock.
  const zonasListas = new Promise((res) => {
    if (S.mkNav && S.mkNav.ready) res();
    else window.addEventListener('mk:zones', res, { once: true });
  });
  Promise.all([zonasListas, S.catalogReady || Promise.resolve(), S.catalogInternoReady || Promise.resolve()])
    .then(() => { montarVitrina(); vitrinaLista = true; });

  // ── Bienvenida sobre la entrada ──────────────────────────
  const welcome = textSprite('VivaModa · Bienvenidos', {
    bg: 'rgba(23,15,28,0.92)', border: 'rgba(75,65,225,0.9)', size: 42, scale: [3.4, 0.72, 1],
  });
  welcome.position.set(36, FY + 2.6, MK.maxZ - 0.9); // dentro del local, sobre la entrada
  g.add(welcome);
});
