'use strict';
/**
 * خدمة عهد المقاولين
 *
 * المنطق المحاسبي:
 *   إجمالي العهدة − إجمالي فواتير الإخلاء المقبولة = الرصيد المتبقي
 *   حالة العهدة تُشتق تلقائيًا من الرصيد والإخلاءات المعلّقة.
 */
const { getDb, tx } = require('../db');
const { notFound, badRequest, round2, eqMoney, gteMoney } = require('../utils/helpers');
const { QueryBuilder, paginate, reqStr, optStr, reqDate, optDate, reqMoney, reqId, optId, oneOf } = require('../utils/validators');
const { nextDocNo } = require('../utils/sequence');
const audit = require('./audit.service');
const ledger = require('./ledger.service');

const ADV_SELECT = `
  SELECT a.*,
    c.code AS contractor_code, c.name AS contractor_name,
    p.code AS project_code, p.name AS project_name,
    cc.code AS cost_center_code, cc.name AS cost_center_name,
    fs.code AS funding_source_code, fs.name AS funding_source_name,
    t.transfer_no, t.transfer_date, t.amount AS transfer_amount, t.bank_ref, t.approval_status AS transfer_status,
    COALESCE(st.approved_total, 0)  AS settled_total,
    COALESCE(st.pending_total, 0)   AS pending_total,
    COALESCE(st.rejected_total, 0)  AS rejected_total,
    COALESCE(st.settlements_count, 0) AS settlements_count,
    ROUND(a.amount - COALESCE(st.approved_total, 0), 2) AS remaining_balance,
    u1.full_name AS created_by_name,
    u2.full_name AS approved_by_name
  FROM advances a
  LEFT JOIN contractors c ON c.id = a.contractor_id
  LEFT JOIN projects p ON p.id = a.project_id
  LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
  LEFT JOIN funding_sources fs ON fs.id = a.funding_source_id
  LEFT JOIN transfers t ON t.id = a.transfer_id
  LEFT JOIN users u1 ON u1.id = a.created_by
  LEFT JOIN users u2 ON u2.id = a.approved_by
  LEFT JOIN (
    SELECT advance_id,
      ROUND(SUM(CASE WHEN approval_status='approved' AND is_void=0 THEN total_amount ELSE 0 END),2) AS approved_total,
      ROUND(SUM(CASE WHEN approval_status='pending'  AND is_void=0 THEN total_amount ELSE 0 END),2) AS pending_total,
      ROUND(SUM(CASE WHEN approval_status='rejected' AND is_void=0 THEN total_amount ELSE 0 END),2) AS rejected_total,
      COUNT(CASE WHEN is_void=0 THEN 1 END) AS settlements_count
    FROM advance_settlements GROUP BY advance_id
  ) st ON st.advance_id = a.id
`;

function deriveStatus(row) {
  if (row.status_locked_by_user && row.status) return row.status;
  const remaining = round2(row.remaining_balance);
  if (row.approval_status !== 'approved') return 'open';
  if (remaining <= 0.005) return 'closed';
  if ((row.pending_total || 0) > 0) return 'under_settlement';
  if ((row.settled_total || 0) > 0) return 'partially_closed';
  return 'open';
}

function decorate(row) {
  if (!row) return row;
  row.remaining_balance = round2(row.remaining_balance);
  row.computed_status = deriveStatus(row);
  row.settlement_progress = row.amount > 0 ? Math.min(100, Math.round((row.settled_total / row.amount) * 10000) / 100) : 0;
  return row;
}

function list(filters = {}, paging = {}) {
  const qb = new QueryBuilder(ADV_SELECT, { orderSql: 'ORDER BY a.advance_date DESC, a.id DESC' });
  qb.where('a.is_void = 0');
  // البحث النصي الحر يشمل: رقم العهدة، البيان، اسم/رقم المقاول، رقم التحويل
  if (filters.search && String(filters.search).trim()) {
    qb.where(`(a.advance_no LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'
               OR c.code LIKE ? ESCAPE '\\' OR t.transfer_no LIKE ? ESCAPE '\\')`,
      ...Array(5).fill(`%${require('../utils/helpers').escapeLike(String(filters.search).trim())}%`));
  }
  qb.eqRaw('a.contractor_id', filters.contractor_id);
  qb.eqRaw('a.project_id', filters.project_id);
  qb.eqRaw('a.cost_center_id', filters.cost_center_id);
  qb.eqRaw('a.funding_source_id', filters.funding_source_id);
  qb.eq('a.approval_status', filters.approval_status);
  qb.in('a.status', filters.status ? String(filters.status).split(',') : null);
  qb.between('a.advance_date', filters.date_from, filters.date_to);
  if (filters.open_only === '1') qb.where('ROUND(a.amount - COALESCE(st.approved_total,0), 2) > 0.005');
  if (filters.closed_only === '1') qb.where('ROUND(a.amount - COALESCE(st.approved_total,0), 2) <= 0.005');

  const res = paginate(qb, {
    allowedSorts: ['a.advance_no', 'a.advance_date', 'a.amount', 'remaining_balance', 'c.name'],
    ...paging
  });
  res.rows = res.rows.map(decorate);
  return res;
}

function getById(id, { includeVoid = true } = {}) {
  const row = getDb().prepare(`${ADV_SELECT} WHERE a.id = ?`).get(id);
  if (!row || (!includeVoid && row.is_void)) throw notFound('العهدة');
  return decorate(row);
}

/** بطاقة العهدة الكاملة: العهد + التحويلات + الإخلاءات + المرفقات + السجل */
function getFullCard(id) {
  const db = getDb();
  const advance = getById(id);
  return {
    advance,
    transfers: db.prepare(`
      SELECT t.id, t.transfer_no, t.transfer_date, t.amount, t.bank_ref, t.purpose,
             t.approval_status, t.is_void, t.funding_source_id, fs.name AS funding_source_name
      FROM transfers t LEFT JOIN funding_sources fs ON fs.id = t.funding_source_id
      WHERE t.advance_id = ? OR t.id = ? ORDER BY t.transfer_date`).all(id, advance.transfer_id),
    settlements: db.prepare(`
      SELECT s.*, acc.code AS account_code, acc.name AS account_name, u.full_name AS created_by_name
      FROM advance_settlements s
      LEFT JOIN accounts acc ON acc.id = s.account_id
      LEFT JOIN users u ON u.id = s.created_by
      WHERE s.advance_id = ? ORDER BY s.settlement_date, s.id`).all(id),
    attachments: db.prepare(`SELECT * FROM attachments WHERE entity_type='advance' AND entity_id = ? AND is_void = 0`).all(id),
    audit_trail: db.prepare(`SELECT * FROM audit_logs WHERE entity_type='advance' AND entity_id = ? ORDER BY created_at DESC LIMIT 50`).all(id)
  };
}

/** رصيد عهدة محسوب لحظيًا (يُستخدم في كل عمليات التحقق) */
function getBalance(advanceId) {
  const db = getDb();
  const adv = db.prepare('SELECT id, amount, approval_status, is_void FROM advances WHERE id = ?').get(advanceId);
  if (!adv) throw notFound('العهدة');
  const s = db.prepare(`SELECT
      ROUND(COALESCE(SUM(CASE WHEN approval_status='approved' AND is_void=0 THEN total_amount ELSE 0 END), 0), 2) AS approved_total,
      ROUND(COALESCE(SUM(CASE WHEN approval_status='pending'  AND is_void=0 THEN total_amount ELSE 0 END), 0), 2) AS pending_total,
      COUNT(CASE WHEN is_void=0 THEN 1 END) AS cnt
    FROM advance_settlements WHERE advance_id = ?`).get(advanceId);
  const approved = round2(s.approved_total || 0);
  return {
    advance_id: advanceId,
    amount: round2(adv.amount),
    settled_total: approved,
    pending_total: round2(s.pending_total || 0),
    settlements_count: s.cnt || 0,
    remaining: round2(adv.amount - approved),
    reserved: round2(adv.amount - approved - (s.pending_total || 0))
  };
}

/** إعادة احتساب حالة العهدة بعد أي تغيير في الإخلاءات */
function refreshStatus(advanceId) {
  const db = getDb();
  const row = getDb().prepare(`${ADV_SELECT} WHERE a.id = ?`).get(advanceId);
  if (!row) return;
  const next = deriveStatus(decorate({ ...row }));
  const closed_at = next === 'closed'
    ? (row.closed_at || new Date().toISOString())
    : (next === 'open' ? null : row.closed_at);
  db.prepare('UPDATE advances SET status = ?, closed_at = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(next, closed_at, advanceId);
  return next;
}

function validatePayload(body, { isUpdate = false } = {}) {
  const db = getDb();
  const contractor = reqId(body.contractor_id, 'المقاول');
  if (!db.prepare('SELECT id FROM contractors WHERE id = ?').get(contractor)) throw badRequest('المقاول غير موجود');

  const project = reqId(body.project_id, 'المشروع');
  if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(project)) throw badRequest('المشروع غير موجود');

  const funding = reqId(body.funding_source_id, 'مصدر التمويل');
  if (!db.prepare('SELECT id FROM funding_sources WHERE id = ?').get(funding)) throw badRequest('مصدر التمويل غير موجود');

  const amount = reqMoney(body.amount, 'المبلغ المطلوب');
  const description = reqStr(body.description, 'بيان العهدة', 500);

  let costCenter = optId(body.cost_center_id);
  if (costCenter) {
    const cc = db.prepare('SELECT * FROM cost_centers WHERE id = ?').get(costCenter);
    if (!cc) throw badRequest('مركز التكلفة غير موجود');
    if (cc.project_id !== project) throw badRequest('مركز التكلفة لا يتبع المشروع المحدد');
  } else {
    costCenter = db.prepare('SELECT id FROM cost_centers WHERE project_id = ? AND is_main = 1').get(project)?.id || null;
  }

  const transferId = optId(body.transfer_id);
  let transfer = null;
  if (transferId) {
    transfer = db.prepare('SELECT * FROM transfers WHERE id = ?').get(transferId);
    if (!transfer) throw badRequest('التحويل المحدد غير موجود');
    if (transfer.is_void) throw badRequest('التحويل المحدد ملغى');
    if (transfer.funding_source_id !== funding) throw badRequest('مصدر تمويل التحويل لا يطابق مصدر تمويل العهدة');
    if (transfer.contractor_id && transfer.contractor_id !== contractor) throw badRequest('مقاول التحويل لا يطابق مقاول العهدة');
    if (!eqMoney(transfer.amount, amount) && !body.allow_amount_mismatch) {
      throw badRequest(`قيمة التحويل (${round2(transfer.amount)}) لا تطابق مبلغ العهدة (${amount}). صحّح المبلغ أو فعّل خيار "السماح بالفرق".`, { field: 'amount' });
    }
  }

  return {
    contractor_id: contractor,
    project_id: project,
    cost_center_id: costCenter,
    funding_source_id: funding,
    amount,
    description,
    advance_date: reqDate(body.advance_date, 'تاريخ العهدة'),
    transfer_id: transferId,
    transfer: transfer,
    transfer_no: optStr(body.transfer_no, 60) || transfer?.transfer_no || null,
    transfer_date: optDate(body.transfer_date) || transfer?.transfer_date || null,
    beneficiary_name: optStr(body.beneficiary_name, 160),
    notes: optStr(body.notes, 1000),
    currency: 'SAR'
  };
}

function create(body, ctx) {
  const data = validatePayload(body);
  const advanceNo = cleanAdvanceNo(body.advance_no) || nextDocNo('advance');

  const dup = getDb().prepare('SELECT id FROM advances WHERE advance_no = ?').get(advanceNo);
  if (dup) throw badRequest(`رقم العهدة ${advanceNo} مستخدم مسبقًا`);

  const id = tx(() => {
    const db = getDb();
    const r = db.prepare(`INSERT INTO advances
      (advance_no, advance_date, contractor_id, project_id, cost_center_id, funding_source_id,
       transfer_id, transfer_no, transfer_date, beneficiary_name, description, amount, currency,
       approval_status, status, notes, created_by)
      VALUES (@advance_no,@advance_date,@contractor_id,@project_id,@cost_center_id,@funding_source_id,
              @transfer_id,@transfer_no,@transfer_date,@beneficiary_name,@description,@amount,@currency,
              @approval_status,@status,@notes,@created_by)`)
      .run({
        advance_no: advanceNo,
        advance_date: data.advance_date,
        contractor_id: data.contractor_id,
        project_id: data.project_id,
        cost_center_id: data.cost_center_id,
        funding_source_id: data.funding_source_id,
        transfer_id: data.transfer_id,
        transfer_no: data.transfer_no,
        transfer_date: data.transfer_date,
        beneficiary_name: data.beneficiary_name,
        description: data.description,
        amount: data.amount,
        currency: data.currency,
        // يُنشأ دائمًا كمسودة؛ الاعتماد يمر عبر approve()
        approval_status: 'draft',
        status: 'open',
        notes: data.notes,
        created_by: ctx.user.id
      });
    const newId = r.lastInsertRowid;
    // ربط عكسي بالتحويل
    if (data.transfer_id) {
      db.prepare('UPDATE transfers SET advance_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newId, data.transfer_id);
    }
    audit.log(ctx, {
      action: 'create', entityType: 'advance', entityId: newId, entityLabel: advanceNo,
      summary: `إنشاء عهدة ${advanceNo} بقيمة ${round2(data.amount)}`,
      newValues: { advance_no: advanceNo, amount: data.amount, contractor_id: data.contractor_id, funding_source_id: data.funding_source_id, transfer_id: data.transfer_id }
    });
    return newId;
  });

  const advance = getById(id);
  if (body.auto_approve) return approve(id, ctx);
  return advance;
}

function cleanAdvanceNo(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > 40) throw badRequest('رقم العهدة طويل جدًا');
  return s;
}

function update(id, body, ctx) {
  const before = getById(id);
  if (before.is_void) throw badRequest('لا يمكن تعديل عهدة ملغاة');
  if (before.approval_status === 'approved' && (before.settled_total || 0) > 0) {
    throw badRequest('لا يمكن تعديل عهدة معتمدة لها إخلاءات مسجَّلة. ألغِ الإخلاءات أولًا.');
  }
  const data = validatePayload({ ...before, ...body }, { isUpdate: true });
  const advanceNo = cleanAdvanceNo(body.advance_no) || before.advance_no;

  const dup = getDb().prepare('SELECT id FROM advances WHERE advance_no = ? AND id <> ?').get(advanceNo, id);
  if (dup) throw badRequest(`رقم العهدة ${advanceNo} مستخدم مسبقًا`);

  tx(() => {
    const db = getDb();
    // فك الارتباط القديم بالتحويل
    if (before.transfer_id && before.transfer_id !== data.transfer_id) {
      db.prepare('UPDATE transfers SET advance_id = NULL WHERE id = ? AND advance_id = ?').run(before.transfer_id, id);
    }
    db.prepare(`UPDATE advances SET
        advance_no=@advance_no, advance_date=@advance_date, contractor_id=@contractor_id, project_id=@project_id,
        cost_center_id=@cost_center_id, funding_source_id=@funding_source_id, transfer_id=@transfer_id,
        transfer_no=@transfer_no, transfer_date=@transfer_date, beneficiary_name=@beneficiary_name,
        description=@description, amount=@amount, notes=@notes, updated_at=datetime('now')
      WHERE id=@id`).run({
      id,
      advance_no: advanceNo,
      advance_date: data.advance_date,
      contractor_id: data.contractor_id,
      project_id: data.project_id,
      cost_center_id: data.cost_center_id,
      funding_source_id: data.funding_source_id,
      transfer_id: data.transfer_id,
      transfer_no: data.transfer_no,
      transfer_date: data.transfer_date,
      beneficiary_name: data.beneficiary_name,
      description: data.description,
      amount: data.amount,
      notes: data.notes
    });
    if (data.transfer_id) db.prepare('UPDATE transfers SET advance_id = ? WHERE id = ?').run(id, data.transfer_id);

    audit.log(ctx, {
      action: 'update', entityType: 'advance', entityId: id, entityLabel: advanceNo,
      summary: `تعديل العهدة ${advanceNo}`,
      oldValues: before,
      newValues: { advance_no: advanceNo, ...data }
    });
  });
  refreshStatus(id);
  return getById(id);
}

function approve(id, ctx) {
  const row = getById(id);
  if (row.is_void) throw badRequest('لا يمكن اعتماد عهدة ملغاة');
  if (row.approval_status === 'approved') return row;
  // منع اعتماد عملية ناقصة البيانات
  const missing = [];
  if (!row.contractor_id) missing.push('المقاول');
  if (!row.project_id) missing.push('المشروع');
  if (!row.funding_source_id) missing.push('مصدر التمويل');
  if (!row.description) missing.push('بيان العهدة');
  if (!row.amount || row.amount <= 0) missing.push('المبلغ');
  if (!row.advance_date) missing.push('تاريخ العهدة');
  if (missing.length) throw badRequest(`لا يمكن الاعتماد — بيانات ناقصة: ${missing.join('، ')}`, { missing });

  tx(() => {
    getDb().prepare(`UPDATE advances SET approval_status='approved', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(ctx.user.id, id);
    audit.log(ctx, {
      action: 'approve', entityType: 'advance', entityId: id, entityLabel: row.advance_no,
      summary: `اعتماد العهدة ${row.advance_no} بقيمة ${round2(row.amount)}`,
      oldValues: { approval_status: row.approval_status }, newValues: { approval_status: 'approved' }
    });
  });
  refreshStatus(id);
  return getById(id);
}

function reject(id, ctx, reason) {
  const row = getById(id);
  if (row.approval_status === 'approved') throw badRequest('لا يمكن رفض عهدة معتمدة');
  tx(() => {
    getDb().prepare(`UPDATE advances SET approval_status='rejected', notes=COALESCE(notes,'') || ? , updated_at=datetime('now') WHERE id=?`)
      .run(`\n[رفض] ${reason || ''}`, id);
    audit.log(ctx, {
      action: 'reject', entityType: 'advance', entityId: id, entityLabel: row.advance_no,
      summary: `رفض العهدة ${row.advance_no}`, newValues: { approval_status: 'rejected', reason }
    });
  });
  return getById(id);
}

/**
 * إغلاق العهدة
 * لا يُسمح بالإغلاق إذا كان هناك رصيد غير مسوَّى إلا بتأكيد صريح + صلاحية advances.close
 */
function close(id, ctx, { confirm = false, reason = null } = {}) {
  const row = getById(id);
  const bal = getBalance(id);
  if (row.status === 'closed' && !row.status_locked_by_user) return row;

  if (bal.remaining > 0.005) {
    if (!confirm) {
      throw badRequest(
        `العهدة ${row.advance_no} لها رصيد غير مسوَّى قدره ${round2(bal.remaining)} ريال. يجب تأكيد الإغلاق.`,
        409, 'UNSETTLED_BALANCE', { remaining: bal.remaining, advance_no: row.advance_no }
      );
    }
    if (!ctx.user.permissions.has('advances.close')) {
      throw badRequest('إغلاق عهدة برصيد غير مسوَّى يتطلب صلاحية "إغلاق العهدة".', 403, 'FORBIDDEN', { remaining: bal.remaining });
    }
  }

  tx(() => {
    getDb().prepare(`UPDATE advances SET status='closed', status_locked_by_user=1, closed_at=datetime('now'),
        notes = COALESCE(notes,'') || ?, updated_at=datetime('now') WHERE id=?`)
      .run(reason ? `\n[إغلاق] ${reason}` : '', id);
    audit.log(ctx, {
      action: 'close', entityType: 'advance', entityId: id, entityLabel: row.advance_no,
      summary: `إغلاق العهدة ${row.advance_no} (رصيد متبقٍ: ${bal.remaining})`,
      oldValues: { status: row.status, remaining: bal.remaining }, newValues: { status: 'closed', reason }
    });
  });
  return getById(id);
}

function reopen(id, ctx) {
  const row = getById(id);
  tx(() => {
    getDb().prepare(`UPDATE advances SET status='open', status_locked_by_user=0, closed_at=NULL, updated_at=datetime('now') WHERE id=?`).run(id);
    audit.log(ctx, {
      action: 'reopen', entityType: 'advance', entityId: id, entityLabel: row.advance_no,
      summary: `إعادة فتح العهدة ${row.advance_no}`, oldValues: { status: row.status }, newValues: { status: 'open' }
    });
  });
  refreshStatus(id);
  return getById(id);
}

/** إلغاء (بدل الحذف النهائي) */
function voidAdvance(id, ctx, reason) {
  const row = getById(id);
  if (row.is_void) throw badRequest('العهدة ملغاة مسبقًا');
  const r = optStr(reason, 500);
  if (!r) throw badRequest('يجب ذكر سبب الإلغاء');
  const activeSettlements = getDb().prepare('SELECT COUNT(*) c FROM advance_settlements WHERE advance_id = ? AND is_void = 0').get(id).c;
  if (activeSettlements > 0) throw badRequest(`لا يمكن إلغاء العهدة لوجود ${activeSettlements} إخلاء مرتبط بها`);

  tx(() => {
    const db = getDb();
    db.prepare(`UPDATE advances SET is_void=1, void_reason=?, voided_at=datetime('now'), voided_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(r, ctx.user.id, id);
    if (row.transfer_id) db.prepare('UPDATE transfers SET advance_id = NULL WHERE id = ?').run(row.transfer_id);
    ledger.voidEntriesFor('advance', id);
    audit.log(ctx, {
      action: 'void', entityType: 'advance', entityId: id, entityLabel: row.advance_no,
      summary: `إلغاء العهدة ${row.advance_no}: ${r}`, oldValues: row, newValues: { is_void: 1, void_reason: r }
    });
  });
  return getById(id);
}

function totals(filters = {}) {
  const qb = new QueryBuilder(`
    SELECT ROUND(COALESCE(SUM(a.amount),0),2) AS total_advances,
           ROUND(COALESCE(SUM(a.amount - COALESCE(st.approved_total,0)),0),2) AS total_remaining,
           COUNT(*) AS count
    FROM advances a
    LEFT JOIN (SELECT advance_id, SUM(CASE WHEN approval_status='approved' AND is_void=0 THEN total_amount ELSE 0 END) AS approved_total
               FROM advance_settlements GROUP BY advance_id) st ON st.advance_id = a.id
  `);
  qb.where('a.is_void = 0');
  return { total: qb.scalar() };
}

module.exports = {
  ADV_SELECT, list, getById, getFullCard, getBalance, refreshStatus, deriveStatus,
  create, update, approve, reject, close, reopen, voidAdvance
};
