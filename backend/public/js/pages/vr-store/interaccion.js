/* ============================================================
   INTERACCIÓN
   Anillo de selección, panel de foto flotante en la escena,
   tarjeta de producto, chips de zona, recorrido automático y
   pantalla completa. También: avatar del cliente + cuidado del producto.
   ============================================================ */
VRStore.part('interaccion', function (S, g) {
  const { scene, camera, controls, renderer } = S;
  const canvas = renderer.domElement;

  // ── Anillo de selección ──────────────────────────────────
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.42, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  scene.add(ring);
  S.ring = ring;

  // ── Panel de foto flotante (holo en la escena) ───────────
  const photoPanel = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, opacity: 0 }));
  photoPanel.scale.set(4, 5, 1);
  photoPanel.visible = false;
  photoPanel.position.set(0, 2.6, 9);
  scene.add(photoPanel);
  S.photoPanel = photoPanel;
  let panelShown = false, panelToken = 0;
  S.panelShown = false;

  function placeholderTexture(prod) {
    const c = document.createElement('canvas'); c.width = 480; c.height = 600;
    const x = c.getContext('2d');
    const col = '#' + prod.c3d.toString(16).padStart(6, '0');
    const grd = x.createLinearGradient(0, 0, 0, 600);
    grd.addColorStop(0, col); grd.addColorStop(0.6, '#3a1f3d'); grd.addColorStop(1, '#1c121f');
    x.fillStyle = grd; x.fillRect(0, 0, 480, 600);
    x.fillStyle = 'rgba(255,255,255,0.16)'; x.beginPath(); x.arc(240, 235, 130, 0, Math.PI * 2); x.fill();
    x.font = '120px serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(S.emojiFor(prod), 240, 235);
    x.fillStyle = 'rgba(255,255,255,0.94)'; x.font = '700 34px "Plus Jakarta Sans", Arial, sans-serif';
    x.fillText('Foto próximamente', 240, 500);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function hidePhoto() {
    panelShown = false; S.panelShown = false; panelToken++;
    photoPanel.visible = false;
    if (photoPanel.material.map) { photoPanel.material.map.dispose(); photoPanel.material.map = null; }
  }

  function showPhoto(prod) {
    hidePhoto();
    const token = panelToken;
    const apply = (tex, w, h) => {
      if (token !== panelToken) return;
      photoPanel.material.map = tex;
      photoPanel.material.needsUpdate = true;
      photoPanel.material.opacity = 1;
      photoPanel.scale.set(w, h, 1);
      photoPanel.visible = true;
      panelShown = true; S.panelShown = true;
    };
    if (!prod.image) { apply(placeholderTexture(prod), 3.8, 4.75); return; }
    new THREE.TextureLoader().load(prod.image, (tex) => {
      tex.encoding = THREE.sRGBEncoding;
      const a = tex.image && tex.image.height ? tex.image.width / tex.image.height : 0.8;
      apply(tex, 4.5 * a, 4.5);
    }, undefined, () => { apply(placeholderTexture(prod), 3.8, 4.75); });
  }
  S.showPhoto = showPhoto;
  S.hidePhoto = hidePhoto;

  // ── Picking (hover y clic) ───────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = null, dragStart = null;

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(S.clickables, false);
    return hits.length ? hits[0].object : null;
  }

  function setHover(m) {
    if (hovered === m) return;
    hovered = m;
    if (m) {
      ring.visible = true;
      const w = m.getWorldPosition(new THREE.Vector3());
      ring.position.set(w.x, 0.05, w.z);
      const s = m.userData.ringScale || 0.5;
      ring.scale.set(s, s, s);
      canvas.style.cursor = S.fps ? 'crosshair' : 'pointer';
    } else {
      ring.visible = false;
      canvas.style.cursor = S.fps ? 'default' : 'grab';
    }
  }

  // ── Modo FPS (primera persona) ────────────────────────────
  const FP_WALK_HEIGHT = 1.7;
  const FP_NAV = new THREE.Vector3();
  const FP_FORCE = new THREE.Vector3();
  let fpPathId = 0;
  const fpPath = [];

  // Exponer para el menú de modo
  window.VRStore.interaccionStartFPSession = startFPSession;
  window.VRStore.interaccionExitFPSession = exitFPSession;

  function startFPSession() {
    if (S.fps) return;
    S.fps = true;
    S.controls.enabled = false;
    document.getElementById('tourBtn').classList.remove('active');
    S.tour = false;
    const p = S.camera.position;
    p.y = FP_WALK_HEIGHT;
    S.controls.target.set(p.x, p.y, p.z);
    fpPath.length = 0;
    FP_FORCE.set(0, 0, 0);
    setCursorHelp(false);
  }

  function exitFPSession() {
    if (!S.fps) return;
    S.fps = false;
    S.controls.enabled = true;
    setCursorHelp(true);
    const p = S.camera.position;
    S.controls.target.set(p.x, Math.max(0.4, p.y - 2.2), p.z);
  }

  function setCursorHelp(orbit) {
    // no-op placeholder: la UI de ayuda se actualiza desde el menú de modo
  }

  // Snap view rápido hacia un producto (sin romper el modo FPS)
  function snapLookAt(prod) {
    if (!prod || !S.fps) return;
    const pos = new THREE.Vector3();
    if (prod.position) {
      pos.copy(prod.position);
    } else if (prod.getWorldPosition) {
      prod.getWorldPosition(pos);
    } else {
      return;
    }
    const origin = S.camera.position;
    const dir = pos.clone().sub(origin).normalize();
    // acercarse un poco para que el producto no quede chico
    const targetDist = 2.0;
    const snapPos = pos.clone().sub(dir.clone().multiplyScalar(targetDist));
    snapPos.y = FP_WALK_HEIGHT;
    S.camera.position.copy(snapPos);
    // mirar al producto
    const lookTarget = pos.clone();
    lookTarget.y = Math.max(lookTarget.y, 0.6);
    S.camera.lookAt(lookTarget);
  }

  // Movimiento por navmesh simple: acercarse a un punto hasta una distancia mínima
  function moveToPoint(target, opt = {}) {
    if (!S.fps) return;
    const from = S.camera.position.clone();
    const to = target.clone();
    to.y = FP_WALK_HEIGHT;
    const start = performance.now();
    const dur = opt.duration || 700;
    const dist0 = from.distanceTo(to);
    const minDist = opt.minDist || 0.0;
    cancelAnimationFrame(fpPathId);
    function step(now) {
      const k = Math.min(1, (now - start) / dur);
      const ease = 1 - Math.pow(1 - k, 3);
      const cur = from.clone().lerp(to, ease);
      S.camera.position.copy(cur);
      S.camera.lookAt(to);
      if (k < 1) fpPathId = requestAnimationFrame(step);
      else S.camera.position.copy(to);
    }
    fpPathId = requestAnimationFrame(step);
  }

  // Proyectar un rayo desde el centro de la pantalla (crosshair) en modo FPS
  function centerPick() {
    const ndcFPS = new THREE.Vector2(0, 0);
    raycaster.setFromCamera(ndcFPS, S.camera);
    const hits = raycaster.intersectObjects(S.clickables, false);
    return hits.length ? hits[0].object : null;
  }

  // ── Inputs del modo FPS ──────────────────────────────────
  const keys = {};
  document.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.key === 'Escape' && S.fps) exitFPSession(); });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; });
  const lookSensitivity = 0.002;
  let lastPointerX = null;
  canvas.addEventListener('mousemove', (e) => {
    if (!S.fps) return;
    if (lastPointerX === null) lastPointerX = e.clientX;
    const dx = e.clientX - lastPointerX;
    lastPointerX = e.clientX;
    // Rotación horizontal de la cámara
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.setFromQuaternion(S.camera.quaternion);
    euler.y -= dx * lookSensitivity;
    S.camera.quaternion.setFromEuler(euler);
    // Rotación vertical limitada
    const pitch = -(e.clientY - (lastPointerY ?? e.clientY)) * 0.002;
    lastPointerY = e.clientY;
    euler.x += pitch;
    euler.x = Math.max(-1.45, Math.min(1.45, euler.x));
    S.camera.quaternion.setFromEuler(euler);
  });
  let lastPointerY = null;

  canvas.addEventListener('wheel', (e) => {
    if (!S.fps) return;
    // en FPS no queremos zoom con rueda; podemos usarlo para avanzar/retroceder rápido
    e.preventDefault();
    if (e.deltaY < 0) keys['KeyW'] = true;
    if (e.deltaY > 0) keys['KeyS'] = true;
    setTimeout(() => { keys['KeyW'] = false; keys['KeyS'] = false; }, 150);
  }, { passive: false });

  // Toques en móvil: arrastrar para mirar, Dos toques o slide vertical para moverse
  let touchId = null;
  canvas.addEventListener('touchstart', (e) => {
    if (!S.fps) return;
    if (touchId === null && e.touches.length === 1) {
      touchId = e.touches[0].identifier;
      lastPointerX = e.touches[0].clientX;
      lastPointerY = e.touches[0].clientY;
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!S.fps || touchId === null) return;
    const t = Array.from(e.touches).find((x) => x.identifier === touchId);
    if (!t) return;
    const dx = t.clientX - lastPointerX;
    const dy = t.clientY - lastPointerY;
    lastPointerX = t.clientX;
    lastPointerY = t.clientY;
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    euler.setFromQuaternion(S.camera.quaternion);
    euler.y -= dx * 0.004;
    euler.x -= dy * 0.003;
    euler.x = Math.max(-1.4, Math.min(1.4, euler.x));
    S.camera.quaternion.setFromEuler(euler);
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    if (!S.fps) return;
    const still = Array.from(e.touches).some((x) => x.identifier === touchId);
    if (!still) { touchId = null; lastPointerX = null; lastPointerY = null; }
  }, { passive: true });

  // ── Bucle de movimiento FPS ──────────────────────────────
  S.addAnimate((dt) => {
    if (!S.fps) return;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(S.camera.quaternion);
    forward.y = 0; forward.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(S.camera.quaternion);
    right.y = 0; right.normalize();

    const move = new THREE.Vector3();
    if (keys['KeyW'] || keys['ArrowUp']) move.add(forward);
    if (keys['KeyS'] || keys['ArrowDown']) move.sub(forward);
    if (keys['KeyA'] || keys['ArrowLeft']) move.sub(right);
    if (keys['KeyD'] || keys['ArrowRight']) move.add(right);

    if (move.lengthSq() > 0) {
      move.normalize();
      const speed = 4.0;
      const step = move.multiplyScalar(speed * dt);
      const next = S.camera.position.clone().add(step);
      next.y = FP_WALK_HEIGHT;
      // simple clamp para no salir de la tienda
      const limit = 22;
      next.x = Math.max(-limit, Math.min(limit, next.x));
      next.z = Math.max(-limit, Math.min(limit, next.z));
      S.camera.position.copy(next);
    }

    // Interacción en FPS: apretar clic izquierdo el centro mira y selecciona
    if (S.fps && isPointerDown) {
      const m = centerPick();
      if (m && m.userData.product) {
        if (m.userData.product) showCard(m.userData.product);
        snapLookAt(m.userData.product);
        isPointerDown = false;
      }
    }
  });

  let isPointerDown = false;
  canvas.addEventListener('mousedown', (e) => {
    if (!S.fps) return;
    isPointerDown = true;
  });
  canvas.addEventListener('mouseup', () => { isPointerDown = false; });
  canvas.addEventListener('mouseleave', () => { isPointerDown = false; });

  canvas.addEventListener('pointerdown', (e) => {
    dragStart = { x: e.clientX, y: e.clientY };
    stopTour();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!dragStart) return;
    const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
    dragStart = null;
    if (moved > 6) return;
    const m = pick(e);
    if (m && m.userData.product) {
      // Si estamos en modo FPS, mostrar la tarjeta un instante y mantener la vista fija
      if (S.fps) snapLookAt(m.userData.product);
      showCard(m.userData.product);
    } else {
      hideCard();
    }
  });
  canvas.addEventListener('pointermove', (e) => setHover(pick(e)));
  canvas.addEventListener('pointerleave', () => setHover(null));

  // ── Chips de zona ────────────────────────────────────────
  const chipsNav = document.getElementById('zoneChips');
  const chips = S.ZONES.map((z) => {
    const b = document.createElement('button');
    b.className = 'chip rounded-full px-3 py-1.5 text-xs font-bold text-white/85 border border-white/15 whitespace-nowrap flex items-center gap-1.5';
    b.innerHTML = `<span class="w-2 h-2 rounded-full" style="background:${z.color}"></span>${z.label}`;
    b.onclick = () => flyTo(z);
    chipsNav.appendChild(b);
    return b;
  });
  function markChip(zoneId) {
    chips.forEach((c, i) => c.classList.toggle('active', S.ZONES[i].id === zoneId));
  }

  let tween = null;
  function flyTo(zone) {
    stopTour();
    if (S.fps) {
      // en FPS, acercarse al punto en lugar de orbitar
      moveToPoint(new THREE.Vector3(zone.view.p[0], FP_WALK_HEIGHT, zone.view.p[2]), { minDist: 0.2 });
      // mirar hacia el target de zona una vez llegado
      setTimeout(() => {
        if (!S.fps) return;
        const t = new THREE.Vector3(zone.view.t[0], Math.max(0.4, zone.view.p[1] - 2.2), zone.view.t[2]);
        S.camera.lookAt(t);
      }, 800);
      markChip(zone.id);
      return;
    }
    const fromP = camera.position.clone();
    const fromT = controls.target.clone();
    const toP = new THREE.Vector3(zone.view.p[0], zone.view.p[1], zone.view.p[2]);
    const toT = new THREE.Vector3(zone.view.t[0], zone.view.t[1], zone.view.t[2]);
    const start = performance.now(), dur = 1000;
    controls.enabled = false;
    markChip(zone.id);
    cancelAnimationFrame(tween);
    function step(now) {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(fromP, toP, e);
      controls.target.lerpVectors(fromT, toT, e);
      if (k < 1) tween = requestAnimationFrame(step);
      else controls.enabled = true;
    }
    tween = requestAnimationFrame(step);
  }
  S.flyTo = flyTo;

  // ── Recorrido automático ─────────────────────────────────
  const tourBtn = document.getElementById('tourBtn');
  const tourLabel = document.getElementById('tourLabel');
  function startTour() {
    S.tour = true;
    S.tourAngle = Math.atan2(camera.position.x, camera.position.z);
    controls.enabled = false;
    markChip(null);
    tourLabel.textContent = 'Detener';
    tourBtn.classList.add('active');
  }
  function stopTour() {
    if (!S.tour) return;
    S.tour = false;
    controls.enabled = true;
    tourLabel.textContent = 'Recorrido';
    tourBtn.classList.remove('active');
  }
  tourBtn.onclick = () => (S.tour ? stopTour() : startTour());

  // ── Tarjeta de producto (con cuidado) ────────────────────
  const card = document.getElementById('productCard');
  const cardName = document.getElementById('cardName');
  const cardMeta = document.getElementById('cardMeta');
  const cardPrice = document.getElementById('cardPrice');
  const cardCompare = document.getElementById('cardCompare');
  const cardBadge = document.getElementById('cardBadge');
  const cardZone = document.getElementById('cardZone');
  const cardLink = document.getElementById('cardLink');

  // extras de cuidado (se inyectan en el DOM desde la tarjeta)
  const cardCareWrap = document.getElementById('cardCareWrap');
  const cardCare = document.getElementById('cardCare');
  const cardMaterials = document.getElementById('cardMaterials');

  function showCard(prod) {
    cardName.textContent = prod.name;
    cardMeta.textContent = `${prod.category} · ${prod.color}`;
    const fmtUsdVr = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 });
    cardPrice.textContent = fmtUsdVr(prod.price);
    cardCompare.classList.toggle('hidden', !prod.compareAt);
    if (prod.compareAt) cardCompare.textContent = fmtUsdVr(prod.compareAt);
    cardBadge.classList.toggle('hidden', !prod.badge);
    if (prod.badge) cardBadge.textContent = prod.badge;
    const z = S.ZONES.find((z) => z.id === prod.zone);
    cardZone.textContent = (z ? z.label : 'Tienda') + ' · SKU ' + prod.sku;
    cardLink.href = '/detalle-de-producto?sku=' + encodeURIComponent(prod.sku);
    // foto real en la tarjeta
    const img = document.getElementById('cardImg');
    const emo = document.getElementById('cardImgEmoji');
    if (prod.image) {
      img.onload = () => { img.classList.remove('hidden'); emo.classList.add('hidden'); };
      img.onerror = () => { img.classList.add('hidden'); emo.textContent = S.emojiFor(prod); emo.classList.remove('hidden'); };
      img.src = prod.image;
    } else {
      img.classList.add('hidden');
      emo.textContent = S.emojiFor(prod);
      emo.classList.remove('hidden');
    }
    // cuidado del producto (si está disponible)
    if (prod.care !== undefined) {
      cardCareWrap.classList.remove('hidden');
      cardCare.textContent = prod.care || 'Consulta el detalle del producto';
      cardMaterials.textContent = prod.materials || '';
    } else {
      cardCareWrap.classList.add('hidden');
    }
    card.classList.remove('hidden');
    markChip(prod.zone);
    showPhoto(prod);
  }
  function hideCard() { card.classList.add('hidden'); hidePhoto(); }
  document.getElementById('cardClose').onclick = hideCard;

  // ── Pantalla completa ────────────────────────────────────
  document.getElementById('fsBtn').onclick = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    else document.exitFullscreen && document.exitFullscreen();
  };

  // ── Hooks por fotograma ──────────────────────────────────
  S.addAnimate((dt, t) => {
    // el panel de foto flotante sigue a la cámara
    if (panelShown) {
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const tgt = camera.position.clone().addScaledVector(dir, 6.4);
      tgt.y -= 0.8;
      photoPanel.position.lerp(tgt, 0.08);
    }
    // resplandor del anillo
    if (ring.visible) {
      ring.material.opacity = 0.65 + 0.3 * Math.sin(t * 5);
      ring.rotation.z += dt * 0.8;
    }
  });
});
