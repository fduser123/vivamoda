/* ============================================================
   RA · INTERFAZ DE LA TIENDA  (fase 1)
   ------------------------------------------------------------
   Une las capacidades del móvil, los lanzadores nativos y la
   tarjeta de producto:

   - `VRAR.ui.actualizar(prod)` lo llama interaccion.js cada vez que
     se abre una prenda. Consulta /api/vr/ar/:sku y deja el botón
     listo (o lo esconde si esa prenda no tiene modelo 3D).
   - El botón es un <a> real: en iOS Quick Look necesita `rel="ar"`
     y un href ya escrito antes del toque. Aquí se prepara en
     cuanto llega la respuesta, no al hacer clic.
   - En Android con WebXR, el clic abre nuestra propia sesión
     (ar/sesion.js) en lugar de Scene Viewer.
   - En escritorio, el clic abre el QR para pasar la ficha al móvil.
   - `?ar=<sku>` (lo que codifica el QR) muestra una hoja con un
     botón grande: WebXR y Quick Look exigen un gesto del usuario,
     así que no se puede abrir solo.
   ============================================================ */
(function () {
  'use strict';

  const VRAR = (window.VRAR = window.VRAR || {});
  const S = window.VRStore || {};
  const VM = window.VM || {};
  const $ = (id) => document.getElementById(id);
  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  const cache = new Map();          // sku → respuesta de /api/vr/ar/:sku
  let cap = null;                   // capacidades detectadas
  let capPromesa = null;
  let prodActual = null;
  let infoActual = null;
  let preparado = { abreNativo: false };
  let token = 0;

  const btn = () => $('cardArBtn');
  const img = () => $('cardArImg');
  const label = () => $('cardArLabel');

  const aviso = (txt) => { if (VM.toast) VM.toast(txt, 'view_in_ar'); };

  function capacidades() {
    if (!capPromesa) {
      capPromesa = VRAR.capacidades.detectar().then((c) => {
        cap = c;
        return c;
      });
    }
    return capPromesa;
  }

  async function pedirInfo(sku) {
    if (cache.has(sku)) return cache.get(sku);
    const datos = await VM.api('/vr/ar/' + encodeURIComponent(sku));
    cache.set(sku, datos);
    return datos;
  }

  /** Texto del botón según lo que de verdad va a pasar al pulsarlo. */
  function textoBoton(modo, info) {
    if (modo === 'webxr') return 'Colocar en mi espacio';
    if (modo === 'quicklook') return 'Ver en mi espacio';
    if (modo === 'sceneviewer') return 'Ver en tu espacio';
    return 'Ver en AR (QR)';
  }

  function esconder() {
    const b = btn();
    if (b) {
      b.classList.add('hidden');
      b.classList.remove('flex');
      b.setAttribute('aria-hidden', 'true');
      b.removeAttribute('rel');
      b.href = '#';
    }
    infoActual = null;
  }

  /** Pinta el botón con la info ya cargada. */
  function pintar() {
    const b = btn();
    if (!b) return;
    const modo = (cap && cap.modo) || 'visor';
    if (!infoActual || !infoActual.disponible) return esconder();

    // En iPhone, sin USDZ no hay nada que abrir: mejor no prometerlo.
    if (modo === 'quicklook' && !infoActual.usdz) {
      return esconder();
    }

    preparado = VRAR.nativo.preparar(b, infoActual, cap);
    if (!preparado.abreNativo && preparado.motivo === 'sin-modelo') return esconder();

    if (label()) label().textContent = textoBoton(modo, infoActual);
    const im = img();
    if (im) {
      const foto = (prodActual && prodActual.image) || '';
      // Quick Look exige un <img> dentro del ancla. Solo se muestra en iOS
      // (ahí la miniatura forma parte del botón nativo); en el resto de modos
      // se oculta para no dejar un cuadradito de 16 px que no aporta nada.
      im.style.display = modo === 'quicklook' ? '' : 'none';
      im.onerror = () => { im.onerror = null; im.src = PIXEL; };   // sin icono roto
      im.src = foto || PIXEL;
      im.alt = '';
    }
    b.classList.remove('hidden');
    b.classList.add('flex');
    b.removeAttribute('aria-hidden');
    b.setAttribute('aria-label', (infoActual.name || 'Esta prenda') + ' · ' + textoBoton(modo, infoActual));
  }

  /** Llamado desde interaccion.js al abrir la tarjeta. */
  async function actualizar(prod) {
    if (!prod || !prod.sku) return esconder();
    prodActual = prod;
    const miToken = ++token;
    const b = btn();
    if (!b) return;

    // Estado inmediato: si la prenda no tiene modelo, el botón ni aparece.
    infoActual = null;
    esconder();

    try {
      const [c, info] = await Promise.all([capacidades(), pedirInfo(prod.sku)]);
      if (miToken !== token) return;   // el usuario ya abrió otra prenda
      infoActual = info;
      pintar();
      // Si el usuario llegó por QR y esta es su prenda, se abre la hoja.
      if (c.modo === 'visor' && !b.classList.contains('hidden')) {
        // nada: en escritorio el botón ya ofrece el QR
      }
    } catch (err) {
      if (miToken !== token) return;
      esconder();
      console.info('[AR] sin datos de RA para', prod.sku, err.message);
    }
  }

  // ── Clic en el botón de la tarjeta ──────────────────────
  function enlazarBoton() {
    const b = btn();
    if (!b || b.dataset.arListo) return;
    b.dataset.arListo = '1';
    b.addEventListener('click', (ev) => {
      const modo = (cap && cap.modo) || 'visor';
      if (!infoActual && !preparado.abreNativo) {
        ev.preventDefault();
        aviso('Esta prenda todavía no tiene modelo de RA');
        return;
      }
      VRAR.evento('ar_open', {
        sku: infoActual ? infoActual.sku : '',
        modo,
        categoria: infoActual ? infoActual.category : '',
      });

      if (modo === 'webxr') {
        ev.preventDefault();
        if (!VRAR.sesion) {
          aviso('La sesión de RA no está disponible');
          return;
        }
        VRAR.sesion.iniciar(infoActual).catch((err) => {
          console.warn('[AR] sesión', err);
          aviso(err && err.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado'
            : 'No se pudo abrir la RA en este dispositivo');
        });
        return;
      }
      if (modo === 'visor' || !preparado.abreNativo) {
        // Escritorio (o Android sin visores): se pasa la ficha al móvil.
        ev.preventDefault();
        if (infoActual) VRAR.nativo.abrirQR(infoActual);
        return;
      }
      // quicklook / sceneviewer: navegación nativa, no se toca el evento.
    });
  }

  /* ============================================================
     Hoja de entrada por QR: /tienda-virtual-realidad?ar=<sku>
     ============================================================ */
  function hojaDeepLink() {
    let caja = $('arDeepModal');
    if (caja) return caja;
    caja = document.createElement('div');
    caja.id = 'arDeepModal';
    caja.className = 'fixed inset-0 z-[95] hidden items-center justify-center p-4';
    caja.style.background = 'rgba(10,6,14,0.75)';
    caja.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="arDeepTitle"
           class="glass rounded-2xl p-5 w-[320px] max-w-full text-white text-center">
        <div class="flex items-start justify-between gap-2">
          <span class="text-[10px] font-extrabold uppercase tracking-widest text-[#ff8ab5]">Realidad aumentada</span>
          <button id="arDeepClose" class="w-8 h-8 -mt-1 -mr-1 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center" aria-label="Cerrar">
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>
        <h2 id="arDeepTitle" class="font-extrabold text-base mt-1.5 text-left"></h2>
        <p id="arDeepHint" class="text-[12px] text-white/65 mt-1 text-left"></p>
        <a id="arDeepBtn" href="#" class="mt-4 w-full rounded-xl bg-[#e4006c] hover:bg-[#ff2d86] text-white font-extrabold py-3 px-4 flex items-center justify-center gap-2 transition-colors">
          <span class="material-symbols-outlined text-base">view_in_ar</span>
          <span id="arDeepLabel">Ver en mi espacio</span>
        </a>
      </div>`;
    document.body.appendChild(caja);
    const cerrar = () => { caja.classList.add('hidden'); caja.classList.remove('flex'); };
    caja.addEventListener('click', (e) => { if (e.target === caja) cerrar(); });
    $('arDeepClose').addEventListener('click', cerrar);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !caja.classList.contains('hidden')) cerrar();
    });
    return caja;
  }

  async function abrirDeepLink(sku) {
    let info;
    try {
      info = await pedirInfo(sku);
    } catch (_) {
      aviso('Esa prenda ya no está disponible para AR');
      return;
    }
    if (!info.disponible) { aviso('Esta prenda no tiene modelo de RA'); return; }

    const c = await capacidades();
    const caja = hojaDeepLink();
    const ancla = $('arDeepBtn');
    const etiqueta = $('arDeepLabel');
    const pista = $('arDeepHint');

    $('arDeepTitle').textContent = info.name;
    etiqueta.textContent = textoBoton(c.modo, info);
    ancla.removeAttribute('rel');
    ancla.href = '#';
    const prep = VRAR.nativo.preparar(ancla, info, c);

    if (c.modo === 'webxr') {
      pista.textContent = 'Se abrirá la cámara. Apunta al suelo y toca para colocar la prenda.';
    } else if (c.modo === 'quicklook') {
      pista.textContent = 'Se abre AR Quick Look y coloca la prenda a tamaño real.';
    } else if (c.modo === 'sceneviewer') {
      pista.textContent = 'Se abre Scene Viewer con la prenda en tu espacio.';
    } else if (!c.seguro) {
      pista.textContent = 'La RA necesita una conexión segura (https). Abre esta página por https o desde localhost.';
    } else {
      pista.textContent = 'Este navegador no puede abrir RA. Usa el móvil para verlo en tu espacio.';
    }

    ancla.onclick = (ev) => {
      VRAR.evento('ar_open', { sku: info.sku, modo: c.modo, origen: 'qr' });
      if (c.modo === 'webxr') {
        ev.preventDefault();
        VRAR.sesion.iniciar(info).catch(() => aviso('No se pudo abrir la RA'));
        return;
      }
      if (!prep.abreNativo) {
        ev.preventDefault();
        aviso('Este navegador no puede abrir RA: ábrelo en el móvil');
      }
    };

    caja.classList.remove('hidden');
    caja.classList.add('flex');
  }

  // ── Arranque ───────────────────────────────────────────
  function init() {
    enlazarBoton();
    capacidades().then(() => {
      // Si la tarjeta ya estuviera abierta (recarga con la prenda elegida),
      // se repinta con el modo correcto.
      if (prodActual) actualizar(prodActual);
      const sku = new URLSearchParams(location.search).get('ar');
      if (sku) abrirDeepLink(sku.trim());
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  VRAR.ui = { actualizar, esconder, capacidad: capacidades };
})();
