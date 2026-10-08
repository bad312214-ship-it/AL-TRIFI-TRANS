'use strict';
const path = require('path');
const express = require('express');
const config = require('./config');
const { requireAuth } = require('./middleware/auth');
const { errorHandler, notFoundRoute } = require('./middleware/errors');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));

  // أمان أساسي
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (req, res) => res.json({
    ok: true,
    data: {
      status: 'up',
      environment: config.isDemo ? 'demo' : 'production',
      version: require('../package.json').version,
      time: new Date().toISOString()
    }
  }));

  app.use('/api/auth', require('./routes/auth.routes'));
  app.use('/api', requireAuth, require('./routes/master.routes'));
  app.use('/api', requireAuth, require('./routes/operations.routes'));
  app.use('/api', requireAuth, require('./routes/reports.routes'));

  // الواجهة
  app.use(express.static(path.join(config.root, 'public'), { index: 'index.html', maxAge: '0' }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(config.root, 'public', 'index.html')));

  app.use('/api', notFoundRoute);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
