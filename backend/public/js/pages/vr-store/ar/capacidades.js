/* ============================================================
   RA · CAPACIDADES DEL DISPOSITIVO  (fase 0 del plan)
   ------------------------------------------------------------
   La realidad aumentada web no es un único camino. Este módulo
   responde UNA pregunta antes de enseñar ningún botón: ¿qué puede
   hacer este navegador?

     webxr       → Android con ARCore (Chrome). Sesión inmersiva
                   propia: colocamos la prenda en el suelo real.
     quicklook   → iPhone / iPad. AR Quick Look nativo vía USDZ.
     sceneviewer → Android sin WebXR (o sin Chrome): Scene Viewer
                   de Google, también con el .glb.
     visor       → escritorio o contexto inseguro. No hay RA: se
                   ofrece el QR para pasar la ficha al móvil.

   Detalle importante: WebXR exige **contexto seguro** (https o
   localhost). En una IP de red local por http el navegador ni
   siquiera expone `navigator.xr`, así que se detecta primero y se
   explica en vez de fallar en silencio.

   También vive aquí `VRAR.evento()`: un aviso ligero al servidor
   para poder medir cuánta gente abre la RA y qué modo usa.
   ============================================================ */
(function () {
  'use strict';

  const VRAR = (window.VRAR = window.VRAR || {});
  if (VRAR.capacidades) return;   // el script se incluye una sola vez

  const UA = navigator.userAgent || '';
  const ES_IOS = /iPad|iPhone|iPod/.test(UA)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS 13+
  const ES_ANDROID = /Android/i.test(UA);
  const SEGURO = window.isSecureContext !== false;
  const HAY_CAMARA = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  let promesa = null;

  /**
   * @returns {Promise<{modo, webxr, esIOS, esAndroid, seguro, camara, motivo?}>}
   */
  function detectar() {
    if (promesa) return promesa;
    promesa = (async () => {
      const base = { esIOS: ES_IOS, esAndroid: ES_ANDROID, seguro: SEGURO, camara: HAY_CAMARA, webxr: false };
      if (!SEGURO) return Object.assign(base, { modo: 'visor', motivo: 'contexto-inseguro' });

      let webxr = false;
      try {
        webxr = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'));
      } catch (_) {
        // Algunos navegadores lanzan en vez de devolver false.
        webxr = false;
      }
      base.webxr = webxr;

      if (webxr) return Object.assign(base, { modo: 'webxr' });
      if (ES_IOS) return Object.assign(base, { modo: 'quicklook' });
      if (ES_ANDROID) return Object.assign(base, { modo: 'sceneviewer' });
      return Object.assign(base, { modo: 'visor' });
    })();
    return promesa;
  }

  /** Nombre legible del modo, para mensajes al usuario. */
  const ETIQUETA = {
    webxr: 'Realidad aumentada',
    quicklook: 'AR Quick Look',
    sceneviewer: 'Scene Viewer',
    visor: 'Vista 3D',
  };

  /**
   * Analítica mínima: se manda al servidor y allí se registra en el log.
   * No bloquea ni rompe nada si falla (sendBeacon puede no existir).
   */
  function evento(nombre, datos) {
    const cuerpo = JSON.stringify(Object.assign({ evento: nombre, t: Date.now() }, datos || {}));
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/vr/ar/evento', new Blob([cuerpo], { type: 'application/json' }));
      } else {
        fetch('/api/vr/ar/evento', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpo, keepalive: true });
      }
    } catch (_) { /* la medición nunca debe romper la tienda */ }
    try {
      window.dispatchEvent(new CustomEvent('vrar:evento', { detail: { nombre, datos } }));
    } catch (_) {}
    if (window.console && console.info) console.info('[AR]', nombre, datos || '');
  }

  VRAR.capacidades = { detectar, etiqueta: ETIQUETA, evento };
  VRAR.evento = evento;
  VRAR.esIOS = ES_IOS;
  VRAR.esAndroid = ES_ANDROID;
  VRAR.contextoSeguro = SEGURO;
})();
