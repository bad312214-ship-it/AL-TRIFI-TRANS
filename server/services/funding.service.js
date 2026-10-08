'use strict';
/**
 * خدمة مصادر التمويل
 * المصدر هو أصل كل تحويل، ويُحسب إجمالي تمويله تلقائيًا من التحويلات المعتمدة.
 */
const { getDb, tx } = require('../db');
const { notFound, round2 } = require('../utils/helpers');
const { QueryBuilder, paginate, reqStr, optStr, optMoney, optId } = require('../utils/validators');
const audit = require('./audit.service');

const SELECT = `
  SELECT fs.*, a.code AS account_code, a.name AS account_name,
    (SELECT ROUND(SUM(t.amount),2) FROM transfers t
       WHERE t.funding_source_id = fs.id AND t.is_void = 0 AND t.approval_status = 'approved') AS total_transferred,
    (SELECT ROUND(SUM(t.amount),2) FROM transfers t
       WHERE t.funding_source_id = fs.id AND t.is_void = 0 AND t.approval_status IN ('draft','pending')) AS pending_transfers,
    (SELECT COUNT(*) FROM transfers t WHERE t.funding_source_id = fs.id AND t.is_void = 0) AS transfers_count,
    (SELECT ROUND(SUM(a.amount),2) FROM advances a
       WHERE a.funding_source_id = fs.id AND a.is_void = 0 AND a.approval_status = 'approved') AS total_advances
  FROM funding_sources fs
  LEFT JOIN accounts a ON a.id = fs.account_id
`;

function list(filters = {}, paging = {}) {
  const qb = new QueryBuilder(SELECT, { orderSql: 'ORDER BY fs.id ASC' });
  qb.like('fs.name', filters.search).like('fs.code', filters.search);
  qb.eq('fs.is_active', filters.is_active);
  return paginate(qb, { allowedSorts: ['fs.name', 'fs.code', 'total_transferred'], ...paging });
}

function getById(id) {
  const row = getDb().prepare(`${SELECT} WHERE fs.id = ?`).get(id);
  if (!row) throw notFound('مصدر التمويل');
  return row;
}

function create(body, ctx) {
  const data = {
    code: reqStr(body.code, 'رمز المصدر', 30).toUpperCase(),
    name: reqStr(body.name, 'اسم مصدر التمويل', 120),
    account_id: optId(body.account_id),
    opening_balance: optMoney(body.opening_balance),
    credit_limit: body.credit_limit === null || body.credit_limit === undefined || body.credit_limit === ''
      ? null : optMoney(body.credit_limit),
    description: optStr(body.description, 500),
    is_active: body.is_active === 0 || body.is_active === false ? 0 : 1,
    created_by: ctx.user.id
  };
  const row = tx(() => {
    const created = getDb().prepare(`INSERT INTO funding_sources
      (code, name, account_id, opening_balance, credit_limit, description, is_active, created_by)
      VALUES (@code, @name, @account_id, @opening_balance, @credit_limit, @description, @is_active, @created_by)`)
      .run(data);
    audit.log(ctx, {
      action: 'create', entityType: 'funding_source', entityId: created.lastInsertRowid,
      entityLabel: data.name, summary: `إضافة مصدر تمويل: ${data.name}`, newValues: data
    });
    return created.lastInsertRowid;
  });
  return getById(row);
}

function update(id, body, ctx) {
  const before = getById(id);
  const data = {};
  if (body.name !== undefined) data.name = reqStr(body.name, 'اسم مصدر التمويل', 120);
  if (body.code !== undefined) data.code = reqStr(body.code, 'رمز المصدر', 30).toUpperCase();
  if (body.account_id !== undefined) data.account_id = optId(body.account_id);
  if (body.opening_balance !== undefined) data.opening_balance = optMoney(body.opening_balance);
  if (body.credit_limit !== undefined) {
    data.credit_limit = body.credit_limit === null || body.credit_limit === '' ? null : optMoney(body.credit_limit);
  }
  if (body.description !== undefined) data.description = optStr(body.description, 500);
  if (body.is_active !== undefined) data.is_active = body.is_active ? 1 : 0;
  if (!Object.keys(data).length) return before;
  data.updated_at = new Date().toISOString();
  tx(() => {
    const db = getDb();
    db.prepare(`UPDATE funding_sources SET
        code = @code, name = @name, account_id = @account_id, opening_balance = @opening_balance,
        credit_limit = @credit_limit, description = @description, is_active = @is_active, updated_at = @updated_at
        WHERE id = @id`)
      .run({ id, ...{
        code: data.code ?? before.code, name: data.name ?? before.name,
        account_id: data.account_id !== undefined ? data.account_id : before.account_id,
        opening_balance: data.opening_balance ?? before.opening_balance,
        credit_limit: data.credit_limit !== undefined ? data.credit_limit : before.credit_limit,
        description: data.description !== undefined ? data.description : before.description,
        is_active: data.is_active !== undefined ? data.is_active : before.is_active,
        updated_at: data.updated_at
      }});
    audit.log(ctx, {
      action: 'update', entityType: 'funding_source', entityId: id, entityLabel: before.name,
      summary: `تعديل مصدر التمويل: ${before.name}`,
      oldValues: before, newValues: { ...before, ...data }
    });
  });
  return getById(id);
}

/** الإلغاء (بدل الحذف النهائي) - يُمنع إذا كانت هناك تحويلات مرتبطة */
function deactivate(id, ctx, hardVoid = false) {
  const row = getById(id);
  const used = getDb().prepare('SELECT COUNT(*) c FROM transfers WHERE funding_source_id = ? AND is_void = 0').get(id).c;
  if (used > 0 && hardVoid) {
    const { badRequest } = require('../utils/helpers');
    throw badRequest(`لا يمكن إلغاء المصدر لوجود ${used} تحويل مرتبط به. يمكنك تعطيله بدلًا من ذلك.`);
  }
  tx(() => {
    getDb().prepare('UPDATE funding_sources SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(id);
    audit.log(ctx, {
      action: 'void', entityType: 'funding_source', entityId: id, entityLabel: row.name,
      summary: `تعطيل مصدر التمويل: ${row.name}`, oldValues: row
    });
  });
  return getById(id);
}

/**
 * تحليل مصادر التمويل:
 * إجمالي التحويلات / المستخدم في العهد / المستخدم مع الموردين / المتبقي
 */
function analysis({ from, to, projectId } = {}) {
  const db = getDb();
  const range = (from || to) ? `AND date(t.transfer_date) BETWEEN date(COALESCE(?, '0000-01-01')) AND date(COALESCE(?, '9999-12-31'))` : '';
  const params = range ? [from || null, to || null] : [];
  const projCond = projectId ? 'AND t.project_id = ?' : '';
  if (projectId) params.push(projectId);

  const rows = db.prepare(`
    SELECT fs.id, fs.code, fs.name, fs.opening_balance, fs.credit_limit,
      ROUND(COALESCE(SUM(CASE WHEN t.approval_status='approved' AND t.is_void=0 THEN t.amount END),0),2) AS total_transfers,
      ROUND(COALESCE(SUM(CASE WHEN t.approval_status IN ('draft','pending') AND t.is_void=0 THEN t.amount END),0),2) AS pending_transfers,
      ROUND(COALESCE(SUM(CASE WHEN t.transfer_type='advance' AND t.approval_status='approved' AND t.is_void=0 THEN t.amount END),0),2) AS to_advances,
      ROUND(COALESCE(SUM(CASE WHEN t.transfer_type='supplier' AND t.approval_status='approved' AND t.is_void=0 THEN t.amount END),0),2) AS to_suppliers,
      ROUND(COALESCE(SUM(CASE WHEN t.transfer_type='other' AND t.approval_status='approved' AND t.is_void=0 THEN t.amount END),0),2) AS to_other,
      COUNT(CASE WHEN t.is_void = 0 THEN 1 END) AS transfers_count
    FROM funding_sources fs
    LEFT JOIN transfers t ON t.funding_source_id = fs.id ${range} ${projCond}
    WHERE fs.is_active = 1
    GROUP BY fs.id
    ORDER BY total_transfers DESC, fs.name
  `).all(params);

  return rows.map(r => ({
    ...r,
    used: round2(r.to_advances + r.to_suppliers + r.to_other),
    remaining_limit: r.credit_limit === null ? null : round2(r.credit_limit - (r.total_transfers || 0))
  }));
}

function summary() {
  const rows = analysis();
  return {
    sources: rows,
    total: round2(rows.reduce((s, r) => s + (r.total_transfers || 0), 0))
  };
}

module.exports = { list, getById, create, update, deactivate, analysis, summary };
