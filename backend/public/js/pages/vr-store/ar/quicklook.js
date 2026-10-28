/* ============================================================
   RA · LANZADORES NATIVOS + QR  (fase 1 del plan)
   ------------------------------------------------------------
   Tres formas de abrir la prenda en el mundo real, sin escribir
   un motor propio en los dos casos que ya resuelve el sistema:

   - iOS  → AR Quick Look. Safari abre un .usdz con `<a rel="ar">`
            y lo ancla a escala 1:1 sobre la mesa. Requiere que el
            ancla lleve un `<img>` dentro y que el MIME del .usdz
            sea `model/vnd.usdz+zip` (ver server.js).
   - Android → Scene Viewer de Google ARCore, con `intent://` y
            `browser_fallback_url` por si no hay ARCore instalado.
   - Escritorio → no hay RA: se muestra un QR con la ficha en el
            móvil, que aterriza en `?ar=<sku>` y abre la RA sola.

   El botón es un <a> real y su href se prepara ANTES del toque:
   Safari ignora los clics sintéticos sobre `rel="ar"`, así que no
   se puede construir el enlace dentro del manejador del clic.
   ============================================================ */
(function () {
  'use strict';

  const VRAR = (window.VRAR = window.VRAR || {});
  const $ = (id) => document.getElementById(id);
  const abs = (u) => (u ? new URL(u, location.href).href : null);

  /** URL de Scene Viewer: abre el .glb en RA con Google Play Services for AR. */
  function urlSceneViewer(info) {
    const archivo = abs(info.glb);
    if (!archivo) return null;
    const titulo = encodeURIComponent((info.name || 'VivaModa').slice(0, 60));
    const respaldo = encodeURIComponent(abs(info.urls.tienda));
    return 'intent://arvr.google.com/scene-viewer/1.0'
      + '?file=' + encodeURIComponent(archivo)
      + '&mode=ar_preferred'
      + '&title=' + titulo
      + '#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;'
      + 'S.browser_fallback_url=' + respaldo + ';end;';
  }

  /**
   * Deja el <a> listo para el modo detectado. Se llama cada vez que cambia el
   * producto de la tarjeta, no al hacer clic.
   * @returns {{abreNativo: boolean, motivo?: string}}
   */
  function preparar(ancla, info, cap) {
    if (!ancla) return { abreNativo: false };
    const modo = cap && cap.modo ? cap.modo : 'visor';
    ancla.removeAttribute('rel');
    ancla.removeAttribute('target');

    if (!info || !info.disponible) return { abreNativo: false, motivo: 'sin-modelo' };

    if (modo === 'quicklook') {
      if (!info.usdz) return { abreNativo: false, motivo: 'sin-usdz' };
      ancla.setAttribute('rel', 'ar');
      ancla.href = abs(info.usdz);
      return { abreNativo: true };
    }
    if (modo === 'sceneviewer') {
      const url = urlSceneViewer(info);
      if (!url) return { abreNativo: false, motivo: 'sin-modelo' };
      ancla.href = url;
      return { abreNativo: true };
    }
    if (modo === 'webxr') {
      ancla.href = '#';
      return { abreNativo: true };   // lo maneja sesion.js con una sesión propia
    }
    ancla.href = '#';
    return { abreNativo: false, motivo: 'escritorio' };
  }

  /** Modal de QR (solo escritorio). Se crea una vez y se reutiliza. */
  function modalQR() {
    let caja = $('arQrModal');
    if (caja) return caja;

    caja = document.createElement('div');
    caja.id = 'arQrModal';
    caja.className = 'fixed inset-0 z-[90] hidden items-center justify-center p-4';
    caja.style.background = 'rgba(10,6,14,0.72)';
    caja.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="arQrTitle"
           class="glass rounded-2xl p-5 w-[300px] max-w-full text-center text-white">
        <div class="flex items-start justify-between gap-2">
          <h2 id="arQrTitle" class="font-extrabold text-base text-left">Ver en tu espacio</h2>
          <button id="arQrClose" class="w-8 h-8 -mt-1 -mr-1 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
                  aria-label="Cerrar">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        <p id="arQrName" class="text-[12px] text-white/70 mt-1"></p>
        <div class="mt-3 rounded-xl bg-white p-3 inline-block">
          <img id="arQrImg" alt="" class="w-[190px] h-[190px] block"/>
        </div>
        <p class="text-[11px] text-white/60 mt-3 leading-snug">
          Escanea con la cámara del móvil y coloca la prenda en tu casa.
          El móvil tiene que estar en la misma red que este equipo.
        </p>
        <p id="arQrUrl" class="text-[10px] text-white/40 mt-2 break-all"></p>
      </div>`;
    document.body.appendChild(caja);

    const cerrar = () => {
      caja.classList.add('hidden');
      caja.classList.remove('flex');
    };
    caja.addEventListener('click', (e) => { if (e.target === caja) cerrar(); });
    $('arQrClose').addEventListener('click', cerrar);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !caja.classList.contains('hidden')) cerrar();
    });
    return caja;
  }

  function abrirQR(info) {
    const caja = modalQR();
    const url = abs(info.urls.tienda);
    $('arQrName').textContent = info.name || info.sku;
    $('arQrUrl').textContent = url || '';
    $('arQrImg').alt = `Código QR para ver ${info.name || 'la prenda'} en tu espacio`;
    $('arQrImg').src = `/api/vr/ar/${encodeURIComponent(info.sku)}/qr.png`;
    caja.classList.remove('hidden');
    caja.classList.add('flex');
    setTimeout(() => $('arQrClose') && $('arQrClose').focus(), 30);
    VRAR.evento('ar_qr', { sku: info.sku });
  }

  VRAR.nativo = { preparar, abrirQR, urlSceneViewer, abs };
})();
