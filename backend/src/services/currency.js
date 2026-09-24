// =====================================================================
// Conversión de moneda COP → USD (solo migración del seed demo).
// Los productos externos ya llegan en USD (DummyJSON / FakeStore).
//
// La tasa es un valor demo de septiembre 2026 (no usar en producción);
// se define UNA sola vez aquí para que seed.js y seed-external.js usen
// el mismo criterio.
// =====================================================================

/** Tasa de conversión de pesos colombianos a dólares (demo). */
export const COP_TO_USD_RATE = 1 / 3900;

/**
 * Convierte pesos colombianos a dólares con redondeo "psicológico" de retail:
 * 89.99  → 22.99   (termina en .99, .49 o .00 según el tramo)
 * 189900 → 48.07 → 47.99
 */
export function copToUsd(cop) {
  const usd = Number(cop) * COP_TO_USD_RATE;
  return retailRound(usd);
}

/** Redondeo psicológico de retail en USD. */
export function retailRound(usd) {
  const v = Number(usd);
  if (!Number.isFinite(v)) return 0;
  if (v >= 20) return Math.round(v) - 0.01;           // 62 → 61.99 · 189 → 188.99
  if (v >= 5) return Math.floor(v) + 0.49;            // 12.4 → 12.49 · 8 → 8.49
  let r = Math.round(v * 2) / 2;                      // <5: pasos de .50
  if (Number.isInteger(r)) r -= 0.01;                 // 3 → 2.99 (evita enteros exactos)
  return Math.max(r, 0.99);
}
