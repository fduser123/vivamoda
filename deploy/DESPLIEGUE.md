# Despliegue gratuito de VivaModa

**Actualizado: 28 de octubre de 2026.** La guía anterior (Supabase + Render +
Hugging Face Spaces) ya no se puede seguir tal cual: **los Spaces con SDK
Docker exigen plan PRO** en cuentas personales. Hugging Face solo mantiene
gratis los Spaces estáticos y hasta 2 Spaces de Gradio con ZeroGPU, que no
sirven para este sidecar.

| Servicio | Estado en 2026 |
|---|---|
| Hugging Face · Docker Space | **De pago** (PRO). Era el plan A anterior. |
| Render Free | Sigue: 0,1 CPU · 512 MB · duerme a los 15 min · 5 GB/mes de salida |
| Supabase Free | 500 MB · se pausa tras 7 días sin actividad · pgvector sí |
| Neon Free | 1 GB · se suspende a los 5 min · pgvector sí |
| Oracle Always Free | **2 OCPU Ampere + 12 GB + 200 GB** (antes eran 4/24) · tarjeta solo para verificar |
| Fly.io / Railway / Cyclic | Sin plan gratuito real (prueba o crédito de 1 USD; Cyclic cerró) |

De ahí salen dos rutas honestas.

---

## Lo que hay que ejecutar

Tres procesos, y ninguno entra en 512 MB de RAM:

```
Caddy (80/443, TLS) ──► backend Node :3000 ──► PostgreSQL 16 + pgvector
                                   └────────► sidecar FashionCLIP :8001 (~1 GB RAM)
```

El backend sirve el catálogo y las vistas de `frontends/*/code.html`; la base
guarda 354 productos y los vectores de 512 dimensiones; el sidecar solo
vectoriza texto e imágenes. **Si el sidecar no está, `/api/ai/style-chat` y
`/api/ai/visual-search` devuelven 503**, pero el resto de la aplicación
(catálogo, carrito, POS, panel, Aria con LLM) funciona igual.

---

# Ruta A · Todo en una VM (recomendada)

Es la única gratuita que mantiene las tres piezas encendidas y deja 200 GB de
disco para que la base crezca. Requiere administrar una máquina Linux.

### 1. Crear la instancia

1. Cuenta en <https://cloud.oracle.com> → Free Tier. Piden **tarjeta y teléfono
   solo para verificar**: retienen 1 USD temporalmente y no cobran mientras te
   quedes en Always Free.
2. **Compute → Instances → Create**:
   - Shape: **VM.Standard.A1.Flex**, **2 OCPU / 12 GB** (es el máximo Always Free).
   - Imagen: **Ubuntu 24.04** (aarch64).
   - Boot volume: 100 GB (el total Always Free es 200 GB).
   - Asigna **IP pública**.
3. En la **security list** de la VCN, abre los puertos **80 y 443** (el 22 ya
   suele estarlo).

> Si aparece "Out of capacity", prueba otro dominio de disponibilidad o
> reintenta más tarde: es el problema más común de A1 en regiones populares.

### 2. Preparar la máquina

```bash
ssh ubuntu@IP_PUBLICA
sudo apt update && sudo apt install -y docker.io git
sudo usermod -aG docker ubuntu && newgrp docker
# plugin compose (Ubuntu 24.04 ya lo trae como docker-compose-v2)
sudo apt install -y docker-compose-v2 || sudo apt install -y docker-compose-plugin
```

### 3. Traer el código

```bash
git clone https://github.com/fduser123/vivamoda.git
cd vivamoda
git checkout feat/ia-multimodal-paginacion-v2
```

Los cambios de esta semana (métricas reales, rate limit, límites de imagen)
**están sin commitear** en la copia local. Si despliegas desde GitHub tal cual,
esos cambios no viajan: haz commit y push primero.

### 4. Configurar

```bash
cd deploy
cp .env.prod.example .env
nano .env
```

Rellena:

| Variable | Cómo obtenerla |
|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -base64 24`. **Sin `@ : / ?`** o rompe la URL de conexión |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `SITE_ADDRESS` | `TU_IP.sslip.io` (p. ej. `129.213.44.10.sslip.io`). sslip.io resuelve al IP y Caddy emite el certificado sin comprar dominio |

Opcional: una clave de LLM (`GEMINI_API_KEY` tiene tier gratuito) y las de
Cloudflare si quieres el probador con FLUX.

### 5. Arrancar

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

La primera build tarda: copia 312 MB de estáticos, instala dependencias y
descarga torch (unos 200 MB) y el modelo de 571 MB en el primer arranque del
sidecar.

### 6. Cargar los datos

**Opción rápida (demo vacía):** no hagas nada. En el primer arranque el backend
crea el esquema y siembra productos, usuarios y pedidos de ejemplo. No habrá
vectores: el asesor RAG y la búsqueda visual quedan sin catálogo vectorizado.

**Opción completa (recomendada):** mover la base local, con los 354 productos,
los embeddings y el histórico sintético de demanda.

```bash
# En tu máquina
docker exec vivamoda-postgres pg_dump -U vivamoda -d vivamoda --no-owner --no-acl \
  | gzip -9 > /tmp/vivamoda.sql.gz
scp /tmp/vivamoda.sql.gz ubuntu@IP_PUBLICA:/tmp/

# En la VM, antes de levantar el backend
cd vivamoda/deploy
docker compose -f docker-compose.prod.yml up -d db
gunzip -c /tmp/vivamoda.sql.gz | docker compose -f docker-compose.prod.yml exec -T db \
  psql -U vivamoda -d vivamoda
docker compose -f docker-compose.prod.yml up -d
```

El volcado ya incluye `CREATE EXTENSION vector`; la imagen
`pgvector/pgvector:pg16` la trae disponible.

### 7. Comprobar

```bash
BASE=https://TU_IP.sslip.io
curl -s $BASE/api/health
curl -s "$BASE/api/products?limit=1" | head -c 120
curl -s $BASE/api/ai/embeddings/status
```

El tercero es el que importa: si responde `ok` y cobertura 353/353, el backend
está hablando con el sidecar y la base tiene vectores. La prueba definitiva es
abrir `/asesor-estilo` y subir una foto en `/detalle-de-producto`.

### 8. Mantenimiento

```bash
cd vivamoda && git pull && cd deploy
docker compose -f docker-compose.prod.yml up -d --build   # actualizar
docker compose -f docker-compose.prod.yml logs -f backend # ver logs
docker compose -f docker-compose.prod.yml down            # parar (los volúmenes se conservan)
```

Un `down -v` **borra la base**. No lo uses.

> Oracle puede reclamar instancias A1 con 7 días de uso muy bajo. Un proyecto
> en uso normal no cae, pero un repositorio de demo olvidado sí: entra de vez
> en cuando o automatiza una petición diaria a `/api/health`.

---

# Ruta B · PaaS sin administrar nada

Sirve para una demo rápida o para enseñar el catálogo, **pero no puede correr
el sidecar**: 512 MB no alcanzan para torch y el modelo. Consecuencia: el
asesor RAG y la búsqueda visual devuelven 503.

| Pieza | Servicio | Límite |
|---|---|---|
| Backend | **Render Free** | 0,1 CPU · 512 MB · duerme a los 15 min · 5 GB/mes de salida |
| Base | **Neon Free** | 1 GB · se suspende a los 5 min · pgvector incluido |
| Base (alternativa) | **Supabase Free** | 500 MB · pausa a los 7 días · pgvector incluido |

### Pasos

1. **Base en Neon**: crea el proyecto, copia la cadena de conexión y ejecuta
   `CREATE EXTENSION IF NOT EXISTS vector;`. Restaura el volcado con
   `psql "postgresql://…" -f vivamoda.sql`.
2. **Backend en Render**: New → Web Service → repo de GitHub.
   - Root Directory: `backend`
   - Build: `npm install`
   - Start: `node src/server.js`
   - Health check: `/api/health`
3. **Variables** en Render:

   ```
   DATABASE_URL      = postgresql://…?sslmode=require
   JWT_SECRET        = <uno nuevo>
   TRUST_PROXY       = 1
   NODE_VERSION      = 20
   GEMINI_API_KEY    = <opcional>
   AI_DAILY_BUDGET_USD = 2
   ```

   `render.yaml` de la raíz ya declara el servicio; si lo usas, solo rellena
   los valores marcados `sync: false`.

4. **Con Supabase**, ojo con la conexión: la directa es **IPv6**, y Render no
   siempre tiene salida IPv6. Usa el pooler **Supavisor en modo sesión**:

   ```
   postgresql://postgres.<PROJECT_REF>:<CLAVE>@<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
   ```

---

## Qué se versiona y qué no

El `.gitignore` excluye por defecto los `.glb` y `backend/public/img/ext/`, pero
tiene **excepciones** para los recursos que el producto necesita. Si tocas esa
lista, el despliegue sale roto sin dar error:

| Recurso | Peso | Sin él |
|---|---|---|
| `backend/public/img/ext/` | 135 MB · 607 archivos | 303 de 354 productos con imagen rota |
| `backend/public/models/mk-it.glb` | 61 MB | La tienda VR sin escenario |
| `sneaker-realista`, `camiseta`, `bolso`, `gafas-sol`, `zapatos` | ~8 MB | Sin objetos 3D en el probador |

Comprobación antes de desplegar:

```bash
git ls-files backend/public/img/ext | wc -l   # 607
git ls-files backend/public/models/mk-it.glb  # debe aparecer
```

`backend/ai/.venv` (2,2 GB) y `backend/ai/artifacts/` quedan fuera.

---

## Cómo crece la base de datos

| Dónde | Espacio | Qué implica |
|---|---|---|
| Oracle (ruta A) | 200 GB de bloque | La base puede crecer décadas a este ritmo; hoy ocupa 123 MB |
| Neon (ruta B) | 1 GB por proyecto | Suficiente para catálogo, pedidos y vectores; vigila el histórico de ventas |
| Supabase (ruta B) | 500 MB | Justo para el volcado actual (123 MB); crece rápido con `sales_history` |

Si algún día los estáticos pasan de ~500 MB, muévelos a Cloudflare R2 o a
Supabase Storage y actualiza `products.image_url`; no los borres.

---

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| Todos reciben 429 a la vez | `TRUST_PROXY` sin definir: `req.ip` es la IP del proxy | Ya va en `1` en el compose; en Render, ponlo a mano |
| Caddy no emite certificado | El nombre no resuelve al IP o faltan los puertos | Comprueba `dig SITE_ADDRESS`, abre 80/443 en la VCN y en `ufw` |
| `password authentication failed` | La contraseña tiene `@ : / ?` y rompe la URL | Usa solo letras y números, o codifícala |
| `relation "vector" does not exist` | Falta la extensión | `CREATE EXTENSION vector;` en la base |
| Sidecar tarda minutos | Descarga el modelo de 571 MB la primera vez | Espera; luego cada vector son ~190 ms |
| `torchvision::nms does not exist` | Rueda CUDA en lugar de CPU | Reinstala con el índice `whl/cpu` (ya lo hace el Dockerfile) |
| La app arranca pero todo da 404 | Se construyó con contexto `backend/` y faltan `frontends/` | Usa `deploy/backend.Dockerfile` desde la raíz |
| Render tarda 60 s | Plan free: duerme a los 15 min | Despiértalo antes de la demo |

---

## Coste

| Pieza | Plan | Coste |
|---|---|---|
| VM + disco + PostgreSQL + sidecar | Oracle Always Free | 0 |
| Render + Neon/Supabase | Free | 0 |
| TLS | Let's Encrypt vía Caddy o Render | 0 |
| LLM | Gemini free tier o motor local | 0 |

**Total: 0**, con la contrapartida de la tarjeta de verificación de Oracle y de
que en la ruta B los servicios duermen.

---

## Qué está probado (28/10/2026)

- Las dos imágenes construyen sin errores: `deploy/backend.Dockerfile` y
  `deploy/sidecar.Dockerfile` (contexto = raíz del repositorio).
- El contenedor del backend arranca contra el PostgreSQL local con pgvector y
  responde `/api/health` (200), `/catalogo-de-productos` (200, 81 KB),
  `/asesor-estilo` (200), sirve las **607** imágenes de `img/ext` y
  `mk-it.glb` con `model/gltf-binary`.
- Sin el sidecar, `/api/ai/embeddings/status` informa la dependencia caída en
  vez de romper la página.
- `caddy validate` acepta el `Caddyfile`.
- **Sin probar:** `docker compose up` completo (esta máquina no tiene el
  plugin compose) y la emisión real del certificado, que depende del DNS de la
  VM.

## Archivos de esta carpeta

| Archivo | Uso |
|---|---|
| `docker-compose.prod.yml` | Ruta A completa (4 contenedores) |
| `backend.Dockerfile` · `sidecar.Dockerfile` | Imágenes; contexto = raíz del repo |
| `Caddyfile` | TLS y proxy inverso |
| `.env.prod.example` | Plantilla de variables del compose |
| `migrar-base.sh` | Volcado local → PostgreSQL remoto (ruta B) |
| `Dockerfile` · `README-space.md` | **Legado** del Space de Hugging Face; ya no es una opción gratuita |
