'use strict';
/**
 * كتالوج الصلاحيات والأدوار
 * الصلاحيات مخزّنة في قاعدة البيانات ويمكن تعديلها، وهذا الملف هو المرجع الأولي.
 */

const MODULES = {
  dashboard: 'لوحة التحكم',
  funding_sources: 'مصادر التمويل',
  contractors: 'المقاولون',
  suppliers: 'الموردون',
  advances: 'عهد المقاولين',
  transfers: 'التحويلات المالية',
  settlements: 'إخلاء العهد',
  supplier_invoices: 'فواتير الموردين',
  payments: 'الدفعات',
  reports: 'التقارير',
  reconciliation: 'المطابقة',
  audit_logs: 'سجل العمليات',
  users: 'المستخدمون',
  settings: 'الإعدادات',
  attachments: 'المرفقات',
  accounts: 'دليل الحسابات'
};

// code => [module, action, name, description]
const PERMISSIONS = {
  'dashboard.view':        ['dashboard', 'view', 'عرض لوحة التحكم', 'مشاهدة المؤشرات والتقارير الملخصة'],

  'funding_sources.view':  ['funding_sources', 'view', 'عرض مصادر التمويل', ''],
  'funding_sources.create':['funding_sources', 'create', 'إضافة مصدر تمويل', ''],
  'funding_sources.update':['funding_sources', 'update', 'تعديل مصدر تمويل', ''],
  'funding_sources.void':  ['funding_sources', 'void', 'إلغاء مصدر تمويل', ''],

  'contractors.view':      ['contractors', 'view', 'عرض المقاولين', ''],
  'contractors.create':    ['contractors', 'create', 'إضافة مقاول', ''],
  'contractors.update':    ['contractors', 'update', 'تعديل مقاول', ''],

  'suppliers.view':        ['suppliers', 'view', 'عرض الموردين', ''],
  'suppliers.create':      ['suppliers', 'create', 'إضافة مورد', ''],
  'suppliers.update':      ['suppliers', 'update', 'تعديل مورد', ''],

  'advances.view':         ['advances', 'view', 'عرض العهد', ''],
  'advances.create':       ['advances', 'create', 'إضافة عهدة', ''],
  'advances.update':       ['advances', 'update', 'تعديل عهدة', ''],
  'advances.approve':      ['advances', 'approve', 'اعتماد العهدة', ''],
  'advances.void':         ['advances', 'void', 'إلغاء العهدة', ''],
  'advances.close':        ['advances', 'close', 'إغلاق العهدة', 'إغلاق العهدة حتى مع وجود رصيد'],

  'transfers.view':        ['transfers', 'view', 'عرض التحويلات', ''],
  'transfers.create':      ['transfers', 'create', 'إضافة تحويل', ''],
  'transfers.update':      ['transfers', 'update', 'تعديل تحويل', ''],
  'transfers.approve':     ['transfers', 'approve', 'اعتماد التحويل', ''],
  'transfers.void':        ['transfers', 'void', 'إلغاء التحويل', ''],

  'settlements.view':      ['settlements', 'view', 'عرض إخلاءات العهد', ''],
  'settlements.create':    ['settlements', 'create', 'إضافة إخلاء عهدة', ''],
  'settlements.update':    ['settlements', 'update', 'تعديل إخلاء عهدة', ''],
  'settlements.review':    ['settlements', 'review', 'مراجعة الإخلاء', ''],
  'settlements.approve':   ['settlements', 'approve', 'اعتماد الإخلاء', ''],
  'settlements.void':      ['settlements', 'void', 'إلغاء الإخلاء', ''],
  'settlements.over_settle':['settlements', 'over_settle', 'الموافقة على تجاوز رصيد العهدة', 'صلاحية خاصة تسمح بإخلاء مبلغ أكبر من الرصيد المتبقي'],

  'supplier_invoices.view':  ['supplier_invoices', 'view', 'عرض فواتير الموردين', ''],
  'supplier_invoices.create':['supplier_invoices', 'create', 'إضافة فاتورة مورد', ''],
  'supplier_invoices.update':['supplier_invoices', 'update', 'تعديل فاتورة مورد', ''],
  'supplier_invoices.approve':['supplier_invoices', 'approve', 'اعتماد فاتورة مورد', ''],
  'supplier_invoices.void':  ['supplier_invoices', 'void', 'إلغاء فاتورة مورد', ''],

  'payments.view':         ['payments', 'view', 'عرض الدفعات', ''],
  'payments.create':       ['payments', 'create', 'تسجيل دفعة', ''],
  'payments.update':       ['payments', 'update', 'تعديل دفعة', ''],
  'payments.void':         ['payments', 'void', 'إلغاء دفعة', ''],

  'reports.view':          ['reports', 'view', 'عرض التقارير', ''],
  'reports.export':        ['reports', 'export', 'تصدير التقارير', 'Excel / CSV / PDF'],

  'reconciliation.view':   ['reconciliation', 'view', 'عرض تقرير المطابقة', ''],

  'audit_logs.view':       ['audit_logs', 'view', 'عرض سجل العمليات', ''],
  'audit_logs.purge':      ['audit_logs', 'purge', 'حذف سجلات قديمة', 'صلاحية مدير النظام فقط'],

  'users.view':            ['users', 'view', 'عرض المستخدمين', ''],
  'users.create':          ['users', 'create', 'إضافة مستخدم', ''],
  'users.update':          ['users', 'update', 'تعديل مستخدم', ''],
  'users.roles':           ['users', 'roles', 'إدارة الأدوار والصلاحيات', ''],

  'settings.view':         ['settings', 'view', 'عرض الإعدادات', ''],
  'settings.update':       ['settings', 'update', 'تعديل الإعدادات', ''],

  'accounts.view':         ['accounts', 'view', 'عرض دليل الحسابات', ''],
  'accounts.manage':       ['accounts', 'manage', 'إدارة دليل الحسابات', ''],

  'attachments.upload':    ['attachments', 'upload', 'رفع المرفقات', ''],
  'attachments.delete':    ['attachments', 'delete', 'حذف المرفقات', '']
};

const ROLES = [
  {
    code: 'admin',
    name: 'مدير النظام (Administrator)',
    description: 'صلاحيات كاملة على النظام بما فيها المستخدمون والصلاحيات والسجلات',
    is_system: 1,
    permissions: Object.keys(PERMISSIONS)
  },
  {
    code: 'accountant',
    name: 'محاسب (Accountant)',
    description: 'إضافة وتعديل العمليات المحاسبية والاطلاع على التقارير والتصدير',
    is_system: 1,
    permissions: [
      'dashboard.view',
      'funding_sources.view', 'funding_sources.create', 'funding_sources.update',
      'contractors.view', 'contractors.create', 'contractors.update',
      'suppliers.view', 'suppliers.create', 'suppliers.update',
      'advances.view', 'advances.create', 'advances.update', 'advances.void', 'advances.close',
      'transfers.view', 'transfers.create', 'transfers.update', 'transfers.void',
      'settlements.view', 'settlements.create', 'settlements.update',
      'supplier_invoices.view', 'supplier_invoices.create', 'supplier_invoices.update',
      'payments.view', 'payments.create', 'payments.update',
      'reports.view', 'reports.export',
      'reconciliation.view',
      'accounts.view',
      'attachments.upload', 'attachments.delete',
      'settings.view'
    ]
  },
  {
    code: 'reviewer',
    name: 'مراجع (Reviewer)',
    description: 'المراجعة والاعتماد مع إمكانية الموافقة على تجاوز رصيد العهدة',
    is_system: 1,
    permissions: [
      'dashboard.view',
      'funding_sources.view', 'contractors.view', 'suppliers.view',
      'advances.view', 'advances.approve', 'advances.close',
      'transfers.view', 'transfers.approve',
      'settlements.view', 'settlements.review', 'settlements.approve', 'settlements.over_settle',
      'supplier_invoices.view', 'supplier_invoices.approve',
      'payments.view',
      'reports.view', 'reports.export',
      'reconciliation.view',
      'audit_logs.view',
      'accounts.view',
      'attachments.upload'
    ]
  },
  {
    code: 'viewer',
    name: 'مطلع (Viewer)',
    description: 'عرض البيانات والتقارير فقط',
    is_system: 1,
    permissions: [
      'dashboard.view',
      'funding_sources.view', 'contractors.view', 'suppliers.view',
      'advances.view', 'transfers.view', 'settlements.view',
      'supplier_invoices.view', 'payments.view',
      'reports.view', 'reports.export', 'reconciliation.view',
      'accounts.view'
    ]
  }
];

module.exports = { MODULES, PERMISSIONS, ROLES };
