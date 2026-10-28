# Adaptación por dispositivo

Cómo VivaModa decide qué interfaz mostrar y qué cambia en cada rango de
pantalla. El objetivo no es «detectar un iPhone», sino **adaptar densidad,
navegación, tamaño táctil y coste de render al espacio real del viewport**.

## 1. Rangos usados

Los cortes salen de los anchos de viewport (CSS px) más habituales, no del
tamaño físico ni de la resolución del panel:

| Clase     | Ancho de viewport | Equipos típicos                                            |
|-----------|-------------------|------------------------------------------------------------|
| `phone`   | < 640 px          | 360, 375, 390, 414, 430 px (Android y iPhone en vertical)   |
| `tablet`  | 640–1199 px       | 768, 810, 820, 834 px en vertical; 1024–1180 en horizontal  |
| `laptop`  | 1200–1439 px      | 1280×800, 1366×768, 1440×900 (13–15")                       |
| `desktop` | ≥ 1440 px         | 1536, 1600, 1920 px y monitores externos                    |

Los cortes son los mismos que usan las media queries del CSS, de modo que
JavaScript y CSS nunca discrepan. Un móvil en horizontal (844×390) se clasifica
por su **lado corto**, así que sigue siendo `phone`; un iPad apaisado
(1180×820) sigue siendo `tablet`.

## 2. ¿Hace falta una librería?

Se evaluaron las opciones habituales y **no se añadió ninguna dependencia**:

- **`ua-parser-js`** y **`mobile-detect`**: deducen el aparato por User-Agent.
  El UA se congela, se falsifica y no dice el ancho de la ventana; además
  `mobile-detect` desaconseja su uso en HTML. Un portátil con la ventana a
  800 px necesita el diseño de tablet aunque su UA diga «Macintosh».
- **`detect-it`**: correcto para saber si hay ratón o dedo, pero son ~3 KB de
  CDN para algo que resuelven las media queries `pointer: coarse` y
  `hover: none`. El proyecto ya carga Tailwind por CDN y no tiene bundler.
- **Lo nativo** cubre todo lo necesario: media queries, `matchMedia`,
  `navigator.maxTouchPoints`, `devicePixelRatio`, `saveData` y
  `prefers-reduced-motion`.

Por eso la capa propia son ~180 líneas sin dependencias y funciona aunque el
JavaScript se bloquee (el CSS sigue adaptando el layout por sí solo).

## 3. `public/js/device.js`

Se inyecta en el `<head>` de **todas** las páginas desde
[`server.js`](../backend/src/server.js), antes del primer pintado para evitar
el parpadeo de escritorio en móvil. Deja en `<html>`:

```
data-vm-device="phone|tablet|laptop|desktop"
data-vm-input="touch|pointer"
data-vm-reduced="true|false"    prefers-reduced-motion
data-vm-low="true|false"        saveData / 2G / <= 2 GB de RAM
data-vm-standalone="true|false" instalada como PWA
--vm-vw / --vm-vh / --vm-dpr    medidas reales
```

y expone `window.VMDevice` con `device`, `input`, `toca`, `ancho`, `alto`,
`reducido`, `recursosBajos`, `info()` y `alCambiar(fn)`. Recalcula en
`resize`, `orientationchange` y `pageshow` (la barra del navegador cambia el
alto en iOS/Android) y emite `vm:devicechange` solo cuando cambia la clase o
el tipo de entrada, no en cada píxel de arrastre.

## 4. `public/css/responsive.css`

Se inyecta también en todas las páginas. Además de las reglas fluidas previas,
la capa por dispositivo hace:

- **Táctil**: anula `hover:-translate-y`/`hover:scale` (dejaban elementos
  «flotando» tras tocarlos), quita el rectángulo azul de tap y convierte las
  tiras de pestañas en carruseles con imán (`scroll-snap`).
- **Teléfono**: campos con `font-size: 16px` para que iOS no haga zoom al
  enfocar; objetivos de 44 px en botones de acción; cabecera del catálogo con
  el aire suficiente para no tapar el primer título.
- **Tablet**: modales acotados a `92vw`, categorías del header más apretadas
  para que quepan a 820 px.
- **Laptop**: ritmo vertical comprimido (768 px de alto útil), hero limitado
  a ~70 vh.
- **Escritorio**: contenedor de 84–88 rem; a partir de 1600 px la vitrina del
  catálogo pasa a cuatro columnas.
- **Menos movimiento**: si el sistema lo pide, animaciones y transiciones a
  ~0 ms.

### Correcciones que salieron de la verificación

| Síntoma medido | Causa | Arreglo |
|----------------|-------|---------|
| Header fijo tapaba el logo y el primer enlace del POS/panel a ≤1023 px | El sidebar pasaba a barra en flujo y el header seguía `fixed` | Header `sticky` en ese rango y `main` sin el `padding-top` de compensación |
| Cinco enlaces del sidebar ocupaban 236 px de alto en un móvil | `flex-wrap: wrap` en una barra de 390 px | Una sola fila con scroll horizontal, difuminado en el borde |
| Columnas de las tablas del panel inalcanzables (933 px de contenido en 310 px) | `overflow-x: clip` aplicado a todos los `.w-full`, incluidas las tablas | `clip` solo en el contenedor flex; `table.w-full` con `overflow-x: auto` |
| La asesora 3D desbordaba 5 px y cortaba su columna derecha | Hijo de grid imponía su `min-content` (364 px en una pista de 343) | `main .grid > * { min-width: 0 }` a ≤1023 px |
| Un portátil de 1440 px se clasificaba como `laptop` mientras el CSS aplicaba escritorio | Se medía `clientWidth` (descuenta la barra de scroll) | Clasificar con `innerWidth`, igual que las media queries |
| El nav del header de la asesora de estilo desbordaba 34 px y cortaba el último enlace | El `nav` era un flex item sin `min-width: 0` | En teléfono se deja encoger y se desplaza en horizontal |

## 5. Tienda VR

En [`core.js`](../backend/public/js/pages/vr-store/core.js):

- `devicePixelRatio` limitado a **1.5 en teléfono**, 1.75 en tablet y 2 en
  escritorio: un móvil con DPR 3 dibujaba 9× los píxeles de un monitor.
- Con `saveData`, red 2G o ≤ 2 GB de RAM se desactivan las sombras y se usa
  sombreado duro en teléfono.

En [`mode-fps.js`](../backend/public/js/pages/vr-store/mode-fps.js):

- En pantalla táctil se entra en **Catálogo**, no en Avatar/FPS: sin WASD el
  usuario quedaba plantado. `?modo=` sigue teniendo prioridad y en escritorio
  se respeta el modo guardado.

## 6. Cómo comprobarlo

Con el servidor en marcha (`cd backend && npm start`), redimensionar a
**390, 820, 1366 y 1920 px** y revisar en consola:

```js
document.documentElement.dataset.vmDevice          // phone|tablet|laptop|desktop
document.documentElement.scrollWidth === document.documentElement.clientWidth
window.VMDevice.info()
```

Capturas de la verificación (2026-10-19):

- `docs/capturas/responsive-390-catalogo.png`
- `docs/capturas/responsive-390-detalle.png`
- `docs/capturas/responsive-390-pos.png`
- `docs/capturas/responsive-390-admin.png`
- `docs/capturas/responsive-390-hub.png`
- `docs/capturas/responsive-820-tablet.png`
- `docs/capturas/responsive-820-pos.png`
- `docs/capturas/responsive-1366-catalogo.png`
- `docs/capturas/responsive-1366-detalle.png`
- `docs/capturas/responsive-1920-desktop.png`

## 7. Límites conocidos

- No se probó en teléfono/tablet físicos: el navegador de escritorio emula
  ancho, pero **no** `pointer: coarse` ni los cambios de alto de la barra de
  iOS. Las rutas táctiles (modo inicial de la tienda VR, `scroll-snap`,
  tamaño de objetivo) están implementadas y revisadas en código, no
  ejercitadas en hardware.
- Las capturas de escritorio se guardan recortadas a 1182 px por el ancho
  máximo del capturador; a 1366/1920 la verificación es por medidas
  (`scrollWidth`, geometría de la rejilla), no por imagen completa.
