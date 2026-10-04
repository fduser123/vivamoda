// Captura evidencias reales de las 3 IAs de VivaModa para el documento del examen
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'evidencias');
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:3000';
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name), fullPage: false });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1.5 });

// ---------- LOGIN ADMIN ----------
await page.goto(`${BASE}/iniciar-sesion`, { waitUntil: 'networkidle2' });
await page.waitForSelector('button');
// Seleccionar perfil Administración (tercer botón de perfil)
const adminBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /Administración/i.test(b.textContent)));
if (adminBtn && adminBtn.asElement()) await adminBtn.asElement().click();
await page.waitForSelector('input[type="text"], input:not([type="password"]):not([type="checkbox"])');
const inputs = await page.$$('input[type="text"], input[type="email"], input:not([type="password"]):not([type="checkbox"]):not([type="file"])');
await inputs[0].type('admin@vivamoda.internal');
await page.type('input[type="password"]', 'Admin123!');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
  [...await page.$$('button')].find(async () => false), // noop
]);
// clic en "Ingresar al Portal"
const submit = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /Ingresar al Portal/i.test(b.textContent)));
if (submit && submit.asElement()) await submit.asElement().click();
await new Promise(r => setTimeout(r, 3500));
console.log('URL tras login:', page.url());

// ---------- EVIDENCIA 3 · IA ADMINISTRATIVA ----------
await page.goto(`${BASE}/panel-de-almacen-y-ventas`, { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2500));
// clic en tab "Tendencias & Compras"
await page.evaluate(() => { document.querySelector('.vm-ai-tab[data-tab="strategy"]')?.click(); });
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => document.querySelector('#vm-ai-section')?.scrollIntoView({ block: 'start' }));
await new Promise(r => setTimeout(r, 800));
await shot(page, 'ia3-panel-tendencias.png');
console.log('✔ captura IA administrativa (Tendencias & Compras)');

// pestaña forecast
await page.evaluate(() => { document.querySelector('.vm-ai-tab[data-tab="forecast"]')?.click(); });
await new Promise(r => setTimeout(r, 2500));
await page.evaluate(() => document.querySelector('#vm-ai-section')?.scrollIntoView({ block: 'start' }));
await new Promise(r => setTimeout(r, 800));
await shot(page, 'ia3-panel-forecast.png');
console.log('✔ captura IA administrativa (Predicción de demanda)');

// ---------- EVIDENCIA 1+2 · CLIENTE: CHATBOT Y ESTILISTA ----------
// logout: limpiar token yendo a iniciar-sesion de nuevo
await page.evaluate(() => { localStorage.removeItem('vm_token'); localStorage.removeItem('vm_user'); });
await page.goto(`${BASE}/iniciar-sesion`, { waitUntil: 'networkidle2' });
const cliBtn = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /Cliente/i.test(b.textContent) && !/Empl/i.test(b.textContent)));
if (cliBtn && cliBtn.asElement()) await cliBtn.asElement().click();
const inputs2 = await page.$$('input[type="text"], input[type="email"], input:not([type="password"]):not([type="checkbox"]):not([type="file"])');
await inputs2[0].type('elena.rossi@vivamoda.com');
await page.type('input[type="password"]', 'Cliente123!');
const submit2 = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => /Ingresar al Portal/i.test(b.textContent)));
if (submit2 && submit2.asElement()) await submit2.asElement().click();
await new Promise(r => setTimeout(r, 3500));
console.log('URL tras login cliente:', page.url());

await page.goto(`${BASE}/hub-agente-ia`, { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2000));

// Chatbot: enviar mensaje real
await page.type('#chat-input', 'Busco un outfit para un cóctel de noche, algo elegante');
await page.keyboard.press('Enter');
await new Promise(r => setTimeout(r, 4000));
await page.evaluate(() => document.querySelector('#chat-form')?.closest('.rounded-2xl')?.scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 800));
await shot(page, 'ia1-chatbot-aria.png');
console.log('✔ captura chatbot Aria');

// Estilista visual: generar foto sintética de silueta arenera y subirla
const canvasScript = `async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 400;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f0ebe4'; ctx.fillRect(0, 0, 320, 400);
  ctx.fillStyle = '#2c2c34';
  const lerp = (a, b, t) => a + (b - a) * t;
  for (let y = 85; y < 400; y++) {
    let w;
    if (y < 120) w = 150;
    else if (y < 230) w = lerp(150, 90, (y - 120) / 110);
    else if (y < 290) w = lerp(90, 140, (y - 230) / 60);
    else w = lerp(140, 110, (y - 290) / 110);
    ctx.fillRect(160 - w / 2, y, w, 1.5);
  }
  ctx.beginPath(); ctx.arc(160, 52, 26, 0, Math.PI * 2); ctx.fill();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'look-test.jpg', { type: 'image/jpeg' }));
  const input = document.querySelector('#vm-vision-file');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
}`;
await page.evaluate(canvasScript);
await page.waitForFunction(() => document.querySelector('#vm-style-match-btn') && !document.querySelector('#vm-style-match-btn').disabled, { timeout: 20000 });
await page.evaluate(() => document.querySelector('#vm-vision-card')?.scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 600));
await shot(page, 'ia2-analisis-imagen.png');
console.log('✔ captura análisis de imagen');

// look personalizado
await page.click('#vm-style-match-btn');
await page.waitForFunction(() => (document.querySelector('#vm-vision-out')?.textContent || '').includes('match'), { timeout: 20000 });
await page.evaluate(() => document.querySelector('#vm-vision-card')?.scrollIntoView({ block: 'start' }));
await new Promise(r => setTimeout(r, 600));
await shot(page, 'ia2-look-personalizado.png');
console.log('✔ captura look personalizado');

await browser.close();
console.log('EVIDENCIAS LISTAS en', OUT);
