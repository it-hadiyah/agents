'use strict';
const argon2 = require('argon2');
const config = require('../config');
const { pool, tx } = require('../db/pool');
const audit = require('./audit');
const { bad, notFound, conflict, AppError } = require('../lib/errors');
const N = require('../lib/normalize');

const HASH_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
// تجزئة وهمية لمعادلة زمن الاستجابة عند مستخدم غير موجود
let dummyHash;
const getDummy = async () => (dummyHash ||= await argon2.hash('dummy-password-for-timing', HASH_OPTS));

function checkPassword(pw, username = '') {
  if (typeof pw !== 'string' || pw.length < 10) throw bad('كلمة المرور يجب ألا تقل عن 10 أحرف', { password: '10 أحرف على الأقل' });
  if (pw.length > 200) throw bad('كلمة المرور طويلة جدًا', { password: 'طويلة' });
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) throw bad('يجب أن تحتوي كلمة المرور على حروف وأرقام', { password: 'حروف وأرقام' });
  if (username && pw.toLowerCase().includes(username.toLowerCase())) throw bad('يجب ألا تحتوي كلمة المرور على اسم المستخدم', { password: 'تحتوي اسم المستخدم' });
}

async function permissionsOf(client, roleId) {
  return (await client.query('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1', [roleId])).rows.map((r) => r.code);
}

async function authenticate(username, password, ip) {
  const u = (await pool.query(
    `SELECT u.*, r.code AS role_code, r.name_ar AS role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.username)=lower($1)`, [String(username || '').slice(0, 100)])).rows[0];
  const fail = new AppError(401, 'اسم المستخدم أو كلمة المرور غير صحيحة', 'bad_credentials');
  if (!u) { await argon2.verify(await getDummy(), String(password || '')).catch(() => {}); throw fail; }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    throw new AppError(423, 'الحساب مقفل مؤقتًا بسبب محاولات دخول فاشلة. حاول لاحقًا', 'locked');
  }
  let ok = false;
  try { ok = await argon2.verify(u.password_hash, String(password || '')); } catch { ok = false; }
  if (!ok || !u.is_active) {
    if (!ok) {
      const lock = u.failed_attempts + 1 >= config.lockout.maxAttempts;
      await tx(async (c) => {
        await c.query('UPDATE users SET failed_attempts=$2, locked_until=$3 WHERE id=$1',
          [u.id, lock ? 0 : u.failed_attempts + 1, lock ? new Date(Date.now() + config.lockout.minutes * 60000) : null]);
        if (lock) await audit.log(c, { user: { id: u.id, username: u.username }, ip }, { action: 'auth.locked', entity: 'user', entityId: u.id });
      });
    }
    throw fail;
  }
  await pool.query('UPDATE users SET failed_attempts=0, locked_until=NULL, last_login_at=now() WHERE id=$1', [u.id]);
  if (argon2.needsRehash(u.password_hash, HASH_OPTS)) {
    await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1', [u.id, await argon2.hash(password, HASH_OPTS)]);
  }
  return u;
}

async function loadSessionUser(id) {
  const u = (await pool.query(
    `SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.must_change_password, r.id AS role_id, r.code AS role_code, r.name_ar AS role_name
     FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1`, [id])).rows[0];
  if (!u || !u.is_active) return null;
  u.permissions = await permissionsOf(pool, u.role_id);
  return u;
}

async function list() {
  return (await pool.query(
    `SELECT u.id, u.username, u.full_name, u.email, u.is_active, u.role_id, r.name_ar AS role_name, r.code AS role_code, u.last_login_at, u.locked_until, u.created_at
     FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id`)).rows;
}

async function activeAdmins(c, excludeId) {
  return (await c.query("SELECT COUNT(*)::int n FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='admin' AND u.is_active AND u.id<>$1", [excludeId || 0])).rows[0].n;
}

function parseUser(input, partial) {
  const out = {}, errs = {};
  const set = (k, fn) => { if (partial && !(k in input)) return; try { out[k] = fn(input[k]); } catch (e) { errs[k] = e.message; } };
  set('username', (v) => { const s = N.clean(v); if (!s || !/^[A-Za-z0-9_.-]{3,40}$/.test(s)) throw new Error('اسم المستخدم 3–40 حرفًا لاتينيًا/أرقام/._-'); return s; });
  set('full_name', (v) => { const s = N.clean(v); if (!s || s.length < 3 || s.length > 150) throw new Error('الاسم الكامل مطلوب'); return s; });
  set('email', N.normalizeEmail);
  set('role_id', (v) => { const n = Number(v); if (!Number.isInteger(n)) throw new Error('الدور مطلوب'); return n; });
  set('is_active', (v) => v === undefined ? true : (v === true || v === 'true'));
  if (Object.keys(errs).length) throw bad('تحقق من الحقول المُدخلة', errs);
  return out;
}

async function create(ctx, input) {
  const f = parseUser(input, false);
  checkPassword(input.password, f.username);
  const hash = await argon2.hash(input.password, HASH_OPTS);
  return tx(async (c) => {
    if (!(await c.query('SELECT 1 FROM roles WHERE id=$1', [f.role_id])).rows[0]) throw bad('الدور غير موجود', { role_id: 'غير موجود' });
    try {
      const r = await c.query('INSERT INTO users (username, full_name, email, password_hash, role_id, is_active, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING id',
        [f.username, f.full_name, f.email, hash, f.role_id, f.is_active ?? true]);
      await audit.log(c, ctx, { action: 'user.create', entity: 'user', entityId: r.rows[0].id, after: { username: f.username, full_name: f.full_name, role_id: f.role_id } });
      return r.rows[0].id;
    } catch (e) { if (e.code === '23505') throw conflict('اسم المستخدم مستخدم مسبقًا', 'duplicate', { username: 'مكرر' }); throw e; }
  });
}

async function update(ctx, id, input) {
  const f = parseUser(input, true);
  delete f.username; // اسم المستخدم ثابت
  return tx(async (c) => {
    const cur = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound('المستخدم غير موجود');
    const curRole = (await c.query('SELECT code FROM roles WHERE id=$1', [cur.role_id])).rows[0].code;
    const newRoleId = f.role_id ?? cur.role_id;
    const newRole = (await c.query('SELECT code FROM roles WHERE id=$1', [newRoleId])).rows[0];
    if (!newRole) throw bad('الدور غير موجود', { role_id: 'غير موجود' });
    const losesAdmin = curRole === 'admin' && cur.is_active && (newRole.code !== 'admin' || f.is_active === false);
    if (losesAdmin && (await activeAdmins(c, id)) === 0) throw conflict('لا يمكن إزالة آخر مدير نشط في النظام', 'last_admin');
    if (id === ctx.user.id && (f.is_active === false || newRole.code !== curRole)) throw conflict('لا يمكنك تعطيل حسابك أو تغيير دورك بنفسك', 'self_change');
    const keys = Object.keys(f);
    if (input.password) checkPassword(input.password, cur.username);
    if (!keys.length && !input.password) return id;
    const sets = keys.map((k, i) => `${k}=$${i + 2}`);
    const vals = keys.map((k) => f[k]);
    if (input.password) {
      sets.push(`password_hash=$${vals.length + 2}`, 'must_change_password=TRUE', 'failed_attempts=0', 'locked_until=NULL');
      vals.push(await argon2.hash(input.password, HASH_OPTS));
    }
    await c.query(`UPDATE users SET ${sets.join(',')}, updated_at=now() WHERE id=$1`, [id, ...vals]);
    const d = audit.diff(Object.fromEntries(keys.map((k) => [k, cur[k]])), f);
    await audit.log(c, ctx, { action: input.password ? 'user.update+password' : 'user.update', entity: 'user', entityId: id, before: d.before, after: d.after });
    return id;
  });
}

async function changeOwnPassword(ctx, current, next) {
  const u = (await pool.query('SELECT * FROM users WHERE id=$1', [ctx.user.id])).rows[0];
  if (!(await argon2.verify(u.password_hash, String(current || '')).catch(() => false))) throw bad('كلمة المرور الحالية غير صحيحة', { current_password: 'غير صحيحة' });
  checkPassword(next, u.username);
  await tx(async (c) => {
    await c.query('UPDATE users SET password_hash=$2, must_change_password=FALSE, updated_at=now() WHERE id=$1', [u.id, await argon2.hash(next, HASH_OPTS)]);
    await audit.log(c, ctx, { action: 'user.password_change', entity: 'user', entityId: u.id });
  });
}

async function listRoles() {
  const roles = (await pool.query('SELECT * FROM roles ORDER BY id')).rows;
  const perms = (await pool.query('SELECT * FROM permissions ORDER BY id')).rows;
  const rp = (await pool.query('SELECT role_id, permission_id FROM role_permissions')).rows;
  return { roles: roles.map((r) => ({ ...r, permission_ids: rp.filter((x) => x.role_id === r.id).map((x) => x.permission_id) })), permissions: perms };
}

async function setRolePermissions(ctx, roleId, permissionIds) {
  return tx(async (c) => {
    const role = (await c.query('SELECT * FROM roles WHERE id=$1 FOR UPDATE', [roleId])).rows[0];
    if (!role) throw notFound('الدور غير موجود');
    if (role.code === 'admin') throw conflict('صلاحيات مدير النظام ثابتة', 'locked_role');
    const ids = [...new Set((permissionIds || []).map(Number).filter(Number.isInteger))];
    const valid = (await c.query('SELECT id, code FROM permissions WHERE id = ANY($1)', [ids])).rows;
    const before = (await permissionsOf(c, roleId)).sort();
    await c.query('DELETE FROM role_permissions WHERE role_id=$1', [roleId]);
    for (const p of valid) await c.query('INSERT INTO role_permissions VALUES ($1,$2)', [roleId, p.id]);
    const after = valid.map((p) => p.code).sort();
    await audit.log(c, ctx, { action: 'role.permissions', entity: 'role', entityId: roleId,
      before: { role: role.code, permissions: before }, after: { permissions: after } });
  });
}

module.exports = { authenticate, loadSessionUser, list, create, update, changeOwnPassword, listRoles, setRolePermissions, checkPassword, HASH_OPTS, permissionsOf };
