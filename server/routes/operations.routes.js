'use strict';
/**
 * مسارات الوحدات التشغيلية:
 * العهد، التحويلات، إخلاء العهد، فواتير الموردين، الدفعات، المرفقات
 */
const express = require('express');
const multer = require('multer');
const { wrap } = require('../middleware/errors');
const { requirePerm } = require('../middleware/auth');
const { badRequest } = require('../utils/helpers');
const config = require('../config');

const advances = require('../services/advances.service');
const transfers = require('../services/transfers.service');
const settlements = require('../services/settlements.service');
const invoices = require('../services/invoices.service');
const attachments = require('../services/attachments.service');
const audit = require('../services/audit.service');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024 } });

const paging = (q) => ({
  page: q.page, pageSize: q.pageSize, sort: q.sort, dir: q.dir
});

/* ==================== عهد المقاولين ==================== */
router.get('/advances', requirePerm('advances.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: advances.list(req.query, paging(req.query)) });
}));

router.get('/advances/:id', requirePerm('advances.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: advances.getFullCard(Number(req.params.id)) });
}));

router.get('/advances/:id/balance', requirePerm('advances.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: advances.getBalance(Number(req.params.id)) });
}));

router.post('/advances', requirePerm('advances.create'), wrap(async (req, res) => {
  res.status(201).json({ ok: true, data: advances.create(req.body, req) });
}));

router.put('/advances/:id', requirePerm('advances.update'), wrap(async (req, res) => {
  res.json({ ok: true, data: advances.update(Number(req.params.id), req.body, req) });
}));

router.post('/advances/:id/approve', requirePerm('advances.approve'), wrap(async (req, res) => {
  res.json({ ok: true, data: advances.approve(Number(req.params.id), req) });
}));

router.post('/advances/:id/reject', requirePerm('advances.approve'), wrap(async (req, res) => {
  res.json({ ok: true, data: advances.reject(Number(req.params.id), req, req.body.reason) });
}));

router.post('/advances/:id/close', requirePerm('advances.update'), wrap(async (req, res) => {
  res.json({ ok: true, data: advances.close(Number(req.params.id), req, { confirm: !!req.body.confirm, reason: req.body.reason }) });
}));

router.post('/advances/:id/reopen', requirePerm('advances.update'), wrap(async (req, res) => {
  res.json({ ok: true, data: advances.reopen(Number(req.params.id), req) });
}));

router.post('/advances/:id/void', requirePerm('advances.void'), wrap(async (req, res) => {
  res.json({ ok: true, data: advances.voidAdvance(Number(req.params.id), req, req.body.reason) });
}));

/* ==================== التحويلات ==================== */
router.get('/transfers', requirePerm('transfers.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: transfers.list(req.query, paging(req.query)) });
}));

router.get('/transfers/:id', requirePerm('transfers.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: transfers.getFullCard(Number(req.params.id)) });
}));

router.post('/transfers', requirePerm('transfers.create'), wrap(async (req, res) => {
  res.status(201).json({ ok: true, data: transfers.create(req.body, req) });
}));

router.put('/transfers/:id', requirePerm('transfers.update'), wrap(async (req, res) => {
  res.json({ ok: true, data: transfers.update(Number(req.params.id), req.body, req) });
}));

router.post('/transfers/:id/approve', requirePerm('transfers.approve'), wrap(async (req, res) => {
  res.json({ ok: true, data: transfers.approve(Number(req.params.id), req) });
}));

router.post('/transfers/:id/reject', requirePerm('transfers.approve'), wrap(async (req, res) => {
  res.json({ ok: true, data: transfers.reject(Number(req.params.id), req, req.body.reason) });
}));

router.post('/transfers/:id/link-advance', requirePerm('transfers.update'), wrap(async (req, res) => {
  const advanceId = Number(req.body.advance_id);
  if (!advanceId) throw badRequest('يجب تحديد رقم العهدة');
  res.json({ ok: true, data: transfers.linkAdvance(Number(req.params.id), advanceId, req) });
}));

router.post('/transfers/:id/unlink-advance', requirePerm('transfers.update'), wrap(async (req, res) => {
  res.json({ ok: true, data: transfers.unlinkAdvance(Number(req.params.id), req) });
}));

router.post('/transfers/:id/void', requirePerm('transfers.void'), wrap(async (req, res) => {
  res.json({ ok: true, data: transfers.voidTransfer(Number(req.params.id), req, req.body.reason) });
}));

router.post('/transfers/check-duplicate', requirePerm('transfers.create'), wrap(async (req, res) => {
  res.json({ ok: true, data: transfers.findDuplicates(req.body || {}) });
}));

/* ==================== إخلاء العهد ==================== */
router.get('/settlements', requirePerm('settlements.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: settlements.list(req.query, paging(req.query)) });
}));

router.get('/settlements/:id', requirePerm('settlements.view'), wrap(async (req, res) => {
  const s = settlements.getById(Number(req.params.id));
  res.json({
    ok: true,
    data: {
      settlement: s,
      advance: advances.getById(s.advance_id),
      balance: advances.getBalance(s.advance_id),
      attachments: attachments.listFor('settlement', s.id),
      audit_trail: require('../services/admin.service').getAuditTrail('settlement', s.id)
    }
  });
}));

router.post('/settlements', requirePerm('settlements.create'), wrap(async (req, res) => {
  res.status(201).json({ ok: true, data: settlements.create(req.body, req) });
}));

router.put('/settlements/:id', requirePerm('settlements.update'), wrap(async (req, res) => {
  res.json({ ok: true, data: settlements.update(Number(req.params.id), req.body, req) });
}));

router.post('/settlements/:id/review', requirePerm('settlements.review'), wrap(async (req, res) => {
  res.json({ ok: true, data: settlements.review(Number(req.params.id), req, req.body.status) });
}));

router.post('/settlements/:id/approve', requirePerm('settlements.approve'), wrap(async (req, res) => {
  res.json({ ok: true, data: settlements.approve(Number(req.params.id), req) });
}));

router.post('/settlements/:id/unapprove', requirePerm('settlements.approve'), wrap(async (req, res) => {
  res.json({ ok: true, data: settlements.unapprove(Number(req.params.id), req, req.body.reason) });
}));

router.post('/settlements/:id/reject', requirePerm('settlements.approve'), wrap(async (req, res) => {
  res.json({ ok: true, data: settlements.reject(Number(req.params.id), req, req.body.reason) });
}));

router.post('/settlements/:id/void', requirePerm('settlements.void'), wrap(async (req, res) => {
  res.json({ ok: true, data: settlements.voidSettlement(Number(req.params.id), req, req.body.reason) });
}));

/* ==================== فواتير الموردين ==================== */
router.get('/supplier-invoices', requirePerm('supplier_invoices.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: invoices.listInvoices(req.query, paging(req.query)) });
}));

router.get('/supplier-invoices/:id', requirePerm('supplier_invoices.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: invoices.getInvoiceCard(Number(req.params.id)) });
}));

router.post('/supplier-invoices', requirePerm('supplier_invoices.create'), wrap(async (req, res) => {
  res.status(201).json({ ok: true, data: invoices.createInvoice(req.body, req) });
}));

router.put('/supplier-invoices/:id', requirePerm('supplier_invoices.update'), wrap(async (req, res) => {
  res.json({ ok: true, data: invoices.updateInvoice(Number(req.params.id), req.body, req) });
}));

router.post('/supplier-invoices/:id/approve', requirePerm('supplier_invoices.approve'), wrap(async (req, res) => {
  res.json({ ok: true, data: invoices.approveInvoice(Number(req.params.id), req) });
}));

router.post('/supplier-invoices/:id/void', requirePerm('supplier_invoices.void'), wrap(async (req, res) => {
  res.json({ ok: true, data: invoices.voidInvoice(Number(req.params.id), req, req.body.reason) });
}));

/* ==================== الدفعات ==================== */
router.get('/payments', requirePerm('payments.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: invoices.listPayments(req.query, paging(req.query)) });
}));

router.get('/payments/:id', requirePerm('payments.view'), wrap(async (req, res) => {
  res.json({ ok: true, data: invoices.getPayment(Number(req.params.id)) });
}));

router.post('/payments', requirePerm('payments.create'), wrap(async (req, res) => {
  res.status(201).json({ ok: true, data: invoices.createPayment(req.body, req) });
}));

router.post('/payments/:id/void', requirePerm('payments.void'), wrap(async (req, res) => {
  res.json({ ok: true, data: invoices.voidPayment(Number(req.params.id), req, req.body.reason) });
}));

/* ==================== المرفقات ==================== */
router.get('/attachments', requirePerm('advances.view'), wrap(async (req, res) => {
  const { entity_type, entity_id } = req.query;
  if (!entity_type || !entity_id) throw badRequest('يجب تحديد entity_type و entity_id');
  res.json({ ok: true, data: attachments.listFor(String(entity_type), Number(entity_id)) });
}));

router.post('/attachments', requirePerm('attachments.upload'), upload.single('file'), wrap(async (req, res) => {
  const saved = attachments.saveFile(req.file, {
    entityType: req.body.entity_type, entityId: req.body.entity_id,
    kind: req.body.kind || 'document', description: req.body.description || null
  }, req);
  res.status(201).json({ ok: true, data: saved });
}));

router.get('/attachments/:id/download', wrap(async (req, res) => {
  const { row, buffer } = attachments.read(Number(req.params.id));
  audit.log(req.user ? req : { user: null }, {
    action: 'download', entityType: 'attachment', entityId: row.id, entityLabel: row.file_name,
    summary: `تنزيل المرفق ${row.file_name}`
  });
  res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(row.file_name)}"`);
  res.send(buffer);
}));

router.post('/attachments/:id/void', requirePerm('attachments.delete'), wrap(async (req, res) => {
  res.json({ ok: true, data: attachments.voidAttachment(Number(req.params.id), req, req.body.reason) });
}));

module.exports = router;
