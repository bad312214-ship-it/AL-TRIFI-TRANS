'use strict';
/**
 * خدمة التحويلات المالية
 * التحويل هو نقطة الربط بين مصدر التمويل والعهدة/المورد.
 */
const { getDb, tx } = require('../db');
const { notFound, badRequest, round2, eqMoney, escapeLike } = require('../utils/helpers');
const { QueryBuilder, paginate, reqStr, optStr, reqDate, reqMoney, reqId, optId, oneOf } = require('../utils/validators');
const { nextDocNo } = require('../utils/sequence');
const audit = require('./audit.service');
const ledger = require('./ledger.service');

const TR_SELECT = `
  SELECT t.*,
    fs.code AS funding_source_code, fs.name AS funding_source_name,
    p.name AS project_name, p.code AS project_code,
    cc.name AS cost_center_name, cc.code AS cost_center_code,
    fa.code AS from_account_code, fa.name AS from_account_name,
    ta.code AS to_account_code, ta.name AS to_account_name,
    c.code AS contractor_code, c.name AS contractor_name,
    s.code AS supplier_code, s.name AS supplier_name,
    a.advance_no, a.description AS advance_description, a.amount AS advance_amount,
    a.status AS advance_status,
    (SELECT ROUND(COALESCE(SUM(p2.amount),0),2) FROM payments p2 WHERE p2.transfer_id = t.id AND p2.is_void = 0) AS paid_total,
    (SELECT COUNT(*) FROM attachments at WHERE at.entity_type='transfer' AND at.entity_id = t.id AND at.is_void = 0) AS attachments_count,
    u1.full_name AS created_by_name, u2.full_name AS approved_by_name
  FROM transfers t
  LEFT JOIN funding_sources fs ON fs.id = t.funding_source_id
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
  LEFT JOIN accounts fa ON fa.id = t.from_account_id
  LEFT JOIN accounts ta ON ta.id = t.to_account_id
  LEFT JOIN contractors c ON c.id = t.contractor_id
  LEFT JOIN suppliers s ON s.id = t.supplier_id
  LEFT JOIN advances a ON a.id = t.advance_id
  LEFT JOIN users u1 ON u1.id = t.created_by
  LEFT JOIN users u2 ON u2.id = t.approved_by
`;

function list(filters = {}, paging = {}) {
  const qb = new QueryBuilder(TR_SELECT, { orderSql: 'ORDER BY t.transfer_date DESC, t.id DESC' });
  qb.where('t.is_void = 0');
  if (filters.search && String(filters.search).trim()) {
    const kw = `%${escapeLike(String(filters.search).trim())}%`;
    qb.where(`(t.transfer_no LIKE ? ESCAPE '\\' OR t.bank_ref LIKE ? ESCAPE '\\' OR t.purpose LIKE ? ESCAPE '\\'
               OR t.beneficiary_name LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\'
               OR a.advance_no LIKE ? ESCAPE '\\')`, ...Array(7).fill(kw));
  }
  qb.eqRaw('t.funding_source_id', filters.funding_source_id);
  qb.eqRaw('t.contractor_id', filters.contractor_id);
  qb.eqRaw('t.supplier_id', filters.supplier_id);
  qb.eqRaw('t.advance_id', filters.advance_id);
  qb.eqRaw('t.project_id', filters.project_id);
  qb.eqRaw('t.cost_center_id', filters.cost_center_id);
  qb.eq('t.transfer_type', filters.transfer_type);
  qb.eq('t.beneficiary_type', filters.beneficiary_type);
  qb.eq('t.approval_status', filters.approval_status);
  qb.between('t.transfer_date', filters.date_from, filters.date_to);
  if (filters.amount_from) qb.where('t.amount >= ?', Number(filters.amount_from));
  if (filters.amount_to) qb.where('t.amount <= ?', Number(filters.amount_to));
  if (filters.unlinked === '1') qb.where('t.advance_id IS NULL AND t.id NOT IN (SELECT transfer_id FROM payments WHERE transfer_id IS NOT NULL AND is_void = 0)');

  const res = paginate(qb, {
    allowedSorts: ['t.transfer_no', 't.transfer_date', 't.amount', 'fs.name', 'c.name', 's.name'],
    ...paging
  });
  res.rows = res.rows.map(decorate);
  return res;
}

function decorate(row) {
  if (!row) return row;
  row.paid_total = round2(row.paid_total || 0);
  row.unpaid_total = round2(row.amount - (row.paid_total || 0));
  row.is_linked = !!(row.advance_id || row.paid_total > 0);
  return row;
}

function getById(id) {
  const row = getDb().prepare(`${TR_SELECT} WHERE t.id = ?`).get(id);
  if (!row) throw notFound('التحويل');
  return decorate(row);
}

function getFullCard(id) {
  const db = getDb();
  const transfer = getById(id);
  return {
    transfer,
    advance: transfer.advance_id
      ? db.prepare('SELECT * FROM advances WHERE id = ?').get(transfer.advance_id) : null,
    payments: db.prepare(`SELECT p.*, i.invoice_no, i.total_amount AS invoice_total
                          FROM payments p LEFT JOIN supplier_invoices i ON i.id = p.supplier_invoice_id
                          WHERE p.transfer_id = ? ORDER BY p.payment_date`).all(id),
    attachments: db.prepare(`SELECT * FROM attachments WHERE entity_type='transfer' AND entity_id=? AND is_void=0`).all(id),
    audit_trail: db.prepare(`SELECT * FROM audit_logs WHERE entity_type='transfer' AND entity_id=? ORDER BY created_at DESC LIMIT 50`).all(id),
    journal: db.prepare(`SELECT je.*, jl.account_id, jl.debit, jl.credit, ac.code AS account_code, ac.name AS account_name
                         FROM journal_entries je JOIN journal_lines jl ON jl.entry_id = je.id
                         JOIN accounts ac ON ac.id = jl.account_id
                         WHERE je.ref_type='transfer' AND je.ref_id=? AND je.is_void=0`).all(id)
  };
}

/** كشف التحويل المكرر: نفس المصدر + المبلغ + التاريخ + المستفيد */
function findDuplicates({ funding_source_id, amount, transfer_date, contractor_id, supplier_id, bank_ref, transfer_no, excludeId }) {
  const db = getDb();
  const out = { by_reference: null, by_similarity: [] };
  if (bank_ref) {
    const r = db.prepare(`SELECT id, transfer_no, transfer_date, amount FROM transfers
                          WHERE bank_ref = ? AND is_void = 0 AND id <> ?`).get(bank_ref, excludeId || 0);
    if (r) out.by_reference = r;
  }
  if (transfer_no) {
    const r = db.prepare(`SELECT id, transfer_no FROM transfers WHERE transfer_no = ? AND id <> ?`).get(transfer_no, excludeId || 0);
    if (r) out.by_reference = out.by_reference || r;
  }
  const sim = db.prepare(`SELECT id, transfer_no, transfer_date, amount, funding_source_id, contractor_id, supplier_id, beneficiary_name
    FROM transfers
    WHERE is_void = 0 AND id <> ? AND funding_source_id = ? AND ROUND(amount,2) = ? AND transfer_date = ?
      AND COALESCE(contractor_id,0) = ? AND COALESCE(supplier_id,0) = ?`)
    .all(excludeId || 0, funding_source_id, round2(amount), transfer_date, contractor_id || 0, supplier_id || 0);
  out.by_similarity = sim;
  return out;
}

function validatePayload(body) {
  const db = getDb();
  const amount = reqMoney(body.amount, 'المبلغ');
  const transferDate = reqDate(body.transfer_date, 'تاريخ التحويل');
  const funding = reqId(body.funding_source_id, 'مصدر التمويل');       // إلزامي
  const fs = db.prepare('SELECT * FROM funding_sources WHERE id = ?').get(funding);
  if (!fs) throw badRequest('مصدر التمويل غير موجود');
  if (!fs.is_active) throw badRequest('مصدر التمويل المحدد غير مفعَّل');

  const project = reqId(body.project_id, 'المشروع');                    // إلزامي
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(project)) throw badRequest('المشروع غير موجود');

  const transferType = oneOf(body.transfer_type, 'نوع التحويل', ['advance', 'supplier', 'other']);
  const beneficiaryType = oneOf(body.beneficiary_type, 'نوع المستفيد', ['contractor', 'supplier', 'other']);

  if ((transferType === 'advance' && beneficiaryType !== 'contractor') ||
      (transferType === 'supplier' && beneficiaryType !== 'supplier')) {
    throw badRequest('نوع التحويل لا يتوافق مع نوع المستفيد');
  }

  const contractorId = beneficiaryType === 'contractor' ? reqId(body.contractor_id, 'المقاول المستفيد') : optId(body.contractor_id);
  const supplierId = beneficiaryType === 'supplier' ? reqId(body.supplier_id, 'المورد المستفيد') : optId(body.supplier_id);
  if (contractorId && !db.prepare('SELECT id FROM contractors WHERE id = ?').get(contractorId)) throw badRequest('المقاول غير موجود');
  if (supplierId && !db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplierId)) throw badRequest('المورد غير موجود');

  let beneficiaryName = optStr(body.beneficiary_name, 160);
  if (!beneficiaryName) {
    if (contractorId) beneficiaryName = db.prepare('SELECT name FROM contractors WHERE id=?').get(contractorId).name;
    else if (supplierId) beneficiaryName = db.prepare('SELECT name FROM suppliers WHERE id=?').get(supplierId).name;
    else throw badRequest('يجب تحديد اسم المستفيد');
  }

  const advanceId = transferType === 'advance' ? optId(body.advance_id) : null;
  if (advanceId) {
    const adv = db.prepare('SELECT * FROM advances WHERE id = ?').get(advanceId);
    if (!adv) throw badRequest('العهدة المحددة غير موجودة');
    if (adv.is_void) throw badRequest('العهدة المحددة ملغاة');
    if (adv.contractor_id !== contractorId) throw badRequest('العهدة لا تخص المقاول المستفيد المحدد');
  }

  let costCenter = optId(body.cost_center_id);
  if (costCenter) {
    const cc = db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(costCenter);
    if (!cc) throw badRequest('مركز التكلفة غير موجود');
    if (cc.project_id !== project) throw badRequest('مركز التكلفة لا يتبع المشروع المحدد');
  } else {
    costCenter = db.prepare('SELECT id FROM cost_centers WHERE project_id = ? AND is_main = 1').get(project)?.id || null;
  }

  const bankRef = optStr(body.bank_ref, 80);
  const transferNo = optStr(body.transfer_no, 40);

  // سقف التمويل (إن وجد)
  if (fs.credit_limit !== null && fs.credit_limit !== undefined) {
    const used = getDb().prepare(`SELECT COALESCE(SUM(amount),0) s FROM transfers
      WHERE funding_source_id = ? AND is_void = 0 AND approval_status IN ('approved','pending')`).get(funding).s;
    if (round2(used + amount) > round2(fs.credit_limit) + 0.005) {
      throw badRequest(`تجاوز سقف التمويل المسموح لمصدر "${fs.name}" (${round2(fs.credit_limit)} ريال). المستخدم حاليًا: ${round2(used)}`);
    }
  }

  return {
    amount, transfer_date: transferDate, funding_source_id: funding, project_id: project,
    cost_center_id: costCenter, from_account_id: optId(body.from_account_id), to_account_id: optId(body.to_account_id),
    transfer_type: transferType, beneficiary_type: beneficiaryType, beneficiary_name: beneficiaryName,
    contractor_id: contractorId, supplier_id: supplierId, advance_id: advanceId,
    purpose: optStr(body.purpose, 300), bank_ref: bankRef, bank_name: optStr(body.bank_name, 120),
    notes: optStr(body.notes, 1000), transfer_no: transferNo
  };
}

function create(body, ctx) {
  const data = validatePayload(body);
  const transferNo = data.transfer_no || nextDocNo('transfer');

  if (getDb().prepare('SELECT id FROM transfers WHERE transfer_no = ?').get(transferNo)) {
    throw badRequest(`رقم العملية ${transferNo} مستخدم مسبقًا`);
  }
  if (data.bank_ref) {
    const dup = getDb().prepare(`SELECT id, transfer_no FROM transfers WHERE bank_ref = ? AND is_void = 0`).get(data.bank_ref);
    if (dup) throw badRequest(`المرجع البنكي ${data.bank_ref} مسجَّل مسبقًا في التحويل ${dup.transfer_no}`);
  }
  const dupSim = findDuplicates({ ...data, transfer_no: transferNo });
  if (dupSim.by_similarity.length && !body.allow_duplicate) {
    const err = badRequest(
      `يوجد تحويل مطابق (نفس المصدر والمبلغ والتاريخ والمستفيد) برقم ${dupSim.by_similarity[0].transfer_no}. للتسجيل على أي حال فعّل خيار "تأكيد أنه تحويل جديد".`,
      409, 'DUPLICATE_TRANSFER'
    );
    err.details = { duplicates: dupSim.by_similarity };
    throw err;
  }

  const id = tx(() => {
    const db = getDb();
    const r = db.prepare(`INSERT INTO transfers
      (transfer_no, transfer_date, amount, funding_source_id, project_id, cost_center_id, from_account_id, to_account_id,
       transfer_type, beneficiary_type, beneficiary_name, contractor_id, supplier_id, advance_id,
       purpose, bank_ref, bank_name, notes, approval_status, created_by)
      VALUES (@transfer_no,@transfer_date,@amount,@funding_source_id,@project_id,@cost_center_id,@from_account_id,@to_account_id,
              @transfer_type,@beneficiary_type,@beneficiary_name,@contractor_id,@supplier_id,@advance_id,
              @purpose,@bank_ref,@bank_name,@notes,@approval_status,@created_by)`)
      .run({
        transfer_no: transferNo, transfer_date: data.transfer_date, amount: data.amount,
        funding_source_id: data.funding_source_id, project_id: data.project_id, cost_center_id: data.cost_center_id,
        from_account_id: data.from_account_id, to_account_id: data.to_account_id,
        transfer_type: data.transfer_type, beneficiary_type: data.beneficiary_type, beneficiary_name: data.beneficiary_name,
        contractor_id: data.contractor_id, supplier_id: data.supplier_id, advance_id: data.advance_id,
        purpose: data.purpose, bank_ref: data.bank_ref, bank_name: data.bank_name, notes: data.notes,
        // يُنشأ دائمًا كمسودة؛ الاعتماد يمر عبر approve() ليتم توليد القيد المحاسبي
        approval_status: 'draft', created_by: ctx.user.id
      });
    const newId = r.lastInsertRowid;
    if (data.advance_id) {
      db.prepare('UPDATE advances SET transfer_id = ?, transfer_no = ?, transfer_date = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(newId, transferNo, data.transfer_date, data.advance_id);
    }
    audit.log(ctx, {
      action: 'create', entityType: 'transfer', entityId: newId, entityLabel: transferNo,
      summary: `تحويل ${round2(data.amount)} ريال من ${data.funding_source_id} إلى ${data.beneficiary_name}`,
      newValues: { transfer_no: transferNo, amount: data.amount, funding_source_id: data.funding_source_id, transfer_type: data.transfer_type }
    });
    return newId;
  });

  const transfer = getById(id);
  if (body.auto_approve) return approve(id, ctx);
  return transfer;
}

function update(id, body, ctx) {
  const before = getById(id);
  if (before.is_void) throw badRequest('لا يمكن تعديل تحويل ملغى');
  if (before.approval_status === 'approved') throw badRequest('لا يمكن تعديل تحويل معتمد. ألغِه ثم أنشئ تحويلًا جديدًا.');

  const data = validatePayload({ ...before, ...body });
  const transferNo = data.transfer_no || before.transfer_no;
  const dup = getDb().prepare('SELECT id FROM transfers WHERE transfer_no = ? AND id <> ?').get(transferNo, id);
  if (dup) throw badRequest(`رقم العملية ${transferNo} مستخدم مسبقًا`);
  if (data.bank_ref) {
    const d = getDb().prepare('SELECT id, transfer_no FROM transfers WHERE bank_ref = ? AND is_void = 0 AND id <> ?').get(data.bank_ref, id);
    if (d) throw badRequest(`المرجع البنكي ${data.bank_ref} مسجَّل مسبقًا في التحويل ${d.transfer_no}`);
  }

  tx(() => {
    const db = getDb();
    if (before.advance_id && before.advance_id !== data.advance_id) {
      db.prepare('UPDATE advances SET transfer_id = NULL WHERE id = ?').run(before.advance_id);
    }
    db.prepare(`UPDATE transfers SET
        transfer_no=@transfer_no, transfer_date=@transfer_date, amount=@amount, funding_source_id=@funding_source_id,
        project_id=@project_id, cost_center_id=@cost_center_id, from_account_id=@from_account_id, to_account_id=@to_account_id,
        transfer_type=@transfer_type, beneficiary_type=@beneficiary_type, beneficiary_name=@beneficiary_name,
        contractor_id=@contractor_id, supplier_id=@supplier_id, advance_id=@advance_id, purpose=@purpose,
        bank_ref=@bank_ref, bank_name=@bank_name, notes=@notes, updated_at=datetime('now')
      WHERE id=@id`).run({ id, transfer_no: transferNo, ...data });
    if (data.advance_id) {
      db.prepare('UPDATE advances SET transfer_id=?, transfer_no=?, transfer_date=? WHERE id=?')
        .run(id, transferNo, data.transfer_date, data.advance_id);
    }
    audit.log(ctx, {
      action: 'update', entityType: 'transfer', entityId: id, entityLabel: transferNo,
      summary: `تعديل التحويل ${transferNo}`, oldValues: before, newValues: data
    });
  });
  return getById(id);
}

function approve(id, ctx) {
  const row = getById(id);
  if (row.is_void) throw badRequest('لا يمكن اعتماد تحويل ملغى');
  if (row.approval_status === 'approved') return row;
  const missing = [];
  if (!row.amount) missing.push('المبلغ');
  if (!row.funding_source_id) missing.push('مصدر التمويل');
  if (!row.project_id) missing.push('المشروع');
  if (!row.beneficiary_name && !row.contractor_id && !row.supplier_id) missing.push('المستفيد');
  if (!row.transfer_date) missing.push('التاريخ');
  if (missing.length) throw badRequest(`لا يمكن الاعتماد — بيانات ناقصة: ${missing.join('، ')}`, { missing });

  tx(() => {
    const db = getDb();
    db.prepare(`UPDATE transfers SET approval_status='approved', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(ctx.user.id, id);

    // القيد المحاسبي
    const fs = db.prepare('SELECT * FROM funding_sources WHERE id = ?').get(row.funding_source_id);
    const creditAccount = fs.account_id || ledger.sysAccount('partner_current');
    let debitAccount;
    if (row.transfer_type === 'advance') debitAccount = row.to_account_id || ledger.sysAccount('advances_asset');
    else if (row.transfer_type === 'supplier') debitAccount = row.to_account_id || ledger.sysAccount('supplier_adv');
    else debitAccount = row.to_account_id || ledger.sysAccount('project_expense');

    ledger.post({
      refType: 'transfer', refId: id, date: row.transfer_date, projectId: row.project_id,
      description: `تحويل ${row.transfer_no} - ${row.beneficiary_name} - ${row.purpose || ''}`,
      lines: [
        { accountId: debitAccount, debit: row.amount, costCenterId: row.cost_center_id, memo: row.beneficiary_name },
        { accountId: creditAccount, credit: row.amount, memo: fs.name }
      ]
    }, ctx);

    audit.log(ctx, {
      action: 'approve', entityType: 'transfer', entityId: id, entityLabel: row.transfer_no,
      summary: `اعتماد التحويل ${row.transfer_no} بقيمة ${round2(row.amount)}`,
      oldValues: { approval_status: row.approval_status }, newValues: { approval_status: 'approved' }
    });
  });
  return getById(id);
}

function reject(id, ctx, reason) {
  const row = getById(id);
  if (row.approval_status === 'approved') throw badRequest('لا يمكن رفض تحويل معتمد');
  tx(() => {
    getDb().prepare(`UPDATE transfers SET approval_status='rejected', notes=COALESCE(notes,'')||?, updated_at=datetime('now') WHERE id=?`)
      .run(`\n[رفض] ${reason || ''}`, id);
    audit.log(ctx, {
      action: 'reject', entityType: 'transfer', entityId: id, entityLabel: row.transfer_no,
      summary: `رفض التحويل ${row.transfer_no}`, newValues: { approval_status: 'rejected', reason }
    });
  });
  return getById(id);
}

/** ربط تحويل بعهدة بعد الإنشاء */
function linkAdvance(id, advanceId, ctx) {
  const transfer = getById(id);
  const adv = getDb().prepare('SELECT * FROM advances WHERE id = ?').get(advanceId);
  if (!adv) throw notFound('العهدة');
  if (transfer.contractor_id && transfer.contractor_id !== adv.contractor_id) throw badRequest('العهدة لا تخص مقاول هذا التحويل');
  tx(() => {
    const db = getDb();
    db.prepare('UPDATE transfers SET advance_id=?, transfer_type=\'advance\', beneficiary_type=\'contractor\', contractor_id=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(advanceId, adv.contractor_id, id);
    db.prepare('UPDATE advances SET transfer_id=?, transfer_no=?, transfer_date=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(id, transfer.transfer_no, transfer.transfer_date, advanceId);
    audit.log(ctx, {
      action: 'update', entityType: 'transfer', entityId: id, entityLabel: transfer.transfer_no,
      summary: `ربط التحويل ${transfer.transfer_no} بالعهدة ${adv.advance_no}`,
      oldValues: { advance_id: transfer.advance_id }, newValues: { advance_id: advanceId }
    });
  });
  return getById(id);
}

function unlinkAdvance(id, ctx) {
  const transfer = getById(id);
  if (!transfer.advance_id) return transfer;
  tx(() => {
    const db = getDb();
    db.prepare('UPDATE advances SET transfer_id=NULL, transfer_no=NULL, transfer_date=NULL WHERE id=?').run(transfer.advance_id);
    db.prepare('UPDATE transfers SET advance_id=NULL, updated_at=datetime(\'now\') WHERE id=?').run(id);
    audit.log(ctx, {
      action: 'update', entityType: 'transfer', entityId: id, entityLabel: transfer.transfer_no,
      summary: `فك ربط التحويل ${transfer.transfer_no} من العهدة`,
      oldValues: { advance_id: transfer.advance_id }, newValues: { advance_id: null }
    });
  });
  return getById(id);
}

function voidTransfer(id, ctx, reason) {
  const row = getById(id);
  if (row.is_void) throw badRequest('التحويل ملغى مسبقًا');
  const r = optStr(reason, 500);
  if (!r) throw badRequest('يجب ذكر سبب الإلغاء');
  const linkedPayments = getDb().prepare('SELECT COUNT(*) c FROM payments WHERE transfer_id = ? AND is_void = 0').get(id).c;
  if (linkedPayments > 0) throw badRequest(`لا يمكن إلغاء التحويل لوجود ${linkedPayments} دفعة مرتبطة به`);

  tx(() => {
    const db = getDb();
    db.prepare(`UPDATE transfers SET is_void=1, void_reason=?, voided_at=datetime('now'), voided_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(r, ctx.user.id, id);
    if (row.advance_id) db.prepare('UPDATE advances SET transfer_id=NULL WHERE id=?').run(row.advance_id);
    ledger.voidEntriesFor('transfer', id);
    audit.log(ctx, {
      action: 'void', entityType: 'transfer', entityId: id, entityLabel: row.transfer_no,
      summary: `إلغاء التحويل ${row.transfer_no}: ${r}`, oldValues: row, newValues: { is_void: 1, void_reason: r }
    });
  });
  return getById(id);
}

module.exports = {
  TR_SELECT, list, getById, getFullCard, create, update, approve, reject,
  linkAdvance, unlinkAdvance, voidTransfer, findDuplicates
};
