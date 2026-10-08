'use strict';
/** تهيئة البيانات المرجعية فقط (بدون أي بيانات تشغيلية) */
const { migrate } = require('../db');
const bootstrap = require('../bootstrap');
migrate();
console.log('[seed:reference]', JSON.stringify(bootstrap.run(), null, 2));
