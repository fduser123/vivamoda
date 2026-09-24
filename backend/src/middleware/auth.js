import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { config } from '../config.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

/** Carga la fila completa del usuario a partir del payload del token */
export async function loadUser(id) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.employee_code, u.store_id,
            u.interests, u.vip_tier, u.points, u.is_active,
            s.code AS store_code, s.name AS store_name
     FROM users u LEFT JOIN stores s ON s.id = u.store_id
     WHERE u.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const u = rows[0];
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    phone: u.phone,
    role: u.role,
    employeeCode: u.employee_code,
    storeId: u.store_id,
    store: u.store_id ? { id: u.store_id, code: u.store_code, name: u.store_name } : null,
    interests: u.interests || [],
    vipTier: u.vip_tier,
    points: u.points,
    isActive: u.is_active,
  };
}

export function publicUser(u) {
  return u;
}

/** Lee el token del header y adjunta req.user si es válido (no falla si falta) */
export async function attachUser(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      req.user = await loadUser(payload.sub);
      if (req.user && !req.user.isActive) req.user = null;
    } catch (err) {
      req.user = null;
      console.error('[auth] token inválido:', err.message);
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permisos para esta operación', code: 'FORBIDDEN' });
    }
    next();
  };
}
