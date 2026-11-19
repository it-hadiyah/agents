'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) throw new Error('SESSION_SECRET مطلوب في بيئة الإنتاج');
  sessionSecret = crypto.randomBytes(32).toString('hex'); // مؤقت: تنتهي الجلسات عند إعادة التشغيل
}

function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/pw-browsers/chromium'];
  try {
    for (const d of fs.readdirSync('/opt/pw-browsers')) {
      if (d.startsWith('chromium-')) candidates.push(path.join('/opt/pw-browsers', d, 'chrome-linux64', 'chrome'));
    }
  } catch { /* لا شيء */ }
  return candidates.find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

module.exports = {
  env, isProd,
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://hadiyah:devpass_local@localhost:5432/hadiyah_members',
  sessionSecret,
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  chromePath: findChrome(),
  maxUploadBytes: 5 * 1024 * 1024,
  sessionMaxAgeMs: 8 * 60 * 60 * 1000,
  lockout: { maxAttempts: 5, minutes: 15 },
};
