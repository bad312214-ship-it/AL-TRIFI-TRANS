'use strict';
/** تنفيذ ترحيلات قاعدة البيانات + التهيئة المرجعية */
const { migrate } = require('../db');
const bootstrap = require('../bootstrap');
const config = require('../config');

migrate();
const counts = bootstrap.run();
console.log('[migrate] تم بنجاح:', JSON.stringify(counts, null, 2));
console.log(`[migrate] قاعدة البيانات: ${config.dbPath}`);
