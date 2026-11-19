'use strict';
// إنشاء مدير النظام الأول. لا توجد كلمة مرور افتراضية:
//   ADMIN_USERNAME=admin ADMIN_PASSWORD='...' npm run seed:admin
// أو يولّد كلمة مرور عشوائية تُعرض مرة واحدة إن لم تُحدَّد.
const crypto = require('crypto');
const argon2 = require('argon2');
const { pool } = require('../src/db/pool');
const { migrate } = require('../src/db/migrate');
const users = require('../src/services/users');

(async () => {
  await migrate();
  const username = process.env.ADMIN_USERNAME || 'admin';
  let password = process.env.ADMIN_PASSWORD, generated = false;
  if (!password) { password = crypto.randomBytes(9).toString('base64url') + '7'; generated = true; }
  users.checkPassword(password, username);
  const role = (await pool.query("SELECT id FROM roles WHERE code='admin'")).rows[0];
  const hash = await argon2.hash(password, users.HASH_OPTS);
  const r = await pool.query(
    `INSERT INTO users (username, full_name, password_hash, role_id, must_change_password) VALUES ($1,'مدير النظام',$2,$3,$4)
     ON CONFLICT DO NOTHING RETURNING id`, [username, hash, role.id, generated]);
  if (!r.rowCount) console.log(`المستخدم ${username} موجود مسبقًا؛ لم يتم أي تغيير.`);
  else console.log(`تم إنشاء المدير: ${username}` + (generated ? `\nكلمة المرور المؤقتة (تُعرض مرة واحدة): ${password}` : ''));
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
