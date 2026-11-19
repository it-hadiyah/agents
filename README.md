# منصة إدارة أعضاء الجمعية العمومية – جمعية هدية

منصة ويب عربية (RTL) لإدارة أعضاء الجمعية العمومية: قاعدة بيانات مركزية للأعضاء، اشتراكاتهم ومدفوعاتهم، التجديد، التنبيهات، التقارير (Excel/PDF)، الاستيراد، الصلاحيات وسجل التدقيق.

**التقنيات:** Node.js 20+ · Express · PostgreSQL 14+ · واجهة JavaScript (ES modules) بلا خطوة بناء · Chart.js · ExcelJS · Chromium (لـ PDF).

## التثبيت والتشغيل

```bash
npm install
cp .env.example .env          # عدّل DATABASE_URL و SESSION_SECRET
createdb hadiyah_members      # أو أنشئ القاعدة والمستخدم بالطريقة المعتادة
npm run migrate               # يطبّق ترحيلات src/db/migrations
ADMIN_USERNAME=admin npm run seed:admin   # ينشئ المدير الأول (كلمة مرور عشوائية تُعرض مرة واحدة إن لم تحدد ADMIN_PASSWORD)
npm start                     # http://localhost:3000
```

- يتطلب الإنتاج: `SESSION_SECRET` عشوائي، `COOKIE_SECURE=true`، `TRUST_PROXY=1` خلف وكيل HTTPS، وتثبيت Chromium (`CHROME_PATH`) لتوليد PDF.
- لا توجد كلمات مرور افتراضية. أول دخول للمدير المُولَّد يفرض تغيير كلمة المرور.
- امتداد PostgreSQL المطلوبة: `btree_gist` و`pg_trgm` (يُنشئهما الترحيل؛ مسموحان لمالك القاعدة).

## الاختبارات

```bash
npm test          # 66 اختبار تكامل وحدات (قاعدة hadiyah_test، تُعاد بناؤها)
npm run test:e2e  # اختبار واجهة بـ Playwright/Chromium (SHOTS_DIR=... لحفظ لقطات)
```
متغير `TEST_DATABASE_URL` يحدد قاعدة الاختبار (يجب أن ينتهي اسمها بـ `_test`، وإلا يرفض الاختبار إعادة البناء).

## الوثائق
- [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) – افتراضات قواعد العضوية والمالية (راجعها مع النظام الأساسي/اللائحة)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – البنية ونموذج البيانات
- [docs/SECURITY.md](docs/SECURITY.md) – الضوابط الأمنية وPDPL
- [docs/OPERATIONS.md](docs/OPERATIONS.md) – النشر والنسخ الاحتياطي والاستعادة
- [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) – ربط البريد/SMS مستقبلًا
- [docs/TESTING.md](docs/TESTING.md) – ملخص الاختبارات ومطابقة معايير القبول
