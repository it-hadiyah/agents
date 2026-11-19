# البنية التقنية

```
public/            واجهة SPA (ES modules، بلا بناء): index.html، css/app.css، js/{lib,main}.js، js/pages/*
src/
  server.js        تشغيل: ترحيل ← خادم ← توليد التنبيهات (كل 6 ساعات)
  app.js           Express: helmet/CSP، جلسات، CSRF، حدود الطلبات، الملفات الثابتة
  routes/api.js    كل نقاط API (الصلاحيات تُفرض هنا من جهة الخادم)
  services/        منطق الأعمال: members, payments, dashboard, notifications, reports,
                   exporter (xlsx/pdf), importer, users, settings, attachments, audit
  db/migrations/   ترحيلات SQL مرقّمة (checksum يمنع تعديل المطبَّق)
  lib/             normalize (جوال/تاريخ/مبلغ دقيق)، labels، errors
scripts/           create-admin.js, backup.sh
test/              اختبارات تكامل (node:test) + e2e (Playwright)
```

**فصل المنطق:** الواجهة لا تحسب أي حالة أو رقم؛ كل الحالات والمؤشرات تأتي من مشاهد PostgreSQL (`subscription_balances`, `member_overview`) ومن استعلامات الخدمات.

## نموذج البيانات
`members` ← `membership_periods` (دورة، `EXCLUDE` ضد التداخل) ← `subscriptions` (1:1 مع الدورة) ← `payments` ← `payment_attachments`. إضافة: `membership_types`, `notifications`, `notification_templates`, `users`, `roles`, `permissions`, `role_permissions`, `audit_logs` (إضافة فقط بمشغّلات), `system_settings`, `import_batches`, `user_sessions`.
- المبالغ `NUMERIC(12,2)`؛ الحساب في JS بأعداد صحيحة (BigInt بالهللات) أو داخل PostgreSQL؛ لا Float.
- المفاتيح الأجنبية `ON DELETE RESTRICT` لحماية التاريخ المالي. فهارس: الجوال، البريد، trigram للاسم، التواريخ، الدفعات المؤكدة.
- المعاملات: إنشاء العضو+الدورة+الاشتراك، السداد (قفل `FOR UPDATE`)، التجديد، الاستيراد، تعديل الأدوار.

## قرار البنية
مشروع جديد فارغ ← اختير Node + PostgreSQL بلا إطار واجهة ثقيل: استضافة بسيطة (عملية واحدة + قاعدة)، صيانة سهلة، لا خطوة بناء. PDF عبر Chromium لضمان تشكيل عربي صحيح.
