'use strict';
// تشغيل الترحيلات بالترتيب داخل معاملة لكل ملف، مع قفل استشاري وفحص checksum.
// لا يوجد أي ترحيل هدّام: الملفات المطبقة لا تُعاد ولا يُسمح بتعديلها.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

async function migrate(databaseUrl = require('../config').databaseUrl, log = console.log) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const applied = new Map((await client.query('SELECT filename, checksum FROM schema_migrations')).rows.map((r) => [r.filename, r.checksum]));
    let count = 0;
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      const sum = crypto.createHash('sha256').update(sql).digest('hex');
      if (applied.has(f)) {
        if (applied.get(f) !== sum) throw new Error(`تم تعديل ترحيل مطبّق مسبقًا: ${f}`);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1,$2)', [f, sum]);
        await client.query('COMMIT');
        log(`applied ${f}`);
        count++;
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`فشل الترحيل ${f}: ${e.message}`);
      }
    }
    if (!count) log('لا توجد ترحيلات جديدة');
    return count;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    client.release();
    await pool.end();
  }
}

module.exports = { migrate };
if (require.main === module) migrate().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
