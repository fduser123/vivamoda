// =====================================================================
// Verificación visual del indicador de modelo en los 3 chats con IA.
// Automatiza Chrome (DevTools Protocol) sobre las páginas servidas.
// =====================================================================
const DEBUG_HOST = 'http://localhost:9222';

const tabs = await (await fetch(DEBUG_HOST + '/json')).json();
const hubTab = tabs.find((t) => t.type === 'page' && t.url.includes('/hub-agente-ia'));
if (!hubTab) { console.error('❌ No se encontró pestaña del Hub'); process.exit(1); }

const ws = new WebSocket(hubTab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS no disponible')); });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const data = JSON.parse(ev.data);
  if (data.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(data.params.type)) {
    const txt = data.params.args.map((a) => a.value || a.description || a.type).join(' ').slice(0, 200);
    if (!/tailwindcss/i.test(txt)) consoleErrors.push(txt);
  }
  if (data.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXCEPCIÓN: ' + (data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text).slice(0, 300));
  }
  if (data.id && pending.has(data.id)) {
    const { resolve } = pending.get(data.id);
    pending.delete(data.id);
    resolve(data);
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout CDP: ' + method)); } }, 150_000);
  });
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('JS: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Runtime.enable');

// Recargar el Hub para cargar los scripts actualizados
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:3000/hub-agente-ia' });
await sleep(3500);

// 0) Encabezado del playground: estado del motor
const header = await evalJs(
  "(() => { const dot = document.querySelector('#chat-form')?.closest('.rounded-2xl')?.querySelector('.bg-emerald-500'); const label = dot?.closest('span.font-label-sm') || dot?.parentElement; return label ? label.textContent.replace(/\\s+/g,' ').trim() : 'NO ENCONTRADO'; })()",
);
console.log('1️⃣  Encabezado del playground →', header);

// 1) Enviar una pregunta y verificar el chip dentro de la burbuja
console.log('');
console.log('2️⃣  Enviando pregunta al chat del Hub…');
const before = await evalJs("document.querySelectorAll('#chat-messages > div').length");
await evalJs("(() => { const i = document.getElementById('chat-input'); i.value = 'Busco un look sofisticado para una cena de gala'; document.getElementById('chat-form').requestSubmit(); return true; })()");
let lastTxt = '';
for (let i = 0; i < 60; i++) {
  await sleep(2000);
  const st = JSON.parse(await evalJs(
    "(() => { const rows = document.querySelectorAll('#chat-messages > div'); const last = rows[rows.length-1]; if (!last) return '{}'; const txt = last.textContent||''; return JSON.stringify({done: rows.length > " + before + " && !/Analizando/.test(txt), txt: txt.slice(0,400), chip: !!last.querySelector('.vm-model-chip'), chipTxt: (last.querySelector('.vm-model-chip')||{}).textContent||''}); })()",
  ));
  if (st.done) {
    console.log('   Respuesta:', st.txt.replace(/\s+/g, ' ').trim().slice(0, 160));
    console.log('   Chip en burbuja:', st.chip ? '✅ ' + st.chipTxt.trim() : '❌ ausente');
    lastTxt = st.chipTxt;
    break;
  }
}

// 2) Title del chip (tooltip con detalles)
const tooltip = await evalJs("(document.querySelector('#chat-messages .vm-model-chip')||{}).title || 'sin tooltip'");
console.log('   Tooltip:', String(tooltip).slice(0, 140));

// 3) Verificar que /detalle-de-producto también renderiza el chip
console.log('');
console.log('3️⃣  Navegando a detalle de producto…');
await send('Page.navigate', { url: 'http://localhost:3000/detalle-de-producto?sku=VM-DAM-ATELIER' });
await sleep(3500);
const detailReady = await evalJs("!!document.querySelector('#chat-input') || !!window.handleSend || !!document.getElementById('ai-chat-input')");
console.log('   Página de detalle lista:', detailReady);
const detailInput = await evalJs(
  "(() => { const el = document.querySelector('#chat-input') || document.querySelector('input[placeholder*=\"ria\"]') || document.querySelector('input[placeholder*=\"preg\"]') || document.querySelector('input[placeholder*=\"Preg\"]'); return el ? el.id || 'input-generico' : null; })()",
);
console.log('   Input del chat de detalle:', detailInput || 'no encontrado');

if (detailInput) {
  const idSel = detailInput === 'input-generico' ? 'input[placeholder*="ria"]' : '#' + detailInput;
  const beforeD = await evalJs("document.querySelectorAll('.flex.gap-space-xs.items-start, #ai-chat-box > div, #chat-box > div').length");
  await evalJs(
    "(() => { const el = " + (detailInput === 'input-generico' ? "document.querySelector('input[placeholder*=\"ria\"]')" : "document.getElementById('" + detailInput + "')") + "; el.value = '¿Qué accesorios uso con este vestido?'; const f = el.closest('form'); if (f) f.requestSubmit(); else { const b = el.parentElement.querySelector('button'); if (b) b.click(); } return true; })()",
  );
  let chipD = null;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const has = await evalJs("document.querySelectorAll('.vm-model-chip').length");
    if (has > 0) { chipD = has; break; }
  }
  console.log('   Chips .vm-model-chip en detalle:', chipD ?? '❌ ninguno tras 120 s');
}

// 4) Captura final del Hub con chip visible
console.log('');
console.log('4️⃣  Volviendo al Hub para captura final…');
await send('Page.navigate', { url: 'http://localhost:3000/hub-agente-ia' });
await sleep(3000);
await evalJs("document.getElementById('chat-messages')?.scrollIntoView({ block: 'center' }); true");
await sleep(500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync('hub_modelo_indicador.png', Buffer.from(shot.result.data, 'base64'));
  console.log('📸 Captura: backend/hub_modelo_indicador.png');
}

console.log('');
console.log('Errores de consola (sin Tailwind CDN):', consoleErrors.length ? consoleErrors : 'ninguno ✅');
ws.close();
process.exit(0);
