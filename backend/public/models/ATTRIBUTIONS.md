# Atribuciones — Modelos 3D (`backend/public/models/`)

Modelos usados por la página **"Ver en tu espacio"** (`/ver-en-tu-espacio`).

| Archivo | Modelo | Autor / Fuente | Licencia |
|---|---|---|---|
| `mk-it.glb` / `mk-it-draco.glb` | **TIENDA ROPA MK IT** (interior completo de boutique — escenario base de la tienda VR) | **Christophe Caro Alcalde (yohnchrastt)** · [sketchfab.com/3d-models/tienda-ropa-mk-it-0fa6ad7b79944a58a1c3471ef8857638](https://sketchfab.com/3d-models/tienda-ropa-mk-it-0fa6ad7b79944a58a1c3471ef8857638) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `camiseta.glb` | T-shirt | **Poly by Google** · [poly.pizza/m/bdOMzzh-fSl](https://poly.pizza/m/bdOMzzh-fSl) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `gafas-sol.glb` | Sunglasses | **J-Toastie** · [poly.pizza/m/jfVp7cW8E5](https://poly.pizza/m/jfVp7cW8E5) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `bolso.glb` | Purse | **jeremy** · [poly.pizza/m/2dTPEuZyLyJ](https://poly.pizza/m/2dTPEuZyLyJ) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `zapatos.glb` | Shoes | **Poly by Google** · [poly.pizza/m/0ASn5OTnrkz](https://poly.pizza/m/0ASn5OTnrkz) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `sneaker-realista.glb` | Materials Variants Shoe | **Shopify Inc.** · [Khronos glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MaterialsVariantsShoe) | [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

## Créditos en la aplicación

- La página `/ver-en-tu-espacio` incluye un pie con enlace a Poly Pizza y Khronos.
- Uso educativo/demostrativo (proyecto universitario VivaModa). Los créditos deben conservarse si los modelos se reutilizan.

## Notas técnicas

- Formato: **glTF binary (.glb)**. `mk-it.glb` (63 MB, texturas embebidas) y `mk-it-draco.glb` (25.8 MB, compresión Draco). Escenario de la tienda VR desde `/js/pages/vr-store/mk-scenario.js`.
- El botón "Ver en tu espacio" activa AR nativo en móviles compatibles (Scene Viewer en Android, Quick Look en iOS).
- SKU ↔ modelo (mapeo en `public/js/pages/espacio.js`): gafas `VM-DAM-SH36041801`, bolso `VM-DAM-SH41122801`, sneaker/zapatos `VM-DAM-SH39598728`, camiseta `VM-CAB-8850`.
