'use strict';
/**
 * طبقة الوصول إلى قاعدة البيانات
 * - تنفيذ ملفات الـ migrations بالترتيب
 * - دوال مساعدة للاستعلام داخل المعاملات (Transactions)
 */
const fs = require('fs');
const path = require('path');
const driver = require('./driver');
const config = require('../config');

let db = null;

function getDb() {
  if (db) return db;
  db = driver.open(config.dbPath);
  return db;
}

function migrate() {
  const d = getDb();
  d.exec(`CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
          )`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set(d.prepare('SELECT name FROM _migrations').all().map(r => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    d.transaction(() => {
      d.exec(sql);
      d.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    })();
    console.log(`[migrate] applied ${file}`);
  }
  console.log(`[migrate] driver = ${driver.driverName()}`);
  return d;
}

/** تنفيذ مجموعة أوامر داخل معاملة واحدة */
function tx(fn) {
  return getDb().transaction(fn)();
}

function all(sql, params = []) { return getDb().prepare(sql).all(params); }
function get(sql, params = []) { return getDb().prepare(sql).get(params); }
function run(sql, params = []) { return getDb().prepare(sql).run(params); }

/** إدراج صف وإرجاع الكائن الكامل بعد الإدراج */
function insert(table, data) {
  const keys = Object.keys(data);
  const cols = keys.map(k => `"${k}"`).join(', ');
  const marks = keys.map(() => '?').join(', ');
  const res = getDb().prepare(`INSERT INTO "${table}" (${cols}) VALUES (${marks})`).run(keys.map(k => data[k]));
  return get(`SELECT * FROM "${table}" WHERE id = ?`, [res.lastInsertRowid]);
}

function update(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return get(`SELECT * FROM "${table}" WHERE id = ?`, [id]);
  const sets = keys.map(k => `"${k}" = ?`).join(', ');
  getDb().prepare(`UPDATE "${table}" SET ${sets} WHERE id = ?`).run([...keys.map(k => data[k]), id]);
  return get(`SELECT * FROM "${table}" WHERE id = ?`, [id]);
}

function close() { if (db && db.close) { try { db.close(); } catch { /* ignore */ } db = null; } }

module.exports = { getDb, migrate, tx, all, get, run, insert, update, close, driver };
