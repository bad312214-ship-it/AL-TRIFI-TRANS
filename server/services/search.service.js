'use strict';
/**
 * البحث الشامل: يبحث في كل الوحدات دفعة واحدة من مربع بحث واحد
 */
const { getDb } = require('../db');
const { escapeLike, badRequest } = require('../utils/helpers');

function search(term, { limit = 8, projectId = null } = {}) {
  const t = String(term || '').trim();
  if (!t) return { term: t, groups: [], total: 0 };
  const kw = `%${escapeLike(t)}%`;
  const db = getDb();
  const lim = Math.min(25, Math.max(1, Number(limit) || 8));
  const groups = [];
  let total = 0;
  const add = (key, label, rows, link) => {
    if (!rows.length) return;
    total += rows.length;
    groups.push({ key, label, count: rows.length, link, rows });
  };

  add('advances', 'عهد المقاولين', db.prepare(`
    SELECT a.id, a.advance_no AS title, c.name AS subtitle,
           ROUND(a.amount - COALESCE((SELECT SUM(s.total_amount) FROM advance_settlements s WHERE s.advance_id=a.id AND s.is_void=0 AND s.approval_status='approved'),0),2) AS amount,
           a.advance_date AS date, a.status AS status, a.approval_status
    FROM advances a LEFT JOIN contractors c ON c.id = a.contractor_id
    WHERE a.is_void = 0 AND (a.advance_no LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\')
    ORDER BY a.advance_date DESC LIMIT ?`).all(kw, kw, kw, lim), '#/advances');

  add('transfers', 'التحويلات المالية', db.prepare(`
    SELECT t.id, t.transfer_no AS title, COALESCE(t.beneficiary_name, '') AS subtitle,
           t.amount, t.transfer_date AS date, t.approval_status, t.transfer_type AS status
    FROM transfers t
    WHERE t.is_void = 0 AND (t.transfer_no LIKE ? ESCAPE '\\' OR t.bank_ref LIKE ? ESCAPE '\\' OR t.beneficiary_name LIKE ? ESCAPE '\\' OR t.purpose LIKE ? ESCAPE '\\')
    ORDER BY t.transfer_date DESC LIMIT ?`).all(kw, kw, kw, kw, lim), '#/transfers');

  add('settlements', 'إخلاء العهد', db.prepare(`
    SELECT s.id, s.settlement_no AS title, a.advance_no || ' — ' || s.invoice_no AS subtitle,
           s.total_amount AS amount, s.settlement_date AS date, s.approval_status AS status
    FROM advance_settlements s JOIN advances a ON a.id = s.advance_id
    WHERE s.is_void = 0 AND (s.settlement_no LIKE ? ESCAPE '\\' OR s.invoice_no LIKE ? ESCAPE '\\' OR a.advance_no LIKE ? ESCAPE '\\')
    ORDER BY s.settlement_date DESC LIMIT ?`).all(kw, kw, kw, lim), '#/settlements');

  add('supplier_invoices', 'فواتير الموردين', db.prepare(`
    SELECT i.id, i.invoice_no AS title, s.name AS subtitle, i.total_amount AS amount,
           i.invoice_date AS date, i.approval_status AS status
    FROM supplier_invoices i JOIN suppliers s ON s.id = i.supplier_id
    WHERE i.is_void = 0 AND (i.invoice_no LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\')
    ORDER BY i.invoice_date DESC LIMIT ?`).all(kw, kw, kw, lim), '#/supplier-invoices');

  add('payments', 'الدفعات', db.prepare(`
    SELECT p.id, p.payment_no AS title, COALESCE(i.invoice_no, '') AS subtitle, p.amount,
           p.payment_date AS date, p.payment_type AS status
    FROM payments p LEFT JOIN supplier_invoices i ON i.id = p.supplier_invoice_id
    WHERE p.is_void = 0 AND (p.payment_no LIKE ? ESCAPE '\\' OR i.invoice_no LIKE ? ESCAPE '\\')
    ORDER BY p.payment_date DESC LIMIT ?`).all(kw, kw, lim), '#/payments');

  add('contractors', 'المقاولون', db.prepare(`
    SELECT id, name AS title, code AS subtitle, NULL AS amount, NULL AS date, NULL AS status
    FROM contractors WHERE name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`).all(kw, kw, lim), '#/contractors');

  add('suppliers', 'الموردون', db.prepare(`
    SELECT id, name AS title, code AS subtitle, NULL AS amount, NULL AS date, NULL AS status
    FROM suppliers WHERE name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?`).all(kw, kw, lim), '#/suppliers');

  add('audit_logs', 'سجل العمليات', db.prepare(`
    SELECT id, summary AS title, username AS subtitle, NULL AS amount, created_at AS date, action AS status
    FROM audit_logs WHERE summary LIKE ? ESCAPE '\\' OR entity_label LIKE ? ESCAPE '\\'
    ORDER BY created_at DESC LIMIT ?`).all(kw, kw, lim), '#/audit-logs');

  return { term: t, groups, total };
}

module.exports = { search };
