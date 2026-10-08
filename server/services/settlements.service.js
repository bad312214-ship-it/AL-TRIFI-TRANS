'use strict';
/**
 * خدمة إخلاء العهد (فواتير الإخلاء)
 *
 * المنطق:
 *   الرصيد المتاح = مبلغ العهدة − إجمالي الإخلاءات المعتمدة
 *   لا يُسمح بإخلاء يتجاوز الرصيد المتاح إلا بصلاحية settlements.over_settle + تأكيد صريح.
 *   الإخلاءات المعتمدة فقط هي التي تُنقص الرصيد.
 */
const { getDb, tx } = require('../db');
const { notFound, badRequest, round2, eqMoney, gteMoney, escapeLike } = require('../utils/helpers');
const { QueryBuilder, paginate, reqStr, optStr, reqDate, reqMoney, optMoney, reqId, optId, oneOf } = require('../utils/validators');
const { nextDocNo } = require('../utils/sequence');
const audit = require('./audit.service');
const ledger = require('./ledger.service');
const advancesService = require('./advances.service');

const ST_SELECT = `
  SELECT s.*,
    a.advance_no, a.amount AS advance_amount, a.status AS advance_status, a.approval_status AS advance_approval_status,
    c.code AS contractor_code, c.name AS contractor_name,
    p.name AS project_name, cc.name AS cost_center_name,
    acc.code AS account_code, acc.name AS account_name,
    (SELECT ROUND(a.amount - COALESCE(SUM(CASE WHEN s2.approval_status='approved' AND s2.is_void=0 THEN s2.total_amount ELSE 0 END),0), 2)
       FROM advance_settlements s2 WHERE s2.advance_id = a.id) AS advance_remaining_after,
    (SELECT COUNT(*) FROM attachments at WHERE at.entity_type='settlement' AND at.entity_id = s.id AND at.is_void = 0) AS attachments_count,
    u1.full_name AS created_by_name, u2.full_name AS approved_by_name
  FROM advance_settlements s
  JOIN advances a ON a.id = s.advance_id
  LEFT JOIN contractors c ON c.id = a.contractor_id
  LEFT JOIN projects p ON p.id = s.project_id
  LEFT JOIN cost_centers cc ON cc.id = s.cost_center_id
  LEFT JOIN accounts acc ON acc.id = s.account_id
  LEFT JOIN users u1 ON u1.id = s.created_by
  LEFT JOIN users u2 ON u2.id = s.approved_by
`;

function decorate(row) {
  if (!row) return row;
  row.total_amount = round2(row.total_amount);
  row.deducts_balance = row.approval_status === 'approved' && !row.is_void;
  return row;
}

function list(filters = {}, paging = {}) {
  const qb = new QueryBuilder(ST_SELECT, { orderSql: 'ORDER BY s.settlement_date DESC, s.id DESC' });
  qb.where('s.is_void = 0');
  if (filters.search && String(filters.search).trim()) {
    const kw = `%${escapeLike(String(filters.search).trim())}%`;
    qb.where(`(s.settlement_no LIKE ? ESCAPE '\\' OR s.invoice_no LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\'
               OR a.advance_no LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`, ...Array(5).fill(kw));
  }
  qb.eqRaw('s.advance_id', filters.advance_id);
  qb.eqRaw('a.contractor_id', filters.contractor_id);
  qb.eqRaw('s.project_id', filters.project_id);
  qb.eqRaw('s.cost_center_id', filters.cost_center_id);
  qb.eqRaw('s.account_id', filters.account_id);
  qb.eq('s.approval_status', filters.approval_status);
  qb.eq('s.review_status', filters.review_status);
  qb.between('s.settlement_date', filters.date_from, filters.date_to);
  if (filters.over_only === '1') qb.where('s.over_settlement = 1');

  const res = paginate(qb, {
    allowedSorts: ['s.settlement_no', 's.settlement_date', 's.total_amount', 'a.advance_no', 'c.name'],
    ...paging
  });
  res.rows = res.rows.map(decorate);
  return res;
}

function getById(id) {
  const row = getDb().prepare(`${ST_SELECT} WHERE s.id = ?`).get(id);
  if (!row) throw notFound('الإخلاء');
  return decorate(row);
}

function validatePayload(body) {
  const db = getDb();
  const advanceId = reqId(body.advance_id, 'العهدة');
  const adv = db.prepare('SELECT * FROM advances WHERE id = ?').get(advanceId);
  if (!adv) throw badRequest('العهدة غير موجودة');
  if (adv.is_void) throw badRequest('العهدة ملغاة');
  if (adv.approval_status !== 'approved') throw badRequest('لا يمكن إخلاء عهدة غير معتمدة — اعتمد العهدة أولًا');

  const netAmount = reqMoney(body.net_amount, 'قيمة الفاتورة', { allowZero: true, min: 0 });
  const vatAmount = optMoney(body.vat_amount);
  const totalAmount = round2(netAmount + vatAmount);
  if (body.total_amount !== undefined && body.total_amount !== null && body.total_amount !== '') {
    const given = round2(body.total_amount);
    if (!eqMoney(given, totalAmount)) {
      throw badRequest(`الإجمالي (${given}) لا يساوي قيمة الفاتورة + الضريبة (${totalAmount})`);
    }
  }
  if (totalAmount <= 0) throw badRequest('إجمالي فاتورة الإخلاء يجب أن يكون أكبر من صفر');

  const invoiceNo = reqStr(body.invoice_no, 'رقم الفاتورة', 60);
  const description = reqStr(body.description, 'البيان', 500);

  let costCenter = optId(body.cost_center_id) || adv.cost_center_id;
  const accountId = optId(body.account_id);
  if (accountId && !db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)) throw badRequest('الحساب المحاسبي غير موجود');

  return {
    advance_id: advanceId, advance: adv,
    settlement_date: reqDate(body.settlement_date, 'تاريخ الإخلاء'),
    invoice_no: invoiceNo, description,
    net_amount: netAmount, vat_amount: vatAmount, total_amount: totalAmount,
    project_id: adv.project_id, cost_center_id: costCenter, account_id: accountId,
    notes: optStr(body.notes, 1000)
  };
}

/**
 * @param {boolean} body.allow_over_settlement  تأكيد صريح على التجاوز
 */
function create(body, ctx) {
  const data = validatePayload(body);
  const db = getDb();

  const dup = db.prepare(`SELECT id, settlement_no FROM advance_settlements
                          WHERE advance_id = ? AND invoice_no = ? AND is_void = 0`).get(data.advance_id, data.invoice_no);
  if (dup) throw badRequest(`رقم الفاتورة ${data.invoice_no} مسجَّل مسبقًا على هذه العهدة (إخلاء ${dup.settlement_no})`);

  const bal = advancesService.getBalance(data.advance_id);
  // الرصيد المحتجز يشمل الإخلاءات المعلّقة لتفادي الإفراط في الإخلاء
  const available = round2(bal.amount - bal.settled_total - bal.pending_total);
  const over = round2(data.total_amount - available);
  const isOver = over > 0.005;

  if (isOver) {
    if (!body.allow_over_settlement) {
      const err = badRequest(
        `قيمة الإخلاء (${round2(data.total_amount)}) تتجاوز الرصيد المتاح للعهدة ${data.advance.advance_no} (${round2(available)} ريال). ` +
        `الفرق: ${round2(over)} ريال. يلزم موافقة صريحة.`,
        409, 'OVER_SETTLEMENT'
      );
      err.details = { available, requested: data.total_amount, excess: round2(over), advance_no: data.advance.advance_no };
      throw err;
    }
    if (!ctx.user.permissions.has('settlements.over_settle')) {
      const err = badRequest('تجاوز رصيد العهدة يتطلب صلاحية خاصة (الموافقة على تجاوز رصيد العهدة).', 403, 'FORBIDDEN');
      err.details = { available, requested: data.total_amount, excess: round2(over) };
      throw err;
    }
  }

  const settlementNo = optStr(body.settlement_no, 40) || nextDocNo('settlement');
  if (db.prepare('SELECT id FROM advance_settlements WHERE settlement_no = ?').get(settlementNo)) {
    throw badRequest(`رقم الإخلاء ${settlementNo} مستخدم مسبقًا`);
  }

  const id = tx(() => {
    const r = db.prepare(`INSERT INTO advance_settlements
      (settlement_no, settlement_date, advance_id, project_id, cost_center_id, account_id, invoice_no, description,
       net_amount, vat_amount, total_amount, review_status, approval_status, over_settlement, notes, created_by)
      VALUES (@settlement_no,@settlement_date,@advance_id,@project_id,@cost_center_id,@account_id,@invoice_no,@description,
              @net_amount,@vat_amount,@total_amount,@review_status,@approval_status,@over_settlement,@notes,@created_by)`)
      .run({
        settlement_no: settlementNo, settlement_date: data.settlement_date, advance_id: data.advance_id,
        project_id: data.project_id, cost_center_id: data.cost_center_id, account_id: data.account_id,
        invoice_no: data.invoice_no, description: data.description,
        net_amount: data.net_amount, vat_amount: data.vat_amount, total_amount: data.total_amount,
        // يُنشأ دائمًا معلّقًا؛ الاعتماد يمر عبر approve() ليتم توليد القيد المحاسبي
        review_status: 'pending', approval_status: 'pending',
        over_settlement: isOver ? 1 : 0, notes: data.notes, created_by: ctx.user.id
      });
    audit.log(ctx, {
      action: 'create', entityType: 'settlement', entityId: r.lastInsertRowid, entityLabel: settlementNo,
      summary: `إخلاء ${round2(data.total_amount)} ريال من العهدة ${data.advance.advance_no} (فاتورة ${data.invoice_no})`,
      newValues: { settlement_no: settlementNo, advance_id: data.advance_id, total_amount: data.total_amount, over_settlement: isOver ? 1 : 0 }
    });
    if (isOver) {
      audit.log(ctx, {
        action: 'over_settle', entityType: 'settlement', entityId: r.lastInsertRowid, entityLabel: settlementNo,
        summary: `موافقة على تجاوز رصيد العهدة ${data.advance.advance_no} بمقدار ${round2(over)} ريال`,
        newValues: { available, requested: data.total_amount, excess: round2(over) }
      });
    }
    return r.lastInsertRowid;
  });

  advancesService.refreshStatus(data.advance_id);
  const row = getById(id);
  if (body.auto_approve) return approve(id, ctx);
  return row;
}

function update(id, body, ctx) {
  const before = getById(id);
  if (before.is_void) throw badRequest('لا يمكن تعديل إخلاء ملغى');
  if (before.approval_status === 'approved') throw badRequest('لا يمكن تعديل إخلاء معتمد — ألغِ الاعتماد أولًا');

  const data = validatePayload({ ...before, ...body, advance_id: before.advance_id });
  const db = getDb();
  const dup = db.prepare(`SELECT id FROM advance_settlements WHERE advance_id = ? AND invoice_no = ? AND is_void = 0 AND id <> ?`)
    .get(data.advance_id, data.invoice_no, id);
  if (dup) throw badRequest(`رقم الفاتورة ${data.invoice_no} مسجَّل مسبقًا على هذه العهدة`);

  const bal = advancesService.getBalance(data.advance_id);
  const available = round2(bal.amount - bal.settled_total - (bal.pending_total - (before.approval_status === 'pending' ? before.total_amount : 0)));
  const isOver = round2(data.total_amount - available) > 0.005;
  if (isOver && !body.allow_over_settlement) {
    throw badRequest(`قيمة الإخلاء تتجاوز الرصيد المتاح (${round2(available)} ريال)`, 409, 'OVER_SETTLEMENT');
  }
  if (isOver && !ctx.user.permissions.has('settlements.over_settle')) {
    throw badRequest('تجاوز رصيد العهدة يتطلب صلاحية خاصة', 403, 'FORBIDDEN');
  }

  tx(() => {
    db.prepare(`UPDATE advance_settlements SET
        settlement_date=@settlement_date, invoice_no=@invoice_no, description=@description,
        net_amount=@net_amount, vat_amount=@vat_amount, total_amount=@total_amount,
        cost_center_id=@cost_center_id, account_id=@account_id, over_settlement=@over_settlement,
        notes=@notes, updated_at=datetime('now')
      WHERE id=@id`).run({
      id, settlement_date: data.settlement_date, invoice_no: data.invoice_no, description: data.description,
      net_amount: data.net_amount, vat_amount: data.vat_amount, total_amount: data.total_amount,
      cost_center_id: data.cost_center_id, account_id: data.account_id,
      over_settlement: isOver ? 1 : 0, notes: data.notes
    });
    audit.log(ctx, {
      action: 'update', entityType: 'settlement', entityId: id, entityLabel: before.settlement_no,
      summary: `تعديل الإخلاء ${before.settlement_no}`, oldValues: before, newValues: data
    });
  });
  advancesService.refreshStatus(before.advance_id);
  return getById(id);
}

function review(id, ctx, status) {
  const row = getById(id);
  const st = oneOf(status, 'حالة المراجعة', ['pending', 'reviewed', 'returned']);
  tx(() => {
    getDb().prepare(`UPDATE advance_settlements SET review_status=?, updated_at=datetime('now') WHERE id=?`).run(st, id);
    audit.log(ctx, {
      action: 'review', entityType: 'settlement', entityId: id, entityLabel: row.settlement_no,
      summary: `مراجعة الإخلاء ${row.settlement_no} → ${st}`,
      oldValues: { review_status: row.review_status }, newValues: { review_status: st }
    });
  });
  return getById(id);
}

function approve(id, ctx) {
  const row = getById(id);
  if (row.is_void) throw badRequest('لا يمكن اعتماد إخلاء ملغى');
  if (row.approval_status === 'approved') return row;
  const missing = [];
  if (!row.invoice_no) missing.push('رقم الفاتورة');
  if (!row.description) missing.push('البيان');
  if (!row.total_amount) missing.push('الإجمالي');
  if (!row.settlement_date) missing.push('تاريخ الإخلاء');
  if (missing.length) throw badRequest(`لا يمكن الاعتماد — بيانات ناقصة: ${missing.join('، ')}`, { missing });

  tx(() => {
    const db = getDb();
    db.prepare(`UPDATE advance_settlements SET approval_status='approved', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(ctx.user.id, id);

    const acc = row.account_id || ledger.sysAccount('project_expense');
    const lines = [{ accountId: acc, debit: row.net_amount, costCenterId: row.cost_center_id, memo: row.description }];
    if (row.vat_amount > 0) lines.push({ accountId: ledger.sysAccount('vat_input'), debit: row.vat_amount, memo: 'ضريبة المدخلات' });
    lines.push({ accountId: ledger.sysAccount('advances_asset'), credit: row.total_amount, memo: `إخلاء عهدة ${row.advance_no}` });
    ledger.post({
      refType: 'settlement', refId: id, date: row.settlement_date, projectId: row.project_id,
      description: `إخلاء عهدة ${row.advance_no} - فاتورة ${row.invoice_no}`, lines
    }, ctx);

    audit.log(ctx, {
      action: 'approve', entityType: 'settlement', entityId: id, entityLabel: row.settlement_no,
      summary: `اعتماد إخلاء ${row.settlement_no} بقيمة ${round2(row.total_amount)} على العهدة ${row.advance_no}`,
      oldValues: { approval_status: row.approval_status }, newValues: { approval_status: 'approved' }
    });
  });
  advancesService.refreshStatus(row.advance_id);
  return getById(id);
}

function unapprove(id, ctx, reason) {
  const row = getById(id);
  if (row.approval_status !== 'approved') throw badRequest('الإخلاء غير معتمد');
  tx(() => {
    const db = getDb();
    db.prepare(`UPDATE advance_settlements SET approval_status='pending', approved_by=NULL, approved_at=NULL,
                notes=COALESCE(notes,'')||?, updated_at=datetime('now') WHERE id=?`).run(`\n[إلغاء اعتماد] ${reason || ''}`, id);
    ledger.voidEntriesFor('settlement', id);
    audit.log(ctx, {
      action: 'reject', entityType: 'settlement', entityId: id, entityLabel: row.settlement_no,
      summary: `إلغاء اعتماد الإخلاء ${row.settlement_no}`, oldValues: { approval_status: 'approved' }, newValues: { approval_status: 'pending' }
    });
  });
  advancesService.refreshStatus(row.advance_id);
  return getById(id);
}

function reject(id, ctx, reason) {
  const row = getById(id);
  if (row.approval_status === 'approved') throw badRequest('لا يمكن رفض إخلاء معتمد');
  tx(() => {
    getDb().prepare(`UPDATE advance_settlements SET approval_status='rejected', updated_at=datetime('now') WHERE id=?`).run(id);
    audit.log(ctx, {
      action: 'reject', entityType: 'settlement', entityId: id, entityLabel: row.settlement_no,
      summary: `رفض الإخلاء ${row.settlement_no}: ${reason || ''}`, newValues: { approval_status: 'rejected' }
    });
  });
  advancesService.refreshStatus(row.advance_id);
  return getById(id);
}

function voidSettlement(id, ctx, reason) {
  const row = getById(id);
  if (row.is_void) throw badRequest('الإخلاء ملغى مسبقًا');
  const r = optStr(reason, 500);
  if (!r) throw badRequest('يجب ذكر سبب الإلغاء');
  tx(() => {
    const db = getDb();
    db.prepare(`UPDATE advance_settlements SET is_void=1, void_reason=?, voided_at=datetime('now'), voided_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(r, ctx.user.id, id);
    ledger.voidEntriesFor('settlement', id);
    audit.log(ctx, {
      action: 'void', entityType: 'settlement', entityId: id, entityLabel: row.settlement_no,
      summary: `إلغاء الإخلاء ${row.settlement_no}: ${r}`, oldValues: row, newValues: { is_void: 1 }
    });
  });
  advancesService.refreshStatus(row.advance_id);
  return getById(id);
}

module.exports = { ST_SELECT, list, getById, create, update, review, approve, unapprove, reject, voidSettlement };
