'use strict';
const { Pool, types } = require('pg');
const config = require('../config');

// NUMERIC كنص (دقة كاملة)، DATE كنص yyyy-mm-dd (دون تحويل منطقة زمنية)، BIGINT كرقم
types.setTypeParser(1700, (v) => v);
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => Number(v));

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
pool.on('error', (e) => console.error('pg pool error:', e.message));

/** تنفيذ دالة داخل معاملة. عند أي خطأ يتم التراجع. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'Asia/Riyadh'");
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, tx, query: (t, p) => pool.query(t, p) };
