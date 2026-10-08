'use strict';
/** نقطة التشغيل */
const config = require('./config');
const { migrate } = require('./db');
const bootstrap = require('./bootstrap');
const { createApp } = require('./app');

function main() {
  migrate();
  bootstrap.run();
  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log('=========================================================');
    console.log(`  نظام أرض العيينة المحاسبي`);
    console.log(`  البيئة : ${config.isDemo ? 'DEMO (بيانات تجريبية)' : 'PRODUCTION (بيانات حقيقية)'}`);
    console.log(`  القاعدة: ${config.dbPath}`);
    console.log(`  الرابط : http://0.0.0.0:${config.port}`);
    console.log('=========================================================');
    if (config.isDemo) {
      console.log('  ⚠ وضع تجريبي: البيانات هنا للاختبار فقط ولا تمثل عمليات حقيقية.');
    }
  });
  const shutdown = () => { try { server.close(() => process.exit(0)); } catch { process.exit(0); } };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) main();
module.exports = { main };
