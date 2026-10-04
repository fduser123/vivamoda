# 📊 Reporte del Proyecto — VivaModa

**Fecha:** 29 de septiembre de 2026
**Proyecto:** E-commerce de moda omnicanal con inteligencia artificial
**Estado:** Funcional (demo completa con datos reales en base de datos)

---

## 1. ¿Qué es VivaModa y qué problema resuelve?

**VivaModa** es una tienda de moda premium que vende por **múltiples canales al mismo tiempo** (omnicanal): página web, tienda física con caja (POS), retiro en tienda, WhatsApp, app y Shopify.

**El problema que resuelve:** las tiendas de moda normalmente manejan su web, su caja y su inventario en sistemas separados que no se hablan entre sí. Eso causa errores clásicos:

- Vendes algo en la tienda física y la web no se entera → **ventas perdidas por stock fantasma**.
- Nadie sabe qué productos se estancan o cuáles se agotarán pronto → **dinero dormido en inventario**.
- El cliente no recibe ayuda para elegir talla o combinación → **carritos abandonados**.

**La solución VivaModa:** un solo sistema donde **todo comparte la misma base de datos en tiempo real** (catálogo, inventario, ventas de todos los canales) y donde la **inteligencia artificial ayuda tanto al cliente** (estilista virtual, traducción, tienda VR) **como al gerente** (predicción de demanda, informe ejecutivo, chat para preguntarle a los datos).

---

## 2. Estructura del proyecto (qué hay en cada carpeta)

```
proyecto 1/
│
├── backend/                  ← EL CEREBRO (todo lo que calcula y guarda)
│   ├── src/
│   │   ├── server.js         → Servidor web: sirve las páginas y la API
│   │   ├── db.js             → Conexión a la base de datos (PostgreSQL)
│   │   ├── schema.sql        → Dibujo de las 13 tablas de la base de datos
│   │   ├── seed.js           → Llena la base con datos de prueba
│   │   ├── config.js         → Puertos, llaves de IA, conexión BD
│   │   ├── routes/           → La API (9 módulos): login, catálogo, carrito,
│   │   │                       pedidos, POS, admin, IA cliente, IA admin, VR
│   │   ├── services/         → Los "expertos": estilista IA, traductor,
│   │   │                       IA administrativa, moneda, catálogo
│   │   └── middleware/       → Guardaespaldas: verifica quién eres y tu rol
│   ├── public/               → JS/CSS que se inyecta en las páginas
│   │   ├── js/common.js      → Utilidades compartidas (API, sesión, formato)
│   │   ├── js/pages/         → Un archivo por página (tienda, POS, admin…)
│   │   └── css/responsive.css→ Hace todo responsivo (móvil/tablet/PC)
│   └── docker-compose.yml    → Receta para levantar la base de datos
│
├── frontends/                ← LAS 7 PANTALLAS (mockups HTML intactos)
│   ├── catalogo-de-productos/    → Tienda pública
│   ├── detalle-de-producto/      → Ficha de producto
│   ├── portal-acceso/            → Login / registro
│   ├── hub-agente-ia/            → Chat con Aria (estilista IA)
│   ├── tienda-virtual-realidad/  → Tienda en 3D/VR
│   ├── pedidos-y-pos/            → Caja de tienda física
│   └── panel-almacen/            → Panel admin (almacén y ventas)
│
└── docs/                     ← Documentación (especificación técnica, este reporte)
```

**Idea clave del diseño:** los mockups HTML **nunca se tocan**. El servidor los sirve tal cual e **inyecta** al vuelo un archivo JS por página que los conecta con la API real. Así se conserva el diseño original y se agrega funcionalidad sin romper nada.

---

## 3. Tecnologías usadas y con qué objetivo

| Tecnología | ¿Qué es? | ¿Para qué se usa aquí? |
|---|---|---|
| **Node.js + Express** | Servidor en JavaScript | El corazón: sirve las 7 páginas y la API REST (`/api/...`) en el puerto 3000 |
| **PostgreSQL 16** | Base de datos relacional | Guarda TODO: productos, inventario, ventas, usuarios, sesiones de IA. Elegida por ser transaccional (confiable para dinero) |
| **Docker** | Contenedores | Levanta la base de datos aislada y reproducible en cualquier máquina |
| **`pg` (node-postgres)** | Conector Node ↔ PostgreSQL | Pool de 10 conexiones, transacciones para el POS |
| **HTML + Tailwind (CDN)** | Interfaz de usuario | Los 7 mockups visuales del proyecto |
| **JWT (jsonwebtoken)** | Sesiones seguras | Tokens de login guardados en el navegador; identifican a cada usuario en cada llamada |
| **bcrypt** | Encriptación | Las contraseñas NUNCA se guardan en texto plano |
| **Three.js** | Gráficos 3D en navegador | La tienda virtual en realidad virtual |
| **OpenRouter (LLM)** | Inteligencia artificial de lenguaje | Cerebro de Aria (estilista), del traductor y del analista admin. Modelo: Llama 3.3 70B. **Con fallback local si no hay internet/llave** |
| **Chart.js / QR / JsBarcode** | Librerías de utilidad | Gráficas, códigos QR y de barras en POS |

---

## 4. Las 9 inteligencias artificiales del proyecto

### Para el cliente 🛍️
1. **Aria, estilista virtual** — Chat que recomienda productos reales del catálogo, ayuda con tallas y responde dudas de envíos (LLM + motor de reglas local de respaldo).
2. **Traductor de catálogo** — Traduce nombres y descripciones de productos al español automáticamente (LLM + diccionario local).
3. **Recomendaciones en la tienda** — Productos sugeridos según lo que ves.
4. **Tienda en VR con avatar** — Probador 3D con preferencias guardadas por usuario.
5. **Precios y moneda inteligentes** — Formateo y conversión de moneda.

### Para el gerente/admin 📈 (agregadas en esta iteración)
6. **Predicción de demanda y reorden** — Calcula la velocidad de venta de cada producto y predice **qué día se agotará**, sugiriendo cuántas unidades pedir.
7. **Clasificación ABC** — Ordena el catálogo por importancia (A = vitales, B = importantes, C = rutinarios) según ingresos.
8. **Informe ejecutivo con IA** — Genera un reporte gerencial automático: resumen, qué funciona, riesgos y acciones recomendadas (LLM con analista local de respaldo).
9. **Chat "Pregunta a tus datos" (text-to-SQL)** — Escribes *"¿cuáles son los productos más vendidos?"* en español y la IA lo convierte en consulta SQL de solo lectura y te devuelve una tabla.

---

## 5. La base de datos (13 tablas)

| Grupo | Tablas | Guarda |
|---|---|---|
| Tiendas y personas | `stores`, `users` | Sucursales físicas/online; clientes, staff y admins (con niveles VIP y puntos) |
| Catálogo | `products`, `product_images`, `product_variants` | Productos con sus tallas y colores |
| Inventario | `inventory` | Cuántas unidades hay **por talla y por tienda** + punto de reorden |
| Ventas | `orders`, `order_items` | Pedidos de todos los canales con su detalle |
| Carrito web | `carts`, `cart_items`, `wishlists` | Lo que el cliente deja guardado |
| IA y VR | `ai_sessions`, `vr_user_prefs` | Conversaciones con Aria y preferencias 3D |

**Flujo de un dato:** Pantalla → API Express (verifica sesión y rol) → PostgreSQL → respuesta JSON → la página la pinta.

---

## 6. Seguridad implementada

- **Contraseñas** encriptadas con bcrypt (nunca texto plano).
- **Sesiones con JWT**: cada llamada a la API lleva el token del usuario.
- **Roles**: cliente / staff / admin — el panel admin y el POS exigen su rol (403 si no).
- **IA admin blindada** (4 capas):
  1. El LLM **nunca toca la base de datos** (solo devuelve texto).
  2. Solo entran admins.
  3. Validador de SQL: solo SELECT, una sentencia, **prohibido tocar datos personales** (emails, teléfonos, nombres), sin funciones del sistema.
  4. **Enmascarado de resultados**: si algo personal escapara, sale tapado (`el***@gmail.com`, `Elena R. G.`).

---

## 7. Cómo ejecutarlo

```bash
# 1. Base de datos
cd backend && docker compose up -d

# 2. Servidor (importante: forzar puerto 3000)
cd backend && npm install && env PORT=3000 node src/server.js

# 3. Abrir http://localhost:3000/catalogo-de-productos
```

**Usuarios demo:** `admin@vivamoda.internal / Admin123!` · `carlos.morales@vivamoda.com / Staff123!` · `elena.rossi@vivamoda.com / Cliente123!`

---

## 8. ¿Cómo seguir mejorando? (hoja de ruta)

### Corto plazo (rápido y de alto valor)
- [ ] **Configurar la llave real de OpenRouter** (`OPENROUTER_API_KEY`) → el informe y el chat pasan del motor local al LLM completo.
- [ ] **Botón "Pedir N uds" real**: que la orden de compra sugerida por la IA se guarde en la base de datos con seguimiento.
- [ ] **Índices de base de datos** (`orders.created_at`, `order_items.sku`) → consultas del panel más rápidas con más datos.
- [ ] **Log de auditoría**: guardar cada pregunta hecha a la IA (quién, cuándo, qué SQL) en una tabla visible desde el panel.

### Mediano plazo
- [ ] **Exportar el informe IA a PDF/DOCX** con formato ejecutivo.
- [ ] **Paginación y caché** en catálogos grandes (hoy carga todo).
- [ ] **Notificaciones inteligentes**: email/WhatsApp al gerente cuando la IA detecte un quiebre de stock inminente.
- [ ] **Tests automatizados** (especialmente los de seguridad del chat SQL) con `npm test`.
- [ ] **Métricas de la IA**: % de respuestas útiles de Aria, conversión de sus recomendaciones.

### Largo plazo
- [ ] **Producción segura**: HTTPS, variables de entorno reales, usuarios con contraseñas propias (no demo), y un usuario de base de datos de **solo lectura** para el chat IA (doble candado).
- [ ] **PWA / app móvil** de la tienda.
- [ ] **Pronóstico estacional**: que la predicción de demanda aprenda temporadas (Navidad, Black Friday) usando histórico de más de 30 días.
- [ ] **Integración con proveedores reales**: que las órdenes de compra sugeridas se envíen solas por email/API.
- [ ] **Multimoneda real** con tasas en vivo para vender internacional.

---

## 9. Resumen en una frase

> **VivaModa es una tienda de moda que unifica web + física + VR en una sola base de datos en tiempo real, y usa IA para vender mejor al cliente (estilista, VR) y para decidir mejor al gerente (demanda, ABC, informes, chat de datos), todo con capas de seguridad que impiden que la IA exponga información de clientes.**
