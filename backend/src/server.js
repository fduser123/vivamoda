import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { pool, waitForDb, ensureSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { attachUser } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import cartRoutes from './routes/cart.js';
import orderRoutes from './routes/orders.js';
import posRoutes from './routes/pos.js';
import adminRoutes from './routes/admin.js';
import aiRoutes from './routes/ai.js';
import vrRoutes from './routes/vr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
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
app.use('/api/ai', aiRoutes);
app.use('/api/vr', vrRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint no encontrado' }));

// -------------------------------------------------------------
// Estáticos (JS de los frontends conectados)
// -------------------------------------------------------------
app.use(express.static(PUBLIC));

// -------------------------------------------------------------
// Frontends (los mockups HTML servidos en rutas amigables)
// -------------------------------------------------------------
// script de wiring que se inyecta en cada página (además de /js/common.js)
const PAGE_SCRIPTS = {
  'tienda_cat_logo_completo/code.html': 'catalogo.js',
  'detalle_de_producto_asistente_ia/code.html': 'detalle.js',
  'hub_agente_ia_automatizaci_n/code.html': 'hub.js',
  'portal_de_autenticaci_n_registro/code.html': 'login.js',
  'consola_empleado_pedidos_pos/code.html': 'pos.js',
  'panel_admin_gesti_n_de_almac_n/code.html': 'admin.js',
};

const PAGES = {
  '/catalogo-de-productos': 'tienda_cat_logo_completo/code.html',
  '/catalogo-caballeros': 'tienda_cat_logo_completo/code.html',
  '/catalogo-ninos': 'tienda_cat_logo_completo/code.html',
  '/novedades': 'tienda_cat_logo_completo/code.html',
  '/ofertas-flash': 'tienda_cat_logo_completo/code.html',
  '/detalle-de-producto': 'detalle_de_producto_asistente_ia/code.html',
  '/hub-agente-ia': 'hub_agente_ia_automatizaci_n/code.html',
  '/tienda-virtual-realidad': 'tienda_virtual_realidad/code.html',
  '/iniciar-sesion': 'portal_de_autenticaci_n_registro/code.html',
  '/registro': 'portal_de_autenticaci_n_registro/code.html',
  '/pedidos-y-pos': 'consola_empleado_pedidos_pos/code.html',
  '/panel-de-almacen-y-ventas': 'panel_admin_gesti_n_de_almac_n/code.html',
};

const PLACEHOLDER = (name, path) => `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>VivaModa · ${name}</title>
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-[#fcf8fb] text-[#1c1b1d] min-h-screen flex items-center justify-center p-6" style="font-family: 'Plus Jakarta Sans', sans-serif;">
<main class="max-w-lg w-full bg-white rounded-2xl shadow-lg p-8 text-center">
<span style="font-size:40px">🛍️</span>
<h1 class="text-2xl font-extrabold mt-3">${name}</h1>
<p class="text-gray-500 mt-2">Este módulo del ecosistema VivaModa está disponible próximamente. Mientras tanto, explora los módulos activos:</p>
<ul class="mt-5 space-y-2 text-left">
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/catalogo-de-productos"><span>🛍️ Tienda &amp; Catálogo</span><span>→</span></a></li>
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/detalle-de-producto"><span>👗 Detalle de producto + Estilista IA</span><span>→</span></a></li>
<li><a class="flex justify-between items-center bg-[#f6f2f5] rounded-xl px-4 py-3 hover:bg-[#eae7ea]" href="/hub-agente-ia"><span>🤖 Hub Agentes IA</span><span>→</span></a></li>
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

  app.listen(config.port, () => {
    console.log('────────────────────────────────────────────────────────');
    console.log('  VivaModa API  ·  listo');
    console.log(`  API REST     → http://localhost:${config.port}/api/health`);
    console.log(`  Tienda       → http://localhost:${config.port}/catalogo-de-productos`);
    console.log(`  Detalle      → http://localhost:${config.port}/detalle-de-producto`);
    console.log(`  Hub IA       → http://localhost:${config.port}/hub-agente-ia`);
    console.log(`  Tienda VR    → http://localhost:${config.port}/tienda-virtual-realidad`);
    console.log(`  POS          → http://localhost:${config.port}/pedidos-y-pos`);
    console.log(`  Admin        → http://localhost:${config.port}/panel-de-almacen-y-ventas`);
    console.log(`  Login        → http://localhost:${config.port}/iniciar-sesion`);
    console.log('────────────────────────────────────────────────────────');
  });
}

main();
