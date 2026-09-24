/* ============================================================
   ESPEJOS
   Paneles tipo espejo (reflejo simulado con textura), marco y
   tira led. Expone S.addMirror para reutilizarlo (probadores).
   ============================================================ */
VRStore.part('espejos', function (S, g) {
  const { mat } = S;

  function mirrorTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#3d3a45');
    grd.addColorStop(0.25, '#17151c');
    grd.addColorStop(0.5, '#4a4654');
    grd.addColorStop(0.75, '#141219');
    grd.addColorStop(1, '#332f3b');
    x.fillStyle = grd; x.fillRect(0, 0, 256, 512);
    // destellos verticales (simulan el reflejo de la tienda)
    x.fillStyle = 'rgba(255,255,255,0.12)';
    x.fillRect(70, 40, 14, 430);
    x.fillRect(170, 80, 8, 380);
    x.fillStyle = 'rgba(255,255,255,0.05)';
    x.fillRect(40, 150, 4, 300);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function addMirror(x, z, opts = {}) {
    const { w = 1.0, h = 2.6, rotY = 0, frame = 0xd4af37 } = opts;
    const grp = new THREE.Group();
    const mirrorMat = new THREE.MeshStandardMaterial({
      map: mirrorTexture(), metalness: 0.9, roughness: 0.08,
      emissive: 0x1a1a24, emissiveIntensity: 0.25,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mirrorMat);
    panel.position.set(0, h / 2, 0);
    grp.add(panel);
    // marco
    const frameMat = mat(frame, { metalness: 0.6, roughness: 0.35 });
    const fr = (fw, fh, fy, fx = 0) => {
      const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.06), frameMat);
      f.position.set(fx, fy, 0);
      grp.add(f);
    };
    fr(w + 0.14, 0.08, h + 0.05);
    fr(w + 0.14, 0.08, -0.03);
    fr(0.08, h + 0.14, h / 2, -(w / 2 + 0.07));
    fr(0.08, h + 0.14, h / 2, w / 2 + 0.07);
    // tira led superior
    const led = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xfff2d9, emissiveIntensity: 1.1 }));
    led.position.set(0, h + 0.12, 0);
    grp.add(led);
    grp.position.set(x, 0, z);
    grp.rotation.y = rotY;
    g.add(grp);
    return grp;
  }

  // espejos de sección
  addMirror(-6.8, -9.55, { w: 1.0, h: 2.5 }); // Caballeros
  addMirror(6.8, -9.55, { w: 0.85, h: 2.0 }); // Niños
  addMirror(-11.6, -5.6, { w: 0.9, h: 2.2, rotY: Math.PI / 2, frame: 0xe4006c }); // Novedades (pared izquierda)

  S.addMirror = addMirror;
});