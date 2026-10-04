# 🧠 Aria: memoria, contexto real y búsquedas en internet

> Cómo el chatbot de VivaModa pasó de responder mensaje a mensaje a **recordar al cliente,
> consultar la base de datos y buscar en internet en vivo**.

## Las cuatro piezas

| Pieza | Módulo | Qué aporta |
|---|---|---|
| **Memoria** | `services/memory.js` | Lo que aprende del cliente: talla, presupuesto, colores, ocasiones, para quién busca |
| **Contexto de BD** | `services/chat-context.js` | Perfil, pedidos recientes, carrito en vivo, stock por talla/tienda, ofertas activas |
| **Internet** | `services/websearch.js` | DuckDuckGo + Wikipedia para preguntas de cultura de moda (sin API key) |
| **Fluidez** | `routes/ai.js` + `common.js` | Sesión persistente, respuesta en streaming (SSE) y feedback de clics |

## 1. Memoria: aprende de tres fuentes

1. **Del chat** (`extractFacts`): reconoce talla, medidas, estatura, presupuesto, color favorito,
   color a evitar, ocasión, estilo y para quién busca ("para mi novio" → caballeros).
   Cada repetición sube la confianza del hecho (`confidence` +0.10, tope 1.0) y su `hits`.
2. **De las compras** (`learnFromOrders`): analiza el historial real de pedidos y guarda con
   fuente `compras` la talla más comprada, colores, categorías habituales, ticket medio y nº de pedidos.
   Se ejecuta **una sola vez por cliente** (la primera vez que escribe), no en cada mensaje.
3. **De los clics** (`ai_events`): cada sugerencia cliqueada, añadida al carrito o comprada suma
   peso (1 / 2.5 / 4) durante 30 días y **reordena** las recomendaciones siguientes.

La memoria se guarda en `ai_memory`, con dos ámbitos: `user_id` para clientes registrados y
`session_key` para visitantes anónimos (así no se mezcla lo de dos desconocidos).

## 2. Contexto real de la base de datos

Antes de cada respuesta, `buildChatContext()` reúne (consultas baratas, en paralelo):

- **Perfil:** nombre, rol, nivel VIP, intereses declarados, puntos.
- **Pedidos recientes:** nº, estado, courier, guía y total (para "¿dónde está mi pedido?").
- **Carrito en vivo:** qué lleva y cuánto falta para el envío gratis.
- **Stock por talla y tienda** de las prendas que va a recomendar.
- **Ofertas activas:** cuántas prendas tienen descuento real *y* stock.

Con eso, Aria responde cosas que antes eran imposibles sin LLM: "¿qué llevo en el carrito?",
"¿dónde está mi pedido?", "¿qué sabes de mí?" (intenciones `cart`, `orders` y `memory`).

## 3. Internet, cuando la pregunta no es del catálogo

`needsWebSearch()` activa la búsqueda solo para preguntas de conocimiento
("¿qué es el smart casual?", "¿cómo se combina el denim?"), nunca para stock, tallas,
envíos o pedidos. Fuentes: **DuckDuckGo HTML** (resultados generales) con apoyo de
**Wikipedia ES**; sin API key y con caché en memoria + tabla `ai_web_cache` (6 h).

Las fuentes se muestran en la burbuja ("🔎 Fuentes: …") y el texto va al LLM delimitado y
marcado como **referencia externa no confiable**: se limpian entidades HTML y frases del tipo
"ignore previous instructions", y el prompt prohíbe tratar esa información como normas de VivaModa.

## 4. Fluidez: sesión persistente + streaming

- **Sesión persistente:** el frontend guarda `vm_ai_session` en `localStorage` y lo envía siempre.
  El servidor guarda cada turno en `ai_sessions` y **recarga el historial** (`loadHistory`), así que
  la conversación y la memoria sobreviven a recargas y cambios de página (antes cada mensaje
  abría una sesión nueva: Aria olvidaba todo).
- **Streaming SSE:** `POST /api/ai/chat/stream` emite `start`, `delta` (fragmentos de texto) y
  `done` (payload completo: sugerencias, memoria aprendida, fuentes, motor). El helper
  `VM.aiChat()` de `common.js` lo consume y cae al endpoint JSON clásico si el streaming falla.
  Sin proveedor LLM, el motor local también se emite por trozos (efecto de escritura).
- **Feedback:** cualquier enlace con `data-vm-sku` (chips de sugerencias) registra el interés vía
  `POST /api/ai/feedback` mediante un listener global.

## API nueva

| Ruta | Para qué |
|---|---|
| `POST /api/ai/chat/stream` | Chat en SSE (mismos parámetros que `/chat`) |
| `POST /api/ai/feedback` | `{ sku, event: clicked \| added_to_cart \| purchased, sessionKey }` |
| `GET /api/ai/memory?sessionKey=…` | Lo que Aria sabe del cliente (transparencia) |
| `GET /api/admin/ai/memory?q=` 🔒 | Memoria de todos agrupada por cliente + señales de interés |
| `PATCH /api/admin/ai/memory/:id` 🔒 | Corregir un hecho (`{ value }` → `confidence 1.0`, `source admin`) |
| `DELETE /api/admin/ai/memory/:id` 🔒 | Olvidar un hecho |
| `DELETE /api/admin/ai/memory` 🔒 | Olvidar todo lo de un cliente (`{ kind, id }`) |

## 5. Control desde el panel de admin

El asistente del panel tiene una pestaña nueva, **Memoria de Aria**, con:

- Resumen (`7 hechos aprendidos · 1 cliente · 1 sesión anónima · Compras: 4 · Conversación: 2 …`).
- Filtro instantáneo por cliente, clave o valor.
- Una tarjeta por dueño (cliente registrado o `Visitante <sesión>`), con cada hecho, su **fuente**
  (`Conversación`, `Compras`, `Corregido`) y la confianza en el tooltip.
- **Corregir en línea** (✏️) un valor: queda con confianza 100 % y fuente `admin`, y Aria lo usa
  en la siguiente respuesta. **Olvidar** (🗑️) un hecho o **Olvidar todo** de un cliente.
- Lista de **interés reciente**: los clics que suben prendas en las próximas recomendaciones.

> Las rutas de memoria del admin están tras `requireRole('admin')`: con una cuenta de cliente
> devuelven **403** (verificado).

## Evidencia de verificación (2026-10-01)

| Prueba | Resultado |
|---|---|
| Aprender de un mensaje | `learned: talla M · presupuesto $80 · color favorito negro · ocasión boda` |
| Memoria entre mensajes | "¿qué sabes de mí?" → lista los 5 hechos guardados |
| Memoria tras recargar | misma `sessionKey` → "ocasión: oficina · estilo: casual · talla: M · color favorito: rojo · presupuesto: $60" |
| Aprender de compras (BD) | `talla=M [compras] · categorias_compradas=Vestidos de Noche, Accesorios, Camisas · ticket_medio=$55.22` |
| Pedidos reales | "Tus últimos pedidos: VM-9106 (picking, $51.00) · VM-9105 · VM-9104" |
| Carrito real | "Llevas 1 prenda: Chaqueta Lluvia x2. Total $79.98 (ya tiene envío gratis)" |
| Internet | 4 resultados de DDG + 3 fuentes citadas en la respuesta |
| Aprendizaje por clics | tras clicar VM-DAM-FS16, esa prenda pasa de última a **primera** con motivo "lo miró antes" |
| Panel de admin | pestaña "Memoria de Aria": `7 hechos · 1 cliente · 1 sesión anónima`, corregir en línea → `source=admin, confidence=1.00`, olvidar → 8 → 7 hechos |
| Negaciones | "no me gusta el amarillo, prefiero el negro" → `color_evitar=amarillo` **y** `color_favorito=negro` |
| Streaming (navegador) | la burbuja crece 0 → 36 → 70 → … → 408 caracteres en vivo |
| Streaming SSE (proveedor LLM) | 39 fragmentos · primer token 55 ms · motor `gemini-2.5-flash · Gemini` |
| Sin proveedor | todo funciona con el motor local; `USE_LOCAL_AI=true` lo fuerza |

## Privacidad (importante para producción)

Cuando hay un proveedor LLM configurado, el contexto enviado incluye el **nombre del cliente,
sus pedidos (nº y estado), su carrito e intereses**. Es lo que permite respuestas personales,
pero conviene decidir explícitamente qué se comparte: para producción, redactar o limitar esos
campos y avisar en la política de privacidad.

## Cómo inspeccionarlo en vivo

```sql
-- lo que Aria ha aprendido
SELECT user_id, session_key, key, value, confidence, hits, source FROM ai_memory ORDER BY updated_at DESC;
-- interés registrado sobre las recomendaciones
SELECT sku, event, COUNT(*) FROM ai_events GROUP BY sku, event;
```

```bash
curl "http://localhost:3000/api/ai/memory?sessionKey=web-XXXX"
```

Para empezar de cero: botón de reinicio del hub (nueva `sessionKey`) y
`DELETE FROM ai_memory WHERE session_key = 'web-XXXX';`
