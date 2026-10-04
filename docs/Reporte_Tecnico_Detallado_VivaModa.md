# 🔬 Reporte Técnico Detallado — VivaModa

**Fecha:** 30 de septiembre de 2026
**Versión del sistema:** 1.0.0 (`backend/package.json`)
**Tipo de documento:** Especificación técnica de arquitectura, componentes e infraestructura

---

## 1. Ficha técnica resumen

| Atributo | Valor |
|---|---|
| **Producto** | Plataforma e-commerce de moda omnicanal con IA |
| **Patrón arquitectónico** | Monolito modular (API REST + serving de frontends con inyección de wiring) |
| **Runtime** | Node.js ≥ 18 (ESM — `"type": "module"`) |
| **Framework HTTP** | Express 4.19 |
| **Base de datos** | PostgreSQL 16 (Docker `postgres:16-alpine`) |
| **Driver BD** | `pg` 8.12 (node-postgres) con pool de 10 conexiones |
| **Puerto** | 3000 (configurable vía `PORT`) |
| **IA** | OpenRouter (Llama 3.3 70B) + motores locales de respaldo |
| **3D/VR** | Three.js (WebGL, sin plugins) |
| **Auth** | JWT 12h + bcryptjs |

**Volumen de código propio:** ~4,568 líneas en `backend/src` (JS+SQL) · ~4,397 líneas de wiring JS/CSS en `backend/public` · ~4,004 líneas de mockups HTML en `frontends/` · **~13,000 líneas totales**.

---

## 2. Arquitectura general

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENTES (PC, tablet, iOS, Android — solo navegador)           │
│  7 mockups HTML+Tailwind servidos por el mismo servidor          │
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTP (fetch + JWT en header Authorization)
┌───────────────▼─────────────────────────────────────────────────┐
│  EXPRESS (server.js, puerto 3000)                               │
│  ├─ CORS + JSON body 1MB + attachUser (decodifica JWT)          │
│  ├─ /api/*  → 8 routers REST (37 endpoints)                     │
│  ├─ /js/*, /css/* → estáticos (wiring inyectable)               │
│  └─ 12 rutas de páginas → sendPage(): lee el mockup HTML y      │
│     INYECTA <link responsive.css> + <script common.js> +        │
│     <script pages/<pag>.js> antes de servirlo                   │
└───────────────┬─────────────────────────────────────────────────┘
                │ SQL parametrizado ($1, $2…) vía pool
┌───────────────▼─────────────────────────────────────────────────┐
│  POSTGRESQL 16 (Docker, volumen persistente, healthcheck)       │
│  13 tablas · 293 productos · 508 variantes · 2,032 inventarios  │
└─────────────────────────────────────────────────────────────────┘
                ↕ (solo texto, jamás acceso directo a BD)
┌─────────────────────────────────────────────────────────────────┐
│  OPENROUTER API (LLM Llama 3.3 70B) — 4 system prompts          │
│  Fallback local determinista si no hay key/red                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 El patrón clave: mockups intactos + wiring inyectado

`sendPage()` en `server.js`:
1. Lee el HTML original de `frontends/<pag>/code.html` (sin modificarlo jamás en disco).
2. Inyecta `<link href="/css/responsive.css">` antes de `</head>`.
3. Inyecta `<script src="/js/common.js">` + `<script src="/js/pages/<pag>.js">` antes de `</body>` según el mapa `PAGE_SCRIPTS`.

**Ventaja:** el diseño original (generado por herramienta de mockups) queda congelado como "contrato visual"; toda la funcionalidad vive en JS versionable. **Trade-off:** el wiring depende del DOM del mockup (se navega con `leaf()`, búsqueda de texto en hojas del árbol), por lo que un cambio de diseño puede romper selectores.

### 2.2 Rutas de páginas servidas (12)

`/catalogo-de-productos` (+ variantes caballeros/niños/novedades/ofertas), `/detalle-de-producto`, `/hub-agente-ia`, `/tienda-virtual-realidad`, `/iniciar-sesion`, `/registro`, `/pedidos-y-pos`, `/panel-de-almacen-y-ventas` + 10 placeholders amables para módulos futuros (checkout, carrito, perfil…).

---

## 3. Stack y dependencias (package.json)

| Dependencia | Versión | Rol técnico |
|---|---|---|
| `express` | ^4.19.2 | Router HTTP, middleware pipeline |
| `pg` | ^8.12.0 | Pool de conexiones PostgreSQL, queries parametrizadas |
| `jsonwebtoken` | ^9.0.2 | Firma/verificación HS256 de tokens de sesión (12h) |
| `bcryptjs` | ^2.4.3 | Hash de contraseñas (comparación sincrónica en login) |
| `cors` | ^2.8.5 | Habilita consumo cross-origin de la API |
| `dotenv` | ^16.4.5 | Carga `.env` (puerto, BD, secretos, llave IA) |

**Runtime frontend (CDN):** Tailwind Play CDN (clases utility + design tokens en `tailwind.config` inline), Material Symbols Outlined (iconografía), Three.js (VR), Google Fonts (Plus Jakarta Sans).

**Scripts npm:** `dev` (node --watch), `start`, `db:up` / `db:down` (docker compose), `seed:external` (catálogo externo traducido).

---

## 4. API REST — 37 endpoints en 8 routers

| Router | Endpoints | Responsabilidad |
|---|---|---|
| `auth.js` | 4 | Login (email o código STF-), registro, perfil (`GET/PUT /me`) |
| `catalog.js` | 4 | Catálogo público con filtros/género, detalle por slug, búsqueda |
| `cart.js` | 4 | Carrito persistente por usuario (CRUD items) |
| `orders.js` | 3 | Checkout web, mis pedidos, detalle de pedido |
| `pos.js` | 7 | Venta en tienda: búsqueda SKU, cobro multi-método, ticket, descuento de inventario **transaccional** (`tx()`) |
| `admin.js` | 6 | KPIs/stats agregados, CRUD productos, ajuste de inventario, + **montaje `/ai`** |
| `admin-ai.js` (montado bajo `/admin`) | 3 | `GET /ai/insights`, `POST /ai/report`, `POST /ai/ask` |
| `ai.js` | 3 | Estilista Aria (sesión, mensaje, feedback CSAT) |
| `vr.js` | 6 | Preferencias de avatar/VR por usuario |

**Convenciones:** respuestas JSON `{ error, code? }` en fallos; `attachUser` decodifica JWT en toda request; `requireRole('admin'|'staff',…)` protege rutas sensibles;健康 check en `/api/health` (verifica `SELECT 1`).

---

## 5. Base de datos — modelo relacional (13 tablas)

```
stores ─┬─< users (role: client|staff|admin, vip_tier, points, employee_code)
        └─< inventory >─ product_variants >─ products
                             │                   ├─< product_images
                             │                   └─ details JSONB
orders ──< order_items >─ products / product_variants
  │ (channel: web|pos|whatsapp|app|shopify|retiro, ai_assisted, payment_method)
carts ──< cart_items          wishlists          ai_sessions (messages JSONB, csat)
vr_user_prefs
```

**Decisiones de diseño relevantes:**
- `NUMERIC(12,2)` para dinero (nunca float) + normalizador `money()` en el driver.
- `UNIQUE(variant_id, store_id)` en inventario: la matriz talla×tienda es la unidad de stock.
- `CHECK` constraints para roles, género y visibilidad (`store`=vitrina pública / `ops`=solo POS/almacén).
- `JSONB` para metadatos flexibles (composición, cuidados) y sesiones de IA.

**Snapshot de datos demo:** 4 tiendas · 293 productos · 508 variantes · 2,032 registros de inventario · 4 usuarios · 17 pedidos · 27 líneas vendidas.

**Auto-provisionamiento:** al arrancar, `main()` ejecuta `waitForDb()` (reintentos mientras Docker levanta) → `ensureSchema()` (aplica `schema.sql`, idempotente) → `seedIfEmpty()` (siembra solo si la BD está vacía).

---

## 6. Las 9 IA — implementación técnica

### 6.1 Para el cliente
| # | IA | Archivo | Motor | Técnica |
|---|---|---|---|---|
| 1 | **Aria, estilista virtual** | `services/llm.js` + `services/stylist.js` | LLM + reglas | System prompt (90 palabras máx., USD, tallas, políticas); contexto de catálogo real inyectado por mensaje; persistencia en `ai_sessions`; fallback motor de reglas por intención |
| 2 | **Traductor de catálogo** | `services/translator.js` | LLM + diccionario | Lotes JSON, 6 palabras máx., marcas protegidas; fallback diccionario local + transliteración |
| 3 | **Recomendaciones** | `routes/catalog.js` / detalle | SQL | Co-ocurrencia de categoría/género/rating |
| 4 | **Tienda VR + avatar** | `vr-store/*.js` (12 módulos) | Three.js | Escena modular (estructura, percheros, espejos, ropa, modo FPS), prefs por usuario en BD |
| 5 | **Moneda/precios** | `services/currency.js` | Local | Formateo y conversión USD |

### 6.2 Para el admin (módulo `admin-ai`)
| # | IA | Técnica | Parámetros clave |
|---|---|---|---|
| 6 | **Predicción de demanda** | Media móvil ponderada: `velocity = (v30 + 2·v7)/3`; `daysLeft = stock/velocity`; reorden = `ceil(v·horizonte·1.2) − stock`; riesgo AGOTADO/CRITICO/ALTO/MEDIO/BAJO | horizonte 30 días |
| 7 | **Clasificación ABC** | Pareto: acumulado ≤80%→A, ≤95%→B, resto C sobre ingresos 90d | ventana configurable |
| 8 | **Detección de anomalías** | Tienda: delta último7 vs media 4 sem previas (±50%/−40%); SKUs: `sold7≥3 y stock/sold7<7` = quiebre inminente; estancados: sin venta 45d con stock | por tienda |
| 9 | **Informe ejecutivo** | Agregados SQL (pedidos, ingresos, ticket, top-5, canales) → LLM con estructura MD forzada (Resumen/Funciona/Riesgos/Acciones, 180 palabras) → fallback determinista | temp 0.35 |
| + | **Chat text-to-SQL** | LLM temperature 0 con schema completo → validador → ejecución → máscara PII; heurística local por keywords como respaldo | LIMIT 100 |

### 6.3 Seguridad del text-to-SQL (4 capas, probadas)
1. El LLM **no tiene acceso a la BD** — devuelve texto.
2. Perímetro: `requireRole('admin')`.
3. `validateReadOnlySql()`: solo `SELECT/WITH`; sin `;` múltiple; bloquea DML/DDL; **bloquea columnas PII** (`email|phone|full_name|customer_name|address|password_hash|employee_code`, incluso con alias); bloquea `pg_catalog|information_schema|pg_*`; bloquea `pg_sleep|dblink|lo_import|query_to_xml…`.
4. `maskPiiRows()` sobre resultados: emails `el***@dominio`, teléfonos `••••78`, nombres `Elena R. G.`, passwords/direcciones `••••••`, también dentro de JSONB.

**Suite de pruebas ejecutada:** 7/7 evasiones rechazadas (robo de credenciales, alias, catálogo del sistema, pg_sleep, multi-statement, UPDATE) y 2/2 consultas legítimas permitidas.

---

## 7. Autenticación y autorización

- **Login dual:** email **o** código de empleado `STF-XXXXX` (`/api/auth/login`).
- **JWT HS256**, 12h, payload con id/role/store; guardado en `localStorage` (`vm_token`).
- `attachUser` decodifica y adjunta `req.user` en cada request; `requireRole()` corta con 403.
- Contraseñas con bcrypt (nunca plano); usuarios demo sembrados: admin/staff/cliente.

---

## 8. Infraestructura y despliegue

**docker-compose.yml:** servicio único `postgres:16-alpine` con credenciales demo, volumen `vivamoda_pgdata`, healthcheck `pg_isready` cada 5s (retries 10).

**Arranque probado:** `docker compose up -d` → `env PORT=3000 node src/server.js` (dotenv no sobreescribe PORT ya exportado). Logs en `server.log`.

**Configuración por entorno (`config.js`):** `PORT`, `DATABASE_URL`, `JWT_SECRET`/`JWT_EXPIRES_IN`, `OPENROUTER_API_KEY` (acepta también `OPENAI_API_KEY`), `OPENROUTER_MODEL` (default `meta-llama/llama-3.3-70b-instruct`), `USE_LOCAL_AI`.

---

## 9. Frontend — convenciones del wiring

- **`common.js` (capa compartida):** `api()` con JWT automático, `fmtUSD`, `esc` (escape XSS), `toast`, `requireRole` (redirige si no), `clearSession`.
- **Un archivo por página** (`pages/catalogo.js`, `detalle.js`, `hub.js`, `login.js`, `pos.js`, `admin.js`, `vr-store/*`): IIFE que localiza nodos del mockup por texto de hojas (`leaf(marker)`), pinta datos y agrega listeners.
- **`responsive.css`:** 10 media queries — sidebar fija colapsa <1024px, tipografía `clamp()`, grids a 1 columna, main con `min-width:0`; inyectada en las 7 páginas. Verificada sin overflow a 390/768/1280px.

---

## 10. Calidad, deuda técnica y riesgos

**Deuda técnica identificada:**
1. **Selectores frágiles** por texto (`leaf()`) — acoplados al copy del mockup.
2. **Sin suite de tests** automatizados (la validación de seguridad se hizo ad-hoc).
3. **Tailwind Play CDN** — no apto para producción (warning propio de la librería).
4. **Sin índices** más allá de PK/UNIQUE — `orders.created_at`, `order_items.sku` serán cuellos con volumen.
5. **JWT_SECRET default** en `config.js` — aceptable solo en demo.
6. **CORS abierto** (`app.use(cors())`) — restringir origen en producción.
7. **Sin rate-limiting** en la API ni en el chat IA.
8. `seed-external.js` concentra catálogo de terceros — revisar licencias si se redistribuye.

**Riesgos operativos:** dependencia de CDNs (Tailwind, fonts, Three.js) sin caché propia; contenedor Postgres sin réplica ni backups programados; LLM externo con PII mínima (solo agregados) pero conviene contrato de no-entrenamiento en producción.

---

## 11. Roadmap técnico priorizado

**P0 — endurecimiento (pre-producción)**
- [ ] Tests automatizados: validador SQL (evasiones), flujo POS transaccional, auth por roles.
- [ ] `JWT_SECRET` fuerte, CORS restringido, rate-limit en `/api/auth` y `/api/admin/ai/*`.
- [ ] Usuario PostgreSQL de solo lectura para el chat IA (doble candado en el motor).
- [ ] Índices: `orders(created_at)`, `orders(store_id, paid, status)`, `order_items(sku)`, `inventory(store_id)`.

**P1 — producto**
- [ ] PWA instalable (manifest + service worker con caché del catálogo).
- [ ] Órdenes de compra persistidas desde la predicción de demanda (tabla `purchase_orders` + flujo de aprobación).
- [ ] Exportar informe IA a PDF/DOCX; auditoría de chat en tabla `ai_audit_log`.
- [ ] Checkout y carrito (mockups placeholder → funcionales).

**P2 — escalado**
- [ ] Tailwind compilado (PostCSS) y CDNs con SRI/caché.
- [ ] Paginación + caché HTTP en catálogo; imágenes optimizadas.
- [ ] Pronóstico estacional de demanda (histórico >90d, festivos COL/US).
- [ ] Métricas de IA (conversión de recomendaciones de Aria, CSAT por intent) y observabilidad (pino + healthchecks por dependencia).

---

## 12. Glosario rápido

| Término | Significado en VivaModa |
|---|---|
| **Wiring** | JS inyectado que conecta un mockup estático con la API |
| **Variante** | Combinación producto+talla+color (unidad de inventario) |
| **Canal** | Origen del pedido: web, pos, whatsapp, app, shopify, retiro |
| **ABC** | Clasificación Pareto de productos por ingresos (A=vitales) |
| **Fallback local** | Motor determinista que reemplaza al LLM sin key/red |
| **PII** | Datos personales identificables (email, teléfono, nombre…) |
