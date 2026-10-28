/* ============================================================
   RA · SESIÓN WEBXR «COLOCAR EN MI ESPACIO»  (fase 2 del plan)
   ------------------------------------------------------------
   Abre una sesión `immersive-ar` propia (Android + ARCore, Chrome)
   con una escena three.js aparte de la tienda: así la tienda no se
   toca y al salir queda exactamente como estaba.

   Qué hace:
   - Pide la sesión en el primer instante del clic: el gesto del
     usuario caduca (~5 s) y si se espera a descargar el .glb, Chrome
     rechaza la petición con NotAllowedError.
   - Hit-test manual: en three r128 no hay helper de superficies, así
     que se pide el `viewer` space y se lee `frame.getHitTestResults`.
     La retícula se pega al suelo mientras no se ha colocado nada.
   - Colocación a escala real: el .glb está modelado en metros (el
     index.json de Blender trae alto/ancho/fondo reales), con un
     ajuste fino si el modelo se desvía más de un 10 %.
   - Botones grande en el overlay para girar y escalar, más gestos de
     una y dos manos (squeeze) para quien prefiera tocar la prenda.
   - La tienda se pausa mientras dura la sesión para no gastar GPU en
     dos renderers a la vez.
   ============================================================ */
(function () {
  'use strict';

  const VRAR = (window.VRAR = window.VRAR || {});
  const S = window.VRStore || {};
  const VM = window.VM || {};
  const $ = (id) => document.getElementById(id);

  let activa = null;   // { session, renderer, overlay, ... } mientras dura

  function aviso(txt) {
    if (VM.toast) VM.toast(txt, 'view_in_ar');
  }

  /* ---------- Overlay (dom-overlay dentro de la sesión) ---------- */
  function montarOverlay(info) {
    const caja = document.createElement('div');
    caja.id = 'arSession';
    caja.style.cssText = 'position:fixed;inset:0;z-index:120;background:#000;';
    caja.innerHTML = `
      <canvas id="arCanvas" style="position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;"></canvas>

      <div style="position:absolute;top:0;left:0;right:0;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;
                  display:flex;align-items:center;gap:10px;background:linear-gradient(to bottom,rgba(10,6,14,.72),transparent);">
        <div style="min-width:0;flex:1;">
          <p style="margin:0;font:800 14px 'Plus Jakarta Sans',sans-serif;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
             id="arTitulo">${escapeHtml(info && info.name ? info.name : 'Realidad aumentada')}</p>
          <p style="margin:2px 0 0;font:600 11px 'Plus Jakarta Sans',sans-serif;color:rgba(255,255,255,.7);" id="arPista">
            Apunta al suelo y toca para colocar</p>
        </div>
        <button id="arSalir" aria-label="Salir de la realidad aumentada"
                style="width:38px;height:38px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2);
                       color:#fff;font-size:18px;line-height:1;cursor:pointer;">✕</button>
      </div>

      <div style="position:absolute;left:0;right:0;bottom:0;padding:12px 14px calc(14px + env(safe-area-inset-bottom));
                  display:flex;flex-direction:column;gap:8px;background:linear-gradient(to top,rgba(10,6,14,.78),transparent);">
        <p id="arEstado" style="margin:0;text-align:center;font:700 11px 'Plus Jakarta Sans',sans-serif;color:rgba(255,255,255,.75);">
          Cargando el modelo…</p>
        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
          <button data-ar="giro-izq" style="${BTN}" aria-label="Girar a la izquierda">⟲</button>
          <button data-ar="giro-der" style="${BTN}" aria-label="Girar a la derecha">⟳</button>
          <button data-ar="menos" style="${BTN}" aria-label="Hacer más pequeña la prenda">−</button>
          <button data-ar="mas" style="${BTN}" aria-label="Hacer más grande la prenda">+</button>
          <button data-ar="centrar" style="${BTN} width:auto;padding:0 14px;font-size:12px;">Centrar</button>
        </div>
      </div>`;
    document.body.appendChild(caja);
    return caja;
  }

  const BTN = 'width:44px;height:44px;border-radius:999px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.24);'
    + 'color:#fff;font:800 17px "Plus Jakarta Sans",sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- Sombra de contacto suave (sin luces ni sombras reales) ---------- */
  function sombraContacto(radio) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const malla = new THREE.Mesh(
      new THREE.PlaneGeometry(radio * 2.6, radio * 2.6),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    malla.rotation.x = -Math.PI / 2;
    malla.position.y = 0.002;
    malla.renderOrder = -1;
    return malla;
  }

  /** Escala al tamaño real y apoya la pieza en el suelo del grupo. */
  function normalizar(objeto, medidas) {
    const caja = new THREE.Box3().setFromObject(objeto);
    const alto = caja.max.y - caja.min.y;
    if (medidas && medidas.alto > 0.02 && alto > 0.01) {
      const k = medidas.alto / alto;
      // Solo se corrige la desviación: si el modelo ya está a escala real
      // (lo normal), k ≈ 1 y no se toca nada.
      if (k < 0.9 || k > 1.1) objeto.scale.multiplyScalar(k);
    }
    const caja2 = new THREE.Box3().setFromObject(objeto);
    objeto.position.y -= caja2.min.y;
    const centro = caja2.getCenter(new THREE.Vector3());
    objeto.position.x -= centro.x;
    objeto.position.z -= centro.z;
    return new THREE.Box3().setFromObject(objeto);
  }

  /* ---------- Sesión ---------- */
  async function iniciar(info) {
    if (!info || !info.glb) throw new Error('Esta prenda no tiene modelo 3D');
    if (!window.THREE || !THREE.GLTFLoader) throw new Error('Falta el cargador 3D');
    if (!navigator.xr) throw new Error('Este navegador no soporta WebXR');
    if (activa) return;

    const overlay = montarOverlay(info);
    const canvas = $('arCanvas');
    const estado = (txt) => { const el = $('arEstado'); if (el) el.textContent = txt; };

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    const escena = new THREE.Scene();
    const camara = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);

    escena.add(new THREE.HemisphereLight(0xffffff, 0x6b6b6b, 1.15));
    const sol = new THREE.DirectionalLight(0xffffff, 0.7);
    sol.position.set(0.6, 2.4, 0.9);
    escena.add(sol);

    // Retícula: anillo + punto, alineados a la superficie detectada.
    const reticula = new THREE.Group();
    const anillo = new THREE.Mesh(
      new THREE.RingGeometry(0.075, 0.095, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    anillo.rotation.x = -Math.PI / 2;
    const punto = new THREE.Mesh(
      new THREE.CircleGeometry(0.012, 20),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
    );
    punto.rotation.x = -Math.PI / 2;
    reticula.add(anillo, punto);
    reticula.matrixAutoUpdate = false;
    reticula.visible = false;
    escena.add(reticula);

    const grupo = new THREE.Group();
    grupo.visible = false;
    escena.add(grupo);

    // Pedir la sesión YA: el gesto del usuario no espera a la descarga.
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'light-estimation'],
        domOverlay: { root: overlay },
      });
    } catch (err) {
      overlay.remove();
      renderer.dispose();
      throw err;
    }

    activa = { session, renderer, grupo, overlay, info };
    try { await renderer.xr.setSession(session); } catch (err) {
      limpiar();
      throw err;
    }

    // La tienda deja de renderizar mientras dura la sesión (dos contextos
    // WebGL a la vez calientan el móvil y bajan los fps de la RA).
    S.pausado = true;
    VRAR.evento('ar_session_start', { sku: info.sku });

    // Referencias para el hit-test
    let hitFuente = null;
    try {
      const viewer = await session.requestReferenceSpace('viewer');
      hitFuente = await session.requestHitTestSource({ space: viewer });
    } catch (err) {
      console.warn('[AR] sin hit-test:', err && err.message);
      estado('Este dispositivo no detecta superficies: usa los botones para colocar');
    }

    let ultimoFrame = null;
    let colocada = false;
    let ajusteEscala = 1;

    // ── Carga del modelo (dentro de la sesión, sin prisa) ──
    const cargador = new THREE.GLTFLoader();
    cargador.load(
      info.glb,
      (gltf) => {
        if (!activa) return;
        const raiz = gltf.scene;
        raiz.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
            o.frustumCulled = false;
            if (o.material) o.material.side = THREE.FrontSide;
          }
        });
        const modelo = new THREE.Group();
        modelo.add(raiz);
        normalizar(modelo, info.medidas);
        grupo.add(modelo);

        const caja = new THREE.Box3().setFromObject(modelo);
        const ancho = Math.max(0.05, caja.max.x - caja.min.x);
        const fondo = Math.max(0.05, caja.max.z - caja.min.z);
        const sombra = sombraContacto(Math.max(ancho, fondo) * 0.55);
        grupo.add(sombra);

        estado('Toca el suelo para colocar · pellizca con dos manos para escalar');
        if (!hitFuente) {
          // Sin hit-test: se deja delante de la cámara para que algo se vea.
          const pos = new THREE.Vector3(0, 0, -1.1).applyMatrix4(camara.matrixWorld);
          grupo.position.set(pos.x, 0, pos.z);
          grupo.visible = true;
          colocada = true;
        }
      },
      undefined,
      (err) => {
        console.warn('[AR] modelo', err);
        estado('No se pudo cargar el modelo de esta prenda');
        aviso('No se pudo cargar el modelo 3D');
      },
    );

    // ── Colocación al tocar ──
    session.addEventListener('select', () => {
      if (!reticula.visible || !grupo.children.length) return;
      grupo.position.setFromMatrixPosition(reticula.matrix);
      // Se gira para mirar a la persona que coloca la prenda.
      const cam = new THREE.Vector3();
      camara.getWorldPosition(cam);
      grupo.rotation.y = Math.atan2(cam.x - grupo.position.x, cam.z - grupo.position.z);
      grupo.scale.setScalar(ajusteEscala);
      grupo.visible = true;
      if (!colocada) {
        colocada = true;
        VRAR.evento('ar_place', { sku: info.sku, hit: true });
      }
      reticula.visible = false;
      estado('Listo · mueve el móvil alrededor de la prenda');
    });

    // ── Gestos con los mandos (squeeze) ──
    const m0 = renderer.xr.getController(0);
    const m1 = renderer.xr.getController(1);
    escena.add(m0, m1);
    const agarre = { 0: false, 1: false, dist: 0, escala: 1, x: 0 };
    const posMano = (m, v) => m.getWorldPosition(v);

    function baseGesto() {
      if (agarre[0] && agarre[1]) {
        const a = posMano(m0, new THREE.Vector3());
        const b = posMano(m1, new THREE.Vector3());
        agarre.dist = a.distanceTo(b);
        agarre.escala = grupo.scale.x;
      }
      agarre.x = posMano(m0, new THREE.Vector3()).x;
    }
    m0.addEventListener('squeezestart', () => { agarre[0] = true; baseGesto(); });
    m0.addEventListener('squeezeend', () => { agarre[0] = false; });
    m1.addEventListener('squeezestart', () => { agarre[1] = true; baseGesto(); });
    m1.addEventListener('squeezeend', () => { agarre[1] = false; });

    function pintarBucle() {
      if (!renderer.xr.isPresenting) return;
      renderer.setAnimationLoop((_t, frame) => {
        if (frame) ultimoFrame = frame;

        if (ultimoFrame && hitFuente && !colocada) {
          const ref = renderer.xr.getReferenceSpace();
          const hits = ultimoFrame.getHitTestResults(hitFuente);
          if (hits && hits.length) {
            const pose = hits[0].getPose(ref);
            if (pose) {
              // matrixAutoUpdate = false: la matriz del hit-test se usa tal cual.
              reticula.matrix.fromArray(pose.transform.matrix);
              reticula.visible = true;
            }
          } else {
            reticula.visible = false;
          }
        }

        // Dos manos separadas → escala proporcional a la distancia.
        if (agarre[0] && agarre[1] && agarre.dist > 0.02 && grupo.visible) {
          const a = posMano(m0, new THREE.Vector3());
          const b = posMano(m1, new THREE.Vector3());
          const k = a.distanceTo(b) / agarre.dist;
          const nueva = Math.min(3, Math.max(0.25, agarre.escala * k));
          grupo.scale.setScalar(nueva);
          ajusteEscala = nueva;
        } else if (agarre[0] && grupo.visible) {
          // Una mano: giro horizontal.
          const x = posMano(m0, new THREE.Vector3()).x;
          grupo.rotation.y += (x - agarre.x) * 2.2;
          agarre.x = x;
        }

        renderer.render(escena, camara);
      });
    }
    pintarBucle();

    // ── Botones del overlay ──
    const acciones = {
      'giro-izq': () => { grupo.rotation.y -= Math.PI / 8; },
      'giro-der': () => { grupo.rotation.y += Math.PI / 8; },
      mas: () => { ajusteEscala = Math.min(3, ajusteEscala * 1.15); grupo.scale.setScalar(ajusteEscala); },
      menos: () => { ajusteEscala = Math.max(0.25, ajusteEscala / 1.15); grupo.scale.setScalar(ajusteEscala); },
      centrar: () => {
        const cam = new THREE.Vector3();
        camara.getWorldPosition(cam);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camara.getWorldQuaternion(new THREE.Quaternion()));
        dir.y = 0;
        if (dir.lengthSq() < 0.001) dir.set(0, 0, -1);
        dir.normalize().multiplyScalar(1.4);
        grupo.position.set(cam.x + dir.x, 0, cam.z + dir.z);
        grupo.visible = true;
        colocada = true;
        VRAR.evento('ar_place', { sku: info.sku, hit: false });
      },
    };
    overlay.querySelectorAll('[data-ar]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fn = acciones[b.dataset.ar];
        if (fn) fn();
      });
    });
    $('arSalir').addEventListener('click', () => session.end());

    function redimensionar() {
      camara.aspect = window.innerWidth / window.innerHeight;
      camara.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    activa.redimensionar = redimensionar;
    activa.camara = camara;
    window.addEventListener('resize', redimensionar, { passive: true });
    session.addEventListener('end', limpiar);
  }

  function limpiar() {
    if (!activa) return;
    const { renderer, overlay, session, redimensionar } = activa;
    activa = null;
    try { session.removeEventListener('end', limpiar); } catch (_) {}
    try { renderer.setAnimationLoop(null); } catch (_) {}
    try { renderer.xr.setSession(null); } catch (_) {}
    try { renderer.dispose(); } catch (_) {}
    if (redimensionar) window.removeEventListener('resize', redimensionar);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    S.pausado = false;
    VRAR.evento('ar_session_end', {});
  }

  VRAR.sesion = { iniciar, limpiar, get activa() { return Boolean(activa); } };
})();
