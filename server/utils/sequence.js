'use strict';
/**
 * توليد أرقام المستندات التسلسلية
 * أمثلة: ADV-2026-0001 / TRF-2026-0001 / STL-2026-0001
 */
const { getDb } = require('../db');

const PREFIXES = {
  advance: 'ADV',
  transfer: 'TRF',
  settlement: 'STL',
  payment: 'PAY',
  journal: 'JRN',
  contractor: 'CON',
  supplier: 'SUP'
};

/**
 * @param {string} kind  أحد مفاتيح PREFIXES
 * @param {boolean} yearly  ترقيم سنوي
 */
function nextDocNo(kind, yearly = true, pad = 4) {
  const prefix = PREFIXES[kind];
  if (!prefix) throw new Error(`نوع مستند غير معروف: ${kind}`);
  const year = yearly ? new Date().getFullYear() : null;
  const key = yearly ? `${kind}:${year}` : kind;
  const db = getDb();
  const row = db.prepare('SELECT last_value FROM sequences WHERE key = ?').get(key);
  const next = (row ? row.last_value : 0) + 1;
  db.prepare(`INSERT INTO sequences (key, last_value, updated_at) VALUES (?, ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET last_value = ?, updated_at = datetime('now')`)
    .run(key, next, next);
  const seq = String(next).padStart(pad, '0');
  return yearly ? `${prefix}-${year}-${seq}` : `${prefix}-${seq}`;
}

module.exports = { nextDocNo, PREFIXES };
