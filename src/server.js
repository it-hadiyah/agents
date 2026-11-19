'use strict';
const config = require('./config');
const { createApp } = require('./app');
const { migrate } = require('./db/migrate');
const notifications = require('./services/notifications');
const exporter = require('./services/exporter');
const { pool } = require('./db/pool');

(async () => {
  await migrate();
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`المنصة تعمل على المنفذ ${config.port} (${config.env})`));
  const run = () => notifications.generate().then((r) => r.created && console.log(`تنبيهات جديدة: ${r.created}`)).catch((e) => console.error('notifications:', e.message));
  run();
  const timer = setInterval(run, 6 * 60 * 60 * 1000);
  const stop = async () => { clearInterval(timer); server.close(); await exporter.closeBrowser(); await pool.end(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})().catch((e) => { console.error(e); process.exit(1); });
