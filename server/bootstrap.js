'use strict';
/**
 * التهيئة الأولية (Reference Data فقط)
 *
 * ⚠ لا يتم إنشاء أي بيانات تشغيلية (تحويلات/عهد/فواتير) هنا.
 *   البيانات التجريبية موجودة في بيئة Demo منفصلة تمامًا (server/db/seed/demo.seed.js).
 */
const { getDb } = require('./db');
const catalog = require('./utils/permissions');
const { hashPassword } = require('./middleware/auth');
const config = require('./config');
const ledger = require('./services/ledger.service');

function upsertRolesAndPermissions() {
  const db = getDb();
  const permStmt = db.prepare('SELECT id FROM permissions WHERE code = ?');
  const insPerm = db.prepare('INSERT INTO permissions (code, module, action, name, description) VALUES (?,?,?,?,?)');
  for (const [code, [mod, action, name, desc]] of Object.entries(catalog.PERMISSIONS)) {
    if (!permStmt.get(code)) insPerm.run(code, mod, action, name, desc || null);
  }
  const roleStmt = db.prepare('SELECT id FROM roles WHERE code = ?');
  const insRole = db.prepare('INSERT INTO roles (code, name, description, is_system) VALUES (?,?,?,?)');
  for (const role of catalog.ROLES) {
    let r = roleStmt.get(role.code);
    if (!r) {
      const res = insRole.run(role.code, role.name, role.description, role.is_system);
      r = { id: res.lastInsertRowid };
    }
    // مزامنة صلاحيات الأدوار النظامية
    if (role.is_system) {
      const existing = new Set(db.prepare('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?').all(r.id).map(x => x.code));
      const link = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, (SELECT id FROM permissions WHERE code = ?))');
      for (const code of role.permissions) if (!existing.has(code)) link.run(r.id, code);
    }
  }
}

function upsertChartOfAccounts() {
  const db = getDb();
  const tree = [
    ['1000', 'الأصول', 'asset', null, 'debit'],
    ['1100', 'النقدية والبنوك', 'asset', '1000', 'debit'],
    ['1200', 'عهدي المقاولين', 'asset', '1000', 'debit'],
    ['1300', 'دفعات مقدمة للموردين', 'asset', '1000', 'debit'],
    ['1400', 'ضريبة القيمة المضافة - المدخلات', 'asset', '1000', 'debit'],
    ['2000', 'الالتزامات', 'liability', null, 'credit'],
    ['2100', 'جاري الشركاء', 'liability', '2000', 'credit'],
    ['2200', 'حسابات الموردين', 'liability', '2000', 'credit'],
    ['2300', 'ضريبة القيمة المضافة - المستحقة', 'liability', '2000', 'credit'],
    ['2400', 'أوتك - حساب جاري', 'liability', '2000', 'credit'],
    ['2500', 'النقليات - حساب جاري', 'liability', '2000', 'credit'],
    ['4000', 'المصروفات', 'expense', null, 'debit'],
    ['4100', 'مصاريف المشاريع', 'expense', '4000', 'debit'],
    ['4110', 'مصاريف أعمال مدنية', 'expense', '4100', 'debit'],
    ['4120', 'مصاريف مواد ومعدات', 'expense', '4100', 'debit'],
    ['4130', 'مصاريف خدمات ومقاولات', 'expense', '4100', 'debit']
  ];
  const find = db.prepare('SELECT id FROM accounts WHERE code = ?');
  const ins = db.prepare('INSERT INTO accounts (code, name, type, parent_id, nature, is_system) VALUES (?,?,?,?,?,1)');
  for (const [code, name, type, parentCode, nature] of tree) {
    if (find.get(code)) continue;
    const parentId = parentCode ? find.get(parentCode)?.id ?? null : null;
    ins.run(code, name, type, parentId, nature);
  }
}

/** مصادر التمويل المطلوبة + ربطها بحساباتها المحاسبية (بيانات مرجعية قابلة للتعديل/التوسعة) */
function upsertFundingSources() {
  const db = getDb();
  const acc = (code) => db.prepare('SELECT id FROM accounts WHERE code = ?').get(code)?.id || null;
  const list = [
    { code: 'PARTNER', name: 'جاري الشريك', account: '2100', description: 'تمويل من الحساب الجاري للشريك' },
    { code: 'OTK', name: 'أوتك', account: '2400', description: 'تمويل من أوتك' },
    { code: 'TRANSPORT', name: 'النقليات', account: '2500', description: 'تمويل من النقليات' }
  ];
  const find = db.prepare('SELECT id FROM funding_sources WHERE code = ?');
  const ins = db.prepare('INSERT INTO funding_sources (code, name, account_id, description, is_active) VALUES (?,?,?,?,1)');
  for (const f of list) if (!find.get(f.code)) ins.run(f.code, f.name, acc(f.account), f.description);
}

function ensureProject() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) c FROM projects').get().c;
  if (count > 0) return;
  const r = db.prepare(`INSERT INTO projects (code, name, description, is_default) VALUES (?,?,?,1)`)
    .run('OYAYNAH', 'أرض العيينة', 'المشروع الرئيسي - أرض العيينة');
  db.prepare('INSERT INTO cost_centers (project_id, code, name, is_main) VALUES (?,?,?,1)')
    .run(r.lastInsertRowid, 'OYAYNAH-MAIN', 'أرض العيينة - مركز رئيسي');
}

function ensureAdmin() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (count > 0) return null;
  const adminRole = db.prepare(`SELECT id FROM roles WHERE code = 'admin'`).get();
  db.prepare(`INSERT INTO users (username, full_name, password_hash, role_id, is_active, must_change_password)
              VALUES (?,?,?,?,1,1)`)
    .run(config.admin.username.toLowerCase(), config.admin.fullName, hashPassword(config.admin.password), adminRole.id);
  return config.admin.username;
}

function ensureSettings() {
  const db = getDb();
  const defaults = {
    company_name: 'مشروع أرض العيينة',
    currency: 'SAR',
    currency_label: 'ريال',
    default_vat_rate: '0.15',
    demo_mode: config.isDemo ? '1' : '0',
    fiscal_year_start: `${new Date().getFullYear()}-01-01`
  };
  const ins = db.prepare(`INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`);
  for (const [k, v] of Object.entries(defaults)) ins.run(k, v);
}

function run() {
  const db = getDb();
  db.transaction(() => {
    upsertRolesAndPermissions();
    upsertChartOfAccounts();
    upsertFundingSources();
    ensureProject();
    ensureSettings();
  })();
  const admin = ensureAdmin();
  if (admin) {
    console.log(`[bootstrap] تم إنشاء حساب مدير النظام: ${admin}`);
    console.log(`[bootstrap] كلمة المرور الافتراضية موجودة في .env (ADMIN_PASSWORD) — يجب تغييرها بعد أول دخول.`);
  }
  const counts = {
    roles: db.prepare('SELECT COUNT(*) c FROM roles').get().c,
    permissions: db.prepare('SELECT COUNT(*) c FROM permissions').get().c,
    accounts: db.prepare('SELECT COUNT(*) c FROM accounts').get().c,
    funding_sources: db.prepare('SELECT COUNT(*) c FROM funding_sources').get().c,
    projects: db.prepare('SELECT COUNT(*) c FROM projects').get().c,
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c
  };
  return counts;
}

module.exports = { run, upsertRolesAndPermissions, upsertChartOfAccounts, upsertFundingSources, ensureProject, ensureAdmin };
