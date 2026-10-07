/* ============================================================
   ASESOR DE ESTILO IA (/asesor-estilo)
   ------------------------------------------------------------
   Interfaz de las dos capacidades de la Fase 1:
     · chat con RAG      → POST /api/ai/style-chat
     · búsqueda visual   → POST /api/ai/visual-search
   Muestra además cómo se resolvió cada consulta (plan, filtros,
   fases de latencia y verificación de grounding), porque es lo
   que permite auditar que no se inventa productos.
   ============================================================ */
(function () {
  'use strict';
  const { esc, fmtUSD } = window.VM || {};
  const $ = (id) => document.getElementById(id);

  const EJEMPLOS = [
    '¿Qué me pongo para una boda en la playa?',
    'outfit casual para la oficina',
    'vestido para Nochevieja',
    'look playero para hombre',
    'algo elegante para una cena de noche',
    'una blusa para el trabajo por menos de 40 dólares',
    'qué me pongo para una fiesta en tonos fríos',
  ];

  const money = (n) => (fmtUSD ? fmtUSD(n) : '$' + Number(n || 0).toFixed(2));

  // ── Estado ───────────────────────────────────────────────
  const state = { imagen: null, ocupado: false };

  // ── Arranque ─────────────────────────────────────────────
  function init() {
    $('vm-samples').innerHTML = EJEMPLOS
      .map((e) => `<button type="button" data-q="${esc(e)}" class="text-[11px] font-bold rounded-full border border-[#eadfe6] px-2.5 py-1.5 text-[#7b5468] hover:bg-[#fdf6fa]">${esc(e)}</button>`)
      .join('');
    $('vm-samples').addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (!b) return;
      $('vm-input').value = b.dataset.q;
      enviar();
    });

    $('vm-form').addEventListener('submit', (e) => { e.preventDefault(); enviar(); });

    // Subida de imagen
    $('vm-drop').addEventListener('click', () => $('vm-file').click());
    $('vm-file').addEventListener('change', (e) => { if (e.target.files[0]) cargarImagen(e.target.files[0]); });
    ['dragenter', 'dragover'].forEach((ev) => $('vm-drop').addEventListener(ev, (e) => {
      e.preventDefault(); $('vm-drop').classList.add('drop-hot');
    }));
    ['dragleave', 'drop'].forEach((ev) => $('vm-drop').addEventListener(ev, (e) => {
      e.preventDefault(); $('vm-drop').classList.remove('drop-hot');
    }));
    $('vm-drop').addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) cargarImagen(f);
    });
    $('vm-clear').addEventListener('click', limpiarImagen);

    estado();
  }

  async function estado() {
    try {
      const r = await fetch('/api/ai/embeddings/status').then((x) => x.json());
      const s = r.sidecar || {};
      const c = r.cobertura || {};
      const pct = c.activos ? Math.round((c.con_vector / c.activos) * 100) : 0;
      $('vm-status').textContent = s.ok
        ? `FashionCLIP ${s.device} · ${c.con_vector}/${c.activos} SKUs vectorizados (${pct} %)`
        : 'motor de embeddings no disponible';
      $('vm-status').className = 'ml-auto text-[11px] ' + (s.ok ? 'text-green-600' : 'text-[#b60055]');
    } catch (_) {
      $('vm-status').textContent = 'no se pudo consultar el motor';
    }
  }

  // ── Chat ─────────────────────────────────────────────────
  function burbuja(html, clase) {
    const d = document.createElement('div');
    d.className = 'vm-fade rounded-2xl p-3.5 text-sm ' + clase;
    d.innerHTML = html;
    $('vm-log').appendChild(d);
    $('vm-log').scrollTop = $('vm-log').scrollHeight;
    return d;
  }

  function tarjetas(productos) {
    if (!productos || !productos.length) return '';
    return `<div class="grid grid-cols-3 gap-2 mt-3">` + productos.map((p) => `
      <a href="/detalle-de-producto?sku=${encodeURIComponent(p.sku)}"
         class="rounded-xl overflow-hidden bg-white border border-[#f0dbe6] hover:ring-2 hover:ring-[#b60055] transition">
        <div class="aspect-square bg-[#efe9ee]">
          ${p.image ? `<img src="${esc(p.image)}" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.style.display='none'"/>` : ''}
        </div>
        <div class="p-1.5">
          <div class="text-[10px] font-bold leading-tight line-clamp-2">${esc(p.name)}</div>
          <div class="text-[10px] text-[#b60055] font-extrabold">${money(p.price)}</div>
        </div>
      </a>`).join('') + '</div>';
  }

  async function enviar() {
    const q = $('vm-input').value.trim();
    if (!q || state.ocupado) return;
    state.ocupado = true;
    $('vm-input').value = '';
    burbuja(esc(q), 'bg-[#f6f2f5] ml-8');
    const pensando = burbuja('<span class="text-gray-400">Buscando en el catálogo…</span>', 'bg-[#fdf6fa] border border-[#f0dbe6] mr-8');

    try {
      const res = await fetch('/api/ai/style-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'error');
      const g = r.grounding || {};
      pensando.innerHTML =
        `<div class="leading-relaxed">${esc(r.reply || '').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')}</div>`
        + tarjetas(r.products)
        + `<div class="mt-3 pt-2 border-t border-[#f0dbe6] text-[10px] text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5">
             <span>⏱ ${r.latency_ms} ms</span>
             <span>🧠 plan: ${esc(r.plan_source || '?')}</span>
             <span>📦 ${(r.products || []).length} recuperados</span>
             <span class="${g.groundingOk ? 'text-green-600' : 'text-[#b60055]'}">${g.groundingOk ? '✓' : '⚠'} ${g.totalCitados || 0} citados · ${(g.inventados || []).length} inventados</span>
             ${r.filters_relaxed ? `<span>↩ filtro relajado: ${esc(r.filters_relaxed)}</span>` : ''}
           </div>`;
      pintarMeta(r);
    } catch (err) {
      pensando.innerHTML = `<span class="text-[#b60055]">No pude responder: ${esc(err.message)}</span>`;
    } finally {
      state.ocupado = false;
    }
  }

  function pintarMeta(r) {
    const f = r.phases_ms || {};
    const plan = r.plan || {};
    $('vm-meta').classList.remove('hidden');
    $('vm-meta-body').innerHTML = `
      <div><b>Filtros del plan:</b> ${esc(JSON.stringify(plan))}</div>
      <div><b>Origen del plan:</b> ${esc(r.plan_source || '?')}${r.filters_relaxed ? ` · se relajó <b>${esc(r.filters_relaxed)}</b> para no devolver vacío` : ''}</div>
      <div><b>Fases:</b> plan+embedding ${f.plan_y_embedding ?? '?'} ms · retrieval ${f.retrieval ?? '?'} ms · generación ${f.generacion ?? '?'} ms</div>
      <div><b>Grounding:</b> ${(r.grounding?.citados || []).map((c) => esc(c.name)).join(' · ') || '—'}</div>`;
  }

  // ── Búsqueda visual ──────────────────────────────────────
  function cargarImagen(file) {
    if (!file.type.startsWith('image/')) return;
    const fr = new FileReader();
    fr.onload = () => {
      state.imagen = fr.result; // data URL
      $('vm-preview-img').src = fr.result;
      $('vm-preview').classList.remove('hidden');
      buscarVisual();
    };
    fr.readAsDataURL(file);
  }

  function limpiarImagen() {
    state.imagen = null;
    $('vm-file').value = '';
    $('vm-preview').classList.add('hidden');
    $('vm-visual').classList.add('hidden');
  }

  async function buscarVisual() {
    if (!state.imagen) return;
    const sec = $('vm-visual');
    const grid = $('vm-visual-grid');
    sec.classList.remove('hidden');
    grid.innerHTML = '<p class="text-xs text-gray-400 col-span-full">Analizando la imagen…</p>';
    try {
      const res = await fetch('/api/ai/visual-search?k=8', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: state.imagen }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || 'error');
      grid.innerHTML = (r.results || []).map((p) => `
        <a href="/detalle-de-producto?sku=${encodeURIComponent(p.sku)}"
           class="bg-white rounded-2xl shadow hover:ring-2 hover:ring-[#b60055] transition overflow-hidden vm-fade">
          <div class="aspect-square bg-[#efe9ee] relative">
            ${p.image ? `<img src="${esc(p.image)}" alt="" class="w-full h-full object-cover" loading="lazy" onerror="this.style.display='none'"/>` : ''}
            <span class="absolute top-1.5 left-1.5 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full bg-white/90 text-[#b60055]">${(p.similarity * 100).toFixed(0)} %</span>
          </div>
          <div class="p-2">
            <div class="text-[11px] font-bold leading-tight line-clamp-2">${esc(p.name)}</div>
            <div class="text-[10px] text-gray-500 mt-0.5">${esc(p.garment || '')}${p.color ? ' · ' + esc(p.color) : ''}</div>
            <div class="text-[11px] text-[#b60055] font-extrabold mt-0.5">${money(p.price)}</div>
          </div>
        </a>`).join('') || '<p class="text-xs text-gray-400 col-span-full">Sin resultados.</p>';
      grid.insertAdjacentHTML('afterbegin',
        `<p class="text-[11px] text-gray-400 col-span-full">${r.count} prendas · ${r.latency_ms} ms (embedding ${r.embed_ms} ms)</p>`);
    } catch (err) {
      grid.innerHTML = `<p class="text-xs text-[#b60055] col-span-full">Error: ${esc(err.message)}</p>`;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
