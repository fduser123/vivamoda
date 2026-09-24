/* ============================================================
   ROPA ORDENADA + TIPOS DE ROPA
   - Prendas reales colgadas en los percheros (ordenadas por color)
   - Vitrina central con el vestido Atelier
   - Galería de TIPOS DE ROPA: camisas, polos, poleras, casacas,
     abrigos, vestidos, faldas, jeans, corbatas, gorras, correas,
     calzado y bolsos (cada tipo con su propia forma 3D)
   - Ropa doblada en estantes y productos sobre las mesas
   ============================================================ */
VRStore.part('ropa', function (S, g) {
  const { mat, textSprite } = S;

  // ─────────────────────────────────────────────────────────
  // 1) PRENDAS REALES COLGADAS (ordenadas por color)
  // ─────────────────────────────────────────────────────────
  function garment(prod, x, railY, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.14, 0.09), mat(prod.c3d, {
      roughness: 0.6, metalness: 0.05, emissive: prod.c3d, emissiveIntensity: 0.08,
    }));
    m.position.set(x, railY - 0.42, z);
    m.userData.product = prod;
    m.userData.ringScale = 0.55;
    m.userData.sway = Math.random() * Math.PI * 2;
    g.add(m);
    S.addClickable(m);
    S.addAnimate((dt, t) => { m.rotation.z = Math.sin(t * 1.1 + m.userData.sway) * 0.018; });
    const label = textSprite(prod.name.length > 26 ? prod.name.slice(0, 25) + '…' : prod.name, {
      scale: [2.4, 0.66, 1], size: 34, bg: 'rgba(255,255,255,0.96)', fg: '#1c1b1d', border: 'rgba(182,0,85,0.55)',
    });
    label.position.set(x, 0.34, z + 0.72);
    g.add(label);
    return m;
  }

  const rails = {
    damas: [S.bySku('VM-DAM-8810'), S.bySku('VM-DAM-8840'), S.bySku('VM-DAM-8870')], // fucsia → magenta → cobalto
    caballeros: [S.bySku('VM-CAB-8850'), S.bySku('VM-CAB-8820'), S.bySku('VM-CAB-8880')], // hueso → índigo → stealth
    ninos: [S.bySku('VM-NIN-8860'), S.bySku('VM-NIN-8890'), S.bySku('VM-NIN-8830')], // blossom → colorblock → terra
  };
  Object.keys(rails).forEach((key) => {
    const r = S.rackPoints[key];
    rails[key].forEach((prod, i) => {
      const hx = r.x + (i - (r.n - 1) / 2) * (r.span / r.n);
      garment(prod, hx, r.railY, r.z);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 2) VITRINA CENTRAL: vestido Atelier
  // ─────────────────────────────────────────────────────────
  (function podium() {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.6, 0.5, 48), mat(0xf6f2f5, { roughness: 0.6 }));
    base.position.y = 0.25; base.receiveShadow = true; base.castShadow = true;
    g.add(base);
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 0.75, 48), mat(0xe4006c, { roughness: 0.4, metalness: 0.2, emissive: 0x8f0041, emissiveIntensity: 0.35 }));
    mid.position.y = 0.88; mid.castShadow = true;
    g.add(mid);
    const prof = [[0,0],[0.26,0.03],[0.5,0.1],[0.64,0.28],[0.68,0.52],[0.57,0.82],[0.43,1.06],[0.34,1.3],[0.3,1.5],[0.35,1.72],[0.27,1.86],[0.15,1.96],[0.05,2.03],[0,2.08]];
    const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
    const gown = new THREE.Mesh(new THREE.LatheGeometry(pts, 56), new THREE.MeshStandardMaterial({
      color: 0xe4006c, emissive: 0x8f0041, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.25, side: THREE.DoubleSide,
    }));
    gown.position.y = 1.22; gown.castShadow = true;
    gown.userData.product = S.bySku('VM-DAM-ATELIER');
    gown.userData.ringScale = 1.3;
    g.add(gown);
    S.addClickable(gown);
    S.addAnimate((dt) => { gown.rotation.y += dt * 0.35; });
    const plaque = textSprite('Vestido Atelier · Edición Limitada', { scale: [3.0, 0.8, 1], size: 38, bg: 'rgba(255,255,255,0.96)', fg: '#b60055', border: 'rgba(228,0,108,0.7)' });
    plaque.position.set(0, 0.42, 1.6);
    g.add(plaque);
  })();

  // ─────────────────────────────────────────────────────────
  // 3) GALERÍA DE TIPOS DE ROPA
  //    Cada tipo tiene una silueta 3D distinta y su letrero.
  // ─────────────────────────────────────────────────────────
  const TYPE_DEFS = {
    camisa:  { label: 'CAMISAS',  emoji: '👔' },
    polo:    { label: 'POLOS',    emoji: '👕' },
    polera:  { label: 'POLERAS',  emoji: '🧥' },
    casaca:  { label: 'CASACAS',  emoji: '🧥' },
    abrigo:  { label: 'ABRIGOS',  emoji: '🧥' },
    vestido: { label: 'VESTIDOS', emoji: '👗' },
    falda:   { label: 'FALDAS',   emoji: '👗' },
    corbata: { label: 'CORBATAS', emoji: '👔' },
    jeans:   { label: 'JEANS',    emoji: '👖' },
    gorra:   { label: 'GORRAS',   emoji: '🧢' },
    correa:  { label: 'CORREAS',  emoji: '📿' },
    calzado: { label: 'CALZADO',  emoji: '👟' },
    bolso:   { label: 'BOLSOS',   emoji: '👜' },
  };

  // texturas de tela para camisas: lisa / rayas / cuadros
  function shirtTexture(colorHex, pattern = 'lisa') {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#' + new THREE.Color(colorHex).getHexString();
    x.fillRect(0, 0, 128, 256);
    if (pattern === 'rayas') {
      x.fillStyle = 'rgba(255,255,255,0.18)';
      for (let i = 0; i < 12; i++) x.fillRect(i * 11, 0, 4, 256);
    } else if (pattern === 'cuadros') {
      x.fillStyle = 'rgba(255,255,255,0.16)';
      for (let i = 0; i < 12; i++) x.fillRect(i * 11, 0, 3, 256);
      for (let j = 0; j < 24; j++) x.fillRect(0, j * 11, 128, 3);
    }
    // costura central
    x.strokeStyle = 'rgba(0,0,0,0.14)';
    x.lineWidth = 2;
    x.beginPath(); x.moveTo(64, 0); x.lineTo(64, 256); x.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // fábrica de prendas por tipo (siluetas distintas)
  function garmentByType(type, colorHex, pattern) {
    const grp = new THREE.Group();
    const col = new THREE.Color(colorHex);
    const dark = col.clone().multiplyScalar(0.6);
    const M = (geo, c, o) => new THREE.Mesh(geo, mat(c, o));
    const put = (mesh, x, y, z, ry = 0) => {
      mesh.position.set(x, y, z);
      if (ry) mesh.rotation.y = ry;
      grp.add(mesh);
    };
    switch (type) {
      case 'camisa': { // camisa con cuello italiano, botones, puños y bolsillo
        const tex = shirtTexture(colorHex, pattern);
        const cloth = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.05 });
        const pearl = new THREE.MeshStandardMaterial({ color: 0xf5efe2, roughness: 0.3, metalness: 0.15 });
        const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
        // torso y faldón
        put(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.11), cloth), 0, 0.2, 0);
        put(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.5, 0.11), cloth), 0, -0.3, 0);
        // canesú (hombros)
        put(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.12), cloth), 0, 0.54, 0);
        // pechera con botones de nácar
        put(new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.0, 0.02), white), 0, -0.02, 0.062);
        for (let i = 0; i < 5; i++) put(new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), pearl), 0, 0.38 - i * 0.16, 0.075);
        // cuello italiano (dos puntas)
        put(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.05), cloth), -0.12, 0.6, 0.035);
        put(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.05), cloth), 0.12, 0.6, 0.035);
        // mangas con puños
        put(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.1), cloth), -0.32, 0.1, 0);
        put(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.52, 0.1), cloth), 0.32, 0.1, 0);
        put(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.11), white), -0.32, -0.19, 0);
        put(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.07, 0.11), white), 0.32, -0.19, 0);
        // bolsillo delantero
        put(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.015), cloth), 0.14, 0.1, 0.058);
        break;
      }
      case 'polo': // polo con cuello
        put(M(new THREE.BoxGeometry(0.5, 0.98, 0.11), col, { roughness: 0.75 }), 0, 0, 0);
        put(M(new THREE.BoxGeometry(0.18, 0.09, 0.05), 0xffffff), 0, 0.52, 0.04);
        break;
      case 'polera': // polera gruesa con capucha
        put(M(new THREE.BoxGeometry(0.52, 1.0, 0.17), col, { roughness: 0.9 }), 0, 0, 0);
        put(M(new THREE.BoxGeometry(0.22, 0.18, 0.15), dark), 0, 0.56, 0.05);
        break;
      case 'casaca': // casaca con cremallera
        put(M(new THREE.BoxGeometry(0.54, 1.08, 0.14), col, { roughness: 0.6 }), 0, 0, 0);
        put(M(new THREE.BoxGeometry(0.05, 0.92, 0.02), 0x222222, { metalness: 0.6 }), 0, 0, 0.08);
        put(M(new THREE.BoxGeometry(0.2, 0.1, 0.11), dark), 0, 0.58, 0.04);
        break;
      case 'abrigo': // abrigo largo
        put(M(new THREE.BoxGeometry(0.6, 1.32, 0.17), col, { roughness: 0.55 }), 0, -0.08, 0);
        put(M(new THREE.BoxGeometry(0.24, 0.13, 0.13), dark), 0, 0.62, 0.05);
        put(M(new THREE.BoxGeometry(0.14, 0.9, 0.02), 0x222222, { metalness: 0.5 }), 0, -0.1, 0.09);
        break;
      case 'vestido': // vestido acampanado
        {
          const vp = [[0,0],[0.18,0.03],[0.27,0.14],[0.3,0.34],[0.22,0.52],[0.12,0.6],[0,0.66]];
          const geo = new THREE.LatheGeometry(vp.map(([r, y]) => new THREE.Vector2(r, y)), 22);
          put(M(geo, col, { side: THREE.DoubleSide, roughness: 0.5, emissive: col, emissiveIntensity: 0.08 }), 0, -0.05, 0);
          put(M(new THREE.BoxGeometry(0.3, 0.1, 0.28), dark), 0, 0.28, 0);
        }
        break;
      case 'falda': // falda de campana
        put(M(new THREE.ConeGeometry(0.3, 0.55, 20, 1, true), col, { side: THREE.DoubleSide, roughness: 0.6 }), 0, 0.32, 0);
        put(M(new THREE.BoxGeometry(0.4, 0.12, 0.36), dark), 0, 0.64, 0);
        break;
      case 'jeans': // pantalón con piernas
        put(M(new THREE.BoxGeometry(0.38, 0.13, 0.32), 0x2f4f7a, { roughness: 0.85 }), 0, 0.6, 0);
        put(M(new THREE.BoxGeometry(0.17, 0.5, 0.17), 0x2f4f7a, { roughness: 0.85 }), -0.105, -0.02, 0);
        put(M(new THREE.BoxGeometry(0.17, 0.5, 0.17), 0x2f4f7a, { roughness: 0.85 }), 0.105, -0.02, 0);
        break;
      case 'corbata': // corbata con nudo
        put(M(new THREE.BoxGeometry(0.09, 0.92, 0.025), col, { roughness: 0.4, metalness: 0.2 }), 0, 0, 0);
        put(M(new THREE.BoxGeometry(0.13, 0.14, 0.035), col), 0, 0.5, 0);
        break;
      case 'correa': // correa enrollada
        put(M(new THREE.TorusGeometry(0.15, 0.035, 10, 24), col, { roughness: 0.6 }), 0, 0, 0);
        break;
      case 'gorra': // gorra con visera
        put(M(new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), col, { roughness: 0.7 }), 0, 0.06, 0);
        put(M(new THREE.BoxGeometry(0.22, 0.025, 0.17), dark), 0, 0, 0.15);
        break;
      case 'calzado': // par de zapatos
        put(M(new THREE.BoxGeometry(0.15, 0.1, 0.3), col, { roughness: 0.4, metalness: 0.2 }), -0.11, 0, 0);
        put(M(new THREE.BoxGeometry(0.15, 0.1, 0.3), col, { roughness: 0.4, metalness: 0.2 }), 0.11, 0, 0);
        put(M(new THREE.BoxGeometry(0.15, 0.05, 0.06), dark, { metalness: 0.4 }), -0.11, -0.05, 0.12);
        put(M(new THREE.BoxGeometry(0.15, 0.05, 0.06), dark, { metalness: 0.4 }), 0.11, -0.05, 0.12);
        break;
      case 'bolso': // cartera con asa
        put(M(new THREE.BoxGeometry(0.26, 0.2, 0.14), col, { roughness: 0.5, metalness: 0.25 }), 0, 0, 0);
        put(M(new THREE.TorusGeometry(0.07, 0.015, 8, 16, Math.PI), dark, { metalness: 0.5 }), 0, 0.19, 0);
        break;
    }
    return grp;
  }

  // perchero de tipos: muestras + letrero
  function typeRail(x, z, typeId, colors, patterns) {
    const span = colors.length > 2 ? 1.9 : 1.7;
    const r = S.buildRail(x, z, 1.95, span, colors.length);
    colors.forEach((col, i) => {
      const hx = r.x + (i - (colors.length - 1) / 2) * (r.span / r.n);
      const sample = garmentByType(typeId, col, patterns && patterns[i]);
      sample.position.set(hx, r.railY - 0.45, z);
      g.add(sample);
    });
    const def = TYPE_DEFS[typeId];
    const sign = textSprite(def.label, { scale: [2.3, 0.66, 1], size: 46, bg: 'rgba(20,11,22,0.92)', border: '#ff8ab5', fg: '#ffffff' });
    sign.position.set(x, 3.45, z + 0.05);
    g.add(sign);
  }

  // galería de tipos flanqueando el pasillo central
  const GALLERY = [
    { x: -6.0, z: 1.2, type: 'vestido', colors: [0xe4006c, 0xd81e7b] },
    { x: -6.0, z: 2.8, type: 'polera', colors: [0x7b8ea8, 0xd8b98a] },
    { x: -6.0, z: 4.4, type: 'falda', colors: [0xb60055, 0x8f0041] },
    { x: -6.0, z: 6.0, type: 'corbata', colors: [0x1c1b1d, 0x2447c9] },
    { x: 6.0, z: 1.2, type: 'camisa', colors: [0xf5efe6, 0x9fc4e8, 0x2447c9], patterns: ['lisa', 'rayas', 'cuadros'] },
    { x: 6.0, z: 2.8, type: 'polo', colors: [0x2f54d0, 0xf49fb6] },
    { x: 6.0, z: 4.4, type: 'casaca', colors: [0x2a2f3a, 0xa9714b] },
    { x: 6.0, z: 6.0, type: 'abrigo', colors: [0x3b4b9e, 0xb60055] },
  ];
  GALLERY.forEach((it) => typeRail(it.x, it.z, it.type, it.colors, it.patterns));

  // placa de detalles de las camisas (frente a la estación de camisas)
  const shirtDetail = textSprite('Cuello italiano · Botones de nácar · Puños ajustables · Bolsillo', {
    w: 820, h: 96, size: 26, bg: 'rgba(255,255,255,0.95)', fg: '#1c1b1d', border: 'rgba(182,0,85,0.45)',
  });
  shirtDetail.scale.set(3.0, 0.62, 1);
  shirtDetail.position.set(6.0, 1.5, 2.0);
  g.add(shirtDetail);

  // letrero de la galería
  const banner = textSprite('', {
    w: 2048, h: 340, lines: [
      'GALERÍA DE TIPOS DE ROPA',
      'Camisas · Polos · Poleras · Casacas · Vestidos · Abrigos · Faldas',
      'Jeans · Corbatas · Gorras · Correas · Calzado · Bolsos',
    ],
    size: 46, bg: 'rgba(20,11,22,0.82)', border: '#8f7bff', fg: '#ffffff',
  });
  banner.scale.set(7.5, 1.25, 1);
  banner.position.set(0, 4.0, 3.4);
  g.add(banner);

  // ─────────────────────────────────────────────────────────
  // 4) ROPA DOBLADA EN ESTANTES + ACCESORIOS + LETREROS
  // ─────────────────────────────────────────────────────────
  function folded(color, n = 3) {
    const stack = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.38), mat(color, { roughness: 0.85 }));
      f.position.y = i * 0.07;
      f.castShadow = true;
      stack.add(f);
    }
    return stack;
  }

  // camisa doblada con cuello y botón visibles
  function foldedShirt(color) {
    const grp = new THREE.Group();
    const tex = shirtTexture(color, 'lisa');
    const cloth = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
    const pearl = new THREE.MeshStandardMaterial({ color: 0xf5efe2, roughness: 0.3 });
    for (let i = 0; i < 3; i++) {
      const layer = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.4), cloth);
      layer.position.y = i * 0.055;
      grp.add(layer);
    }
    // cuello asomando en el doblez
    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.07), cloth);
    collar.position.set(0, 0.14, -0.18);
    grp.add(collar);
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), pearl);
    btn.position.set(0, 0.03, 0.205);
    grp.add(btn);
    return grp;
  }
  const palettes = [
    [0xe4006c, 0xff8ab5, 0xb60055, 0x8f0041],
    [0x2447c9, 0x7b8ea8, 0x2f54d0, 0x1c1b1d],
    [0xf0a832, 0xf49fb6, 0xa9714b, 0xd8b98a],
  ];

  // doblados en estantes de pared trasera y de niños
  (S.shelfSpots || []).forEach((spot, i) => {
    if (String(spot.tag || '').startsWith('accesorios')) return;
    const pal = palettes[i % palettes.length];
    const perRow = Math.max(1, Math.min(3, Math.floor(spot.width / 0.42)));
    for (let k = 0; k < perRow; k++) {
      const col = pal[(i + k) % pal.length];
      const lx = -spot.width / 2 + 0.3 + k * (spot.width / perRow);
      const wx = spot.x + lx * Math.cos(spot.rotY);
      const wz = spot.z + lx * Math.sin(spot.rotY);
      const st = spot.tag === 'doblados-caballeros' && k < 2 ? foldedShirt(col) : folded(col, 2 + (k % 2));
      st.position.set(wx, spot.y + 0.03, wz);
      st.rotation.y = spot.rotY + (k % 2 ? 0.1 : -0.1);
      g.add(st);
    }
  });

  // accesorios tipo vitrina en los estantes laterales
  const ACC_SHELF_CONTENT = {
    'accesorios-izq': [
      { level: 0, items: [{ t: 'gorra', c: 0x2447c9 }, { t: 'correa', c: 0xb60055 }, { t: 'calzado', c: 0x111111 }] },
      { level: 1, items: [{ t: 'calzado', c: 0xd4af37 }, { t: 'gorra', c: 0xe4006c }, { t: 'correa', c: 0x2a2f3a }] },
    ],
    'accesorios-der': [
      { level: 0, items: [{ t: 'bolso', c: 0xd4af37 }, { t: 'jeans', c: 0x2f4f7a }, { t: 'gorra', c: 0xf0a832 }] },
      { level: 1, items: [{ t: 'bolso', c: 0xe4006c }, { t: 'jeans', c: 0x2447c9 }, { t: 'calzado', c: 0xf5f5f5 }] },
    ],
  };
  const byTag = {};
  (S.shelfSpots || []).forEach((s) => { (byTag[s.tag] = byTag[s.tag] || []).push(s); });
  Object.keys(ACC_SHELF_CONTENT).forEach((tag) => {
    const rows = ACC_SHELF_CONTENT[tag];
    (byTag[tag] || []).forEach((spot, level) => {
      const row = rows[level];
      if (!row) return;
      const n = row.items.length;
      row.items.forEach((it, i) => {
        const lx = -spot.width / 2 + 0.35 + i * ((spot.width - 0.7) / Math.max(1, n - 1));
        const wx = spot.x + lx * Math.cos(spot.rotY);
        const wz = spot.z + lx * Math.sin(spot.rotY);
        const sample = garmentByType(it.t, it.c);
        sample.position.set(wx, spot.y + 0.06, wz);
        sample.rotation.y = spot.rotY;
        sample.scale.setScalar(it.t === 'jeans' ? 0.55 : 0.95);
        g.add(sample);
      });
    });
  });

  // letreros por estante (ropa doblada y accesorios)
  const SHELF_SIGNS = {
    'doblados-damas': 'POLOS & BLUSAS DOBLADOS',
    'doblados-caballeros': 'JEANS & CAMISAS DOBLADOS',
    kids: 'MINI POLERAS DOBLADAS',
    'accesorios-izq': 'GORRAS · CORREAS · CALZADO',
    'accesorios-der': 'BOLSOS · JEANS · GORRAS',
  };
  (S.shelfSpots || []).forEach((spot) => {
    const txt = SHELF_SIGNS[spot.tag];
    if (!txt) return;
    const sign = textSprite(txt, { scale: [2.6, 0.62, 1], size: 36, bg: 'rgba(255,255,255,0.94)', fg: '#1c1b1d', border: 'rgba(182,0,85,0.5)' });
    sign.position.set(spot.x, spot.topY + 0.55, spot.z);
    g.add(sign);
  });

  // ─────────────────────────────────────────────────────────
  // 5) PRODUCTOS SOBRE LAS MESAS DE EXHIBICIÓN
  // ─────────────────────────────────────────────────────────
  const tableItems = [
    [S.bySku('VM-CAL-8811'), S.bySku('VM-ACC-8812'), S.bySku('VM-ACC-006')], // Novedades
    [S.bySku('VM-DAM-8942'), S.bySku('VM-CAB-3109'), S.bySku('VM-NIN-7721'), S.bySku('VM-CAL-9910')], // Ofertas
  ];
  (S.tableSpots || []).forEach((tb, ti) => {
    const items = tableItems[ti] || [];
    const n = items.length;
    items.forEach((prod, i) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.34), mat(prod.c3d, {
        roughness: 0.45, metalness: 0.2, emissive: prod.c3d, emissiveIntensity: 0.12,
      }));
      b.position.set(tb.x + (-0.72 + i * (1.44 / Math.max(1, n - 1))), 1.0, tb.z);
      b.rotation.y = (i % 2 ? 1 : -1) * 0.35;
      b.userData.product = prod;
      b.userData.ringScale = 0.3;
      g.add(b);
      S.addClickable(b);
    });
  });
});