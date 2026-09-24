/* Hub de agentes IA en vivo: playground + métricas */
(function () {
  const { api, fmtUSD, esc, toast, modelChipHtml, modelShortName } = window.VM;
  const TONES = ['Profesional', 'Chic / Vibrante', 'Casual & Cercano', 'Conciso / Directo'];
  let stats = null;

  const $ = (id) => document.getElementById(id);
  const messagesEl = $('chat-messages');

  function leaf(marker, exact = false) {
    return [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && (exact ? el.textContent.trim() === marker : el.textContent.includes(marker)));
  }
  function patchText(root, re, txt) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const ns = [];
    while (walker.nextNode()) ns.push(walker.currentNode);
    ns.forEach((n) => { if (re.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(re, txt); });
  }

  function bubble(role, html) {
    const row = document.createElement('div');
    row.className = 'flex items-start gap-space-xs ' + (role === 'user' ? 'justify-end' : '');
    if (role === 'user') {
      row.innerHTML = `<div class="p-space-sm rounded-2xl rounded-tr-none bg-primary text-on-primary font-body-sm text-body-sm" style="max-width:85%">${html}</div>`;
    } else {
      row.innerHTML = `
        <div class="w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center flex-shrink-0 text-sm font-bold">A</div>
        <div class="flex flex-col gap-1 p-space-sm bg-surface-container-low rounded-2xl rounded-tl-none font-body-sm text-body-sm text-on-surface" style="max-width:85%">${html}</div>`;
    }
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function chipLink(p) {
    return `<a href="/detalle-de-producto?sku=${encodeURIComponent(p.sku)}" style="display:inline-block;margin:2px 4px 0 0;padding:5px 10px;border-radius:10px;background:#fff;border:1px solid #e5c0c9;color:#8f0041;font-weight:600;font-size:12px;text-decoration:none">${esc(p.name)} · ${fmtUSD(p.price)}</a>`;
  }

  async function handleSend(e) {
    if (e) e.preventDefault();
    const input = $('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    bubble('user', esc(msg));
    const wait = bubble('assistant', 'Analizando…');
    const started = Date.now();
    try {
      const res = await api('/ai/chat', { auth: false, method: 'POST', body: { message: msg } });
      const ms = (Date.now() - started) / 1000;
      messagesEl.removeChild(messagesEl.lastChild); // quita el "Analizando…"
      const suggestions = res.suggestions?.length ? '<div style="margin-top:6px">' + res.suggestions.map(chipLink).join('') + '</div>' : '';
      bubble('assistant', `<p style="margin:0;white-space:pre-wrap">${esc(res.reply).replace(/\*\*/g, '')}</p>${suggestions}<span class="font-label-sm text-label-sm text-on-surface-variant" style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:6px"><span class="vm-bubble-meta">${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} • ${ms.toFixed(2)}s</span>${modelChipHtml(res)}</span>`);
    } catch (err) {
      messagesEl.removeChild(messagesEl.lastChild);
      bubble('assistant', `<p style="margin:0">Ups, no pude responder: ${esc(err.message)}</p>`);
    }
    void wait;
  }

  function resetChat() {
    if (messagesEl) {
      const keep = [];
      messagesEl.childNodes.forEach((n) => {
        if (n.textContent.includes('¡Hola! Soy Aria')) keep.push(n);
      });
      messagesEl.innerHTML = '';
      keep.slice(0, 1).forEach((n) => messagesEl.appendChild(n));
    }
    toast('Conversación reiniciada', 'restart_alt');
  }

  function setTone(v) {
    const idx = Math.max(1, Math.min(4, Number(v) || 2)) - 1;
    const slider = $('tone-slider');
    if (slider) slider.value = idx + 1;
    const ind = $('tone-indicator');
    if (ind) ind.textContent = TONES[idx];
    // resalta etiqueta activa
    const labels = [...document.querySelectorAll('span')].filter((s) => s.children.length === 0 && TONES.includes(s.textContent.trim()));
    labels.forEach((l) => {
      const active = l.textContent.trim() === TONES[idx];
      l.classList.toggle('font-bold', active);
      l.classList.toggle('text-primary', active);
    });
  }

  async function loadMetrics() {
    try {
      stats = await api('/ai/stats');
      // CSAT 4.8 / 5.0
      const csatLeaf = leaf('4.8', true);
      if (csatLeaf) csatLeaf.textContent = String(stats.csat).replace('.', ',');
      const basis = leaf('Basado en');
      if (basis) patchText(basis, /\d[\d.,]*/, stats.csatBasis.toLocaleString('es-CO'));
      // Tiempo de respuesta 0.8s
      const rt = leaf('0.8s', true) || leaf('0.8 s', true);
      if (rt) rt.textContent = (stats.avgLatencyMs / 1000).toFixed(1).replace('.', ',') + 's';
      const inf = leaf('0.82 seg', true);
      if (inf) inf.textContent = (stats.avgLatencyMs / 1000).toFixed(2).replace('.', ',') + ' seg';
      // Conversión asistida
      const conv = leaf('+24.8%', true);
      if (conv) conv.textContent = `+${String(stats.assistedSales.pct).replace('.', ',')}%`;
      // Resolución
      patchText(document.body, /89\.4%/, `${String(stats.resolutionRate).replace('.', ',')}%`);
      // Temas
      const topics = stats.topics || [];
      const vals = ['42%', '34%', '24%'];
      if (topics.length) {
        vals.forEach((v, i) => {
          const t = topics[i];
          if (!t) return;
          [...document.querySelectorAll('*')].forEach((el) => {
            if (el.children.length === 0 && el.textContent.trim() === v) el.textContent = `${t.pct}%`;
          });
          // anchos de barra si existen dentro de la misma sección
          const sec = [...document.querySelectorAll('section, div')].find((s) => s.textContent.includes(t.label) && s.querySelector('[style*="width"]'));
          if (sec) {
            const bar = sec.querySelector('div[style*="width"]');
            if (bar) bar.style.width = `${t.pct}%`;
          }
        });
      }
    } catch { /* métricas no disponibles */ }
  }

  function wire() {
    const form = $('chat-form');
    if (form) form.addEventListener('submit', handleSend);
    const input = $('chat-input');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSend(e); });
    // botón reset (restart_alt) → resetChat se define global y el onclick ya está en el markup
    window.resetChat = resetChat;
    window.handleSend = handleSend;
    window.setTone = setTone;
    const slider = $('tone-slider');
    if (slider) slider.addEventListener('input', () => setTone(slider.value));
    const deploy = $('deploy-agent-btn');
    if (deploy) deploy.addEventListener('click', () => {
      const txt = deploy.querySelector('span:last-child');
      if (txt) txt.textContent = 'Re-indexando…';
      setTimeout(() => {
        toast('Embeddings re-indexados (demo)', 'sync');
        if (txt) txt.textContent = 'Re-indexar';
      }, 1400);
    });
    // Tarjeta demo del chat (mockup): precio legacy en COP → USD (tasa demo 3900)
    [...document.querySelectorAll('*')].forEach((el) => {
      if (el.children.length === 0 && el.textContent.trim() === '$59.900') el.textContent = '$15.49';
    });
    setTone(2);
    loadMetrics();
    refreshEngineStatus();
  }

  /** Encabezado del playground: muestra el motor activo (OpenRouter vs local) */
  async function refreshEngineStatus() {
    const dot = document.querySelector('#chat-form')?.closest('.rounded-2xl')?.querySelector('.bg-emerald-500');
    const label = dot?.closest('span.font-label-sm') || dot?.parentElement;
    if (!label) return;
    try {
      const s = await api('/ai/stats');
      const eng = s.engine || {};
      const isLlm = Boolean(eng.llm);
      label.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${isLlm ? 'bg-emerald-500' : 'bg-amber-500'}"></span> Motor: ${esc(eng.label || (isLlm ? 'OpenRouter' : 'Local'))}`;
      label.title = isLlm
        ? `LLM activo: ${eng.model} vía OpenRouter`
        : 'LLM no disponible: ' + (eng.reason || 'sin API key') + ' · respondiendo con reglas locales';
    } catch { /* sin conexión: deja el estado por defecto */ }
  }

  document.addEventListener('DOMContentLoaded', wire);
  if (document.readyState !== 'loading') wire();
})();
