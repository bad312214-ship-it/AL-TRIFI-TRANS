'use strict';
/** معالجة الأخطاء المركزية + تغليف المسارات غير المتزامنة */
const { AppError } = require('../utils/helpers');
const config = require('../config');

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let code = err.code || 'INTERNAL';
  let message = err.message || 'حدث خطأ غير متوقع';

  // أخطاء قيود SQLite → رسالة عربية واضحة
  if (err && typeof err.message === 'string' && err.message.includes('UNIQUE constraint failed')) {
    status = 409; code = 'DUPLICATE';
    const field = err.message.split('failed:')[1] || '';
    message = `تم تسجيل هذه العملية مسبقًا — لا يمكن تكرارها (${field.trim()})`;
  } else if (err && err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    status = 409; code = 'FK';
    message = 'لا يمكن تنفيذ العملية لارتباط هذا السجل ببيانات أخرى';
  }

  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    ok: false,
    error: { code, message, details: err.details || null }
  });
}

function notFoundRoute(req, res) {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `المسار غير موجود: ${req.method} ${req.originalUrl}` } });
}

module.exports = { wrap, errorHandler, notFoundRoute, AppError, config };
