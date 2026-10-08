'use strict';
/**
 * دفتر الأستاذ العام (Double-Entry Ledger)
 * كل عملية مالية معتمدة تُولِّد قيدًا محاسبيًا متوازنًا تلقائيًا.
 */
const { getDb } = require('../db');
const { round2, eqMoney, badRequest } = require('../utils/helpers');
const { nextDocNo } = require('../utils/sequence');

const SYSTEM_ACCOUNTS = {
  cash:            { code: '1100', name: 'النقدية والبنوك', type: 'asset', nature: 'debit' },
  advances_asset:  { code: '1200', name: 'عهدي المقاولين', type: 'asset', nature: 'debit' },
  supplier_adv:    { code: '1300', name: 'دفعات مقدمة للموردين', type: 'asset', nature: 'debit' },
  vat_input:       { code: '1400', name: 'ضريبة القيمة المضافة - المدخلات', type: 'asset', nature: 'debit' },
  partner_current: { code: '2100', name: 'جاري الشركاء', type: 'liability', nature: 'credit' },
  suppliers_pay:   { code: '2200', name: 'حسابات الموردين', type: 'liability', nature: 'credit' },
  vat_output:      { code: '2300', name: 'ضريبة القيمة المضافة - المستحقة', type: 'liability', nature: 'credit' },
  project_expense: { code: '4100', name: 'مصاريف المشاريع', type: 'expense', nature: 'debit' }
};

function accountIdByCode(code) {
  const row = getDb().prepare('SELECT id FROM accounts WHERE code = ?').get(code);
  return row ? row.id : null;
}

function sysAccount(key) {
  const def = SYSTEM_ACCOUNTS[key];
  const id = accountIdByCode(def.code);
  if (!id) throw badRequest(`الحساب النظامي ${def.code} - ${def.name} غير مُهيّأ`);
  return id;
}

/** إلغاء القيود السابقة المرتبطة بمرجع معين */
function voidEntriesFor(refType, refId) {
  const db = getDb();
  db.prepare('UPDATE journal_entries SET is_void = 1 WHERE ref_type = ? AND ref_id = ? AND is_void = 0').run(refType, refId);
}

/**
 * إنشاء قيد محاسبي
 * @param {object} p { refType, refId, date, description, projectId, lines: [{accountKey|accountId, debit, credit, costCenterId, memo}] }
 */
function post({ refType, refId, date, description, projectId, lines }, ctx) {
  const db = getDb();
  const norm = lines
    .map(l => ({
      account_id: l.accountId || sysAccount(l.accountKey),
      debit: round2(l.debit || 0),
      credit: round2(l.credit || 0),
      cost_center_id: l.costCenterId || null,
      memo: l.memo || null
    }))
    .filter(l => l.debit !== 0 || l.credit !== 0);

  const totalDebit = round2(norm.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(norm.reduce((s, l) => s + l.credit, 0));
  if (!eqMoney(totalDebit, totalCredit)) {
    throw badRequest(`القيد غير متوازن: مدين ${totalDebit} ≠ دائن ${totalCredit}`);
  }
  if (!norm.length) return null;

  voidEntriesFor(refType, refId);
  const entry = db.prepare(`INSERT INTO journal_entries (entry_no, entry_date, ref_type, ref_id, description, project_id, created_by)
                            VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(nextDocNo('journal'), date, refType, refId, description, projectId || null, ctx?.user?.id || null);
  const stmt = db.prepare(`INSERT INTO journal_lines (entry_id, account_id, debit, credit, cost_center_id, memo)
                           VALUES (?, ?, ?, ?, ?, ?)`);
  for (const l of norm) stmt.run(entry.lastInsertRowid, l.account_id, l.debit, l.credit, l.cost_center_id, l.memo);
  return entry.lastInsertRowid;
}

module.exports = { post, voidEntriesFor, SYSTEM_ACCOUNTS, sysAccount };
