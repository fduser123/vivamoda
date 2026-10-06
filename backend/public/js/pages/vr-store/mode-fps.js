/* ============================================================
   MODO DE INTERACCIÓN VR
   Alterna entre tres formas de recorrer la tienda:
   - Avatar   → personaje en 3ª persona que se pasea con WASD y
                señala las prendas (modo por defecto)
   - Catálogo → cámara orbital libre (OrbitControls)
   - FPS      → primera persona, mirar con el ratón y avanzar
   ============================================================ */
(function () {
  'use strict';

  const STORE_KEY_MODE = 'vivamoda_vr_mode';

  // Orden del ciclo al pulsar el botón
  const ORDEN = ['avatar', 'orbit', 'fps'];
  const ETIQUETA = { avatar: 'Avatar', orbit: 'Catálogo', fps: 'FPS' };

  let currentMode = null;

  const modeBtn = (function () {
    const b = document.createElement('button');
    b.id = 'modeBtn';
    b.className =
      'fixed top-16 right-4 z-30 glass chip rounded-full px-3 py-2 text-xs font-bold text-white/90 flex items-center gap-1.5';
    b.innerHTML =
      '<span class="material-symbols-outlined text-base">view_in_ar</span>' +
      '<span class="hidden sm:inline">Modo</span>';
    document.body.appendChild(b);
    return b;
  })();

  const modeLabel = (function () {
    const s = document.createElement('span');
    s.id = 'modeLabel';
    s.className = 'text-[11px] font-extrabold uppercase tracking-wider text-white/80';
    s.textContent = 'Avatar';
    modeBtn.appendChild(s);
    return s;
  })();

  // Cada modo se apaga antes de encender el siguiente, para que no queden
  // dos controladores moviendo la cámara a la vez.
  function apagar(mode) {
    const V = window.VRStore;
    if (mode === 'fps') V.exitFPSession && V.exitFPSession();
    if (mode === 'avatar') V.exitAvatarSession && V.exitAvatarSession();
  }

  function encender(mode) {
    const V = window.VRStore;
    if (mode === 'fps') V.startFPSession && V.startFPSession();
    else if (mode === 'avatar') V.startAvatarSession && V.startAvatarSession();
    else V.exitFPSession && V.exitFPSession();
  }

  function setMode(mode) {
    if (mode === currentMode) return;
    const anterior = currentMode;
    currentMode = mode;
    window.VRStore.mode = mode;
    try { localStorage.setItem(STORE_KEY_MODE, mode); } catch (_) {}

    if (anterior) apagar(anterior);
    encender(mode);

    modeLabel.textContent = ETIQUETA[mode] || mode;
    modeBtn.classList.toggle('active', mode !== 'orbit');
  }

  function init() {
    let stored = null;
    try { stored = localStorage.getItem(STORE_KEY_MODE); } catch (_) {}
    // ?modo=avatar|orbit|fps fuerza el modo (útil para enlazar o probar)
    const url = new URLSearchParams(location.search).get('modo');
    // El avatar es el modo por defecto: es el que permite ver e interactuar
    // con las prendas.
    const initial = ORDEN.indexOf(url) >= 0
      ? url
      : (ORDEN.indexOf(stored) >= 0 ? stored : 'avatar');

    modeBtn.addEventListener('click', () => {
      const i = ORDEN.indexOf(currentMode);
      setMode(ORDEN[(i + 1) % ORDEN.length]);
    });

    // Envoltorios que espera el resto del código
    const V = window.VRStore;
    V.startFPSession = function () { V.interaccionStartFPSession && V.interaccionStartFPSession(); };
    V.exitFPSession = function () { V.interaccionExitFPSession && V.interaccionExitFPSession(); };

    // Arranca directamente en el modo elegido (sin animación intermedia)
    currentMode = null;
    setMode(initial);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
