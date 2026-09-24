-- ============================================================
-- VivaModa · Esquema de base de datos (PostgreSQL)
-- Omnicanal: catálogo, clientes, staff/admin, POS, almacén, IA
-- ============================================================

CREATE TABLE IF NOT EXISTS stores (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  city        TEXT,
  address     TEXT,
  channel     TEXT NOT NULL DEFAULT 'fisica',   -- fisica | online | dark_store
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  role          TEXT NOT NULL CHECK (role IN ('client','staff','admin')),
  employee_code TEXT UNIQUE,                    -- ej. STF-84920 (staff)
  store_id      INTEGER REFERENCES stores(id),  -- sucursal asignada (staff)
  interests     TEXT[] DEFAULT '{}',            -- ['damas','caballeros','ninos']
  avatar        TEXT,                           -- female | male | child | neutral (perfil de cliente en VR)
  vip_tier      TEXT DEFAULT 'Classic',         -- Classic | Gold | Black
  points        INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  sku            TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  slug           TEXT UNIQUE NOT NULL,
  gender         TEXT NOT NULL DEFAULT 'unisex' CHECK (gender IN ('damas','caballeros','ninos','unisex')),
  category       TEXT NOT NULL,                 -- Vestidos | Sastrería | Abrigos ...
  badge          TEXT,                          -- Nuevo | Trending | Eco-Friendly | Flash | Básico | Top Ventas
  description    TEXT,
  details        JSONB NOT NULL DEFAULT '{}',   -- composición, cuidados, talla, logística ...
  price          NUMERIC(12,2) NOT NULL,
  compare_at     NUMERIC(12,2),                 -- precio tachado (si aplica)
  cost           NUMERIC(12,2) NOT NULL DEFAULT 0,
  rating         NUMERIC(3,2) NOT NULL DEFAULT 0,
  review_count   INTEGER NOT NULL DEFAULT 0,
  image_url      TEXT,
  is_new         BOOLEAN NOT NULL DEFAULT FALSE,
  is_featured    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  visibility     TEXT NOT NULL DEFAULT 'store' CHECK (visibility IN ('store','ops')), -- store: vitrina pública · ops: POS/almacén
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_images (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_variants (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT 'Único',
  sku        TEXT,
  UNIQUE (product_id, size, color)
);

CREATE TABLE IF NOT EXISTS inventory (
  id            SERIAL PRIMARY KEY,
  variant_id    INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  store_id      INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  qty           INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 10,
  UNIQUE (variant_id, store_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id             SERIAL PRIMARY KEY,
  order_no       TEXT UNIQUE NOT NULL,          -- VM-9082
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  store_id       INTEGER NOT NULL REFERENCES stores(id),
  channel        TEXT NOT NULL DEFAULT 'web',   -- web | mostrador | whatsapp | shopify | app | retiro
  status         TEXT NOT NULL DEFAULT 'pendiente',
  customer_name  TEXT NOT NULL,
  customer_phone TEXT,
  address        TEXT,
  city           TEXT,
  courier        TEXT,
  tracking_no    TEXT,
  payment_method TEXT,                          -- tarjeta | efectivo | enlace | qr | datáfono
  paid           BOOLEAN NOT NULL DEFAULT FALSE,
  subtotal       NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax            NUMERIC(12,2) NOT NULL DEFAULT 0,
  total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ai_assisted    BOOLEAN NOT NULL DEFAULT FALSE,
  cashier_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  variant_id    INTEGER REFERENCES product_variants(id),
  product_name  TEXT NOT NULL,
  sku           TEXT NOT NULL,
  size          TEXT,
  color         TEXT,
  unit_price    NUMERIC(12,2) NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS carts (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id         SERIAL PRIMARY KEY,
  cart_id    INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  qty        INTEGER NOT NULL DEFAULT 1,
  UNIQUE (cart_id, product_id, variant_id)
);

CREATE TABLE IF NOT EXISTS wishlists (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);CREATE TABLE IF NOT EXISTS ai_sessions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  session_key TEXT NOT NULL,
  product_sku TEXT,
  messages    JSONB NOT NULL DEFAULT '[]',
  rating      INTEGER,
  csat        BOOLEAN,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vr_user_prefs (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  favorite_sku TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_gender     ON products(gender);
CREATE INDEX IF NOT EXISTS idx_products_category   ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_active     ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_variants_product    ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_variant   ON inventory(variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_store     ON inventory(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_store        ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_user         ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order   ON order_items(order_id);
