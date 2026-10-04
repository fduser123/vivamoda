# ESPECIFICACIÓN TÉCNICA Y GUÍA DE AVANCE DEL PROYECTO

**Avance del Examen Parcial: Plataforma Omnicanal de Moda VivaModa con Integración de IA (Opción 1 – Enfoque Ligero API)**

| | |
|---|---|
| **Curso** | Gobiernos y Gestión de TI / Inteligencia Artificial |
| **Evaluación** | Avance de Examen Parcial |
| **Arquitectura Target** | Opción 1 – API SaaS (Node.js + PostgreSQL + LLM API vía OpenRouter) |
| **Fecha** | Semestre Académico 2026-II |

> **Nota de equivalencia tecnológica:** la especificación original de referencia (Sistema Carwash, Opción 1) contempla backend **PHP**. VivaModa implementa el **mismo enfoque ligero de API SaaS** con **Node.js + Express**, que cumple el rol idéntico: proxy seguro de la API de IA, orquestación de consultas SQL y render de datos dinámicos. Las equivalencias se indican donde corresponde.

---

## 1. Definición del Problema Complejo

Las marcas de moda omnicanal (tienda web, POS en tienda física, almacén y venta por catálogo) enfrentan importantes ineficiencias dinámicas en la gestión comercial y de experiencia del cliente. Los modelos tradicionales de e-commerce sufren de recomendaciones impersonales, fricción en la compra por incertidumbre de tallas y una atención al cliente costosa y saturada.

A continuación se detallan los **tres problemas complejos fundamentales** que el sistema resuelve:

### 1.1. Baja Venta Cruzada y Recomendaciones Genéricas
Los clientes no reciben sugerencias basadas en la ocasión de uso, su historial de navegación, el producto que están viendo o sus intereses declarados, lo que desperdicia oportunidades de venta de alto valor (accesorios que completan el look, calzado de gala, prendas de colecciones premium) y reduce el ticket promedio.

### 1.2. Incertidumbre de Talla y Devoluciones Evitables
La principal barrera de compra en moda online es *"¿qué talla soy?"*. La ausencia de una estimación confiable genera carritos abandonados, devoluciones logísticamente costosas (recogida a domicilio, re-procesado en almacén) y pérdida de confianza en la marca.

### 1.3. Atención al Cliente Saturada e Ineficiente
Las consultas recurrentes (precios, disponibilidad de stock, tallas, envíos, devoluciones, estados de pedido) colapsan las vías tradicionales (WhatsApp, llamadas, correo), restando tiempo operativo al personal de tienda y almacén, especialmente en campañas (Ofertas Flash, nueva temporada).

---

## 2. Definición del Aplicativo Web Básico

El proyecto se estructura como una **aplicación web monolítica ligera pero escalable**, diseñada para operar de forma ágil bajo el enfoque de API SaaS de la empresa:

| Capa de Arquitectura | Tecnología Seleccionada | Rol en el Sistema |
|---|---|---|
| **Frontend (Interfaz)** | HTML5, CSS3, JavaScript vanilla (mockups de diseño servidos intactos + *wiring* inyectado con Fetch/AJAX) | Interfaz dinámica para clientes, cajeros POS y administradores. Captura de eventos y actualización asíncrona (Fetch API) sin recargar la página. |
| **Backend (Lógica)** | Node.js ≥ 18 (equivalente al rol de PHP en la Opción 1) + Express 4 | Procesamiento de lógica de negocio, autenticación JWT con roles (client · staff · admin), orquestación de consultas y comunicación HTTPS con la API de IA (OpenRouter, API compatible con OpenAI). |
| **Base de Datos** | PostgreSQL 16 (contenedor Docker `postgres:16-alpine`) | Almacenamiento relacional de usuarios, tiendas, catálogo, variantes, inventario multitienda, pedidos POS/web, carritos, favoritos y las sesiones/interacciones generadas por la IA. |

**Puntos de contacto del sistema (mockups conectados a la API real):**

| Módulo | Ruta | Rol |
|---|---|---|
| 🛍️ Tienda & Catálogo | `/catalogo-de-productos` (+ caballeros, niños, novedades, ofertas) | Vitrina pública con datos SQL en vivo |
| 👗 Detalle + Estilista IA | `/detalle-de-producto?sku=…` | Ficha con variantes, stock y recomendador contextual |
| 🤖 Hub de Agentes IA | `/hub-agente-ia` | Chat del estilista "Aria" + calculadora de tallas + métricas |
| 🔐 Portal de acceso | `/iniciar-sesion` · `/registro` | Autenticación cliente/staff (correo o código `STF-…`) |
| 🧾 Consola POS & Pedidos | `/pedidos-y-pos` | Venta en mostrador y kanban de estados de pedido |
| 📦 Panel Almacén & Ventas | `/panel-de-almacen-y-ventas` | KPIs, CRUD de productos y ajustes de inventario |
| 🥽 Tienda VR | `/tienda-virtual-realidad` | Showroom inmersivo con perfil de cliente |

---

## 3. Caracterización de Requerimientos Funcionales con IA (3 Funciones)

En concordancia con los lineamientos del examen parcial, la Opción 1 integra **Inteligencia Artificial Generativa y Predictiva a través de API externa** en tres módulos del sistema:

### RF-IA-01: Recomendación Inteligente de Outfits y Venta Cruzada *(Proceso Comercial)*
- **Descripción:** Analiza automáticamente el mensaje del cliente (ocasión: boda, cóctel, oficina, gimnasio…), el producto contextual que está viendo (`productContext`) y el catálogo activo en PostgreSQL para generar **hasta 3 sugerencias de prendas personalizadas** (`suggestions`) renderizadas como tarjetas con precio, rating y stock real.
- **Subproceso / Actividades:** El backend Node.js ejecuta consultas SQL filtradas (género, categoría, disponibilidad de stock, visibilidad `store`) sobre el pool de `pg`, ensambla un prompt estructurado con el contexto del catálogo y lo envía a la API de IA (OpenRouter). La IA responde en texto Markdown validado (máx. 90 palabras) que el frontend renderiza junto a las tarjetas de productos reales.
- **Componente IA:** Integración de API de LLM (OpenRouter — `meta-llama/llama-3.3-70b-instruct` por defecto, configurable con `OPENROUTER_MODEL`) con contexto recuperado por SQL (patrón RAG ligero).
- **Endpoint:** `POST /api/ai/chat` con `productContext`.

### RF-IA-02: Estimación Dinámica de Talla *(Proceso Operativo / Preventa)*
- **Descripción:** Calcula la talla recomendada y un **factor de confianza** a partir de la condición física declarada por el cliente (estatura, peso, contorno de busto y cadera), replicando el criterio del vendedor experto en tienda física.
- **Subproceso / Actividades:** El cliente ingresa sus parámetros biométricos en la calculadora (hub IA y ficha de producto). El backend aplica el motor heurístico de reglas calibrado con la guía de tallas de la marca (busto ≤84=XS, ≤90=S, ≤96=M, ≤102=L, >102=XL; ajuste +1 talla si el peso supera 80 kg) y devuelve talla + nivel de confianza + mensaje orientado a la compra. Este mismo criterio se inyecta en el System Prompt del LLM para que el asistente converse con la misma regla.
- **Componente IA:** Análisis heurístico mediante reglas + Prompting delimitado en la API externa (la calculadora funciona incluso sin LLM: motor local determinista).
- **Endpoint:** `POST /api/ai/size` con `{ height, weight, bust, hips }`.

### RF-IA-03: Asistente Virtual y Atención Rápida *(Actividad de Servicio al Cliente)*
- **Descripción:** Módulo de **chat interactivo** integrado en el frontend (hub IA y burbuja en detalle de producto) que resuelve dudas frecuentes sobre precios, tallas, envíos (express 24-48 h gratis > $49.99, retiro en tienda 2 h), devoluciones (30 días), ofertas y combinación de outfits.
- **Subproceso / Actividades:** El cliente envía un mensaje desde el widget. JavaScript lo reenvía vía Fetch al backend, el cual **inyecta un System Prompt restringido con las políticas oficiales de la marca** (9 reglas: idioma, tono, límite de palabras, formato de moneda USD, prohibición de inventar productos, uso exclusivo del contexto SQL, reglas de envíos/devoluciones, cierre con pregunta, emojis) antes de llamar a la API externa. La intención se clasifica localmente (`size`, `shoes`, `shipping`, `returns`, `deals`, `accessorize`, `greeting`, `outfit`) y cada conversación se persiste en la base (últimos 40 mensajes).
- **Componente IA:** Modelo de lenguaje conversacional con **System Prompt delimitado (Guardrails de contexto)** + fallback automático al motor local de reglas si la API falla (timeout, cuota o red), reportando `llmError` para diagnóstico.
- **Endpoint:** `POST /api/ai/chat` · métricas en `GET /api/ai/stats`.

> **Función adicional (bonus):** traducción editorial automática de nombres y descripciones del catálogo externo (`services/translator.js`) al importar productos de DummyJSON, usando el mismo LLM con caída a diccionario local sin red.

---

## 4. Esquema de Base de Datos Relacional (PostgreSQL)

El esquema relacional (auto-aplicado al arrancar desde `src/schema.sql`) soporta la operación básica y **almacena las trazas e interacciones generadas por la Inteligencia Artificial**:

| Tabla | Campos Clave / Atributos | Relación / Descripción |
|---|---|---|
| `stores` | id (PK), code (CENTRAL·CENTRO·NORTE·ONLINE), name, city, channel | Catálogo de sucursales. 1 a N con `inventory` y `orders`. |
| `users` | id (PK), email (único), password_hash (bcrypt), full_name, role (client·staff·admin), employee_code (STF-XXXXX), store_id (FK), interests, vip_tier, points | 1 a N con `orders`, `carts`, `ai_sessions`. Roles y asignación de tienda para staff. |
| `products` | id (PK), sku (único), name, gender, category, badge, description, details (JSONB), price, compare_at, rating, review_count, visibility (store·ops) | Catálogo oficial. 1 a N con `product_images` y `product_variants`. |
| `product_images` | id (PK), product_id (FK), url, position | Galería de cada producto. |
| `product_variants` | id (PK), product_id (FK), size, color, sku | Tallas y colores. 1 a N con `inventory`. |
| `inventory` | id (PK), variant_id (FK), store_id (FK), qty, reorder_point | Stock multitienda por variante (único por variante+tienda). |
| `orders` | id (PK), order_no (VM-9082), user_id (FK), store_id (FK), channel (web·mostrador·whatsapp…), status, customer_name, payment_method, subtotal, tax, total, **ai_assisted (BOOLEAN)** | Registra cada venta web o POS. El campo `ai_assisted` marca pedidos influidos por la IA (traza de recomendación). |
| `order_items` | id (PK), order_id (FK), product_id (FK), variant_id (FK), product_name, sku, size, unit_price, qty | N a M entre `orders` y `products`: paquetes/prendas contratadas con precio aplicado. |
| `carts` / `cart_items` | cart: user_id (FK, único) · item: cart_id (FK), product_id (FK), variant_id (FK), qty | Carrito persistente por cliente (con soporte invitado en frontend). |
| `wishlists` | user_id (FK), product_id (FK), created_at (PK compuesto) | Favoritos del cliente. |
| **`ai_sessions`** | id (PK), user_id (FK), session_key, product_sku, **messages (JSONB)**, rating, csat | **Equivalente al `ia_log` de la especificación:** almacena cada conversación, intención detectada y respuesta generada por la API de IA, con calificación del cliente (CSAT). |
| `vr_user_prefs` | user_id (PK/FK), favorite_sku | Preferencias del showroom VR. |

Índices de desempeño sobre `products(gender, category, is_active)`, `inventory(variant_id, store_id)`, `orders(status, store_id, user_id)` y `order_items(order_id)`.

---

## 5. Procedimiento Detallado de Integración (API Externa)

El flujo de integración técnica bajo el Enfoque Ligero de la Opción 1 se divide en **5 etapas secuenciales** (implementadas en `src/services/llm.js`, `src/services/stylist.js` y `src/routes/ai.js`):

- **Paso 1 — Configuración de Credenciales y Entorno:** la API Key se genera en el proveedor (OpenRouter; también se acepta `OPENAI_API_KEY`) y se almacena en `backend/.env` junto a `OPENROUTER_MODEL`, **garantizando que nunca se exponga en el código JavaScript del cliente** (el navegador solo habla con `/api/ai/*`).

- **Paso 2 — Extracción de Contexto Local (SQL):** al activarse un evento en la web (envío de chat, consulta de talla, apertura de ficha de producto), el backend ejecuta consultas a PostgreSQL (`searchProducts` con pool `pg`) para extraer catálogo activo con stock real, rating y el producto ancla del contexto.

- **Paso 3 — Construcción y Delimitación del Prompt (System Prompting):** el backend construye la estructura de prompt que incluye: (a) **rol** de la IA ("Aria, estilista virtual de VivaModa"), (b) **reglas operativas estrictas** (9 guardrails), (c) **datos del cliente/catálogo extraídos de PostgreSQL**, y (d) **formato de salida requerido** (Markdown acotado, precios USD, cita exacta de productos del contexto).

- **Paso 4 — Consumo REST/HTTPS con Fetch nativo:** el servidor realiza la solicitud `POST` hacia `https://openrouter.ai/api/v1/chat/completions` con payload JSON y **autenticación Bearer Token**, incluyendo `AbortController` con timeout de 45 s y **2 reintentos con backoff** ante fallos transitorios de red (equivalente al rol de cURL/Guzzle en PHP).

- **Paso 5 — Validación, Almacenamiento y Renderizado:** el backend valida/normaliza la respuesta (texto + sugerencias de productos reales), **guarda el log en la columna `messages` (JSONB) de `ai_sessions`** con la intención detectada, y transmite los datos procesados al frontend para su despliegue dinámico (burbujas de chat, tarjetas de recomendación, resultado de calculadora).

---

## 6. Explicación del Funcionamiento Arquitectónico (Backend y Frontend)

### Flujo Operativo en el Backend (Node.js + PostgreSQL)
1. **Custodia de Seguridad:** el backend actúa como intermediario seguro (Proxy), evitando que las API Keys de la IA se expongan en el navegador del usuario. Toda llamada del cliente pasa por `/api/ai/chat` o `/api/ai/size`.
2. **Consolidación de Contexto:** transforma los datos relacionales planos de PostgreSQL (catálogo, stock por tienda, producto ancla, historial de conversación) en objetos estructurados aptos para consumo de LLMs.
3. **Control de Excepciones:** si la API de IA experimenta latencia o caída (timeout, cuota, red), el backend captura la excepción tras los reintentos y **retorna la respuesta del motor local de reglas (Fallback)**, garantizando que la plataforma continúe funcionando sin interrupciones; la respuesta incluye `llmError` y el hub IA muestra el motor activo (`provider: openrouter | local`). Se puede forzar con `USE_LOCAL_AI=true`.
4. **Operación autosuficiente:** al primer arranque crea el esquema (`ensureSchema`) y siembra datos demo (productos, pedidos, usuarios) automáticamente; la API de salud (`GET /api/health`) verifica la base.

### Flujo Operativo en el Frontend (HTML / JS / CSS)
1. **Eventos de Usuario:** captura acciones de la interfaz mediante JavaScript (envío del mensaje al estilista, cambio de talla/color, clic en "Calcular mi talla", filtros de vitrina).
2. **Consultas Asíncronas (Fetch API):** envía peticiones HTTP no bloqueantes hacia las rutas REST expuestas por el backend Express, adjuntando el JWT cuando hay sesión (`Authorization: Bearer <token>`).
3. **Renderizado Dinámico:** manipula el DOM para mostrar burbujas en el chat de soporte, tarjetas de recomendación con productos reales, resultado de talla con barra de confianza, badges del carrito y kanban del POS.

> 📌 **REQUISITO EVALUATIVO PARA EL EXAMEN PARCIAL — CUMPLIMIENTO:** la ejecución funcional demuestra que las **3 funciones de IA consumen la API externa desde el backend** (Node.js, rol equivalente a PHP en la Opción 1) y **reflejan los datos dinámicamente en la interfaz**: (1) recomendador con contexto SQL → tarjetas en chat/detalle; (2) calculadora de tallas → resultado con confianza; (3) asistente conversacional con guardrails → hub IA; con persistencia de trazas en `ai_sessions` y fallback local verificable.

---

## 7. La Aplicación Web con IA vs. sin IA (Comparativa Operativa)

Para dimensionar el aporte de las tres funciones de IA (RF-IA-01, RF-IA-02 y RF-IA-03), se contrasta el comportamiento de cada módulo de la plataforma en sus dos escenarios de operación:

### 7.1. Aplicación Web SIN IA (operación tradicional)

| Módulo / Flujo | Comportamiento sin IA | Consecuencia en el negocio |
|---|---|---|
| 🛍️ Catálogo y vitrinas | Lista estática filtrable por género/categoría/precio; búsqueda solo por coincidencia de texto exacto. | El cliente navega sin guía de estilo; menor conversión y abandonos en la exploración. |
| 👗 Detalle de producto | Ficha con fotos, precio y tabla de medidas genérica; sin sugerencias de conjuntos ni accesorios. | Oportunidades de venta cruzada perdidas; ticket promedio limitado a la prenda única. |
| 📏 Elección de talla | El cliente consulta una tabla de medidas PDF y "adivina" su talla; sin calculadora ni confianza numérica. | Devoluciones y cambios evitables (logística de recogida y re-procesado), carritos abandonados. |
| 💬 Atención al cliente | Solo canales tradicionales (WhatsApp, llamadas, correo) en horario del personal; respuestas manuales repetitivas. | Consultas recurrentes saturan al equipo; demoras en responder fuera de horario; fricción en la compra. |
| 🧾 POS en tienda | El cajero vende según catálogo y memoria propia; sin recomendaciones contextuales del perfil del cliente. | Menor captura de ventas adicionales en mostrador; experiencia desigual entre cajeros. |
| 📦 Panel almacén | KPIs solo de ventas y stock físico; sin visibilidad de la influencia del asistente en los pedidos. | Decisiones comerciales sin evidencia del impacto de las recomendaciones. |
| 🤖 Hub de agentes | Sección informativa estática; sin chat, sin calculadora, sin métricas de interacción. | La innovación no es tangible para el evaluador ni útil para el cliente. |

### 7.2. Aplicación Web CON IA (operación inteligente — estado actual del proyecto)

| Módulo / Flujo | Comportamiento con IA integrada | Beneficio obtenido |
|---|---|---|
| 🛍️ Catálogo y vitrinas | **Aria** recomienda hasta 3 prendas reales del catálogo SQL según la ocasión declarada (boda, cóctel, oficina, gym…) con precio, rating y stock en vivo (**RF-IA-01**). | Venta cruzada efectiva y descubrimiento guiado; mayor conversión y ticket promedio. |
| 👗 Detalle de producto | Recomendador contextual: el chat toma el producto ancla (`productContext`) y sugiere complementos coherentes del look. | Cada ficha se convierte en un vendedor experto disponible 24/7. |
| 📏 Elección de talla | Calculadora biométrica (estatura, peso, busto, cadera) que devuelve talla + nivel de confianza con la regla de la marca (**RF-IA-02**); el LLM conversa con la misma regla. | Menos devoluciones evitables; el cliente compra con seguridad en el primer intento. |
| 💬 Atención al cliente | Chat con **System Prompt de guardrails** que responde precios, envíos, devoluciones, ofertas y tallas; intención clasificada y sesiones persistidas en `ai_sessions` (**RF-IA-03**). | Descarga del personal clave, respuesta inmediata e ilimitada; trazas auditables con CSAT. |
| 🧾 POS en tienda | Pedidos influidos por recomendaciones marcados con `ai_assisted = true`; staff con contexto del cliente. | Evidencia del impacto de la IA en la venta omnicanal real. |
| 📦 Panel almacén | KPIs operativos + métricas del hub IA (intenciones más consultadas, motor activo, latencia del LLM). | Decisiones comerciales y de inventario apoyadas en datos de interacción. |
| 🤖 Hub de agentes | Chat funcional, calculadora de tallas y tablero de métricas; **fallback automático al motor local** si la API externa falla. | Innovación tangible y operación continua sin interrupciones (RNF-06). |

> **Conclusión comparativa:** sin IA la plataforma es un e-commerce transaccional competente pero impersonal; con IA cada punto de contacto (vitrina, ficha, chat, POS) gana capacidad de recomendación y autonomía de atención, lo que ataca directamente los tres problemas complejos definidos en la sección 1.

---

## 8. Requerimientos Funcionales (Generales)

| Código | Requerimiento | Módulo | Prioridad |
|---|---|---|---|
| RF-01 | Registrar cuentas `client` y `staff` (con selección de tienda y código de empleado) | Auth | Alta |
| RF-02 | Iniciar sesión con **correo o código de empleado** (`STF-XXXXX`) y contraseña; emitir JWT | Auth | Alta |
| RF-03 | Consultar perfil propio y actualizarlo (`GET/PUT /api/auth/me`) | Auth | Media |
| RF-04 | Listar catálogo con filtros (género, categoría, búsqueda, talla, precio máximo, orden) y paginación | Catálogo | Alta |
| RF-05 | Navegar por departamentos con conteos (`/api/categories`) | Catálogo | Media |
| RF-06 | Ver ficha de producto con galería, variantes, tallas, contenido y **stock real por tienda** | Catálogo | Alta |
| RF-07 | Gestionar carrito persistente (agregar/quitar ítems; soporte invitado en frontend) | Carrito | Alta |
| RF-08 | Crear pedidos web desde el carrito y consultar el historial propio | Pedidos | Alta |
| RF-09 | Registrar ventas POS en mostrador que **descuenten inventario** en tiempo real | POS | Alta |
| RF-10 | Visualizar kanban de pedidos por estado y avanzar estados (pendiente→picking→packed→…) | POS | Alta |
| RF-11 | Dashboard de KPIs de ventas, stock y cumplimiento (rol admin) | Admin | Alta |
| RF-12 | CRUD de productos y ajustes de inventario con punto de reorden (rol admin) | Admin | Alta |
| RF-13 | Gestionar lista de favoritos (wishlist) del cliente | Tienda | Baja |
| RF-14 | Experiencia de showroom VR con perfil y producto favorito del cliente | VR | Baja |
| RF-15 | **RF-IA-01 · Recomendación inteligente de outfits con venta cruzada** (ver §3) | IA | Alta |
| RF-16 | **RF-IA-02 · Estimación dinámica de talla con nivel de confianza** (ver §3) | IA | Alta |
| RF-17 | **RF-IA-03 · Asistente virtual conversacional con guardrails y persistencia** (ver §3) | IA | Alta |
| RF-18 | Importar catálogo externo (DummyJSON) en USD con traducción al español (idempotente) | Carga | Baja |
| RF-19 | Verificar el estado del servicio y de la base (`GET /api/health`) | Operación | Media |

---

## 9. Requerimientos No Funcionales

| Código | Categoría | Requerimiento | Prioridad |
|---|---|---|---|
| RNF-01 | **Seguridad** | Contraseñas almacenadas con hash **bcrypt**; nunca en texto plano. | Alta |
| RNF-02 | **Seguridad** | Autenticación stateless con **JWT** (expiración 12 h) y control de acceso por roles (`client` · `staff` · `admin`) en endpoints sensibles. | Alta |
| RNF-03 | **Seguridad** | Las credenciales de la API de IA viven **solo en `backend/.env`** (fuera del código y del cliente); el backend es proxy obligatorio. | Alta |
| RNF-04 | **Seguridad** | Validación y saneamiento de entradas (límites de longitud en mensajes, parámetros SQL siempre parametrizados — sin concatenación). | Alta |
| RNF-05 | **Rendimiento** | Respuestas de API acotadas mediante índices sobre catálogo, inventario y pedidos; caché de 60 s del estado del motor LLM. | Alta |
| RNF-06 | **Disponibilidad / Resiliencia** | **Fallback automático al motor local de reglas** ante fallo, timeout (45 s) o cuota agotada del LLM, con reintentos con backoff; el sistema degrada sin interrumpir el servicio. | Alta |
| RNF-07 | **Escalabilidad** | Backend stateless (JWT + pool de conexiones `pg`), apto para escalar horizontalmente tras un balanceador. | Media |
| RNF-08 | **Usabilidad** | Interfaces responsive (mockups originales) con actualización asíncrona sin recarga; respuestas del asistente acotadas (≤ 90 palabras) y renderizado Markdown. | Media |
| RNF-09 | **Compatibilidad** | Ejecutable en Node.js ≥ 18 y navegadores modernos (Fetch, ES2020+), sin dependencias de build en el frontend. | Media |
| RNF-10 | **Portabilidad** | Infraestructura local reproducible con **Docker Compose** (PostgreSQL 16) y arranque con esquema + datos sembrados automáticos. | Alta |
| RNF-11 | **Mantenibilidad** | Separación clara de capas (`routes/` · `services/` · `middleware/`), configuración centralizada (`config.js`) y código ESM modular. | Media |
| RNF-12 | **Auditabilidad** | Trazas completas de las interacciones de IA (mensajes, intención, producto de contexto, CSAT) persistidas en `ai_sessions`; marca `ai_assisted` en pedidos influidos por la IA; logs de servidor. | Media |
| RNF-13 | **Consistencia de datos** | Invariantes de inventario (único por variante+tienda), descuento atómico de stock en ventas POS y SKUs únicos (incl. sufijo `-EXT` para externos). | Alta |
| RNF-14 | **Internacionalización** | Moneda uniforme **USD** con formato de dos decimales en todo el sistema; catálogo externo traducido al español con fallback a diccionario local sin red. | Baja |
| RNF-15 | **Costo/Operación** | Proveedor LLM intercambiable vía variables de entorno (`OPENROUTER_API_KEY`/`OPENROUTER_MODEL`), permitiendo operar sin costo con el motor local. | Media |

---

## 10. Credenciales Demo (para la demostración del examen)

| Rol | Identificador | Contraseña | Acceso principal |
|---|---|---|---|
| 👤 Cliente (Socio Gold) | `elena.rossi@vivamoda.com` | `Cliente123!` | Tienda, detalle, carrito, IA |
| 🧑‍💼 Staff / POS | `carlos.morales@vivamoda.com` | `Staff123!` | `/pedidos-y-pos` |
| 🛠️ Admin | `admin@vivamoda.internal` | `Admin123!` | `/panel-de-almacen-y-ventas` |

**Puesta en marcha:** `cd backend && npm install && npm run db:up && npm start` → http://localhost:3000/catalogo-de-productos (la base crea esquema y datos demo automáticamente al primer arranque).
