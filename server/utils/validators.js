'use strict';
/**
 * دوال التحقق المشتركة من المدخلات (Validation Rules)
 */
const { badRequest, clean, toNumber, round2, validDate, escapeLike } = require('./helpers');
const { getDb } = require('../db');

function reqStr(value, field, max = 200) {
  const v = clean(value);
  if (!v) throw badRequest(`حقل "${field}" مطلوب`);
  if (String(v).length > max) throw badRequest(`حقل "${field}" يتجاوز ${max} حرفًا`);
  return String(v);
}

function optStr(value, max = 500) {
  const v = clean(value);
  if (v && String(v).length > max) throw badRequest(`النص يتجاوز ${max} حرفًا`);
  return v ? String(v) : null;
}

function reqDate(value, field) {
  const v = clean(value);
  if (!v) throw badRequest(`حقل "${field}" مطلوب`);
  const s = String(v).slice(0, 10);
  if (!validDate(s)) throw badRequest(`صيغة "${field}" غير صحيحة (المطلوب YYYY-MM-DD)`);
  return s;
}

function optDate(value) {
  const v = clean(value);
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!validDate(s)) throw badRequest(`صيغة التاريخ غير صحيحة (المطلوب YYYY-MM-DD): ${s}`);
  return s;
}

function reqMoney(value, field, { min = 0.01, allowZero = false } = {}) {
  const v = clean(value);
  if (v === null) throw badRequest(`حقل "${field}" مطلوب`);
  const n = round2(toNumber(v));
  if (allowZero ? n < 0 : n < min) {
    throw badRequest(allowZero ? `"${field}" يجب أن يكون صفرًا أو أكثر` : `"${field}" يجب أن يكون أكبر من صفر`);
  }
  if (n > 999999999) throw badRequest(`"${field}" يتجاوز الحد المسموح`);
  return n;
}

function optMoney(value, { allowNegative = false } = {}) {
  const v = clean(value);
  if (v === null) return 0;
  const n = round2(toNumber(v));
  if (!allowNegative && n < 0) throw badRequest('المبلغ لا يمكن أن يكون سالبًا');
  return n;
}

function reqId(value, field) {
  const v = clean(value);
  if (!v) throw badRequest(`حقل "${field}" مطلوب`);
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`"${field}" غير صالح`);
  return n;
}

function optId(value) {
  const v = clean(value);
  if (!v) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('المعرّف غير صالح');
  return n;
}

function oneOf(value, field, allowed, required = true) {
  const v = clean(value);
  if (!v) {
    if (required) throw badRequest(`حقل "${field}" مطلوب`);
    return null;
  }
  if (!allowed.includes(v)) throw badRequest(`قيمة "${field}" غير مسموحة (المسموح: ${allowed.join('، ')})`);
  return v;
}

function mustExist(table, id, label) {
  const row = getDb().prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id);
  if (!row) throw badRequest(`${label} غير موجود`);
  return row;
}

/** بناء شرط WHERE ديناميكي آمن (بدون SQL Injection) */
class QueryBuilder {
  constructor(baseSql, { joinSuffix = '', orderSql = '', groupSql = '' } = {}) {
    this.base = baseSql;
    this.joinSuffix = joinSuffix;
    this.groupSql = groupSql;
    this.orderSql = orderSql;
    this.conditions = [];
    this.params = [];
  }
  where(sql, ...params) { this.conditions.push(sql); this.params.push(...params); return this; }
  whereIf(cond, sql, ...params) { if (cond) return this.where(sql, ...params); return this; }
  like(field, value) {
    const v = clean(value);
    if (!v) return this;
    return this.where(`${field} LIKE ? ESCAPE '\\'`, `%${escapeLike(v)}%`);
  }
  eq(field, value) {
    const v = clean(value);
    if (v === null || v === '') return this;
    return this.where(`${field} = ?`, v);
  }
  eqRaw(field, value) {
    if (value === undefined || value === null || value === '') return this;
    return this.where(`${field} = ?`, value);
  }
  between(field, from, to) {
    const f = clean(from), t = clean(to);
    if (f) this.where(`date(${field}) >= date(?)`, f);
    if (t) this.where(`date(${field}) <= date(?)`, t);
    return this;
  }
  in(field, list) {
    if (!Array.isArray(list) || !list.length) return this;
    const marks = list.map(() => '?').join(',');
    return this.where(`${field} IN (${marks})`, ...list);
  }
  clause() { return this.conditions.length ? `WHERE ${this.conditions.join(' AND ')}` : ''; }
  build({ page = 1, pageSize = 20, sort = null, dir = 'asc', allowedSorts = [] } = {}) {
    const where = this.clause();
    const orderBy = sort && allowedSorts.includes(sort)
      ? `ORDER BY ${sort} ${String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`
      : this.orderSql;
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 20));
    const sql = `${this.base} ${this.joinSuffix} ${where} ${this.groupSql} ${orderBy} LIMIT ? OFFSET ?`;
    return { sql, params: [...this.params, ps, (p - 1) * ps], page: p, pageSize: ps };
  }
  rows() { return getDb().prepare(`${this.base} ${this.joinSuffix} ${this.clause()} ${this.groupSql} ${this.orderSql}`).all(this.params); }
  scalar() { const r = getDb().prepare(`${this.base} ${this.joinSuffix} ${this.clause()} ${this.groupSql}`).get(this.params); return r ? Object.values(r)[0] : 0; }
}

/** تنفيذ استعلام مع Pagination + إجمالي السجلات */
function paginate(qb, { page, pageSize, sort, dir, allowedSorts }) {
  const db = getDb();
  const built = qb.build({ page, pageSize, sort, dir, allowedSorts });
  const rows = db.prepare(built.sql).all(built.params);
  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM (${qb.base} ${qb.joinSuffix} ${qb.clause()} ${qb.groupSql})`).get(qb.params);
  const total = totalRow ? totalRow.c : 0;
  return {
    rows,
    pagination: {
      page: built.page,
      pageSize: built.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / built.pageSize))
    }
  };
}

module.exports = {
  reqStr, optStr, reqDate, optDate, reqMoney, optMoney, reqId, optId,
  oneOf, mustExist, QueryBuilder, paginate
};
