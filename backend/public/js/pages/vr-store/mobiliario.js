/* ============================================================
   MOBILIARIO
   Mesas de exhibición, maniquíes, mostrador de caja,
   probadores, banco y plantas. Expone S.tableSpots.
   ============================================================ */
VRStore.part('mobiliario', function (S, g) {
  const { mat, textSprite } = S;
  const tableSpots = [];

  // ── Mesas de exhibición ──────────────────────────────────
  function table(x, z) {
    const grp = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.07, 1.05), mat(0xf6f2f5, { roughness: 0.7 }));
    top.position.y = 0.78; top.receiveShadow = true;
    grp.add(top);
    for (const [dx, dz] of [[-0.9, -0.42], [0.9, -0.42], [-0.9, 0.42], [0.9, 0.42]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.76, 0.09), mat(0x4a3a4d, { metalness: 0.4 }));
      leg.position.set(dx, 0.38, dz);
      grp.add(leg);
    }
    grp.position.set(x, 0, z);
    g.add(grp);
    tableSpots.push({ x, z });
  }
  table(-10.8, 0.6); // Novedades
  table(10.8, 0.6); // Ofertas
  S.tableSpots = tableSpots;

  // ── Maniquí ──────────────────────────────────────────────
  function mannequin(x, z, outfitColor, opts = {}) {
    const grp = new THREE.Group();
    const bodyMat = mat(0xf3ede9, { roughness: 0.55, metalness: 0.05 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.1, 20), mat(0x2a2030, { metalness: 0.5 }));
    base.position.y = 0.05;
    grp.add(base);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.75, 12), bodyMat);
    legs.position.y = 0.5;
    grp.add(legs);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.95, 16), bodyMat);
    torso.position.y = 1.32;
    grp.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), bodyMat);
    head.position.y = 1.95;
    grp.add(head);
    // atuendo de color
    const outfit = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 0.62, 16), mat(outfitColor, { roughness: 0.7, emissive: outfitColor, emissiveIntensity: 0.1 }));
    outfit.position.y = 1.28;
    grp.add(outfit);
    if (!opts.noHat) {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.22, 12), mat(outfitColor));
      hat.position.y = 2.18;
      grp.add(hat);
    }
    grp.position.set(x, 0, z);
    if (opts.rotY) grp.rotation.y = opts.rotY;
    g.add(grp);
  }
  mannequin(-2.4, -5.2, 0x2447c9, { rotY: Math.PI / 3 }); // Caballeros (índigo)
  mannequin(2.4, -5.2, 0xe4006c, { rotY: -Math.PI / 3 }); // Damas (magenta)
  mannequin(-4.8, 6.4, 0xf0a832, { rotY: Math.PI / 4 }); // Entrada
  mannequin(4.8, 6.4, 0x4b41e1, { rotY: -Math.PI / 4 }); // Entrada

  // ── Mostrador de caja ────────────────────────────────────
  (function cashier() {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 1.0), mat(0x2a2030, { roughness: 0.5, metalness: 0.3 }));
    body.position.y = 0.5;
    grp.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.1), mat(0xf6f2f5, { roughness: 0.4 }));
    top.position.y = 1.04;
    grp.add(top);
    // registradora con pantalla
    const reg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.4), mat(0x1c1b1d, { roughness: 0.3, metalness: 0.4 }));
    reg.position.set(0.6, 1.17, 0.15);
    grp.add(reg);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.03), new THREE.MeshStandardMaterial({ color: 0x0e2a4a, emissive: 0x2f6bff, emissiveIntensity: 0.8 }));
    screen.position.set(0.6, 1.36, 0.32);
    grp.add(screen);
    // letrero
    const sign = textSprite('CAJA', { scale: [1.4, 0.42, 1], size: 64, bg: 'rgba(228,0,108,0.95)', border: 'rgba(255,255,255,0.4)', fg: '#ffffff' });
    sign.position.set(0, 2.1, 0.9);
    grp.add(sign);
    grp.position.set(10.2, 0, 3.4);
    grp.rotation.y = Math.PI; // de cara al pasillo
    g.add(grp);
  })();

  // ── Probadores ───────────────────────────────────────────
  function fittingRoom(x, z, sideDir) {
    const grp = new THREE.Group();
    const wallMat = mat(0x332436, { roughness: 0.8, side: THREE.DoubleSide });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.6), wallMat);
    back.position.set(0, 1.3, -0.7);
    grp.add(back);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.6), wallMat);
    side.position.set(0.85 * sideDir, 1.3, 0);
    side.rotation.y = Math.PI / 2;
    grp.add(side);
    // cortina
    const curtainMat = new THREE.MeshStandardMaterial({ color: 0xe4006c, roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.1), curtainMat);
    curtain.position.set(0.05, 1.1, -0.6);
    grp.add(curtain);
    // riel
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.55, 8), mat(0x999999, { metalness: 0.7 }));
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 2.25, -0.62);
    grp.add(rod);
    grp.position.set(x, 0, z);
    g.add(grp);
    // espejo interior (reutiliza el módulo de espejos)
    if (S.addMirror) S.addMirror(x, z - 0.66, { w: 0.5, h: 1.4, frame: 0xe4006c });
  }
  fittingRoom(-10.6, -8.6, -1);
  fittingRoom(10.6, -8.6, 1);
  const roomsSign = textSprite('PROBADORES', { scale: [3.0, 0.8, 1], size: 46, bg: 'rgba(20,11,22,0.92)', border: '#e4006c', fg: '#ffffff' });
  roomsSign.position.set(0, 4.7, -7.2);
  g.add(roomsSign);

  // ── Banco ────────────────────────────────────────────────
  (function bench() {
    const grp = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.09, 0.5), mat(0x6b556f, { roughness: 0.7 }));
    seat.position.y = 0.46;
    grp.add(seat);
    for (const dx of [-0.72, 0.72]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.44, 0.42), mat(0x2a2030));
      leg.position.set(dx, 0.22, 0);
      grp.add(leg);
    }
    grp.position.set(-9.6, 0, 4.4);
    grp.rotation.y = 0.2;
    g.add(grp);
  })();

  // ── Plantas ──────────────────────────────────────────────
  function plant(x, z) {
    const grp = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.4, 14), mat(0xb60055, { roughness: 0.5 }));
    pot.position.y = 0.2;
    grp.add(pot);
    const greens = [0x2e7d4f, 0x3fa06b, 0x245c3d];
    for (let i = 0; i < 5; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16 + Math.random() * 0.1, 12, 10), mat(greens[i % 3], { roughness: 0.8 }));
      const a = (i / 5) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 0.18, 0.55 + Math.random() * 0.15, Math.sin(a) * 0.18);
      grp.add(leaf);
    }
    grp.position.set(x, 0, z);
    g.add(grp);
  }
  plant(-8.8, 7.9);
  plant(8.8, 7.9);
});