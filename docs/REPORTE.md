# 📋 Reporte del Proyecto **VivaModa — Ecosistema Omnicanal**

> Documento generado a partir de la inspección del repositorio.
> Vista de diagramas: [`docs/ARQUITECTURA.md`](./ARQUITECTURA.md)

---

## 1. Resumen ejecutivo

VivaModa es una **plataforma de comercio de moda omnicanal** que nace de mockups HTML de diseño y los convierte en pantallas funcionales que consumen una **API REST real**. Cubre los tres canales (web cliente, POS de mostrador y panel de administración de almacén) más un **hub de agentes IA** y una **tienda virtual 3D/VR**.

- **Lenguaje:** JavaScript (ES Modules, Node ≥ 18)
- **Backend:** Node.js + Express 4 + PostgreSQL 16 (Docker)
- **Frontend:** HTML/Tailwind (CDN) + JS vanilla ("wiring") inyectado sobre los mockups
- **Persistencia:** PostgreSQL con esquema auto-aplicado y auto-sembrado
- **Auth:** JWT + bcrypt, roles `client` / `staff` / `admin`
- **IA:** Estilista "Aria" — LLM real vía **OpenRouter** (`meta-llama/llama-3.3-70b-instruct`)
  con fallback a motor local de reglas. Detalles: [`IA-ESTILISTA.md`](./IA-ESTILISTA.md)
- **3D:** Three.js r128 (tienda VR modular)
- **Estado:** prototipo/demo funcional. **Sin tests, sin build step, sin linter.**

---

## 2. Estructura de carpetas

```
vivamoda/
├── README.md                          Documentación principal (stack, API, credenciales demo)
├── docs/
│   ├── REPORTE.md                     Este documento
│   └── ARQUITECTURA.md                Diagramas de arquitectura y modelo de datos
├── backend/                           ← TODO el servidor y el wiring de frontends
│   ├── docker-compose.yml             PostgreSQL 16-alpine (puerto 5432, volumen vivamoda_pgdata)
│   ├── .env / .env.example            PORT, DATABASE_URL, JWT_SECRET, OpenRouter (IA)
│   ├── .gitignore                     node_modules/, .env, *.log, _originals/
│   ├── package.json                   deps: express, pg, bcryptjs, jsonwebtoken, cors, dotenv
│   ├── server.log                     (log de ejecución)
│   ├── public/js/
│   │   ├── common.js                  Helpers: sesión, carrito, toast, rutas, guards
│   │   └── pages/
│   │       ├── catalogo.js            Wiring del catálogo
│   │       ├── detalle.js             Wiring de detalle de producto + estilista IA
│   │       ├── hub.js                 Wiring del hub de agentes IA
│   │       ├── login.js               Wiring de login/registro
│   │       ├── pos.js                 Wiring de la consola POS
│   │       ├── admin.js               Wiring del panel de almacén
│   │       └── vr-store/              Motor de la tienda VR (11 módulos)
│   └── src/
│       ├── server.js                  Express: API + servidor de mockups + inyección de scripts
│       ├── config.js                  Carga de variables de entorno
│       ├── db.js                      Pool pg, ensureSchema, waitForDb, tx(), money()
│       ├── schema.sql                 DDL completo (13 tablas + índices)
│       ├── seed.js                    Semilla demo (scraping de HTML + datos operativos)
│       ├── middleware/auth.js         JWT: signToken, loadUser, attachUser, requireRole
│       ├── routes/                    auth, catalog, cart, orders, pos, admin, ai, vr
│       └── services/                  products.js (consultas), stylist.js (orquestador IA),
│                                      llm.js (cliente OpenRouter ★)
│
├── tienda_cat_logo_completo/          Mockup: catálogo (code.html + screen.png)
├── detalle_de_producto_asistente_ia/  Mockup: detalle + asistente IA
├── hub_agente_ia_automatizaci_n/      Mockup: hub de agentes IA
├── portal_de_autenticaci_n_registro/  Mockup: login/registro
├── consola_empleado_pedidos_pos/      Mockup: consola POS de empleado
├── panel_admin_gesti_n_de_almac_n/    Mockup: panel de almacén y ventas
├── tienda_virtual_realidad/           Pantalla VR 3D (code.html, sin screen.png)
├── vibrant_high_fashion_dynamic/      DESIGN.md → sistema de diseño (tokens: color, tipografía…)
├── vivamoda_brand_logo/               Asset: logotipo (screen.png)
└── professional_avatar_headshot_of_…/ Asset: avatar/headshot (screen.png)
```

> **Nota:** los frontends son los HTML de diseño **servidos tal cual**; el backend les inyecta sus scripts. No hay bundler, ni `src/` de frontend, ni framework (React/Vue).

---

## 3. Arquitecturas

### 3.1 Arquitectura general (cliente-servidor / monolito por capas)

```
┌──────────────────────────────────────────────────────────────┐
│  NAVEGADOR                                                    │
│  Mockup HTML (Tailwind CDN) + scripts inyectados              │
│  common.js (VM.api)  ·  pages/*.js  ·  vr-store/*.js (Three)  │
└───────────────────────┬──────────────────────────────────────┘
                        │ HTTP · JSON · Authorization: Bearer <JWT>
┌───────────────────────▼──────────────────────────────────────┐
│  EXPRESS (monolito API-first)                                 │
│  server.js  → CORS · express.json(1mb) · attachUser           │
│  /api/auth  /api/products /api/cart /api/orders /api/pos      │
│  /api/admin /api/ai /api/vr                                   │
│  ─────────────────────────────────────────────────────────    │
│  ROUTES (controladores)  →  SERVICES (dominio/lógica)         │
│  middleware/auth.js (JWT + roles)                             │
│  db.js (pool pg + transacciones)                              │
└───────────────────────┬──────────────────────────────────────┘
                        │ SQL (node-postgres, pool de 10 conexiones)
┌───────────────────────▼──────────────────────────────────────┐
│  POSTGRESQL 16 (Docker) — esquema auto-aplicado + seed        │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Patrones y decisiones clave

| Aspecto | Implementación |
|---|---|
| **API-first / BFF** | El backend **también** sirve los HTML y les inyecta el JS, evitando duplicar/perseguir los mockups. |
| **Capas** | `routes/` (HTTP + validación) → `services/` (consultas y lógica) → `db.js` (acceso a datos). |
| **Router-based modules** | Un router Express por dominio, montado desde `server.js`. |
| **Auto-migración** | Al arrancar: `waitForDb()` → `ensureSchema()` (idempotente, `CREATE ... IF NOT EXISTS`) → `seedIfEmpty()`. |
| **Transacciones** | `tx(fn)` con `BEGIN/COMMIT/ROLLBACK` para checkout y ventas POS. |
| **Config por entorno** | `config.js` + `.env`; valores por defecto para desarrollo. |
| **Frontend "wiring"** | Patrón *progressive enhancement*: el mockup se pinta y luego el script lo rellena con datos reales (`VM.api`). |
| **Módulos VR** | Patrón *plugin/registry*: cada archivo registra una "parte" (`VRStore.part`) y el core las construye en orden. |

---

## 4. Stack tecnológico

### Backend (`backend/package.json`)

| Dependencia | Uso |
|---|---|
| `express@^4.19` | Framework HTTP y enrutado |
| `pg@^8.12` | Cliente PostgreSQL (pool) |
| `bcryptjs@^2.4` | Hash de contraseñas (10 rondas) |
| `jsonwebtoken@^9.0` | Emisión/verificación JWT (12 h por defecto) |
| `cors@^2.8` | Habilita CORS |
| `dotenv@^16.4` | Variables de entorno |

- **Scripts:** `dev` (`node --watch`), `start`, `db:up` / `db:down` (Docker Compose).
- Sin TypeScript, sin ESLint/Prettier, sin Jest/Vitest, sin ORM (SQL crudo parametrizado).

### Infraestructura

- **Docker Compose** → `postgres:16-alpine`, healthcheck `pg_isready`, volumen persistente `vivamoda_pgdata`.

### Frontend

- **Tailwind CSS vía CDN** (`cdn.tailwindcss.com`), **Material Symbols** y **Plus Jakarta Sans** (Google Fonts).
- **JS vanilla** con IIFEs y un namespace global `window.VM`.
- **Three.js r128** (CDN) + `OrbitControls` para la tienda VR.
- Sistema de diseño documentado en `vibrant_high_fashion_dynamic/DESIGN.md` (tokens de color, tipografía, elevación, componentes).

---

## 5. Modelo de datos (PostgreSQL)

**13 tablas** definidas en `schema.sql`:

| Tabla | Rol |
|---|---|
| `stores` | Sucursales/canales: `fisica`, `online`, `dark_store`. Seed: **CENTRAL, NORTE, ONLINE, CENTRO** |
| `users` | Clientes/staff/admin. Incluye `employee_code` (STF-#####), `store_id`, `interests[]`, `avatar`, `vip_tier`, `points` |
| `products` | SKU, slug, género, categoría, badge, `details` **JSONB**, price/compare_at/cost, rating, **`visibility`** (`store` vitrina / `ops` POS-almacén) |
| `product_images` | Galería (url + position) |
| `product_variants` | Talla × color por producto (UNIQUE producto+talla+color) |
| `inventory` | Stock por **variante × tienda**, con `reorder_point` (UNIQUE) |
| `orders` | Pedido omnicanal: `order_no` (VM-####), canal, estado, courier/tracking, pago, subtotal/discount/tax/total, `ai_assisted`, `cashier_id` |
| `order_items` | Líneas del pedido (snapshot de nombre, SKU, talla, precio) |
| `carts` / `cart_items` | Carrito persistente 1:1 con usuario |
| `wishlists` | Favoritos (PK compuesta usuario+producto) |
| `ai_sessions` | Conversaciones de la estilista: `messages` **JSONB**, `rating`, `csat` |
| `vr_user_prefs` | Preferencias VR: `favorite_sku` por usuario |

**Relaciones:** `users → stores`; `products → product_images/product_variants → inventory → stores`; `orders → users/stores/order_items`; `carts → users → cart_items`.

**Índices** en género, categoría, activo, variantes, inventario (variante/tienda), órdenes (estado/tienda/usuario) y líneas de orden.

> Diagrama Entidad-Relación completo en [`docs/ARQUITECTURA.md`](./ARQUITECTURA.md#2-modelo-de-datos-er).

---

## 6. API REST — comunicación y manejo de datos

**Convención:** JSON; autenticación por `Authorization: Bearer <token>`; los endpoints 🔒 exigen sesión/rol.

### 6.1 Endpoints por router

**`/api/auth`** (`routes/auth.js`)

- `POST /register` — roles públicos `client` | `staff` (staff elige tienda por código y recibe `STF-#####`). **Registro de admin deshabilitado** (403).
- `POST /login` — `identifier` = correo **o** código de empleado.
- `GET /me` 🔒 · `PUT /me` 🔒 — perfil (nombre, teléfono, intereses, VIP).

**`/api`** (`routes/catalog.js`)

- `GET /products` — filtros: `gender, category, q, minPrice, maxPrice, sizes, badge, sort, novedades, ofertas, storeId, limit, offset`.
- `GET /products/:id` (id o SKU) — detalle con variantes, stock por tienda, galería, complementos ("look completo").
- `GET /categories` — navegación por género con conteos.
- `GET /stores` — sucursales (selector de POS/admin/registro).

**`/api/cart`** 🔒 (`routes/cart.js`) — `GET /`, `POST /items`, `PATCH /items/:id`, `DELETE /items/:id`. Carrito auto-creado, qty acotada 1–50.

**`/api/orders`** 🔒 (`routes/orders.js`)

- `POST /` — **checkout transaccional**: valida stock en tienda ONLINE, descuenta inventario, calcula IVA 19 %, genera `order_no` y vacía el carrito.
- `GET /mine` — pedidos del cliente · `GET /:orderNo` — detalle/tracking (dueño o staff).

**`/api/pos`** 🔒 `staff|admin` (`routes/pos.js`)

- `GET /summary` (contadores y ventas del día) · `GET /products` (búsqueda de mostrador) · `GET /orders` (kanban) · `GET /orders/:no` (con estados siguientes) · `POST /orders` (**venta POS**, descuenta inventario, estado `delivered`) · `PATCH /orders/:no/status` (**máquina de estados validada**: pendiente → picking → packed → in_transit → delivered / cancelled) · `GET /variants`.

**`/api/admin`** 🔒 `admin` (`routes/admin.js`)

- `GET /stats` — KPIs por periodo (hoy/7d/mes/trimestre): ingresos y crecimiento, pedidos, cumplimiento, valorización, mix por departamento, stock bajo, **sugerencias de reorden**.
- `GET /products` — matriz de inventario por sucursal (estado En Stock/Bajo/Agotado, margen).
- `POST /products` / `PUT /products/:id` — CRUD (SKU autogenerado, slug normalizado).
- `PATCH /inventory/:variantId` — ajuste de stock / punto de reorden (upsert).
- `GET /orders` — visión omnicanal de pedidos.

**`/api/ai`** (`routes/ai.js`) — `POST /chat` (persiste en `ai_sessions`), `POST /size` (calculadora biométrica), `GET /stats` (métricas del hub). Usa `attachUser` (autenticación opcional).

**`/api/vr`** (`routes/vr.js`) — `GET /session` (autenticada o anónima), `GET /session/public` (sin token), `POST /session` 🔒 (género/avatar/intereses), `POST /session/favorite` 🔒 (guarda SKU destacado), `GET /highlights` (productos por género/búsqueda), `GET /products/:sku/care` (cuidado, materiales, origen).

### 6.2 Manejo transversal de datos

- **`attachUser` global:** lee el `Bearer`, verifica JWT, carga la fila completa del usuario (`loadUser`) y la adjunta a `req.user`. No falla si falta token.
- **Normalización:** los `NUMERIC` de pg se convierten a `Number` (`::float8` en SQL o `money()`), conteos a `int`.
- **Serialización:** los servicios construyen DTOs camelCase (`toLight`, `toListItem`, `orderToJson`) desacoplados del esquema.
- **Errores:** JSON `{ error, code? }` con códigos (`UNAUTHENTICATED`, `FORBIDDEN`, `EMAIL_IN_USE`…); 404 genérico para `/api/*` y HTML amable para el resto.

---

## 7. Frontend — cómo se conecta

### 7.1 Servido e inyección

`server.js` mapea **rutas amigables** a los mockups y, en `sendPage()`, inyecta antes de `</body>`:

```html
<script src="/js/common.js"></script>
<script src="/js/pages/<página>.js"></script>
```

| Ruta | Mockup | Script |
|---|---|---|
| `/catalogo-de-productos`, `/catalogo-caballeros`, `/catalogo-ninos`, `/novedades`, `/ofertas-flash` | `tienda_cat_logo_completo` | `catalogo.js` |
| `/detalle-de-producto?sku=…` | `detalle_de_producto_asistente_ia` | `detalle.js` |
| `/hub-agente-ia` | `hub_agente_ia_automatizaci_n` | `hub.js` |
| `/iniciar-sesion`, `/registro` | `portal_de_autenticaci_n_registro` | `login.js` |
| `/pedidos-y-pos` | `consola_empleado_pedidos_pos` | `pos.js` |
| `/panel-de-almacen-y-ventas` | `panel_admin_gesti_n_de_almac_n` | `admin.js` |
| `/tienda-virtual-realidad` | `tienda_virtual_realidad` | *(carga sus propios scripts VR)* |

Rutas no diseñadas (`/carrito-de-compras`, `/checkout`, `/perfil-de-usuario`, `/guia-de-tallas`, etc.) devuelven una **landing placeholder** con enlaces a módulos activos. `/` redirige al catálogo.

### 7.2 `common.js` — el núcleo del cliente

Expone `window.VM` con:

- **`api(path, {method, body, auth})`** — wrapper de `fetch` con JWT y limpieza de sesión en 401.
- **Sesión** — token/usuario en `localStorage` (`vm_token`, `vm_user`), evento `vm:auth`.
- **Carrito** — badge del header; para clientes usa `/api/cart`, para invitados un carrito local (`vm_cart_guest`).
- **Guards de rol** — `requireRole(...)` redirige a `/iniciar-sesion?next=…`.
- **UI** — `toast`, formateo COP, `esc`, pintado del chip de usuario (avatar SVG con iniciales), `fixLinks()` para convertir `data-path` en rutas reales.

### 7.3 Uso de la API por pantalla

- **Catálogo:** `GET /categories` + `GET /products?limit=200`; filtrado/orden **en cliente**; chat IA flotante (`POST /ai/chat`, público).
- **Detalle:** producto por SKU, tallas/stock, galería, calculadora de talla (`POST /ai/size`) y estilista (`POST /ai/chat` con `productContext`).
- **Hub IA:** `POST /ai/chat` + `GET /ai/stats`.
- **Login/Registro:** `GET /stores`, `POST /auth/login`, `POST /auth/register`.
- **POS:** `GET /pos/products`, `GET /pos/orders`, `POST /pos/orders`, `GET /pos/summary`.
- **Admin:** `GET /admin/stats`, `POST /admin/products`, `PUT /admin/products/:id`, `PATCH /admin/inventory/:variantId`, `GET /stores`.

---

## 8. Módulo de IA — "Aria"

`services/stylist.js` implementa un **motor local** (por defecto) sin dependencias externas:

1. **`extractIntent(msg)`** — clasifica intención por regex: `size`, `shoes`, `shipping`, `returns`, `deals`, `accessorize`, `greeting`, `outfit`.
2. **`recommendForIntent()`** — combina `EVENT_MAP` (boda, cóctel, oficina, deporte, niños, masculino…) con **búsqueda semántica ligera en SQL** (`ILIKE` sobre nombre/categoría/badge, solo con stock) y devuelve texto en español + hasta 3 sugerencias.
3. **`recommendSize()`** — "motor biométrico" heurístico sobre estatura/busto/peso → talla XS–XL con % de confianza.
4. **Respuesta** — `reply`, `suggestions`, `intent`, `model`, `latencyMs`, `quickReplies`, `anchorProduct`.
5. **Persistencia** — cada turno se guarda en `ai_sessions.messages` (JSONB, últimos 40).
6. **`/ai/stats`** — sesiones 30 d, CSAT, tópicos (talla/outfit/envío), ventas asistidas por IA.

> ⚠️ **Observación:** aunque `config.js` lee `OPENAI_API_KEY`/`USE_LOCAL_AI` y la respuesta etiqueta el `model`, **no existe llamada real a OpenAI** en `stylist.js`. El README menciona `AI_PROVIDER=openai`, variable que **no se lee** en el código. La integración LLM está anunciada pero no implementada.

---

## 9. Módulo Tienda Virtual en Realidad (VR/3D)

`tienda_virtual_realidad/code.html` + `public/js/pages/vr-store/` (≈1.800 líneas). Arquitectura modular con **patrón registry**:

- **`core.js`** — núcleo: motor Three.js (renderer WebGL, escena, cámara 60°, OrbitControls, niebla), paleta VivaModa, **5 zonas** (Damas, Caballeros, Niños, Novedades, Ofertas Flash), catálogo 3D, luces (hemisférica, direccional con sombras, spot central, luces por zona), helpers (`textSprite`, materiales), bucle de render y orquestador `S.build()`.
- **Partes** (registradas con `VRStore.part(...)`): `estructura`, `percheros`, `estantes`, `espejos`, `mobiliario`, `ropa`, `secciones`, `letreros`, `interaccion`.
- **`interaccion.js`** — anillo de selección (raycasting), panel holográfico con la foto del producto, tarjeta de producto, chips de zona, recorrido automático y pantalla completa.
- **`avatar-client.js`** — sesión de persona: lee `GET /api/vr/session/public`, sincroniza `GET/POST /api/vr/session`, avatar/género/emoji y persistencia en `localStorage`.
- **`mode-fps.js`** — modo en primera persona para recorrer la tienda.
- **Datos:** al iniciar hace `fetch('/api/products?limit=100')` para sustituir las imágenes placeholder por fotos reales de la API, y `GET /api/vr/products/:sku/care` para el cuidado del producto.

---

## 10. Seguridad y autenticación

| Control | Detalle |
|---|---|
| Hash de contraseñas | `bcryptjs`, 10 rondas; políticas: correo válido, contraseña ≥ 8 caracteres |
| Tokens | JWT HS256, payload `{ sub, role }`, expiración 12 h (`JWT_EXPIRES_IN`) |
| Roles | `client` · `staff` · `admin`; guards `requireAuth` y `requireRole` por router |
| Alcance de datos | POS filtra por `store_id` del empleado; pedidos solo visibles para dueño o staff; admin ve todo |
| SQL | Consultas **parametrizadas** ($1…$n) — sin concatenación de entrada de usuario |
| Integridad | `UNIQUE`, `CHECK` (roles, género, visibility), `ON DELETE CASCADE`, transacciones |
| Registro de admin | Bloqueado por API |
| Riesgos (dev) | `JWT_SECRET` por defecto y credenciales demo en README; **no apto para producción sin hardening** |

---

## 11. Configuración y puesta en marcha

```env
PORT=3000
DATABASE_URL=postgres://vivamoda:vivamoda_dev@localhost:5432/vivamoda
JWT_SECRET=cambia-este-secreto-en-produccion
# AI_PROVIDER=openai ; OPENAI_API_KEY=sk-… ; OPENAI_MODEL=gpt-4o-mini
```

```bash
cd backend
npm install
npm run db:up      # docker compose up -d (PostgreSQL 16)
npm start          # o npm run dev  (node --watch)
# → http://localhost:3000/catalogo-de-productos
```

Al primer arranque se crea el esquema y se siembra automáticamente. El `seed.js`:

1. **Hace scraping** de los `code.html` reales para replicar los productos del catálogo y el producto estrella (*Vestido Asimétrico Magenta Atelier*).
2. Añade **19 productos operativos** (calzado, accesorios, kids, filas de ejemplo de almacén).
3. Crea 4 tiendas, 4 usuarios demo, inventario multidireccional, **~17 pedidos** en distintos estados, carrito, wishlist y 4 sesiones de IA.

**Credenciales demo:** `elena.rossi@vivamoda.com / Cliente123!` (cliente Gold) · `carlos.morales@vivamoda.com` y `laura.gomez@vivamoda.com / Staff123!` (staff) · `admin@vivamoda.internal / Admin123!` (admin).

---

## 12. Observaciones y limitaciones

- ✅ **Fortalezas:** API REST completa y coherente, esquema relacional sólido, seed automatizado y fiel a los diseños, lógica transaccional correcta en checkout/POS, frontends sin duplicar mockups, módulo VR modular y bien aislado.
- ⚠️ **IA:** motor local real, pero la integración LLM (OpenAI) está **solo anunciada** (variables no usadas). `AI_PROVIDER` del README no se lee.
- ⚠️ **Sin pruebas:** no hay tests ni CI. No hay ESLint/Prettier ni tipos.
- ⚠️ **Detalles:** `attachUser` se aplica dos veces en `/api/ai`; `seed.js` asume que los mockups existen en disco; los placeholders de módulos no diseñados son estáticos; `visibility: 'ops'` oculta productos operativos de la vitrina.
- ⚠️ **Producción:** falta hardening (secretos, HTTPS, rate limiting, rotación de tokens, `cors()` abierto a todo).
