# VivaModa · Ecosistema Omnicanal (frontends + backend)

Plataforma completa de comercio de moda construida a partir de los mockups HTML originales:
cada pantalla de diseño ahora consume una **API REST real (Node.js + Express + PostgreSQL)**
con sesiones JWT, carrito, pedidos POS, gestión de almacén y una estilista IA.

![stack](https://img.shields.io/badge/Node%2020%2B-Express%204-PostgreSQL%2016-purple)

## Estructura

| Módulo | Ruta | Frontend (mockup) |
|---|---|---|
| 🛍️ Tienda & Catálogo | `/catalogo-de-productos` | `frontends/tienda-catalogo/code.html` |
| 👗 Detalle + Estilista IA | `/detalle-de-producto?sku=…` | `frontends/detalle-producto-ia/code.html` |
| 🤖 Hub de Agentes IA | `/hub-agente-ia` | `frontends/hub-agentes-ia/code.html` |
| 🔐 Portal de acceso | `/iniciar-sesion` · `/registro` | `frontends/portal-acceso/code.html` |
| 🧾 Consola POS & Pedidos | `/pedidos-y-pos` | `frontends/pos-pedidos/code.html` |
| 📦 Panel Almacén & Ventas | `/panel-de-almacen-y-ventas` | `frontends/panel-almacen/code.html` |

Todo el código del servidor vive en [`backend/`](backend/):

```
backend/
├── docker-compose.yml        # PostgreSQL 16 local
├── .env.example              # copia a .env (ya creado para desarrollo local)
├── src/
│   ├── server.js             # Express: API + sirve los mockups con scripts en vivo
│   ├── db.js · schema.sql    # pool pg + esquema (auto-aplica al arrancar)
│   ├── seed.js               # datos demo (productos extraídos de los HTML reales)
│   ├── middleware/auth.js    # JWT + roles (client · staff · admin)
│   ├── routes/               # auth, catalog, cart, orders, pos, admin, ai
│   ├── services/             # products, stylist (motor local + OpenAI opcional)
│   └── …
└── public/js/                # wiring: common.js + js/pages/*.js por pantalla
```

## Requisitos

- **Docker Desktop** (para PostgreSQL local)
- **Node.js ≥ 18** (probado con Node 24)

## Puesta en marcha

```bash
cd backend
npm install

# 1) Levanta PostgreSQL en Docker
npm run db:up            # docker compose up -d

# 2) Arranca la API (en otra terminal)
npm start                # o: npm run dev  (recarga automática)

# 3) Abre la tienda
# http://localhost:3000/catalogo-de-productos
```

Al primer arranque la API **crea el esquema y siembra la base automáticamente**
(escanea los `code.html` originales para replicar los productos de los diseños),
por lo que no necesitas ejecutar migraciones a mano. El log muestra el resumen:

```
[seed] listo → 25 productos · 17 pedidos · 4 usuarios · … líneas de inventario
```

Si quieres empezar de cero (borrar y resembrar):

```bash
npm run db:down
docker volume rm backend_vivamoda_pgdata   # borra la data (ajusta el prefijo si renombras el proyecto)
npm run db:up && npm start
```

### Cargar más productos (DummyJSON)

Además de los datos demo, puedes inflar el catálogo con ropa real de la API gratuita
[DummyJSON](https://dummyjson.com/products) (sin API key): vestidos, camisas, calzado,
bolsos, joyería, relojes y gafas, todos con imágenes CDN.

```bash
cd backend
npm run seed:external                  # 12 productos por categoría (~66 en total)
npm run seed:external -- --limit 30    # 30 por categoría
npm run seed:external -- --all         # todo lo disponible (~180+)
npm run seed:external -- --dry-run     # previsualiza sin escribir en la base
```

- Requiere que la base esté sembrada (arranca `npm start` una vez si es base nueva).
- Es **idempotente**: re-ejecutar actualiza precios/ratings sin duplicar productos
  (los SKUs externos usan el sufijo `-EXT<id>`, ej. `VM-DAM-EXT177`).
- **Moneda USD:** los productos externos se guardan en dólares directos (redondeo
  retail: `.99`/`.49`). Al ejecutar el script, los productos y pedidos demo en COP se
  migran automáticamente a USD con una tasa fija (1 USD = 3950 COP, ver
  `backend/src/services/currency.js`) y todo el frontend formatea con `fmtUSD`.
  El descuento de la fuente se traslada a `compare_at` (precio tachado).
- Cada producto importado trae 3-4 imágenes (galería), variantes por talla y stock
  distribuido en las 4 tiendas (CENTRAL · CENTRO · NORTE · ONLINE).
- **Traducción al español:** nombres y descripciones se traducen automáticamente
  (`backend/src/services/translator.js`). Si hay `OPENROUTER_API_KEY` usa el LLM del
  estilista (traducción editorial en lotes); si no —o si la API falla— cae en un
  diccionario local sin red. Usa `--no-translate` para conservar el inglés original.
  Puedes probar el diccionario con `node scripts/test-translator.mjs`.

## Credenciales demo

| Rol | Identificador | Contraseña | Acceso principal |
|---|---|---|---|
| 👤 Cliente (Socio Gold) | `elena.rossi@vivamoda.com` | `Cliente123!` | Tienda, detalle, carrito, IA |
| 🧑💼 Staff / POS | `carlos.morales@vivamoda.com` | `Staff123!` | `/pedidos-y-pos` |
| 🧑💼 Staff / POS | `laura.gomez@vivamoda.com` | `Staff123!` | `/pedidos-y-pos` |
| 🛠️ Admin | `admin@vivamoda.internal` | `Admin123!` | `/panel-de-almacen-y-ventas` |

> El registro público permite crear cuentas `client` y `staff` (los staff eligen tienda
> con su código: `CENTRAL`, `NORTE`, `ONLINE`, `CENTRO`). Los admins se crean por seed/setup.
> En el login puedes usar **correo o código de empleado** (`STF-XXXXX`).

## API REST (resumen)

Autenticación por `Authorization: Bearer <token>`; los endpoints marcados 🔒 exigen rol.

```
GET    /api/health                      estado
POST   /api/auth/register               { role: client|staff, fullName, email, password, … }
POST   /api/auth/login                  { identifier: correo o STF-…, password }
GET    /api/auth/me 🔒
PUT    /api/auth/me 🔒

GET    /api/products?gender=&category=&q=&size=&maxPrice=&sort=&limit=   catálogo
GET    /api/products/:sku               detalle (variantes, tallas, stock, contenido)
GET    /api/categories                  navegación por departamentos (con conteos)
GET    /api/cart 🔒 client · POST /api/cart/items 🔒 · DELETE /api/cart/items/:id 🔒
POST   /api/orders 🔒 client            crear pedido web
GET    /api/orders/mine 🔒 client

GET    /api/pos/orders 🔒 staff         kanban de pedidos por estado
POST   /api/pos/orders 🔒 staff         venta POS (descuenta inventario)
PATCH  /api/pos/orders/:no/status 🔒    avanzar estado (pendiente→picking→packed→…)

GET    /api/admin/stats 🔒 admin        KPIs ventas, stock, cumplimiento
GET    /api/admin/products 🔒 admin     operativo (con stock por tienda)
POST/PUT/DELETE /api/admin/products 🔒  CRUD + ajustes de inventario (reorden)

POST   /api/ai/chat  { message, productContext? }   estilista Aria (motor local)
POST   /api/ai/size  { height, bust, … }            calculadora de tallas
GET    /api/ai/stats                                métricas del hub IA
```

Prueba rápida:

```bash
curl http://localhost:3000/api/health
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"elena.rossi@vivamoda.com","password":"Cliente123!"}'
curl "http://localhost:3000/api/products?gender=damas"
```

## Estilista IA

- **LLM real (OpenRouter):** define `OPENROUTER_API_KEY` en `backend/.env` (también se
  acepta `OPENAI_API_KEY`) y opcionalmente `OPENROUTER_MODEL` (default:
  `meta-llama/llama-3.3-70b-instruct`). El LLM genera la respuesta conversacional y el
  motor local aporta el contexto de catálogo real (SQL) y la calculadora de tallas.
- **Fallback automático:** si la API falla (red, cuota, timeout), responde el motor local
  y la respuesta incluye `llmError` para diagnóstico.
- **Motor local:** reglas + búsqueda sobre el catálogo real; sugiere hasta 3 prendas
  (`suggestions`) por evento/estilo. Forzable con `USE_LOCAL_AI=true`.

## Configuración (`backend/.env`)

```env
PORT=3000
DATABASE_URL=postgres://vivamoda:vivamoda_dev@localhost:5432/vivamoda
JWT_SECRET=cámbialo-en-producción
OPENROUTER_API_KEY=sk-or-v1-…
# OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct
```

## Cómo se conectan los frontends

El servidor sirve los `code.html` originales tal cual y **inyecta** antes de `</body>`
los scripts que reemplazan los datos mock por llamadas a la API (ver `backend/src/server.js`
→ `PAGE_SCRIPTS` y `backend/public/js/`). Así los diseños intactos cobran vida sin duplicarlos:

| Página | Script de wiring |
|---|---|
| Catálogo (todas las vitrinas) | `public/js/pages/catalogo.js` |
| Detalle de producto | `public/js/pages/detalle.js` |
| Hub IA | `public/js/pages/hub.js` |
| Login / Registro | `public/js/pages/login.js` |
| POS | `public/js/pages/pos.js` |
| Panel admin | `public/js/pages/admin.js` |

`common.js` aporta sesión, carrito (con soporte invitado), badge del header, formateo
de moneda USD (`fmtUSD`) y guardas de rol (`requireRole`).
