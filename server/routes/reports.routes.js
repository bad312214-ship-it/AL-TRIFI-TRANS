'use strict';
/** مسارات لوحة التحكم والتقارير والمطابقة والتصدير */
const express = require('express');
const { wrap } = require('../middleware/errors');
const { requirePerm, requireAuth } = require('../middleware/auth');
const { badRequest } = require('../utils/helpers');
const dashboard = require('../services/dashboard.service');
const reports = require('../services/reports.service');
const reconciliation = require('../services/reconciliation.service');
const exporter = require('../services/export.service');
const audit = require('../services/audit.service');
const { getDb } = require('../db');

const router = express.Router();

/* -------- لوحة التحكم -------- */
router.get('/dashboard', requirePerm('dashboard.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: dashboard.overview(req.query) });
}));

/* -------- التقارير -------- */
router.get('/reports', requirePerm('reports.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: reports.listReports() });
}));

router.get('/reports/:key', requirePerm('reports.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: reports.run(req.params.key, req.query) });
}));

/* -------- المطابقة -------- */
router.get('/reconciliation', requirePerm('reconciliation.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: reconciliation.run(req.query) });
}));

/* -------- التصدير -------- */
router.get('/export/:key/:format', requirePerm('reports.export'), wrap(async (req, res) => {
  const { key, format } = req.params;
  if (!['csv', 'xlsx'].includes(format)) throw badRequest('صيغة التصدير المدعومة: csv أو xlsx');
  const report = reports.run(key, req.query);
  const projectName = req.query.project_id
    ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(Number(req.query.project_id)) || {}).name
    : 'كل المشاريع';
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `${key}-${stamp}`;

  audit.log(req, {
    action: 'export', entityType: 'report', entityId: null, entityLabel: report.title,
    summary: `تصدير تقرير "${report.title}" بصيغة ${format.toUpperCase()} (${report.row_count} سجل)`
  });

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(exporter.toCSV(report));
  }
  const buf = await exporter.toXLSX(report, { projectName });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(Buffer.from(buf));
}));

/** عرض جاهز للطباعة (يُستخدم لتصدير PDF من المتصفح بدعم كامل للعربية) */
router.get('/print/:key', requirePerm('reports.view'), wrap(async (req, res) => {
  const report = reports.run(req.params.key, req.query);
  const projectName = req.query.project_id
    ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(Number(req.query.project_id)) || {}).name
    : 'كل المشاريع';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderPrintable(report, projectName));
}));

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function num(v) {
  const n = Number(v || 0);
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderPrintable(report, projectName) {
  const f = report.filters || {};
  const periodTxt = (f.from || f.to) ? `${f.from || '—'} إلى ${f.to || '—'}` : 'كل الفترات';
  const head = report.columns.map(c => `<th>${esc(c.label)}</th>`).join('');
  const body = report.rows.map(r => `<tr>${report.columns.map(c => `<td class="${c.type === 'money' ? 'n' : ''}">${c.type === 'money' ? num(r[c.key]) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
  const totals = (report.totalKeys && report.totalKeys.length)
    ? `<tr class="totals">${report.columns.map((c, i) => `<td class="${c.type === 'money' ? 'n' : ''}">${i === 0 ? 'الإجمالي' : (report.totalKeys.includes(c.key) ? num(report.totals[c.key]) : '')}</td>`).join('')}</tr>` : '';

  return `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>${esc(report.title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, "Noto Naskh Arabic", sans-serif; color:#1b2733; margin:0; padding:18px; background:#fff; }
  .brand { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #1f3a5f; padding-bottom:10px; margin-bottom:14px; }
  .brand h1 { font-size:20px; margin:0; color:#1f3a5f; }
  .brand .sub { font-size:12px; color:#5b6b7c; }
  .meta { font-size:12px; color:#5b6b7c; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th { background:#1f3a5f; color:#fff; padding:7px 6px; text-align:right; font-weight:600; border:1px solid #16293f; }
  td { padding:6px; border:1px solid #d9e1ec; text-align:right; }
  td.n { text-align:left; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background:#f7f9fc; }
  tr.totals td { background:#e8eef7; font-weight:700; border-top:2px solid #1f3a5f; }
  .footer { margin-top:14px; font-size:10px; color:#8a97a6; display:flex; justify-content:space-between; }
  @media print { .noprint { display:none; } }
  .noprint button { background:#1f3a5f; color:#fff; border:0; padding:9px 18px; border-radius:6px; font-size:13px; cursor:pointer; }
</style></head><body>
<div class="noprint" style="margin-bottom:12px; text-align:left;"><button onclick="window.print()">طباعة / حفظ كـ PDF</button></div>
<div class="brand">
  <div><h1>نظام أرض العيينة المحاسبي</h1><div class="sub">${esc(report.title)} — ${esc(report.description || '')}</div></div>
  <div class="sub">تاريخ الإصدار: ${new Date().toLocaleString('ar-EG')}</div>
</div>
<div class="meta">المشروع: <b>${esc(projectName)}</b> &nbsp;|&nbsp; الفترة: <b>${esc(periodTxt)}</b> &nbsp;|&nbsp; عدد السجلات: <b>${report.row_count}</b></div>
<table><thead><tr>${head}</tr></thead><tbody>${body}${totals}</tbody></table>
<div class="footer"><span>تم إنشاء هذا التقرير آليًا من العمليات المسجلة في النظام.</span><span>صفحة 1</span></div>
</body></html>`;
}

module.exports = router;
