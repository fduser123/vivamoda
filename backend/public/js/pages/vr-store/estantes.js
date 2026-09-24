/* ============================================================
   ESTANTES (estanterías murales)
   Paneles laterales + entrepaños. Expone S.shelfSpots para que
   el módulo de ropa coloque los doblados ordenados por color.
   ============================================================ */
VRStore.part('estantes', function (S, g) {
  const { mat } = S;
  const shelfSpots = [];

  function shelfUnit(opts) {
    const {
      x, z, rotY = 0, levels = 3, width = 1.5, depth = 0.5,
      baseY = 0.35, step = 0.75, tag = '',
    } = opts;
    const sideMat = mat(0x4a3a4d, { roughness: 0.7, metalness: 0.15 });
    const boardMat = mat(0x6b556f, { roughness: 0.65, metalness: 0.1 });
    const h = baseY + (levels - 1) * step + 0.1;

    const unit = new THREE.Group();
    unit.position.set(x, 0, z);
    unit.rotation.y = rotY;
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, depth), sideMat);
      side.position.set(sx * (width / 2 - 0.04), h / 2, 0);
      unit.add(side);
    }
    for (let i = 0; i < levels; i++) {
      const y = baseY + i * step;
      const board = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, depth), boardMat);
      board.position.y = y;
      board.receiveShadow = true;
      unit.add(board);
      shelfSpots.push({ x, y: y + 0.06, z, rotY, width, depth, tag, topY: h });
    }
    g.add(unit);
  }

  // estantes de pared trasera (entre zonas) — ropa doblada
  shelfUnit({ x: -3.4, z: -9.55, levels: 3, width: 1.5, tag: 'doblados-damas' });
  shelfUnit({ x: 3.4, z: -9.55, levels: 3, width: 1.5, tag: 'doblados-caballeros' });
  // estantes laterales (Novedades / Ofertas) — accesorios
  shelfUnit({ x: -11.55, z: -3.2, rotY: Math.PI / 2, levels: 2, width: 1.6, tag: 'accesorios-izq' });
  shelfUnit({ x: 11.55, z: -3.2, rotY: -Math.PI / 2, levels: 2, width: 1.6, tag: 'accesorios-der' });
  // estante bajo de Niños
  shelfUnit({ x: 9.6, z: -9.4, levels: 2, width: 1.2, step: 0.65, baseY: 0.3, tag: 'kids' });

  S.shelfSpots = shelfSpots;
});