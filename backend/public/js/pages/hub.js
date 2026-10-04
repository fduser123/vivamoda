/* Hub de agentes IA en vivo: playground + métricas */
(function () {
  const { api, fmtUSD, esc, toast, modelChipHtml, modelShortName, aiChat, aiExtrasHtml, aiTypingHtml, aiSessionReset } = window.VM;
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
    return row;
  }

  function chipLink(p) {
    const why = p.reason ? ` title="Sugerida porque ${esc(p.reason)}"` : '';
    const talla = p.sizes?.length ? ` · tallas ${esc(p.sizes.slice(0, 3).join('/'))}` : '';
    return `<a data-vm-sku="${esc(p.sku)}"${why} href="/detalle-de-producto?sku=${encodeURIComponent(p.sku)}" style="display:inline-block;margin:2px 4px 0 0;padding:5px 10px;border-radius:10px;background:#fff;border:1px solid #e5c0c9;color:#8f0041;font-weight:600;font-size:12px;text-decoration:none">${esc(p.name)} · ${fmtUSD(p.price)}${talla}</a>`;
  }

  async function handleSend(e) {
    if (e) e.preventDefault();
    const input = $('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';
    bubble('user', esc(msg));

    // La respuesta se escribe en vivo conforme llega (streaming SSE)
    const row = bubble('assistant', `<span class="vm-stream-text" style="display:block;white-space:pre-wrap">${aiTypingHtml()}</span>`);
    const box = row.lastElementChild;
    const target = row.querySelector('.vm-stream-text');
    const started = Date.now();
    let firstChunkAt = 0;
    try {
      const res = await aiChat({
        message: msg,
        onDelta: (t, total) => {
          if (!firstChunkAt) firstChunkAt = Date.now();
          target.textContent = String(total).replace(/\*\*/g, '');
          messagesEl.scrollTop = messagesEl.scrollHeight;
        },
      });
      const ms = (Date.now() - started) / 1000;
      const first = firstChunkAt ? ((firstChunkAt - started) / 1000).toFixed(2) : null;
      target.textContent = String(res.reply || target.textContent || '').replace(/\*\*/g, '');
      const suggestions = res.suggestions?.length ? '<div style="margin-top:6px">' + res.suggestions.map(chipLink).join('') + '</div>' : '';
      const meta = `<span class="font-label-sm text-label-sm text-on-surface-variant" style="display:flex;justify-content:flex-end;align-items:center;gap:6px;margin-top:6px"><span class="vm-bubble-meta">${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })} • ${ms.toFixed(2)}s${first ? ` (primer token ${first}s)` : ''}</span>${modelChipHtml(res)}</span>`;
      box.insertAdjacentHTML('beforeend', suggestions + aiExtrasHtml(res) + meta);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (err) {
      target.textContent = `Ups, no pude responder: ${err.message}`;
    }
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
    aiSessionReset(); // Aria empieza de cero, pero conserva lo aprendido del cliente
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

  // =============================================================
  // IA #10 ESTILISTA VISUAL + IA #11 RECOMENDADOR PERSONALIZADO
  // =============================================================
  let lastAnalysis = null;
  let lastPhoto = null; // dataURL de la última foto analizada (probador virtual)

  // --- Perfil de silueta (debe coincidir con services/vision-stylist.js) ---
  const VM_SHAPES = [
    { id: 'hourglass', emoji: '⏳', label: 'Arenera' },
    { id: 'pear', emoji: '🍐', label: 'Triángulo (pera)' },
    { id: 'apple', emoji: '🍎', label: 'Óvalo (manzana)' },
    { id: 'rectangle', emoji: '▭', label: 'Rectángulo' },
    { id: 'inverted', emoji: '🔻', label: 'Triángulo invertido' },
  ];
  const VM_SHAPE_KEY = 'vm_body_shape';
  const VM_MEAS_KEY = 'vm_body_measurements';
  const vmMeas = () => { try { return JSON.parse(localStorage.getItem(VM_MEAS_KEY) || 'null'); } catch { return null; } };
  const selectedShapeId = () => {
    const s = localStorage.getItem(VM_SHAPE_KEY);
    return (s === 'auto' || VM_SHAPES.some((x) => x.id === s)) ? s : null;
  };

  function renderShapeChips() {
    const box = document.querySelector('#vm-shape-chips');
    if (!box) return;
    const sel = selectedShapeId();
    const chipCls = (active) => `vm-shape-chip px-2.5 py-1.5 rounded-lg font-label-sm text-label-sm font-bold border transition-colors ${active ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container-high'}`;
    box.innerHTML = `<button class="${chipCls(sel === 'auto')}" data-shape="auto" type="button" title="La IA analiza tu foto y detecta tu silueta">✨ Automático (IA)</button>` +
      VM_SHAPES.map((s) => `<button class="${chipCls(s.id === sel)}" data-shape="${s.id}" type="button">${s.emoji} ${esc(s.label)}</button>`).join('') +
      (sel ? `<button id="vm-shape-clear" class="px-2 py-1.5 rounded-lg font-label-sm text-label-sm font-bold text-on-surface-variant hover:bg-surface-container-high" type="button"><span class="material-symbols-outlined text-sm align-middle">close</span>Quitar</button>` : '');
    box.querySelectorAll('.vm-shape-chip').forEach((b) => b.addEventListener('click', () => {
      localStorage.setItem(VM_SHAPE_KEY, b.dataset.shape);
      localStorage.removeItem(VM_MEAS_KEY); // la elección manual manda sobre medidas viejas
      renderShapeChips();
      toast(b.dataset.shape === 'auto'
        ? 'La IA detectará tu silueta automáticamente en cada foto'
        : 'Silueta guardada: te recomendaremos cortes que la favorecen', 'accessibility_new');
    }));
    box.querySelector('#vm-shape-clear')?.addEventListener('click', () => {
      localStorage.removeItem(VM_SHAPE_KEY);
      renderShapeChips();
    });
  }

  function wireShapePicker(card) {
    renderShapeChips();
    const mBtn = card.querySelector('#vm-shape-measure');
    const mBox = card.querySelector('#vm-shape-measure-box');
    const saved = vmMeas() || {};
    const fill = (id, v) => { const el = card.querySelector(id); if (el && v) el.value = v; };
    mBtn?.addEventListener('click', () => {
      mBox.classList.toggle('hidden');
      fill('#vm-b-height', saved.height); fill('#vm-b-bust', saved.bust); fill('#vm-b-waist', saved.waist); fill('#vm-b-hips', saved.hips);
    });
    card.querySelector('#vm-shape-apply')?.addEventListener('click', () => {
      const g = (id) => Number(card.querySelector(id)?.value) || undefined;
      const m = { height: g('#vm-b-height'), bust: g('#vm-b-bust'), waist: g('#vm-b-waist'), hips: g('#vm-b-hips') };
      if (!m.bust && !m.waist && !m.hips) return toast('Ingresa al menos busto, cintura y caderas (cm)', 'error');
      localStorage.setItem(VM_MEAS_KEY, JSON.stringify(m));
      localStorage.removeItem(VM_SHAPE_KEY); // la IA clasifica por medidas
      renderShapeChips();
      mBox.classList.add('hidden');
      toast('Medidas guardadas: la IA clasificará tu silueta automáticamente', 'straighten');
    });
  }

  function injectVisionCard() {
    if (document.getElementById('vm-vision-card')) return;
    const host = $('chat-form')?.closest('.rounded-2xl')?.parentElement || document.querySelector('main') || document.body;
    const card = document.createElement('section');
    card.id = 'vm-vision-card';
    card.className = 'rounded-2xl p-space-lg bg-surface-container-lowest shadow-sm flex flex-col gap-space-sm';
    card.innerHTML = `
      <div class="flex items-center gap-space-xs">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center" style="background:linear-gradient(135deg,#b60055,#4b41e1)"><span class="material-symbols-outlined text-white text-lg">image_search</span></div>
        <div class="flex flex-col">
          <h3 class="font-headline-sm text-headline-sm font-bold leading-tight">Estilista Visual IA</h3>
          <span class="font-label-sm text-label-sm text-on-surface-variant">Sube tu foto: la IA detecta tu silueta y arma un look que te favorece</span>
        </div>
      </div>
      <div class="flex flex-wrap gap-space-sm items-center">
        <label class="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-bold cursor-pointer flex items-center gap-1 hover:opacity-90">
          <span class="material-symbols-outlined text-base">upload</span>Subir foto
          <input id="vm-vision-file" type="file" accept="image/*" style="display:none"/>
        </label>
        <button id="vm-style-match-btn" class="px-3 py-2 rounded-lg bg-secondary text-on-secondary font-label-md text-label-md font-bold flex items-center gap-1 hover:opacity-90" type="button" disabled><span class="material-symbols-outlined text-base">auto_awesome</span>Ver mi look personalizado</button>
      </div>
      <div id="vm-shape-picker" class="flex flex-col gap-1.5 p-2.5 rounded-xl bg-surface-container">
        <div class="flex items-center gap-1.5 flex-wrap">
          <span class="font-label-md text-label-md font-bold">Tu silueta</span>
          <span class="font-label-sm text-label-sm text-on-surface-variant">automática por IA o elige la tuya</span>
          <button id="vm-shape-measure" class="ml-auto px-2 py-1 rounded-lg bg-surface-container-high font-label-sm text-label-sm font-bold flex items-center gap-1" type="button"><span class="material-symbols-outlined text-sm">straighten</span>Medidas exactas</button>
        </div>
        <div id="vm-shape-chips" class="flex flex-wrap gap-1"></div>
        <div id="vm-shape-measure-box" class="hidden flex flex-wrap gap-2 items-end pt-1">
          <label class="flex flex-col gap-0.5"><span class="font-label-sm text-label-sm text-on-surface-variant">Estatura (cm)</span><input id="vm-b-height" type="number" min="120" max="220" class="w-20 px-2 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant font-body-sm text-body-sm" placeholder="165"/></label>
          <label class="flex flex-col gap-0.5"><span class="font-label-sm text-label-sm text-on-surface-variant">Busto (cm)</span><input id="vm-b-bust" type="number" min="60" max="160" class="w-20 px-2 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant font-body-sm text-body-sm" placeholder="90"/></label>
          <label class="flex flex-col gap-0.5"><span class="font-label-sm text-label-sm text-on-surface-variant">Cintura (cm)</span><input id="vm-b-waist" type="number" min="50" max="150" class="w-20 px-2 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant font-body-sm text-body-sm" placeholder="70"/></label>
          <label class="flex flex-col gap-0.5"><span class="font-label-sm text-label-sm text-on-surface-variant">Caderas (cm)</span><input id="vm-b-hips" type="number" min="60" max="170" class="w-20 px-2 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant font-body-sm text-body-sm" placeholder="96"/></label>
          <button id="vm-shape-apply" class="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm font-bold" type="button">Aplicar</button>
        </div>
      </div>
      <div id="vm-vision-preview" class="hidden"></div>
      <div id="vm-vision-out"></div>`;
    host.insertBefore(card, host.firstChild);

    card.querySelector('#vm-vision-file').addEventListener('change', onFileSelected);
    card.querySelector('#vm-style-match-btn').addEventListener('click', requestStyleMatch);
    wireShapePicker(card);
  }

  /** Extrae paleta dominante reduciendo la imagen a un canvas 24×24. */
  function extractPalette(img) {
    const c = document.createElement('canvas');
    c.width = 24; c.height = 24;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 24, 24);
    const { data } = ctx.getImageData(0, 0, 24, 24);
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`; // cubos de 32 niveles
      const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      e.r += r; e.g += g; e.b += b; e.n++;
      buckets.set(key, e);
    }
    const total = [...buckets.values()].reduce((s, e) => s + e.n, 0);
    return [...buckets.values()]
      .map((e) => ({ r: Math.round(e.r / e.n), g: Math.round(e.g / e.n), b: Math.round(e.b / e.n), pct: (e.n / total) * 100 }))
      .sort((a, b) => b.pct - a.pct).slice(0, 5);
  }

  /**
   * CV local · mide las proporciones hombro/cintura/cadera de la silueta
   * en la foto: segmenta el sujeto contra el fondo del borde y calcula
   * anchos por banda de altura. Devuelve null si no hay figura clara.
   */
  function estimateBodyFromImage(img) {
    const W = 120, H = 160;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const s = Math.max(W / img.width, H / img.height); // cover
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const { data } = ctx.getImageData(0, 0, W, H);
    const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
    const border = [];
    for (let x = 0; x < W; x++) border.push(px(x, 0), px(x, H - 1));
    for (let y = 0; y < H; y++) border.push(px(0, y), px(W - 1, y));
    const avg = border.reduce((a, q) => [a[0] + q[0], a[1] + q[1], a[2] + q[2]], [0, 0, 0]).map((v) => v / border.length);
    const diff = ([r, g, b]) => Math.abs(r - avg[0]) + Math.abs(g - avg[1]) + Math.abs(b - avg[2]);
    const rowWidths = [];
    let subjectPx = 0;
    for (let y = 0; y < H; y++) {
      let first = -1, last = -1, count = 0;
      for (let x = 0; x < W; x++) {
        if (diff(px(x, y)) > 75) { count++; if (first < 0) first = x; last = x; }
      }
      subjectPx += count;
      rowWidths[y] = count > 2 ? (last - first + 1) : 0;
    }
    if (subjectPx < W * H * 0.10) return null; // sin persona/prenda clara
    const band = (a, b, pick) => {
      const vals = [];
      for (let y = Math.floor(H * a); y < Math.floor(H * b); y++) if (rowWidths[y] > 4) vals.push(rowWidths[y]);
      if (vals.length < 3) return 0;
      vals.sort((m, n) => m - n);
      return pick === 'max' ? vals[Math.floor(vals.length * 0.8)] : vals[Math.floor(vals.length * 0.2)];
    };
    const shoulder = band(0.18, 0.40, 'max');
    const waist = band(0.44, 0.62, 'min');
    const hip = band(0.62, 0.80, 'max');
    if (!shoulder || !waist || !hip) return null;
    return { shoulder: Math.round(shoulder * 10) / 10, waist: Math.round(waist * 10) / 10, hip: Math.round(hip * 10) / 10 };
  }

  async function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Selecciona una imagen', 'error');
    const out = $('vm-vision-out');
    const prev = $('vm-vision-preview');
    prev.classList.remove('hidden');
    prev.innerHTML = '<div class="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm p-2"><span class="material-symbols-outlined animate-spin text-base">progress_activity</span>Analizando imagen…</div>';
    // Redimensionar a máx 640px y comprimir a JPEG 80% (base64)
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((res2) => { img.onload = res2; img.src = url; });
    const scale = Math.min(1, 640 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.8);      const palette = extractPalette(img);
      const autoBody = estimateBodyFromImage(img); // silueta detectada por IA (si hay figura)
      URL.revokeObjectURL(url);
      try {
      const selShape = selectedShapeId();
      const r = await api('/ai/analyze-outfit', { method: 'POST', body: { image: dataUrl, palette, body: { ...(selShape && selShape !== 'auto' ? { shape: selShape } : {}), ...(vmMeas() || {}), ...(autoBody ? { auto: autoBody } : {}) } } });
      lastAnalysis = r.analysis;
      lastPhoto = dataUrl;
      const a = r.analysis;
      prev.innerHTML = `
        <div class="flex gap-space-sm items-start">
          <img src="${dataUrl}" alt="prenda" class="w-24 h-24 rounded-xl object-cover border border-outline-variant"/>
          <div class="flex flex-col gap-1 min-w-0">
            <div class="flex flex-wrap gap-1">${a.colors.map((col) => `<span class="px-2 py-0.5 rounded-full font-label-sm text-label-sm font-bold" style="background:${col.hex};color:${['Blanco','Beige','Gris claro','Mostaza','Rosa'].includes(col.name) ? '#1c1b1d' : '#fff'}" title="${col.pct}%">${esc(col.name)} ${col.pct}%</span>`).join('')}</div>
            <div class="font-label-md text-label-md font-bold">Armonía ${esc(a.harmony)}</div>
            <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(a.harmonyDesc)}</div>
            ${a.garmentType ? `<div class="font-body-sm text-body-sm"><b>Prenda:</b> ${esc(a.garmentType)}</div>` : ''}
            <div class="font-body-sm text-body-sm"><b>Estilo:</b> ${esc(a.style)} · <b>Formalidad:</b> ${esc(a.formality)}</div>
            ${a.body ? `
            <div class="flex flex-col gap-1 p-2 rounded-lg bg-secondary-fixed">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="font-label-md text-label-md font-bold">${esc(a.body.emoji)} Silueta ${esc(a.body.label)}</span>
                <span class="font-label-sm text-label-sm text-on-surface-variant">· ${esc(a.body.method)}</span>
              </div>
              <div class="flex flex-wrap gap-x-4 gap-y-1">
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="font-label-sm text-label-sm font-bold" style="color:#1b6c3a">✓ Te favorece</span>
                  ${(a.body.favor || []).slice(0, 3).map((f) => `<span class="font-label-sm text-label-sm text-on-surface-variant">• ${esc(f)}</span>`).join('')}
                </div>
                <div class="flex flex-col gap-0.5 min-w-0">
                  <span class="font-label-sm text-label-sm font-bold" style="color:#b3261e">✗ Mejor evitar</span>
                  ${(a.body.avoid || []).slice(0, 2).map((f) => `<span class="font-label-sm text-label-sm text-on-surface-variant">• ${esc(f)}</span>`).join('')}
                </div>
              </div>
            </div>` : ''}
            <div class="flex flex-wrap gap-1">${(a.occasions || []).map((o) => `<span class="px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm font-bold">${esc(o)}</span>`).join('')}</div>
            <div class="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-sm">auto_awesome</span>${esc(a.notes)} · Motor: ${esc(a.engine === 'llm' ? a.model || 'LLM visión' : 'local (paleta)')}</div>
          </div>
        </div>`;
      $('vm-style-match-btn').disabled = false;
      out.innerHTML = '';
      toast('¡Foto analizada! Descubre tu look personalizado', 'check_circle');
    } catch (err) {
      prev.innerHTML = '';
      out.innerHTML = `<div class="p-2 rounded-lg bg-error-container text-error font-body-sm text-body-sm">${esc(err.message)}</div>`;
    }
  }

  async function requestStyleMatch() {
    if (!lastAnalysis) return toast('Primero sube una foto', 'error');
    const btn = $('vm-style-match-btn');
    const out = $('vm-vision-out');
    btn.disabled = true;
    const hasBody = Boolean(selectedShapeId() || vmMeas());
    out.innerHTML = `<div class="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm p-2"><span class="material-symbols-outlined animate-spin text-base">progress_activity</span>Buscando prendas que realcen tu foto${hasBody ? ' y tu silueta' : ''} (con tu historial)…</div>`;
    try {
      const r = await api('/ai/style-match', { method: 'POST', body: { analysis: lastAnalysis } });
      const products = r.products || [];
      out.innerHTML = `
        <div class="flex flex-col gap-2 mt-2">
          <div class="font-label-md text-label-md font-bold">${esc(r.reply)}</div>
          ${products.length ? `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">${products.map((p) => `
            <a href="/detalle-de-producto?sku=${encodeURIComponent(p.sku)}" class="flex flex-col rounded-xl overflow-hidden bg-surface-container hover:bg-surface-container-high transition-colors" style="text-decoration:none">
              <div class="h-24 bg-surface-container flex items-center justify-center" style="${p.image_url ? '' : 'background:linear-gradient(135deg,#f6f2f5,#e5e1e4)'}">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" class="w-full h-full object-cover"/>` : '<span class="material-symbols-outlined text-on-surface-variant">checkroom</span>'}</div>
              <div class="p-1.5 flex flex-col gap-0.5">
                <span class="font-label-sm text-label-sm font-bold text-on-surface truncate">${esc(p.name)}</span>
                <span class="font-label-sm text-label-sm text-primary font-bold">${fmtUSD(p.price)}</span>
                <span class="font-label-sm text-label-sm text-on-surface-variant truncate">${esc(p.category)} · match ${p.score}${p.shapePick ? ' · ✨ corte ideal' : ''}</span>
              </div>
            </a>`).join('')}</div>`
          : '<div class="font-body-sm text-body-sm text-on-surface-variant">Sin coincidencias con stock por ahora — prueba otra foto.</div>'}
          ${r.historyUsed ? '<div class="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-sm">history</span>Personalizado con tu historial de compras</div>' : ''}
        </div>`;
      if (products.length) toast(`${products.length} prendas seleccionadas para ti`, 'auto_awesome');
      addTryOnButton(out, products);
    } catch (err) {
      out.innerHTML = `<div class="p-2 rounded-lg bg-error-container text-error font-body-sm text-body-sm">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  }

  /** IA #11 · Probador virtual: genera la vista previa "¿cómo me quedaría?" con FLUX.1-schnell */
  function addTryOnButton(container, products) {
    const wrap = document.createElement('div');
    wrap.className = 'mt-1';
    wrap.innerHTML = `<button id="vm-tryon-btn" class="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md font-bold flex items-center gap-1 hover:opacity-90" type="button"><span class="material-symbols-outlined text-base">auto_awesome</span>Ver probado en mi foto</button><div id="vm-tryon-out" class="mt-2"></div>`;
    container.appendChild(wrap);
    wrap.querySelector('#vm-tryon-btn').addEventListener('click', async () => {
      const btn = wrap.querySelector('#vm-tryon-btn');
      const out = wrap.querySelector('#vm-tryon-out');
      if (!lastPhoto) return toast('Vuelve a subir tu foto para generar la vista previa', 'error');
      if (!products.length) return toast('Primero genera recomendaciones con stock', 'error');
      btn.disabled = true;
      out.innerHTML = `<div class="flex items-center gap-2 text-on-surface-variant font-body-sm text-body-sm p-2"><span class="material-symbols-outlined animate-spin text-base">progress_activity</span>Creando tu vista previa (hasta ~30 s)…</div>`;
      try {
        const p = products[0];
        const r = await api('/ai/tryon', { method: 'POST', body: { image: lastPhoto, garment: { name: p.name, category: p.category, description: p.description || '' } } });
        out.innerHTML = `
          <div class="flex gap-2 items-start p-2 rounded-xl bg-secondary-fixed">
            <img src="${r.image}" alt="Vista previa" class="w-40 rounded-lg border border-outline-variant"/>
            <div class="flex flex-col gap-1 min-w-0">
              <span class="font-label-md text-label-md font-bold">✨ Así te quedaría</span>
              <span class="font-body-sm text-body-sm font-bold truncate">${esc(p.name)}</span>
              <span class="font-label-md text-label-md font-bold text-primary">${fmtUSD(p.price)}</span>
              <a href="/detalle-de-producto?sku=${encodeURIComponent(p.sku)}" class="font-label-sm text-label-sm font-bold" style="color:#5b21b6;text-decoration:underline">Comprar ahora →</a>
              <span class="font-label-sm text-label-sm text-on-surface-variant">Generado con IA (${esc(r.engine)}) · ${((r.latencyMs || 0) / 1000).toFixed(1)} s</span>
            </div>
          </div>`;
        toast('Vista previa generada', 'check_circle');
      } catch (err) {
        out.innerHTML = `<div class="p-2 rounded-lg bg-error-container text-error font-body-sm text-body-sm">${esc(err.message)}</div>`;
      } finally { btn.disabled = false; }
    });
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
    injectVisionCard();
  }

  /** Encabezado del playground: muestra el motor activo (proveedor LLM vs local) */
  async function refreshEngineStatus() {
    const dot = document.querySelector('#chat-form')?.closest('.rounded-2xl')?.querySelector('.bg-emerald-500');
    const label = dot?.closest('span.font-label-sm') || dot?.parentElement;
    if (!label) return;
    try {
      const s = await api('/ai/stats');
      const eng = s.engine || {};
      const isLlm = Boolean(eng.llm);
      label.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${isLlm ? 'bg-emerald-500' : 'bg-amber-500'}"></span> Motor: ${esc(eng.label || (isLlm ? (eng.providerLabel || 'LLM') : 'Local'))}`;
      label.title = isLlm
        ? `LLM activo: ${eng.model} vía ${eng.providerLabel || eng.provider || 'API externa'}`
        : 'LLM no disponible: ' + (eng.reason || 'sin API key') + ' · respondiendo con reglas locales';
    } catch { /* sin conexión: deja el estado por defecto */ }
  }

  document.addEventListener('DOMContentLoaded', wire);
  if (document.readyState !== 'loading') wire();
})();
