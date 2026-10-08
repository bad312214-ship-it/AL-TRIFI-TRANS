'use strict';
/**
 * خدمة سجل العمليات (Audit Log)
 * كل إضافة/تعديل/اعتماد/إلغاء تُسجَّل بالبيانات القديمة والجديدة.
 */
const { getDb } = require('../db');

const ACTION_LABELS = {
  create: 'إضافة',
  update: 'تعديل',
  approve: 'اعتماد',
  reject: 'رفض',
  review: 'مراجعة',
  void: 'إلغاء',
  restore: 'استعادة',
  delete: 'حذف نهائي',
  close: 'إغلاق',
  reopen: 'إعادة فتح',
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  login_failed: 'محاولة دخول فاشلة',
  export: 'تصدير',
  over_settle: 'تجاوز رصيد العهدة',
  upload: 'رفع مرفق',
  download: 'تنزيل مرفق',
  reset_password: 'إعادة تعيين كلمة المرور',
  purge: 'حذف سجلات'
};

/**
 * @param {object} ctx  { user, ip, userAgent }
 */
function log(ctx, { action, entityType, entityId, entityLabel, summary, oldValues, newValues }) {
  const db = getDb();
  db.prepare(`INSERT INTO audit_logs
      (user_id, username, action, entity_type, entity_id, entity_label, summary, old_values, new_values, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      ctx?.user?.id ?? null,
      ctx?.user?.username ?? 'system',
      action,
      entityType,
      entityId ?? null,
      entityLabel ?? null,
      summary ?? ACTION_LABELS[action] ?? action,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ctx?.ip ?? null,
      ctx?.userAgent ?? null
    );
}

module.exports = { log, ACTION_LABELS };
