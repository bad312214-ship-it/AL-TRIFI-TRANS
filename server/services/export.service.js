'use strict';
/**
 * خدمة التصدير: CSV / Excel (XLSX) / PDF (عبر عرض طباعة في الواجهة)
 */
const ExcelJS = require('exceljs');
const reports = require('./reports.service');

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
  const csv = '\uFEFF' + lines.join('\r\n');
  return csv;
}

async function toXLSX(report, meta = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'نظام أرض العيينة المحاسبي';
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 30), {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }]
  });

  ws.mergeCells(1, 1, 1, Math.max(1, report.columns.length));
  const titleCell = ws.getCell(1, 1);
  titleCell.value = report.title;
  titleCell.font = { bold: true, size: 16, color: { argb: 'FF1F3A5F' } };
  titleCell.alignment = { horizontal: 'right', vertical: 'middle' };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, Math.max(1, report.columns.length));
  const sub = ws.getCell(2, 1);
  const f = report.filters || {};
  const periodTxt = (f.from || f.to) ? `الفترة: ${f.from || '—'} إلى ${f.to || '—'}` : 'كل الفترات';
  sub.value = `${meta.projectName ? meta.projectName + ' | ' : ''}${periodTxt} | عدد السجلات: ${report.row_count} | تاريخ الإنشاء: ${new Date().toLocaleString('ar-SA')}`;
  sub.font = { size: 10, color: { argb: 'FF666666' } };
  sub.alignment = { horizontal: 'right' };

  ws.getRow(3).height = 6;

  const headerRow = ws.getRow(4);
  headerRow.values = report.columns.map(c => c.label);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A5F' } };
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
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
    });
  });

  if (report.totalKeys && report.totalKeys.length) {
    const totals = [];
    report.columns.forEach((c, i) => {
      totals.push(i === 0 ? 'الإجمالي' : (report.totalKeys.includes(c.key) ? Number(report.totals[c.key] || 0) : ''));
    });
    const tr = ws.addRow(totals);
    tr.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const col = report.columns[colNumber - 1];
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
      if (col.type === 'money') cell.numFmt = '#,##0.00';
      cell.alignment = { horizontal: col.type === 'money' ? 'left' : 'right' };
      cell.border = { top: { style: 'double', color: { argb: 'FF1F3A5F' } } };
    });
  }

  report.columns.forEach((c, i) => {
    const letter = ws.getColumn(i + 1).letter;
    let maxLen = String(c.label).length;
    report.rows.slice(0, 200).forEach(r => { maxLen = Math.max(maxLen, String(r[c.key] ?? '').length); });
    ws.getColumn(letter).width = Math.min(42, Math.max(12, maxLen + 4));
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: report.columns.length } };

  return await wb.xlsx.writeBuffer();
}

module.exports = { toCSV, toXLSX };
