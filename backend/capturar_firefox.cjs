// Captura el hub IA (chatbot + estilista visual) con Firefox headless
// Uso: firefox-esr --headless --screenshot ...
// Firefox headless solo captura viewport tras load; para el chat enviamos el
// mensaje por URL param no posible → preparamos página con ?demo=chat que
// autoenvía un mensaje. Verificamos si common.js soporta param; si no,
// capturamos el hub tal cual (chat demo visible del mockup).
const { execSync } = require('child_process');
const http = require('http');

const BASE = 'http://localhost:3000';
const OUT = __dirname + '/evidencias';
require('fs').mkdirSync(OUT, { recursive: true });

function capture(url, out, delayMs = 6000, width = 1400, height = 900) {
  const cmd = `firefox --headless --screenshot "${out}" --window-size=${width},${height} --timeout=${delayMs * 2} "${url}"`;
  try {
    execSync(cmd, { stdio: 'pipe', timeout: delayMs * 3 });
    console.log('OK', out);
  } catch (e) {
    console.log('FALLO', out, String(e.stderr || e.message).slice(0, 200));
  }
}

(async () => {
  // health check
  await new Promise((res) => http.get(`${BASE}/api/health`, res).on('error', res));

  // 1) Hub IA completo (chatbot Aria + estilista visual visibles)
  capture(`${BASE}/hub-agente-ia`, `${OUT}/ia1-hub-chatbot.png`, 8000);
})();
