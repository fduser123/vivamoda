/* ============================================================
   ESTRUCTURA DE LA TIENDA
   Piso, alfombras, pasillo, paredes, zócalos, tiras neón,
   marco de techo, lámparas colgantes y portal de entrada.
   ============================================================ */
VRStore.part('estructura', function (S, g) {
  const { scene, VM, mat, textSprite, roundRect } = S;

  // ── Piso ─────────────────────────────────────────────────
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(28, 22), mat(VM.floor, { roughness: 0.92, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // ── Alfombra central con monograma ───────────────────────
  (function rug() {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#fdf8fb'; x.beginPath(); x.arc(256, 256, 246, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(182,0,85,0.25)'; x.lineWidth = 6; x.beginPath(); x.arc(256, 256, 230, 0, Math.PI * 2); x.stroke();
    x.fillStyle = '#e4006c'; x.font = '800 150px "Plus Jakarta Sans", Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('V', 256, 244);
    x.fillStyle = 'rgba(28,27,29,0.75)'; x.font = '700 46px "Plus Jakarta Sans", Arial';
    x.fillText('VivaModa', 256, 356);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const m = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9 }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.02, 0);
    g.add(m);
  })();

  // ── Pasillo central hacia la entrada ─────────────────────
  (function runner() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const x = c.getContext('2d');
    x.fillStyle = '#e8dbe3'; x.fillRect(0, 0, 128, 512);
    x.fillStyle = 'rgba(182,0,85,0.16)';
    for (let i = 0; i < 8; i++) x.fillRect(0, i * 64 + 18, 128, 26);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 8.8), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.95 }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.015, 5.2);
    g.add(m);
  })();

  // ── Felpudo de bienvenida ────────────────────────────────
  (function welcomeMat() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 180;
    const x = c.getContext('2d');
    roundRect(x, 4, 4, 504, 172, 36);
    x.fillStyle = '#b60055'; x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 6; roundRect(x, 10, 10, 492, 160, 30); x.stroke();
    x.fillStyle = '#fff'; x.font = '800 62px "Plus Jakarta Sans", Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('BIENVENIDOS', 256, 92);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0.03, 9.4);
    g.add(m);
  })();

  // ── Paredes ──────────────────────────────────────────────
  const wallMat = mat(VM.wall, { roughness: 0.95 });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(28, 6.6), wallMat);
  backWall.position.set(0, 3.3, -10.2); backWall.receiveShadow = true;
  g.add(backWall);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(22, 6.6), wallMat);
    w.position.set(12.4 * sx, 3.3, 0); w.rotation.y = (Math.PI / 2) * sx; w.receiveShadow = true;
    g.add(w);
  }

  // ── Zócalos ──────────────────────────────────────────────
  const baseMat = mat(0x14101a, { roughness: 0.8 });
  const base1 = new THREE.Mesh(new THREE.BoxGeometry(28, 0.28, 0.06), baseMat);
  base1.position.set(0, 0.14, -9.97); g.add(base1);
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(22, 0.28, 0.06), baseMat);
    b.position.set(12.06 * sx, 0.14, 0); g.add(b);
  }

  // ── Tiras neón (techo y piso) ────────────────────────────
  const strip = (x, y, z, w, rz) => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: 0xe4006c, emissive: 0xe4006c, emissiveIntensity: 1.6 }));
    s.position.set(x, y, z);
    if (rz) s.rotation.z = rz;
    g.add(s);
  };
  strip(0, 6.2, -9.9, 26); strip(0, 0.42, -9.9, 26);
  strip(-11.9, 6.2, 0, 22, Math.PI / 2); strip(-11.9, 0.42, 0, 22, Math.PI / 2);
  strip(11.9, 6.2, 0, 22, Math.PI / 2); strip(11.9, 0.42, 0, 22, Math.PI / 2);

  // ── Marco de techo (truss perimetral) ────────────────────
  const beamMat = mat(0x14101a, { metalness: 0.5, roughness: 0.6 });
  const beam = (w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), beamMat);
    m.position.set(x, y, z); g.add(m);
  };
  beam(26, 0.12, 0.12, 0, 6.5, -9.9);
  beam(26, 0.12, 0.12, 0, 6.5, 9.9);
  beam(0.12, 0.12, 21.8, -11.9, 6.5, 0);
  beam(0.12, 0.12, 21.8, 11.9, 6.5, 0);
  beam(26, 0.12, 0.12, 0, 6.5, 0); // viga central
  beam(0.12, 0.12, 21.8, 0, 6.5, 0); // viga transversal

  // ── Lámparas colgantes (conos) ───────────────────────────
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2030, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide });
  const lamp = (x, z) => {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 6), mat(0x14101a));
    cord.position.set(x, 5.7, z); g.add(cord);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 24, 1, true), lampMat);
    cone.position.set(x, 6.05, z); g.add(cone);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfff6f0, emissive: 0xffe9c9, emissiveIntensity: 1.2 }));
    bulb.position.set(x, 5.72, z); g.add(bulb);
  };
  lamp(0, 0); lamp(-10.8, 0.6); lamp(10.8, 0.6);

  // ── Portal de entrada ────────────────────────────────────
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.4, 16), new THREE.MeshStandardMaterial({ color: 0x4b41e1, emissive: 0x4b41e1, emissiveIntensity: 0.8 }));
    post.position.set(10.6 * sx, 2.7, 8.6); g.add(post);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(21.8, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: 0x4b41e1, emissive: 0x4b41e1, emissiveIntensity: 0.5 }));
  lintel.position.set(0, 5.45, 8.6); g.add(lintel);
});