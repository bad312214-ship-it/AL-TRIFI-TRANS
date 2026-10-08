'use strict';
/** زرع بيانات بيئة Demo (قاعدة بيانات منفصلة تمامًا) */
process.env.NODE_ENV = 'demo';
const { migrate } = require('../db');
const bootstrap = require('../bootstrap');
const config = require('../config');
const demo = require('../db/seed/demo.seed');

if (!config.isDemo) {
  console.error('❌ رفض التنفيذ: هذه الأوامر مخصصة لبيئة demo فقط.');
  process.exit(1);
}
migrate();
bootstrap.run();
const result = demo.seed();
console.log('[seed:demo] قاعدة البيانات التجريبية:', config.dbPath);
console.log('[seed:demo] النتيجة:', JSON.stringify(result, null, 2));
console.log('[seed:demo] للتشغيل: npm run demo   ثم سجّل الدخول بحساب المدير.');
