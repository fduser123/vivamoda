# Descarga de modelos profesionales de tienda (Sketchfab)

## Pasos (5 minutos)

1. **Crea la cuenta gratuita**: ve a [https://sketchfab.com/signup](https://sketchfab.com/signup) (email o Google).
2. **Modelo PRINCIPAL — TIENDA ROPA MK IT** (elegido por el usuario):
   - Abre: https://sketchfab.com/3d-models/tienda-ropa-mk-it-0fa6ad7b79944a58a1c3471ef8857638
   - Botón **Download 3D Model** → formato **glTF** (.gltf / .glb).
   - Autor: Christophe Caro Alcalde (yohnchrastt) · 238,282 caras · 75 materiales · 50 texturas · CC-BY.
   - Es "tienda de ropa con pantallas inmersivas": interior completo de boutique.
3. **Alternativas** (solo si MK IT falla o para comparar):
   - Simple Storefront Interior Pack (web-optimizado): https://sketchfab.com/3d-models/free-simple-storefront-interior-pack-348da01c195d46eca29e478e98aab16c
   - Women's Fashion Shop (boutique pesada): https://sketchfab.com/3d-models/womens-fashion-shop-a80a2727b9b44188a7f0e269b8f376a6
4. **Dónde dejar los archivos**: copia el ZIP descargado (sin descomprimir) a:

   ```
   proyecto 1/downloads/
   ```

   (si es un solo `.gltf` con `.bin` y texturas, ponlos juntos en una subcarpeta, ej. `downloads/storefront/`)

5. **Avisa** y yo me encargo de: descomprimir, convertir/optimizar a .glb, montar el comparador en el navegador e integrarlo en la tienda VR con las 5 zonas interactivas.

## Licencias

**CC Attribution** — uso libre incluyendo comercial, obligando a acreditar al autor. Los créditos se añadirán a `backend/public/models/ATTRIBUTIONS.md` y al pie de la tienda VR:

- *TIENDA ROPA MK IT* — **Christophe Caro Alcalde (yohnchrastt)** (Sketchfab, CC-BY)

## Notas técnicas

- Formato pedido: **glTF** (no FBX ni OBJ) para conversión limpia a .glb.
- El Pack A tiene iluminación **horneada** (light-baked emissive) → se ve profesional sin coste de GPU.
- El modelo B pesa más (487k caras); si la laptop va lenta, puedo reducir texturas con magnitud/decimación.
