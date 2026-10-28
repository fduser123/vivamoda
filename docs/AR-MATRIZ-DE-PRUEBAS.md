# Matriz de pruebas — Realidad Aumentada

Acompaña a [PLAN-REALIDAD-AUMENTADA.md](PLAN-REALIDAD-AUMENTADA.md). Aquí está
qué se probó, **cómo** y qué queda pendiente de un dispositivo real. Lo que está
en «verificado» se comprobó en esta máquina el 19/10/2026; lo demás es criterio
de aceptación, no resultado.

## 1. Preparar un móvil para probar

WebXR y la cámara exigen **contexto seguro**. Hay dos caminos y ninguno requiere
cambiar el código:

```bash
# A) Android por USB, sin certificados (localhost cuenta como seguro)
adb reverse tcp:3000 tcp:3000
# abrir en Chrome Android: http://localhost:3000/tienda-virtual-realidad

# B) Cualquier móvil de la red, con HTTPS (mkcert)
cd backend
mkcert -install
mkcert -cert-file cert.pem -key-file key.pem 192.168.1.50 localhost
HTTPS_CERT=cert.pem HTTPS_KEY=key.pem npm start
# abrir https://192.168.1.50:3000/tienda-virtual-realidad
```

Sin HTTPS, `navigator.xr` no existe y la tienda muestra el QR en vez de prometer
una sesión que el navegador va a rechazar.

## 2. Matriz por dispositivo

| Dispositivo | Detección esperada (`capacidades.js`) | Acción del botón | Qué debe pasar |
|---|---|---|---|
| Android + Chrome + ARCore | `webxr` | «Colocar en mi espacio» | Sesión inmersiva: retícula en el suelo, tocar coloca, botones giran/escalan, ✕ vuelve a la tienda sin recargar |
| Android sin ARCore / sin Chrome | `sceneviewer` | «Ver en tu espacio» | Se abre Scene Viewer con el `.glb`; si falta ARCore, cae a la ficha (`browser_fallback_url`) |
| iPhone / iPad (Safari) | `quicklook` | «Ver en mi espacio» | AR Quick Look ancla el `.usdz` a escala 1:1. **Solo si el SKU tiene `.usdz`**; si no, el botón no aparece |
| Escritorio (Chrome/Firefox/Safari) | `visor` | «Ver en AR (QR)» | Modal con QR de `?ar=<sku>`; al escanearlo se abre la hoja de RA en el móvil |
| Cualquiera por `http://` no-localhost | `visor` (`motivo: contexto-inseguro`) | «Ver en AR (QR)» | Aviso de que hace falta https en la hoja del QR |
| Prenda sin `.glb` en `index.json` | — | El botón no se muestra | Ni se anuncia RA de lo que no tiene modelo |

## 3. Casos funcionales

### 3.1 Servidor y modelo

- [x] `GET /api/vr/ar/:sku` devuelve `glb`, `usdz`, `medidas` y `disponible`.
- [x] SKU inexistente → `404` con `code: SKU_NOT_FOUND`.
- [x] `GET /api/vr/ar/:sku/qr.png` → `image/png` 480×480 con la URL de la ficha.
- [x] `.glb` se sirve como `model/gltf-binary`, con `Access-Control-Allow-Origin: *`.
- [ ] `.usdz` se sirve como `model/vnd.usdz+zip` (el MIME está configurado; falta
      un `.usdz` real, ver limitaciones).
- [x] `POST /api/vr/ar/evento` acepta el beacon y responde `204`
      (`sendBeacon` manda `text/plain`, así que el cuerpo puede llegar vacío: no
      se usa para nada crítico).

### 3.2 Tarjeta de producto (escritorio, verificado)

- [x] Al abrir una prenda con modelo aparece «Ver en AR (QR)» con
      `aria-label="<prenda> · Ver en AR (QR)"`.
- [x] Al abrir una prenda sin modelo el botón queda `hidden` + `aria-hidden`.
- [x] Clic → modal «Ver en tu espacio» con QR cargado (naturalWidth 480) y URL
      `…/tienda-virtual-realidad?ar=<sku>`.
- [x] Cerrar con ✕, con clic en el fondo y con `Escape`.
- [x] `?ar=<sku>` abre la hoja con nombre, etiqueta y explicación del modo;
      en escritorio avisa de que hay que abrirlo en el móvil.

### 3.3 WebXR (Android + ARCore)

- [ ] La sesión se pide en el mismo gesto del clic (si se espera al `.glb`,
      Chrome devuelve `NotAllowedError`).
- [ ] La retícula se pega al suelo y desaparece al colocar.
- [ ] La prenda apoya en el suelo y mira a la persona.
- [ ] Botones ⟲ ⟳ − + y «Centrar» funcionan; ✕ termina la sesión.
- [ ] Al salir, la tienda vuelve a renderizar (`VRStore.pausado = false`) y
      responde a los controles sin recargar.
- [ ] Cámara denegada → toast «Permiso de cámara denegado», sin pantalla negra.

### 3.4 Probador en vivo (`espejo.js`)

- [x] La pestaña «En vivo (AR)» del probador muestra el nombre de la prenda.
- [x] Pulsar «Abrir cámara» cierra el probador 3D y abre el espejo.
- [x] El detector de pose de MediaPipe carga desde CDN y arranca el grafo.
- [x] Con la webcam de esta máquina detecta la postura y el estado pasa a
      «Coloca la prenda con los controles».
- [x] Cerrar libera la cámara (`srcObject = null`) y detiene los tracks.
- [x] Permiso denegado (simulado con `NotAllowedError`) → toast y **vuelta al
      probador en la pestaña Foto**, sin callejón sin salida.
- [ ] En un móvil real con el cuerpo entero en cuadro, la prenda sigue los
      hombros al moverse. (En la webcam de escritorio solo entra la cara: el
      anclaje se calcula, pero la prenda queda fuera del encuadre.)
- [ ] «Capturar» descarga/comparte un PNG con la prenda compuesta.

## 4. Verificación automatizada / de consola (19/10/2026)

```bash
cd backend
node --check public/js/pages/vr-store/ar/*.js      # sintaxis de los 5 módulos
node --check src/routes/vr.js && node --check src/server.js
npm start                                          # servidor en :3000

curl -s localhost:3000/api/vr/ar/VM-DAM-8840       # 200 + medidas reales
curl -s -o /tmp/qr.png -w '%{http_code} %{content_type}\n' \
     localhost:3000/api/vr/ar/VM-DAM-8840/qr.png   # 200 image/png
curl -sI localhost:3000/models/generated/VM-DAM-8840.glb | grep -i content-type
```

En el navegador (panel Preview) se comprobó además: `deteccion.modo === 'visor'`,
`preparar()` produce `rel="ar"` + href `.usdz` en modo quicklook, produce el
`intent://` de Scene Viewer en Android, y `actualizar()` oculta el botón para un
SKU inexistente.

## 5. Capturas

- Botón de RA en la tarjeta (escritorio): `capturas/ar-boton-tarjeta.png`
- Modal de QR con la ficha del móvil: `capturas/ar-qr-escritorio.png`
- Probador en vivo con la cámara real de esta máquina:
  `capturas/ar-espejo-en-vivo.png`

## 6. Limitaciones conocidas

1. **Sin `.usdz` en esta máquina.** El exportador está implementado
   (`npm run models:3d:usdz`), pero la compilación de Blender instalada
   (4.0.2 de Debian) no incluye USD y no tiene `bpy.ops.wm.usdz_export`. Con un
   Blender oficial 4.0+ se generan los `.usdz`; hasta entonces el botón de
   iPhone no aparece (que es lo correcto: no prometer Quick Look sin archivo).
2. **El espejo superpone la foto PNG de la prenda, no el `.glb`.** Las fotos del
   catálogo tienen fondo transparente, así que el resultado es limpio, pero no
   hay simulación de tela ni oclusión del cuerpo. La segmentación de persona
   (MediaPipe `ImageSegmenter`) queda como mejora posterior.
3. **Nada de esto se probó en hardware real**: no hay Android con ARCore ni
   iPhone en esta máquina. Las filas sin marcar son criterios de aceptación.
4. **El QR apunta al host de la petición.** Si el servidor se abre por
   `localhost` en el portátil, el móvil que escanea no puede resolver
   `localhost`: hay que abrir la tienda por la IP de la red (o usar
   `adb reverse`) para que el QR sea útil.
