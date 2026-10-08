'use strict';
/**
 * خدمة التقارير
 * كل تقرير يُرجع: الأعمدة + الصفوف + الإجماليات، ليُعرض على الشاشة أو يُصدَّر.
 * جميع القيم محسوبة من العمليات المسجلة.
 */
const { getDb } = require('../db');
const { round2, escapeLike, badRequest } = require('../utils/helpers');
const reconciliation = require('./reconciliation.service');
const funding = require('./funding.service');

/* -------- أدوات مساعدة لبناء شروط الفترة -------- */
function period(alias, col, f) {
  const parts = [], params = [];
  if (f.from) { parts.push(`date(${alias}.${col}) >= date(?)`); params.push(f.from); }
  if (f.to) { parts.push(`date(${alias}.${col}) <= date(?)`); params.push(f.to); }
  return { sql: parts.length ? 'AND ' + parts.join(' AND ') : '', params };
}
function project(alias, f) {
  return f.project_id ? { sql: `AND ${alias}.project_id = ?`, params: [Number(f.project_id)] } : { sql: '', params: [] };
}
function like(alias, col, f, extra = []) {
  if (!f.search) return { sql: '', params: [] };
  const cols = [`${alias}.${col}`, ...extra];
  const kw = `%${escapeLike(String(f.search).trim())}%`;
  return { sql: 'AND (' + cols.map(c => `${c} LIKE ? ESCAPE '\\'`).join(' OR ') + ')', params: cols.map(() => kw) };
}
function sum(rows, key) { return round2(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)); }

/* ============================ التقارير ============================ */

const REPORTS = {};

REPORTS.advances = {
  key: 'advances',
  title: 'تقرير العهد',
  description: 'كل العهد مع الإخلاءات والرصيد المتبقي',
  columns: [
    { key: 'advance_no', label: 'رقم العهدة' }, { key: 'advance_date', label: 'التاريخ' },
    { key: 'contractor_name', label: 'المقاول' }, { key: 'contractor_code', label: 'رقم المقاول' },
    { key: 'description', label: 'البيان' }, { key: 'funding_source_name', label: 'مصدر التمويل' },
    { key: 'transfer_no', label: 'رقم التحويل' }, { key: 'transfer_date', label: 'تاريخ التحويل' },
    { key: 'amount', label: 'مبلغ العهدة', type: 'money' },
    { key: 'settled_total', label: 'المُخلى', type: 'money' },
    { key: 'pending_total', label: 'إخلاءات معلّقة', type: 'money' },
    { key: 'remaining_balance', label: 'الرصيد المتبقي', type: 'money' },
    { key: 'status_label', label: 'الحالة' }, { key: 'approval_status_label', label: 'الاعتماد' },
    { key: 'project_name', label: 'المشروع' }, { key: 'cost_center_name', label: 'مركز التكلفة' }
  ],
  totalKeys: ['amount', 'settled_total', 'pending_total', 'remaining_balance'],
  run(f = {}) {
    const db = getDb();
    const p1 = period('a', 'advance_date', f), p2 = project('a', f);
    const lk = like('a', 'advance_no', f, ['c.name', 'c.code', 'a.description', 't.transfer_no']);
    let extra = '', extraParams = [];
    if (f.contractor_id) { extra += ' AND a.contractor_id = ?'; extraParams.push(Number(f.contractor_id)); }
    if (f.funding_source_id) { extra += ' AND a.funding_source_id = ?'; extraParams.push(Number(f.funding_source_id)); }
    if (f.status === 'open') extra += ' AND ROUND(a.amount - COALESCE(st.approved,0),2) > 0.005';
    if (f.status === 'closed') extra += ' AND ROUND(a.amount - COALESCE(st.approved,0),2) <= 0.005';
    if (f.approval_status) { extra += ' AND a.approval_status = ?'; extraParams.push(f.approval_status); }

    const rows = db.prepare(`
      SELECT a.advance_no, a.advance_date, a.description, a.amount, a.notes,
             c.name AS contractor_name, c.code AS contractor_code,
             fs.name AS funding_source_name, t.transfer_no, t.transfer_date,
             COALESCE(st.approved,0) AS settled_total, COALESCE(st.pending,0) AS pending_total,
             ROUND(a.amount - COALESCE(st.approved,0),2) AS remaining_balance,
             a.status, a.approval_status, p.name AS project_name, cc.name AS cost_center_name,
             a.advance_no AS row_label
      FROM advances a
      LEFT JOIN contractors c ON c.id = a.contractor_id
      LEFT JOIN funding_sources fs ON fs.id = a.funding_source_id
      LEFT JOIN transfers t ON t.id = a.transfer_id
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN cost_centers cc ON cc.id = a.cost_center_id
      LEFT JOIN (SELECT advance_id,
                   SUM(CASE WHEN approval_status='approved' AND is_void=0 THEN total_amount ELSE 0 END) AS approved,
                   SUM(CASE WHEN approval_status='pending'  AND is_void=0 THEN total_amount ELSE 0 END) AS pending
                 FROM advance_settlements GROUP BY advance_id) st ON st.advance_id = a.id
      WHERE a.is_void = 0 ${p1.sql} ${p2.sql} ${lk.sql} ${extra}
      ORDER BY a.advance_date DESC, a.advance_no
    `).all([...p1.params, ...p2.params, ...lk.params, ...extraParams]);

    const statusLabels = { open: 'مفتوحة', under_settlement: 'تحت الإخلاء', partially_closed: 'مغلقة جزئيًا', closed: 'مغلقة' };
    const apprLabels = { draft: 'مسودة', pending: 'بانتظار الاعتماد', approved: 'معتمدة', rejected: 'مرفوضة' };
    return rows.map(r => ({
      ...r, amount: round2(r.amount), settled_total: round2(r.settled_total),
      pending_total: round2(r.pending_total), remaining_balance: round2(r.remaining_balance),
      status_label: statusLabels[r.status] || r.status, approval_status_label: apprLabels[r.approval_status] || r.approval_status
    }));
  }
};

REPORTS.settlements = {
  key: 'settlements',
  title: 'تقرير إخلاء العهد',
  description: 'فواتير الإخلاء المعتمدة والمعلّقة',
  columns: [
    { key: 'settlement_no', label: 'رقم الإخلاء' }, { key: 'settlement_date', label: 'التاريخ' },
    { key: 'advance_no', label: 'رقم العهدة' }, { key: 'contractor_name', label: 'المقاول' },
    { key: 'invoice_no', label: 'رقم الفاتورة' }, { key: 'description', label: 'البيان' },
    { key: 'net_amount', label: 'قيمة الفاتورة', type: 'money' },
    { key: 'vat_amount', label: 'ضريبة القيمة المضافة', type: 'money' },
    { key: 'total_amount', label: 'الإجمالي', type: 'money' },
    { key: 'review_status_label', label: 'المراجعة' }, { key: 'approval_status_label', label: 'الاعتماد' },
    { key: 'over_label', label: 'تجاوز' }, { key: 'project_name', label: 'المشروع' }
  ],
  totalKeys: ['net_amount', 'vat_amount', 'total_amount'],
  run(f = {}) {
    const db = getDb();
    const p1 = period('s', 'settlement_date', f), p2 = project('s', f);
    const lk = like('s', 'settlement_no', f, ['s.invoice_no', 's.description', 'a.advance_no', 'c.name']);
    let extra = '', extraParams = [];
    if (f.advance_id) { extra += ' AND s.advance_id = ?'; extraParams.push(Number(f.advance_id)); }
    if (f.contractor_id) { extra += ' AND a.contractor_id = ?'; extraParams.push(Number(f.contractor_id)); }
    if (f.approval_status) { extra += ' AND s.approval_status = ?'; extraParams.push(f.approval_status); }
    if (f.over_only === '1') extra += ' AND s.over_settlement = 1';

    const rows = db.prepare(`
      SELECT s.settlement_no, s.settlement_date, s.invoice_no, s.description,
             s.net_amount, s.vat_amount, s.total_amount, s.review_status, s.approval_status, s.over_settlement,
             a.advance_no, c.name AS contractor_name, p.name AS project_name
      FROM advance_settlements s
      JOIN advances a ON a.id = s.advance_id
      LEFT JOIN contractors c ON c.id = a.contractor_id
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.is_void = 0 ${p1.sql} ${p2.sql} ${lk.sql} ${extra}
      ORDER BY s.settlement_date DESC, s.settlement_no
    `).all([...p1.params, ...p2.params, ...lk.params, ...extraParams]);

    const rev = { pending: 'قيد المراجعة', reviewed: 'تمت المراجعة', returned: 'مُعاد' };
    const apr = { pending: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض' };
    return rows.map(r => ({
      ...r, net_amount: round2(r.net_amount), vat_amount: round2(r.vat_amount), total_amount: round2(r.total_amount),
      review_status_label: rev[r.review_status] || r.review_status,
      approval_status_label: apr[r.approval_status] || r.approval_status,
      over_label: r.over_settlement ? 'تجاوز رصيد العهدة' : ''
    }));
  }
};

REPORTS.contractors = {
  key: 'contractors',
  title: 'تقرير المقاولين',
  description: 'إجمالي العهد والتحويلات والإخلاءات والرصيد المتبقي لكل مقاول',
  columns: [
    { key: 'code', label: 'رقم المقاول' }, { key: 'name', label: 'اسم المقاول' },
    { key: 'advances_count', label: 'عدد العهد' },
    { key: 'open_count', label: 'العهد المفتوحة' }, { key: 'closed_count', label: 'العهد المغلقة' },
    { key: 'total_advances', label: 'إجمالي العهد', type: 'money' },
    { key: 'total_transfers', label: 'إجمالي التحويلات', type: 'money' },
    { key: 'total_settled', label: 'إجمالي الإخلاءات', type: 'money' },
    { key: 'total_expenses', label: 'إجمالي المصروفات', type: 'money' },
    { key: 'remaining_balance', label: 'الرصيد المتبقي', type: 'money' },
    { key: 'total_vat', label: 'ضريبة المدخلات', type: 'money' }
  ],
  totalKeys: ['total_advances', 'total_transfers', 'total_settled', 'total_expenses', 'remaining_balance', 'total_vat'],
  run(f = {}) {
    const db = getDb();
    const p1 = period('a', 'advance_date', f), p2 = project('a', f);
    const lk = like('c', 'name', f, ['c.code']);
    let extra = '', extraParams = [];
    if (f.contractor_id) { extra += ' AND c.id = ?'; extraParams.push(Number(f.contractor_id)); }
    if (f.open_only === '1') {
      extra += ` AND (COALESCE(SUM(a.amount),0) - COALESCE(SUM(st.approved),0)) > 0.005`;
    }
    const rows = db.prepare(`
      SELECT c.id, c.code, c.name,
        COUNT(a.id) AS advances_count,
        SUM(CASE WHEN a.amount - COALESCE(st.approved,0) > 0.005 THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN a.amount - COALESCE(st.approved,0) <= 0.005 THEN 1 ELSE 0 END) AS closed_count,
        ROUND(COALESCE(SUM(a.amount),0),2) AS total_advances,
        ROUND(COALESCE(SUM(st.approved),0),2) AS total_settled,
        ROUND(COALESCE(SUM(st.net),0),2) AS total_expenses,
        ROUND(COALESCE(SUM(st.vat),0),2) AS total_vat,
        ROUND(COALESCE(SUM(a.amount),0) - COALESCE(SUM(st.approved),0), 2) AS remaining_balance,
        ROUND(COALESCE((SELECT SUM(t.amount) FROM transfers t
             WHERE t.contractor_id = c.id AND t.is_void = 0 AND t.approval_status='approved'
             ${f.from ? "AND date(t.transfer_date) >= date('" + String(f.from).replace(/'/g, '') + "')" : ''}
             ${f.to ? "AND date(t.transfer_date) <= date('" + String(f.to).replace(/'/g, '') + "')" : ''}
             ${f.project_id ? `AND t.project_id = ${Number(f.project_id)}` : ''}),0),2) AS total_transfers
      FROM contractors c
      LEFT JOIN advances a ON a.contractor_id = c.id AND a.is_void = 0 AND a.approval_status = 'approved' ${p1.sql} ${p2.sql}
      LEFT JOIN (SELECT advance_id,
                   SUM(CASE WHEN approval_status='approved' AND is_void=0 THEN total_amount ELSE 0 END) AS approved,
                   SUM(CASE WHEN approval_status='approved' AND is_void=0 THEN net_amount ELSE 0 END) AS net,
                   SUM(CASE WHEN approval_status='approved' AND is_void=0 THEN vat_amount ELSE 0 END) AS vat
                 FROM advance_settlements GROUP BY advance_id) st ON st.advance_id = a.id
      WHERE 1=1 ${lk.sql} ${extra}
      GROUP BY c.id
      ORDER BY total_advances DESC, c.name
    `).all([...p1.params, ...p2.params, ...lk.params, ...extraParams]);
    return rows.map(r => ({ ...r, advances_count: r.advances_count || 0, open_count: r.open_count || 0, closed_count: r.closed_count || 0 }));
  }
};

REPORTS.suppliers = {
  key: 'suppliers',
  title: 'تقرير الموردين',
  description: 'فواتير الموردين والمدفوع والمتبقي لكل مورد',
  columns: [
    { key: 'code', label: 'رقم المورد' }, { key: 'name', label: 'اسم المورد' },
    { key: 'invoices_count', label: 'عدد الفواتير' },
    { key: 'total_invoices', label: 'إجمالي الفواتير', type: 'money' },
    { key: 'total_net', label: 'قبل الضريبة', type: 'money' },
    { key: 'total_vat', label: 'ضريبة القيمة المضافة', type: 'money' },
    { key: 'total_paid', label: 'المدفوع', type: 'money' },
    { key: 'remaining_due', label: 'المتبقي', type: 'money' },
    { key: 'total_transfers', label: 'إجمالي التحويلات', type: 'money' }
  ],
  totalKeys: ['total_invoices', 'total_net', 'total_vat', 'total_paid', 'remaining_due', 'total_transfers'],
  run(f = {}) {
    const db = getDb();
    const p1 = period('i', 'invoice_date', f), p2 = project('i', f);
    const lk = like('s', 'name', f, ['s.code']);
    let extra = '', extraParams = [];
    if (f.supplier_id) { extra += ' AND s.id = ?'; extraParams.push(Number(f.supplier_id)); }
    const rows = db.prepare(`
      SELECT s.id, s.code, s.name,
        COUNT(i.id) AS invoices_count,
        ROUND(COALESCE(SUM(i.total_amount),0),2) AS total_invoices,
        ROUND(COALESCE(SUM(i.net_amount),0),2) AS total_net,
        ROUND(COALESCE(SUM(i.vat_amount),0),2) AS total_vat,
        ROUND(COALESCE(SUM(COALESCE(pay.paid,0)),0),2) AS total_paid,
        ROUND(COALESCE(SUM(i.total_amount),0) - COALESCE(SUM(COALESCE(pay.paid,0)),0),2) AS remaining_due,
        ROUND(COALESCE((SELECT SUM(t.amount) FROM transfers t
           WHERE t.supplier_id = s.id AND t.is_void = 0 AND t.approval_status='approved'),0),2) AS total_transfers
      FROM suppliers s
      LEFT JOIN supplier_invoices i ON i.supplier_id = s.id AND i.is_void = 0 AND i.approval_status='approved' ${p1.sql} ${p2.sql}
      LEFT JOIN (SELECT supplier_invoice_id, SUM(amount) AS paid FROM payments
                 WHERE is_void=0 AND approval_status='approved' GROUP BY supplier_invoice_id) pay ON pay.supplier_invoice_id = i.id
      WHERE 1=1 ${lk.sql} ${extra}
      GROUP BY s.id
      ORDER BY total_invoices DESC, s.name
    `).all([...p1.params, ...p2.params, ...lk.params, ...extraParams]);
    return rows;
  }
};

REPORTS.transfers = {
  key: 'transfers',
  title: 'تقرير التحويلات',
  description: 'كل التحويلات المالية حسب المصدر والمستفيد',
  columns: [
    { key: 'transfer_no', label: 'رقم العملية' }, { key: 'transfer_date', label: 'التاريخ' },
    { key: 'amount', label: 'المبلغ', type: 'money' },
    { key: 'funding_source_name', label: 'مصدر التمويل' },
    { key: 'type_label', label: 'نوع التحويل' },
    { key: 'beneficiary_name', label: 'المستفيد' },
    { key: 'advance_no', label: 'رقم العهدة' },
    { key: 'purpose', label: 'الغرض' }, { key: 'bank_ref', label: 'المرجع البنكي' },
    { key: 'approval_status_label', label: 'الاعتماد' },
    { key: 'project_name', label: 'المشروع' }, { key: 'cost_center_name', label: 'مركز التكلفة' }
  ],
  totalKeys: ['amount'],
  run(f = {}) {
    const db = getDb();
    const p1 = period('t', 'transfer_date', f), p2 = project('t', f);
    const lk = like('t', 'transfer_no', f, ['t.beneficiary_name', 't.bank_ref', 't.purpose', 'c.name', 's.name', 'a.advance_no']);
    let extra = '', extraParams = [];
    if (f.funding_source_id) { extra += ' AND t.funding_source_id = ?'; extraParams.push(Number(f.funding_source_id)); }
    if (f.transfer_type) { extra += ' AND t.transfer_type = ?'; extraParams.push(f.transfer_type); }
    if (f.contractor_id) { extra += ' AND t.contractor_id = ?'; extraParams.push(Number(f.contractor_id)); }
    if (f.supplier_id) { extra += ' AND t.supplier_id = ?'; extraParams.push(Number(f.supplier_id)); }
    if (f.approval_status) { extra += ' AND t.approval_status = ?'; extraParams.push(f.approval_status); }
    if (f.cost_center_id) { extra += ' AND t.cost_center_id = ?'; extraParams.push(Number(f.cost_center_id)); }

    const rows = db.prepare(`
      SELECT t.transfer_no, t.transfer_date, t.amount, t.purpose, t.bank_ref, t.transfer_type,
             t.beneficiary_name, t.approval_status,
             fs.name AS funding_source_name, c.name AS contractor_name, s.name AS supplier_name,
             a.advance_no, p.name AS project_name, cc.name AS cost_center_name
      FROM transfers t
      LEFT JOIN funding_sources fs ON fs.id = t.funding_source_id
      LEFT JOIN contractors c ON c.id = t.contractor_id
      LEFT JOIN suppliers s ON s.id = t.supplier_id
      LEFT JOIN advances a ON a.id = t.advance_id
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
      WHERE t.is_void = 0 ${p1.sql} ${p2.sql} ${lk.sql} ${extra}
      ORDER BY t.transfer_date DESC, t.transfer_no
    `).all([...p1.params, ...p2.params, ...lk.params, ...extraParams]);

    const types = { advance: 'تحويل لعهدة مقاول', supplier: 'تحويل لمورد', other: 'تحويل آخر' };
    const apr = { draft: 'مسودة', pending: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'مرفوض' };
    return rows.map(r => ({ ...r, amount: round2(r.amount), type_label: types[r.transfer_type] || r.transfer_type, approval_status_label: apr[r.approval_status] || r.approval_status }));
  }
};

REPORTS.funding_sources = {
  key: 'funding_sources',
  title: 'تقرير مصادر التمويل',
  description: 'إجمالي التمويل والمستخدم والمتبقي لكل مصدر',
  columns: [
    { key: 'code', label: 'الرمز' }, { key: 'name', label: 'مصدر التمويل' },
    { key: 'transfers_count', label: 'عدد التحويلات' },
    { key: 'total_transfers', label: 'إجمالي التحويلات', type: 'money' },
    { key: 'to_advances', label: 'إلى العهد', type: 'money' },
    { key: 'to_suppliers', label: 'إلى الموردين', type: 'money' },
    { key: 'to_other', label: 'أخرى', type: 'money' },
    { key: 'pending_transfers', label: 'بانتظار الاعتماد', type: 'money' },
    { key: 'percentage', label: 'النسبة' }
  ],
  totalKeys: ['total_transfers', 'to_advances', 'to_suppliers', 'to_other', 'pending_transfers'],
  run(f = {}) {
    const rows = funding.analysis({ from: f.from, to: f.to, projectId: f.project_id ? Number(f.project_id) : null });
    const total = sum(rows, 'total_transfers') || 1;
    return rows.map(r => ({ ...r, percentage: `${((r.total_transfers / total) * 100).toFixed(1)}%` }));
  }
};

REPORTS.balances = {
  key: 'balances',
  title: 'تقرير الأرصدة (ميزان المراجعة)',
  description: 'أرصدة الحسابات من دفتر الأستاذ العام',
  columns: [
    { key: 'code', label: 'رمز الحساب' }, { key: 'name', label: 'اسم الحساب' },
    { key: 'type_label', label: 'النوع' },
    { key: 'debit', label: 'مدين', type: 'money' }, { key: 'credit', label: 'دائن', type: 'money' },
    { key: 'balance', label: 'الرصيد', type: 'money' }, { key: 'nature_label', label: 'طبيعة الرصيد' }
  ],
  totalKeys: ['debit', 'credit'],
  run(f = {}) {
    const db = getDb();
    const p1 = period('je', 'entry_date', f);
    const p2 = f.project_id ? 'AND je.project_id = ?' : '';
    const params = [...p1.params, ...(f.project_id ? [Number(f.project_id)] : [])];
    const rows = db.prepare(`
      SELECT ac.code, ac.name, ac.type, ac.nature,
        ROUND(COALESCE(SUM(jl.debit),0),2) AS debit,
        ROUND(COALESCE(SUM(jl.credit),0),2) AS credit
      FROM accounts ac
      LEFT JOIN journal_lines jl ON jl.account_id = ac.id
      LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.is_void = 0 ${p1.sql} ${p2}
      GROUP BY ac.id
      HAVING debit <> 0 OR credit <> 0
      ORDER BY ac.code
    `).all(params);
    const types = { asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات' };
    return rows.map(r => {
      const bal = round2(r.debit - r.credit);
      return {
        ...r, debit: round2(r.debit), credit: round2(r.credit), balance: bal,
        type_label: types[r.type] || r.type,
        nature_label: r.nature === 'debit' ? 'مدين' : 'دائن'
      };
    });
  }
};

REPORTS.unlinked = {
  key: 'unlinked',
  title: 'تقرير العمليات غير المرتبطة',
  description: 'العمليات التي تحتاج مراجعة أو مطابقة',
  columns: [
    { key: 'severity_label', label: 'الأهمية' }, { key: 'category_label', label: 'التصنيف' },
    { key: 'entity_label', label: 'العملية' }, { key: 'reference', label: 'المرجع' },
    { key: 'date', label: 'التاريخ' }, { key: 'amount', label: 'المبلغ', type: 'money' },
    { key: 'party', label: 'الطرف' }, { key: 'issue', label: 'الملاحظة' }
  ],
  totalKeys: ['amount'],
  // تقرير المطابقة يُرجع قائمة مسطّحة متوافقة مع بقية التقارير
  run(f = {}) { return reconciliation.run(f).items; }
};

REPORTS.expenses_by_project = {
  key: 'expenses_by_project',
  title: 'تقرير المصروفات حسب المشروع',
  description: 'المصروفات المعترف بها (إخلاءات + فواتير موردين) لكل مشروع ومركز تكلفة',
  columns: [
    { key: 'project_code', label: 'رمز المشروع' }, { key: 'project_name', label: 'المشروع' },
    { key: 'cost_center_name', label: 'مركز التكلفة' },
    { key: 'settlements_net', label: 'إخلاءات العهد', type: 'money' },
    { key: 'invoices_net', label: 'فواتير الموردين', type: 'money' },
    { key: 'total_vat', label: 'ضريبة المدخلات', type: 'money' },
    { key: 'total_expenses', label: 'إجمالي المصروفات', type: 'money' }
  ],
  totalKeys: ['settlements_net', 'invoices_net', 'total_vat', 'total_expenses'],
  run(f = {}) {
    const db = getDb();
    const p2 = f.project_id ? 'AND x.project_id = ?' : '';
    const params = f.project_id ? [Number(f.project_id)] : [];
    const rows = db.prepare(`
      SELECT pr.code AS project_code, pr.name AS project_name, cc.name AS cost_center_name,
        ROUND(SUM(CASE WHEN x.src='settlement' THEN x.net ELSE 0 END),2) AS settlements_net,
        ROUND(SUM(CASE WHEN x.src='invoice' THEN x.net ELSE 0 END),2) AS invoices_net,
        ROUND(SUM(x.vat),2) AS total_vat,
        ROUND(SUM(x.net + x.vat),2) AS total_expenses
      FROM (
        SELECT s.project_id, s.cost_center_id, s.net_amount AS net, s.vat_amount AS vat, 'settlement' AS src
        FROM advance_settlements s
        WHERE s.is_void = 0 AND s.approval_status='approved' ${f.from ? `AND date(s.settlement_date) >= date('${String(f.from).replace(/'/g, '')}')` : ''} ${f.to ? `AND date(s.settlement_date) <= date('${String(f.to).replace(/'/g, '')}')` : ''}
        UNION ALL
        SELECT i.project_id, i.cost_center_id, i.net_amount AS net, i.vat_amount AS vat, 'invoice' AS src
        FROM supplier_invoices i
        WHERE i.is_void = 0 AND i.approval_status='approved' ${f.from ? `AND date(i.invoice_date) >= date('${String(f.from).replace(/'/g, '')}')` : ''} ${f.to ? `AND date(i.invoice_date) <= date('${String(f.to).replace(/'/g, '')}')` : ''}
      ) x
      JOIN projects pr ON pr.id = x.project_id
      LEFT JOIN cost_centers cc ON cc.id = x.cost_center_id
      WHERE 1=1 ${p2}
      GROUP BY x.project_id, x.cost_center_id
      ORDER BY total_expenses DESC
    `).all(params);
    return rows;
  }
};

REPORTS.expenses_by_funding = {
  key: 'expenses_by_funding',
  title: 'تقرير المصروفات حسب مصدر التمويل',
  description: 'كيف صُرفت أموال كل مصدر تمويل',
  columns: [
    { key: 'funding_source_name', label: 'مصدر التمويل' },
    { key: 'category_label', label: 'البند' },
    { key: 'transfers_count', label: 'عدد التحويلات' },
    { key: 'amount', label: 'المبلغ', type: 'money' },
    { key: 'percentage', label: 'النسبة من المصدر' }
  ],
  totalKeys: ['amount'],
  run(f = {}) {
    const db = getDb();
    const p1 = period('t', 'transfer_date', f), p2 = project('t', f);
    const rows = db.prepare(`
      SELECT fs.name AS funding_source_name,
        CASE t.transfer_type WHEN 'advance' THEN 'عهد مقاولين' WHEN 'supplier' THEN 'موردون' ELSE 'أخرى' END AS category_label,
        COUNT(*) AS transfers_count, ROUND(SUM(t.amount),2) AS amount
      FROM transfers t JOIN funding_sources fs ON fs.id = t.funding_source_id
      WHERE t.is_void = 0 AND t.approval_status='approved' ${p1.sql} ${p2.sql}
      GROUP BY fs.id, t.transfer_type
      ORDER BY fs.name, amount DESC
    `).all([...p1.params, ...p2.params]);
    const bySource = {};
    for (const r of rows) bySource[r.funding_source_name] = (bySource[r.funding_source_name] || 0) + r.amount;
    return rows.map(r => ({ ...r, amount: round2(r.amount), percentage: `${((r.amount / (bySource[r.funding_source_name] || 1)) * 100).toFixed(1)}%` }));
  }
};

REPORTS.journal = {
  key: 'journal',
  title: 'دفتر اليومية',
  description: 'القيود المحاسبية المولَّدة تلقائيًا',
  columns: [
    { key: 'entry_no', label: 'رقم القيد' }, { key: 'entry_date', label: 'التاريخ' },
    { key: 'ref_type_label', label: 'المستند' }, { key: 'description', label: 'البيان' },
    { key: 'account_code', label: 'الحساب' }, { key: 'account_name', label: 'اسم الحساب' },
    { key: 'debit', label: 'مدين', type: 'money' }, { key: 'credit', label: 'دائن', type: 'money' }
  ],
  totalKeys: ['debit', 'credit'],
  run(f = {}) {
    const db = getDb();
    const p1 = period('je', 'entry_date', f);
    const p2 = f.project_id ? 'AND je.project_id = ?' : '';
    const params = [...p1.params, ...(f.project_id ? [Number(f.project_id)] : [])];
    const rows = db.prepare(`
      SELECT je.entry_no, je.entry_date, je.ref_type, je.description,
             ac.code AS account_code, ac.name AS account_name, jl.debit, jl.credit
      FROM journal_entries je
      JOIN journal_lines jl ON jl.entry_id = je.id
      JOIN accounts ac ON ac.id = jl.account_id
      WHERE je.is_void = 0 ${p1.sql} ${p2}
      ORDER BY je.entry_date DESC, je.id DESC, jl.id ASC
      LIMIT 2000
    `).all(params);
    const types = { advance: 'عهدة', transfer: 'تحويل', settlement: 'إخلاء عهدة', payment: 'دفعة', supplier_invoice: 'فاتورة مورد' };
    return rows.map(r => ({ ...r, debit: round2(r.debit), credit: round2(r.credit), ref_type_label: types[r.ref_type] || r.ref_type }));
  }
};

/* ============================ واجهة الخدمة ============================ */

function listReports() {
  return Object.values(REPORTS).map(r => ({ key: r.key, title: r.title, description: r.description, columns: r.columns }));
}

function run(key, filters = {}) {
  const def = REPORTS[key];
  if (!def) throw badRequest(`تقرير غير معروف: ${key}`);
  const rows = def.run(filters || {});
  const totals = {};
  for (const k of (def.totalKeys || [])) totals[k] = sum(rows, k);
  return {
    key: def.key, title: def.title, description: def.description,
    columns: def.columns, rows, totals, totalKeys: def.totalKeys || [],
    row_count: rows.length,
    generated_at: new Date().toISOString(),
    filters: filters || {}
  };
}

module.exports = { listReports, run, REPORTS };
