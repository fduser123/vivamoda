/* Portal de autenticación en vivo (client / staff / admin) */
(function () {
  const { api, setSession, homeForRole, toast, esc } = window.VM;
  let currentRole = 'client';
  let currentMode = 'login';

  const $ = (id) => document.getElementById(id);

  function showError(form, msg) {
    toast(msg, 'error');
    const err = form.querySelector('.vm-form-error');
    if (!err) {
      const e = document.createElement('p');
      e.className = 'vm-form-error font-label-sm text-label-sm text-error';
      form.insertBefore(e, form.querySelector('button[type="submit"]'));
      err = e;
    }
    err.textContent = msg;
    setTimeout(() => { if (err && err.textContent === msg) err.textContent = ''; }, 5000);
  }

  // ---------- funciones usadas por el markup original ----------
  window.switchAuthMode = (mode) => {
    currentMode = mode;
    const loginForm = $('login-form');
    const registerForm = $('register-form');
    const tabLogin = $('tab-login-btn');
    const tabRegister = $('tab-register-btn');
    const socialBlock = $('social-access-block');
    if (!loginForm || !registerForm) return;
    loginForm.classList.toggle('hidden', mode !== 'login');
    registerForm.classList.toggle('hidden', mode !== 'register');
    tabLogin.classList.toggle('bg-primary', mode === 'login');
    tabLogin.classList.toggle('text-on-primary', mode === 'login');
    tabLogin.classList.toggle('shadow-sm', mode === 'login');
    tabRegister.classList.toggle('bg-primary', mode === 'register');
    tabRegister.classList.toggle('text-on-primary', mode === 'register');
    tabRegister.classList.toggle('shadow-sm', mode === 'register');
    if (socialBlock) socialBlock.style.display = mode === 'login' && currentRole === 'client' ? 'block' : 'none';
    syncStaffField();
  };

  window.selectRole = (role) => {
    currentRole = role;
    const badge = $('role-context-badge');
    const loginLabel = $('login-id-label');
    const loginInput = $('login-email');
    const socialBlock = $('social-access-block');
    ['client', 'staff', 'admin'].forEach((r) => {
      const btn = $('role-btn-' + r);
      const active = r === role;
      btn.classList.toggle('bg-surface-container', active);
      btn.classList.toggle('text-on-surface', active);
      btn.classList.toggle('shadow-sm', active);
      btn.classList.toggle('bg-surface-container-low', !active);
      btn.classList.toggle('text-on-surface-variant', !active);
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) icon.classList.toggle('text-primary', active);
    });
    if (role === 'client') {
      badge.textContent = 'Portal Clientes';
      badge.className = 'font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed';
      loginLabel.textContent = 'Correo Electrónico';
      loginInput.placeholder = 'tu.nombre@fashion.com';
      loginInput.type = 'email';
      if (socialBlock) socialBlock.style.display = currentMode === 'login' ? 'block' : 'none';
    } else if (role === 'staff') {
      badge.textContent = 'Terminal Empleados / Tienda';
      badge.className = 'font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-tertiary-fixed text-on-tertiary-fixed';
      loginLabel.textContent = 'ID de Empleado o Código de Tienda';
      loginInput.placeholder = 'STF-84920 o carlos.morales@vivamoda.com';
      loginInput.type = 'text';
      if (socialBlock) socialBlock.style.display = 'none';
    } else {
      badge.textContent = 'Consola Administrativa';
      badge.className = 'font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed';
      loginLabel.textContent = 'Credencial de Super Administrador';
      loginInput.placeholder = 'admin@vivamoda.internal';
      loginInput.type = 'email';
      if (socialBlock) socialBlock.style.display = 'none';
    }
    syncStaffField();
  };

  window.togglePasswordVisibility = (fieldId, triggerBtn) => {
    const input = $(fieldId);
    const icon = triggerBtn.querySelector('.material-symbols-outlined');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    if (icon) icon.innerText = show ? 'visibility_off' : 'visibility';
  };

  window.checkPasswordStrength = (password) => {
    const bar = $('pwd-strength-bar');
    const label = $('pwd-strength-text');
    if (!bar || !label) return;
    let strength = 0;
    if (password.length >= 8) strength += 25;
    if (/[A-Z]/.test(password)) strength += 25;
    if (/[0-9]/.test(password)) strength += 25;
    if (/[^A-Za-z0-9]/.test(password)) strength += 25;
    bar.style.width = (strength || 8) + '%';
    const cfg = [
      { max: 25, cls: 'bg-error', txt: 'Débil', color: 'text-error' },
      { max: 50, cls: 'bg-tertiary', txt: 'Aceptable', color: 'text-tertiary' },
      { max: 75, cls: 'bg-secondary', txt: 'Buena', color: 'text-secondary' },
      { max: 100, cls: 'bg-primary', txt: 'Muy Segura', color: 'text-primary font-bold' },
    ];
    const c = cfg.find((x) => strength <= x.max) || cfg[3];
    bar.className = `h-full transition-all duration-300 ${c.cls}`;
    label.className = `font-label-sm text-label-sm ${c.color}`;
    label.textContent = c.txt;
  };

  function syncStaffField() {
    // Campo de sucursal en el registro cuando el rol es staff
    let wrap = document.getElementById('reg-store-wrap');
    if (currentRole === 'staff' && currentMode === 'register') {
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'reg-store-wrap';
        wrap.className = 'flex flex-col gap-1';
        wrap.innerHTML = `
          <label class="font-label-md text-label-md text-on-surface" for="reg-store">Sucursal de trabajo</label>
          <div class="relative flex items-center">
            <span class="absolute left-3 text-outline material-symbols-outlined text-[18px]">storefront</span>
            <select id="reg-store" class="w-full pl-10 pr-3 py-2 rounded-lg bg-surface-container-low text-on-surface font-body-md text-body-md focus:bg-surface-bright focus:outline-none appearance-none">
            </select>
          </div>`;
        const terms = $('register-form')?.querySelector('label input[type="checkbox"]')?.closest('label');
        $('register-form').insertBefore(wrap, terms || null);
        api('/stores').then(({ stores }) => {
          const sel = $('reg-store');
          sel.innerHTML = stores.map((s) => `<option value="${esc(s.code)}">${esc(s.name)} (${esc(s.code)})</option>`).join('');
        }).catch(() => {});
      }
      wrap.classList.remove('hidden');
    } else if (wrap) {
      wrap.classList.add('hidden');
    }
  }

  function busyBtn(btn, loading, done = false) {
    if (!btn) return;
    btn.disabled = loading;
    btn.innerHTML = loading
      ? `<svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg><span>${currentMode === 'register' ? 'Creando cuenta…' : 'Autenticando…'}</span>`
      : done
        ? `<span class="material-symbols-outlined text-[20px]">check_circle</span><span>${currentMode === 'register' ? '¡Cuenta creada!' : '¡Acceso Concedido!'}</span>`
        : btn.dataset.original;
  }

  window.handleAuthSubmit = async (e, mode) => {
    e.preventDefault();
    const form = e.target;
    const btn = mode === 'login' ? $('btn-login-submit') : $('btn-register-submit');
    btn.dataset.original = btn.innerHTML;
    busyBtn(btn, true);
    try {
      if (mode === 'login') {
        const identifier = $('login-email').value.trim();
        const password = $('login-password').value;
        if (!identifier || !password) throw new Error('Ingresa tu correo/ID y contraseña');
        const res = await api('/auth/login', { auth: false, method: 'POST', body: { identifier, password } });
        setSession(res.token, res.user);
        successAndRedirect(btn, res.user);
      } else {
        // registro
        const payload = {
          role: currentRole === 'admin' ? 'client' : currentRole,
          email: $('reg-email').value.trim(),
          password: $('reg-password').value,
          fullName: $('reg-fullname').value.trim(),
          phone: $('reg-phone').value.trim(),
          interests: [...document.querySelectorAll('#register-form input[name="interest"]:checked')].map((i) => i.value),
          storeCode: $('reg-store')?.value,
        };
        if (currentRole === 'admin') {
          busyBtn(btn, false);
          return toast('Los administradores son creados por el equipo. Usa las credenciales demo o un staff registrado.', 'error');
        }
        const res = await api('/auth/register', { auth: false, method: 'POST', body: payload });
        setSession(res.token, res.user);
        if (res.user.role === 'staff') {
          setTimeout(() => toast(`¡Listo! Tu código de empleado es ${res.user.employeeCode} — guárdalo.`, 'badge'), 400);
        }
        successAndRedirect(btn, res.user);
      }
    } catch (err) {
      busyBtn(btn, false);
      showError(form, err.message);
    }
  };

  function successAndRedirect(btn, user) {
    busyBtn(btn, false, true);
    const next = new URLSearchParams(location.search).get('next');
    setTimeout(() => {
      location.href = next && next.startsWith('/') && !next.startsWith('/api') ? next : homeForRole(user.role);
    }, 900);
  }

  window.simulateOAuth = (provider) => {
    const btn = event.currentTarget;
    btn.innerHTML = `<span class="font-label-sm text-label-sm">Conectando ${provider}…</span>`;
    setTimeout(() => {
      toast('Demo: la conexión OAuth real requiere configuración de proveedor', 'info');
      btn.innerHTML = btn.dataset.oauth || (btn.innerHTML = '<span>Conectar de nuevo</span>');
    }, 900);
  };

  // ---------- init ----------
  const params = new URLSearchParams(location.search);
  if (params.get('mode') === 'register') switchAuthMode('register');
  if (params.get('role')) selectRole(params.get('role'));
  if (params.get('next')) {
    // permite redirigir tras autenticar
  }
  document.querySelectorAll('#tab-login-btn, #tab-register-btn').forEach((b) =>
    b.addEventListener('click', () => switchAuthMode(b.id.includes('login') ? 'login' : 'register')));
  document.querySelectorAll('#role-btn-client, #role-btn-staff, #role-btn-admin').forEach((b) =>
    b.addEventListener('click', () => selectRole(b.id.replace('role-btn-', ''))));

  // demo hint discreta bajo el formulario
  if (!$('vm-demo-hint')) {
    const hint = document.createElement('div');
    hint.id = 'vm-demo-hint';
    hint.style.cssText = 'margin-top:14px;padding:10px 12px;border-radius:12px;background:#f6f2f5;font:600 11px/1.6 "Plus Jakarta Sans";color:#5c3f45';
    hint.innerHTML = 'Cuentas demo — Cliente: <b>elena.rossi@vivamoda.com</b> / Cliente123! · Staff: <b>STF-84920</b> / Staff123! · Admin: <b>admin@vivamoda.internal</b> / Admin123!';
    $('login-form').parentElement.appendChild(hint);
  }
})();
