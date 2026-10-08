'use strict';
/** مسارات البيانات المرجعية والإدارة */
const express = require('express');
const { wrap } = require('../middleware/errors');
const { requirePerm, requireAuth } = require('../middleware/auth');
const { badRequest } = require('../utils/helpers');
const admin = require('../services/admin.service');
const parties = require('../services/parties.service');
const funding = require('../services/funding.service');
const search = require('../services/search.service');
const config = require('../config');
const { getDb } = require('../db');

const router = express.Router();

/* -------- معلومات النظام + القوائم المنسدلة -------- */
router.get('/meta', requireAuth, wrap(async (req, res) => {
  res.json({
    ok: true,
    data: {
      environment: config.isDemo ? 'demo' : 'production',
      currency: config.currency,
      default_vat_rate: config.defaultVatRate,
      projects: admin.listProjects(),
      cost_centers: admin.listCostCenters(),
      funding_sources: getDb().prepare('SELECT id, code, name, credit_limit FROM funding_sources WHERE is_active = 1 ORDER BY name').all(),
      accounts: admin.listAccounts(),
      roles: getDb().prepare('SELECT id, code, name FROM roles ORDER BY id').all(),
      statuses: {
        advance: { open: 'مفتوحة', under_settlement: 'تحت الإخلاء', partially_closed: 'مغلقة جزئيًا', closed: 'مغلقة' },
        approval: { draft: 'مسودة', pending: 'بانتظار الاعتماد', approved: 'معتمدة', rejected: 'مرفوضة' },
        review: { pending: 'قيد المراجعة', reviewed: 'تمت المراجعة', returned: 'مُعاد' },
        invoice: { draft: 'مسودة', unpaid: 'غير مدفوعة', partial: 'مدفوعة جزئيًا', paid: 'مدفوعة بالكامل', void: 'ملغاة' },
        transfer_type: { advance: 'تحويل لعهدة مقاول', supplier: 'تحويل لمورد', other: 'تحويل آخر' },
        payment_type: { supplier_invoice: 'سداد فاتورة مورد', advance: 'دفعة على عهدة', advance_payment: 'دفعة مقدمة', other: 'أخرى' }
      }
    }
  });
}));

router.get('/options/:kind', requireAuth, wrap(async (req, res) => {
  const kind = req.params.kind;
  if (!['contractors', 'suppliers'].includes(kind)) throw badRequest('نوع القائمة غير معروف');
  res.json({ ok: true, data: parties.options(kind) });
}));

/* -------- البحث الشامل -------- */
router.get('/search', requireAuth, wrap(async (req, res) => {
  res.json({ ok: true, data: search.search(req.query.q, { limit: req.query.limit }) });
}));

/* -------- المشاريع -------- */
router.get('/projects', requireAuth, wrap(async (req, res) => res.json({ ok: true, data: admin.listProjects() })));
router.post('/projects', requirePerm('settings.update'), wrap(async (req, res) => res.status(201).json({ ok: true, data: admin.createProject(req.body, req) })));
router.put('/projects/:id', requirePerm('settings.update'), wrap(async (req, res) => res.json({ ok: true, data: admin.updateProject(Number(req.params.id), req.body, req) })));

/* -------- مراكز التكلفة -------- */
router.get('/cost-centers', requireAuth, wrap(async (req, res) => res.json({ ok: true, data: admin.listCostCenters(req.query.project_id) })));
router.post('/cost-centers', requirePerm('settings.update'), wrap(async (req, res) => res.status(201).json({ ok: true, data: admin.createCostCenter(req.body, req) })));
router.put('/cost-centers/:id', requirePerm('settings.update'), wrap(async (req, res) => res.json({ ok: true, data: admin.updateCostCenter(Number(req.params.id), req.body, req) })));

/* -------- دليل الحسابات -------- */
router.get('/accounts', requirePerm('accounts.view'), wrap(async (req, res) => res.json({ ok: true, data: admin.listAccounts(req.query.type) })));
router.post('/accounts', requirePerm('accounts.manage'), wrap(async (req, res) => res.status(201).json({ ok: true, data: admin.createAccount(req.body, req) })));
router.put('/accounts/:id', requirePerm('accounts.manage'), wrap(async (req, res) => res.json({ ok: true, data: admin.updateAccount(Number(req.params.id), req.body, req) })));

/* -------- مصادر التمويل -------- */
router.get('/funding-sources', requirePerm('funding_sources.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: funding.list(req.query, { page: req.query.page, pageSize: req.query.pageSize, sort: req.query.sort, dir: req.query.dir }) });
}));
router.get('/funding-sources/analysis', requirePerm('funding_sources.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: funding.analysis({ from: req.query.from, to: req.query.to, projectId: req.query.project_id }) });
}));
router.get('/funding-sources/:id', requirePerm('funding_sources.view'), wrap(async (req, res) => res.json({ ok: true, data: funding.getById(Number(req.params.id)) })));
router.post('/funding-sources', requirePerm('funding_sources.create'), wrap(async (req, res) => res.status(201).json({ ok: true, data: funding.create(req.body, req) })));
router.put('/funding-sources/:id', requirePerm('funding_sources.update'), wrap(async (req, res) => res.json({ ok: true, data: funding.update(Number(req.params.id), req.body, req) })));
router.post('/funding-sources/:id/void', requirePerm('funding_sources.void'), wrap(async (req, res) => res.json({ ok: true, data: funding.deactivate(Number(req.params.id), req, req.body.hard) })));

/* -------- المقاولون -------- */
router.get('/contractors', requirePerm('contractors.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: parties.listContractors(req.query, { page: req.query.page, pageSize: req.query.pageSize, sort: req.query.sort, dir: req.query.dir }) });
}));
router.get('/contractors/:id', requirePerm('contractors.view'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const advances = require('../services/advances.service');
  res.json({
    ok: true,
    data: {
      contractor: parties.getContractor(id),
      advances: advances.list({ contractor_id: id, pageSize: 200 }, { page: 1, pageSize: 200 }).rows,
      settlements: require('../services/settlements.service').list({ contractor_id: id }, { page: 1, pageSize: 200 }).rows,
      transfers: require('../services/transfers.service').list({ contractor_id: id }, { page: 1, pageSize: 200 }).rows,
      audit_trail: admin.getAuditTrail('contractor', id)
    }
  });
}));
router.post('/contractors', requirePerm('contractors.create'), wrap(async (req, res) => res.status(201).json({ ok: true, data: parties.createContractor(req.body, req) })));
router.put('/contractors/:id', requirePerm('contractors.update'), wrap(async (req, res) => res.json({ ok: true, data: parties.updateContractor(Number(req.params.id), req.body, req) })));

/* -------- الموردون -------- */
router.get('/suppliers', requirePerm('suppliers.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: parties.listSuppliers(req.query, { page: req.query.page, pageSize: req.query.pageSize, sort: req.query.sort, dir: req.query.dir }) });
}));
router.get('/suppliers/:id', requirePerm('suppliers.view'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  res.json({
    ok: true,
    data: {
      supplier: parties.getSupplier(id),
      invoices: require('../services/invoices.service').listInvoices({ supplier_id: id }, { page: 1, pageSize: 200 }).rows,
      payments: require('../services/invoices.service').listPayments({ supplier_id: id }, { page: 1, pageSize: 200 }).rows,
      transfers: require('../services/transfers.service').list({ supplier_id: id }, { page: 1, pageSize: 200 }).rows,
      audit_trail: admin.getAuditTrail('supplier', id)
    }
  });
}));
router.post('/suppliers', requirePerm('suppliers.create'), wrap(async (req, res) => res.status(201).json({ ok: true, data: parties.createSupplier(req.body, req) })));
router.put('/suppliers/:id', requirePerm('suppliers.update'), wrap(async (req, res) => res.json({ ok: true, data: parties.updateSupplier(Number(req.params.id), req.body, req) })));

/* -------- المستخدمون والأدوار -------- */
router.get('/users', requirePerm('users.view'), wrap(async (req, res) => res.json({ ok: true, data: admin.listUsers() })));
router.post('/users', requirePerm('users.create'), wrap(async (req, res) => res.status(201).json({ ok: true, data: admin.createUser(req.body, req) })));
router.put('/users/:id', requirePerm('users.update'), wrap(async (req, res) => res.json({ ok: true, data: admin.updateUser(Number(req.params.id), req.body, req) })));
router.post('/users/:id/reset-password', requirePerm('users.update'), wrap(async (req, res) => res.json({ ok: true, data: admin.resetPassword(Number(req.params.id), req.body.new_password, req) })));

router.get('/roles', requirePerm('users.view'), wrap(async (req, res) => res.json({ ok: true, data: admin.listRoles() })));
router.get('/permissions', requirePerm('users.roles'), wrap(async (req, res) => res.json({ ok: true, data: { permissions: admin.listPermissions(), modules: require('../utils/permissions').MODULES } })));
router.put('/roles/:id/permissions', requirePerm('users.roles'), wrap(async (req, res) => res.json({ ok: true, data: admin.updateRolePermissions(Number(req.params.id), req.body.permissions, req) })));

/* -------- الإعدادات -------- */
router.get('/settings', requirePerm('settings.view'), wrap(async (req, res) => res.json({ ok: true, data: admin.listSettings() })));
router.put('/settings', requirePerm('settings.update'), wrap(async (req, res) => res.json({ ok: true, data: admin.updateSettings(req.body, req) })));

/* -------- سجل العمليات -------- */
router.get('/audit-logs', requirePerm('audit_logs.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: admin.listAudit(req.query, { page: req.query.page, pageSize: req.query.pageSize, sort: req.query.sort, dir: req.query.dir }) });
}));
router.get('/audit-logs/:entityType/:entityId', requirePerm('audit_logs.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: admin.getAuditTrail(req.params.entityType, req.params.entityId) });
}));
router.post('/audit-logs/purge', requirePerm('audit_logs.purge'), wrap(async (req, res) => {
  res.json({ ok: true, data: admin.purgeAudit(req.body.before_date, req) });
}));

module.exports = router;
