# 🏗️ Arquitectura y Modelo de Datos — VivaModa

> Diagramas en **Mermaid** (se renderizan en GitHub/GitLab/VS Code con extensión Markdown Preview Mermaid).
> Contexto del proyecto: [`docs/REPORTE.md`](./REPORTE.md)

## Índice

1. [Arquitectura del sistema](#1-arquitectura-del-sistema)
2. [Modelo de datos (ER)](#2-modelo-de-datos-er)
3. [Capas del backend](#3-capas-del-backend)
4. [Flujo de una petición autenticada](#4-flujo-de-una-petición-autenticada)
5. [Mapa de rutas y módulos del frontend](#5-mapa-de-rutas-y-módulos-del-frontend)
6. [Flujo de un pedido (checkout y POS)](#6-flujo-de-un-pedido-checkout-y-pos)
7. [Módulo VR (registro de partes)](#7-módulo-vr-registro-de-partes)

---

## 1. Arquitectura del sistema

```mermaid
flowchart TB
    subgraph CLIENTE["🖥️ Navegador"]
        direction TB
        MOCK["Mockups HTML + Tailwind CDN<br/>(diseños originales servidos tal cual)"]
        COMMON["common.js<br/>window.VM · fetch + JWT · carrito · guards"]
        PAGES["pages/*.js<br/>catalogo · detalle · hub · login · pos · admin"]
        VR["vr-store/*.js<br/>Three.js r128 · 11 módulos"]
        MOCK --> COMMON
        MOCK --> PAGES
        MOCK --> VR
    end

    subgraph SERVER["⚙️ Express 4 (backend/src)"]
        direction TB
        BOOT["server.js<br/>CORS · express.json 1mb · attachUser"]
        MW["middleware/auth.js<br/>JWT · requireAuth · requireRole"]
        ROUTES["routes/<br/>auth · catalog · cart · orders · pos · admin · ai · vr"]
        SERVICES["services/<br/>products.js (consultas) · stylist.js (IA Aria)"]
        DBLAYER["db.js<br/>pool pg · query() · tx() · ensureSchema() · seedIfEmpty()"]
        BOOT --> MW --> ROUTES --> SERVICES --> DBLAYER
    end

    subgraph DATA["🗄️ PostgreSQL 16 (Docker)"]
        PG[("13 tablas<br/>products · variants · inventory<br/>orders · carts · ai_sessions …")]
        SCHEMA["schema.sql<br/>DDL idempotente al arrancar"]
        SEED["seed.js<br/>scraping de mockups + datos demo"]
        SCHEMA --> PG
        SEED --> PG
    end

    CLIENTE -- "HTTP · JSON<br/>Authorization: Bearer JWT" --> SERVER
    DBLAYER -- "SQL parametrizado ($1…$n)" --> DATA

    STORAGE[["localStorage<br/>vm_token · vm_user<br/>vm_cart_guest · vm_cart_count"]]
    CLIENTE -.-> STORAGE
```

**Lectura del diagrama**

- El backend es **API-first pero también sirve los mockups**: `sendPage()` inyecta `common.js` + el script de la página antes de `</body>`, por lo que no hay duplicación de HTML.
- Toda petición pasa por `attachUser` (autenticación **opcional**) y cada router endurece el acceso con `requireAuth` / `requireRole`.
- El acceso a datos está aislado en `db.js` (pool de 10 conexiones, `tx()` para transacciones, `ensureSchema()` + `seedIfEmpty()` en el arranque).
- El estado de sesión vive en `localStorage`; el servidor es *stateless* (solo JWT).

---

## 2. Modelo de datos (ER)

```mermaid
erDiagram
    STORES ||--o{ USERS : "asigna"
    STORES ||--o{ INVENTORY : "almacena"
    STORES ||--o{ ORDERS : "atiende"

    USERS ||--o| CARTS : "tiene"
    USERS ||--o{ ORDERS : "realiza"
    USERS ||--o{ AI_SESSIONS : "conversa"
    USERS ||--o| VR_USER_PREFS : "prefiere"
    USERS ||--o{ WISHLISTS : "marca"

    PRODUCTS ||--o{ PRODUCT_IMAGES : "galeria"
    PRODUCTS ||--o{ PRODUCT_VARIANTS : "variantes"
    PRODUCTS ||--o{ ORDER_ITEMS : "vendido-en"
    PRODUCTS ||--o{ CART_ITEMS : "en-bolsa"
    PRODUCTS ||--o{ WISHLISTS : "favorito"

    PRODUCT_VARIANTS ||--o{ INVENTORY : "stock-por-tienda"
    PRODUCT_VARIANTS ||--o{ ORDER_ITEMS : "variante"
    PRODUCT_VARIANTS ||--o{ CART_ITEMS : "variante"

    CARTS ||--o{ CART_ITEMS : "contiene"
    ORDERS ||--o{ ORDER_ITEMS : "detalle"

    STORES {
        int id PK
        text code UK "CENTRAL · NORTE · ONLINE · CENTRO"
        text name
        text city
        text channel "fisica | online | dark_store"
        bool is_active
    }

    USERS {
        int id PK
        text email UK
        text password_hash "bcrypt 10 rondas"
        text full_name
        text role "client | staff | admin"
        text employee_code UK "STF-#####"
        int store_id FK "sucursal del staff"
        text_array interests "damas | caballeros | ninos"
        text avatar "female | male | child | neutral"
        text vip_tier "Classic | Gold | Black"
        int points
        bool is_active
    }

    PRODUCTS {
        int id PK
        text sku UK
        text name
        text slug UK
        text gender "damas | caballeros | ninos | unisex"
        text category
        text badge "Nuevo | Flash | Top Ventas ..."
        jsonb details "composicion · cuidados · logistica"
        numeric price
        numeric compare_at "precio tachado"
        numeric cost
        numeric rating
        text image_url
        bool is_new
        bool is_featured
        text visibility "store (vitrina) | ops (POS/almacen)"
        bool is_active
    }

    PRODUCT_IMAGES {
        int id PK
        int product_id FK
        text url
        int position
    }

    PRODUCT_VARIANTS {
        int id PK
        int product_id FK
        text size
        text color
        text sku
    }

    INVENTORY {
        int id PK
        int variant_id FK
        int store_id FK
        int qty
        int reorder_point
    }

    ORDERS {
        int id PK
        text order_no UK "VM-####"
        int user_id FK "null en venta de mostrador"
        int store_id FK
        text channel "web | mostrador | whatsapp | shopify | app | retiro"
        text status "pendiente→picking→packed→in_transit→delivered|cancelled"
        text customer_name
        text courier
        text tracking_no
        text payment_method "tarjeta | efectivo | enlace | qr | datafono"
        bool paid
        numeric subtotal
        numeric discount
        numeric tax "IVA 19%"
        numeric total
        bool ai_assisted
        int cashier_id FK
        timestamptz created_at
        timestamptz updated_at
    }

    ORDER_ITEMS {
        int id PK
        int order_id FK
        int product_id FK
        int variant_id FK
        text product_name "snapshot"
        text sku "snapshot"
        text size
        text color
        numeric unit_price "snapshot"
        int qty
    }

    CARTS {
        int id PK
        int user_id FK "UNIQUE 1:1"
        timestamptz created_at
    }

    CART_ITEMS {
        int id PK
        int cart_id FK
        int product_id FK
        int variant_id FK
        int qty "1..50"
    }

    WISHLISTS {
        int user_id PK "compuesta"
        int product_id PK "compuesta"
        timestamptz created_at
    }

    AI_SESSIONS {
        int id PK
        int user_id FK
        text session_key
        text product_sku
        jsonb messages "ultimos 40 turnos"
        int rating
        bool csat
        timestamptz created_at
    }

    VR_USER_PREFS {
        int user_id PK
        text favorite_sku
        timestamptz updated_at
    }
```

### Relaciones en texto (referencia rápida)

| Origen | Cardinalidad | Destino | Semántica |
|---|---|---|---|
| `stores` | 1 → N | `users` | Tienda asignada al staff |
| `stores` | 1 → N | `inventory` | Stock por sucursal |
| `stores` | 1 → N | `orders` | Pedidos despachados por tienda/canal |
| `users` | 1 → 0..1 | `carts` | Carrito persistente (1 por usuario) |
| `users` | 1 → N | `orders` | Pedidos del cliente (`user_id` NULL en POS) |
| `users` | 1 → N | `orders` (cashier) | Cajero que registró la venta |
| `users` | 1 → N | `ai_sessions` | Conversaciones con Aria |
| `users` | 1 → 0..1 | `vr_user_prefs` | Producto destacado en VR |
| `products` | 1 → N | `product_images` / `product_variants` | Galería y talla×color |
| `product_variants` | 1 → N | `inventory` | Stock por variante y tienda |
| `products` | 1 → N | `order_items` / `cart_items` / `wishlists` | Economía del producto |
| `orders` | 1 → N | `order_items` | Líneas del pedido |
| `carts` | 1 → N | `cart_items` | Líneas de la bolsa |

### Constraints e integridad

| Constraint | Tabla | Detalle |
|---|---|---|
| `UNIQUE` | `users` | `email`, `employee_code` |
| `CHECK` | `users.role` | `client · staff · admin` |
| `UNIQUE` | `products` | `sku`, `slug` |
| `CHECK` | `products.gender` / `products.visibility` | Enumeraciones controladas |
| `UNIQUE` | `product_variants` | `(product_id, size, color)` |
| `UNIQUE` | `inventory` | `(variant_id, store_id)` |
| `UNIQUE` | `carts` | `user_id` (1:1) |
| `UNIQUE` | `cart_items` | `(cart_id, product_id, variant_id)` |
| `PRIMARY KEY` compuesta | `wishlists` | `(user_id, product_id)` |
| `PRIMARY KEY` | `vr_user_prefs` | `user_id` |
| `ON DELETE CASCADE` | Imágenes, variantes, inventario, ítems, carrito | Limpieza en cascada |
| `ON DELETE SET NULL` | `orders.user_id`, `orders.cashier_id`, `ai_sessions.user_id` | Preserva histórico |

### Índices

```sql
idx_products_gender · idx_products_category · idx_products_active
idx_variants_product · idx_inventory_variant · idx_inventory_store
idx_orders_status · idx_orders_store · idx_orders_user · idx_order_items_order
```

---

## 3. Capas del backend

```mermaid
flowchart LR
    subgraph HTTP["Capa HTTP"]
        S["server.js<br/>CORS · json · attachUser<br/>rutas amigables + inyección de scripts"]
    end

    subgraph AUTH["Capa de seguridad"]
        M["middleware/auth.js<br/>signToken · loadUser<br/>requireAuth · requireRole"]
    end

    subgraph R["Capa de controladores (routes/)"]
        direction TB
        RA["auth.js<br/>registro · login · perfil"]
        RC["catalog.js<br/>productos · categorías · tiendas"]
        RT["cart.js<br/>carrito del cliente"]
        RO["orders.js<br/>checkout · mis pedidos"]
        RP["pos.js<br/>mostrador · kanban · estados"]
        RD["admin.js<br/>KPIs · CRUD · inventario"]
        RI["ai.js<br/>chat · tallas · métricas"]
        RV["vr.js<br/>sesión · destacados · cuidado"]
    end

    subgraph SV["Capa de dominio (services/)"]
        SP["products.js<br/>listProducts · getProductDetail<br/>getVariantsWithStock · toLight"]
        SS["stylist.js<br/>extractIntent · recommendForIntent<br/>recommendSize · stylistReply"]
    end

    subgraph DL["Capa de datos"]
        D["db.js<br/>pool(10) · query() · tx()<br/>ensureSchema() · money()"]
        DB[("PostgreSQL 16")]
    end

    HTTP --> AUTH --> R --> SV --> DL
    D --> DB
```

**Regla de dependencias:** las rutas nunca escriben SQL complejo de negocio; delegan en `services/`. Las mutaciones críticas (checkout, venta POS, ajuste de inventario) usan `tx()` con `BEGIN/COMMIT/ROLLBACK`.

---

## 4. Flujo de una petición autenticada

```mermaid
sequenceDiagram
    autonumber
    participant U as Usuario (navegador)
    participant C as common.js (VM.api)
    participant E as Express (server.js)
    participant A as attachUser (JWT)
    participant RT as Router (/api/…)
    participant SV as Service
    participant PG as PostgreSQL

    Note over U,PG: 1) Login
    U->>C: credenciales
    C->>E: POST /api/auth/login
    E->>PG: SELECT id WHERE email|employee_code
    PG-->>E: fila usuario
    E->>E: bcrypt.compareSync(password)
    E->>PG: loadUser(id) (JOIN stores)
    E-->>C: { token (JWT 12h), user }
    C->>C: localStorage vm_token / vm_user
    C->>C: evento vm:auth + pintar chip usuario

    Note over U,PG: 2) Petición protegida
    U->>C: acción en la pantalla
    C->>E: GET /api/…<br/>Authorization: Bearer token
    E->>A: verificar firma + cargar usuario
    A->>PG: loadUser(payload.sub)
    PG-->>A: req.user = { id, role, storeId, … }
    A->>RT: next()
    RT->>RT: requireAuth / requireRole(...)
    alt sin permiso
        RT-->>C: 401 UNAUTHENTICATED / 403 FORBIDDEN
        C->>C: si 401 → clearSession()
    else autorizado
        RT->>SV: consulta de dominio
        SV->>PG: SQL parametrizado ($1…$n)
        PG-->>SV: filas
        SV-->>RT: DTO camelCase (Number, arrays)
        RT-->>C: JSON { … }
        C->>U: render / toast
    end
```

---

## 5. Mapa de rutas y módulos del frontend

```mermaid
flowchart TB
    ROOT["/  →  redirige a /catalogo-de-productos"]

    subgraph TIENDA["🛍️ Experiencia cliente"]
        CAT["/catalogo-de-productos<br/>/catalogo-caballeros · /catalogo-ninos<br/>/novedades · /ofertas-flash"]
        DET["/detalle-de-producto?sku=…"]
        HUB["/hub-agente-ia"]
        VR["/tienda-virtual-realidad"]
    end

    subgraph AUTHZ["🔐 Acceso"]
        LOG["/iniciar-sesion · /registro"]
    end

    subgraph OPS["🧾 Operación"]
        POS["/pedidos-y-pos<br/>staff · admin"]
        ADM["/panel-de-almacen-y-ventas<br/>admin"]
    end

    subgraph PH["🚧 Placeholders"]
        P1["/carrito-de-compras · /checkout · /perfil-de-usuario<br/>/guia-de-tallas · /seguimiento-de-pedidos<br/>/lista-de-deseos · /politica-de-devoluciones"]
    end

    ROOT --> TIENDA
    ROOT --> AUTHZ
    ROOT --> OPS
    ROOT --> PH

    CAT --> C1["catalogo.js<br/>GET /categories · GET /products<br/>POST /ai/chat"]
    DET --> C2["detalle.js<br/>GET /products/:sku<br/>POST /ai/size · POST /ai/chat"]
    HUB --> C3["hub.js<br/>POST /ai/chat · GET /ai/stats"]
    VR --> C4["vr-store/*.js<br/>GET /api/vr/session/public<br/>GET /api/products · GET /api/vr/products/:sku/care"]
    LOG --> C5["login.js<br/>GET /stores · POST /auth/login · POST /auth/register"]
    POS --> C6["pos.js<br/>GET /pos/summary · GET /pos/products<br/>GET/POST /pos/orders · PATCH …/status"]
    ADM --> C7["admin.js<br/>GET /admin/stats · POST/PUT /admin/products<br/>PATCH /admin/inventory/:variantId"]
```

---

## 6. Flujo de un pedido (checkout y POS)

```mermaid
sequenceDiagram
    autonumber
    participant CL as Cliente (web)
    participant API as API
    participant PG as PostgreSQL
    participant ST as Staff (POS)

    Note over CL,PG: Checkout web — POST /api/orders
    CL->>API: { address, city, paymentMethod }
    API->>PG: BEGIN
    API->>PG: leer cart_items + products + variants
    API->>PG: verificar stock en tienda ONLINE
    alt stock insuficiente
        API->>PG: ROLLBACK
        API-->>CL: 409 "Stock insuficiente: …"
    else stock ok
        API->>PG: UPDATE inventory qty = qty - n
        API->>PG: calcular subtotal · desc · IVA 19% · total
        API->>PG: INSERT orders (status 'picking') + order_items
        API->>PG: DELETE cart_items (vaciar bolsa)
        API->>PG: COMMIT
        API-->>CL: 201 order VM-#### + mensaje
    end

    Note over ST,PG: Venta de mostrador — POST /api/pos/orders
    ST->>API: { items:[{sku,size,qty}], channel:'mostrador', paid:true }
    API->>PG: BEGIN
    API->>PG: resolver producto + variante por SKU y talla
    API->>PG: verificar y descontar stock de la tienda del staff
    API->>PG: INSERT orders (status 'delivered', cashier_id) + order_items
    API->>PG: COMMIT
    API-->>ST: 201 venta registrada

    Note over ST,PG: Avance de estado — PATCH /api/pos/orders/:no/status
    ST->>API: { status }
    API->>API: validar contra ALLOWED_TRANSITIONS
    API->>PG: UPDATE orders SET status, updated_at = now()
    API-->>ST: 200 order con nextStatuses
```

**Máquina de estados del pedido**

```mermaid
stateDiagram-v2
    [*] --> pendiente
    pendiente --> picking
    picking --> packed
    packed --> in_transit
    packed --> delivered
    in_transit --> delivered
    pendiente --> cancelled
    picking --> cancelled
    packed --> cancelled
    in_transit --> cancelled
    delivered --> [*]
    cancelled --> [*]

    note right of pendiente
        El checkout web crea el pedido
        directamente en «picking»
    end note
    note right of delivered
        La venta POS nace ya en «delivered»
    end note
```

---

## 7. Módulo VR (registro de partes)

```mermaid
flowchart TB
    HTML["tienda_virtual_realidad/code.html<br/>canvas + HUD (zonas, cliente, tarjeta)"]
    HTML --> THREE["Three.js r128 + OrbitControls (CDN)"]
    HTML --> CORE["core.js — VRStore"]

    CORE --> ENGINE["Motor: renderer · scene · camera 60°<br/>OrbitControls · fog · reloj · resize"]
    CORE --> PALETTE["Paleta VivaModa + 5 ZONAS<br/>damas · caballeros · ninos · novedades · ofertas"]
    CORE --> CATALOG["CATALOG (17 SKUs) + bySku()<br/>imágenes reales vía GET /api/products"]
    CORE --> REG["Registry: VRStore.part(name, fn)"]
    CORE --> LOOP["animate(): tour + hooks + render"]

    REG --> P1["estructura"]
    REG --> P2["percheros"]
    REG --> P3["estantes"]
    REG --> P4["espejos"]
    REG --> P5["mobiliario"]
    REG --> P6["ropa"]
    REG --> P7["secciones"]
    REG --> P8["letreros"]
    REG --> P9["interaccion<br/>raycasting · panel holo · tarjeta"]
    REG --> P10["mode-fps<br/>primera persona"]
    HTML --> AV["avatar-client.js<br/>GET/POST /api/vr/session"]

    LOOP --> RENDER["WebGL"]
```

**Contrato del registry**

```js
VRStore.part('nombre', (S, group) => { /* construir malla en `group` */ });
VRStore.addClickable(mesh);          // objetos seleccionables (raycasting)
VRStore.addAnimate((dt, t) => {});   // hook por fotograma
VRStore.init();                      // construye partes + arranca el bucle
```

---

## 8. Referencias cruzadas

| Tema | Archivo |
|---|---|
| Reporte narrativo completo | [`docs/REPORTE.md`](./REPORTE.md) |
| DDL de la base de datos | `backend/src/schema.sql` |
| Arranque, rutas amigables e inyección de scripts | `backend/src/server.js` |
| Autenticación y roles | `backend/src/middleware/auth.js` |
| Consultas de catálogo e inventario | `backend/src/services/products.js` |
| Motor de IA "Aria" | `backend/src/services/stylist.js` |
| Semilla demo (scraping + datos) | `backend/src/seed.js` |
| Helpers del cliente | `backend/public/js/common.js` |
| Motor y partes de la tienda VR | `backend/public/js/pages/vr-store/` |
