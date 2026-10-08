'use strict';
/**
 * خدمة المرفقات: رفع صور التحويلات والفواتير والمستندات وملفات PDF وربطها بالعملية.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { getDb } = require('../db');
const { badRequest, notFound } = require('../utils/helpers');
const audit = require('./audit.service');

const ALLOWED_ENTITIES = ['advance', 'transfer', 'settlement', 'supplier_invoice', 'payment', 'contractor', 'supplier', 'funding_source'];
const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt'];

function ensureDir() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.mkdirSync(path.join(config.uploadDir, 'files'), { recursive: true });
}

function listFor(entityType, entityId) {
  return getDb().prepare(`
    SELECT at.*, u.full_name AS uploaded_by_name
    FROM attachments at LEFT JOIN users u ON u.id = at.uploaded_by
    WHERE at.entity_type = ? AND at.entity_id = ? AND at.is_void = 0
    ORDER BY at.created_at DESC`).all(entityType, Number(entityId));
}

function saveFile(file, { entityType, entityId, kind = 'document', description = null }, ctx) {
  if (!ALLOWED_ENTITIES.includes(entityType)) throw badRequest('نوع الكيان غير مدعوم للمرفقات');
  if (!file) throw badRequest('لم يتم اختيار ملف');
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw badRequest(`نوع الملف غير مسموح: ${ext || 'غير معروف'}`);
  if (file.mimetype && !ALLOWED_MIME.includes(file.mimetype)) throw badRequest(`نوع المحتوى غير مسموح: ${file.mimetype}`);
  if (file.size > config.maxUploadMb * 1024 * 1024) throw badRequest(`حجم الملف يتجاوز ${config.maxUploadMb} ميجابايت`);
  ensureDir();

  const stored = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const dest = path.join(config.uploadDir, 'files', stored);
  fs.writeFileSync(dest, file.buffer);

  const r = getDb().prepare(`INSERT INTO attachments
    (entity_type, entity_id, kind, file_name, stored_name, mime_type, size_bytes, description, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(entityType, Number(entityId), kind, file.originalname, stored, file.mimetype, file.size, description, ctx.user.id);

  audit.log(ctx, {
    action: 'upload', entityType: 'attachment', entityId: r.lastInsertRowid, entityLabel: file.originalname,
    summary: `رفع مرفق "${file.originalname}" على ${entityType}#${entityId}`,
    newValues: { entity_type: entityType, entity_id: entityId, size: file.size }
  });
  return getDb().prepare('SELECT * FROM attachments WHERE id = ?').get(r.lastInsertRowid);
}

function getById(id) {
  const row = getDb().prepare('SELECT * FROM attachments WHERE id = ? AND is_void = 0').get(id);
  if (!row) throw notFound('المرفق');
  return row;
}

function read(id) {
  const row = getById(id);
  const full = path.join(config.uploadDir, 'files', row.stored_name);
  if (!fs.existsSync(full)) throw notFound('ملف المرفق');
  return { row, buffer: fs.readFileSync(full) };
}

function voidAttachment(id, ctx, reason) {
  const row = getById(id);
  tx(() => {
    getDb().prepare(`UPDATE attachments SET is_void = 1, description = COALESCE(description,'') || ? WHERE id = ?`)
      .run(`\n[حذف] ${reason || ''}`, id);
    audit.log(ctx, {
      action: 'delete', entityType: 'attachment', entityId: id, entityLabel: row.file_name,
      summary: `حذف المرفق "${row.file_name}"`, oldValues: row
    });
  });
  return { ok: true };
}

function tx(fn) { return getDb().transaction(fn)(); }

module.exports = { listFor, saveFile, getById, read, voidAttachment, ALLOWED_EXT, ALLOWED_MIME };
