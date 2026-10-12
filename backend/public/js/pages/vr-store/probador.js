/* ============================================================
   PROBADOR VIRTUAL CON IA DENTRO DE LA TIENDA VR
   ------------------------------------------------------------
   Espejo interactivo en la escena: al tocarlo (o al pulsar
   "Probar con IA" en la tarjeta del producto) se sube una foto y
   la IA genera una vista previa de cómo queda la prenda elegida.

   - El resultado se pinta EN el espejo 3D (textura del panel) y
     en la ventana del probador.
   - Motor: POST /api/ai/tryon (visión + FLUX.1-schnell). Sin
     credenciales de Cloudflare la API responde con un error
     legible que aquí se muestra tal cual.
   - La foto se comprime en el navegador y NO se almacena.
   ============================================================ */
(function () {
  'use strict';

  const S = window.VRStore;
  const VM = window.VM || {};
  const $ = (id) => document.getElementById(id);
  const MAX_CHARS = 580000; // la API rechaza data URLs por encima de ~600 KB

  let fotoDataUrl = null;
  let prenda = null;
  let espejoCanvas = null, espejoTex = null, espejoLed = null;

  const money = (n) => (VM.fmtUSD ? VM.fmtUSD(n) : '$' + Number(n || 0));
  const nota = (msg, icon) => { if (VM.toast) VM.toast(msg, icon || 'info'); };
  const ponerMsg = (txt) => { const el = $('tryonMsg'); if (el) el.textContent = txt || ''; };

  function pintarPrenda() {
    const el = $('tryonGarment');
    if (!el) return;
    el.textContent = prenda
      ? `Prenda elegida: ${prenda.name} · ${prenda.category} · ${money(prenda.price)}`
      : 'Primero toca una prenda en la tienda y vuelve a tocar el espejo.';
  }

  // ── Espejo de la escena ─────────────────────────────────
  function dibujarEstado(texto) {
    if (!espejoCanvas || !espejoTex) return;
    const x = espejoCanvas.getContext('2d');
    const W = espejoCanvas.width, H = espejoCanvas.height;
    const grd = x.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#3d3a45');
    grd.addColorStop(0.45, '#17151c');
    grd.addColorStop(1, '#2a2530');
    x.fillStyle = grd; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(255,255,255,0.08)';
    x.fillRect(W * 0.28, 0, W * 0.055, H);
    x.fillStyle = 'rgba(255,255,255,0.05)';
    x.fillRect(W * 0.66, 0, W * 0.03, H);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '700 120px "Plus Jakarta Sans", Arial, sans-serif';
    x.fillText('🪞', W / 2, H * 0.40);
    x.fillStyle = '#ff8ab5';
    x.font = '700 34px "Plus Jakarta Sans", Arial, sans-serif';
    x.fillText(texto, W / 2, H * 0.56);
    x.fillStyle = 'rgba(255,255,255,0.65)';
    x.font = '600 22px "Plus Jakarta Sans", Arial, sans-serif';
    x.fillText('Probador con IA', W / 2, H * 0.64);
    espejoTex.needsUpdate = true;
  }

  function pintarEnEspejo(dataUrl, pie) {
    if (!espejoCanvas || !espejoTex) return;
    const img = new Image();
    img.onload = () => {
      const x = espejoCanvas.getContext('2d');
      const W = espejoCanvas.width, H = espejoCanvas.height;
      x.fillStyle = '#0d0912'; x.fillRect(0, 0, W, H);
      // encajar la vista previa en el panel (contain)
      const k = Math.min(W / img.width, H / img.height);
      const w = img.width * k, h = img.height * k;
      x.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      x.fillStyle = 'rgba(20,12,22,0.78)';
      x.fillRect(0, H - 64, W, 64);
      x.fillStyle = '#ff8ab5';
      x.font = '700 26px "Plus Jakarta Sans", Arial, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(pie || ('Vista previa IA · ' + (prenda ? prenda.name.slice(0, 30) : '')), W / 2, H - 32);
      espejoTex.needsUpdate = true;
    };
    img.src = dataUrl;
  }

  S.part('probador', function (S, g) {
    S.scene.add(g); // el grupo puede recibir contenido después del build inicial

    function construir() {
      const MK = S.MK || { cx: 36.9, cz: -6.2, floorY: 0.30 };
      const nav = S.mkNav;
      let px = MK.cx, pz = -2.0; // junto a la entrada, mirando hacia ella
      if (nav && nav.ready && nav.freeSpots) {
        const spot = nav.freeSpots(px, pz, 1.15)[0];
        if (spot) { px = spot.x; pz = spot.z; }
      }
      const FY = MK.floorY ?? 0.30;

      // marco dorado
      const marco = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 2.25, 0.09),
        S.mat(0xd4af37, { metalness: 0.7, roughness: 0.3 }),
      );
      marco.position.y = 1.42;
      marco.castShadow = true;
      g.add(marco);

      // panel: espejo/pantalla donde se pinta el estado y el resultado IA
      espejoCanvas = document.createElement('canvas');
      espejoCanvas.width = 512; espejoCanvas.height = 768;
      espejoTex = new THREE.CanvasTexture(espejoCanvas);
      espejoTex.encoding = THREE.sRGBEncoding;
      dibujarEstado('Tócame y pruébate');
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(1.32, 2.07),
        new THREE.MeshStandardMaterial({
          map: espejoTex, metalness: 0.35, roughness: 0.25,
          emissive: 0x14101a, emissiveIntensity: 0.35,
        }),
      );
      panel.position.set(0, 1.42, 0.048);
      panel.userData.tryon = true;      // interaccion.js lo detecta al hacer clic
      panel.userData.ringScale = 1.1;
      S.addClickable(panel);
      g.add(panel);

      // tira led superior
      espejoLed = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 0.06, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xfff6e8, emissive: 0xfff2d9, emissiveIntensity: 1.1 }),
      );
      espejoLed.position.set(0, 2.57, 0.02);
      g.add(espejoLed);

      // pie
      const pie = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.52, 0.3, 20),
        S.mat(0x2a2a30, { metalness: 0.4, roughness: 0.5 }),
      );
      pie.position.y = 0.15;
      g.add(pie);

      // letrero flotante
      const letrero = S.textSprite('PROBADOR VIRTUAL IA', {
        bg: 'rgba(20,12,22,0.92)', border: 'rgba(75,65,225,0.9)', size: 38, scale: [2.6, 0.62, 1],
      });
      letrero.position.set(0, 2.95, 0);
      g.add(letrero);

      // foco suave
      const foco = new THREE.PointLight(0xff8ab5, 0.7, 5, 2);
      foco.position.set(0, 2.2, 0.8);
      g.add(foco);

      g.position.set(px, FY, pz);
      g.rotation.y = 0; // mira hacia la entrada (+Z)

      // sólido: el avatar no lo atraviesa
      if (nav && nav.ready) {
        nav.blockers.push({ x1: px - 0.78, x2: px + 0.78, z1: pz - 0.25, z2: pz + 0.25 });
      }

      S.addAnimate((dt, t) => {
        if (espejoLed) espejoLed.material.emissiveIntensity = 0.9 + 0.25 * Math.sin(t * 2.1);
      });
    }

    if (S.mkNav && S.mkNav.ready) construir();
    else window.addEventListener('mk:zones', construir, { once: true });
  });

  // ── Ventana del probador ────────────────────────────────
  function abrir(prod, modo) {
    if (prod) prenda = prod;
    pintarPrenda();
    setTab(modo === 'foto' ? 'foto' : 'avatar');
    pintarEstadoAvatar();
    $('tryonModal')?.classList.remove('hidden');
    if (!prenda) nota('Elige una prenda y vuelve a tocar el espejo del probador', 'info');
  }

  // ── Pestañas: probar en el avatar o con foto (IA) ───────
  function setTab(cual) {
    const avatar = cual !== 'foto';
    $('tryonTabAvatar')?.classList.toggle('active', avatar);
    $('tryonTabPhoto')?.classList.toggle('active', !avatar);
    $('tryonAvatarPane')?.classList.toggle('hidden', !avatar);
    $('tryonPhotoPane')?.classList.toggle('hidden', avatar);
  }

  function pintarEstadoAvatar() {
    const el = $('tryonAvatarMsg');
    const puesto = S.currentGarment ? S.currentGarment() : null;
    if (el) el.textContent = puesto
      ? `Llevas puesta: ${puesto.name}`
      : 'Tu avatar aún no lleva ninguna prenda de la tienda.';
    const quitar = $('tryonRemove');
    if (quitar) quitar.disabled = !puesto;
  }

  // Instantánea del avatar vestido → al espejo de la escena
  function refrescarEspejo() {
    if (!S.avatarSnapshot) return false;
    const url = S.avatarSnapshot(512, 768);
    if (!url) { nota('El avatar aún se está cargando', 'info'); return false; }
    const puesto = S.currentGarment ? S.currentGarment() : null;
    pintarEnEspejo(url, 'Tu look · ' + (puesto ? puesto.name.slice(0, 30) : ''));
    return true;
  }
  S.refrescarEspejoAvatar = refrescarEspejo;

  function cerrar() {
    $('tryonModal')?.classList.add('hidden');
  }

  function setCargando(on) {
    const l = $('tryonLoading');
    if (l) l.classList.toggle('hidden', !on);
    const go = $('tryonGo');
    if (go) go.disabled = Boolean(on) || !fotoDataUrl;
  }

  // Foto → JPEG razonable (el backend acepta data URLs de hasta ~450 KB)
  function fotoAJPEG(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('No pude leer la foto'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Formato de imagen no soportado'));
        img.onload = () => {
          const max = 960;
          const esc = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * esc));
          c.height = Math.max(1, Math.round(img.height * esc));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          let q = 0.86, out = c.toDataURL('image/jpeg', q);
          while (out.length > MAX_CHARS && q > 0.35) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
          if (out.length > MAX_CHARS) return reject(new Error('La foto sigue siendo muy grande; prueba con otra'));
          resolve(out);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function mostrarResultado(dataUrl) {
    const wrap = $('tryonResultWrap'), img = $('tryonResult');
    if (img) img.src = dataUrl;
    if (wrap) wrap.classList.remove('hidden');
    pintarEnEspejo(dataUrl);
  }

  async function generar() {
    if (!prenda) {
      ponerMsg('Elige una prenda en la tienda antes de probártela.');
      nota('Primero toca una prenda en la tienda', 'info');
      return;
    }
    if (!fotoDataUrl) {
      ponerMsg('Sube una foto tuya para la vista previa.');
      return;
    }
    setCargando(true); ponerMsg('');
    try {
      const res = await VM.api('/ai/tryon', {
        method: 'POST',
        body: {
          image: fotoDataUrl,
          garment: {
            name: prenda.name,
            category: prenda.category,
            description: [prenda.color ? `Color ${prenda.color}` : '', prenda.badge || ''].filter(Boolean).join(' · ').slice(0, 200),
          },
        },
      });
      if (!res || !res.ok || !res.image) throw new Error((res && res.error) || 'La IA no pudo generar la vista previa');
      mostrarResultado(res.image);
      ponerMsg(`Listo en ${((res.latencyMs || 0) / 1000).toFixed(1)} s · motor ${res.engine || 'FLUX.1-schnell'}`);
      nota('Vista previa generada: mírate en el espejo 🪞', 'check_circle');
    } catch (err) {
      ponerMsg('⚠️ ' + (err.message || 'No se pudo generar la vista previa'));
      nota(err.message || 'Error del probador', 'error');
    } finally {
      setCargando(false);
    }
  }

  async function onFoto(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { nota('Selecciona una imagen', 'error'); return; }
    try {
      fotoDataUrl = await fotoAJPEG(file);
      const thumb = $('tryonThumb');
      if (thumb) thumb.src = fotoDataUrl;
      $('tryonThumbWrap')?.classList.remove('hidden');
      const go = $('tryonGo');
      if (go) go.disabled = false;
      ponerMsg('Foto lista. Pulsa «Generar vista previa».');
    } catch (err) {
      ponerMsg('⚠️ ' + err.message);
      nota(err.message, 'error');
    }
  }

  function wire() {
    $('tryonClose')?.addEventListener('click', cerrar);
    document.querySelectorAll('[data-tryon-close]').forEach((el) => el.addEventListener('click', cerrar));
    $('tryonTabAvatar')?.addEventListener('click', () => setTab('avatar'));
    $('tryonTabPhoto')?.addEventListener('click', () => setTab('foto'));
    $('tryonPick')?.addEventListener('click', () => $('tryonFile')?.click());
    $('tryonFile')?.addEventListener('change', onFoto);
    $('tryonGo')?.addEventListener('click', generar);

    // Modo avatar: ponerse / quitar la prenda y refrescar el espejo
    $('tryonWear')?.addEventListener('click', () => {
      if (!prenda) { nota('Elige una prenda en la tienda primero', 'info'); return; }
      if (!S.wearGarment || !S.wearGarment(prenda)) { nota('El avatar aún se está cargando', 'info'); return; }
      pintarEstadoAvatar();
      $('tryonAvatarMsg').textContent = `Llevas puesta: ${prenda.name}. Pasea en modo Avatar y mírate en el espejo.`;
      refrescarEspejo();
      nota(`${prenda.name} puesta en tu avatar`, 'check_circle');
    });
    $('tryonRemove')?.addEventListener('click', () => {
      if (S.removeGarment) S.removeGarment();
      pintarEstadoAvatar();
      nota('Prenda retirada del avatar', 'info');
    });
    $('tryonMirror')?.addEventListener('click', () => {
      if (refrescarEspejo()) nota('Espejo actualizado', 'check_circle');
    });
    document.addEventListener('keydown', (e) => {
      const modal = $('tryonModal');
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) cerrar();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();

  // Interaccion.js llama a S.openTryOn desde el espejo o desde la tarjeta
  S.openTryOn = abrir;
})();
