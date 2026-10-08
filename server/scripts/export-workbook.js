'use strict';
/**
 * توليد مصنف Excel يجمع كل التقارير
 *
 *   node server/scripts/export-workbook.js [مسار_الملف] [project_id] [from] [to]
 *
 * أمثلة:
 *   node server/scripts/export-workbook.js ./exports/oyaynah.xlsx
 *   NODE_ENV=demo node server/scripts/export-workbook.js ./exports/demo.xlsx 1
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { migrate, getDb } = require('../db');
const bootstrap = require('../bootstrap');
const reports = require('../services/reports.service');
const exporter = require('../services/export.service');

async function main() {
  migrate();
  bootstrap.run();

  const out = path.resolve(config.root, process.argv[2] || './exports/oyaynah-reports.xlsx');
  const projectId = process.argv[3] ? Number(process.argv[3]) : null;
  const from = process.argv[4] || undefined;
  const to = process.argv[5] || undefined;

  const projectName = projectId
    ? (getDb().prepare('SELECT name FROM projects WHERE id = ?').get(projectId) || {}).name
    : 'كل المشاريع';

  const filters = { project_id: projectId || undefined, from, to };
  const keys = reports.listReports().map(r => r.key);
  const list = keys.map(key => ({ report: reports.run(key, filters) }));

  const buf = await exporter.toWorkbookXLSX(list, {
    projectName, from, to,
    environment: config.isDemo ? 'demo' : 'production'
  });

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(buf));

  console.log(`[export] البيئة      : ${config.isDemo ? 'DEMO (بيانات تجريبية)' : 'PRODUCTION'}`);
  console.log(`[export] قاعدة البيانات: ${config.dbPath}`);
  console.log(`[export] التقارير    : ${list.length}`);
  for (const it of list) console.log(`            · ${it.sheetName} ← ${it.report.row_count} سجل`);
  console.log(`[export] الملف       : ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
}

main().catch(err => { console.error('[export] فشل:', err.message); process.exit(1); });
