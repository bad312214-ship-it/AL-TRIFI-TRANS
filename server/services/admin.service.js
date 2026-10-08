'use strict';
/**
 * خدمة الإدارة: المشاريع، مراكز التكلفة، الحسابات، المستخدمون، الأدوار، الإعدادات، سجل العمليات
 */
const { getDb, tx } = require('../db');
const { badRequest, notFound } = require('../utils/helpers');
const { reqStr, optStr, optId, paginate, QueryBuilder } = require('../utils/validators');
const { hashPassword } = require('../middleware/auth');
const audit = require('./audit.service');
const catalog = require('../utils/permissions');

/* ---------------- المشاريع ---------------- */
function listProjects() {
  return getDb().prepare(`SELECT p.*, (SELECT COUNT(*) FROM cost_centers c WHERE c.project_id = p.id) AS cost_centers_count,
    (SELECT COUNT(*) FROM advances a WHERE a.project_id = p.id AND a.is_void = 0) AS advances_count
    FROM projects p ORDER BY p.is_default DESC, p.name`).all();
}
function createProject(body, ctx) {
  const code = reqStr(body.code, 'رمز المشروع', 30).toUpperCase();
  const name = reqStr(body.name, 'اسم المشروع', 120);
  if (getDb().prepare('SELECT id FROM projects WHERE code = ?').get(code)) throw badRequest('رمز المشروع مستخدم');
  const id = tx(() => {
    const r = getDb().prepare('INSERT INTO projects (code, name, description, is_default, created_by) VALUES (?,?,?,?,?)')
      .run(code, name, optStr(body.description, 500), body.is_default ? 1 : 0, ctx.user.id);
    // مركز التكلفة الرئيسي يُنشأ تلقائيًا مع المشروع
    getDb().prepare('INSERT INTO cost_centers (project_id, code, name, is_main) VALUES (?,?,?,1)')
      .run(r.lastInsertRowid, `${code}-MAIN`, `${name} - رئيسي`);
    if (body.is_default) getDb().prepare('UPDATE projects SET is_default = 0 WHERE id <> ?').run(r.lastInsertRowid);
    audit.log(ctx, { action: 'create', entityType: 'project', entityId: r.lastInsertRowid, entityLabel: name, summary: `إضافة مشروع: ${name}`, newValues: { code, name } });
    return r.lastInsertRowid;
  });
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
}
function updateProject(id, body, ctx) {
  const before = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!before) throw notFound('المشروع');
  tx(() => {
    getDb().prepare(`UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description),
      is_active = COALESCE(?, is_active), updated_at = datetime('now') WHERE id = ?`)
      .run(optStr(body.name, 120), optStr(body.description, 500),
        body.is_active === undefined ? null : (body.is_active ? 1 : 0), id);
    if (body.is_default) getDb().prepare('UPDATE projects SET is_default = 0').run();
    if (body.is_default) getDb().prepare('UPDATE projects SET is_default = 1 WHERE id = ?').run(id);
    audit.log(ctx, { action: 'update', entityType: 'project', entityId: id, entityLabel: before.name, summary: `تعديل المشروع ${before.name}`, oldValues: before });
  });
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

/* ---------------- مراكز التكلفة ---------------- */
function listCostCenters(projectId) {
  return getDb().prepare(`SELECT cc.*, p.name AS project_name,
      (SELECT name FROM cost_centers x WHERE x.id = cc.parent_id) AS parent_name
    FROM cost_centers cc JOIN projects p ON p.id = cc.project_id
    ${projectId ? 'WHERE cc.project_id = ?' : ''} ORDER BY cc.is_main DESC, cc.name`)
    .all(projectId ? [Number(projectId)] : []);
}
function createCostCenter(body, ctx) {
  const projectId = Number(body.project_id);
  if (!getDb().prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) throw badRequest('المشروع غير موجود');
  const code = reqStr(body.code, 'رمز مركز التكلفة', 30).toUpperCase();
  if (getDb().prepare('SELECT id FROM cost_centers WHERE code = ?').get(code)) throw badRequest('رمز مركز التكلفة مستخدم');
  const parentId = optId(body.parent_id);
  if (parentId) {
    const par = getDb().prepare('SELECT * FROM cost_centers WHERE id = ?').get(parentId);
    if (!par) throw badRequest('مركز التكلفة الأب غير موجود');
    if (par.project_id !== projectId) throw badRequest('مركز التكلفة الأب لا يتبع نفس المشروع');
  }
  const r = getDb().prepare('INSERT INTO cost_centers (project_id, parent_id, code, name) VALUES (?,?,?,?)')
    .run(projectId, parentId, code, reqStr(body.name, 'اسم مركز التكلفة', 120));
  audit.log(ctx, { action: 'create', entityType: 'cost_center', entityId: r.lastInsertRowid, entityLabel: code, summary: `إضافة مركز تكلفة ${code}`, newValues: { code } });
  return getDb().prepare('SELECT * FROM cost_centers WHERE id = ?').get(r.lastInsertRowid);
}
function updateCostCenter(id, body, ctx) {
  const before = getDb().prepare('SELECT * FROM cost_centers WHERE id = ?').get(id);
  if (!before) throw notFound('مركز التكلفة');
  getDb().prepare(`UPDATE cost_centers SET name = COALESCE(?, name), is_active = COALESCE(?, is_active), updated_at = datetime('now') WHERE id = ?`)
    .run(optStr(body.name, 120), body.is_active === undefined ? null : (body.is_active ? 1 : 0), id);
  audit.log(ctx, { action: 'update', entityType: 'cost_center', entityId: id, entityLabel: before.code, summary: `تعديل مركز التكلفة ${before.code}`, oldValues: before });
  return getDb().prepare('SELECT * FROM cost_centers WHERE id = ?').get(id);
}

/* ---------------- دليل الحسابات ---------------- */
function listAccounts(type) {
  return getDb().prepare(`SELECT a.*, (SELECT name FROM accounts x WHERE x.id = a.parent_id) AS parent_name
    FROM accounts a ${type ? 'WHERE a.type = ?' : ''} ORDER BY a.code`).all(type ? [type] : []);
}
function createAccount(body, ctx) {
  const code = reqStr(body.code, 'رمز الحساب', 20);
  if (getDb().prepare('SELECT id FROM accounts WHERE code = ?').get(code)) throw badRequest('رمز الحساب مستخدم');
  const type = reqStr(body.type, 'نوع الحساب', 20);
  if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(type)) throw badRequest('نوع الحساب غير صالح');
  const nature = body.nature === 'credit' ? 'credit' : (type === 'liability' || type === 'equity' || type === 'income' ? 'credit' : 'debit');
  const r = getDb().prepare('INSERT INTO accounts (code, name, type, parent_id, nature) VALUES (?,?,?,?,?)')
    .run(code, reqStr(body.name, 'اسم الحساب', 120), type, optId(body.parent_id), nature);
  audit.log(ctx, { action: 'create', entityType: 'account', entityId: r.lastInsertRowid, entityLabel: `${code} ${body.name}`, summary: `إضافة حساب ${code}`, newValues: { code } });
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(r.lastInsertRowid);
}
function updateAccount(id, body, ctx) {
  const before = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!before) throw notFound('الحساب');
  getDb().prepare(`UPDATE accounts SET name = COALESCE(?, name), is_active = COALESCE(?, is_active), updated_at = datetime('now') WHERE id = ?`)
    .run(optStr(body.name, 120), body.is_active === undefined ? null : (body.is_active ? 1 : 0), id);
  audit.log(ctx, { action: 'update', entityType: 'account', entityId: id, entityLabel: before.code, summary: `تعديل الحساب ${before.code}`, oldValues: before });
  return getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

/* ---------------- المستخدمون ---------------- */
function listUsers() {
  return getDb().prepare(`SELECT u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.must_change_password,
      u.last_login_at, u.created_at, r.code AS role_code, r.name AS role_name, u.role_id
    FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`).all();
}
function createUser(body, ctx) {
  const username = reqStr(body.username, 'اسم المستخدم', 60).toLowerCase();
  if (!/^[a-z0-9._-]{3,60}$/.test(username)) throw badRequest('اسم المستخدم يجب أن يكون 3-60 حرفًا إنجليزيًا/أرقامًا بدون مسافات');
  if (getDb().prepare('SELECT id FROM users WHERE username = ?').get(username)) throw badRequest('اسم المستخدم مستخدم مسبقًا');
  const password = reqStr(body.password, 'كلمة المرور', 100);
  if (password.length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف');
  const roleId = Number(body.role_id);
  if (!getDb().prepare('SELECT id FROM roles WHERE id = ?').get(roleId)) throw badRequest('الدور غير موجود');
  const id = tx(() => {
    const r = getDb().prepare(`INSERT INTO users (username, full_name, password_hash, role_id, email, phone, is_active, must_change_password)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(username, reqStr(body.full_name, 'الاسم الكامل', 120), hashPassword(password), roleId,
        optStr(body.email, 120), optStr(body.phone, 40), body.is_active === 0 ? 0 : 1, 1);
    audit.log(ctx, { action: 'create', entityType: 'user', entityId: r.lastInsertRowid, entityLabel: username, summary: `إضافة مستخدم ${username}`, newValues: { username, role_id: roleId } });
    return r.lastInsertRowid;
  });
  return getDb().prepare('SELECT id, username, full_name, role_id, is_active FROM users WHERE id = ?').get(id);
}
function updateUser(id, body, ctx) {
  const before = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!before) throw notFound('المستخدم');
  const roleId = body.role_id ? Number(body.role_id) : before.role_id;
  if (!getDb().prepare('SELECT id FROM roles WHERE id = ?').get(roleId)) throw badRequest('الدور غير موجود');
  tx(() => {
    getDb().prepare(`UPDATE users SET full_name = COALESCE(?, full_name), email = ?, phone = ?, role_id = ?,
      is_active = COALESCE(?, is_active), updated_at = datetime('now') WHERE id = ?`)
      .run(optStr(body.full_name, 120), optStr(body.email, 120), optStr(body.phone, 40), roleId,
        body.is_active === undefined ? null : (body.is_active ? 1 : 0), id);
    audit.log(ctx, { action: 'update', entityType: 'user', entityId: id, entityLabel: before.username, summary: `تعديل المستخدم ${before.username}`, oldValues: { role_id: before.role_id, is_active: before.is_active }, newValues: { role_id: roleId } });
  });
  return getDb().prepare('SELECT id, username, full_name, role_id, is_active FROM users WHERE id = ?').get(id);
}
function resetPassword(id, newPassword, ctx) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw notFound('المستخدم');
  if (String(newPassword || '').length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف');
  tx(() => {
    getDb().prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?`)
      .run(hashPassword(newPassword), id);
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit.log(ctx, { action: 'reset_password', entityType: 'user', entityId: id, entityLabel: user.username, summary: `إعادة تعيين كلمة مرور ${user.username}` });
  });
  return { ok: true };
}
function changeOwnPassword(userId, oldPassword, newPassword, ctx) {
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw notFound('المستخدم');
  const { verifyPassword } = require('../middleware/auth');
  if (!verifyPassword(oldPassword || '', user.password_hash)) throw badRequest('كلمة المرور الحالية غير صحيحة');
  if (String(newPassword || '').length < 8) throw badRequest('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
  getDb().prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(hashPassword(newPassword), userId);
  audit.log(ctx, { action: 'reset_password', entityType: 'user', entityId: userId, entityLabel: user.username, summary: 'تغيير كلمة المرور الخاصة' });
  return { ok: true };
}

/* ---------------- الأدوار والصلاحيات ---------------- */
function listRoles() {
  const roles = getDb().prepare('SELECT * FROM roles ORDER BY id').all();
  const stmt = getDb().prepare(`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`);
  return roles.map(r => ({ ...r, permissions: stmt.all(r.id).map(x => x.code) }));
}
function listPermissions() {
  return getDb().prepare('SELECT * FROM permissions ORDER BY module, action').all();
}
function updateRolePermissions(roleId, codes, ctx) {
  const role = getDb().prepare('SELECT * FROM roles WHERE id = ?').get(roleId);
  if (!role) throw notFound('الدور');
  const valid = new Set(getDb().prepare('SELECT code FROM permissions').all().map(r => r.code));
  const list = (codes || []).filter(c => valid.has(c));
  tx(() => {
    const db = getDb();
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const stmt = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, (SELECT id FROM permissions WHERE code = ?))');
    for (const c of list) stmt.run(roleId, c);
    audit.log(ctx, { action: 'update', entityType: 'role', entityId: roleId, entityLabel: role.name, summary: `تحديث صلاحيات الدور ${role.name}`, newValues: { permissions: list } });
  });
  return listRoles().find(r => r.id === roleId);
}

/* ---------------- الإعدادات ---------------- */
function listSettings() {
  const rows = getDb().prepare('SELECT * FROM settings ORDER BY key').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
function updateSettings(values, ctx) {
  tx(() => {
    const db = getDb();
    for (const [k, v] of Object.entries(values)) {
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(k, v === null ? null : String(v));
    }
    audit.log(ctx, { action: 'update', entityType: 'settings', entityId: null, entityLabel: 'إعدادات النظام', summary: 'تعديل إعدادات النظام', newValues: values });
  });
  return listSettings();
}

/* ---------------- سجل العمليات ---------------- */
function listAudit(filters = {}, paging = {}) {
  const qb = new QueryBuilder(`SELECT al.*, u.full_name FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id`,
    { orderSql: 'ORDER BY al.created_at DESC, al.id DESC' });
  qb.like('al.summary', filters.search).like('al.entity_label', filters.search).like('al.username', filters.search);
  qb.eq('al.action', filters.action);
  qb.eq('al.entity_type', filters.entity_type);
  qb.eqRaw('al.user_id', filters.user_id);
  qb.between('al.created_at', filters.date_from, filters.date_to);
  return paginate(qb, { allowedSorts: ['al.created_at', 'al.action', 'al.entity_type'], ...paging });
}

function getAuditTrail(entityType, entityId) {
  return getDb().prepare('SELECT * FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC, id DESC')
    .all(entityType, Number(entityId));
}

/** حذف السجلات القديمة — يتطلب صلاحية audit_logs.purge */
function purgeAudit(beforeDate, ctx) {
  if (!beforeDate) throw badRequest('يجب تحديد التاريخ');
  const count = getDb().prepare('SELECT COUNT(*) c FROM audit_logs WHERE date(created_at) < date(?)').get(beforeDate).c;
  getDb().prepare('DELETE FROM audit_logs WHERE date(created_at) < date(?)').run(beforeDate);
  audit.log(ctx, { action: 'purge', entityType: 'audit_logs', entityId: null, entityLabel: beforeDate, summary: `حذف ${count} سجل قبل ${beforeDate}` });
  return { deleted: count };
}

module.exports = {
  listProjects, createProject, updateProject,
  listCostCenters, createCostCenter, updateCostCenter,
  listAccounts, createAccount, updateAccount,
  listUsers, createUser, updateUser, resetPassword, changeOwnPassword,
  listRoles, listPermissions, updateRolePermissions,
  listSettings, updateSettings,
  listAudit, getAuditTrail, purgeAudit, catalog
};
