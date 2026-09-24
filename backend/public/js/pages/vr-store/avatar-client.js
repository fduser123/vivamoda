/* ============================================================
   CLIENTE EN LA TIENDA VR
   Lee/modifica la sesión de persona (avatar, género, intereses)
   y actualiza la barra superior + persistencia localStorage.
   ============================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'vivamoda_vr_session';
  const GENDER_AVATAR = {
    damas: 'female',
    caballeros: 'male',
    ninos: 'child',
  };
  const GENDER_EMOJI = {
    female: '👩',
    male: '👨',
    child: '🧒',
    neutral: '🧑',
  };

  let session = null;

  function applySession(s) {
    if (!s) return;
    session = s;
    const avatarKey = s.avatar || GENDER_AVATAR[s.gender] || 'neutral';
    document.getElementById('clientAvatar').textContent = GENDER_EMOJI[avatarKey] || '🧑';
    document.getElementById('clientLabel').textContent = s.fullName
      ? (s.fullName.split(' ')[0] || 'Cliente')
      : 'Cliente';
    const sel = document.getElementById('genderSelect');
    if (sel && sel.value !== s.gender) sel.value = s.gender;
    // Persistir en localStorage (solo versión local, no credentials)
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        gender: s.gender,
        avatar: s.avatar,
        fullName: s.fullName,
        isAnonymous: !s.id,
      }));
    } catch (_) {}
  }

  function loadFromBackend() {
    // Público: no requiere token
    fetch('/api/vr/session/public')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        const pub = j.session || null;
        const stored = loadStored();
        // Si hay sesión autenticada, usarla; si no, combinar con público.
        if (session && session.id) {
          // mantener sesión existente
          return;
        }
        const merged = Object.assign({}, pub, stored);
        applySession(merged);
      })
      .catch(function () { applySession(Object.assign({}, defaultSession(), loadStored())); });
  }

  function loadStored() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : null;
    } catch (_) {
      return null;
    }
  }

  function defaultSession() {
    return {
      id: null,
      fullName: null,
      gender: 'damas',
      avatar: GENDER_AVATAR.damas,
      isAnonymous: true,
    };
  }

  function persistLocal(partial) {
    try {
      const current = loadStored() || defaultSession();
      const next = Object.assign({}, current, partial);
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch (_) {}
  }

  function sendGender(gender, avatar) {
    if (!gender) return;
    // Si hay una sesión autenticada, Enviar a backend; si no, solo persistir local.
    const authenticated = session && session.id;
    if (authenticated) {
      const body = { gender };
      if (avatar) body.avatar = avatar;
      fetch('/api/vr/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.session) applySession(j.session);
        })
        .catch(function () {});
    } else {
      persistLocal({ gender: gender, avatar: avatar || GENDER_AVATAR[gender] || null });
      applySession(Object.assign({}, session || defaultSession(), {
        gender: gender,
        avatar: avatar || GENDER_AVATAR[gender],
      }));
    }
  }

  function init() {
    const sel = document.getElementById('genderSelect');
    if (!sel) return;

    // Observar cambios del selector
    sel.addEventListener('change', function () {
      const gender = sel.value;
      sendGender(gender);
    });

    // Cargar estado inicial
    loadFromBackend();

    // Refrescar si la sesión cambia (p.ej. loginando desde otro tab — opcional)
    window.addEventListener('storage', function (e) {
      if (e.key === STORE_KEY) {
        const stored = loadStored();
        applySession(Object.assign({}, session || defaultSession(), stored || {}));
      }
    });

    // Exponer para depuración
    window.__VRClient = {
      session: function () { return session; },
      apply: applySession,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
