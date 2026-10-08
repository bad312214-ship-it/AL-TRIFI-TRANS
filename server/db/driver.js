'use strict';
/**
 * طبقة توحيد محرك SQLite
 *
 * يستخدم better-sqlite3 إن كان مثبَّتًا (الأداء الأفضل)،
 * وإلا يعتمد على node:sqlite المدمج في Node.js ≥ 22.5 (بدون أي اعتماديات أصلية).
 */
const fs = require('fs');

let impl = null;
let implName = null;

function loadBetterSqlite() {
  const Database = require('better-sqlite3');
  return (file) => {
    const raw = new Database(file);
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    raw.pragma('busy_timeout = 5000');
    return raw;
  };
}

function loadNodeSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  return (file) => {
    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA journal_mode = WAL');
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec('PRAGMA busy_timeout = 5000');
    return raw;
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** توحيد طريقة تمرير الوسائط بين المحركين */
function normalize(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

/** تغليف node:sqlite ليقدّم نفس واجهة better-sqlite3 المستخدمة في المشروع */
function adaptNodeSqlite(raw) {
  const wrapStatement = (st) => ({
    all: (...args) => st.all(...normalize(args)),
    get: (...args) => st.get(...normalize(args)),
    run: (...args) => {
      const r = st.run(...normalize(args));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    }
  });
  return {
    prepare: (sql) => wrapStatement(raw.prepare(sql)),
    exec: (sql) => raw.exec(sql),
    pragma: (p) => raw.exec(`PRAGMA ${p}`),
    close: () => raw.close(),
    transaction: (fn) => (...args) => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        try { raw.exec('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      }
    },
    __driver: 'node:sqlite'
  };
}

function open(file) {
  fs.mkdirSync(require('path').dirname(file), { recursive: true });
  if (!impl) {
    try {
      impl = loadBetterSqlite();
      implName = 'better-sqlite3';
    } catch {
      impl = loadNodeSqlite();
      implName = 'node:sqlite (مدمج)';
    }
  }
  const raw = impl(file);
  return implName.startsWith('better') ? raw : adaptNodeSqlite(raw);
}

function driverName() { return implName; }

module.exports = { open, driverName };
