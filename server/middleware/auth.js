'use strict';
/**
 * المصادقة (Sessions) + الصلاحيات (RBAC)
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { AppError, forbidden } = require('../utils/helpers');

const TOKEN_PREFIX = 'oy_';

function hashPassword(plain) { return bcrypt.hashSync(plain, 10); }
function verifyPassword(plain, hash) { return bcrypt.compareSync(plain, hash); }

function createSession(user, ip, userAgent) {
  const db = getDb();
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('hex');
  const ttlHours = parseInt(process.env.SESSION_TTL_HOURS || '12', 10);
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
              VALUES (?, ?, datetime('now', ?), ?, ?)`)
    .run(token, user.id, `+${ttlHours} hours`, ip || null, userAgent || null);
  return token;
}

function destroySession(token) {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(token);
}

function loadSession(token) {
  if (!token) return null;
  const row = getDb().prepare(`
    SELECT s.id AS token, s.expires_at, u.id, u.username, u.full_name, u.role_id, u.is_active,
           r.code AS role_code, r.name AS role_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN roles r ON r.id = u.role_id
    WHERE s.id = ? AND u.is_active = 1 AND s.expires_at > datetime('now')
  `).get(token);
  if (!row) return null;
  const perms = getDb().prepare(`
    SELECT p.code FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ?`).all(row.role_id).map(r => r.code);
  return {
    id: row.id, username: row.username, fullName: row.full_name,
    roleId: row.role_id, roleCode: row.role_code, roleName: row.role_name,
    permissions: new Set(perms)
  };
}

function extractToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

/** وسيط: يطلب مستخدمًا مسجَّل الدخول */
function requireAuth(req, res, next) {
  const user = loadSession(extractToken(req));
  if (!user) return next(new AppError('جلسة غير صالحة، يرجى تسجيل الدخول', 401, 'UNAUTHORIZED'));
  req.user = user;
  req.ipAddress = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  req.agent = req.headers['user-agent'] || '';
  next();
}

/** وسيط: يشترط صلاحية محددة (أو أيًا من القائمة) */
function requirePerm(...codes) {
  const list = codes.flat();
  return (req, res, next) => {
    if (!req.user) return next(new AppError('غير مسجَّل الدخول', 401, 'UNAUTHORIZED'));
    const ok = list.some(c => req.user.permissions.has(c));
    if (!ok) return next(forbidden(`ليست لديك الصلاحية المطلوبة: ${list.join(' أو ')}`));
    next();
  };
}

function hasPerm(user, code) { return !!user && user.permissions.has(code); }

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession,
  loadSession, extractToken, requireAuth, requirePerm, hasPerm
};
