'use strict';
/**
 * خدمة المقاولين والموردين
 * كل الأرصدة تُحتسب من العمليات المسجلة (Data-Driven).
 */
const { getDb, tx } = require('../db');
const { notFound, badRequest } = require('../utils/helpers');
const { QueryBuilder, paginate, reqStr, optStr, optMoney, optId } = require('../utils/validators');
const audit = require('./audit.service');

/* ============================ المقاولون ============================ */

const CONTRACTOR_SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM advances a WHERE a.contractor_id = c.id AND a.is_void = 0) AS advances_count,
    (SELECT ROUND(COALESCE(SUM(a.amount),0),2) FROM advances a
       WHERE a.contractor_id = c.id AND a.is_void = 0 AND a.approval_status = 'approved') AS total_advances,
    (SELECT ROUND(COALESCE(SUM(s.total_amount),0),2) FROM advance_settlements s
       JOIN advances a2 ON a2.id = s.advance_id
       WHERE a2.contractor_id = c.id AND s.is_void = 0 AND s.approval_status = 'approved') AS total_settled,
    (SELECT ROUND(COALESCE(SUM(a.amount),0),2) FROM advances a
       WHERE a.contractor_id = c.id AND a.is_void = 0 AND a.approval_status = 'approved'
         AND a.amount > (SELECT COALESCE(SUM(s2.total_amount),0) FROM advance_settlements s2
                          WHERE s2.advance_id = a.id AND s2.is_void = 0 AND s2.approval_status = 'approved')) AS open_advances_amount,
    (SELECT ROUND(COALESCE(SUM(t.amount),0),2) FROM transfers t
       WHERE t.contractor_id = c.id AND t.is_void = 0 AND t.approval_status = 'approved') AS total_transfers
  FROM contractors c
`;

function listContractors(filters = {}, paging = {}) {
  const qb = new QueryBuilder(CONTRACTOR_SELECT, { orderSql: 'ORDER BY c.name ASC' });
  qb.like('c.name', filters.search).like('c.code', filters.search);
  qb.eq('c.is_active', filters.is_active);
  qb.eq('c.specialty', filters.specialty);
  if (filters.with_open_balance === '1') {
    qb.where(`(SELECT COALESCE(SUM(a.amount),0) FROM advances a WHERE a.contractor_id = c.id AND a.is_void = 0 AND a.approval_status='approved')
              > (SELECT COALESCE(SUM(s.total_amount),0) FROM advance_settlements s JOIN advances a2 ON a2.id = s.advance_id
                 WHERE a2.contractor_id = c.id AND s.is_void = 0 AND s.approval_status='approved')`);
  }
  return paginate(qb, { allowedSorts: ['c.name', 'c.code', 'total_advances', 'total_settled'], ...paging });
}

function getContractor(id) {
  const row = getDb().prepare(`${CONTRACTOR_SELECT} WHERE c.id = ?`).get(id);
  if (!row) throw notFound('المقاول');
  row.remaining_balance = Math.round(((row.total_advances || 0) - (row.total_settled || 0)) * 100) / 100;
  return row;
}

function createContractor(body, ctx) {
  const data = {
    code: reqStr(body.code, 'رقم المقاول', 40),
    name: reqStr(body.name, 'اسم المقاول', 160),
    specialty: optStr(body.specialty, 120),
    phone: optStr(body.phone, 40),
    vat_number: optStr(body.vat_number, 40),
    national_id: optStr(body.national_id, 40),
    bank_iban: optStr(body.bank_iban, 60),
    opening_balance: optMoney(body.opening_balance),
    notes: optStr(body.notes, 1000),
    is_active: 1,
    created_by: ctx.user.id
  };
  const dup = getDb().prepare('SELECT id FROM contractors WHERE code = ? OR name = ?').get(data.code, data.name);
  if (dup) throw badRequest('يوجد مقاول مسجَّل بنفس الرقم أو الاسم');
  const id = tx(() => {
    const r = getDb().prepare(`INSERT INTO contractors
      (code, name, specialty, phone, vat_number, national_id, bank_iban, opening_balance, notes, is_active, created_by)
      VALUES (@code,@name,@specialty,@phone,@vat_number,@national_id,@bank_iban,@opening_balance,@notes,@is_active,@created_by)`)
      .run(data);
    audit.log(ctx, {
      action: 'create', entityType: 'contractor', entityId: r.lastInsertRowid, entityLabel: data.name,
      summary: `إضافة مقاول: ${data.name} (${data.code})`, newValues: data
    });
    return r.lastInsertRowid;
  });
  return getContractor(id);
}

function updateContractor(id, body, ctx) {
  const before = getContractor(id);
  const data = {};
  const strFields = ['code', 'name', 'specialty', 'phone', 'vat_number', 'national_id', 'bank_iban', 'notes'];
  for (const f of strFields) {
    if (body[f] !== undefined) data[f] = optStr(body[f], f === 'notes' ? 1000 : 160);
  }
  if (body.opening_balance !== undefined) data.opening_balance = optMoney(body.opening_balance);
  if (body.is_active !== undefined) data.is_active = body.is_active ? 1 : 0;
  if (!Object.keys(data).length) return before;

  tx(() => {
    getDb().prepare(`UPDATE contractors SET
      code = COALESCE(@code, code), name = COALESCE(@name, name), specialty = @specialty,
      phone = @phone, vat_number = @vat_number, national_id = @national_id, bank_iban = @bank_iban,
      notes = @notes, opening_balance = @opening_balance, is_active = @is_active, updated_at = datetime('now')
      WHERE id = @id`).run({
      id,
      code: data.code ?? before.code,
      name: data.name ?? before.name,
      specialty: data.specialty !== undefined ? data.specialty : before.specialty,
      phone: data.phone !== undefined ? data.phone : before.phone,
      vat_number: data.vat_number !== undefined ? data.vat_number : before.vat_number,
      national_id: data.national_id !== undefined ? data.national_id : before.national_id,
      bank_iban: data.bank_iban !== undefined ? data.bank_iban : before.bank_iban,
      notes: data.notes !== undefined ? data.notes : before.notes,
      opening_balance: data.opening_balance ?? before.opening_balance,
      is_active: data.is_active !== undefined ? data.is_active : before.is_active
    });
    audit.log(ctx, {
      action: 'update', entityType: 'contractor', entityId: id, entityLabel: before.name,
      summary: `تعديل بيانات المقاول: ${before.name}`, oldValues: before, newValues: { ...before, ...data }
    });
  });
  return getContractor(id);
}

/* ============================ الموردون ============================ */

const SUPPLIER_SELECT = `
  SELECT s.*,
    (SELECT COUNT(*) FROM supplier_invoices i WHERE i.supplier_id = s.id AND i.is_void = 0) AS invoices_count,
    (SELECT ROUND(COALESCE(SUM(i.total_amount),0),2) FROM supplier_invoices i
       WHERE i.supplier_id = s.id AND i.is_void = 0 AND i.approval_status = 'approved') AS total_invoices,
    (SELECT ROUND(COALESCE(SUM(p.amount),0),2) FROM payments p
       WHERE p.supplier_id = s.id AND p.is_void = 0 AND p.approval_status = 'approved') AS total_paid,
    (SELECT ROUND(COALESCE(SUM(t.amount),0),2) FROM transfers t
       WHERE t.supplier_id = s.id AND t.is_void = 0 AND t.approval_status = 'approved') AS total_transfers
  FROM suppliers s
`;

function listSuppliers(filters = {}, paging = {}) {
  const qb = new QueryBuilder(SUPPLIER_SELECT, { orderSql: 'ORDER BY s.name ASC' });
  qb.like('s.name', filters.search).like('s.code', filters.search);
  qb.eq('s.is_active', filters.is_active);
  qb.eq('s.category', filters.category);
  return paginate(qb, { allowedSorts: ['s.name', 's.code', 'total_invoices', 'total_paid'], ...paging });
}

function getSupplier(id) {
  const row = getDb().prepare(`${SUPPLIER_SELECT} WHERE s.id = ?`).get(id);
  if (!row) throw notFound('المورد');
  row.remaining_due = Math.round(((row.total_invoices || 0) - (row.total_paid || 0)) * 100) / 100;
  return row;
}

function createSupplier(body, ctx) {
  const data = {
    code: reqStr(body.code, 'رقم المورد', 40),
    name: reqStr(body.name, 'اسم المورد', 160),
    category: optStr(body.category, 120),
    phone: optStr(body.phone, 40),
    vat_number: optStr(body.vat_number, 40),
    commercial_reg: optStr(body.commercial_reg, 40),
    bank_iban: optStr(body.bank_iban, 60),
    payment_terms_days: Number(body.payment_terms_days || 0),
    opening_balance: optMoney(body.opening_balance),
    notes: optStr(body.notes, 1000),
    is_active: 1,
    created_by: ctx.user.id
  };
  const dup = getDb().prepare('SELECT id FROM suppliers WHERE code = ? OR name = ?').get(data.code, data.name);
  if (dup) throw badRequest('يوجد مورد مسجَّل بنفس الرقم أو الاسم');
  const id = tx(() => {
    const r = getDb().prepare(`INSERT INTO suppliers
      (code,name,category,phone,vat_number,commercial_reg,bank_iban,payment_terms_days,opening_balance,notes,is_active,created_by)
      VALUES (@code,@name,@category,@phone,@vat_number,@commercial_reg,@bank_iban,@payment_terms_days,@opening_balance,@notes,@is_active,@created_by)`)
      .run(data);
    audit.log(ctx, {
      action: 'create', entityType: 'supplier', entityId: r.lastInsertRowid, entityLabel: data.name,
      summary: `إضافة مورد: ${data.name} (${data.code})`, newValues: data
    });
    return r.lastInsertRowid;
  });
  return getSupplier(id);
}

function updateSupplier(id, body, ctx) {
  const before = getSupplier(id);
  const data = {};
  for (const f of ['code', 'name', 'category', 'phone', 'vat_number', 'commercial_reg', 'bank_iban', 'notes']) {
    if (body[f] !== undefined) data[f] = optStr(body[f], f === 'notes' ? 1000 : 160);
  }
  if (body.payment_terms_days !== undefined) data.payment_terms_days = Number(body.payment_terms_days || 0);
  if (body.opening_balance !== undefined) data.opening_balance = optMoney(body.opening_balance);
  if (body.is_active !== undefined) data.is_active = body.is_active ? 1 : 0;
  if (!Object.keys(data).length) return before;

  tx(() => {
    getDb().prepare(`UPDATE suppliers SET
      code = @code, name = @name, category = @category, phone = @phone, vat_number = @vat_number,
      commercial_reg = @commercial_reg, bank_iban = @bank_iban, notes = @notes,
      payment_terms_days = @payment_terms_days, opening_balance = @opening_balance,
      is_active = @is_active, updated_at = datetime('now')
      WHERE id = @id`).run({
      id,
      code: data.code ?? before.code,
      name: data.name ?? before.name,
      category: data.category !== undefined ? data.category : before.category,
      phone: data.phone !== undefined ? data.phone : before.phone,
      vat_number: data.vat_number !== undefined ? data.vat_number : before.vat_number,
      commercial_reg: data.commercial_reg !== undefined ? data.commercial_reg : before.commercial_reg,
      bank_iban: data.bank_iban !== undefined ? data.bank_iban : before.bank_iban,
      notes: data.notes !== undefined ? data.notes : before.notes,
      payment_terms_days: data.payment_terms_days ?? before.payment_terms_days,
      opening_balance: data.opening_balance ?? before.opening_balance,
      is_active: data.is_active !== undefined ? data.is_active : before.is_active
    });
    audit.log(ctx, {
      action: 'update', entityType: 'supplier', entityId: id, entityLabel: before.name,
      summary: `تعديل بيانات المورد: ${before.name}`, oldValues: before, newValues: { ...before, ...data }
    });
  });
  return getSupplier(id);
}

/** قائمة مختصرة للقوائم المنسدلة */
function options(kind) {
  if (kind === 'contractors') {
    return getDb().prepare('SELECT id, code, name FROM contractors WHERE is_active = 1 ORDER BY name').all();
  }
  return getDb().prepare('SELECT id, code, name FROM suppliers WHERE is_active = 1 ORDER BY name').all();
}

module.exports = {
  listContractors, getContractor, createContractor, updateContractor,
  listSuppliers, getSupplier, createSupplier, updateSupplier, options
};
