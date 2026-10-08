'use strict';
/**
 * ══════════════════════════════════════════════════════════════════
 *  بيئة DEMO — بيانات تجريبية للاختبار فقط
 * ══════════════════════════════════════════════════════════════════
 *  ⚠ هذه البيانات لا تدخل قاعدة البيانات الحقيقية إطلاقًا.
 *    تُزرع فقط في data/demo/oyaynah-demo.db عند تشغيل NODE_ENV=demo
 *    أو عند تنفيذ: npm run seed:demo
 *
 *  الهدف: تجربة النظام بسيناريوهات واقعية:
 *   1) تحويل 50,000 من جاري الشريك → عهدة مقاول → إخلاء 20,000 → إخلاء 15,000 → المتبقي 15,000
 *   2) تحويل من أوتك → مورد → فاتورة → دفعة جزئية → رصيد متبقٍ
 *   3) تحويل من النقليات → مورد → فاتورة مدفوعة بالكامل
 * ══════════════════════════════════════════════════════════════════
 */
const { getDb } = require('../../db');
const catalog = require('../../utils/permissions');

function systemContext() {
  const admin = getDb().prepare(`SELECT u.id, u.username FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'admin' LIMIT 1`).get();
  if (!admin) throw new Error('لم يتم إنشاء حساب مدير النظام');
  return {
    user: {
      id: admin.id, username: admin.username, fullName: 'نظام (Demo)',
      roleCode: 'admin', permissions: new Set(Object.keys(catalog.PERMISSIONS))
    },
    ip: '127.0.0.1', userAgent: 'demo-seed',
    query: {}, body: {}, params: {},
    headers: {}, socket: { remoteAddress: '127.0.0.1' }
  };
}

const DEMO_TAG = '[بيانات تجريبية]';

function seed() {
  const parties = require('../../services/parties.service');
  const transfers = require('../../services/transfers.service');
  const advances = require('../../services/advances.service');
  const settlements = require('../../services/settlements.service');
  const invoices = require('../../services/invoices.service');
  const ctx = systemContext();
  const db = getDb();

  if (db.prepare('SELECT COUNT(*) c FROM contractors').get().c > 0) {
    console.log('[demo] البيانات التجريبية موجودة مسبقًا — لم يتم الإضافة.');
    return { skipped: true };
  }

  const project = db.prepare('SELECT id FROM projects WHERE is_default = 1').get();
  const cc = db.prepare('SELECT id FROM cost_centers WHERE project_id = ? AND is_main = 1').get(project.id);
  const fs = (code) => db.prepare('SELECT id FROM funding_sources WHERE code = ?').get(code).id;
  const acc = (code) => db.prepare('SELECT id FROM accounts WHERE code = ?').get(code)?.id;

  /* ---------- المقاولون ---------- */
  const c1 = parties.createContractor({
    code: 'DEMO-C01', name: 'مؤسسة الأفق للمقاولات العامة (تجريبي)', specialty: 'أعمال مدنية',
    phone: '0500000001', vat_number: '300000000000001', bank_iban: 'SA00 0000 0000 0000 0000 0001'
  }, ctx);
  const c2 = parties.createContractor({
    code: 'DEMO-C02', name: 'شركة البنيان الحديث (تجريبي)', specialty: 'أعمال كهرباء',
    phone: '0500000002', vat_number: '300000000000002'
  }, ctx);
  const c3 = parties.createContractor({
    code: 'DEMO-C03', name: 'مؤسسة الديار للتشطيبات (تجريبي)', specialty: 'تشطيبات',
    phone: '0500000003'
  }, ctx);

  /* ---------- الموردون ---------- */
  const s1 = parties.createSupplier({
    code: 'DEMO-S01', name: 'مصنع الإسمنت الوطني (تجريبي)', category: 'مواد بناء',
    vat_number: '310000000000001', payment_terms_days: 30
  }, ctx);
  const s2 = parties.createSupplier({
    code: 'DEMO-S02', name: 'شركة المعدات الثقيلة (تجريبي)', category: 'معدات',
    vat_number: '310000000000002', payment_terms_days: 15
  }, ctx);

  const y = new Date().getFullYear();
  const d = (m, day) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  /* ══ السيناريو 1: جاري الشريك → عهدة 50,000 → إخلاء 20,000 → إخلاء 15,000 → متبقٍ 15,000 ══ */
  const t1 = transfers.create({
    transfer_date: d(1, 5), amount: 50000, funding_source_id: fs('PARTNER'), project_id: project.id,
    cost_center_id: cc.id, transfer_type: 'advance', beneficiary_type: 'contractor',
    contractor_id: c1.id, purpose: `${DEMO_TAG} تمويل عهدة أعمال مدنية`, bank_ref: 'DEMO-BANK-0001',
    bank_name: 'البنك التجريبي', notes: DEMO_TAG, auto_approve: true
  }, ctx);

  const a1 = advances.create({
    advance_date: d(1, 5), contractor_id: c1.id, project_id: project.id, cost_center_id: cc.id,
    funding_source_id: fs('PARTNER'), transfer_id: t1.id, amount: 50000,
    description: `${DEMO_TAG} عهدة أعمال حفر وأساسات`, beneficiary_name: c1.name, auto_approve: true
  }, ctx);

  settlements.create({
    advance_id: a1.id, settlement_date: d(2, 10), invoice_no: 'DEMO-INV-1001',
    description: `${DEMO_TAG} فاتورة أعمال حفر`, net_amount: 20000, vat_amount: 0,
    account_id: acc('4110'), auto_approve: true
  }, ctx);

  settlements.create({
    advance_id: a1.id, settlement_date: d(3, 12), invoice_no: 'DEMO-INV-1002',
    description: `${DEMO_TAG} فاتورة أعمال أساسات`, net_amount: 15000, vat_amount: 0,
    account_id: acc('4110'), auto_approve: true
  }, ctx);

  /* ══ السيناريو 1-ب: عهدة مقاول ثانٍ بجزء مسوَّى جزئيًا (تحت الإخلاء) ══ */
  const t2 = transfers.create({
    transfer_date: d(2, 1), amount: 30000, funding_source_id: fs('OTK'), project_id: project.id,
    cost_center_id: cc.id, transfer_type: 'advance', beneficiary_type: 'contractor',
    contractor_id: c2.id, purpose: `${DEMO_TAG} تمويل عهدة أعمال كهرباء`, bank_ref: 'DEMO-BANK-0002',
    auto_approve: true
  }, ctx);
  const a2 = advances.create({
    advance_date: d(2, 1), contractor_id: c2.id, project_id: project.id, cost_center_id: cc.id,
    funding_source_id: fs('OTK'), transfer_id: t2.id, amount: 30000,
    description: `${DEMO_TAG} عهدة تمديدات كهربائية`, beneficiary_name: c2.name, auto_approve: true
  }, ctx);
  settlements.create({
    advance_id: a2.id, settlement_date: d(3, 20), invoice_no: 'DEMO-INV-2001',
    description: `${DEMO_TAG} فاتورة كابلات`, net_amount: 12000, vat_amount: 1800,
    account_id: acc('4120'), auto_approve: true
  }, ctx);

  /* ══ السيناريو 1-ج: عهدة مغلقة بالكامل ══ */
  const t3 = transfers.create({
    transfer_date: d(1, 20), amount: 8000, funding_source_id: fs('TRANSPORT'), project_id: project.id,
    cost_center_id: cc.id, transfer_type: 'advance', beneficiary_type: 'contractor',
    contractor_id: c3.id, purpose: `${DEMO_TAG} تمويل عهدة تشطيبات`, bank_ref: 'DEMO-BANK-0003',
    auto_approve: true
  }, ctx);
  const a3 = advances.create({
    advance_date: d(1, 20), contractor_id: c3.id, project_id: project.id, cost_center_id: cc.id,
    funding_source_id: fs('TRANSPORT'), transfer_id: t3.id, amount: 8000,
    description: `${DEMO_TAG} عهدة تشطيبات مكتب الموقع`, beneficiary_name: c3.name, auto_approve: true
  }, ctx);
  settlements.create({
    advance_id: a3.id, settlement_date: d(2, 25), invoice_no: 'DEMO-INV-3001',
    description: `${DEMO_TAG} فاتورة دهانات`, net_amount: 8000, vat_amount: 0,
    account_id: acc('4130'), auto_approve: true
  }, ctx);

  /* ══ السيناريو 2: أوتك → مورد → فاتورة → دفعة جزئية → متبقٍ ══ */
  const t4 = transfers.create({
    transfer_date: d(3, 1), amount: 20000, funding_source_id: fs('OTK'), project_id: project.id,
    cost_center_id: cc.id, transfer_type: 'supplier', beneficiary_type: 'supplier',
    supplier_id: s1.id, purpose: `${DEMO_TAG} دفعة على فاتورة إسمنت`, bank_ref: 'DEMO-BANK-0004',
    auto_approve: true
  }, ctx);
  const inv1 = invoices.createInvoice({
    supplier_id: s1.id, invoice_no: 'DEMO-SUP-5001', invoice_date: d(2, 20), due_date: d(3, 22),
    description: `${DEMO_TAG} توريد إسمنت`, project_id: project.id, cost_center_id: cc.id,
    account_id: acc('4120'), net_amount: 30000, vat_amount: 4500, auto_approve: true
  }, ctx);
  invoices.createPayment({
    payment_date: d(3, 1), amount: 20000, transfer_id: t4.id, supplier_invoice_id: inv1.id,
    supplier_id: s1.id, payment_type: 'supplier_invoice', project_id: project.id, notes: DEMO_TAG
  }, ctx);

  /* ══ السيناريو 3: النقليات → مورد → فاتورة مدفوعة بالكامل ══ */
  const t5 = transfers.create({
    transfer_date: d(3, 15), amount: 11500, funding_source_id: fs('TRANSPORT'), project_id: project.id,
    cost_center_id: cc.id, transfer_type: 'supplier', beneficiary_type: 'supplier',
    supplier_id: s2.id, purpose: `${DEMO_TAG} سداد فاتورة تأجير معدات`, bank_ref: 'DEMO-BANK-0005',
    auto_approve: true
  }, ctx);
  const inv2 = invoices.createInvoice({
    supplier_id: s2.id, invoice_no: 'DEMO-SUP-6001', invoice_date: d(3, 10), due_date: d(3, 25),
    description: `${DEMO_TAG} تأجير معدات ثقيلة`, project_id: project.id, cost_center_id: cc.id,
    account_id: acc('4120'), net_amount: 10000, vat_amount: 1500, auto_approve: true
  }, ctx);
  invoices.createPayment({
    payment_date: d(3, 15), amount: 11500, transfer_id: t5.id, supplier_invoice_id: inv2.id,
    supplier_id: s2.id, payment_type: 'supplier_invoice', project_id: project.id, notes: DEMO_TAG
  }, ctx);

  /* ══ حالة تحتاج مراجعة: تحويل بدون عهدة (يظهر في تقرير المطابقة) ══ */
  transfers.create({
    transfer_date: d(4, 2), amount: 5000, funding_source_id: fs('PARTNER'), project_id: project.id,
    cost_center_id: cc.id, transfer_type: 'other', beneficiary_type: 'other',
    beneficiary_name: 'مصروفات موقع عامة (تجريبي)', purpose: `${DEMO_TAG} مصروفات نثرية`,
    bank_ref: 'DEMO-BANK-0006', auto_approve: true
  }, ctx);

  return {
    contractors: 3, suppliers: 2, transfers: 6, advances: 3, settlements: 4,
    supplier_invoices: 2, payments: 2
  };
}

module.exports = { seed, systemContext, DEMO_TAG };
