'use strict';
const express = require('express');
const { getDb } = require('../db');
const auth = require('../middleware/auth');
const { wrap } = require('../middleware/errors');
const { badRequest, AppError } = require('../utils/helpers');
const audit = require('../services/audit.service');
const config = require('../config');

const router = express.Router();

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim().toLowerCase());
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const ctx = { user: user ? { id: user.id, username: user.username } : null, ip, userAgent: req.headers['user-agent'] };

  if (!user || !auth.verifyPassword(String(password || ''), user.password_hash)) {
    audit.log(ctx, { action: 'login_failed', entityType: 'user', entityId: user ? user.id : null, entityLabel: String(username || ''), summary: `محاولة دخول فاشلة: ${username}` });
    throw new AppError('اسم المستخدم أو كلمة المرور غير صحيحة', 401, 'INVALID_CREDENTIALS');
  }
  if (!user.is_active) throw new AppError('الحساب موقوف — راجع مدير النظام', 403, 'INACTIVE');

  const token = auth.createSession(user, ip, req.headers['user-agent']);
  getDb().prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  audit.log({ user, ip, userAgent: req.headers['user-agent'] }, {
    action: 'login', entityType: 'user', entityId: user.id, entityLabel: user.username, summary: `تسجيل دخول ${user.username}`
  });
  const session = auth.loadSession(token);
  res.json({
    ok: true,
    data: {
      token,
      user: {
        id: session.id, username: session.username, fullName: session.fullName,
        role: session.roleCode, roleName: session.roleName,
        permissions: Array.from(session.permissions),
        mustChangePassword: !!user.must_change_password
      },
      environment: config.isDemo ? 'demo' : 'production'
    }
  });
}));

router.post('/logout', auth.requireAuth, wrap(async (req, res) => {
  audit.log(req, { action: 'logout', entityType: 'user', entityId: req.user.id, entityLabel: req.user.username, summary: `تسجيل خروج ${req.user.username}` });
  auth.destroySession(auth.extractToken(req));
  res.json({ ok: true });
}));

router.get('/me', auth.requireAuth, wrap(async (req, res) => {
  res.json({
    ok: true,
    data: {
      user: {
        id: req.user.id, username: req.user.username, fullName: req.user.fullName,
        role: req.user.roleCode, roleName: req.user.roleName,
        permissions: Array.from(req.user.permissions)
      },
      environment: config.isDemo ? 'demo' : 'production'
    }
  });
}));

router.post('/change-password', auth.requireAuth, wrap(async (req, res) => {
  const admin = require('../services/admin.service');
  admin.changeOwnPassword(req.user.id, req.body.old_password, req.body.new_password, req);
  res.json({ ok: true, message: 'تم تغيير كلمة المرور' });
}));

module.exports = router;
