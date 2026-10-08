'use strict';
/**
 * إعدادات النظام المركزية
 * تقرأ من متغيرات البيئة أو ملف .env
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');   // جذر المشروع (مجلد الخادم داخله)

// قراءة .env يدويًا (بدون اعتماديات خارجية)
(function loadDotEnv() {
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx < 0) continue;
    const key = t.slice(0, idx).trim();
    let val = t.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

const NODE_ENV = process.env.NODE_ENV || 'production';
const IS_DEMO = NODE_ENV === 'demo';

const DB_PATH = IS_DEMO
  ? path.resolve(ROOT, 'data', 'demo', 'oyaynah-demo.db')
  : path.resolve(ROOT, process.env.DB_PATH || './data/oyaynah.db');

const config = {
  root: ROOT,
  env: NODE_ENV,
  isDemo: IS_DEMO,
  port: parseInt(process.env.PORT || '4000', 10),
  dbPath: DB_PATH,
  uploadDir: path.resolve(ROOT, process.env.UPLOAD_DIR || './uploads'),
  sessionSecret: process.env.SESSION_SECRET || 'oyaynah-dev-secret',
  sessionTtlHours: parseInt(process.env.SESSION_TTL_HOURS || '12', 10),
  maxUploadMb: parseInt(process.env.MAX_UPLOAD_MB || '15', 10),
  currency: 'SAR',
  defaultVatRate: 0.15,
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'Oyaynah@2026',
    fullName: process.env.ADMIN_FULLNAME || 'مدير النظام'
  }
};

module.exports = config;
