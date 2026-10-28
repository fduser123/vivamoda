import express from 'express';
import cors from 'cors';
import https from 'node:https';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool, waitForDb, ensureSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { attachUser } from './middleware/auth.js';
import { aiRateLimit, aiBudgetGuard } from './middleware/ai-guard.js';

import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import posRoutes from './routes/pos.js';
import adminRoutes from './routes/admin.js';
import aiRoutes from './routes/ai.js';
import styleRagRoutes from './routes/style-rag.js';
import demandRoutes from './routes/demand.js';
import adminIaRoutes from './routes/admin-ia.js';
import vrRoutes from './routes/vr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
// Sin esto, detrás de Caddy (o del proxy de Render) `req.ip` es la IP del
// proxy: el rate limit por cliente de /api/ai aplicaría a todo el mundo como
// si fuera un único cliente. Se configura con TRUST_PROXY.
app.set('trust proxy', config.trustProxy);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(attachUser);

// -------------------------------------------------------------
// API REST
// -------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'vivamoda-api', time: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/pos', posRoutes);
app.use('/api/admin', adminRoutes);
// Guardas transversales de la IA: se aplican a TODAS las rutas montadas bajo
// /api/ai (incluido style-rag) antes de llegar a sus handlers.
app.use('/api/ai', aiRateLimit);
app.use('/api/ai', aiBudgetGuard);
app.use('/api/ai', aiRoutes);
// Fase 1: asesor RAG (/style-chat) y búsqueda visual (/visual-search). Se
// monta sobre el mismo prefijo porque las rutas no se solapan.
app.use('/api/ai', styleRagRoutes);
// Fase 4: datos para el panel de demanda e inventario
app.use('/api/demand', demandRoutes);
// Fase 5: administración de la IA (métricas, configuración y conocimiento)
app.use('/api/admin/ia', adminIaRoutes);
app.use('/api/vr', vrRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint no encontrado' }));

// -------------------------------------------------------------
// Estáticos (JS de los frontends conectados)
// -------------------------------------------------------------
// Los modelos 3D necesitan su MIME exacto: sin `model/vnd.usdz+zip` Safari
// descarga el archivo en vez de abrir Quick Look, y sin `model/gltf-binary`
// Scene Viewer lo rechaza. Se cachean una semana porque son inmutables
// (cada regeneración cambia el SKU o la fecha de build).
const MODEL_MIME = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.usdz': 'model/vnd.usdz+zip',
  '.usda': 'model/vnd.usda',
  '.usdc': 'model/vnd.usdc',
};
app.use(express.static(PUBLIC, {
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MODEL_MIME[ext];
    if (!mime) return;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    // Quick Look y Scene Viewer descargan el modelo desde otro origen.
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
}));

// -------------------------------------------------------------
// Frontends (los mockups HTML servidos en rutas amigables)
// -------------------------------------------------------------
// script de wiring que se inyecta en cada página (además de /js/common.js)
const PAGE_SCRIPTS = {
  'frontends/tienda-catalogo/code.html': 'catalogo.js',
  'frontends/detalle-producto-ia/code.html': 'detalle.js',
  'frontends/hub-agentes-ia/code.html': 'hub.js',
  'frontends/portal-acceso/code.html': 'login.js',
  'frontends/pos-pedidos/code.html': 'pos.js',
  'frontends/panel-almacen/code.html': 'admin.js',
  'frontends/ver-en-tu-espacio/code.html': 'espacio.js',
  'frontends/simulador-tienda/code.html': 'simulador.js',
  'frontends/guia-producto/code.html': 'guia.js',
  'frontends/asesor-de-prendas/code.html': 'asesor.js',
  'frontends/asesor-estilo/code.html': 'asesor-estilo.js',
};

const PAGES = {
  '/catalogo-de-productos': 'frontends/tienda-catalogo/code.html',
  '/catalogo-caballeros': 'frontends/tienda-catalogo/code.html',
  '/catalogo-ninos': 'frontends/tienda-catalogo/code.html',
  '/novedades': 'frontends/tienda-catalogo/code.html',
  '/ofertas-flash': 'frontends/tienda-catalogo/code.html',
  '/detalle-de-producto': 'frontends/detalle-producto-ia/code.html',
  '/hub-agente-ia': 'frontends/hub-agentes-ia/code.html',
  '/tienda-virtual-realidad': 'frontends/tienda-vr/code.html',
  '/iniciar-sesion': 'frontends/portal-acceso/code.html',
  '/registro': 'frontends/portal-acceso/code.html',
  '/pedidos-y-pos': 'frontends/pos-pedidos/code.html',
  '/panel-de-almacen-y-ventas': 'frontends/panel-almacen/code.html',
  '/ver-en-tu-espacio': 'frontends/ver-en-tu-espacio/code.html',
  '/simulador-tienda': 'frontends/simulador-tienda/code.html',
  '/guia-de-producto': 'frontends/guia-producto/code.html',
  '/asesor-de-prendas': 'frontends/asesor-de-prendas/code.html',
  '/asesor-estilo': 'frontends/asesor-estilo/code.html',
};

// Tema claro/oscuro: se aplica antes del primer pintado para que no haya
// destello blanco al abrir una página guardada en oscuro. common.js se
// encarga después del toggle y de mantener la preferencia sincronizada.
const THEME_BOOT = '<script>(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t!=="light"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();</script>';

// Base global (tema + tokens) al principio del <head>, para que los estilos
// propios de cada vista puedan sobrescribirla. La capa de responsividad va al
// final, porque está pensada para corregir los layouts existentes.
const BASE_HEAD = THEME_BOOT + '<link rel="stylesheet" href="/css/common.css"/>';
const GLOBAL_TAIL = '<script src="/js/device.js"></script><link rel="stylesheet" href="/css/responsive.css"/>';

const PLACEHOLDER = (name, path) => `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>VivaModa · ${name}</title>
<script src="https://cdn.tailwindcss.com"></script>${THEME_BOOT}<script src="/js/device.js"></script><link rel="stylesheet" href="/css/common.css"/><link rel="stylesheet" href="/css/responsive.css"/></head>
<body class="bg-[#fcf8fb] text-[#1c1b1d] min-h-screen flex items-center justify-center p-6" style="font-family: 'Plus Jakarta Sans', sans-serif;">
<main class="max-w-lg w-full bg-white rounded-2xl shadow-lg p-8 text-center">
<span style="font-size:40px">🛍️</span>
<h1 class="text-2xl font-extrabold mt-3">${name}</h1>
<p class="text-gray-500 mt-2">Este módulo del ecosistema VivaModa está disponible próximamente. Mientras tanto, explora los módulos activos:</p>
<ul class="mt-5 space-y-2 text-left">
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/catalogo-de-productos"><span>🛍️ Tienda &amp; Catálogo</span><span>→</span></a></li>
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/detalle-de-producto"><span>👗 Detalle de producto + Estilista IA</span><span>→</span></a></li>
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/hub-agente-ia"><span>🤖 Hub Agentes IA</span><span>→</span></a></li>
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/asesor-de-prendas"><span>🧍‍♀️ Asesora 3D de prendas</span><span>→</span></a></li>
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/pedidos-y-pos"><span>🧾 Consola POS &amp; Pedidos</span><span>→</span></a></li>
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/panel-de-almacen-y-ventas"><span>📦 Panel Almacén &amp; Ventas</span><span>→</span></a></li>
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/iniciar-sesion"><span>🔐 Portal de Acceso</span><span>→</span></a></li>
</ul>
</main></body></html>`;

const HOME_LANDING = PLACEHOLDER('Ecosistema VivaModa', '/');

function sendPage(req, res, file) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) return res.status(404).type('html').send(PLACEHOLDER('Página no encontrada', req.path));
  let html = fs.readFileSync(abs, 'utf8');
  // Tema y tokens al inicio del <head>; device.js + responsive.css al final.
  // Así no hay destello de tema/layout y las vistas conservan la última
  // palabra sobre su propio diseño.
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, `<head$1>${BASE_HEAD}`);
    if (html.includes('</head>')) html = html.replace('</head>', GLOBAL_TAIL + '</head>');
    else html += GLOBAL_TAIL;
  } else if (html.includes('<body')) {
    html = html.replace('<body', BASE_HEAD + GLOBAL_TAIL + '<body');
  } else {
    html += BASE_HEAD + GLOBAL_TAIL;
  }
  const script = PAGE_SCRIPTS[file];
  if (script) {
    const tags =
      '<script src="/js/common.js"></script>\n' +
      `<script src="/js/pages/${script}"></script>\n`;
    if (html.includes('</body>')) html = html.replace('</body>', tags + '</body>');
    else html += tags;
  }
  res.type('html').send(html);
}

for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (req, res) => sendPage(req, res, file));
}

app.get('/', (_req, res) => res.redirect('/catalogo-de-productos'));

// Páginas del mockup no diseñadas aún → landing amable
const PLACEHOLDER_PAGES = [
  '/lista-de-deseos', '/carrito-de-compras', '/perfil-de-usuario', '/seguimiento-de-pedidos',
  '/guia-de-tallas', '/politica-de-devoluciones', '/sucursales-y-tiendas', '/checkout', '/tienda', '/carrito',
];
for (const route of PLACEHOLDER_PAGES) {
  app.get(route, (req, res) => res.type('html').send(PLACEHOLDER('Módulo en construcción', req.path)));
}

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint no encontrado' });
  if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).type('text').send('No encontrado');
  res.status(404).type('html').send(PLACEHOLDER('Página no encontrada', req.path));
});

// Errores del parser de cuerpo (F0-10): sin esto, un JSON de más de 1 MB o
// malformado devolvía una página HTML de Express en vez de un JSON que el
// frontend pueda leer. Mantiene el mismo contrato { error, code }.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      ok: false,
      error: 'El cuerpo de la petición es demasiado grande.',
      code: 'PAYLOAD_TOO_LARGE',
      limit: err.limit || null,
    });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ ok: false, error: 'JSON inválido.', code: 'INVALID_JSON' });
  }
  return next(err);
});

// -------------------------------------------------------------
// Arranque
// -------------------------------------------------------------
async function main() {
  try {
    await waitForDb();
    await ensureSchema();
    await seedIfEmpty();
  } catch (err) {
    console.error('[boot] no se pudo conectar a PostgreSQL. ¿Ya levantaste la base?');
    console.error('       cd backend && npm run db:up');
    console.error('       detalles:', err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }

  // HTTPS opcional: WebXR y la cámara exigen contexto seguro. En localhost no
  // hace falta; para abrir la tienda desde el móvil por la red, sí.
  const usoHttps = Boolean(config.httpsCert && config.httpsKey);
  const servidor = usoHttps
    ? https.createServer(
      { cert: fs.readFileSync(config.httpsCert), key: fs.readFileSync(config.httpsKey) },
      app,
    )
    : app;
  const esquema = usoHttps ? 'https' : 'http';

  servidor.listen(config.port, () => {
    console.log('────────────────────────────────────────────────────────');
    console.log('  VivaModa API  ·  listo');
    console.log(`  Protocolo    → ${esquema}${usoHttps ? ' (certificado propio: RA disponible en el móvil)' : ''}`);
    console.log(`  API REST     → ${esquema}://localhost:${config.port}/api/health`);
    console.log(`  Tienda       → ${esquema}://localhost:${config.port}/catalogo-de-productos`);
    console.log(`  Detalle      → ${esquema}://localhost:${config.port}/detalle-de-producto`);
    console.log(`  Hub IA       → ${esquema}://localhost:${config.port}/hub-agente-ia`);
    console.log(`  Tienda VR    → ${esquema}://localhost:${config.port}/tienda-virtual-realidad`);
    console.log(`  RA (AR)      → ${esquema}://localhost:${config.port}/api/vr/ar/VM-DAM-001`);
    console.log(`  Asesora 3D   → ${esquema}://localhost:${config.port}/asesor-de-prendas`);
    console.log(`  POS          → ${esquema}://localhost:${config.port}/pedidos-y-pos`);
    console.log(`  Admin        → ${esquema}://localhost:${config.port}/panel-de-almacen-y-ventas`);
    console.log(`  Login        → ${esquema}://localhost:${config.port}/iniciar-sesion`);
    console.log('────────────────────────────────────────────────────────');
  });
}

main();
