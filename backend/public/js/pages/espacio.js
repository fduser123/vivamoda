/* ============================================================
   VivaModa · "Ver en tu espacio" (AR con model-viewer)
   Wiring inyectado por el servidor sobre el mockup intacto.
   - Grid de SKUs reales (GET /api/products/:sku) mapeados a .glb
   - Visor <model-viewer> con giro, escala, reset y QR
   - Botón AR nativo (WebXR / Scene Viewer / Quick Look en móvil)
   ============================================================ */
(function () {
  'use strict';

  const api = window.VM.api, esc = window.VM.esc, fmtUSD = window.VM.fmtUSD;

  // SKU real de la BD ↔ modelo .glb (assets con licencia CC)
  const HERO = [
    { sku: 'VM-DAM-SH36041801', model: '/models/gafas-sol.glb',        scale: 2.0, emoji: '🕶️' },
    { sku: 'VM-DAM-SH41122801', model: '/models/bolso.glb',            scale: 2.4, emoji: '👜' },
    { sku: 'VM-DAM-SH39598728', model: '/models/sneaker-realista.glb', scale: 3.0, emoji: '👟' },
    { sku: 'VM-CAB-8850',       model: '/models/camiseta.glb',         scale: 1.6, emoji: '👕' },
    { sku: 'VM-DAM-SH39598728', model: '/models/zapatos.glb',          scale: 3.0, emoji: '👟' },
  ];

  const $ = (id) => document.getElementById(id);
  const mv = $('vm-ar-model');
  if (!mv) return;

  const state = { current: null, scale: 1 };

  /* ---------- Carga de productos reales ---------- */
  async function loadHero() {
    const grid = $('vm-ar-grid');
    grid.innerHTML = '';
    const results = await Promise.all(HERO.map(async (h, i) => {
      try {
        const { product } = await api(`/products/${encodeURIComponent(h.sku)}`);
        return { ...h, product, idx: i };
      } catch (e) {
        console.warn('[ar] producto no disponible', h.sku, e.message);
        return null;
      }
    }));
    const items = results.filter(Boolean);
    if (!items.length) {
      grid.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8 text-sm">No hay modelos 3D disponibles ahora mismo.</div>';
      return;
    }
    for (const it of items) {
      const p = it.product;
      const el = document.createElement('button');
      el.className = 'text-left bg-white rounded-2xl shadow hover:shadow-md transition p-3 border border-transparent hover:border-[#b60055]/30 focus:outline-none';
      el.dataset.idx = String(it.idx);
      el.innerHTML = `
        <div class="w-full aspect-square rounded-xl overflow-hidden bg-[#f6f2f5] mb-2">
          <img src="${esc(p.image || '')}" alt="${esc(p.name)}" class="w-full h-full object-cover" loading="lazy"
               onerror="this.style.opacity='0.25'"/>
        </div>
        <div class="text-sm font-bold leading-tight line-clamp-2">${esc(p.name)}</div>
        <div class="text-xs text-gray-500 mt-0.5">${esc(p.category)} · <b>${fmtUSD(p.price)}</b></div>
        <div class="text-[10px] text-gray-400 mt-1">${it.emoji} modelo 3D${p.stockTotal > 0 ? ' · ✅ stock' : ''}</div>`;
      el.addEventListener('click', () => select(it));
      grid.appendChild(el);
    }
    // QR de etiqueta: ?sku=XXX aterriza directo en ese producto
    const fromQr = new URLSearchParams(location.search).get('sku');
    const pre = fromQr ? items.find((i) => i.sku === fromQr) : null;
    if (fromQr && pre) toast(`📱 Producto escaneado: ${pre.product.name}`, 'qr_code_scanner');
    select(pre || items[0]); // preselección (producto del QR si viene)
  }

  /* ---------- Selección de producto → carga del modelo ---------- */
  function select(it) {
    state.current = it;
    const p = it.product;
    mv.src = it.model;
    mv.alt = `${p.name} · VivaModa 3D`;
    mv.cameraOrbit = '25deg 75deg auto';
    state.scale = 1;
    const slider = $('vm-ar-scale');
    if (slider) slider.value = '100';
    applyScale(mv);

    // marcar tarjeta activa
    document.querySelectorAll('#vm-ar-grid [data-idx]').forEach((b) => {
      b.classList.toggle('card-sel', String(b.dataset.idx) === String(it.idx));
    });

    // panel de información
    $('vm-ar-info').innerHTML = `
      <div class="flex items-start gap-4">
        <img src="${esc(p.image || '')}" alt="" class="w-16 h-16 rounded-xl object-cover bg-[#f6f2f5]"
             onerror="this.style.opacity='0.25'"/>
        <div class="min-w-0 flex-1">
          <div class="font-extrabold text-lg leading-tight">${esc(p.name)}</div>
          <div class="text-sm text-gray-500">${esc(p.category)} · <b class="text-[#b60055]">${fmtUSD(p.price)}</b>
            ${p.rating ? ` · ⭐ ${p.rating}` : ''}
            ${p.stockTotal > 0 ? ' · ✅ disponible' : ' · ⚠️ sin stock (el AR sigue disponible)'}
          </div>
        </div>
        <a href="/detalle-de-producto?sku=${encodeURIComponent(p.sku)}"
           class="shrink-0 self-center text-sm font-bold ar-chip text-white rounded-xl px-4 py-2.5">Ver ficha →</a>
      </div>`;
    $('vm-ar-error').classList.add('hidden');
    if (typeof stylistPresent === 'function') stylistPresent(p); // Viva presenta la prenda
  }

  /* ---------- Escala (CSS sobre el canvas del visor) ---------- */
  function applyScale(viewer) {
    const canvas = viewer.shadowRoot && viewer.shadowRoot.querySelector('canvas');
    if (canvas) canvas.style.transform = `scale(${state.scale})`;
  }

  /* ---------- Toolbar ---------- */
  $('vm-ar-rotate').addEventListener('click', () => {
    mv.autoRotate = !mv.autoRotate;
    $('vm-ar-rotate').textContent = mv.autoRotate ? '⏸️ Pausar giro' : '▶️ Girar';
  });
  $('vm-ar-reset').addEventListener('click', () => {
    mv.cameraOrbit = '25deg 75deg auto';
    mv.fieldOfView = 'auto';
  });
  $('vm-ar-qr-btn').addEventListener('click', () => {
    const panel = $('vm-ar-qr-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) buildQR();
  });
  $('vm-ar-qr-close').addEventListener('click', () => $('vm-ar-qr-panel').classList.add('hidden'));

  $('vm-ar-scale').addEventListener('input', (e) => {
    state.scale = Number(e.target.value) / 100; // 0.4 .. 2.6
    applyScale(mv);
  });

  /* ---------- QR con la URL de esta página ---------- */
  function ensureQrLib(cb) {
    if (window.QRCode) return cb();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs@master/qrcode.min.js';
    s.onload = cb;
    s.onerror = () => { const h = $('vm-ar-qr'); if (h) h.textContent = 'QR no disponible (sin conexión al CDN)'; };
    document.head.appendChild(s);
  }
  function buildQR() {
    const host = $('vm-ar-qr');
    if (!host || host.dataset.url === location.href) return;
    ensureQrLib(() => {
      host.dataset.url = location.href;
      host.innerHTML = '';
      try {
        new window.QRCode(host, { text: location.href, width: 160, height: 160 });
        $('vm-ar-qr-url').textContent = location.href;
      } catch (e) {
        host.textContent = 'QR no disponible';
        console.warn('[ar] QRCode', e);
      }
    });
  }

  /* ---------- Progreso de carga del modelo ---------- */
  mv.addEventListener('progress', (e) => {
    const bar = $('vm-ar-bar');
    if (bar) bar.style.width = `${Math.round((e.detail.totalProgress || 0) * 100)}%`;
  });
  mv.addEventListener('error', (e) => {
    const box = $('vm-ar-error');
    if (box) {
      box.textContent = 'No se pudo cargar el modelo 3D (' + ((e.detail && e.detail.type) || 'error') + '). Verifica tu conexión: los visores descargan la librería desde CDN.';
      box.classList.remove('hidden');
    }
  });

  /* ============================================================
     VIVA · Asesora virtual 3D (personaje que explica la prenda)
     - Figura procedural three.js (sin assets externos), gestos al hablar
     - Guiones dinámicos con los datos REALES del producto (details):
       composición/tela, cuidado/lavado, calce, envíos y descripción
     - Voz en español (speechSynthesis) con botón de silencio
     ============================================================ */
  const Viva = (() => {
    const canvas = $('vm-ar-stylist-canvas');
    if (!canvas) return { present() {} };

    let renderer = null, scene, camera, viva, armL, armR, head, torso, group;
    let speaking = false, waveUntil = 0, ready = false;
    let muted = false;
    try { muted = localStorage.getItem('vm_ar_viva_mute') === '1'; } catch (_) {}

    /* ---------- Voz ---------- */
    const synth = window.speechSynthesis || null;
    let voiceES = null;
    function pickVoice() {
      if (!synth) return;
      const vs = synth.getVoices() || [];
      voiceES = vs.find((v) => /^es/i.test(v.lang) && /google/i.test(v.name))
        || vs.find((v) => /^es[-_]/i.test(v.lang) && /female|mónica|monica|sabina|paulina|helena/i.test(v.name))
        || vs.find((v) => /^es/i.test(v.lang)) || null;
    }
    if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
    function speak(text) {
      if (!synth || muted) return setSpeaking(true, 2600);
      synth.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ''));
      u.lang = 'es-ES'; u.rate = 1.05; u.pitch = 1.12;
      if (voiceES) u.voice = voiceES;
      u.onstart = () => setSpeaking(true);
      u.onend = u.onerror = () => setSpeaking(false);
      synth.speak(u);
    }
    function setSpeaking(on, ms) {
      speaking = on;
      const st = $('vm-ar-stylist-state');
      if (st) st.textContent = on ? '🗣️ hablando…' : 'lista';
      if (on && ms) setTimeout(() => { if (!synth || synth.speaking === false) setSpeaking(false); }, ms);
    }

    /* ---------- three.js diferido (el AR no lo trae) ---------- */
    function ensureThree(cb) {
      if (window.THREE) return cb();
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      s.onload = cb;
      s.onerror = () => { const b = $('vm-ar-stylist-bubble'); if (b) b.textContent = 'No pude mostrarme en 3D (sin conexión al CDN), pero sigo aquí para ayudarte 💜'; };
      document.head.appendChild(s);
    }

    function buildScene() {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      const w = canvas.clientWidth || 176, h = canvas.clientHeight || 208;
      renderer.setSize(w, h, false);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 20);
      camera.position.set(0, 1.12, 2.65);
      camera.lookAt(0, 0.92, 0);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f85, 0.95));
      const key = new THREE.DirectionalLight(0xfff1e0, 0.9);
      key.position.set(1.6, 2.4, 2.2); scene.add(key);
      const rim = new THREE.DirectionalLight(0xe4006c, 0.35);
      rim.position.set(-2, 1.6, -1.5); scene.add(rim); // contraluz rosa de marca

      group = new THREE.Group();
      const matC = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.65, metalness: 0.05 }, o));
      // torso (blazer VivaModa)
      torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.52, 14), matC(0xe4006c));
      torso.position.y = 0.62; group.add(torso);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 18), matC(0xb60055));
      collar.rotation.x = Math.PI / 2; collar.position.y = 0.87; group.add(collar);
      // cabeza + cabello + visor
      head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 20, 16), matC(0xf1d4b8));
      head.position.y = 1.06; group.add(head);
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), matC(0x2a1b2b, { roughness: 0.85 }));
      hair.position.set(0, 1.09, -0.015); head.add(hair);
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), matC(0x2a1b2b));
      bun.position.set(0, 0.13, -0.11); head.add(bun);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.05, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x4b41e1, emissive: 0x4b41e1, emissiveIntensity: 0.7 }));
      visor.position.set(0, 0.02, 0.135); head.add(visor);
      // piernas
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.5, 12), matC(0x2a2f3a));
      legs.position.y = 0.25; group.add(legs);
      // brazos con pivote (para gestos)
      const mkArm = (side) => {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.21, 0.84, 0);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.46, 10), matC(0xe4006c));
        arm.position.y = -0.23; arm.castShadow = false; pivot.add(arm);
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), matC(0xf1d4b8));
        hand.position.y = -0.47; pivot.add(hand);
        group.add(pivot);
        return pivot;
      };
      armL = mkArm(-1); armR = mkArm(1);

      // pedestal suave
      const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.03, 26), matC(0xd9cdd9));
      disk.position.y = 0.015; group.add(disk);

      scene.add(group);
      ready = true;
      requestAnimationFrame(tick);
    }

    /* ---------- Animación: idle + habla + saludo ---------- */
    let t0 = performance.now();
    function tick() {
      if (!renderer) return;
      requestAnimationFrame(tick);
      const t = (performance.now() - t0) / 1000;
      const talk = speaking;
      // idle/bob: respira más rápido al hablar
      group.position.y = Math.sin(t * (talk ? 5.2 : 1.7)) * (talk ? 0.016 : 0.008);
      torso.scale.y = 1 + Math.sin(t * (talk ? 6.4 : 2.1)) * (talk ? 0.035 : 0.012);
      // mirada viva
      head.rotation.y = Math.sin(t * 0.6) * 0.14;
      head.rotation.x = talk ? Math.sin(t * 7.3) * 0.05 : Math.sin(t * 1.2) * 0.02;
      // brazos: gesticula al hablar; saludo al presentar
      const waving = performance.now() < waveUntil;
      armR.rotation.x = waving ? -2.2 + Math.sin(t * 9) * 0.35 : (talk ? -0.35 + Math.sin(t * 9.5) * 0.3 : -0.08 + Math.sin(t * 1.4) * 0.04);
      armR.rotation.z = waving ? 0.5 : (talk ? Math.sin(t * 7) * 0.12 : 0.06);
      armL.rotation.x = talk ? -0.3 + Math.sin(t * 8.2 + 1.7) * 0.26 : -0.08 + Math.sin(t * 1.4 + 2) * 0.04;
      armL.rotation.z = -armR.rotation.z * 0.6;
      renderer.render(scene, camera);
    }

    /* ---------- Burbuja con efecto máquina de escribir ---------- */
    let typeTimer = null;
    function bubble(text) {
      const el = $('vm-ar-stylist-bubble');
      if (!el) return;
      clearInterval(typeTimer);
      el.textContent = '';
      let i = 0;
      typeTimer = setInterval(() => {
        el.textContent = text.slice(0, ++i);
        if (i >= text.length) clearInterval(typeTimer);
      }, 13);
    }

    /* ---------- Guiones con datos REALES del producto ---------- */
    const DEFAULTS = {
      tela: 'Es una prenda premium de la colección VivaModa.',
      lavado: 'En la etiqueta encontrarás las instrucciones de cuidado.',
      calce: 'Calce estándar de la marca; si dudas entre dos tallas, elige la mayor.',
      envio: 'Envío express gratis en compras mayores a $49.99 y devoluciones sin costo durante 30 días.',
    };
    function scriptsFor(p) {
      const d = p.details || {};
      const comp = Array.isArray(d.composition) ? d.composition : [];
      const care = Array.isArray(d.care) ? d.care : [];
      const tela = comp.length
        ? `Está hecha en ${comp.map((c) => `${c.pct || ''} ${c.name || ''}`.trim()).join(' y ')}. ${comp[0].note || ''}`.trim()
        : DEFAULTS.tela;
      const lavado = care.length ? `Para que dure como nueva: ${care.join('; ')}.` : DEFAULTS.lavado;
      const calce = d.fitNote ? `Sobre el calce: ${d.fitNote}` : DEFAULTS.calce;
      const envio = d.logistics || DEFAULTS.envio;
      const detalle = p.description || `${p.category} de la colección VivaModa.`;
      return [
        { id: 'tela', emoji: '🧵', label: '¿De qué tela es?', say: tela, extra: comp.map((c) => `🧵 <b>${c.pct} ${esc(c.name)}</b> — ${esc(c.note || '')}`).join('<br>') || '' },
        { id: 'lavado', emoji: '🫧', label: 'Cómo lavarla', say: lavado, extra: care.map((c) => `🫧 ${esc(c)}`).join('<br>') || 'Revisa la etiqueta de la prenda.' },
        { id: 'calce', emoji: '📐', label: 'Calce y tallas', say: calce, extra: `📐 ${esc(d.fitNote || DEFAULTS.calce)}` },
        { id: 'envio', emoji: '🚚', label: 'Envíos y devoluciones', say: envio, extra: `🚚 ${esc(envio)}` },
        { id: 'detalle', emoji: '✨', label: 'Detalles', say: detalle, extra: `✨ ${esc(p.description || '')}<br>⭐ ${p.rating || '—'} (${p.reviewCount || 0} reseñas) · ${p.stockTotal > 0 ? '✅ ' + p.stockTotal + ' uds disponibles' : '⚠️ sin stock'}` },
      ];
    }

    let currentScripts = [];
    function renderChips() {
      const box = $('vm-ar-stylist-chips');
      if (!box) return;
      box.innerHTML = '';
      for (const s of currentScripts) {
        const b = document.createElement('button');
        b.className = 'text-xs font-semibold px-2.5 py-1.5 rounded-full bg-white border border-[#e6dae8] hover:border-[#b60055]/50 hover:bg-[#fdf2f7] transition';
        b.textContent = `${s.emoji} ${s.label}`;
        b.addEventListener('click', () => {
          bubble(s.say);
          $('vm-ar-stylist-extra').innerHTML = s.extra || '';
          speak(s.say);
        });
        box.appendChild(b);
      }
    }

    /* ---------- Presentación de producto ---------- */
    function present(p) {
      currentScripts = scriptsFor(p);
      renderChips();
      $('vm-ar-stylist-extra').innerHTML = '';
      const intro = `¡Hola! Soy Viva, tu asesora de VivaModa 💜 Hoy te presento ${p.name}, a ${fmtUSD(p.price)}. Pregúntame por la tela, el lavado o el calce.`;
      bubble(intro);
      speak(intro);
      waveUntil = performance.now() + 1500; // saluda con el brazo
    }

    /* ---------- Botón de voz ---------- */
    const muteBtn = $('vm-ar-stylist-mute');
    const syncMute = () => { muteBtn.textContent = muted ? '🔇' : '🔊'; muteBtn.title = muted ? 'Activar voz' : 'Silenciar voz'; };
    syncMute();
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      try { localStorage.setItem('vm_ar_viva_mute', muted ? '1' : '0'); } catch (_) {}
      if (muted && synth) synth.cancel();
      syncMute();
    });

    ensureThree(buildScene);
    return { present };
  })();

  function stylistPresent(p) { Viva.present(p); }

  loadHero().catch((e) => console.error('[ar] init', e));
})();
