import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken, loadUser, requireAuth } from '../middleware/auth.js';

const router = Router();

function emailOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function validatePassword(pw) {
  return typeof pw === 'string' && pw.length >= 8;
}

async function generateEmployeeCode() {
  for (let i = 0; i < 5; i++) {
    const code = `STF-${Math.floor(10000 + Math.random() * 89999)}`;
    const { rows } = await pool.query('SELECT 1 FROM users WHERE employee_code = $1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('No se pudo generar un código de empleado único');
}

/**
 * POST /api/auth/register
 * Roles públicos: client y staff (los admins se crean por seed/setup).
 * body: { role, email, password, fullName, phone?, interests?, storeCode? }
 */
router.post('/register', async (req, res) => {
  try {
    const { role = 'client', email, password, fullName, phone, interests = [], storeCode } = req.body || {};
    if (!['client', 'staff'].includes(role)) {
      return res.status(403).json({ error: 'El registro de administradores no está habilitado. Usa las credenciales demo o que un admin te cree la cuenta.', code: 'ADMIN_REGISTER_DISABLED' });
    }
    if (!fullName?.trim() || fullName.trim().length < 3) return res.status(400).json({ error: 'Ingresa tu nombre completo' });
    if (!emailOk(email)) return res.status(400).json({ error: 'Correo electrónico inválido' });
    if (!validatePassword(password)) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    const existing = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo', code: 'EMAIL_IN_USE' });

    let storeId = null;
    if (role === 'staff') {
      const code = storeCode?.trim().toUpperCase() || 'CENTRO';
      const store = await pool.query('SELECT id FROM stores WHERE code = $1', [code]);
      if (!store.rows.length) return res.status(400).json({ error: `Código de tienda inválido (${code}). Tiendas disponibles: CENTRAL, NORTE, ONLINE, CENTRO` });
      storeId = store.rows[0].id;
    }

    const employeeCode = role === 'staff' ? await generateEmployeeCode() : null;
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role, employee_code, store_id, interests, vip_tier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Classic') RETURNING id`,
      [email.trim().toLowerCase(), hash, fullName.trim(), phone?.trim() || null, role, employeeCode, storeId, interests],
    );
    const user = await loadUser(rows[0].id);
    res.status(201).json({
      token: signToken(user),
      user,
      message: role === 'staff'
        ? `Cuenta de empleado creada. Tu código es ${employeeCode} (guárdalo para iniciar sesión).`
        : '¡Cuenta creada! Bienvenida/o a VivaModa.',
    });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Error al crear la cuenta' });
  }
});

/**
 * POST /api/auth/login
 * body: { identifier, password }
 * identifier puede ser email o código de empleado (STF-XXXXX)
 */
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) return res.status(400).json({ error: 'Ingresa correo/ID y contraseña' });

    const isEmployee = /^STF-/i.test(String(identifier).trim());
    const { rows } = isEmployee
      ? await pool.query('SELECT id FROM users WHERE UPPER(employee_code) = UPPER($1)', [identifier.trim()])
      : await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [identifier.trim()]);

    if (!rows.length) return res.status(401).json({ error: 'Credenciales inválidas' });
    const { rows: full } = await pool.query('SELECT id, password_hash FROM users WHERE id = $1', [rows[0].id]);
    const ok = bcrypt.compareSync(password, full[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    const user = await loadUser(full[0].id);
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

/** GET /api/auth/me */
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

/** PUT /api/auth/me — actualiza datos del perfil */
router.put('/me', requireAuth, async (req, res) => {
  const { fullName, phone, interests, vipTier } = req.body || {};
  const fields = [];
  const params = [];
  if (fullName) { params.push(fullName.trim()); fields.push(`full_name = $${params.length}`); }
  if (phone !== undefined) { params.push(phone); fields.push(`phone = $${params.length}`); }
  if (interests) { params.push(interests); fields.push(`interests = $${params.length}`); }
  if (vipTier) { params.push(vipTier); fields.push(`vip_tier = $${params.length}`); }
  if (!fields.length) return res.status(400).json({ error: 'No hay campos para actualizar' });
  params.push(req.user.id);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
  res.json({ user: await loadUser(req.user.id) });
});

export default router;
