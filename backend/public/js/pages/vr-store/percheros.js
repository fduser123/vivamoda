/* ============================================================
   PERCHEROS (racks de ropa)
   Postes + barra + perchas. Expone S.rackPoints para que el
   módulo de ropa cuelgue las prendas en cada perchero.
   ============================================================ */
VRStore.part('percheros', function (S, g) {
  const { mat } = S;
  const rackPoints = {};

  function buildRail(x, z, railY, span, n) {
    const postMat = mat(0x4a3a4d, { metalness: 0.4, roughness: 0.5 });
    [-span / 2, span / 2].forEach((dx) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, railY, 12), postMat);
      p.position.set(x + dx, railY / 2, z);
      g.add(p);
    });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, span + 0.2, 12), mat(0x6b556f, { metalness: 0.55, roughness: 0.4 }));
    bar.rotation.z = Math.PI / 2;
    bar.position.set(x, railY, z);
    g.add(bar);
    // perchas (ganchos) colgando de la barra
    const hookMat = mat(0x999999, { metalness: 0.75, roughness: 0.3 });
    for (let i = 0; i < n; i++) {
      const hx = x + (i - (n - 1) / 2) * (span / n);
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), hookMat);
      hook.position.set(hx, railY - 0.17, z);
      g.add(hook);
    }
    return { x, z, railY, span, n };
  }

  rackPoints.damas = buildRail(0, -7.4, 2.32, 3.8, 3);
  rackPoints.caballeros = buildRail(-6.8, -7.4, 2.32, 3.8, 3);
  rackPoints.ninos = buildRail(6.8, -7.4, 1.85, 3.0, 3);
  S.rackPoints = rackPoints;
  // reutilizable por otras partes (galería de tipos de ropa)
  S.buildRail = buildRail;
});