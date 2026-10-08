'use strict';
/**
 * خدمة فواتير الموردين + الدفعات
 *
 * المنطق:
 *   المدفوع = مجموع الدفعات المعتمدة على الفاتورة
 *   المتبقي = الإجمالي − المدفوع
 *   الحالة تُشتق تلقائيًا: غير مدفوعة / مدفوعة جزئيًا / مدفوعة بالكامل
 *   يُمنع تسجيل نفس رقم الفاتورة لنفس المورد مرتين (قيد فريد في قاعدة البيانات).
 */
const { getDb, tx } = require('../db');
const { notFound, badRequest, round2, eqMoney, gteMoney, escapeLike } = require('../utils/helpers');
const { QueryBuilder, paginate, reqStr, optStr, reqDate, optDate, reqMoney, optMoney, reqId, optId, oneOf } = require('../utils/validators');
const { nextDocNo } = require('../utils/sequence');
const audit = require('./audit.service');
const ledger = require('./ledger.service');

const INV_SELECT = `
  SELECT i.*,
    s.code AS supplier_code, s.name AS supplier_name,
    p.name AS project_name, p.code AS project_code,
    cc.name AS cost_center_name, cc.code AS cost_center_code,
    acc.code AS account_code, acc.name AS account_name,
    COALESCE(pay.paid_total, 0) AS paid_total,
    ROUND(i.total_amount - COALESCE(pay.paid_total, 0), 2) AS remaining_total,
    COALESCE(pay.payments_count, 0) AS payments_count,
    (SELECT COUNT(*) FROM attachments at WHERE at.entity_type='supplier_invoice' AND at.entity_id = i.id AND at.is_void = 0) AS attachments_count,
    u1.full_name AS created_by_name, u2.full_name AS approved_by_name
  FROM supplier_invoices i
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  LEFT JOIN projects p ON p.id = i.project_id
  LEFT JOIN cost_centers cc ON cc.id = i.cost_center_id
  LEFT JOIN accounts acc ON acc.id = i.account_id
  LEFT JOIN (
    SELECT supplier_invoice_id,
      ROUND(SUM(CASE WHEN approval_status='approved' AND is_void=0 THEN amount ELSE 0 END),2) AS paid_total,
      COUNT(CASE WHEN is_void=0 THEN 1 END) AS payments_count
    FROM payments GROUP BY supplier_invoice_id
  ) pay ON pay.supplier_invoice_id = i.id
  LEFT JOIN users u1 ON u1.id = i.created_by
  LEFT JOIN users u2 ON u2.id = i.approved_by
`;

function deriveInvoiceStatus(row) {
  if (row.is_void) return 'void';
  if (row.approval_status !== 'approved') return 'draft';
  const paid = round2(row.paid_total || 0);
  if (paid <= 0.005) return 'unpaid';
  if (paid + 0.005 >= round2(row.total_amount)) return 'paid';
  return 'partial';
}

function decorateInv(row) {
  if (!row) return row;
  row.paid_total = round2(row.paid_total || 0);
  row.remaining_total = round2(row.remaining_total);
  row.status = deriveInvoiceStatus(row);
  row.is_overdue = !!(row.due_date && row.status !== 'paid' && row.status !== 'void' &&
    row.due_date < new Date().toISOString().slice(0, 10));
  return row;
}

function listInvoices(filters = {}, paging = {}) {
  const qb = new QueryBuilder(INV_SELECT, { orderSql: 'ORDER BY i.invoice_date DESC, i.id DESC' });
  qb.where('i.is_void = 0');
  if (filters.search && String(filters.search).trim()) {
    const kw = `%${escapeLike(String(filters.search).trim())}%`;
    qb.where(`(i.invoice_no LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR s.code LIKE ? ESCAPE '\\')`, ...Array(4).fill(kw));
  }
  qb.eqRaw('i.supplier_id', filters.supplier_id);
  qb.eqRaw('i.project_id', filters.project_id);
  qb.eqRaw('i.cost_center_id', filters.cost_center_id);
  qb.eqRaw('i.account_id', filters.account_id);
  qb.eq('i.approval_status', filters.approval_status);
  qb.between('i.invoice_date', filters.date_from, filters.date_to);
  if (filters.status) {
    const st = String(filters.status);
    if (st === 'unpaid') qb.where('i.approval_status = \'approved\' AND COALESCE(pay.paid_total,0) <= 0.005');
    else if (st === 'partial') qb.where('i.approval_status = \'approved\' AND COALESCE(pay.paid_total,0) > 0.005 AND COALESCE(pay.paid_total,0) < i.total_amount - 0.005');
    else if (st === 'paid') qb.where('i.approval_status = \'approved\' AND COALESCE(pay.paid_total,0) >= i.total_amount - 0.005');
  }
  if (filters.overdue_only === '1') qb.where(`i.due_date IS NOT NULL AND date(i.due_date) < date('now') AND COALESCE(pay.paid_total,0) < i.total_amount - 0.005`);

  const res = paginate(qb, {
    allowedSorts: ['i.invoice_no', 'i.invoice_date', 'i.due_date', 'i.total_amount', 'paid_total', 'remaining_total', 's.name'],
    ...paging
  });
  res.rows = res.rows.map(decorateInv);
  return res;
}

function getInvoice(id) {
  const row = getDb().prepare(`${INV_SELECT} WHERE i.id = ?`).get(id);
  if (!row) throw notFound('الفاتورة');
  return decorateInv(row);
}

function getInvoiceCard(id) {
  const db = getDb();
  const invoice = getInvoice(id);
  return {
    invoice,
    payments: db.prepare(`SELECT p.*, t.transfer_no, t.transfer_date, t.funding_source_id, fs.name AS funding_source_name
      FROM payments p
      LEFT JOIN transfers t ON t.id = p.transfer_id
      LEFT JOIN funding_sources fs ON fs.id = t.funding_source_id
      WHERE p.supplier_invoice_id = ? ORDER BY p.payment_date`).all(id),
    attachments: db.prepare(`SELECT * FROM attachments WHERE entity_type='supplier_invoice' AND entity_id=? AND is_void=0`).all(id),
    audit_trail: db.prepare(`SELECT * FROM audit_logs WHERE entity_type='supplier_invoice' AND entity_id=? ORDER BY created_at DESC LIMIT 50`).all(id)
  };
}

function validateInvoice(body) {
  const db = getDb();
  const supplierId = reqId(body.supplier_id, 'المورد');
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId);
  if (!supplier) throw badRequest('المورد غير موجود');

  const projectId = reqId(body.project_id, 'المشروع');
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) throw badRequest('المشروع غير موجود');

  const netAmount = reqMoney(body.net_amount, 'قيمة الفاتورة قبل الضريبة', { allowZero: true, min: 0 });
  const vatAmount = optMoney(body.vat_amount);
  const totalAmount = round2(netAmount + vatAmount);
  if (body.total_amount !== undefined && body.total_amount !== null && body.total_amount !== '') {
    if (!eqMoney(round2(body.total_amount), totalAmount)) {
      throw badRequest(`الإجمالي (${round2(body.total_amount)}) لا يساوي القيمة قبل الضريبة + الضريبة (${totalAmount})`);
    }
  }
  if (totalAmount <= 0) throw badRequest('إجمالي الفاتورة يجب أن يكون أكبر من صفر');

  const invoiceDate = reqDate(body.invoice_date, 'تاريخ الفاتورة');
  const dueDate = optDate(body.due_date);
  if (dueDate && dueDate < invoiceDate) throw badRequest('تاريخ الاستحقاق لا يمكن أن يسبق تاريخ الفاتورة');

  let costCenter = optId(body.cost_center_id);
  if (costCenter) {
    const cc = db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(costCenter);
    if (!cc) throw badRequest('مركز التكلفة غير موجود');
    if (cc.project_id !== projectId) throw badRequest('مركز التكلفة لا يتبع المشروع المحدد');
  } else {
    costCenter = db.prepare('SELECT id FROM cost_centers WHERE project_id = ? AND is_main = 1').get(projectId)?.id || null;
  }
  const accountId = optId(body.account_id);
  if (accountId && !db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)) throw badRequest('الحساب المحاسبي غير موجود');

  return {
    supplier_id: supplierId, supplier, project_id: projectId, cost_center_id: costCenter, account_id: accountId,
    invoice_no: reqStr(body.invoice_no, 'رقم الفاتورة', 60),
    invoice_date: invoiceDate, due_date: dueDate,
    description: reqStr(body.description, 'وصف الفاتورة', 500),
    net_amount: netAmount, vat_amount: vatAmount, total_amount: totalAmount,
    notes: optStr(body.notes, 1000)
  };
}

function createInvoice(body, ctx) {
  const data = validateInvoice(body);
  const db = getDb();
  const dup = db.prepare('SELECT id, invoice_no FROM supplier_invoices WHERE supplier_id = ? AND invoice_no = ?').get(data.supplier_id, data.invoice_no);
  if (dup) throw badRequest(`الفاتورة رقم ${data.invoice_no} مسجَّلة مسبقًا لهذا المورد`, 409);

  const id = tx(() => {
    const r = db.prepare(`INSERT INTO supplier_invoices
      (supplier_id, invoice_no, invoice_date, due_date, description, project_id, cost_center_id, account_id,
       net_amount, vat_amount, total_amount, approval_status, notes, created_by)
      VALUES (@supplier_id,@invoice_no,@invoice_date,@due_date,@description,@project_id,@cost_center_id,@account_id,
              @net_amount,@vat_amount,@total_amount,@approval_status,@notes,@created_by)`)
      .run({
        supplier_id: data.supplier_id, invoice_no: data.invoice_no, invoice_date: data.invoice_date,
        due_date: data.due_date, description: data.description, project_id: data.project_id,
        cost_center_id: data.cost_center_id, account_id: data.account_id,
        net_amount: data.net_amount, vat_amount: data.vat_amount, total_amount: data.total_amount,
        // يُنشأ دائمًا كمسودة؛ الاعتماد يمر عبر approveInvoice() ليتم توليد القيد المحاسبي
        approval_status: 'draft', notes: data.notes, created_by: ctx.user.id
      });
    audit.log(ctx, {
      action: 'create', entityType: 'supplier_invoice', entityId: r.lastInsertRowid,
      entityLabel: `${data.supplier.name} - ${data.invoice_no}`,
      summary: `فاتورة مورد ${data.invoice_no} (${data.supplier.name}) بقيمة ${round2(data.total_amount)}`,
      newValues: { invoice_no: data.invoice_no, supplier_id: data.supplier_id, total_amount: data.total_amount }
    });
    return r.lastInsertRowid;
  });
  const inv = getInvoice(id);
  if (body.auto_approve) return approveInvoice(id, ctx);
  return inv;
}

function updateInvoice(id, body, ctx) {
  const before = getInvoice(id);
  if (before.is_void) throw badRequest('لا يمكن تعديل فاتورة ملغاة');
  if (before.paid_total > 0) throw badRequest('لا يمكن تعديل فاتورة عليها دفعات مسجَّلة');
  const data = validateInvoice({ ...before, ...body });
  const db = getDb();
  const dup = db.prepare('SELECT id FROM supplier_invoices WHERE supplier_id = ? AND invoice_no = ? AND id <> ?')
    .get(data.supplier_id, data.invoice_no, id);
  if (dup) throw badRequest(`الفاتورة رقم ${data.invoice_no} مسجَّلة مسبقًا لهذا المورد`);

  tx(() => {
    db.prepare(`UPDATE supplier_invoices SET
        supplier_id=@supplier_id, invoice_no=@invoice_no, invoice_date=@invoice_date, due_date=@due_date,
        description=@description, project_id=@project_id, cost_center_id=@cost_center_id, account_id=@account_id,
        net_amount=@net_amount, vat_amount=@vat_amount, total_amount=@total_amount, notes=@notes, updated_at=datetime('now')
      WHERE id=@id`).run({ id, ...data });
    audit.log(ctx, {
      action: 'update', entityType: 'supplier_invoice', entityId: id, entityLabel: `${before.supplier_name} - ${before.invoice_no}`,
      summary: `تعديل فاتورة المورد ${before.invoice_no}`, oldValues: before, newValues: data
    });
  });
  return getInvoice(id);
}

function approveInvoice(id, ctx) {
  const row = getInvoice(id);
  if (row.is_void) throw badRequest('لا يمكن اعتماد فاتورة ملغاة');
  if (row.approval_status === 'approved') return row;
  const missing = [];
  if (!row.invoice_no) missing.push('رقم الفاتورة');
  if (!row.description) missing.push('وصف الفاتورة');
  if (!row.total_amount) missing.push('الإجمالي');
  if (!row.invoice_date) missing.push('تاريخ الفاتورة');
  if (!row.project_id) missing.push('المشروع');
  if (missing.length) throw badRequest(`لا يمكن الاعتماد — بيانات ناقصة: ${missing.join('، ')}`, { missing });

  tx(() => {
    const db = getDb();
    db.prepare(`UPDATE supplier_invoices SET approval_status='approved', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(ctx.user.id, id);
    const acc = row.account_id || ledger.sysAccount('project_expense');
    const lines = [{ accountId: acc, debit: row.net_amount, costCenterId: row.cost_center_id, memo: row.description }];
    if (row.vat_amount > 0) lines.push({ accountId: ledger.sysAccount('vat_input'), debit: row.vat_amount, memo: 'ضريبة المدخلات' });
    lines.push({ accountId: ledger.sysAccount('suppliers_pay'), credit: row.total_amount, memo: row.supplier_name });
    ledger.post({
      refType: 'supplier_invoice', refId: id, date: row.invoice_date, projectId: row.project_id,
      description: `فاتورة مورد ${row.invoice_no} - ${row.supplier_name}`, lines
    }, ctx);
    audit.log(ctx, {
      action: 'approve', entityType: 'supplier_invoice', entityId: id, entityLabel: `${row.supplier_name} - ${row.invoice_no}`,
      summary: `اعتماد فاتورة المورد ${row.invoice_no} بقيمة ${round2(row.total_amount)}`,
      oldValues: { approval_status: row.approval_status }, newValues: { approval_status: 'approved' }
    });
  });
  return getInvoice(id);
}

function voidInvoice(id, ctx, reason) {
  const row = getInvoice(id);
  if (row.is_void) throw badRequest('الفاتورة ملغاة مسبقًا');
  const r = optStr(reason, 500);
  if (!r) throw badRequest('يجب ذكر سبب الإلغاء');
  if (row.paid_total > 0) throw badRequest('لا يمكن إلغاء فاتورة عليها دفعات');
  tx(() => {
    const db = getDb();
    db.prepare(`UPDATE supplier_invoices SET is_void=1, void_reason=?, voided_at=datetime('now'), voided_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(r, ctx.user.id, id);
    ledger.voidEntriesFor('supplier_invoice', id);
    audit.log(ctx, {
      action: 'void', entityType: 'supplier_invoice', entityId: id, entityLabel: `${row.supplier_name} - ${row.invoice_no}`,
      summary: `إلغاء فاتورة المورد ${row.invoice_no}: ${r}`, oldValues: row, newValues: { is_void: 1 }
    });
  });
  return getInvoice(id);
}

/* ============================ الدفعات ============================ */

const PAY_SELECT = `
  SELECT p.*,
    t.transfer_no, t.transfer_date, t.amount AS transfer_amount, t.bank_ref,
    fs.name AS funding_source_name, fs.id AS funding_source_id,
    i.invoice_no, i.total_amount AS invoice_total, i.description AS invoice_description,
    s.code AS supplier_code, s.name AS supplier_name,
    c.code AS contractor_code, c.name AS contractor_name,
    a.advance_no, p2.name AS project_name,
    u.full_name AS created_by_name
  FROM payments p
  LEFT JOIN transfers t ON t.id = p.transfer_id
  LEFT JOIN funding_sources fs ON fs.id = t.funding_source_id
  LEFT JOIN supplier_invoices i ON i.id = p.supplier_invoice_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id
  LEFT JOIN contractors c ON c.id = p.contractor_id
  LEFT JOIN advances a ON a.id = p.advance_id
  LEFT JOIN projects p2 ON p2.id = p.project_id
  LEFT JOIN users u ON u.id = p.created_by
`;

function listPayments(filters = {}, paging = {}) {
  const qb = new QueryBuilder(PAY_SELECT, { orderSql: 'ORDER BY p.payment_date DESC, p.id DESC' });
  qb.where('p.is_void = 0');
  if (filters.search && String(filters.search).trim()) {
    const kw = `%${escapeLike(String(filters.search).trim())}%`;
    qb.where(`(p.payment_no LIKE ? ESCAPE '\\' OR i.invoice_no LIKE ? ESCAPE '\\' OR t.transfer_no LIKE ? ESCAPE '\\'
               OR s.name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`, ...Array(5).fill(kw));
  }
  qb.eqRaw('p.supplier_id', filters.supplier_id);
  qb.eqRaw('p.contractor_id', filters.contractor_id);
  qb.eqRaw('p.supplier_invoice_id', filters.supplier_invoice_id);
  qb.eqRaw('p.transfer_id', filters.transfer_id);
  qb.eqRaw('p.advance_id', filters.advance_id);
  qb.eqRaw('p.project_id', filters.project_id);
  qb.eq('p.payment_type', filters.payment_type);
  qb.between('p.payment_date', filters.date_from, filters.date_to);
  const res = paginate(qb, { allowedSorts: ['p.payment_no', 'p.payment_date', 'p.amount'], ...paging });
  return res;
}

function getPayment(id) {
  const row = getDb().prepare(`${PAY_SELECT} WHERE p.id = ?`).get(id);
  if (!row) throw notFound('الدفعة');
  return row;
}

function createPayment(body, ctx) {
  const db = getDb();
  const amount = reqMoney(body.amount, 'مبلغ الدفعة');
  const paymentType = oneOf(body.payment_type, 'نوع الدفعة', ['supplier_invoice', 'advance', 'advance_payment', 'other']);
  const projectId = reqId(body.project_id, 'المشروع');

  let supplierInvoiceId = optId(body.supplier_invoice_id);
  let supplierId = optId(body.supplier_id);
  let contractorId = optId(body.contractor_id);
  let advanceId = optId(body.advance_id);
  const transferId = optId(body.transfer_id);

  let invoice = null;
  if (paymentType === 'supplier_invoice') {
    if (!supplierInvoiceId) throw badRequest('يجب تحديد فاتورة المورد');
    invoice = db.prepare('SELECT * FROM supplier_invoices WHERE id = ?').get(supplierInvoiceId);
    if (!invoice) throw badRequest('الفاتورة غير موجودة');
    if (invoice.is_void) throw badRequest('الفاتورة ملغاة');
    if (invoice.approval_status !== 'approved') throw badRequest('لا يمكن سداد فاتورة غير معتمدة');
    supplierId = supplierId || invoice.supplier_id;
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE supplier_invoice_id = ? AND is_void = 0 AND approval_status='approved'`).get(supplierInvoiceId).s;
    const remaining = round2(invoice.total_amount - paid);
    if (round2(amount) > remaining + 0.005) {
      throw badRequest(`مبلغ الدفعة (${round2(amount)}) يتجاوز المتبقي على الفاتورة (${remaining})`, 409, 'OVERPAYMENT');
    }
  } else if (paymentType === 'advance' || paymentType === 'advance_payment') {
    if (!advanceId) throw badRequest('يجب تحديد العهدة');
    const adv = db.prepare('SELECT * FROM advances WHERE id = ?').get(advanceId);
    if (!adv) throw badRequest('العهدة غير موجودة');
    contractorId = contractorId || adv.contractor_id;
  }

  if (transferId) {
    const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(transferId);
    if (!t) throw badRequest('التحويل غير موجود');
    if (t.is_void) throw badRequest('التحويل ملغى');
    if (round2(amount) > round2(t.amount) + 0.005) throw badRequest('مبلغ الدفعة أكبر من قيمة التحويل المرتبط');
    const usedBy = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE transfer_id = ? AND is_void = 0 AND id <> 0`).get(transferId).s;
    if (round2(usedBy + amount) > round2(t.amount) + 0.005) {
      throw badRequest(`مجموع الدفعات (${round2(usedBy + amount)}) سيتجاوز قيمة التحويل (${round2(t.amount)})`);
    }
  }

  const paymentNo = optStr(body.payment_no, 40) || nextDocNo('payment');
  if (db.prepare('SELECT id FROM payments WHERE payment_no = ?').get(paymentNo)) throw badRequest(`رقم الدفعة ${paymentNo} مستخدم مسبقًا`);

  const id = tx(() => {
    const r = db.prepare(`INSERT INTO payments
      (payment_no, payment_date, amount, transfer_id, supplier_invoice_id, advance_id, supplier_id, contractor_id,
       payment_type, project_id, notes, approval_status, created_by)
      VALUES (@payment_no,@payment_date,@amount,@transfer_id,@supplier_invoice_id,@advance_id,@supplier_id,@contractor_id,
              @payment_type,@project_id,@notes,@approval_status,@created_by)`)
      .run({
        payment_no: paymentNo, payment_date: reqDate(body.payment_date, 'تاريخ الدفعة'), amount,
        transfer_id: transferId, supplier_invoice_id: supplierInvoiceId, advance_id: advanceId,
        supplier_id: supplierId, contractor_id: contractorId, payment_type: paymentType,
        project_id: projectId, notes: optStr(body.notes, 1000),
        approval_status: 'approved', created_by: ctx.user.id
      });
    audit.log(ctx, {
      action: 'create', entityType: 'payment', entityId: r.lastInsertRowid, entityLabel: paymentNo,
      summary: `دفعة ${round2(amount)} ريال ${invoice ? `على الفاتورة ${invoice.invoice_no}` : ''}`,
      newValues: { payment_no: paymentNo, amount, supplier_invoice_id: supplierInvoiceId, transfer_id: transferId }
    });
    return r.lastInsertRowid;
  });
  return getPayment(id);
}

function voidPayment(id, ctx, reason) {
  const row = getPayment(id);
  if (row.is_void) throw badRequest('الدفعة ملغاة مسبقًا');
  const r = optStr(reason, 500);
  if (!r) throw badRequest('يجب ذكر سبب الإلغاء');
  tx(() => {
    getDb().prepare(`UPDATE payments SET is_void=1, void_reason=?, voided_at=datetime('now'), voided_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(r, ctx.user.id, id);
    audit.log(ctx, {
      action: 'void', entityType: 'payment', entityId: id, entityLabel: row.payment_no,
      summary: `إلغاء الدفعة ${row.payment_no}: ${r}`, oldValues: row, newValues: { is_void: 1 }
    });
  });
  return getPayment(id);
}

module.exports = {
  INV_SELECT, listInvoices, getInvoice, getInvoiceCard, createInvoice, updateInvoice, approveInvoice, voidInvoice,
  PAY_SELECT, listPayments, getPayment, createPayment, voidPayment, deriveInvoiceStatus
};
