# 02 · البنية المعمارية (Architecture)

## 1. النمط العام

تطبيق ثلاثي الطبقات (3-Tier) بخادم Node.js واحد، بدون أدوات بناء في الواجهة:

```
┌───────────────────────────────────────────────────────────────┐
│  المتصفح — SPA عربية RTL (Vanilla JS Modules، بدون Framework)  │
│  Hash Router · DataTable · Modal Forms · SVG Charts           │
└───────────────────────────┬───────────────────────────────────┘
                            │  REST/JSON  (Bearer Token)
┌───────────────────────────▼───────────────────────────────────┐
│  طبقة العرض (Routes)        Express                            │
│  auth · master · operations · reports · attachments            │
├───────────────────────────────────────────────────────────────┤
│  طبقة الوسائط (Middleware)                                     │
│  requireAuth (Sessions) · requirePerm (RBAC) · errorHandler    │
├───────────────────────────────────────────────────────────────┤
│  طبقة الخدمات (Services) — منطق الأعمال والمحاسبة              │
│  advances · transfers · settlements · invoices · payments      │
│  funding · parties · ledger · dashboard · reports              │
│  reconciliation · attachments · admin · search · export        │
├───────────────────────────────────────────────────────────────┤
│  طبقة البيانات (Data Access)                                   │
│  SQLite (WAL) · migrations · transactions · views              │
└───────────────────────────────────────────────────────────────┘
```

## 2. هيكل المجلدات

```
AL-TRIFI-TRANS/
├── server/
│   ├── index.js              نقطة التشغيل
│   ├── app.js                تطبيق Express + الوسائط + الملفات الساكنة
│   ├── config.js             الإعدادات (.env + متغيرات البيئة)
│   ├── bootstrap.js          التهيئة المرجعية (أدوار، حسابات، مصادر، مشروع، مدير)
│   ├── db/
│   │   ├── index.js          الاتصال + الـ migrations + المعاملات
│   │   ├── driver.js         توحيد المحرك: better-sqlite3 أو node:sqlite
│   │   ├── migrations/001_init.sql
│   │   └── seed/demo.seed.js بيانات Demo (بيئة منفصلة)
│   ├── middleware/  auth.js · errors.js
│   ├── services/    15 خدمة (منطق الأعمال)
│   ├── routes/      auth · master · operations · reports
│   ├── utils/       helpers · validators · permissions · sequence
│   └── scripts/     migrate · seed-reference · seed-demo · reset
├── public/                   الواجهة (SPA)
│   ├── index.html
│   ├── css/app.css           نظام التصميم (Light/Dark/RTL)
│   └── js/  core.js · app.js · pages/*.js
├── data/                     قواعد البيانات (خارج Git)
│   ├── oyaynah.db            الإنتاج
│   └── demo/oyaynah-demo.db  التجريبي
├── uploads/files/            المرفقات
├── tests/scenarios.test.js   13 اختبار سيناريو
└── docs/                     وثائق التصميم
```

## 3. قرارات معمارية ومبرراتها

| القرار | المبرر |
|---|---|
| SQLite بوضع WAL | نظام محاسبي لمستخدمين محدودين؛ صفر إدارة، نسخ احتياطي = نسخ ملف، معاملات ACID كاملة |
| `db/driver.js` يجرّب `better-sqlite3` ثم `node:sqlite` | يعمل بدون أي اعتمادية أصلية على Node ≥ 22.5، ويستفيد من better-sqlite3 إن وُجد |
| واجهة بدون إطار عمل ولا CDN | تعمل في شبكة معزولة، إقلاع فوري، تحكم كامل في RTL والوضع الليلي |
| الجلسات في قاعدة البيانات (لا JWT) | قابلة للإبطال الفوري عند إيقاف المستخدم أو إعادة كلمة مروره |
| الصلاحيات في جدول `role_permissions` | تعديل مصفوفة الصلاحيات بدون تعديل الكود |
| القيود المحاسبية تُولَّد آليًا عند الاعتماد | لا يمكن أن يختلف دفتر الأستاذ عن العمليات |
| الحذف = `is_void` | السجلات المحاسبية لا تُحذف نهائيًا |

## 4. تدفق الطلب

```
طلب HTTP
  │
  ├─ express.json()                         ← تحليل الجسم
  ├─ requireAuth                            ← تحميل الجلسة + مجموعة الصلاحيات
  ├─ requirePerm('advances.create')         ← فحص الصلاحية (403 إن فشل)
  ├─ Route → Service                        ← منطق الأعمال
  │    ├─ validatePayload()                 ← قواعد التحقق (400)
  │    ├─ فحوص الازدواجية والتجاوز          ← (409 / 403)
  │    └─ tx(() => { INSERT + ledger.post + audit.log })   ← معاملة واحدة
  ├─ res.json({ ok:true, data })
  └─ errorHandler                           ← توحيد الأخطاء + رسائل عربية
```

## 5. المعاملات (Atomicity)

كل عملية إنشاء/تعديل/اعتماد تُنفَّذ داخل معاملة واحدة تشمل:
1. كتابة/تعديل السجل الأساسي.
2. تحديث الربط العكسي (مثل `transfers.advance_id`).
3. توليد/إلغاء القيد المحاسبي.
4. كتابة سجل العمليات.

أي فشل في خطوة يُلغي الكل — لا يمكن وجود عملية بلا قيد أو بلا سجل.

## 6. الأمان

- كلمات المرور بـ bcrypt (cost 10).
- رموز الجلسات 32 بايت عشوائية (`crypto.randomBytes`)، صلاحية قابلة للضبط.
- كل الاستعلامات بـ Prepared Statements (لا بناء SQL من المدخلات) + `ESCAPE` في البحث النصي.
- فحص نوع الملف وحجمه قبل الحفظ، وأسماء ملفات مولَّدة عشوائيًا.
- رؤوس أمان: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.
