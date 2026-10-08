'use strict';
/**
 * اختبارات النظام — سيناريوهات واقعية عبر طبقة الخدمات نفسها
 * تُنفَّذ على قاعدة بيانات مؤقتة تُحذف بعد الاختبار.
 *
 * التشغيل: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

/* قاعدة بيانات مؤقتة معزولة */
const TMP_DB = path.join(os.tmpdir(), `oyaynah-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = 'test-secret';

const { migrate, getDb, close } = require('../server/db');
const bootstrap = require('../server/bootstrap');

let parties, transfers, advances, settlements, invoices, funding, admin, reconciliation, reports, dashboard, auditSvc;
let ctxAdmin, ctxAccountant, ctxViewer;
const D = (m, d) => `${new Date().getFullYear()}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function ctxFor(roleCode, perms) {
  const db = getDb();
  const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(roleCode);
  let u = db.prepare(`SELECT u.id, u.username FROM users u WHERE u.role_id = ?`).get(role.id);
  if (!u) {
    // إنشاء مستخدم اختباري لهذا الدور
    const bcrypt = require('bcryptjs');
    const r = db.prepare(`INSERT INTO users (username, full_name, password_hash, role_id, is_active) VALUES (?,?,?,?,1)`)
      .run(`test_${roleCode}`, `مستخدم اختبار - ${roleCode}`, bcrypt.hashSync('Test@12345', 8), role.id);
    u = { id: r.lastInsertRowid, username: `test_${roleCode}` };
  }
  return {
    user: { id: u.id, username: u.username, fullName: roleCode, roleCode, permissions: new Set(perms) },
    ip: '127.0.0.1', userAgent: 'test', body: {}, params: {}, query: {}, headers: {}, socket: { remoteAddress: '127.0.0.1' }
  };
}

test.before(async () => {
  migrate();
  bootstrap.run();
  parties = require('../server/services/parties.service');
  transfers = require('../server/services/transfers.service');
  advances = require('../server/services/advances.service');
  settlements = require('../server/services/settlements.service');
  invoices = require('../server/services/invoices.service');
  funding = require('../server/services/funding.service');
  admin = require('../server/services/admin.service');
  reconciliation = require('../server/services/reconciliation.service');
  reports = require('../server/services/reports.service');
  dashboard = require('../server/services/dashboard.service');
  auditSvc = require('../server/services/audit.service');

  const allPerms = Object.keys(require('../server/utils/permissions').PERMISSIONS);
  ctxAdmin = ctxFor('admin', allPerms);
  const accPerms = require('../server/utils/permissions').ROLES.find(r => r.code === 'accountant').permissions;
  ctxAccountant = ctxFor('accountant', accPerms);
  const viewerPerms = require('../server/utils/permissions').ROLES.find(r => r.code === 'viewer').permissions;
  ctxViewer = ctxFor('viewer', viewerPerms);
});

test.after(() => {
  try { close(); } catch { /* ignore */ }
  for (const s of ['', '-journal', '-wal', '-shm']) {
    try { if (fs.existsSync(TMP_DB + s)) fs.unlinkSync(TMP_DB + s); } catch { /* ignore */ }
  }
});

/* ═══════════════ 1) التهيئة المرجعية ═══════════════ */
test('التهيئة: مصادر التمويل والمشروع والأدوار موجودة بدون أي بيانات تشغيلية', () => {
  const db = getDb();
  const fs_ = db.prepare('SELECT name FROM funding_sources ORDER BY id').all().map(r => r.name);
  assert.deepEqual(fs_, ['جاري الشريك', 'أوتك', 'النقليات']);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM projects').get().c, 1);
  assert.equal(db.prepare('SELECT name FROM projects').get().name, 'أرض العيينة');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM roles').get().c, 4);
  // لا بيانات وهمية
  assert.equal(db.prepare('SELECT COUNT(*) c FROM transfers').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM advances').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM supplier_invoices').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM contractors').get().c, 0);
});

/* ═══════════════ 2) السيناريو الأول ═══════════════ */
test('سيناريو 1: تحويل 50,000 من جاري الشريك → عهدة → إخلاء 20,000 → إخلاء 15,000 → المتبقي 15,000', () => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  const cc = db.prepare('SELECT id FROM cost_centers WHERE is_main = 1').get();
  const srcPartner = db.prepare(`SELECT id FROM funding_sources WHERE code='PARTNER'`).get();
  const srcOtk = db.prepare(`SELECT id FROM funding_sources WHERE code='OTK'`).get();

  const c1 = parties.createContractor({ code: 'T-C01', name: 'مقاول الاختبار الأول', specialty: 'مدني' }, ctxAdmin);

  // 1) التحويل
  const t1 = transfers.create({
    transfer_date: D(1, 5), amount: 50000, funding_source_id: srcPartner.id, project_id: project.id,
    cost_center_id: cc.id, transfer_type: 'advance', beneficiary_type: 'contractor',
    contractor_id: c1.id, purpose: 'تمويل عهدة', bank_ref: 'BNK-001', auto_approve: true
  }, ctxAdmin);
  assert.equal(t1.amount, 50000);
  assert.equal(t1.approval_status, 'approved');
  assert.ok(t1.approved_by, 'يجب تسجيل المعتمِد');

  // 2) العهدة
  const a1 = advances.create({
    advance_date: D(1, 5), contractor_id: c1.id, project_id: project.id, cost_center_id: cc.id,
    funding_source_id: srcPartner.id, transfer_id: t1.id, amount: 50000,
    description: 'عهدة أعمال مدنية', auto_approve: true
  }, ctxAdmin);
  assert.equal(a1.amount, 50000);
  assert.equal(a1.remaining_balance, 50000);
  assert.equal(a1.computed_status, 'open');
  assert.equal(a1.transfer_no, t1.transfer_no);

  // الربط العكسي
  const tAfter = transfers.getById(t1.id);
  assert.equal(tAfter.advance_id, a1.id, 'يجب ربط التحويل بالعهدة في الاتجاهين');

  // 3) إخلاء 20,000
  settlements.create({
    advance_id: a1.id, settlement_date: D(2, 10), invoice_no: 'INV-1001', description: 'أعمال حفر',
    net_amount: 20000, vat_amount: 0, auto_approve: true
  }, ctxAdmin);
  assert.equal(advances.getBalance(a1.id).remaining, 30000);

  // 4) إخلاء 15,000
  settlements.create({
    advance_id: a1.id, settlement_date: D(3, 12), invoice_no: 'INV-1002', description: 'أعمال أساسات',
    net_amount: 15000, vat_amount: 0, auto_approve: true
  }, ctxAdmin);

  const bal = advances.getBalance(a1.id);
  assert.equal(bal.amount, 50000);
  assert.equal(bal.settled_total, 35000);
  assert.equal(bal.remaining, 15000, 'الرصيد المتبقي يجب أن يكون 15,000');
  assert.equal(advances.getById(a1.id).computed_status, 'partially_closed');

  // القيد المحاسبي متوازن
  const j = db.prepare(`SELECT ROUND(SUM(debit),2) d, ROUND(SUM(credit),2) c FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id WHERE je.is_void = 0`).get();
  assert.equal(j.d, j.c, 'دفتر الأستاذ يجب أن يكون متوازنًا');
  assert.ok(j.d >= 85000, 'يجب أن تحتوي القيود على التحويل والإخلاءات');

  // 5) إغلاق العهدة برصيد غير مسوَّى يتطلب تأكيدًا
  assert.throws(() => advances.close(a1.id, ctxAdmin, { confirm: false }),
    (e) => e.code === 'UNSETTLED_BALANCE', 'يجب رفض الإغلاق بدون تأكيد عند وجود رصيد');
  // الإغلاق بتأكيد من مستخدم لا يملك صلاحية advances.close
  const noPermCtx = { ...ctxAdmin, user: { ...ctxAdmin.user, permissions: new Set(['advances.view']) } };
  assert.throws(() => advances.close(a1.id, noPermCtx, { confirm: true }),
    (e) => e.status === 403 && e.code === 'FORBIDDEN', 'بدون صلاحية إغلاق يجب الرفض بـ 403');
  // المحاسب يملك صلاحية الإغلاق (حسب مصفوفة الصلاحيات) فينجح معه التأكيد
  assert.equal(ctxAccountant.user.permissions.has('advances.close'), true);
  const closed = advances.close(a1.id, ctxAdmin, { confirm: true, reason: 'تسوية نهائية' });
  assert.equal(closed.status, 'closed');
  assert.equal(advances.getById(a1.id).remaining_balance, 15000, 'الإغلاق لا يغيّر الرصيد');

  module.exports.__a1 = a1;
});

/* ═══════════════ 3) السيناريو الثاني ═══════════════ */
test('سيناريو 2: تحويل من أوتك → مورد → فاتورة → دفعة جزئية → رصيد متبقٍ', () => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  const cc = db.prepare('SELECT id FROM cost_centers WHERE is_main = 1').get();
  const otk = db.prepare(`SELECT id FROM funding_sources WHERE code='OTK'`).get();
  const sup = parties.createSupplier({ code: 'T-S01', name: 'مورد الاختبار', category: 'مواد', payment_terms_days: 30 }, ctxAdmin);

  const t = transfers.create({
    transfer_date: D(3, 1), amount: 20000, funding_source_id: otk.id, project_id: project.id,
    cost_center_id: cc.id, transfer_type: 'supplier', beneficiary_type: 'supplier',
    supplier_id: sup.id, purpose: 'دفعة على فاتورة', bank_ref: 'BNK-002', auto_approve: true
  }, ctxAdmin);

  const inv = invoices.createInvoice({
    supplier_id: sup.id, invoice_no: 'SUP-5001', invoice_date: D(2, 20), due_date: D(3, 22),
    description: 'توريد مواد', project_id: project.id, cost_center_id: cc.id,
    net_amount: 30000, vat_amount: 4500, auto_approve: true
  }, ctxAdmin);
  assert.equal(inv.total_amount, 34500);
  assert.equal(inv.remaining_total, 34500);
  assert.equal(inv.status, 'unpaid');

  invoices.createPayment({
    payment_date: D(3, 1), amount: 20000, transfer_id: t.id, supplier_invoice_id: inv.id,
    supplier_id: sup.id, payment_type: 'supplier_invoice', project_id: project.id
  }, ctxAdmin);

  const after = invoices.getInvoice(inv.id);
  assert.equal(after.paid_total, 20000);
  assert.equal(after.remaining_total, 14500);
  assert.equal(after.status, 'partial');

  // منع الدفع أكثر من المتبقي
  assert.throws(() => invoices.createPayment({
    payment_date: D(3, 2), amount: 20000, transfer_id: t.id, supplier_invoice_id: inv.id,
    supplier_id: sup.id, payment_type: 'supplier_invoice', project_id: project.id
  }, ctxAdmin), (e) => e.code === 'OVERPAYMENT');
});

/* ═══════════════ 4) منع الازدواجية ═══════════════ */
test('منع الازدواجية: رقم التحويل، المرجع البنكي، رقم الفاتورة لنفس المورد، فاتورة الإخلاء لنفس العهدة', () => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  const cc = db.prepare('SELECT id FROM cost_centers WHERE is_main = 1').get();
  const partner = db.prepare(`SELECT id FROM funding_sources WHERE code='PARTNER'`).get();
  const c = parties.createContractor({ code: 'T-C02', name: 'مقاول اختبار الازدواجية' }, ctxAdmin);
  const sup = parties.createSupplier({ code: 'T-S02', name: 'مورد اختبار الازدواجية' }, ctxAdmin);

  // رقم تحويل مكرر
  transfers.create({ transfer_date: D(4, 1), amount: 1000, funding_source_id: partner.id, project_id: project.id,
    transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'جهة أخرى', transfer_no: 'MANUAL-1' }, ctxAdmin);
  assert.throws(() => transfers.create({ transfer_date: D(4, 2), amount: 2000, funding_source_id: partner.id,
    project_id: project.id, transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'جهة أخرى',
    transfer_no: 'MANUAL-1' }, ctxAdmin), /مستخدم مسبقًا/);

  // مرجع بنكي مكرر
  assert.throws(() => transfers.create({ transfer_date: D(4, 3), amount: 3000, funding_source_id: partner.id,
    project_id: project.id, transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'جهة أخرى',
    bank_ref: 'BNK-001' }, ctxAdmin), /المرجع البنكي/);

  // تحويل مطابق (نفس المصدر/المبلغ/التاريخ/المستفيد)
  transfers.create({ transfer_date: D(5, 1), amount: 7777, funding_source_id: partner.id, project_id: project.id,
    transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'مستفيد متطابق' }, ctxAdmin);
  const dupErr = (() => { try {
    transfers.create({ transfer_date: D(5, 1), amount: 7777, funding_source_id: partner.id, project_id: project.id,
      transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'مستفيد متطابق' }, ctxAdmin);
    return null; } catch (e) { return e; } })();
  assert.ok(dupErr && dupErr.code === 'DUPLICATE_TRANSFER', 'يجب كشف التحويل المطابق');
  assert.ok(dupErr.details.duplicates.length >= 1);
  // مع التأكيد يُقبل
  const ok = transfers.create({ transfer_date: D(5, 1), amount: 7777, funding_source_id: partner.id, project_id: project.id,
    transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'مستفيد متطابق', allow_duplicate: true }, ctxAdmin);
  assert.ok(ok.id);

  // فاتورة مورد مكررة لنفس المورد
  invoices.createInvoice({ supplier_id: sup.id, invoice_no: 'DUP-1', invoice_date: D(4, 1), description: 'فاتورة',
    project_id: project.id, net_amount: 100, vat_amount: 15 }, ctxAdmin);
  assert.throws(() => invoices.createInvoice({ supplier_id: sup.id, invoice_no: 'DUP-1', invoice_date: D(4, 5),
    description: 'فاتورة مكررة', project_id: project.id, net_amount: 200, vat_amount: 30 }, ctxAdmin), /مسجَّلة مسبقًا/);

  // نفس رقم الفاتورة لمورد مختلف = مسموح
  const other = parties.createSupplier({ code: 'T-S03', name: 'مورد آخر للاختبار' }, ctxAdmin);
  const okInv = invoices.createInvoice({ supplier_id: other.id, invoice_no: 'DUP-1', invoice_date: D(4, 5),
    description: 'فاتورة لمورد آخر', project_id: project.id, net_amount: 50, vat_amount: 7.5 }, ctxAdmin);
  assert.ok(okInv.id);

  // فاتورة إخلاء مكررة على نفس العهدة
  const t = transfers.create({ transfer_date: D(6, 1), amount: 5000, funding_source_id: partner.id, project_id: project.id,
    cost_center_id: cc.id, transfer_type: 'advance', beneficiary_type: 'contractor', contractor_id: c.id }, ctxAdmin);
  const a = advances.create({ advance_date: D(6, 1), contractor_id: c.id, project_id: project.id,
    funding_source_id: partner.id, transfer_id: t.id, amount: 5000, description: 'عهدة اختبار', auto_approve: true }, ctxAdmin);
  settlements.create({ advance_id: a.id, settlement_date: D(6, 5), invoice_no: 'S-1', description: 'إخلاء',
    net_amount: 1000, vat_amount: 0 }, ctxAdmin);
  assert.throws(() => settlements.create({ advance_id: a.id, settlement_date: D(6, 6), invoice_no: 'S-1',
    description: 'إخلاء مكرر', net_amount: 1500, vat_amount: 0 }, ctxAdmin), /مسجَّل مسبقًا/);
});

/* ═══════════════ 5) تجاوز رصيد العهدة ═══════════════ */
test('لا يُسمح بإخلاء يتجاوز رصيد العهدة إلا بصلاحية خاصة وتأكيد صريح', () => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  const partner = db.prepare(`SELECT id FROM funding_sources WHERE code='PARTNER'`).get();
  const c = parties.createContractor({ code: 'T-C03', name: 'مقاول اختبار التجاوز' }, ctxAdmin);
  const a = advances.create({ advance_date: D(7, 1), contractor_id: c.id, project_id: project.id,
    funding_source_id: partner.id, amount: 10000, description: 'عهدة اختبار التجاوز', auto_approve: true }, ctxAdmin);

  // بدون تأكيد
  const e1 = (() => { try {
    settlements.create({ advance_id: a.id, settlement_date: D(7, 2), invoice_no: 'OVER-1', description: 'تجاوز',
      net_amount: 12000, vat_amount: 0 }, ctxAdmin);
    return null; } catch (e) { return e; } })();
  assert.ok(e1 && e1.code === 'OVER_SETTLEMENT');
  assert.equal(e1.details.available, 10000);
  assert.equal(e1.details.excess, 2000);

  // تأكيد بدون صلاحية (المحاسب)
  const e2 = (() => { try {
    settlements.create({ advance_id: a.id, settlement_date: D(7, 2), invoice_no: 'OVER-1', description: 'تجاوز',
      net_amount: 12000, vat_amount: 0, allow_over_settlement: true }, ctxAccountant);
    return null; } catch (e) { return e; } })();
  assert.ok(e2 && e2.status === 403);

  // تأكيد مع الصلاحية (المراجع)
  const s = settlements.create({ advance_id: a.id, settlement_date: D(7, 2), invoice_no: 'OVER-1', description: 'تجاوز',
    net_amount: 12000, vat_amount: 0, allow_over_settlement: true, auto_approve: true }, ctxAdmin);
  assert.equal(s.over_settlement, 1);
  assert.equal(advances.getBalance(a.id).remaining, -2000);
  const found = reconciliation.run({}).items.filter(i => i.check === 'over_advanced');
  assert.ok(found.length >= 1, 'يجب أن يظهر التجاوز في تقرير المطابقة');
  // تسجيل التجاوز في سجل العمليات
  const logged = getDb().prepare(`SELECT COUNT(*) c FROM audit_logs WHERE action='over_settle'`).get().c;
  assert.ok(logged >= 1, 'يجب تسجيل الموافقة على التجاوز في سجل العمليات');
});

/* ═══════════════ 6) الضوابط المحاسبية ═══════════════ */
test('الضوابط: إلزام مصدر التمويل والمشروع، ومنع اعتماد عملية ناقصة البيانات', () => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  const c = parties.createContractor({ code: 'T-C04', name: 'مقاول اختبار الضوابط' }, ctxAdmin);

  // مصدر التمويل إلزامي
  assert.throws(() => transfers.create({ transfer_date: D(8, 1), amount: 100, project_id: project.id,
    transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'س' }, ctxAdmin), /مصدر التمويل/);
  // المشروع إلزامي
  const partner = db.prepare(`SELECT id FROM funding_sources WHERE code='PARTNER'`).get();
  assert.throws(() => transfers.create({ transfer_date: D(8, 1), amount: 100, funding_source_id: partner.id,
    transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'س' }, ctxAdmin), /المشروع/);
  // المبلغ إلزامي وموجب
  assert.throws(() => transfers.create({ transfer_date: D(8, 1), amount: 0, funding_source_id: partner.id,
    project_id: project.id, transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'س' }, ctxAdmin), /المبلغ/);

  // عهدة ناقصة لا تُعتمد
  const a = advances.create({ advance_date: D(8, 2), contractor_id: c.id, project_id: project.id,
    funding_source_id: partner.id, amount: 1000, description: 'عهد' }, ctxAdmin);
  assert.equal(a.approval_status, 'draft');
  // إفراغ البيان ثم محاولة الاعتماد
  getDb().prepare("UPDATE advances SET description = '' WHERE id = ?").run(a.id);
  assert.throws(() => advances.approve(a.id, ctxAdmin), /بيانات ناقصة/);
});

test('الإلغاء بدل الحذف النهائي + سجل العمليات يحتفظ بالبيانات القديمة والجديدة', () => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  const partner = db.prepare(`SELECT id FROM funding_sources WHERE code='PARTNER'`).get();
  const t = transfers.create({ transfer_date: D(9, 1), amount: 4321, funding_source_id: partner.id,
    project_id: project.id, transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'جهة للإلغاء' }, ctxAdmin);

  assert.throws(() => transfers.voidTransfer(t.id, ctxAdmin, ''), /سبب الإلغاء/);
  transfers.voidTransfer(t.id, ctxAdmin, 'أُدخل بالخطأ');
  const after = transfers.getById(t.id);
  assert.equal(after.is_void, 1);
  assert.equal(after.void_reason, 'أُدخل بالخطأ');
  // يبقى السجل في قاعدة البيانات (لا حذف نهائي)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM transfers WHERE id = ?').get(t.id).c, 1);
  // لا يدخل في الإجماليات
  const total = reports.run('transfers', {}).rows.reduce((s, r) => s + Number(r.amount), 0);
  assert.ok(!reports.run('transfers', {}).rows.some(r => r.transfer_no === t.transfer_no), 'الملغى لا يظهر في التقرير');

  const log = db.prepare(`SELECT * FROM audit_logs WHERE entity_type='transfer' AND entity_id=? ORDER BY id DESC`).get(t.id);
  assert.equal(log.action, 'void');
  assert.ok(log.old_values && JSON.parse(log.old_values).transfer_no === t.transfer_no, 'يجب حفظ البيانات القديمة');
});

test('سجل العمليات يسجّل الإضافة والتعديل والاعتماد', () => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  const partner = db.prepare(`SELECT id FROM funding_sources WHERE code='PARTNER'`).get();
  const c = parties.createContractor({ code: 'T-C05', name: 'مقاول اختبار السجل' }, ctxAdmin);
  const a = advances.create({ advance_date: D(10, 1), contractor_id: c.id, project_id: project.id,
    funding_source_id: partner.id, amount: 2000, description: 'عهد السجل' }, ctxAdmin);
  advances.update(a.id, { description: 'عهد السجل - معدل' }, ctxAdmin);
  advances.approve(a.id, ctxAdmin);
  const actions = db.prepare(`SELECT action FROM audit_logs WHERE entity_type='advance' AND entity_id=? ORDER BY id`).all(a.id).map(r => r.action);
  assert.deepEqual(actions, ['create', 'update', 'approve']);
  const upd = db.prepare(`SELECT * FROM audit_logs WHERE entity_type='advance' AND entity_id=? AND action='update'`).get(a.id);
  assert.ok(upd.old_values && upd.new_values);
});

/* ═══════════════ 7) المطابقة والتقارير ═══════════════ */
test('تقرير المطابقة يكشف: تحويل بدون عهدة، عهدة بدون تحويل، عهدة برصيد غير مسوَّى', () => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  const partner = db.prepare(`SELECT id FROM funding_sources WHERE code='PARTNER'`).get();
  const c = parties.createContractor({ code: 'T-C06', name: 'مقاول اختبار المطابقة' }, ctxAdmin);

  // تحويل عهدة بدون ربط
  transfers.create({ transfer_date: D(11, 1), amount: 6000, funding_source_id: partner.id, project_id: project.id,
    transfer_type: 'advance', beneficiary_type: 'contractor', contractor_id: c.id, auto_approve: true }, ctxAdmin);
  // عهدة بدون تحويل
  advances.create({ advance_date: D(11, 2), contractor_id: c.id, project_id: project.id,
    funding_source_id: partner.id, amount: 4000, description: 'عهدة بلا تحويل', auto_approve: true }, ctxAdmin);

  const res = reconciliation.run({});
  const keys = new Set(res.items.map(i => i.check));
  assert.ok(keys.has('transfer_without_advance'), 'يجب كشف تحويل بدون عهدة');
  assert.ok(keys.has('advance_without_transfer'), 'يجب كشف عهدة بدون تحويل');
  assert.ok(keys.has('unsettled_advance'), 'يجب كشف عهدة برصيد غير مسوَّى');
  assert.ok(res.total_issues > 0);
});

test('التقارير: تقرير المقاولين وتقرير مصادر التمويل يعكسان العمليات بدقة', () => {
  const rep = reports.run('contractors', {});
  assert.ok(rep.rows.length >= 6);
  const t0 = reports.run('contractors', {}).rows
    .find(r => r.code === 'T-C01');
  assert.equal(t0.total_advances, 50000);
  assert.equal(t0.total_settled, 35000);
  assert.equal(t0.remaining_balance, 15000);

  const f = reports.run('funding_sources', {});
  const partner = f.rows.find(r => r.code === 'PARTNER');
  assert.ok(partner.total_transfers >= 50000);

  const bal = reports.run('balances', {});
  assert.equal(bal.totals.debit, bal.totals.credit, 'ميزان المراجعة يجب أن يكون متوازنًا');
});

test('لوحة التحكم تجيب على الأسئلة المطلوبة', () => {
  const o = dashboard.overview({});
  const k = o.kpis;
  // كم تم تحويله للمشروع؟
  assert.ok(k.transfers.total > 0);
  // من أي مصدر؟
  const names = o.funding_sources.map(f => f.name);
  assert.ok(names.includes('جاري الشريك') && names.includes('أوتك') && names.includes('النقليات'));
  const partner = o.funding_sources.find(f => f.name === 'جاري الشريك');
  assert.ok(partner.total_transfers >= 50000);
  // كم إجمالي العهد وكم تم إخلاؤه وكم رصيد المفتوحة؟
  assert.ok(k.advances.total > 0 && k.settlements.total > 0);
  assert.equal(k.advances.total - k.settlements.total, k.remaining_advances_balance);
  // كم دُفع للموردين وكم المتبقي؟
  assert.ok(k.suppliers.paid >= 20000);
  assert.ok(k.suppliers.due >= 14500);
});

/* ═══════════════ 8) الصلاحيات ═══════════════ */
test('الصلاحيات: المطلع لا يستطيع الاعتماد، والمحاسب لا يتجاوز الرصيد', () => {
  const db = getDb();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get();
  const partner = db.prepare(`SELECT id FROM funding_sources WHERE code='PARTNER'`).get();
  const c = parties.createContractor({ code: 'T-C07', name: 'مقاول اختبار الصلاحيات' }, ctxAdmin);
  const t = transfers.create({ transfer_date: D(12, 1), amount: 900, funding_source_id: partner.id,
    project_id: project.id, transfer_type: 'other', beneficiary_type: 'other', beneficiary_name: 'جهة' }, ctxAdmin);

  // المطلع ليس لديه صلاحية اعتماد (يُختبر على مستوى مجموعة الصلاحيات)
  assert.equal(ctxViewer.user.permissions.has('transfers.approve'), false);
  assert.equal(ctxViewer.user.permissions.has('transfers.view'), true);
  assert.equal(ctxAccountant.user.permissions.has('transfers.create'), true);
  assert.equal(ctxAccountant.user.permissions.has('transfers.approve'), false);
  assert.equal(ctxAccountant.user.permissions.has('settlements.over_settle'), false);
  const reviewer = require('../server/utils/permissions').ROLES.find(r => r.code === 'reviewer');
  assert.ok(reviewer.permissions.includes('settlements.over_settle'));
  assert.ok(reviewer.permissions.includes('transfers.approve'));
  // مدير النظام يملك كل الصلاحيات
  const adminRole = require('../server/utils/permissions').ROLES.find(r => r.code === 'admin');
  assert.equal(adminRole.permissions.length, Object.keys(require('../server/utils/permissions').PERMISSIONS).length);
});

/* ═══════════════ 9) التصدير ═══════════════ */
test('كل التقارير تعمل مع وبدون الفلاتر (حماية من عدم تطابق الوسائط)', () => {
  const full = {
    project_id: 1, from: D(1, 1), to: D(12, 31), date_from: D(1, 1), date_to: D(12, 31),
    search: 'T-', contractor_id: 1, supplier_id: 1, funding_source_id: 1,
    status: 'open', approval_status: 'approved', review_status: 'pending', overdue_only: '1', over_only: '1'
  };
  for (const def of reports.listReports()) {
    for (const filters of [{}, full]) {
      const r = reports.run(def.key, filters);
      assert.ok(Array.isArray(r.rows), `${def.key} يجب أن يُعيد rows`);
      assert.ok(Array.isArray(r.columns), `${def.key} يجب أن يُعيد columns`);
      assert.equal(typeof r.row_count, 'number');
      // كل صف يجب أن يملك كل الأعمدة المعرَّفة
      for (const row of r.rows) {
        for (const col of r.columns) assert.ok(col.key in row, `${def.key}: العمود ${col.key} ناقص في الصف`);
      }
      // الإجماليات لا تتجاوز حدود المعقول
      for (const k of (r.totalKeys || [])) assert.ok(Number.isFinite(r.totals[k]), `${def.key}: إجمالي ${k} غير رقمي`);
    }
  }
});

test('التصدير: CSV يحتوي الأعمدة والإجمالي، و XLSX يُنتج ملفًا صالحًا', async () => {
  const exporter = require('../server/services/export.service');
  const rep = reports.run('advances', {});
  const csv = exporter.toCSV(rep);
  assert.ok(csv.startsWith('\uFEFF'), 'يجب أن يبدأ بـ BOM لدعم العربية في Excel');
  assert.ok(csv.includes('رقم العهدة'));
  assert.ok(csv.includes('الإجمالي'));
  const buf = await exporter.toXLSX(rep, { projectName: 'أرض العيينة' });
  assert.ok(buf.byteLength > 2000, 'ملف Excel يجب ألا يكون فارغًا');
  // توقيع ملف ZIP (XLSX هو ZIP)
  assert.equal(buf[0], 0x50); assert.equal(buf[1], 0x4b);
});

test('التصدير: مصنف يجمع كل التقارير في ملف واحد مع ورقة غلاف', async () => {
  const exporter = require('../server/services/export.service');
  const list = reports.listReports().map(r => ({ report: reports.run(r.key, {}) }));
  assert.ok(list.length >= 11, 'يجب أن يتوفر 11 تقريرًا على الأقل');
  const buf = await exporter.toWorkbookXLSX(list, {
    projectName: 'أرض العيينة', environment: 'demo'
  });
  assert.equal(buf[0], 0x50); assert.equal(buf[1], 0x4b, 'توقيع ZIP');
  assert.ok(buf.byteLength > 10000, 'المصنف يجب أن يحتوي كل التقارير');
  // كل تقرير أخذ اسم ورقة صالحًا (≤31 حرفًا)
  for (const it of list) {
    assert.ok(it.sheetName && it.sheetName.length <= 31, `اسم الورقة ${it.sheetName} طويل`);
    assert.ok(!/[\[\]:*?/\\]/.test(it.sheetName), `اسم الورقة ${it.sheetName} يحتوي رموزًا ممنوعة`);
  }
  // لا تكرار في أسماء الأوراق
  assert.equal(new Set(list.map(i => i.sheetName)).size, list.length, 'أسماء الأوراق يجب أن تكون فريدة');
});
