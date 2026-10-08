'use strict';
/**
 * خدمة التصدير: CSV / Excel (XLSX) / PDF (عبر عرض طباعة في الواجهة)
 *
 *  · toCSV            → ملف CSV بترميز BOM (يدعم العربية في Excel)
 *  · toXLSX           → مصنف بورقة واحدة (RTL، تجميد، AutoFilter، صف إجماليات)
 *  · toWorkbookXLSX   → مصنف واحد يجمع عدة تقارير + ورقة غلاف
 */
const ExcelJS = require('exceljs');
const reports = require('./reports.service');

/* ────────────── CSV ────────────── */
function toCSV(report, { bom = true } = {}) {
  const cols = report.columns;
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [];
  lines.push(cols.map(c => esc(c.label)).join(','));
  for (const r of report.rows) lines.push(cols.map(c => esc(r[c.key])).join(','));
  if (report.totalKeys && report.totalKeys.length) {
    const totalRow = {};
    cols.forEach(c => { totalRow[c.key] = ''; });
    totalRow[cols[0].key] = 'الإجمالي';
    for (const k of report.totalKeys) totalRow[k] = report.totals[k];
    lines.push(cols.map(c => esc(totalRow[c.key])).join(','));
  }
  return (bom ? '\uFEFF' : '') + lines.join('\r\n');
}

/* ────────────── XLSX ────────────── */

/** اسم ورقة صالح لـ Excel (≤31 حرفًا، بدون []:*?/\ ، وقص عند حد الكلمة لا وسطها) */
function safeSheetName(name, used = new Set()) {
  let base = String(name || 'ورقة').replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (base.length > 31) {
    const cut = base.slice(0, 31);
    const lastSpace = cut.lastIndexOf(' ');
    base = (lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trim();
  }
  base = base || 'ورقة';
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) {
    const suffix = ` (${i++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate);
  return candidate;
}

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
const STRIPE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };

/** تعبئة ورقة واحدة بتقرير */
function fillSheet(ws, report, meta = {}) {
  const colCount = Math.max(1, report.columns.length);

  ws.mergeCells(1, 1, 1, colCount);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = report.title;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF1F3A5F' } };
  titleCell.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, colCount);
  const sub = ws.getCell(2, 1);
  const f = report.filters || {};
  const periodTxt = (f.from || f.to || f.date_from || f.date_to)
    ? `الفترة: ${f.from || f.date_from || '—'} إلى ${f.to || f.date_to || '—'}`
    : 'كل الفترات';
  sub.value = [
    meta.projectName ? `المشروع: ${meta.projectName}` : null,
    periodTxt,
    `عدد السجلات: ${report.row_count}`,
    `تاريخ الإنشاء: ${new Date().toLocaleString('en-GB')}`,
    meta.environment === 'demo' ? '⚠ بيئة تجريبية — بيانات للاختبار فقط' : null
  ].filter(Boolean).join('   |   ');
  sub.font = { size: 10, color: { argb: 'FF666666' } };
  sub.alignment = { horizontal: 'right' };

  ws.getRow(3).height = 6;

  const headerRow = ws.getRow(4);
  headerRow.values = report.columns.map(c => c.label);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB8C4D6' } } };
  });
  headerRow.height = 24;

  report.rows.forEach((r, idx) => {
    const row = ws.addRow(report.columns.map(c => {
      const v = r[c.key];
      return c.type === 'money' ? Number(v || 0) : (v === null || v === undefined ? '' : v);
    }));
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const col = report.columns[colNumber - 1];
      cell.alignment = { horizontal: col.type === 'money' ? 'left' : 'right', vertical: 'middle' };
      if (col.type === 'money') cell.numFmt = '#,##0.00';
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E9F0' } } };
      if (idx % 2 === 1) cell.fill = STRIPE_FILL;
    });
  });

  if (!report.rows.length) {
    const empty = ws.addRow(['لا توجد بيانات ضمن الفلاتر المحددة']);
    empty.getCell(1).font = { italic: true, color: { argb: 'FF8A97A6' } };
    empty.getCell(1).alignment = { horizontal: 'right' };
  }

  if (report.totalKeys && report.totalKeys.length) {
    const totals = report.columns.map((c, i) =>
      i === 0 ? 'الإجمالي' : (report.totalKeys.includes(c.key) ? Number((report.totals || {})[c.key] || 0) : ''));
    const tr = ws.addRow(totals);
    tr.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const col = report.columns[colNumber - 1];
      cell.font = { bold: true };
      cell.fill = TOTAL_FILL;
      if (col.type === 'money') cell.numFmt = '#,##0.00';
      cell.alignment = { horizontal: col.type === 'money' ? 'left' : 'right' };
      cell.border = { top: { style: 'double', color: { argb: 'FF1F3A5F' } } };
    });
  }

  report.columns.forEach((c, i) => {
    let maxLen = String(c.label).length;
    report.rows.slice(0, 200).forEach(r => { maxLen = Math.max(maxLen, String(r[c.key] ?? '').length); });
    ws.getColumn(i + 1).width = Math.min(42, Math.max(12, maxLen + 4));
  });

  if (report.rows.length) {
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: colCount } };
  }
}

/** ورقة غلاف للمصنف */
function addCoverSheet(wb, list, meta = {}) {
  const ws = wb.addWorksheet('الغلاف', { views: [{ rightToLeft: true }] });
  ws.columns = [{ width: 34 }, { width: 16 }, { width: 22 }, { width: 46 }];

  ws.mergeCells('A1:D1');
  const t = ws.getCell('A1');
  t.value = 'نظام أرض العيينة المحاسبي';
  t.font = { bold: true, size: 20, color: { argb: 'FFFFFFFF' } };
  t.fill = HEADER_FILL;
  t.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(1).height = 34;

  ws.mergeCells('A2:D2');
  const s = ws.getCell('A2');
  s.value = meta.environment === 'demo'
    ? '⚠ بيانات تجريبية (بيئة Demo) — لا تمثل عمليات حقيقية'
    : 'بيانات حقيقية من قاعدة الإنتاج';
  s.font = { bold: true, size: 12, color: { argb: meta.environment === 'demo' ? 'FFB45309' : 'FF15803D' } };
  s.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(2).height = 22;

  const info = [
    ['المشروع', meta.projectName || 'كل المشاريع'],
    ['الفترة', (meta.from || meta.to) ? `${meta.from || '—'} إلى ${meta.to || '—'}` : 'كل الفترات'],
    ['تاريخ الإنشاء', new Date().toLocaleString('en-GB')],
    ['عدد التقارير', String(list.length)],
    ['العملة', 'ريال سعودي (SAR)']
  ];
  let r = 4;
  for (const [k, v] of info) {
    ws.getCell(`A${r}`).value = k;
    ws.getCell(`A${r}`).font = { bold: true, color: { argb: 'FF1F3A5F' } };
    ws.getCell(`A${r}`).alignment = { horizontal: 'right' };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = v;
    ws.getCell(`B${r}`).alignment = { horizontal: 'right' };
    r++;
  }

  r += 1;
  ws.mergeCells(`A${r}:D${r}`);
  const h = ws.getCell(`A${r}`);
  h.value = 'فهرس التقارير';
  h.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  h.fill = HEADER_FILL;
  h.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(r).height = 22;
  r++;

  const head = ws.getRow(r);
  head.values = ['التقرير', 'عدد السجلات', 'الورقة', 'الوصف'];
  head.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FF1F3A5F' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
    cell.alignment = { horizontal: 'right' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB8C4D6' } } };
  });
  r++;

  list.forEach((item, i) => {
    const row = ws.getRow(r);
    row.values = [item.report.title, item.report.row_count, item.sheetName, item.report.description || ''];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.alignment = { horizontal: colNumber === 2 ? 'center' : 'right', vertical: 'middle' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E9F0' } } };
      if (i % 2 === 1) cell.fill = STRIPE_FILL;
    });
    r++;
  });

  r += 1;
  ws.mergeCells(`A${r}:D${r}`);
  const note = ws.getCell(`A${r}`);
  note.value = 'جميع الأرقام في هذا المصنف محسوبة آليًا من العمليات المسجلة في النظام، ولا تُدخل يدويًا.';
  note.font = { italic: true, size: 10, color: { argb: 'FF7B8A9C' } };
  note.alignment = { horizontal: 'right' };
  return ws;
}

/** مصنف بتقرير واحد */
async function toXLSX(report, meta = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'نظام أرض العيينة المحاسبي';
  wb.created = new Date();
  const ws = wb.addWorksheet(safeSheetName(report.title), {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }]
  });
  fillSheet(ws, report, meta);
  return await wb.xlsx.writeBuffer();
}

/**
 * مصنف يجمع عدة تقارير في ملف واحد مع ورقة غلاف وفهرس
 * @param {Array} list  [{ report, sheetName }]
 */
async function toWorkbookXLSX(list, meta = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'نظام أرض العيينة المحاسبي';
  wb.created = new Date();
  const used = new Set(['الغلاف']);
  addCoverSheet(wb, list, meta);
  for (const item of list) {
    const name = item.sheetName || safeSheetName(item.report.title, used);
    item.sheetName = name;
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }] });
    fillSheet(ws, item.report, meta);
  }
  return await wb.xlsx.writeBuffer();
}

module.exports = { toCSV, toXLSX, toWorkbookXLSX, safeSheetName };
