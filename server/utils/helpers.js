'use strict';
/** أدوات عامة: أرقام، أموال، تواريخ، معرفات، أخطاء */

class AppError extends Error {
  constructor(message, status = 400, code = 'VALIDATION', details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const notFound = (what = 'السجل') => new AppError(`${what} غير موجود`, 404, 'NOT_FOUND');
const forbidden = (msg = 'ليست لديك صلاحية لتنفيذ هذا الإجراء') => new AppError(msg, 403, 'FORBIDDEN');
/**
 * خطأ تحقّق من المدخلات.
 * badRequest(msg)                        → 400 VALIDATION
 * badRequest(msg, details)               → 400 VALIDATION + تفاصيل
 * badRequest(msg, status, code, details) → حالة ورمز مخصّصان
 */
function badRequest(msg, arg2, arg3, arg4) {
  if (typeof arg2 === 'number') return new AppError(msg, arg2, arg3 || 'VALIDATION', arg4 ?? null);
  return new AppError(msg, 400, 'VALIDATION', arg2 ?? null);
}

/** تقريب آمن لرقمين عشريين مع معالجة أخطاء الفاصلة العائمة */
function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function money(n) { return round2(n || 0); }

/** مقارنة مالية تتجاهل فروق التقريب الصغيرة */
function eqMoney(a, b, eps = 0.005) { return Math.abs(round2(a) - round2(b)) < eps; }
function gteMoney(a, b) { return round2(a) - round2(b) > -0.005; }

function toNumber(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '').trim()) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clean(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(v) { return typeof v === 'string' && DATE_RE.test(v); }

function todayISO() { return new Date().toISOString().slice(0, 10); }
function nowISO() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

function escapeLike(v) { return String(v).replace(/[\\%_]/g, c => '\\' + c); }

/** تنسيق مبلغ بالعربية السعودية */
function formatMoney(v) {
  const n = round2(v);
  return n.toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** اختلاف بين كائنين (لسجل العمليات) - يقارن المفاتيح المشتركة فقط */
function diffObjects(oldObj, newObj, fields) {
  const changes = {};
  for (const f of fields) {
    const a = oldObj?.[f] ?? null;
    const b = newObj?.[f] ?? null;
    if (String(a) !== String(b)) changes[f] = { from: a, to: b };
  }
  return changes;
}

module.exports = {
  AppError, notFound, forbidden, badRequest,
  round2, money, eqMoney, gteMoney, toNumber, clean,
  validDate, todayISO, nowISO, escapeLike, formatMoney, diffObjects
};
