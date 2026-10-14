# Guía de despliegue gratuito — VivaModa

Tres servicios gratuitos, cada uno donde cabe:

```
┌─────────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
│   SUPABASE (free)   │   │  RENDER (free)   │   │ HUGGING FACE SPACES │
│  PostgreSQL 16      │◄──│  Backend Node    │──►│  Sidecar Python     │
│  + pgvector         │   │  + estáticos     │   │  FashionCLIP        │
│  500 MB · 123 usados│   │  512 MB RAM      │   │  16 GB RAM · CPU    │
└─────────────────────┘   └──────────────────┘   └─────────────────────┘
```

**Por qué repartido:** el sidecar de FashionCLIP necesita ~1 GB de RAM y la
mayoría de planes gratuitos dan 512 MB. Hugging Face Spaces es el único
gratuito que da 16 GB y permite ejecutar PyTorch.

---

## ✅ Archivos ya preparados (no los toques)

| Archivo | Para qué sirve |
|---|---|
| `deploy/requirements.txt` | Dependencias del sidecar, versiones exactas probadas |
| `deploy/Dockerfile` | Imagen del Space de Hugging Face |
| `deploy/README-space.md` | Ficha del Space (renombrar a `README.md`) |
| `render.yaml` (raíz) | Configuración de Render. **Debe estar en la raíz**, no en `deploy/`: Render solo lo detecta ahí |
| `deploy/migrar-base.sh` | Exporta la base local y la importa en Supabase |
| `backend/ai/embed_server.py` | **Ya modificado**: `EMBED_HOST` y `PORT` por variables de entorno |

---

## 🔴 CRÍTICO: recursos que no se desplegaban

**Este es el problema más grave que se encontró al preparar el despliegue.**
Git ignoraba recursos que el producto necesita, así que un despliegue desde el
repositorio habría salido roto sin dar ningún error.

### Qué faltaba

| Recurso | Peso | Consecuencia si falta |
|---|---|---|
| `backend/public/img/ext/` | **135 MB · 607 archivos** | **303 de 354 productos (86 %) con la imagen rota** |
| `backend/public/models/mk-it.glb` | 61 MB | La tienda VR se queda **sin escenario** |
| `sneaker-realista`, `camiseta`, `bolso`, `gafas-sol`, `zapatos` | ~8 MB | Objetos 3D del probador y los estands, ausentes |

### La causa

El `.gitignore` excluía `backend/public/models/**/*.glb` y `backend/public/img/ext/`
para no inflar el repositorio. Es una decisión razonable en desarrollo, pero
**esos archivos son parte del producto**, no artefactos generados: el catálogo
los referencia directamente en la base de datos
(`products.image_url = '/img/ext/VM-...webp'`).

### La corrección (ya aplicada)

Se añadieron excepciones al final de `.gitignore`:

```gitignore
!backend/public/img/ext/
!backend/public/img/ext/**

!backend/public/models/mk-it.glb
!backend/public/models/bolso.glb
!backend/public/models/camiseta.glb
!backend/public/models/gafas-sol.glb
!backend/public/models/sneaker-realista.glb
!backend/public/models/zapatos.glb
```

### Antes de desplegar, comprueba SIEMPRE

```bash
cd "/home/a/Escritorio/p/proyecto 1/proyecto 1"

# 1. ¿Se rastrean las imágenes?
git ls-files backend/public/img/ext | wc -l     # debe dar 607

# 2. ¿Se rastrea el modelo de la tienda VR?
git ls-files backend/public/models/mk-it.glb    # debe aparecer

# 3. ¿Cuánto pesa realmente lo que se va a subir?
git ls-files | wc -l                            # ~1145 archivos
```

### Si el repositorio se hace demasiado pesado

Con los recursos incluidos, el repositorio ronda los **250 MB**. GitHub lo
acepta (el límite de archivo individual son 100 MB y `mk-it.glb` tiene 61 MB),
pero Render tardará más en clonar. Alternativas, por orden de sencillez:

1. **Supabase Storage** (1 GB gratis): subir las imágenes, cambiar
   `products.image_url` a las nuevas URLs y servir los modelos desde ahí.
2. **Cloudflare R2** o **jsDelivr** para los modelos 3D.
3. **Git LFS** para los `.glb` grandes.

En cualquiera de los tres casos hay que **actualizar las rutas en la base de
datos**, no solo mover los archivos.


---

## ✏️ Lo que TIENES que editar a mano

### 1. `backend/.env` — **NO se sube a git**

**Ubicación:** `backend/.env` (en la raíz del backend, junto a `package.json`)

En producción **este archivo no se usa**: las variables van en el panel de
Render. Pero **sí debes revisarlo en tu máquina** para desarrollo:

```bash
DATABASE_URL=postgresql://vivamoda:vivamoda_dev@localhost:5432/vivamoda
EMBED_SERVICE_URL=http://127.0.0.1:8001
JWT_SECRET=<uno_de_desarrollo>
DEEPSEEK_API_KEY=<tu_clave>
PORT=3000
```

⚠️ **Nunca subas este archivo.** Verifica que `.env` está en `.gitignore`:

```bash
cd "/home/a/Escritorio/p/proyecto 1/proyecto 1"
git check-ignore -v backend/.env
```

---

### 2. `deploy/README-space.md` → **renombrarlo a `README.md`**

**Dónde:** al crear el Space en Hugging Face, el archivo **debe llamarse
`README.md`** exactamente. Si lo subes como `README-space.md`, el Space no
arranca.

**Qué editar dentro:** nada obligatorio. Opcionalmente cambia el título:

```yaml
---
title: VivaModa Embeddings        ← cámbialo si quieres
emoji: 🧵
sdk: docker
app_port: 7860                     ← NO lo cambies, debe coincidir con el Dockerfile
---
```

---

### 3. `deploy/Dockerfile` — **una línea opcional**

**Ubicación:** en la raíz del Space (junto al `README.md` y `embed_server.py`).

Lo único que podrías ajustar es el puerto, **si Hugging Face te pide otro**:

```dockerfile
ENV PORT=7860      ← debe coincidir con app_port del README.md
EXPOSE 7860        ← idem
```

Si cambias uno, cambia los dos.

---

### 4. `render.yaml` — **ya está en la RAÍZ, no lo muevas**

**Ubicación:** `proyecto 1/proyecto 1/render.yaml`, en la raíz.

Render solo detecta este archivo si está en la raíz del repositorio, por eso no
vive en `deploy/` con el resto de la configuración. Si lo mueves, Render deja
de aplicarlo y tendrás que configurar el servicio a mano desde su panel.

Si tu repositorio en GitHub tiene otra rama como principal, edita:

```yaml
    branch: feat/ia-multimodal-paginacion-v2    ← añade esta línea con tu rama
```

---

### 5. `backend/ai/embed_server.py` — **ya está listo, solo compruébalo**

Este es el cambio de código más importante y **ya lo hice**. Verifica que
tiene estas dos líneas (sobre la línea 39):

```python
HOST = os.environ.get("EMBED_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", os.environ.get("EMBED_PORT", "8001")))
```

**En local sigue funcionando igual** (127.0.0.1:8001). En el Space, el
`Dockerfile` inyecta `EMBED_HOST=0.0.0.0` y `PORT=7860`.

⚠️ **Si no tuviera estas líneas**, el sidecar escucharía solo en `127.0.0.1`,
que acepta únicamente conexiones locales: desde Render sería inalcanzable.

---

### 6. `.gitignore` — **verifica estas tres entradas**

**Ubicación:** `proyecto 1/proyecto 1/.gitignore`

```gitignore
.env
.venv/
node_modules/
```

Comprueba que `backend/ai/.venv` está excluido (**pesa 2,2 GB** y reventaría el
build de Render):

```bash
git check-ignore -v backend/ai/.venv
# Debe responder: .gitignore:7:.venv/    backend/ai/.venv
```

---

### 7. ⚠️ El repositorio pesa **482 MB**

Casi todo son estáticos (`backend/public`, 311 MB, incluidos modelos 3D de
63 MB). Render clonará todo eso en cada despliegue.

**Si el build se hace lento o falla**, mueve los modelos pesados fuera del repo:

```bash
# Ver qué pesa más
du -sh backend/public/* | sort -rh | head -5
```

Los modelos (`backend/public/models/*.glb`) son los candidatos a mover a un
CDN. **No los borres sin más**: la tienda VR y la asesora 3D los necesitan.

---

## 🚀 Orden de despliegue

### Paso 1 — Base de datos en Supabase

1. Crea un proyecto en <https://supabase.com> (plan Free)
2. En **SQL Editor**, ejecuta:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Copia la cadena de conexión de **Settings → Database** y añade
   `?sslmode=require` al final
4. Migra los datos desde tu máquina:
   ```bash
   cd "/home/a/Escritorio/p/proyecto 1/proyecto 1/deploy"
   ./migrar-base.sh "postgresql://postgres:CLAVE@db.xxxx.supabase.co:5432/postgres"
   ```
5. Verifica:
   ```bash
   psql "postgresql://..." -c "SELECT COUNT(*) FROM products;"       # 354
   psql "postgresql://..." -c "SELECT COUNT(*) FROM product_embeddings;"  # 353
   ```

### Paso 2 — Sidecar en Hugging Face Spaces

1. Crea un Space en <https://huggingface.co/new-space> → SDK **Docker** → plantilla *Blank*
2. Sube **cuatro archivos** a la raíz del Space:

   | Archivo local | Nombre en el Space |
   |---|---|
   | `deploy/Dockerfile` | `Dockerfile` |
   | `deploy/requirements.txt` | `requirements.txt` |
   | `deploy/README-space.md` | **`README.md`** ← renombrar |
   | `backend/ai/embed_server.py` | `embed_server.py` |

3. Espera a que construya (10-15 min la primera vez)
4. Verifica:
   ```bash
   curl https://TU-USUARIO-TU-SPACE.hf.space/health
   # {"ok": true, "model": "hf-hub:Marqo/marqo-fashionCLIP", "dim": 512, ...}
   ```

### Paso 3 — Backend en Render

1. Crea un **Web Service** en <https://render.com> conectado a tu repositorio
2. Configura:

   | Campo | Valor |
   |---|---|
   | Root Directory | `backend` |
   | Build Command | `npm install` |
   | Start Command | `node src/server.js` |
   | Health Check Path | `/api/health` |

3. En **Environment**, añade:

   ```
   DATABASE_URL      = postgresql://postgres:CLAVE@db.xxx.supabase.co:5432/postgres?sslmode=require
   EMBED_SERVICE_URL = https://TU-USUARIO-TU-SPACE.hf.space
   DEEPSEEK_API_KEY  = <tu_clave>
   JWT_SECRET        = <genera uno nuevo: openssl rand -base64 48>
   NODE_VERSION      = 20
   ```

4. Despliega y verifica:
   ```bash
   curl https://tu-app.onrender.com/api/health
   curl https://tu-app.onrender.com/api/ai/embeddings/status
   ```

---

## 🔍 Verificación final

```bash
BASE=https://tu-app.onrender.com

# 1. Backend vivo
curl $BASE/api/health

# 2. Base de datos conectada (debe dar 354)
curl "$BASE/api/products?limit=1" | head -c 200

# 3. Sidecar alcanzable (lo más importante)
curl $BASE/api/ai/embeddings/status

# 4. Si el punto 3 falla, prueba el sidecar directo
curl https://TU-SPACE.hf.space/health
```

**La prueba definitiva** es la búsqueda visual: si devuelve resultados, los
tres servicios se están hablando entre sí.

---

## ⚠️ Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| `relation "vector" does not exist` | Falta la extensión en Supabase | `CREATE EXTENSION vector;` |
| `ECONNREFUSED` en embeddings | `EMBED_SERVICE_URL` mal o Space dormido | Abre el Space en el navegador para despertarlo |
| El sidecar no responde nunca | Sigue escuchando en `127.0.0.1` | Verifica el punto 5 de esta guía |
| `torchvision::nms does not exist` | Rueda de CUDA en lugar de CPU | Reinstala con `--index-url https://download.pytorch.org/whl/cpu` |
| Render tarda 60 s en responder | Plan free: duerme a los 15 min | Es normal; despiértalo antes de una demo |
| Supabase pausa el proyecto | 1 semana sin actividad | Entra al panel y reactívalo |
| Build de Render agota memoria | Los 482 MB del repo | Mueve `public/models` a un CDN |

---

## 💰 Coste

| Servicio | Plan | Límite |
|---|---|---|
| Supabase | Free | 500 MB de base (usas 123 MB) |
| Render | Free | 512 MB RAM, duerme a los 15 min |
| Hugging Face Spaces | Free | 16 GB RAM CPU, se duerme por inactividad |

**Total: 0 €.** A cambio de que los servicios duerman, así que para una
demostración en vivo despiértalos unos minutos antes.

---

## 📌 Alternativa: todo en una máquina (Oracle Cloud Always Free)

Si prefieres no repartir servicios: **4 núcleos ARM + 24 GB RAM + 200 GB**,
gratis y sin caducidad. Corre PostgreSQL, Node y Python tal cual están.

**Ventaja:** cero cambios de código. **Inconveniente:** es ARM, así que PyTorch
necesita ruedas `aarch64`, y el registro pide tarjeta para verificar (no cobra).
