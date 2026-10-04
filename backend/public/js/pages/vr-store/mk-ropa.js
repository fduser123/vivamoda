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

  // Zonas ya recolocadas por mk-scenario (leer de S.ZONES)
  const zones = S.ZONES;

  const hangerMat = mat(0x2a2a30, { metalness: 0.7, roughness: 0.35 });

  function garmentMesh(prod) {
    const c = prod.c3d || 0xcccccc;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.30, 0.78, 10),
      mat(c, { roughness: 0.85, metalness: 0.02 }),
    );
    body.position.y = -0.42;
    body.castShadow = true;
    grp.add(body);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 18), mat(0x222227, { roughness: 0.6 }));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.05;
    grp.add(collar);
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), hangerMat);
    hook.position.y = 0.08;
    grp.add(hook);
    return grp;
  }

  function hangZone(zone, prods) {
    const zx = zone.pos.x, zz = zone.pos.z;
    const hex = parseInt(zone.color.replace('#', ''), 16);
    const railW = zone.railW || 4.4; // ancho adaptado al hueco libre real

    // riel superior con pies (apoyado en el piso del modelo, Y≈0.30)
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, railW, 8), hangerMat);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(zx, FY + 2.05, zz);
    g.add(rail);
    const footL = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.35, 8), hangerMat);
    footL.position.set(zx - railW / 2, FY + 0.87, zz); g.add(footL);
    const footR = footL.clone(); footR.position.x = zx + railW / 2; g.add(footR);

    // prendas colgadas (máx 4 por zona, redistribuidas al ancho del riel)
    const items = prods.slice(0, 4);
    const gap = items.length > 1 ? Math.min(1.1, (railW - 1.2) / (items.length - 1)) : 0;
    items.forEach((prod, i) => {
      const m = garmentMesh(prod);
      m.position.set(zx - gap * (items.length - 1) / 2 + i * gap, FY + 2.0, zz);
      m.userData.product = prod;
      m.userData.ringScale = 0.55;
      m.userData.sway = Math.random() * Math.PI * 2;
      S.addClickable(m);
      g.add(m);
      S.addAnimate((dt, t) => { m.rotation.z = Math.sin(t * 1.1 + m.userData.sway) * 0.02; });
    });

    // letrero flotante de la zona
    const sign = textSprite(zone.label.toUpperCase(), {
      bg: 'rgba(20,12,22,0.9)', border: 'rgba(228,0,108,0.85)',
      size: 40, scale: [2.6, 0.62, 1],
    });
    sign.position.set(zx, FY + 2.85, zz);
    g.add(sign);

    // anillo guía en el piso
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 2.05, 48),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(zx, FY + 0.02, zz + 1.2);
    ring.scale.setScalar(railW / 4.4); // el anillo también se adapta al hueco
    g.add(ring);
    S.addAnimate((dt, t) => { ring.material.opacity = 0.28 + 0.1 * Math.sin(t * 1.6 + zx); });

    // luz puntual de la zona
    const pl = new THREE.PointLight(hex, 0.5, 9, 2);
    pl.position.set(zx, FY + 2.7, zz);
    g.add(pl);
  }

  // ── Contenido por zona + podio ───────────────────────────
  // Se construyen cuando la navegación del interior está lista, para que
  // TODO quede en suelo libre real y con el ancho de riel que el hueco
  // disponible permita (adaptado a las dimensiones del modelo descargado).
  function buildPodium() {
    const star = S.bySku('VM-DAM-ATELIER');
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
    g.add(podium);
    const gown = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.25, 14), mat(star.c3d, { roughness: 0.75 }));
    gown.position.set(px, FY + 1.2, pz);
    gown.castShadow = true;
    gown.userData.product = star;
    gown.userData.ringScale = 1.2;
    S.addClickable(gown);
    g.add(gown);
    const glow = new THREE.PointLight(VM.primary, 1.0, 6, 2);
    glow.position.set(px, FY + 2.4, pz);
    g.add(glow);
  }

  function buildZoneContent() {
    zones.forEach((zone) => {
      hangZone(zone, S.CATALOG.filter((p) => p.zone === zone.id));
    });
    buildPodium();
  }

  if (S.mkNav && S.mkNav.ready) buildZoneContent();
  else window.addEventListener('mk:zones', () => buildZoneContent(), { once: true });

  // ── Bienvenida sobre la entrada ──────────────────────────
  const welcome = textSprite('VivaModa · Bienvenidos', {
    bg: 'rgba(23,15,28,0.92)', border: 'rgba(75,65,225,0.9)', size: 42, scale: [3.4, 0.72, 1],
  });
  welcome.position.set(36, FY + 2.6, MK.maxZ - 0.9); // dentro del local, sobre la entrada
  g.add(welcome);
});
