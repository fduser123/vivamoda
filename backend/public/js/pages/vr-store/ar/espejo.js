/* ============================================================
   RA · ESPEJO EN VIVO  (fase 3 del plan)
   ------------------------------------------------------------
   Cámara frontal + la foto de la prenda anclada a los hombros.
   Funciona en iPhone y Android porque NO usa WebXR: sólo
   `getUserMedia` y un canvas 2D.

   - La pose se detecta con MediaPipe Tasks Vision, cargado bajo
     demanda desde CDN (WASM aparte). Si el CDN falla, la prenda se
     queda centrada y se puede colocar a mano con los controles:
     nunca hay pantalla muerta.
   - El vídeo se muestra espejado (como un espejo real), así que el
     overlay se dibuja con la x invertida y el ángulo cambiado.
   - Capturar compone vídeo + prenda en un PNG y, si el móvil lo
     permite, lo comparte con `navigator.share`.

   Límite honesto: es una superposición 2D anclada a hombros/cadera,
   no un ajuste por píxel de la tela. Para eso haría falta un modelo
   de segmentación por prenda (fuera de alcance del plan).
   ============================================================ */
(function () {
  'use strict';

  const VRAR = (window.VRAR = window.VRAR || {});
  const VM = window.VM || {};
  const $ = (id) => document.getElementById(id);

  const MP_VERSION = '0.10.14';
  const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
  const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
  const MP_MODELO = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

  // Anclaje por categoría: qué punto del cuerpo manda y cuánto ocupa.
  // Las medidas son múltiplos de la distancia entre hombros (o caderas).
  function anclaje(categoria) {
    const c = String(categoria || '').toLowerCase();
    if (/pantal|jean|short|falda|chino/.test(c)) return { punto: 'cadera', factor: 1.5 };
    if (/calzado|zapat|sneaker|sandalia|bota/.test(c)) return { punto: 'tobillo', factor: 1.15 };
    if (/bolso|mochila|cartera|clutch/.test(c)) return { punto: 'hombro', factor: 0.85 };
    if (/gafas|sombrero|gorro|arete|collar|joya|reloj|pulsera/.test(c)) return { punto: 'cabeza', factor: 0.55 };
    if (/abrigo|chaqueta|blazer|bomber|outdoor|exterior/.test(c)) return { punto: 'hombro', factor: 2.1 };
    return { punto: 'hombro', factor: 1.85 };   // camisas, blusas, vestidos, tops
  }

  const estado = { abierto: false, stream: null, raf: 0, pose: null, img: null, prod: null, ajuste: 1, desplazamiento: 0, espejo: true };

  /* ---------- Modal ---------- */
  function montar() {
    let caja = $('arMirror');
    if (caja) return caja;
    caja = document.createElement('div');
    caja.id = 'arMirror';
    caja.className = 'fixed inset-0 z-[88] hidden bg-black';
    caja.innerHTML = `
      <video id="arMirrorVideo" playsinline autoplay muted
             class="absolute inset-0 w-full h-full object-cover"
             style="transform: scaleX(-1);"></video>
      <canvas id="arMirrorCanvas" class="absolute inset-0 w-full h-full pointer-events-none"></canvas>

      <div class="absolute top-0 left-0 right-0 flex items-start gap-3 px-4 pt-4 pb-8"
           style="background:linear-gradient(to bottom,rgba(10,6,14,.72),transparent);">
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-extrabold uppercase tracking-widest text-[#ff8ab5]">Probador en vivo</p>
          <p id="arMirrorTitle" class="font-extrabold text-white truncate"></p>
          <p id="arMirrorEstado" class="text-[11px] text-white/70">Preparando la cámara…</p>
        </div>
        <button id="arMirrorClose" class="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center shrink-0"
                aria-label="Cerrar el probador en vivo">
          <span class="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      <div class="absolute left-0 right-0 bottom-0 px-4 pb-5 pt-8 flex flex-col gap-2.5"
           style="background:linear-gradient(to top,rgba(10,6,14,.8),transparent);">
        <label class="flex items-center gap-2 text-[11px] font-bold text-white/80">
          <span class="w-16 shrink-0">Tamaño</span>
          <input id="arMirrorSize" type="range" min="60" max="180" value="100" class="flex-1 accent-[#e4006c]"/>
        </label>
        <label class="flex items-center gap-2 text-[11px] font-bold text-white/80">
          <span class="w-16 shrink-0">Altura</span>
          <input id="arMirrorY" type="range" min="-40" max="40" value="0" class="flex-1 accent-[#e4006c]"/>
        </label>
        <div class="flex gap-2 mt-1">
          <button id="arMirrorShot" class="flex-1 rounded-xl bg-[#e4006c] hover:bg-[#ff2d86] text-white text-sm font-extrabold py-3 flex items-center justify-center gap-1.5">
            <span class="material-symbols-outlined text-base">photo_camera</span>Capturar
          </button>
          <button id="arMirrorFlip" class="rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-white text-sm font-bold px-3 py-3 flex items-center justify-center gap-1.5"
                  aria-label="Cambiar de cámara">
            <span class="material-symbols-outlined text-base">cameraswitch</span>
          </button>
        </div>
        <p class="text-[10px] text-white/45 leading-snug">La cámara no se graba ni se envía: todo se queda en tu dispositivo.</p>
      </div>`;
    document.body.appendChild(caja);
    return caja;
  }

  /* ---------- Carga de la foto de la prenda ---------- */
  function cargarImagen(url) {
    return new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /* ---------- Pose ---------- */
  async function crearDetector() {
    const vision = await import(MP_BUNDLE);
    const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
    return vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MP_MODELO, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.55,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
    });
  }

  /* ---------- Dibujo ---------- */
  function punto(lm, i, W, H) {
    const p = lm && lm[i];
    return p ? { x: (estado.espejo ? 1 - p.x : p.x) * W, y: p.y * H } : null;
  }

  function pintar(video, lienzo) {
    const ctx = lienzo.getContext('2d');
    const W = lienzo.width;
    const H = lienzo.height;
    ctx.clearRect(0, 0, W, H);
    const img = estado.img;
    if (!img || !img.naturalWidth) return;

    const lm = estado.pose;
    const regla = anclaje(estado.prod && estado.prod.category);
    const base = { x: W / 2, y: H * 0.45, ancho: W * 0.42, ang: 0 };

    if (lm) {
      const hi = regla.punto === 'cadera' ? 23 : 11;
      const hd = regla.punto === 'cadera' ? 24 : 12;
      const a = punto(lm, hi, W, H);
      const b = punto(lm, hd, W, H);
      if (a && b) {
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        base.x = (a.x + b.x) / 2;
        base.y = (a.y + b.y) / 2;
        base.ancho = Math.max(dist * regla.factor, W * 0.14);
        base.ang = Math.atan2(b.y - a.y, b.x - a.x);
        if (regla.punto === 'hombro') base.y += dist * 0.35;
        if (regla.punto === 'cadera') base.y += dist * 0.1;
        if (regla.punto === 'tobillo') base.y = H * 0.82;
        if (regla.punto === 'cabeza') base.y = H * 0.2;
      }
    }

    const ancho = base.ancho * estado.ajuste;
    const alto = ancho * (img.naturalHeight / img.naturalWidth);
    ctx.save();
    ctx.translate(base.x, base.y + estado.desplazamiento * H);
    ctx.rotate(base.ang);
    ctx.globalAlpha = 0.94;
    ctx.drawImage(img, -ancho / 2, -alto / 2, ancho, alto);
    ctx.restore();
  }

  /* ---------- Bucle ---------- */
  function bucle(video, lienzo, detector) {
    let ultima = 0;
    const paso = () => {
      if (!estado.abierto) return;
      estado.raf = requestAnimationFrame(paso);
      if (video.readyState < 2) return;
      const ahora = performance.now();
      if (detector && ahora - ultima > 66) {   // ~15 Hz, suficiente y barato
        ultima = ahora;
        try {
          const res = detector.detectForVideo(video, ahora);
          estado.pose = res && res.landmarks && res.landmarks[0] ? res.landmarks[0] : null;
          if (estado.pose) fijarEstado('Coloca la prenda con los controles', false);
        } catch (_) { /* fotograma perdido: se reintenta */ }
      }
      pintar(video, lienzo);
    };
    paso();
  }

  function fijarEstado(txt, visible) {
    const el = $('arMirrorEstado');
    if (!el) return;
    el.textContent = txt;
    el.style.opacity = visible === false ? '0' : '1';
  }

  /* ---------- Abrir / cerrar ---------- */
  /** La cámara no está: se vuelve al probador con IA, que sí funciona sin ella. */
  function caerAlProbador(prod, txt) {
    if (VM.toast) VM.toast(txt, 'photo_camera_front');
    const S = window.VRStore;
    if (S && S.openTryOn && prod && prod.sku) {
      try { S.openTryOn(prod, 'foto'); } catch (_) { /* la tienda sigue usable */ }
    }
  }

  async function abrir(prod) {
    if (estado.abierto) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      caerAlProbador(prod, 'Este navegador no puede usar la cámara: prueba con una foto');
      return;
    }
    const caja = montar();
    estado.prod = prod || {};
    estado.pose = null;
    estado.ajuste = 1;
    estado.desplazamiento = 0;
    estado.espejo = true;
    estado.abierto = true;
    caja.classList.remove('hidden');
    $('arMirrorTitle').textContent = estado.prod.name || 'Probador en vivo';
    $('arMirrorSize').value = '100';
    $('arMirrorY').value = '0';

    const video = $('arMirrorVideo');
    const lienzo = $('arMirrorCanvas');

    try {
      estado.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      });
    } catch (err) {
      cerrar();
      // Nunca dejar al usuario en un callejón sin salida: si la cámara falla
      // (permiso denegado, http sin contexto seguro, sin dispositivo), el
      // probador IA con foto sigue disponible en la misma tarjeta.
      caerAlProbador(
        estado.prod,
        err && err.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado: prueba con una foto'
          : 'No se pudo abrir la cámara (hace falta https): prueba con una foto',
      );
      return;
    }
    video.srcObject = estado.stream;
    try { await video.play(); } catch (_) {}

    function ajustarLienzo() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      lienzo.width = Math.round(lienzo.clientWidth * dpr);
      lienzo.height = Math.round(lienzo.clientHeight * dpr);
    }
    ajustarLienzo();
    window.addEventListener('resize', ajustarLienzo);

    estado.img = await cargarImagen(estado.prod.image);
    if (!estado.img) fijarEstado('Esta prenda no tiene foto para superponer');

    fijarEstado('Buscando tu postura…');
    let detector = null;
    try {
      detector = await crearDetector();
    } catch (err) {
      console.warn('[AR espejo] sin detección de pose:', err && err.message);
      fijarEstado('Sin detección de postura: usa los controles para colocarla');
    }

    $('arMirrorSize').oninput = (e) => { estado.ajuste = Number(e.target.value) / 100; };
    $('arMirrorY').oninput = (e) => { estado.desplazamiento = Number(e.target.value) / 100; };
    $('arMirrorFlip').onclick = async () => {
      if (!estado.stream) return;
      estado.espejo = !estado.espejo;
      video.style.transform = estado.espejo ? 'scaleX(-1)' : 'none';
      const track = estado.stream.getVideoTracks()[0];
      const modo = track && track.getSettings ? track.getSettings().facingMode : 'user';
      estado.stream.getTracks().forEach((t) => t.stop());
      try {
        estado.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: modo === 'user' ? 'environment' : 'user' }, audio: false,
        });
        video.srcObject = estado.stream;
        await video.play();
      } catch (_) { /* si falla, se queda la cámara anterior apagada */ }
    };
    $('arMirrorClose').onclick = cerrar;
    $('arMirrorShot').onclick = () => capturar(video, lienzo);

    VRAR.evento('ar_tryon_live', { sku: estado.prod.sku || '', modo: 'espejo' });
    bucle(video, lienzo, detector);

    caja.dataset.resize = '1';
    estado.ajustarLienzo = ajustarLienzo;
  }

  function cerrar() {
    const caja = $('arMirror');
    estado.abierto = false;
    cancelAnimationFrame(estado.raf);
    if (estado.stream) {
      estado.stream.getTracks().forEach((t) => t.stop());
      estado.stream = null;
    }
    const video = $('arMirrorVideo');
    if (video) video.srcObject = null;
    if (estado.ajustarLienzo) window.removeEventListener('resize', estado.ajustarLienzo);
    if (caja) caja.classList.add('hidden');
  }

  /* ---------- Captura ---------- */
  async function capturar(video, lienzo) {
    if (!video || video.readyState < 2) return;
    const W = video.videoWidth || 720;
    const H = video.videoHeight || 960;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');
    ctx.save();
    if (estado.espejo) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();
    ctx.drawImage(lienzo, 0, 0, W, H);

    const nombre = `vivamoda-ar-${(estado.prod && estado.prod.sku) || 'look'}.png`;
    try {
      const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
      if (!blob) throw new Error('sin imagen');
      const archivo = new File([blob], nombre, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        try {
          await navigator.share({ files: [archivo], title: 'Mi look en VivaModa' });
          VRAR.evento('ar_share', { sku: estado.prod.sku || '' });
          return;
        } catch (_) { /* el usuario canceló: se descarga igual */ }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      VRAR.evento('ar_capture', { sku: estado.prod.sku || '' });
      if (VM.toast) VM.toast('Captura guardada', 'download');
    } catch (err) {
      console.warn('[AR espejo] captura', err);
      if (VM.toast) VM.toast('No se pudo guardar la captura', 'error');
    }
  }

  VRAR.espejo = { abrir, cerrar, get abierto() { return estado.abierto; } };
})();
