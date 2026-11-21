'use strict';
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { pool } = require('./db/pool');
const sec = require('./middleware/security');
const api = require('./routes/api');
const settings = require('./services/settings');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(sec.helmetMw);
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', session({
    name: 'hadiyah.sid', secret: config.sessionSecret, resave: false, saveUninitialized: false, rolling: true,
    store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: false }),
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: config.sessionMaxAgeMs },
  }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', sec.apiLimiter, sec.sameOrigin, sec.loadUser, sec.csrf, api);

  // الشعار متاح لصفحة الدخول (PNG/JPG فقط، اسم ملف مولَّد ومُتحقَّق منه)
  app.get('/branding/logo', async (req, res, next) => {
    try {
      const name = (await settings.getPublic())['org.logo'];
      if (!name || !/^logo-[0-9a-f]{16}\.(png|jpg)$/.test(name)) return res.status(404).end();
      const f = path.join(config.uploadDir, 'branding', name);
      if (!fs.existsSync(f)) return res.status(404).end();
      res.set({ 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      res.type(path.extname(f)).sendFile(f);
    } catch (e) { next(e); }
  });

  const nm = path.join(__dirname, '..', 'node_modules');
  app.use('/vendor/chart', express.static(path.join(nm, 'chart.js', 'dist'), { index: false, maxAge: '7d' }));
  app.use('/vendor/fonts', express.static(path.join(nm, '@fontsource', 'ibm-plex-sans-arabic', 'files'), { index: false, maxAge: '30d', immutable: true }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: 0, etag: true }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // معالج الأخطاء: رسائل واضحة بلا تسريب تفاصيل داخلية
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'صيغة JSON غير صالحة', code: 'bad_json' });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'حجم الملف يتجاوز الحد المسموح', code: 'file_too_large' });
    if (err.name === 'MulterError') return res.status(400).json({ error: 'خطأ في رفع الملف', code: 'upload' });
    if (err.status && err.code) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err.stack || err);
    res.status(500).json({ error: 'حدث خطأ غير متوقع. حاول مرة أخرى', code: 'internal' });
  });
  return app;
}
module.exports = { createApp };
