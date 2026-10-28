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

  // Expuesto para que otros módulos (p. ej. el probador) puedan pedir el modo
  // avatar sin depender del ciclo del botón.
  window.VRStoreSetMode = setMode;

  function init() {
    let stored = null;
    try { stored = localStorage.getItem(STORE_KEY_MODE); } catch (_) {}
    // ?modo=avatar|orbit|fps fuerza el modo (útil para enlazar o probar)
    const url = new URLSearchParams(location.search).get('modo');
    const forzado = ORDEN.indexOf(url) >= 0;
    const guardado = ORDEN.indexOf(stored) >= 0 ? stored : null;

    // En una pantalla táctil no hay WASD: Avatar y FPS dejaban al usuario
    // plantado sin forma de avanzar. Se arranca en Catálogo (un dedo para
    // girar y tocar una prenda para verla); ?modo= sigue mandando si se pide.
    const tactil = Boolean(
      (window.VMDevice && window.VMDevice.toca)
      || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches),
    );
    const initial = forzado ? url : (tactil ? 'orbit' : (guardado || 'avatar'));

    modeBtn.addEventListener('click', () => {
      const i = ORDEN.indexOf(currentMode);
      setMode(ORDEN[(i + 1) % ORDEN.length]);
    });

    // Pulsar WASD en modo Catálogo (o si la página quedó guardada en ese modo)
    // enciende el Avatar y empieza a caminar: antes esas teclas no hacían nada
    // y el usuario no tenía forma de manejar al personaje. En FPS se respeta el
    // control en primera persona.
    const WASD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
    document.addEventListener('keydown', (e) => {
      if (currentMode !== 'orbit' || WASD.indexOf(e.code) < 0) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (t && t.tagName === 'SELECT') t.blur();
      setMode('avatar');
      if (window.VM && VM.toast) VM.toast('Modo Avatar: muévete con W A S D · E para ver la prenda', 'directions_walk');
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
