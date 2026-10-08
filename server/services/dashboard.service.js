'use strict';
/**
 * لوحة التحكم - كل الأرقام تُحتسب لحظيًا من العمليات المسجلة
 */
const { getDb } = require('../db');
const { round2 } = require('../utils/helpers');
const funding = require('./funding.service');

const BASE_FILTERS = (projectId) => {
  const params = [];
  const cond = projectId ? 'AND project_id = ?' : '';
  if (projectId) params.push(projectId);
  return { cond, params };
};

function kpis({ projectId = null, from = null, to = null } = {}) {
  const db = getDb();
  const proj = projectId ? Number(projectId) : null;
  const pCond = (alias) => proj ? `AND ${alias}.project_id = ?` : '';
  const range = (alias, col) => {
    const parts = [];
    if (from) parts.push(`date(${alias}.${col}) >= date(?)`);
    if (to) parts.push(`date(${alias}.${col}) <= date(?)`);
    return parts.length ? `AND ${parts.join(' AND ')}` : '';
  };
  const baseParams = [];
  if (proj) baseParams.push(proj);
  const rangeParams = [];
  if (from) rangeParams.push(from);
  if (to) rangeParams.push(to);
  const params = (n = 1) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(...baseParams, ...rangeParams);
    return out;
  };

  const scalar = (sql, ps) => {
    const r = db.prepare(sql).get(ps);
    return r ? Object.values(r)[0] : 0;
  };

  // التحويلات
  const transfersTotal = round2(scalar(`
    SELECT COALESCE(SUM(amount),0) v FROM transfers
    WHERE is_void = 0 AND approval_status = 'approved' ${pCond('transfers')} ${range('transfers', 'transfer_date')}`, params()));
  const transfersCount = scalar(`
    SELECT COUNT(*) v FROM transfers WHERE is_void = 0 AND approval_status = 'approved' ${pCond('transfers')} ${range('transfers', 'transfer_date')}`, params());
  const transfersPending = round2(scalar(`
    SELECT COALESCE(SUM(amount),0) v FROM transfers
    WHERE is_void = 0 AND approval_status IN ('draft','pending') ${pCond('transfers')}`, [...baseParams]));

  // العهد
  const advancesTotal = round2(scalar(`
    SELECT COALESCE(SUM(a.amount),0) v FROM advances a
    WHERE a.is_void = 0 AND a.approval_status = 'approved' ${pCond('a')} ${range('a', 'advance_date')}`, params()));
  const advancesCount = scalar(`
    SELECT COUNT(*) v FROM advances a WHERE a.is_void = 0 AND a.approval_status='approved' ${pCond('a')} ${range('a','advance_date')}`, params());

  const balancesCte = `
    SELECT a.id, a.amount, a.status,
      COALESCE((SELECT SUM(s.total_amount) FROM advance_settlements s
                WHERE s.advance_id = a.id AND s.is_void = 0 AND s.approval_status='approved'),0) AS settled
    FROM advances a
    WHERE a.is_void = 0 AND a.approval_status = 'approved' ${pCond('a')} ${range('a','advance_date')}`;

  const openAdvances = scalar(`SELECT COUNT(*) v FROM (${balancesCte}) x WHERE x.amount - x.settled > 0.005`, params());
  const closedAdvances = scalar(`SELECT COUNT(*) v FROM (${balancesCte}) x WHERE x.amount - x.settled <= 0.005`, params());
  const openAdvancesAmount = round2(scalar(`SELECT COALESCE(SUM(x.amount - x.settled),0) v FROM (${balancesCte}) x WHERE x.amount - x.settled > 0.005`, params()));
  const openAdvancesPrincipal = round2(scalar(`SELECT COALESCE(SUM(x.amount),0) v FROM (${balancesCte}) x WHERE x.amount - x.settled > 0.005`, params()));
  const closedAdvancesAmount = round2(scalar(`SELECT COALESCE(SUM(x.amount),0) v FROM (${balancesCte}) x WHERE x.amount - x.settled <= 0.005`, params()));

  // الإخلاءات
  const settlementsTotal = round2(scalar(`
    SELECT COALESCE(SUM(s.total_amount),0) v FROM advance_settlements s JOIN advances a ON a.id = s.advance_id
    WHERE s.is_void = 0 AND s.approval_status = 'approved' ${pCond('s')} ${range('s','settlement_date')}`, params()));
  const settlementsPending = round2(scalar(`
    SELECT COALESCE(SUM(s.total_amount),0) v FROM advance_settlements s JOIN advances a ON a.id = s.advance_id
    WHERE s.is_void = 0 AND s.approval_status = 'pending' ${pCond('s')}`, [...baseParams]));
  const settlementsCount = scalar(`
    SELECT COUNT(*) v FROM advance_settlements s JOIN advances a ON a.id = s.advance_id
    WHERE s.is_void = 0 AND s.approval_status='approved' ${pCond('s')} ${range('s','settlement_date')}`, params());

  // فواتير الموردين
  const invoicesTotal = round2(scalar(`
    SELECT COALESCE(SUM(i.total_amount),0) v FROM supplier_invoices i
    WHERE i.is_void = 0 AND i.approval_status='approved' ${pCond('i')} ${range('i','invoice_date')}`, params()));
  const invoicesCount = scalar(`
    SELECT COUNT(*) v FROM supplier_invoices i WHERE i.is_void = 0 AND i.approval_status='approved' ${pCond('i')} ${range('i','invoice_date')}`, params());
  const suppliersPaid = round2(scalar(`
    SELECT COALESCE(SUM(p.amount),0) v FROM payments p
    WHERE p.is_void = 0 AND p.approval_status='approved' AND p.supplier_id IS NOT NULL ${pCond('p')} ${range('p','payment_date')}`, params()));
  const suppliersDue = round2(invoicesTotal - round2(scalar(`
    SELECT COALESCE(SUM(pay.amount),0) v FROM payments pay JOIN supplier_invoices i2 ON i2.id = pay.supplier_invoice_id
    WHERE pay.is_void = 0 AND pay.approval_status='approved' AND i2.is_void = 0 AND i2.approval_status='approved'
      ${pCond('i2')} ${range('i2','invoice_date')}`, params())));

  return {
    transfers: { total: transfersTotal, count: transfersCount, pending: transfersPending },
    advances: {
      total: advancesTotal, count: advancesCount,
      open_count: openAdvances, open_amount: openAdvancesAmount, open_principal: openAdvancesPrincipal,
      closed_count: closedAdvances, closed_amount: closedAdvancesAmount
    },
    settlements: { total: settlementsTotal, count: settlementsCount, pending: settlementsPending },
    supplier_invoices: { total: invoicesTotal, count: invoicesCount },
    suppliers: { paid: suppliersPaid, due: suppliersDue },
    remaining_advances_balance: round2(advancesTotal - settlementsTotal)
  };
}

/** توزيع حالات العهد + حركة شهرية + أعلى المقاولين */
function charts({ projectId = null, months = 6 } = {}) {
  const db = getDb();
  const proj = projectId ? Number(projectId) : null;
  const pCond = proj ? 'AND a.project_id = ?' : '';
  const pCond2 = proj ? 'AND t.project_id = ?' : '';
  const params = proj ? [proj] : [];

  const statusDist = db.prepare(`
    SELECT
      SUM(CASE WHEN remaining > 0.005 AND settled_total = 0 THEN 1 ELSE 0 END) AS open_count,
      ROUND(COALESCE(SUM(CASE WHEN remaining > 0.005 AND settled_total = 0 THEN remaining END),0),2) AS open_amount,
      SUM(CASE WHEN remaining > 0.005 AND settled_total > 0 THEN 1 ELSE 0 END) AS partial_count,
      ROUND(COALESCE(SUM(CASE WHEN remaining > 0.005 AND settled_total > 0 THEN remaining END),0),2) AS partial_amount,
      SUM(CASE WHEN remaining <= 0.005 THEN 1 ELSE 0 END) AS closed_count,
      ROUND(COALESCE(SUM(CASE WHEN remaining <= 0.005 THEN amount END),0),2) AS closed_amount
    FROM (
      SELECT a.id, a.amount,
        COALESCE((SELECT SUM(s.total_amount) FROM advance_settlements s WHERE s.advance_id=a.id AND s.is_void=0 AND s.approval_status='approved'),0) AS settled_total,
        ROUND(a.amount - COALESCE((SELECT SUM(s.total_amount) FROM advance_settlements s WHERE s.advance_id=a.id AND s.is_void=0 AND s.approval_status='approved'),0),2) AS remaining
      FROM advances a WHERE a.is_void = 0 AND a.approval_status='approved' ${pCond}
    )`).get(params);

  const monthly = db.prepare(`
    SELECT strftime('%Y-%m', t.transfer_date) AS month,
           ROUND(COALESCE(SUM(t.amount),0),2) AS amount,
           COUNT(*) AS count
    FROM transfers t
    WHERE t.is_void = 0 AND t.approval_status='approved' ${pCond2}
      AND date(t.transfer_date) >= date('now', ?)
    GROUP BY month ORDER BY month`).all([`-${Number(months)} months`, ...params]);

  const topContractors = db.prepare(`
    SELECT c.id, c.name,
      ROUND(COALESCE(SUM(a.amount),0),2) AS total_advances,
      ROUND(COALESCE(SUM(a.amount) - SUM(COALESCE(st.settled,0)),0),2) AS remaining
    FROM contractors c
    JOIN advances a ON a.contractor_id = c.id AND a.is_void = 0 AND a.approval_status='approved'
    LEFT JOIN (SELECT advance_id, SUM(total_amount) AS settled FROM advance_settlements
               WHERE is_void=0 AND approval_status='approved' GROUP BY advance_id) st ON st.advance_id = a.id
    ${proj ? 'WHERE a.project_id = ?' : ''}
    GROUP BY c.id ORDER BY total_advances DESC LIMIT 8`).all(params);

  const byType = db.prepare(`
    SELECT t.transfer_type AS type, ROUND(COALESCE(SUM(t.amount),0),2) AS amount, COUNT(*) AS count
    FROM transfers t WHERE t.is_void = 0 AND t.approval_status='approved' ${pCond2}
    GROUP BY t.transfer_type`).all(params);

  return { status_distribution: statusDist, monthly_transfers: monthly, top_contractors: topContractors, transfers_by_type: byType };
}

/** التنبيهات: عمليات تحتاج مراجعة */
function alerts({ projectId = null } = {}) {
  const db = getDb();
  const proj = projectId ? Number(projectId) : null;
  const pCond = proj ? 'AND project_id = ?' : '';
  const params = proj ? [proj] : [];
  const s = (sql, ps = params) => { const r = db.prepare(sql).get(ps); return r ? Object.values(r)[0] : 0; };

  return {
    transfers_pending_approval: s(`SELECT COUNT(*) v FROM transfers WHERE is_void=0 AND approval_status IN ('draft','pending') ${pCond}`),
    advances_pending_approval: s(`SELECT COUNT(*) v FROM advances WHERE is_void=0 AND approval_status IN ('draft','pending') ${pCond}`),
    settlements_pending: s(`SELECT COUNT(*) v FROM advance_settlements s JOIN advances a ON a.id=s.advance_id WHERE s.is_void=0 AND s.approval_status='pending' ${proj ? 'AND s.project_id = ?' : ''}`),
    invoices_pending: s(`SELECT COUNT(*) v FROM supplier_invoices WHERE is_void=0 AND approval_status IN ('draft','pending') ${pCond}`),
    over_settlements: s(`SELECT COUNT(*) v FROM advance_settlements WHERE is_void=0 AND over_settlement=1 ${pCond}`),
    advances_unsettled: s(`SELECT COUNT(*) v FROM advances a WHERE a.is_void=0 AND a.approval_status='approved' ${proj ? 'AND a.project_id = ?' : ''}
      AND a.amount - COALESCE((SELECT SUM(s.total_amount) FROM advance_settlements s WHERE s.advance_id=a.id AND s.is_void=0 AND s.approval_status='approved'),0) > 0.005`),
    overdue_invoices: s(`SELECT COUNT(*) v FROM supplier_invoices i WHERE i.is_void=0 AND i.approval_status='approved' ${proj ? 'AND i.project_id = ?' : ''}
      AND i.due_date IS NOT NULL AND date(i.due_date) < date('now')
      AND i.total_amount - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.supplier_invoice_id=i.id AND p.is_void=0 AND p.approval_status='approved'),0) > 0.005`)
  };
}

function lastActivity(limit = 12) {
  return getDb().prepare(`
    SELECT al.action, al.entity_type, al.entity_label, al.summary, al.username, al.created_at
    FROM audit_logs al
    WHERE al.action IN ('create','approve','void','close','update')
    ORDER BY al.created_at DESC, al.id DESC LIMIT ?`).all([limit]);
}

function overview(query = {}) {
  const projectId = query.project_id ? Number(query.project_id) : null;
  const from = query.from || null;
  const to = query.to || null;
  const project = projectId
    ? getDb().prepare('SELECT id, code, name FROM projects WHERE id = ?').get(projectId)
    : getDb().prepare('SELECT id, code, name FROM projects WHERE is_default = 1').get()
      || getDb().prepare('SELECT id, code, name FROM projects ORDER BY id LIMIT 1').get();
  const effectiveProjectId = projectId || (project ? project.id : null);

  return {
    project,
    generated_at: new Date().toISOString(),
    kpis: kpis({ projectId: effectiveProjectId, from, to }),
    funding_sources: funding.analysis({ from, to, projectId: effectiveProjectId }),
    charts: charts({ projectId: effectiveProjectId }),
    alerts: alerts({ projectId: effectiveProjectId }),
    activity: lastActivity()
  };
}

module.exports = { kpis, charts, alerts, lastActivity, overview };
