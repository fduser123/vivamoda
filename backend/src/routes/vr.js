import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, publicUser } from '../middleware/auth.js';

const router = Router();

/* ============================================================
   VR CUSTOMER SESSION  (persona / avatar / gustos)
   - GET    /api/vr/session             → sesión pública de la persona
     (autenticado: datos reales; no autenticado: persona anónima)
   - GET    /api/vr/session/public     → sólo los datos que la tienda VR
     puede leer sin token (paleta, avatar default, intereses defaults)
   - POST   /api/vr/session            → (auth) actualiza avatar/intereses/género
   - POST   /api/vr/session/favorite   → (auth opcional) marca producto como
     destacado para esa persona
   - GET    /api/vr/highlights?gender=&q=   → productos destacados por género
     (usado para el spotlight de la tienda VR)
   ============================================================ */

const GENDER_DEFAULTS = {
  damas:      { label: 'Damas',      avatar: 'female',   color: '#e4006c' },
  caballeros: { label: 'Caballeros', avatar: 'male',     color: '#2f54d0' },
  ninos:      { label: 'Niños',      avatar: 'child',    color: '#f0a832' },
  unisex:     { label: 'Todos',      avatar: 'neutral',  color: '#8f7bff' },
};

/* Persona anónima por defecto */
const ANON_SESSION = {
  id: null,
  email: null,
  fullName: null,
  role: 'client',
  isAnonymous: true,
  gender: 'damas',
  avatar: 'female',
  interests: ['damas'],
  vipTier: 'Classic',
  favoriteSku: null,
};

function avatarSilhouette(avatarKey) {
  //sprite de avatar simple que usará la tienda VR para el cliente que camina
  return {
    female:  { emoji: '👩', label: 'Cliente' },
    male:    { emoji: '👨', label: 'Cliente' },
    child:   { emoji: '🧒', label: 'Cliente' },
    neutral: { emoji: '🧑', label: 'Cliente' },
  }[avatarKey] || { emoji: '🧑', label: 'Cliente' };
}

/** Construye la sesión VR desde un usuario de DB (si existe) */
function sessionFromUser(user, favoriteSku = null) {
  const gender = (user?.interests && user.interests[0]) || 'damas';
  const def = GENDER_DEFAULTS[gender] || GENDER_DEFAULTS.damas;
  // El avatar se puede sobreescribir; si el usuario no tiene pref, se infiere del género
  const avatar = user?.avatar || def.avatar;
  return {
    id: user?.id ?? null,
    email: user?.email ?? null,
    fullName: user?.fullName ?? null,
    role: user?.role ?? 'client',
    isAnonymous: !user,
    gender,
    avatar,
    avatarMeta: avatarSilhouette(avatar),
    interests: user?.interests && user.interests.length ? user.interests : [gender],
    vipTier: user?.vipTier || 'Classic',
    favoriteSku,
    // paleta del género para el spotlight
    palette: {
      primary: user && user.id ? null : def.color, // cuando anónimo usamos color de género
      accent:  '#ff8ab5',
    },
  };
}

/* ---------- GET /api/vr/session ---------- */
router.get('/session', async (req, res) => {
  try {
    // fav puede venir de query para poder usarlo tanto anónimo como autenticado
    const favoriteSku = req.query.favoriteSku || null;
    const session = req.user ? sessionFromUser(req.user, favoriteSku) : sessionFromUser(null, favoriteSku);
    res.json({ session });
  } catch (err) {
    console.error('[vr/session]', err);
    res.status(500).json({ error: 'Error leyendo la sesión VR' });
  }
});

/* ---------- GET /api/vr/session/public ---------- */
router.get('/session/public', async (_req, res) => {
  try {
    // Datos públicos mínimos para la tienda VR sin token
    res.json({
      session: sessionFromUser(null),
      genders: Object.keys(GENDER_DEFAULTS).map((k) => ({
        id: k,
        label: GENDER_DEFAULTS[k].label,
        avatar: GENDER_DEFAULTS[k].avatar,
        color: GENDER_DEFAULTS[k].color,
      })),
    });
  } catch (err) {
    console.error('[vr/session/public]', err);
    res.status(500).json({ error: 'Error leyendo la sesión pública VR' });
  }
});

/* ---------- POST /api/vr/session ---------- */
router.post('/session', requireAuth, async (req, res) => {
  try {
    const { gender, avatar, interests, favoriteSku } = req.body || {};
    // Validar género
    if (gender && !GENDER_DEFAULTS[gender]) {
      return res.status(400).json({ error: 'Género inválido', code: 'INVALID_GENDER' });
    }
    // Validar avatar
    const VALID_AVATARS = new Set(Object.keys(GENDER_DEFAULTS).map((k) => GENDER_DEFAULTS[k].avatar));
    if (avatar && !VALID_AVATARS.has(avatar)) {
      return res.status(400).json({ error: 'Avatar inválido', code: 'INVALID_AVATAR' });
    }

    const fields = [];
    const params = [];
    if (gender) {
      params.push(gender);
      fields.push(`interests = $${params.length}`);
    }
    if (avatar) {
      params.push(avatar);
      fields.push(`avatar = $${params.length}`);
    }
    if (interests && Array.isArray(interests) && interests.length) {
      params.push(interests);
      fields.push(`interests = $${params.length}`);
    }
    if (!fields.length) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }
    params.push(req.user.id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);

    const user = await loadUser(req.user.id);
    res.json({
      session: sessionFromUser({
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        interests: user.interests,
        vipTier: user.vip_tier,
        avatar: user.avatar,
      }, favoriteSku || null),
    });
  } catch (err) {
    console.error('[vr/session/post]', err);
    res.status(500).json({ error: 'Error actualizando la sesión VR' });
  }
});

async function loadUser(id) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.interests, u.vip_tier, u.avatar
     FROM users u WHERE u.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const u = rows[0];
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    role: u.role,
    interests: u.interests || [],
    vipTier: u.vip_tier,
    avatar: u.avatar || null,
  };
}

/* ---------- POST /api/vr/session/favorite ---------- */
router.post('/session/favorite', requireAuth, async (req, res) => {
  try {
    const { sku } = req.body || {};
    if (!sku || typeof sku !== 'string') {
      return res.status(400).json({ error: 'Falta sku' });
    }
    // guardamos el producto favorito en una tabla ligera de preferencias VR
    await pool.query(
      `INSERT INTO vr_user_prefs (user_id, favorite_sku, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET favorite_sku = EXCLUDED.favorite_sku, updated_at = now()`,
      [req.user.id, sku],
    );
    const user = await loadUser(req.user.id);
    res.json({
      session: sessionFromUser({
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        interests: user.interests,
        vipTier: user.vip_tier,
        avatar: user.avatar,
      }, sku),
    });
  } catch (err) {
    console.error('[vr/session/favorite]', err);
    res.status(500).json({ error: 'Error guardando el producto destacado' });
  }
});

/* ---------- GET /api/vr/highlights ---------- */
router.get('/highlights', async (req, res) => {
  try {
    const gender = (req.query.gender || '').toLowerCase();
    const q = (req.query.q || '').trim();

    const conditions = ['p.is_active = TRUE', "p.visibility = 'store'"];
    const params = [];
    const p = (v) => { params.push(v); return `$${params.length}`; };

    if (gender && GENDER_DEFAULTS[gender]) {
      conditions.push(`p.gender = ${p(gender)}`);
    }
    if (q) {
      conditions.push(`(p.name ILIKE ${p(`%${q}%`)} OR p.category ILIKE ${p(`%${q}%`)} OR p.sku ILIKE ${p(`%${q}%`)})`);
    }

    const limit = Math.min(Number(req.query.limit) || 12, 40);

    const { rows } = await pool.query(
      `SELECT p.sku, p.name, p.category, p.gender, p.badge,
              p.price::float8 AS price, p.compare_at::float8 AS compare_at,
              p.rating::float8 AS rating, p.review_count,
              p.image_url, p.is_new, p.is_featured,
              p.details->>'care' AS care
       FROM products p
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.is_featured DESC, p.rating DESC, p.created_at DESC
       LIMIT ${limit}`,
    );

    res.json({ items: rows.map((r) => ({
      sku: r.sku,
      name: r.name,
      category: r.category,
      gender: r.gender,
      badge: r.badge,
      price: Number(r.price),
      compareAt: r.compare_at != null ? Number(r.compare_at) : null,
      rating: Number(r.rating),
      reviewCount: r.review_count,
      image: r.image_url,
      isNew: r.is_new,
      isFeatured: r.is_featured,
      care: r.care || null,
    })) });
  } catch (err) {
    console.error('[vr/highlights]', err);
    res.status(500).json({ error: 'Error consultando los productos destacados' });
  }
});

/* ---------- GET /api/vr/products/:sku/care ---------- */
router.get('/products/:sku/care', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.name, p.category, p.price::float8 AS price, p.compare_at::float8 AS compare_at,
              p.details->>'care' AS care,
              p.details->>'materials' AS materials,
              p.details->>'origin' AS origin
       FROM products p
       WHERE p.sku = $1 AND p.is_active = TRUE`,
      [req.params.sku],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Producto no encontrado' });
    const r = rows[0];
    res.json({
      sku: req.params.sku,
      name: r.name,
      category: r.category,
      price: Number(r.price),
      compareAt: r.compare_at != null ? Number(r.compare_at) : null,
      care: r.care || null,
      materials: r.materials || null,
      origin: r.origin || null,
    });
  } catch (err) {
    console.error('[vr/products/:sku/care]', err);
    res.status(500).json({ error: 'Error consultando el cuidado del producto' });
  }
});

export default router;
