# النشر والنسخ الاحتياطي والاستعادة

## النشر (مثال systemd + Nginx)
1. خادم Linux بـ Node 20+ وPostgreSQL 14+ وChromium (`apt install chromium`).
2. مستخدم قاعدة بيانات مخصص بكلمة مرور قوية؛ `DATABASE_URL` في `/etc/hadiyah.env` بصلاحيات 600.
3. `NODE_ENV=production`, `SESSION_SECRET=$(openssl rand -hex 48)`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`, `UPLOAD_DIR=/var/lib/hadiyah/uploads`.
4. `npm ci --omit=dev && npm run migrate && ADMIN_USERNAME=... npm run seed:admin`.
5. خدمة systemd تشغّل `node src/server.js` بمستخدم غير root، وNginx يمرّر إلى 3000 مع TLS و`client_max_body_size 6m`.
6. الترحيلات تعمل تلقائيًا عند البدء (قفل استشاري) وهي إضافية فقط؛ **لا توجد ترحيلات هدّامة**. قبل أي ترحيل جديد: خذ نسخة احتياطية.

## النسخ الاحتياطي
```bash
npm run backup        # pg_dump (custom) + أرشيف المرفقات إلى BACKUP_DIR، ويحتفظ بآخر 14
```
جدولة يومية (cron): `15 2 * * * cd /opt/hadiyah && npm run backup`. انسخ المجلد خارج الخادم وشفّره (age/gpg).

## الاستعادة
```bash
createdb hadiyah_restore
pg_restore --no-owner -d hadiyah_restore backups/db-YYYYMMDD-HHMMSS.dump
tar -xzf backups/uploads-YYYYMMDD-HHMMSS.tar.gz -C /var/lib/hadiyah/uploads
```
تحقق (عدد الأعضاء والمدفوعات) ثم بدّل `DATABASE_URL`. جرّب الاستعادة دوريًا على بيئة منفصلة.

## المراقبة
سجلات الأخطاء في stdout/stderr (بلا بيانات حساسة). راقب المساحة وفشل النسخ الاحتياطي.
