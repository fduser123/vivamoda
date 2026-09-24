/* ============================================================
   MODO DE INTERACCIÓN VR
   Permite alternar entre:
   - Catálogo / mirada orbital (OrbitControls)
   - Primera persona (FPS) tipo videojuego → mover con WASD / flechas,
     mirar con el mouse/tacto, interactuar apretando clic.
   ============================================================ */
(function () {
  'use strict';

  const FPS_HEIGHT = 1.7;
  const STORE_KEY_MODE = 'vivamoda_vr_mode';

  let currentMode = 'orbit'; // 'orbit' | 'fps'

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
    s.textContent = 'Catálogo';
    modeBtn.appendChild(s);
    return s;
  })();

  function setMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;
    window.VRStore.mode = mode; // expone para que otros módulos lo consulten
    try { localStorage.setItem(STORE_KEY_MODE, mode); } catch (_) {}

    if (mode === 'fps') {
      window.VRStore.startFPSession && window.VRStore.startFPSession();
      modeLabel.textContent = 'FPS';
      modeBtn.classList.add('active');
      modeBtn.classList.remove('inactive');
    } else {
      window.VRStore.exitFPSession && window.VRStore.exitFPSession();
      modeLabel.textContent = 'Catálogo';
      modeBtn.classList.remove('active');
      modeBtn.classList.add('inactive');
    }
  }

  function init() {
    // Cargar modo preferido desde localStorage
    let stored = null;
    try {
      stored = localStorage.getItem(STORE_KEY_MODE);
    } catch (_) {}
    const initial = (stored === 'fps') ? 'fps' : 'orbit';

    modeBtn.addEventListener('click', () => {
      if (currentMode === 'orbit') {
        setMode('fps');
      } else {
        setMode('orbit');
      }
    });

    // Exponer controladores en VRStore
    window.VRStore.startFPSession = (function () {
      let started = false;
      return function () {
        if (started) return;
        started = true;
        if (typeof window.VRStore.interaccionStartFPSession === 'function') {
          window.VRStore.interaccionStartFPSession();
        }
      };
    })();

    window.VRStore.exitFPSession = (function () {
      return function () {
        if (typeof window.VRStore.interaccionExitFPSession === 'function') {
          window.VRStore.interaccionExitFPSession();
        }
      };
    })();

    setMode(initial);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
