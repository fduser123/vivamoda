# Plan de implementación — Realidad Aumentada en VivaModa

Estado: **implementado** (19/10/2026) — ver
[AR-MATRIZ-DE-PRUEBAS.md](AR-MATRIZ-DE-PRUEBAS.md) para lo verificado y lo que
sigue pendiente de un móvil real.
Alcance: llevar la tienda VR a RA real en el móvil, reutilizando los `.glb`
que ya genera Blender y el probador virtual que ya existe.

---

## 1. Punto de partida (lo que ya hay)

| Pieza | Dónde | Estado |
|---|---|---|
| Escena three.js r128 (globals, sin bundler) | `backend/public/js/pages/vr-store/core.js` | funcional |
| Escena 3D de la tienda (avatar / catálogo / FPS) | `mode-fps.js`, `avatar.js`, `interaccion.js` | funcional |
| Modelos por SKU | `public/models/generated/<sku>.glb` | generados por `npm run models:3d` |
| Carga de modelos con caché y encaje | `mk-ropa.js` (`cargarModelo`, `plantillas`) | funcional |
| Probador virtual con IA (foto → FLUX) | `probador.js` + `POST /api/ai/tryon` | funcional |
| QR de producto (dependencia ya instalada) | `src/routes/catalog.js` (`qrcode`) | funcional |
| Servidor | Express, estático en `public/`, `http://localhost:3000` | funcional |

Tres hechos que condicionan el diseño:

1. **No hay bundler.** Todo entra por `<script>` global. Cualquier librería nueva
   debe funcionar por CDN o como archivo suelto en `public/js/`.
2. **three r128** ya está fijado y todos los módulos usan la API global
   (`THREE.*`). Subir de versión rompería `examples/js`, así que la RA se
   construye sobre r128 (hit-test a mano, ~90 líneas).
3. **El `.glb` no está a escala real**: Blender lo exporta con proporciones
   derivadas del precio y `mk-ropa.js` lo reescala para el riel. Para RA eso hay
   que arreglarlo en el origen (metros reales), no en el visor.

---

## 2. Decisión de arquitectura: 3 capas, no una

La RA "de verdad" en web no es un único camino. WebXR `immersive-ar` no existe
en iOS Safari, y el probador AR tipo espejo no necesita WebXR. Por eso:

```
                    ┌─────────────────────────────┐
   Botón "Ver en AR" │  detectarAR()  (capacidades) │
                    └──────────┬──────────────────┘
             ┌─────────────────┼──────────────────────┐
             ▼                 ▼                      ▼
   WebXR immersive-ar    iOS Quick Look        Escritorio / sin AR
   (Android + ARCore)    (USDZ nativo)         (visor 3D + QR al móvil)
   three.js + hit-test   <a rel="ar">          ya existe (OrbitControls)
```

Y en paralelo, independiente de lo anterior:

```
   Probador AR "espejo"  →  cámara + pose (MediaPipe)
   (funciona en iOS y Android, sin WebXR)
```

**Recomendación:** implementar en este orden — Fase 1 da valor visible en un día,
Fase 2 es la RA "de colocación" que se defiende en la demo, Fase 3 es la que más
impacta en moda (verse la prenda puesta en tiempo real). No empezar por la 3: la
segmentación sin WebXR es la parte con más riesgo de calidad visual.

---

## 3. Fases

### Fase 0 — Base segura y detección de capacidades (2–3 h)

Sin esto nada funciona en un móvil real.

- [x] **HTTPS para pruebas.** WebXR exige contexto seguro. Dos caminos:
      - `localhost` ya cuenta como seguro: probar con `adb reverse tcp:3000 tcp:3000`
        desde Chrome Android (`chrome://inspect` → Port forwarding).
      - Para QR / otros móviles: `mkcert` + un `https.createServer` opcional en
        `src/server.js` cuando `HTTPS_CERT` y `HTTPS_KEY` estén definidos.
- [x] **`public/js/pages/vr-store/ar/capacidades.js`**: detecta
      `navigator.xr?.isSessionSupported('immersive-ar')`, iOS (`/iPad|iPhone|iPod/`),
      y si hay cámara (`navigator.mediaDevices.getUserMedia`). Devuelve
      `{ modo: 'webxr' | 'quicklook' | 'visor' }`.
- [x] **Flag de producto**: en lugar de una columna nueva, la fuente es
      `public/models/generated/index.json` (que ya trae medidas reales por SKU).
      Si el SKU no está en el índice no hay `glb`, y el botón no se muestra: no
      se anuncia RA de lo que no tiene modelo. Las medidas reales viajan en
      `medidas: { alto, ancho, fondo }` dentro de la respuesta de la API.
- [x] **`GET /api/vr/ar/:sku`** en `src/routes/vr.js`: devuelve URLs de `.glb` /
      `.usdz`, medidas reales y si el modelo ya está exportado. Cachea 1 h.

**Criterio de aceptación:** en un Android con ARCore, `capacidades.js` responde
`webxr`; en un iPhone responde `quicklook`; en escritorio `visor`.

---

### Fase 1 — "Ver en AR" inmediato: Quick Look + Scene Viewer (4–6 h)

La vía barata y la que **sí funciona en iPhone**: un enlace que abre el visor AR
nativo. Sin WebXR, sin permisos de cámara, sin código de render.

- [ ] **Convertir a USDZ.** Implementado en `generar_modelos.py` (`--usdz`) con
      el operador `bpy.ops.wm.usdz_export` y el script
      `npm run models:3d:usdz`; salida `public/models/generated/<sku>.usdz`.
      **Pendiente de ejecutar**: el Blender 4.0.2 de esta máquina (paquete de
      Debian) no incluye el módulo USD, así que no hay ningún `.usdz` todavía.
      Con un Blender oficial 4.0+ el comando los genera.
- [x] **MIME correcto** en `src/server.js`:
      `express.static(PUBLIC, { setHeaders })` → `.usdz` como
      `model/vnd.usdz+zip`. Sin esto Safari descarga un archivo en vez de abrir AR.
- [x] **`ar/quicklook.js`**: crea `<a rel="ar" href="...usdz"><img></a>` (Safari
      exige un `<img>` dentro del `<a>`). En Android, `intent://arvr.google.com/scene-viewer/1.0?file=<glb>&mode=ar_preferred`
      con fallback a `https://arvr.google.com/scene-viewer/1.0?file=...`.
- [x] **Botón en la tarjeta de producto** (`interaccion.js`, junto a `cardLink`):
      "Ver en tu espacio" con icono `view_in_ar`, visible solo si hay modelo.
- [x] **Fallback escritorio**: el mismo botón abre un QR (`qrcode` ya está en
      `package.json`) con la URL `?ar=<sku>` para pasar la sesión al móvil.

**Criterio de aceptación:** en iPhone, el botón abre Quick Look con la prenda a
escala 1:1 sobre la mesa; en Android abre Scene Viewer; en escritorio aparece el
QR y al escanearlo se abre la ficha en el móvil.

---

### Fase 2 — WebXR `immersive-ar` con colocación en el suelo (8–12 h)

La experiencia "tienda en tu casa": colocar la prenda (o el maniquí completo) en
el espacio real, con hit-test y escala real.

- [x] **`ar/escala.js` + medidas reales.** Los `.glb` ya salen en metros
      reales y `index.json` guarda alto/ancho/fondo por SKU (no hizo falta una
      tabla aparte: `medidas.json` se sustituye por ese índice). `sesion.js`
      corrige la escala solo si el modelo se desvía más de un 10 %. `mk-ropa.js`
      sigue reescalando para el riel, así que la tienda no cambia de aspecto.
- [x] **`ar/sesion.js`** (≈380 líneas):
      - `renderer.xr.enabled = true`; `XRSession` con
        `requiredFeatures: ['hit-test', 'dom-overlay']` y
        `optionalFeatures: ['light-estimation', 'anchors']`.
      - `session.requestHitTestSource({ space: viewerSpace })` + `XRFrame.getHitTestResults`
        → retícula (`RingGeometry` + anillo pulsante) sobre la superficie detectada.
      - `local-floor` como reference space para que la prenda quede de pie en el suelo.
      - Colocar al tocar: `hitPose.transform` → `Object3D.matrix` del grupo de la prenda.
      - Gestos: `select` para colocar; `selectstart/selectmove` con dos manos para
        escalar y girar; botón "recolocar" y "quitar".
      - `session.requestLightProbe()` opcional → intensidad de `AmbientLight` según
        el entorno (si no está, luz fija neutra).
      - `session.end` → `renderer.xr.enabled = false`, restaurar cámara/controles y
        devolver el canvas a la tienda (no recargar la página).
- [x] **Botón AR propio.** Ojo: en three.js `ARButton` solo existe como módulo ESM
      (`examples/jsm/webxr/ARButton.js`); **no hay versión global** `THREE.ARButton`
      en ninguna release (comprobado: r128, r140 y r147 dan 404 en `examples/js/`).
      Como el proyecto usa `<script>` globales, el botón se escribe a mano: pide
      `navigator.xr.requestSession('immersive-ar', …)` y se estiliza como los chips
      existentes (`glass chip`), sin el gris por defecto.
- [x] **Pantalla de espera** mientras se abre la sesión ("apunta al suelo") y
      mensaje claro si el permiso de cámara se deniega.

**Riesgos:** el hit-test manual en r128 es la parte delicada; conviene aislarlo en
`sesion.js` y probarlo primero con un cubo antes de meter prendas. `dom-overlay`
es necesario para los botones HTML dentro de la sesión.

**Criterio de aceptación:** en Android con ARCore, pulsar AR abre la cámara, la
retícula se pega al suelo, al tocar aparece el modelo con su tamaño real (una
camiseta mide ~70 cm de alto contra una referencia conocida), se puede girar y
escalar, y al salir la tienda sigue usable sin recargar.

---

### Fase 3 — Probador AR "espejo" (10–14 h)

Verse la prenda puesta en tiempo real con la cámara frontal. Es lo que más se
parece a "realidad aumentada" para el usuario y no depende de WebXR, así que
funciona también en iPhone.

- [x] **`ar/espejo.js`**:
      - `getUserMedia({ video: { facingMode: 'user' } })` → `<video>` de fondo.
      - Pose con **MediaPipe Tasks Vision** (`PoseLandmarker`, CDN + WASM) para
        anclar hombros/cadera/cabeza/tobillo según la categoría.
      - **Desvío consciente:** la prenda se superpone como **PNG** (las fotos del
        catálogo tienen fondo transparente), no como `.glb` sobre una máscara.
        Se evita el coste y el riesgo de la segmentación en v1; el resultado no
        tiene oclusión del cuerpo, que queda como mejora posterior.
      - Anclaje por caja + dos sliders (tamaño/altura) para corregir a mano.
- [x] **Botón "Probar en cámara"** en la tarjeta y en el probador existente
      (junto a `tryonTabPhoto`, como tercera pestaña "En vivo").
- [x] **Captura y compartir**: `canvas.toBlob()` → descarga / `navigator.share`.
- [x] **Sin cámara o permiso denegado** → cae a la pestaña Foto actual
      (`POST /api/ai/tryon`), sin callejón sin salida.

**Riesgo:** rendimiento en móviles de gama media. Presupuesto: 30 fps con
`ImageSegmenter` en `GPU` delegate y render a 720p; si no llega, bajar a 480p y
avisar. Medir antes de prometer.

**Criterio de aceptación:** en iPhone y Android, la prenda sigue los hombros al
moverse sin temblar de forma notoria, y la captura sale con la prenda compuesta.

---

### Fase 4 — Cierre: medición, accesibilidad y demo (4–6 h)

- [x] **Analítica**: `ar_open` / `ar_qr` / `ar_place` / `ar_session_start` /
      `ar_tryon_live` / `ar_capture` / `ar_share`, con `sku` y `modo`, vía
      `POST /api/vr/ar/evento` (queda en el log del servidor).
- [x] **Accesibilidad**: botón con `aria-label` y `aria-hidden` cuando no
      aplica, diálogos con `role="dialog"` + `aria-modal`, cierre con `Escape` y
      foco al botón de cerrar. La retícula es estática (no hay movimiento que
      reducir).
- [ ] **Guion de demo** (3 min) para la defensa: ficha → Ver en AR → colocar →
      girar → probador en vivo → captura. Pendiente de pasar al
      `Guia_Demostracion_6_Puntos_Examen_Parcial_VivaModa.docx` (el flujo ya está
      descrito en la matriz de pruebas).
- [x] **Matriz de pruebas** documentada en
      [AR-MATRIZ-DE-PRUEBAS.md](AR-MATRIZ-DE-PRUEBAS.md): Android+ARCore, iPhone
      Quick Look, Android sin ARCore, iPhone sin cámara, escritorio.

---

## 4. Archivos nuevos y tocados

```
backend/public/js/pages/vr-store/ar/
  capacidades.js     detección + analítica (nuevo)
  quicklook.js       USDZ + Scene Viewer + QR (nuevo)
  ui.js              botón de la tarjeta + hoja ?ar=<sku> (nuevo)
  sesion.js          WebXR immersive-ar + hit-test (nuevo)
  espejo.js          cámara + pose + captura (nuevo)

backend/public/js/pages/vr-store/interaccion.js   botón en la tarjeta
backend/public/js/pages/vr-store/core.js          pausa del render mientras dura la RA
backend/public/js/pages/vr-store/probador.js      pestaña "En vivo"
backend/src/routes/vr.js                          GET /api/vr/ar/:sku, /qr.png, /evento
backend/src/config.js                             HTTPS_CERT / HTTPS_KEY
backend/src/server.js                             MIME .usdz, HTTPS opcional
backend/tools/modelos3d/generar_modelos.py        export USDZ opcional (--usdz)
backend/public/models/generated/*.usdz            artefactos (pendientes de Blender con USD)
../frontends/tienda-vr/code.html                  <script> de los módulos ar/* + botón

No hizo falta `estilos.css` (todo va en estilos inline como el resto de la
tienda) ni `medidas.json` (las medidas reales ya están en `index.json`).
```

Verificación y limitaciones: [AR-MATRIZ-DE-PRUEBAS.md](AR-MATRIZ-DE-PRUEBAS.md).

## 5. Orden de trabajo sugerido (5 sesiones)

| Sesión | Entregable | Verificación |
|---|---|---|
| 1 | Fase 0 completa | detección correcta en 3 dispositivos |
| 2 | Fase 1 (USDZ + botón + QR) | Quick Look real en iPhone |
| 3 | Fase 2 con cubo de prueba | retícula estable, colocación fiable |
| 4 | Fase 2 con prendas + escala real | medida comprobada con cinta |
| 5 | Fase 3 espejo + captura | 30 fps en gama media |

## 6. Lo que hay que decidir antes de la sesión 3

1. **¿Qué se coloca en RA?** ¿Solo el producto suelto, o la prenda puesta en un
   maniquí? El maniquí es más vendedor pero pesa 5–10× más.
2. **¿La RA sustituye al probador IA o convive?** Recomendación: conviven, porque
   el probador IA da resultado fotorrealista y la RA da interactividad.
3. **¿Se modela ropa con simulación de tela?** Fuera de alcance: requiere
   cloth sim por prenda (Houdini/Marvelous) y multiplica el peso. Las prendas
   rígidas ya venden la idea en demo.
