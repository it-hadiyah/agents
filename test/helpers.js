'use strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://hadiyah:devpass_local@localhost:5432/hadiyah_test';
process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = require('path').join(require('os').tmpdir(), 'hadiyah-test-uploads');

const argon2 = require('argon2');
const { migrate } = require('../src/db/migrate');
const { pool } = require('../src/db/pool');
const { createApp } = require('../src/app');
const users = require('../src/services/users');
const N = require('../src/lib/normalize');

let server, base;

async function resetDb() {
  // إعادة بناء كاملة للمخطط في قاعدة الاختبار (لا تُستخدم أبدًا على قاعدة الإنتاج)
  if (!/_test$/.test(new URL(process.env.DATABASE_URL).pathname.slice(1))) throw new Error('resetDb مسموح فقط لقواعد *_test');
  await pool.query('DROP OWNED BY CURRENT_USER CASCADE');
  await migrate(process.env.DATABASE_URL, () => {});
}

async function start() {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}
async function stop() { server?.close(); await require('../src/services/exporter').closeBrowser(); await pool.end(); }

async function mkUser(roleCode, username = roleCode) {
  const role = (await pool.query('SELECT id FROM roles WHERE code=$1', [roleCode])).rows[0];
  const pw = 'Passw0rd-' + username;
  const r = await pool.query(`INSERT INTO users (username, full_name, password_hash, role_id) VALUES ($1,$2,$3,$4) RETURNING id`,
    [username, 'مستخدم ' + username, await argon2.hash(pw, users.HASH_OPTS), role.id]);
  return { id: r.rows[0].id, username, password: pw };
}

/** عميل HTTP مع حفظ الكوكي ورمز CSRF */
class Client {
  constructor() { this.cookie = ''; this.csrf = ''; }
  async req(method, url, body, extraHeaders = {}) {
    const headers = { cookie: this.cookie, ...extraHeaders };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) this.cookie = sc.map((c) => c.split(';')[0]).join('; ');
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b) { return this.req('POST', u, b ?? {}); }
  put(u, b) { return this.req('PUT', u, b ?? {}); }
  del(u) { return this.req('DELETE', u); }
  async login(u) {
    await this.get('/api/auth/me');
    const r = await this.post('/api/auth/login', { username: u.username, password: u.password });
    if (r.status !== 200) throw new Error('login failed ' + JSON.stringify(r.data));
    const me = await this.get('/api/auth/me');
    this.csrf = me.data.csrf;
    return this;
  }
}
const today = () => N.todayRiyadh();
const days = (n) => N.addDaysISO(today(), n);

module.exports = { resetDb, start, stop, mkUser, Client, pool, today, days, N };
