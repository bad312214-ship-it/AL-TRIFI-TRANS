'use strict';
/** إعادة ضبط قاعدة البيانات (احذر: يحذف الملف بالكامل) */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const target = process.argv[2];
if (target !== 'demo' && target !== 'production') {
  console.error('الاستخدام: node server/scripts/reset.js [demo|production]');
  process.exit(1);
}
const file = target === 'demo'
  ? path.join(config.root, 'data', 'demo', 'oyaynah-demo.db')
  : path.join(config.root, 'data', 'oyaynah.db');

for (const suffix of ['', '-journal', '-wal', '-shm']) {
  const f = file + suffix;
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('[reset] حُذف', f); }
}
console.log('[reset] تم. شغّل: npm run migrate (أو npm run seed:demo لبيئة الاختبار)');
