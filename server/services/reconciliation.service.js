'use strict';
/**
 * تقرير المطابقة
 * يفحص سلامة الترابط بين: مصدر التمويل → التحويل → العهدة → الإخلاء
 *                              مصدر التمويل → التحويل → المورد → الفاتورة
 * ويبرز كل عملية تحتاج مراجعة.
 */
const { getDb } = require('../db');
const { round2 } = require('../utils/helpers');

const CHECKS = [
  { key: 'transfer_without_advance', label: 'تحويل بدون عهدة', severity: 'high' },
  { key: 'advance_without_transfer', label: 'عهدة بدون تحويل', severity: 'high' },
  { key: 'settlement_without_advance', label: 'إخلاء بدون عهدة صالحة', severity: 'high' },
  { key: 'over_advanced', label: 'إخلاءات تتجاوز قيمة العهدة', severity: 'high' },
  { key: 'duplicate_transfer', label: 'تحويل مكرر', severity: 'high' },
  { key: 'duplicate_invoice', label: 'فاتورة مكررة', severity: 'high' },
  { key: 'unsettled_advance', label: 'عهدة برصيد غير مسوَّى', severity: 'medium' },
  { key: 'amount_mismatch', label: 'فرق بين مبلغ التحويل ومبلغ العهدة', severity: 'medium' },
  { key: 'payment_without_transfer', label: 'دفعة بدون تحويل', severity: 'medium' },
  { key: 'transfer_not_posted', label: 'تحويل معتمد بدون قيد محاسبي', severity: 'high' },
  { key: 'invoice_without_payment', label: 'فاتورة مورد بدون سداد', severity: 'low' },
  { key: 'transfer_without_project', label: 'تحويل بدون مركز تكلفة', severity: 'low' },
  { key: 'advance_without_funding_match', label: 'مصدر تمويل العهدة لا يطابق التحويل', severity: 'medium' },
  { key: 'missing_attachment', label: 'عملية بدون مرفق', severity: 'low' }
];

const SEV_LABEL = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };

function row(check, entity, { reference = null, date = null, amount = null, party = null, issue = null, ids = {} }) {
  const def = CHECKS.find(c => c.key === check);
  return {
    check, severity: def.severity, severity_label: SEV_LABEL[def.severity],
    category: check, category_label: def.label,
    entity_type: entity.type, entity_label: entity.label,
    reference, date, amount: amount === null ? null : round2(amount), party, issue,
    ...ids
  };
}

function run(f = {}) {
  const db = getDb();
  const out = [];
  const proj = f.project_id ? Number(f.project_id) : null;
  const p = (alias) => (proj ? `AND ${alias}.project_id = ${proj}` : '');
  const range = (alias, col) => {
    let s = '';
    if (f.from) s += ` AND date(${alias}.${col}) >= date('${String(f.from).replace(/'/g, '')}')`;
    if (f.to) s += ` AND date(${alias}.${col}) <= date('${String(f.to).replace(/'/g, '')}')`;
    return s;
  };
  const only = f.checks ? String(f.checks).split(',').filter(Boolean) : null;
  const keep = (key) => !only || only.includes(key);

  /* 1) تحويل بدون عهدة */
  if (keep('transfer_without_advance')) {
    for (const r of db.prepare(`
      SELECT t.id, t.transfer_no, t.transfer_date, t.amount, t.beneficiary_name, t.transfer_type,
             c.name AS contractor_name
      FROM transfers t LEFT JOIN contractors c ON c.id = t.contractor_id
      WHERE t.is_void = 0 AND t.approval_status = 'approved' AND t.transfer_type = 'advance' AND t.advance_id IS NULL
        ${p('t')} ${range('t', 'transfer_date')} ORDER BY t.transfer_date DESC`).all()) {
      out.push(row('transfer_without_advance',
        { type: 'transfer', label: r.transfer_no },
        { reference: r.transfer_no, date: r.transfer_date, amount: r.amount,
          party: r.contractor_name || r.beneficiary_name,
          issue: 'تحويل مصروف كعهدة مقاول لكنه غير مرتبط بأي عهدة',
          ids: { transfer_id: r.id } }));
    }
  }

  /* 2) عهدة بدون تحويل */
  if (keep('advance_without_transfer')) {
    for (const r of db.prepare(`
      SELECT a.id, a.advance_no, a.advance_date, a.amount, c.name AS contractor_name, fs.name AS funding_source_name
      FROM advances a LEFT JOIN contractors c ON c.id = a.contractor_id
      LEFT JOIN funding_sources fs ON fs.id = a.funding_source_id
      WHERE a.is_void = 0 AND a.approval_status = 'approved'
        AND a.transfer_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.advance_id = a.id AND t.is_void = 0)
        ${p('a')} ${range('a', 'advance_date')} ORDER BY a.advance_date DESC`).all()) {
      out.push(row('advance_without_transfer',
        { type: 'advance', label: r.advance_no },
        { reference: r.advance_no, date: r.advance_date, amount: r.amount, party: r.contractor_name,
          issue: `عهدة بدون تحويل مالي مرتبط (مصدر التمويل المعلن: ${r.funding_source_name || '—'})`,
          ids: { advance_id: r.id } }));
    }
  }

  /* 3) إخلاء بدون عهدة صالحة */
  if (keep('settlement_without_advance')) {
    for (const r of db.prepare(`
      SELECT s.id, s.settlement_no, s.settlement_date, s.total_amount, a.advance_no, a.is_void AS adv_void
      FROM advance_settlements s LEFT JOIN advances a ON a.id = s.advance_id
      WHERE s.is_void = 0 AND (a.id IS NULL OR a.is_void = 1)
        ${p('s')} ${range('s', 'settlement_date')}`).all()) {
      out.push(row('settlement_without_advance',
        { type: 'settlement', label: r.settlement_no },
        { reference: r.settlement_no, date: r.settlement_date, amount: r.total_amount,
          issue: r.adv_void ? 'الإخلاء مرتبط بعهدة ملغاة' : 'الإخلاء لا يرتبط بأي عهدة',
          ids: { settlement_id: r.id } }));
    }
  }

  /* 4) إخلاءات تتجاوز قيمة العهدة */
  if (keep('over_advanced')) {
    for (const r of db.prepare(`
      SELECT a.id, a.advance_no, a.advance_date, a.amount,
             ROUND(SUM(s.total_amount),2) AS settled,
             c.name AS contractor_name
      FROM advances a
      JOIN advance_settlements s ON s.advance_id = a.id AND s.is_void = 0 AND s.approval_status='approved'
      LEFT JOIN contractors c ON c.id = a.contractor_id
      WHERE a.is_void = 0 ${p('a')} ${range('a', 'advance_date')}
      GROUP BY a.id HAVING settled > a.amount + 0.005`).all()) {
      out.push(row('over_advanced',
        { type: 'advance', label: r.advance_no },
        { reference: r.advance_no, date: r.advance_date, amount: r.amount, party: r.contractor_name,
          issue: `إجمالي الإخلاءات (${round2(r.settled)}) يتجاوز مبلغ العهدة (${round2(r.amount)}) — الفرق ${round2(r.settled - r.amount)}`,
          ids: { advance_id: r.id } }));
    }
  }

  /* 5) تحويل مكرر */
  if (keep('duplicate_transfer')) {
    for (const r of db.prepare(`
      SELECT funding_source_id, transfer_date, ROUND(amount,2) AS amount,
             COALESCE(contractor_id,0) AS cid, COALESCE(supplier_id,0) AS sid,
             COUNT(*) AS cnt, GROUP_CONCAT(transfer_no, ' ، ') AS nos,
             MAX(transfer_date) AS d, ROUND(SUM(amount),2) AS total
      FROM transfers
      WHERE is_void = 0 ${p('transfers')} ${range('transfers', 'transfer_date')}
      GROUP BY funding_source_id, transfer_date, ROUND(amount,2), cid, sid
      HAVING cnt > 1`).all()) {
      const fs = db.prepare('SELECT name FROM funding_sources WHERE id = ?').get(r.funding_source_id);
      out.push(row('duplicate_transfer',
        { type: 'transfer', label: r.nos },
        { reference: r.nos, date: r.d, amount: r.amount,
          issue: `${r.cnt} تحويلات متطابقة (نفس المصدر والمبلغ والتاريخ والمستفيد) — تحقق من الازدواجية. المبلغ الإجمالي ${round2(r.total)}`,
          party: fs ? fs.name : null }));
    }
  }

  /* 6) فاتورة مكررة */
  if (keep('duplicate_invoice')) {
    for (const r of db.prepare(`
      SELECT i.supplier_id, i.invoice_date, ROUND(i.total_amount,2) AS amount, COUNT(*) AS cnt,
             GROUP_CONCAT(i.invoice_no, ' ، ') AS nos, s.name AS supplier_name
      FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.is_void = 0 ${p('i')} ${range('i', 'invoice_date')}
      GROUP BY i.supplier_id, i.invoice_date, ROUND(i.total_amount,2)
      HAVING cnt > 1`).all()) {
      out.push(row('duplicate_invoice',
        { type: 'supplier_invoice', label: r.nos },
        { reference: r.nos, date: r.invoice_date, amount: r.amount, party: r.supplier_name,
          issue: `${r.cnt} فواتير بنفس المورد والتاريخ والقيمة — تحقق من التكرار` }));
    }
    for (const r of db.prepare(`
      SELECT s.advance_id, s.invoice_no, COUNT(*) cnt, GROUP_CONCAT(s.settlement_no,' ، ') AS nos, a.advance_no
      FROM advance_settlements s JOIN advances a ON a.id = s.advance_id
      WHERE s.is_void = 0 ${p('s')}
      GROUP BY s.advance_id, s.invoice_no HAVING cnt > 1`).all()) {
      out.push(row('duplicate_invoice',
        { type: 'settlement', label: r.nos },
        { reference: r.nos, date: null, amount: null, party: r.advance_no,
          issue: `فاتورة الإخلاء ${r.invoice_no} مكررة على نفس العهدة` }));
    }
  }

  /* 7) عهدة برصيد غير مسوَّى */
  if (keep('unsettled_advance')) {
    for (const r of db.prepare(`
      SELECT a.id, a.advance_no, a.advance_date, a.amount,
             ROUND(a.amount - COALESCE(st.settled,0),2) AS remaining,
             c.name AS contractor_name, a.status
      FROM advances a
      LEFT JOIN (SELECT advance_id, SUM(total_amount) AS settled FROM advance_settlements
                 WHERE is_void=0 AND approval_status='approved' GROUP BY advance_id) st ON st.advance_id = a.id
      LEFT JOIN contractors c ON c.id = a.contractor_id
      WHERE a.is_void = 0 AND a.approval_status='approved' ${p('a')} ${range('a','advance_date')}
        AND a.amount - COALESCE(st.settled,0) > 0.005
      ORDER BY remaining DESC`).all()) {
      out.push(row('unsettled_advance',
        { type: 'advance', label: r.advance_no },
        { reference: r.advance_no, date: r.advance_date, amount: r.remaining, party: r.contractor_name,
          issue: `رصيد غير مسوَّى ${round2(r.remaining)} ريال من أصل ${round2(r.amount)} (الحالة: ${r.status})`,
          ids: { advance_id: r.id } }));
    }
  }

  /* 8) فرق بين مبلغ التحويل ومبلغ العهدة */
  if (keep('amount_mismatch')) {
    for (const r of db.prepare(`
      SELECT a.id, a.advance_no, a.advance_date, a.amount AS adv_amount, t.id AS tid, t.transfer_no, t.amount AS tr_amount,
             c.name AS contractor_name
      FROM advances a JOIN transfers t ON t.id = a.transfer_id AND t.is_void = 0
      LEFT JOIN contractors c ON c.id = a.contractor_id
      WHERE a.is_void = 0 AND ABS(a.amount - t.amount) > 0.005 ${p('a')} ${range('a','advance_date')}`).all()) {
      out.push(row('amount_mismatch',
        { type: 'advance', label: r.advance_no },
        { reference: `${r.advance_no} / ${r.transfer_no}`, date: r.advance_date,
          amount: round2(r.tr_amount - r.adv_amount), party: r.contractor_name,
          issue: `مبلغ العهدة (${round2(r.adv_amount)}) ≠ مبلغ التحويل (${round2(r.tr_amount)})`,
          ids: { advance_id: r.id, transfer_id: r.tid } }));
    }
  }

  /* 9) دفعة بدون تحويل */
  if (keep('payment_without_transfer')) {
    for (const r of db.prepare(`
      SELECT p.id, p.payment_no, p.payment_date, p.amount, i.invoice_no, s.name AS supplier_name
      FROM payments p
      LEFT JOIN supplier_invoices i ON i.id = p.supplier_invoice_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.is_void = 0 AND p.transfer_id IS NULL ${p('p')} ${range('p','payment_date')}`).all()) {
      out.push(row('payment_without_transfer',
        { type: 'payment', label: r.payment_no },
        { reference: r.payment_no, date: r.payment_date, amount: r.amount, party: r.supplier_name,
          issue: `دفعة غير مرتبطة بتحويل مالي${r.invoice_no ? ` (فاتورة ${r.invoice_no})` : ''}`,
          ids: { payment_id: r.id } }));
    }
  }

  /* 10) تحويل معتمد بدون قيد محاسبي */
  if (keep('transfer_not_posted')) {
    for (const r of db.prepare(`
      SELECT t.id, t.transfer_no, t.transfer_date, t.amount, t.beneficiary_name
      FROM transfers t
      WHERE t.is_void = 0 AND t.approval_status='approved' ${p('t')} ${range('t','transfer_date')}
        AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.ref_type='transfer' AND je.ref_id = t.id AND je.is_void = 0)`).all()) {
      out.push(row('transfer_not_posted',
        { type: 'transfer', label: r.transfer_no },
        { reference: r.transfer_no, date: r.transfer_date, amount: r.amount, party: r.beneficiary_name,
          issue: 'تحويل معتمد لم يُولَّد له قيد محاسبي — يحتاج إعادة اعتماد',
          ids: { transfer_id: r.id } }));
    }
  }

  /* 11) فاتورة مورد بدون سداد */
  if (keep('invoice_without_payment')) {
    for (const r of db.prepare(`
      SELECT i.id, i.invoice_no, i.invoice_date, i.due_date, i.total_amount,
             ROUND(i.total_amount - COALESCE(pay.paid,0),2) AS remaining, s.name AS supplier_name
      FROM supplier_invoices i
      LEFT JOIN (SELECT supplier_invoice_id, SUM(amount) AS paid FROM payments
                 WHERE is_void=0 AND approval_status='approved' GROUP BY supplier_invoice_id) pay ON pay.supplier_invoice_id = i.id
      JOIN suppliers s ON s.id = i.supplier_id
      WHERE i.is_void = 0 AND i.approval_status='approved' ${p('i')} ${range('i','invoice_date')}
        AND i.total_amount - COALESCE(pay.paid,0) > 0.005
        ${f.overdue_only === '1' ? "AND i.due_date IS NOT NULL AND date(i.due_date) < date('now')" : ''}
      ORDER BY i.due_date`).all()) {
      out.push(row('invoice_without_payment',
        { type: 'supplier_invoice', label: r.invoice_no },
        { reference: r.invoice_no, date: r.invoice_date, amount: r.remaining, party: r.supplier_name,
          issue: `متبقٍ ${round2(r.remaining)} ريال${r.due_date ? ` — الاستحقاق ${r.due_date}${r.due_date < new Date().toISOString().slice(0,10) ? ' (متأخرة)' : ''}` : ''}`,
          ids: { invoice_id: r.id } }));
    }
  }

  /* 12) تحويل بدون مركز تكلفة */
  if (keep('transfer_without_project')) {
    for (const r of db.prepare(`
      SELECT t.id, t.transfer_no, t.transfer_date, t.amount, t.beneficiary_name
      FROM transfers t WHERE t.is_void = 0 ${p('t')} ${range('t','transfer_date')} AND t.cost_center_id IS NULL`).all()) {
      out.push(row('transfer_without_project',
        { type: 'transfer', label: r.transfer_no },
        { reference: r.transfer_no, date: r.transfer_date, amount: r.amount, party: r.beneficiary_name,
          issue: 'التحويل غير مربوط بمركز تكلفة', ids: { transfer_id: r.id } }));
    }
  }

  /* 13) مصدر تمويل العهدة لا يطابق التحويل */
  if (keep('advance_without_funding_match')) {
    for (const r of db.prepare(`
      SELECT a.id, a.advance_no, a.advance_date, a.amount, t.transfer_no,
             fs1.name AS a_src, fs2.name AS t_src
      FROM advances a JOIN transfers t ON t.id = a.transfer_id AND t.is_void = 0
      LEFT JOIN funding_sources fs1 ON fs1.id = a.funding_source_id
      LEFT JOIN funding_sources fs2 ON fs2.id = t.funding_source_id
      WHERE a.is_void = 0 AND a.funding_source_id <> t.funding_source_id ${p('a')}`).all()) {
      out.push(row('advance_without_funding_match',
        { type: 'advance', label: r.advance_no },
        { reference: `${r.advance_no} / ${r.transfer_no}`, date: r.advance_date, amount: r.amount,
          issue: `مصدر تمويل العهدة (${r.a_src}) ≠ مصدر تمويل التحويل (${r.t_src})`,
          ids: { advance_id: r.id } }));
    }
  }

  /* 14) عملية بدون مرفق */
  if (keep('missing_attachment')) {
    for (const r of db.prepare(`
      SELECT 'transfer' AS et, t.id, t.transfer_no AS no, t.transfer_date AS d, t.amount, t.beneficiary_name AS party
      FROM transfers t
      WHERE t.is_void = 0 AND t.approval_status='approved' ${p('t')} ${range('t','transfer_date')}
        AND NOT EXISTS (SELECT 1 FROM attachments at WHERE at.entity_type='transfer' AND at.entity_id = t.id AND at.is_void=0)
      UNION ALL
      SELECT 'settlement', s.id, s.settlement_no, s.settlement_date, s.total_amount, c.name
      FROM advance_settlements s JOIN advances a ON a.id = s.advance_id LEFT JOIN contractors c ON c.id = a.contractor_id
      WHERE s.is_void = 0 AND s.approval_status='approved' ${p('s')} ${range('s','settlement_date')}
        AND NOT EXISTS (SELECT 1 FROM attachments at WHERE at.entity_type='settlement' AND at.entity_id = s.id AND at.is_void=0)`).all()) {
      out.push(row('missing_attachment',
        { type: r.et, label: r.no },
        { reference: r.no, date: r.d, amount: r.amount, party: r.party, issue: 'لا يوجد مرفق/إثبات مرفوع للعملية' }));
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => (order[a.severity] - order[b.severity]) || String(a.reference).localeCompare(String(b.reference)));

  const byCheck = {};
  for (const item of out) {
    byCheck[item.check] = byCheck[item.check] || { key: item.check, label: item.category_label, severity: item.severity, count: 0, amount: 0 };
    byCheck[item.check].count += 1;
    byCheck[item.check].amount = round2(byCheck[item.check].amount + (item.amount || 0));
  }

  return {
    checks: CHECKS,
    summary: Object.values(byCheck).sort((a, b) => order[a.severity] - order[b.severity]),
    total_issues: out.length,
    high: out.filter(i => i.severity === 'high').length,
    medium: out.filter(i => i.severity === 'medium').length,
    low: out.filter(i => i.severity === 'low').length,
    items: f.flat ? out : out,
    generated_at: new Date().toISOString()
  };
}

module.exports = { run, CHECKS };
