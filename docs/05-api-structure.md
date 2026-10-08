# 05 · بنية الـ API

القاعدة: `/api` · الترميز: `application/json; charset=utf-8` · المصادقة: `Authorization: Bearer <token>`

## 1. شكل الاستجابة الموحَّد

```jsonc
// نجاح
{ "ok": true, "data": { ... } }

// فشل
{ "ok": false, "error": { "code": "OVER_SETTLEMENT", "message": "…", "details": { ... } } }
```

| HTTP | المعنى |
|---|---|
| 400 `VALIDATION` | بيانات غير صالحة / ناقصة |
| 401 `UNAUTHORIZED` | جلسة غير صالحة |
| 403 `FORBIDDEN` | صلاحية غير متوفرة |
| 404 `NOT_FOUND` | السجل غير موجود |
| 409 `DUPLICATE` / `DUPLICATE_TRANSFER` / `OVER_SETTLEMENT` / `OVERPAYMENT` / `UNSETTLED_BALANCE` | تعارض مع ضوابط النظام |

## 2. المصادقة

| الطريقة | المسار | الصلاحية |
|---|---|---|
| POST | `/api/auth/login` | عام |
| POST | `/api/auth/logout` | مسجَّل |
| GET | `/api/auth/me` | مسجَّل |
| POST | `/api/auth/change-password` | مسجَّل |
| GET | `/api/health` | عام |

## 3. البيانات المرجعية

| الطريقة | المسار | الصلاحية |
|---|---|---|
| GET | `/api/meta` | مسجَّل |
| GET | `/api/options/:kind` (contractors/suppliers) | مسجَّل |
| GET | `/api/search?q=` | مسجَّل |
| GET/POST/PUT | `/api/projects` | settings.update |
| GET/POST/PUT | `/api/cost-centers` | settings.update |
| GET/POST/PUT | `/api/accounts` | accounts.view / accounts.manage |
| GET/POST/PUT | `/api/funding-sources` | funding_sources.* |
| GET | `/api/funding-sources/analysis` | funding_sources.view |
| POST | `/api/funding-sources/:id/void` | funding_sources.void |
| GET/POST/PUT | `/api/contractors`, `/api/suppliers` | contractors.* / suppliers.* |
| GET/POST/PUT | `/api/users` | users.* |
| POST | `/api/users/:id/reset-password` | users.update |
| GET | `/api/roles`, `/api/permissions` | users.view / users.roles |
| PUT | `/api/roles/:id/permissions` | users.roles |
| GET/PUT | `/api/settings` | settings.* |
| GET | `/api/audit-logs` | audit_logs.view |
| POST | `/api/audit-logs/purge` | audit_logs.purge |

## 4. عهد المقاولين

| الطريقة | المسار | الصلاحية |
|---|---|---|
| GET | `/api/advances` | advances.view |
| GET | `/api/advances/:id` (البطاقة الكاملة) | advances.view |
| GET | `/api/advances/:id/balance` | advances.view |
| POST | `/api/advances` | advances.create |
| PUT | `/api/advances/:id` | advances.update |
| POST | `/api/advances/:id/approve` \| `/reject` | advances.approve |
| POST | `/api/advances/:id/close` `{confirm, reason}` | advances.update (+ advances.close عند وجود رصيد) |
| POST | `/api/advances/:id/reopen` | advances.update |
| POST | `/api/advances/:id/void` `{reason}` | advances.void |

## 5. التحويلات

| الطريقة | المسار | الصلاحية |
|---|---|---|
| GET | `/api/transfers` | transfers.view |
| GET | `/api/transfers/:id` | transfers.view |
| POST | `/api/transfers` | transfers.create |
| PUT | `/api/transfers/:id` | transfers.update |
| POST | `/api/transfers/:id/approve` \| `/reject` | transfers.approve |
| POST | `/api/transfers/:id/link-advance` `{advance_id}` | transfers.update |
| POST | `/api/transfers/:id/unlink-advance` | transfers.update |
| POST | `/api/transfers/:id/void` `{reason}` | transfers.void |
| POST | `/api/transfers/check-duplicate` | transfers.create |

## 6. إخلاء العهد

| الطريقة | المسار | الصلاحية |
|---|---|---|
| GET | `/api/settlements` | settlements.view |
| GET | `/api/settlements/:id` | settlements.view |
| POST | `/api/settlements` `{allow_over_settlement?}` | settlements.create (+ settlements.over_settle) |
| PUT | `/api/settlements/:id` | settlements.update |
| POST | `/api/settlements/:id/review` `{status}` | settlements.review |
| POST | `/api/settlements/:id/approve` \| `/unapprove` \| `/reject` | settlements.approve |
| POST | `/api/settlements/:id/void` `{reason}` | settlements.void |

## 7. فواتير الموردين والدفعات

| الطريقة | المسار | الصلاحية |
|---|---|---|
| GET/POST/PUT | `/api/supplier-invoices` | supplier_invoices.* |
| GET | `/api/supplier-invoices/:id` | supplier_invoices.view |
| POST | `/api/supplier-invoices/:id/approve` \| `/void` | supplier_invoices.approve / void |
| GET/POST | `/api/payments` | payments.* |
| POST | `/api/payments/:id/void` | payments.void |

## 8. المرفقات

| الطريقة | المسار |
|---|---|
| GET | `/api/attachments?entity_type=&entity_id=` |
| POST | `/api/attachments` (multipart: `file`, `entity_type`, `entity_id`, `kind`) |
| GET | `/api/attachments/:id/download` |
| POST | `/api/attachments/:id/void` |

## 9. لوحة التحكم والتقارير

| الطريقة | المسار |
|---|---|
| GET | `/api/dashboard?project_id=&from=&to=` |
| GET | `/api/reports` (قائمة التقارير) |
| GET | `/api/reports/:key?…filters` |
| GET | `/api/reconciliation?…filters` |
| GET | `/api/export/:key/xlsx` \| `/csv` |
| GET | `/api/print/:key` (HTML جاهز للطباعة → PDF) |

### مفاتيح التقارير

`advances` · `settlements` · `contractors` · `suppliers` · `transfers` · `funding_sources` ·
`balances` · `unlinked` · `expenses_by_project` · `expenses_by_funding` · `journal`

### فلاتر مشتركة

`search` `project_id` `cost_center_id` `funding_source_id` `contractor_id` `supplier_id`
`status` `approval_status` `review_status` `date_from` `date_to` `from` `to` `page` `pageSize` `sort` `dir`

### مثال

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/reports/contractors?from=2026-01-01&to=2026-06-30&project_id=1"
```

```jsonc
{ "ok": true, "data": {
    "key": "contractors", "title": "تقرير المقاولين",
    "columns": [{ "key": "name", "label": "اسم المقاول" }, …],
    "rows": [{ "name": "…", "total_advances": 50000, "remaining_balance": 15000, … }],
    "totals": { "total_advances": 88000, "remaining_balance": 31200 },
    "totalKeys": ["total_advances", …],
    "row_count": 3, "generated_at": "2026-10-08T07:32:39.631Z"
} }
```

## 10. الاستعلامات المجمَّعة (Pagination)

```jsonc
"pagination": { "page": 1, "pageSize": 20, "total": 137, "totalPages": 7 }
```

`pageSize` محدود بـ 500، و`sort` يُقبل فقط من قائمة أعمدة مسموحة لكل تقرير (منع حقن SQL).
