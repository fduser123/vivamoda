/* ============================================================
   SECCIONES
   Área de piso, columna de acento y letrero colgante por cada
   zona (Damas, Caballeros, Niños, Novedades, Ofertas Flash).
   ============================================================ */
VRStore.part('secciones', function (S, g) {
  const { textSprite } = S;

  S.ZONES.forEach((z) => {
    const isSide = Math.abs(z.pos.x) > 9;

    // área en el piso (tinte sutil del color de la zona)
    const area = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48),
      new THREE.MeshStandardMaterial({ color: z.zone, transparent: true, opacity: 0.07, roughness: 0.95 })
    );
    area.rotation.x = -Math.PI / 2;
    area.position.set(z.pos.x, 0.012, z.pos.z + 0.6);
    g.add(area);

    // columna de acento (pared trasera o lateral según la zona)
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.4, 0.08), new THREE.MeshStandardMaterial({ color: z.zone, emissive: z.zone, emissiveIntensity: 0.55 }));
    if (isSide) {
      col.position.set(Math.sign(z.pos.x) * 11.95, 2.2, z.pos.z);
      col.rotation.y = Math.PI / 2;
    } else {
      col.position.set(z.pos.x, 2.2, -9.95);
    }
    g.add(col);

    // letrero de zona
    const s = textSprite(z.label.toUpperCase(), { scale: [3.3, 0.92, 1], size: 54, bg: 'rgba(20,11,22,0.92)', border: z.color, fg: '#ffffff' });
    s.position.set(z.pos.x, 4.65, z.pos.z - 1.6);
    g.add(s);
  });

  // cartel de ofertas sobre la mesa
  const ofertaTag = textSprite('🔥 OFERTAS FLASH', { scale: [2.2, 0.6, 1], size: 40, bg: 'rgba(20,10,22,0.9)', border: '#ff4d4d', fg: '#ffb4b4' });
  ofertaTag.position.set(10.8, 1.75, 1.6);
  g.add(ofertaTag);
});