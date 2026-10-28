/* ============================================================
   VIVAMODA · CAPA DE DISPOSITIVO
   ------------------------------------------------------------
   Una sola lectura del dispositivo para todas las páginas, sin
   dependencias externas. Clasifica por ANCHO DE VIEWPORT (no por
   marca ni User-Agent), que es lo que realmente decide si un
   diseño cabe, y usa el tipo de puntero solo para desempatar:

     phone    < 640 px           (360–430 px típicos)
     tablet   640–1199 px        o táctil con lado corto ≤ 1100
     laptop   1200–1439 px       (1280/1366 px típicos)
     desktop  ≥ 1440 px

   Por qué no una librería: `ua-parser-js`/`mobile-detect` adivinan
   el aparato por User-Agent (frágil, y mobile-detect desaconseja su
   uso en HTML); `detect-it` sí es correcto para saber si hay ratón
   o dedo, pero son ~3 KB de CDN para algo que resuelven las media
   queries `pointer`/`hover`. Aquí se usa lo nativo y, además, se
   expone `window.VMDevice` para el código que necesita decidir en
   tiempo de ejecución (p. ej. la tienda VR).

   Deja en <html>:
     data-vm-device="phone|tablet|laptop|desktop"
     data-vm-input="touch|pointer"
     data-vm-reduced="true"   si el usuario pide menos movimiento
     data-vm-low="true"       si ahorra datos o tiene poca memoria
   y variables CSS --vm-vh / --vm-vw (alto real en móvil, donde la
   barra del navegador cambia el viewport).
   ============================================================ */
(function () {
  'use strict';

  if (window.VMDevice) return;

  const root = document.documentElement;
  const mq = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });

  const COARSE = mq('(pointer: coarse)');
  const NO_HOVER = mq('(hover: none)');
  const REDUCED = mq('(prefers-reduced-motion: reduce)');
  const STANDALONE = mq('(display-mode: standalone)');

  // Cortes alineados con los promedios de viewport investigados:
  // móviles 360–430, tablets 768–1180, laptops 1280–1536.
  const CORTES = { phone: 640, tablet: 1200, laptop: 1440 };

  let rafPendiente = 0;
  let ultimo = null;

  function clasificar(ancho, corto, tactil) {
    if (ancho < CORTES.phone) return 'phone';
    // Un móvil en horizontal (844×390) sigue siendo móvil aunque su ancho
    // parezca de tablet: manda el lado corto. Igual con un iPad apaisado
    // (1180×820), que debe seguir siendo tablet y no "laptop".
    if (tactil && corto < 600) return 'phone';
    if (tactil && corto <= 1100) return 'tablet';
    // El ancho decide el resto: una ventana de 820 px es tablet aunque el
    // equipo tenga ratón; 1200–1439 es el rango de los portátiles de 13–15".
    if (ancho < CORTES.tablet) return 'tablet';
    if (ancho < CORTES.laptop) return 'laptop';
    return 'desktop';
  }

  function medir() {
    // `innerWidth` (no `clientWidth`) para que la clasificación coincida con
    // las media queries: en escritorio, `clientWidth` descuenta la barra de
    // scroll y un portátil de 1440 px caía en «laptop» mientras el CSS ya
    // aplicaba las reglas de escritorio.
    const ancho = Math.round(window.innerWidth || root.clientWidth || 0);
    const alto = Math.round(window.innerHeight || 0);
    const pantallaAncho = Math.round(window.screen ? window.screen.width : ancho);
    const pantallaAlto = Math.round(window.screen ? window.screen.height : alto);
    const corto = Math.max(1, Math.min(pantallaAncho, pantallaAlto));
    const tactil = COARSE.matches || (NO_HOVER.matches && navigator.maxTouchPoints > 0);
    return { ancho, alto, corto, tactil, device: clasificar(ancho, corto, tactil) };
  }

  function recursosBajos() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const ahorro = Boolean(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
    const pocaRam = typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 2;
    return ahorro || pocaRam;
  }

  /**
   * Recalcula atributos y variables. Devuelve true si cambió el
   * dispositivo o el tipo de entrada (para avisar a quien escuche).
   */
  function aplicar(force) {
    const m = medir();
    const anterior = ultimo;
    const reducido = REDUCED.matches;
    const bajo = recursosBajos();

    root.dataset.vmDevice = m.device;
    root.dataset.vmInput = m.tactil ? 'touch' : 'pointer';
    root.dataset.vmReduced = String(reducido);
    root.dataset.vmLow = String(bajo);
    root.dataset.vmStandalone = String(STANDALONE.matches);
    root.style.setProperty('--vm-vw', m.ancho + 'px');
    root.style.setProperty('--vm-vh', m.alto + 'px');
    root.style.setProperty('--vm-dpr', String(window.devicePixelRatio || 1));

    ultimo = m;
    const cambio = force || !anterior || anterior.device !== m.device || anterior.tactil !== m.tactil;
    if (cambio) {
      try {
        root.dispatchEvent(new CustomEvent('vm:devicechange', { detail: info() }));
      } catch (_) { /* navegadores viejos: el resto sigue funcionando */ }
    }
    return cambio;
  }

  function agendar() {
    if (rafPendiente) return;
    rafPendiente = requestAnimationFrame(() => {
      rafPendiente = 0;
      aplicar(false);
    });
  }

  function info() {
    const m = ultimo || medir();
    return {
      device: m.device,
      input: m.tactil ? 'touch' : 'pointer',
      ancho: m.ancho,
      alto: m.alto,
      ladoCorto: m.corto,
      tactil: m.tactil,
      dpr: window.devicePixelRatio || 1,
      reducido: REDUCED.matches,
      recursosBajos: recursosBajos(),
      standalone: STANDALONE.matches,
      es: {
        phone: m.device === 'phone',
        tablet: m.device === 'tablet',
        laptop: m.device === 'laptop',
        desktop: m.device === 'desktop',
        movil: m.device === 'phone' || m.device === 'tablet',
      },
    };
  }

  aplicar(true);

  window.addEventListener('resize', agendar, { passive: true });
  window.addEventListener('orientationchange', agendar, { passive: true });
  // El alto cambia al esconderse la barra del navegador en iOS/Android.
  window.addEventListener('pageshow', agendar, { passive: true });

  [COARSE, NO_HOVER, REDUCED, STANDALONE].forEach((lista) => {
    if (lista.addEventListener) lista.addEventListener('change', agendar);
    else if (lista.addListener) lista.addListener(agendar);
  });

  window.VMDevice = {
    get device() { return info().device; },
    get input() { return info().input; },
    get es() { return info().es; },
    get toca() { return info().tactil; },
    get ancho() { return info().ancho; },
    get alto() { return info().alto; },
    get reducido() { return info().reducido; },
    get recursosBajos() { return info().recursosBajos; },
    info,
    // Atajo para quien necesite reaccionar sin escuchar el evento.
    alCambiar(fn) {
      const cb = () => fn(info());
      root.addEventListener('vm:devicechange', cb);
      return () => root.removeEventListener('vm:devicechange', cb);
    },
  };
})();
