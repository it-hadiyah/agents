'use strict';
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const users = require('../services/users');
const { AppError, forbidden } = require('../lib/errors');

const helmetMw = helmet({
  contentSecurityPolicy: { useDefaults: false, directives: {
    'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"], 'connect-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'self'"],
    'form-action': ["'self'"], 'frame-ancestors': ["'none'"], 'frame-src': ["'self'"],
  } },
  referrerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'محاولات كثيرة. حاول لاحقًا', code: 'rate_limited' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false,
  message: { error: 'طلبات كثيرة. حاول لاحقًا', code: 'rate_limited' } });

/** يحمّل المستخدم من الجلسة في كل طلب (الصلاحيات تُقرأ حديثًا من قاعدة البيانات) */
async function loadUser(req, res, next) {
  try {
    req.ctx = { user: null, perms: new Set(), ip: req.ip };
    const id = req.session?.userId;
    if (id) {
      const u = await users.loadSessionUser(id);
      if (!u) { await new Promise((r) => req.session.destroy(r)); }
      else { req.ctx.user = u; req.ctx.perms = new Set(u.permissions); }
    }
    next();
  } catch (e) { next(e); }
}

function requireAuth(req, res, next) {
  if (!req.ctx.user) return next(new AppError(401, 'يجب تسجيل الدخول', 'unauthenticated'));
  if (req.ctx.user.must_change_password && !req.path.startsWith('/auth/')) return next(new AppError(403, 'يجب تغيير كلمة المرور أولًا', 'password_change_required'));
  next();
}
const requirePerm = (...codes) => (req, res, next) => (codes.every((c) => req.ctx.perms.has(c)) ? next() : next(forbidden()));
const requireAny = (...codes) => (req, res, next) => (codes.some((c) => req.ctx.perms.has(c)) ? next() : next(forbidden()));

/** حماية CSRF: رمز مرتبط بالجلسة يُرسل في ترويسة لكل طلب يغيّر الحالة */
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/auth/login') return next(); // قبل وجود جلسة؛ محمي بـ SameSite وبفحص Origin أدناه
  const token = req.get('x-csrf-token');
  const expected = req.session?.csrf;
  if (!token || !expected || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return next(new AppError(403, 'رمز الحماية غير صالح. أعد تحميل الصفحة', 'csrf'));
  }
  next();
}
/** رفض الطلبات المغيِّرة العابرة للأصل */
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return next(new AppError(403, 'أصل الطلب غير مسموح', 'origin')); } catch { return next(new AppError(403, 'أصل الطلب غير صالح', 'origin')); }
  }
  next();
}

module.exports = { helmetMw, loginLimiter, apiLimiter, loadUser, requireAuth, requirePerm, requireAny, csrf, sameOrigin };
