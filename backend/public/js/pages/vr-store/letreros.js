/* ============================================================
   LETREROS GENERALES
   Letrero principal neón de VivaModa y subtítulo sobre la
   entrada, visibles al recorrer la tienda.
   ============================================================ */
VRStore.part('letreros', function (S, g) {
  const { textSprite } = S;

  const sign = textSprite('VIVAMODA · TIENDA VIRTUAL', { scale: [6.4, 1.35, 1], size: 60, bg: 'rgba(20,10,22,0.8)', border: '#8f7bff', fg: '#ffd9e0' });
  sign.position.set(0, 5.9, 4.6);
  g.add(sign);

  const sub = textSprite('🥽  Recorre · Explora · Compra  🥽', { scale: [3.6, 0.8, 1], size: 34, bg: 'rgba(20,10,22,0.55)', border: 'rgba(255,255,255,0.25)', fg: 'rgba(255,255,255,0.85)' });
  sub.position.set(0, 4.75, 5.3);
  g.add(sub);
});