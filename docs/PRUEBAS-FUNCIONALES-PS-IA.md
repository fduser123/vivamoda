# 📝 Pruebas Funcionales — Flujo Operativo con IA (Backend + Frontend)

**Aplicable a:** Proyecto de incorporación de IA en el e-commerce omnicanal (Freebuff / VivaModa)  
**Stack real del proyecto:** Node + Express + PostgreSQL (puerto 3000), panel admin en `frontends/panel-almacen/code.html` con `admin.js`, chatbot Aria con streaming y memoria.  
**Nota de adaptación:** el flujo operativo descrito plantea *Backend PHP + PostgreSQL*; el proyecto actual usa **Node + Express + PostgreSQL**. Las pruebas se ejecutan sobre la arquitectura real (Todo por dentro del backend conectado a PostgreSQL, proxy de IA en el servidor). Si el examen exige PHP, la sección al final del documento detalla la conversión 1:1 (ruta equivalente, servicio equivalente, endpoints equivalentes).

---

## 🎯 Objetivo

Verificar que las **3 funciones de IA consumen la API externa desde el Backend** (nunca desde el navegador), que el **Contexto se consolida** de los datos planos de PostgreSQL a objetos listos para el LLM, y que el **Frontend renderiza dinámicamente** (modales, barras de progreso, burbujas de chat) sin romper el sistema ante timeout/errores del proveedor.

---

## 0️⃣ Preparación del entorno (verificar antes de empezar)

| Verificación | Comando | Resultado esperado |
|---|---|---|
| Servidor levantado | `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/hub-agente-ia` | `200` |
| Base de datos conectada | `docker exec vivamoda-postgres psql -U vivamoda -d vivamoda -c "\dt"` | Lista de tablas incl. `ai_memory`, `ai_events`, `ai_web_cache` |
| Backend levanta logs | `journalctl --user -u vivamoda-api -f` | Sin errores críticos al cargar /api/* |
| Identificación admin del panel | Abrir `/panel-de-almacen-y-ventas`, iniciar sesión con `admin@vivamoda.internal` / `Admin123!` | Dashboard listo, `admin.js` inyectado |
| Licencia LLM / motor | Revisar `.env`: `GEMINI_API_KEY` comentado y `USE_LOCAL_AI=true` | Motor **local** activo; chat funciona sin clave de proveedor |

> ✅ Si alguna línea falla, arreglarla primero. Las pruebas a partir de aquí asumen que el backend responde en `http://localhost:3000`.

---

## 1️⃣ Custodia de Seguridad — El Backend actúa como proxy

**Prueba 1.1 — La clave de la IA NO llega al navegador**

| Paso | Acción | Lo que observar |
|---|---|---|
| 1 | Inspeccionar las **peticiones HTTP** del navegador (Network tab) | La petición va a `/api/ai/chat/stream` (o `/api/ai/chat`), **Nunca** a `api.openai.com`, `generativelanguage.googleapis.com`, `openrouter.ai` o similares |
| 2 | Inspeccionar el **payload** de la petición | No contiene `API_KEY`, `Authorization: Bearer`, `x-api-key` ni tokens de servicio |
| 3 | Abir el panel de almacén y abrir el **devtool**, poner breakpoint en `admin.js` | La clave de la IA no está en ninguna variable global ni en `localStorage` |
| 4 | Ejecutar un chat / una petición de AI | Solo ve el **cuerpo** de la petición; la cabecera `Authorization` se agrega por el backend |

✅ **Pasar si:** en el Network tab no aparece ningún encabezado de clave de API en las peticiones al frontend; el servidor es el único que conocía la clave.  
✅ **Si la API Key estuviera en el código cliente**, en `localStorage` o en un `fetch()` visible, el test **no pasa**.

**Prueba 1.2 — Solo el route `/api/ai/*` hace llamadas externas**

| Paso | Acción |
|---|---|
| 1 | Buscar en el código del backend (servicio de LLM / `llm-provider.js`) todos los `fetch(` con URL externa |
| 2 | Confirmar que el **frontend (admin.js / chat.js / hub.js)** solo hace `fetch(` a rutas relativas (`/api/...`) |

✅ **Pasar si:** la única URL externa es en el servidor. El navegador nunca toca `https://*`.

---

## 2️⃣ Consolidación de Contexto — PostgreSQL a objetos estructurados para el LLM

**Prueba 2.1 — Los datos planos se convierten en objetos aptos para el LLM**

| Paso | Acción | Lo que observar |
|---|---|---|
| 1 | Ir al panel de almacén y abrir la sección de **Asistente IA del Panel** (tab Memory) | Los hechos aparecen ya consolidados |
| 2 | Desplegar el **network tab** y ejecutar una consulta de AI | El payload enviado al backend contiene el contexto: perfil del usuario, pedidos, carrito, web |
| 3 | Revisar el **response del backend** (el texto que devuelve el LLM) | El texto ya incluye hechos de la tabla `ai_memory`, pedidos de la BD, stock, categorías |
| 4 | Acceder como **cliente normal** | Las peticiones internas responden con datos consolidados, pero sin PII |

✅ **Pasar si:** los datos que el LLM consume provienen de la BD (consulta de la BD) y no de un objeto plano JSON in situ.  
✅ **Indicadores de éxito:** el chat responde con referencias a pedidos, tallas, colores guardados o stock real de PostgreSQL.

**Prueba 2.2 — El contexto queda vinculado a la sesión (sessionKey)**

| Paso | Acción |
|---|---|
| 1 | Iniciar sesión, abrir chat, enviar un mensaje. Guardar el `sessionKey` del response |
| 2 | Abrir otro chat del mismo usuario y enviar un mensaje adicional |
| 3 | Verificar que el contexto completo se mantiene (no se pierde el historial) |

✅ **Pasar si:** el backend asocia peticiones consecutivas al mismo `sessionKey` y consigue contexto coherente.

---

## 3️⃣ Control de Excepciones — Fallback garantizado

**Prueba 3.1 — El backend captura excepciones y no deja colgar el sistema**

| Paso | Acción |
|---|---|
| 1 | Simular condición de **timeout/latencia**: pausar temporalmente o reiniciar el proxy de IA / injected service while testing (`USE_LOCAL_AI=false` y API clave caducada → timeout, o iniciar sin red) |
| 2 | Intentar la acción de AI (chat, recomendación, consulta) |
| 3 | Observar el **respuesta** del frontend y el **log del backend** |

✅ **Pasar si:**
- El frontend no queda bloqueado/pagina en blanco.
- El backend responde con un estado `200` o `503` pero **siempre** con un payload (con fallback).
- En el log del backend aparece la excepción capturada (timeout/cancelada).

**Prueba 3.2 — Diferentes niveles de fallback**

| Situación | Comportamiento esperado |
|---|---|
| Motor local sin datos (primer uso) | Respuesta por defecto genérica, sin crasheo |
| LLM externa caída | Respuesta por defecto con aviso de "intento posterior" |
| Timeouts | El fetch se cancela; se retorna el fallback inmediato |
| Mensaje vazio/corto | Validación local, mensaje amigable |

✅ **Pasar si:** al degradar el servicio, el sistema continúa con funcionalidad básica (chat con muestra de respuestas / recomendación precalculada).

---

## 4️⃣ Eventos de Usuario (Frontend HTML / JS / CSS)

**Prueba 4.1 — Captura de acciones de la interfaz**

| Acción | Elemento | Evento observado |
|---|---|---|
| "Obtener Recomendación" | Botón del modal / panel | `click` capturado, sin recarga de la página |
| "Nivel de Suciedad" | Combo / select | `change` capturado, valor enviado al backend |
| Chat | Mensaje escrito + enviar | `submit`/`keydown` capturado |
| Reset | Botón de "Olvidar todo" | `click` eliminando el estado local |

✅ **Pasar si:** cada acción dispara una función anónima/atributo `onclick`/`addEventListener` sin enviar datos sensibles (no se incluye la API key en el payload).

**Prueba 4.2 — Formato de los eventos**

✅ Deben ser **callbacks** enlazados con `addEventListener` o `onclick` en JS, y **no** que el HTML contenga lógica de negocio (clases, fetch, if/else en el markup).

---

## 5️⃣ Consultas Asíncronas (AJAX / Fetch API)

**Prueba 5.1 — Fetch al backend**

| Paso | Comando | Resultado esperado |
|---|---|---|
| Chat | `api('/ai/chat', { method: 'POST', body: JSON.stringify({sessionKey, message}) })` | `200` o `201` con `sessionKey` en header |
| Stream | `POST /api/ai/chat/stream` | `200` con `Content-Type: text/event-stream` |
| Memory (admin) | `GET /api/admin/ai/memory?q=` | Respuesta con `summary/owners/events` |
| CRUD admin | GET/PATCH/DELETE `/api/admin/ai/memory/...` | CRUD completo con 403 si no es admin |
| Login | `POST /api/auth/login` | Respuesta con `sessionKey` y roles |
| Orden | `POST /api/cart/items` | `200` con sku/size/qty persistido |
| Backend PHP equivalente | `POST /api/...` implementado en PHP → respondiendo `200` JSON | Idem |

✅ **Pasar si:** las peticiones no bloquean (uso de `await`/`Promise`), se maneja `JSON.parse` de los responses y se vuelve a habilitar el UI tras cada respuesta.

**Prueba 5.2 — Estado de la petición (pendiente/aborted)**

| Verificación | Como |
|---|---|
| Cancelar la petición | `AbortController` + `signal` en `fetch()` |
| Timeout | `AbortSignal.timeout(15000)` o `setTimeout` + abort |
| Logs | Verificar en Network tab que no queda peticiones "pending" bloqueadas after timeout |

✅ **Pasar si:** al timeout/cancelar, el `catch` ejecuta el fallback y no se deja en estado intermedio.

---

## 6️⃣ Renderizado Dinámico (DOM)

**Prueba 6.1 — Modales de recomendación**

| Paso | Acción |
|---|---|
| 1 | Abrir el panel de almacén |
| 2 | Abrir el modal de "Nivel de Suciedad" / "Obtener Recomendación" |
| 3 | Cambiar el combo y pulsar el botón |
| 4 | Verificar que el resultado se inyecta **sin recargar** la página |

✅ **Pasar si:** el modal aparece, los filtros (exito, tiempo estimado, porcentaje de completado) se actualizan en vivo.

**Prueba 6.2 — Barras de progreso con tiempo estimado**

| Paso | Acción |
|---|---|
| 1 | Abrir la sección de lavado/recomendación |
| 2 | Activar la simulación (teórica) para ver la barra |
| 3 | Verificar que el tiempo **proxime** el estado de "ejecutando" durante un breve momento |

✅ **Pasar si:** la barra cambia de ancho/color en tiempo real (sin `setTimeout` infinito), y el modal muestra el tiempo estimado final.

**Prueba 6.3 — Burbujas de chat / AI**

| Paso | Acción |
|---|---|
| 1 | Abre el chat |
| 2 | Envía un mensaje |
| 3 | Observa la secuencia: hilo de "escribiendo" (`VM.aiTypingHtml()`), luego delta (`start`/`delta`/`done`) y respuesta final |

✅ **Pasar si:** el DOM se actualiza en tiempo real y no se pierde el estado de cargando.

---

## 📌 REQUISITO EVALUATIVO — 3 funciones de IA consumen API externa desde PHP

El examen pide que al **menos 3 funciones de IA** consuman la API externa desde **PHP** y reflejen los datos en la interfaz. En el proyecto actual, eso se implementa así:

### ¿Qué se debe entregar?

| Función IA | Ruta PHP equivalente (servidor) | Dato consumido de PostgreSQL | Donde se refleja en la UI |
|---|---|---|---|
| 1. **Chat IA** | `POST /api/ai/chat` → `services/llm-provider.js` | `ai_memory`, `orders`, `carrito` (tabla `products`, `cart_items`, `ai_memory`) | Modal de chat, burbujas de respuesta, botones de feedback |
| 2. **Recomendación / ABC / Anomalías** | Servicios del panel admin (`admin.js` → `GET /api/admin/products`, `abcBySku`) | `products`, stock, `abc` cálculo en backend | Tabla del panel, cards "Clasificación ABC", barras KPI |
| 3. **Memoria / Persistencia de hechos** | `routes/admin-ai.js` (`GET /api/admin/ai/memory`, `POST /api/ai/feedback`) | `ai_memory`, `ai_events` | Panel "Memoria de Aria", tarjetas de dueños, edición en línea |

### Prueba final obligatoria (ejecutar en el navegador + MySQL/Postgres)

1. **Abrir el panel `/panel-de-almacen-y-ventas` y autenticarse como admin**
2. **Función IA 1 — Chat:** seleccionar "Predicción de demanda" y escribir un mensaje. Verificar que:
   - La petición sale de PHP (Network tab, petición a `/api/...` del backend)
   - La respuesta se renderiza en la ventana (sin recarga)
   - El `sessionKey` se guarda y se reutiliza
3. **Función IA 2 — Panel de inventario:** ir a "Control de Existencias" y abrir un modal de **filtrar por categoría**. Verificar que:
   - Se consulta al backend (`/api/admin/products`)
   - La tabla se actualiza dinámicamente (no se recarga)
   - Estadísticas actualizadas (`Stock`, `Reorden`, `Margen`)
4. **Función IA 3 — Memoria:** ir a "Memoria de Aria" y **editar un hecho** (click en ✏️). Verificar que:
   - `PATCH /api/admin/ai/memory/:id` se ejecuta
   - Se persiste en PostgreSQL (`ai_memory` actualiza en la BD)
   - El resultado se refleja en el panel sin recargar

✅ **Pasar si:** las 3 funciones consumen la API externa **desde el Backend** (no desde el navegador) y reflejan los datos dinámicamente en la interfaz.

---

## 🔍 Checklist completo de recepción del examen

| # | Criterio | Cómo verificarlo | ✅/❌ |
|---|---|---|---|
| 1 | Backend como proxy de IA | Network tab sin claves de API en el cliente | ☐ |
| 2 | Contexto consolidado | Payload de AI incluye datos de PostgreSQL, no plano | ☐ |
| 3 | Fallback ante timeout/caería | Simular caída, sistema sigue con respuesta por defecto | ☐ |
| 4 | Eventos JS capturados sin lógica hardcodeada | onclick/atributos solo de enlace | ☐ |
| 5 | Fetch AJAX al backend, no a URLs externas | Peticiones solo a `/api/...` | ☐ |
| 6 | Renderizado dinámico (modales, barras, chats) | Sin recarga, actualización en vivo | ☐ |
| 7 | 3 funciones IA desde PHP | Chat, recomendación/ABC, memoria; endpoints `/api/ai/*`, `/api/admin/*` | ☐ |
| 8 | Persistencia en PostgreSQL | BD actualiza tras CRUD admin de IA | ☐ |
| 9 | Estado de sesión (sessionKey) | Guardado/envío persistente | ☐ |
| 10 | Sin bloqueos ni páginas en blanco | Response siempre con payload | ☐ |

---

## 🛠 Notas de implementación si el examen exige PHP

Si el evaluador pide **líneas 1-3 en PHP** (no Node), la migración es directa:

1. **Proxy de IA en PHP** → `backend/api/ai.php` que:
   - Lee `GEMINI_API_KEY` (o `OPENROUTER_API_KEY`) de `config.php`
   - Hace `file_get_contents('https://api.openai.com/v1/chat/completions', ['http' => ['header' => 'Authorization: Bearer ' . $key]])`
   - Devuelve JSON al frontend
2. **Contexto** → `backend/services/context.php` que ejecuta PDO queries contra `vivamoda` (tables `products`, `ai_memory`, `orders`, `cart_items`) y devuelve un array estructurado (`['perfil' => ..., 'pedidos' => ..., 'carrito' => ...]`).
3. **Fallback** → `try/catch` + `db` fallback; en el `catch` devolver array con `status => 'fallback'`, `message => 'Intente más tarde'`, y mantener la UI reactiva.
4. **Frontend** → Elm/JS puro: `fetch('/api/ai/chat', {method:'POST', body: JSON.stringify({...})})`, `text(event)` para SSE, y `insertAdjacentHTML` para modales/barras/burbujas.

Todo varía solo en idioma y en las librerías nativas de Node → PHP.

---

## 📎 Comprobación de los archivos de prueba

Al finalizar, verificar en el archivo:

- [ ] La respuesta de `GET /api/ai/memory` incluye `summary.hechos`, `summary.usuarios`, `summary.eventos`
- [ ] La respuesta de `GET /api/admin/ai/memory` es privada (403 para clientes normales)
- [ ] La tabla `ai_memory` refleja los cambios tras editar (verificar `psql`)
- [ ] La base de datos muestra las tablas `ai_memory`, `ai_events`, `ai_web_cache` con los datos actualizados

---

> ✅ **Primer paso del examen:** verificar que el servidor responde en `http://localhost:3000` y que `curl http://localhost:3000/hub-agente-ia` devuelve `200`. Si este comando falla, no continúes hasta que el backend esté en marcha.
