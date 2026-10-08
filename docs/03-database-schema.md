# 03 · مخطط قاعدة البيانات + ERD

قاعدة بيانات علائقية (SQLite، WAL، `foreign_keys = ON`) — 20 جدولًا + عرضان محسوبان.
الملف: `server/db/migrations/001_init.sql`

## 1. ERD

```
                        ┌──────────────┐
                        │   projects   │
                        │  أرض العيينة │
                        └──────┬───────┘
                               │ 1:N
                        ┌──────▼───────┐
                        │ cost_centers │ (شجرة: parent_id → نفسه)
                        └──────┬───────┘
                               │ N:1 من كل عملية
   ┌───────────────┐    ┌──────▼───────┐    ┌───────────────┐
   │funding_sources│◀───┤  transfers   ├───▶│ contractors   │
   │ جاري الشريك   │ 1:N│  (المركز)    │ N:1│  suppliers    │
   │ أوتك /النقليات│    └──┬────────┬──┘    └──────┬────────┘
   └───────┬───────┘       │        │             │
           │ 1:N           │ 1:N    │ 1:N         │ 1:N
           │        ┌──────▼───┐  ┌─▼────────────▼──┐
           └───────▶│ advances │  │ supplier_invoices│
                    └──┬────┬──┘  └────────┬─────────┘
                       │    │ 1:N          │ 1:N
              transfer_id  │        ┌─────▼─────┐
              (ربط منطقي)  │        │  payments  │◀── transfer_id
                       ┌───▼───────────────┐    │
                       │advance_settlements│    │
                       └───────────────────┘    │
                                                │
   ┌─────────┐   ┌──────────┐   ┌────────────┐  │
   │  users  │──▶│  roles   │──▶│role_perms  │  │
   └────┬────┘   └──────────┘   └─────┬──────┘  │
        │ 1:N                    ┌────▼──────┐  │
        ├───────────────────────▶│permissions│  │
        │                        └───────────┘  │
        ├──▶ sessions                            │
        ├──▶ audit_logs  (كل العمليات)           │
        └──▶ attachments (entity_type + entity_id) ── مرتبط بأي وحدة

   ┌──────────────────┐   1:N   ┌───────────────┐
   │ journal_entries  │────────▶│ journal_lines │──▶ accounts
   └──────────────────┘         └───────────────┘
      (ref_type, ref_id) → advance | transfer | settlement | payment | supplier_invoice

   sequences (ترقيم المستندات)   settings (key/value)
```

## 2. الجداول

| الجدول | الغرض | مفاتيح رئيسية/فريدة |
|---|---|---|
| `projects` | المشاريع | `code` UNIQUE |
| `cost_centers` | مراكز التكلفة (شجرة) | `code` UNIQUE، `parent_id` |
| `funding_sources` | مصادر التمويل | `code` UNIQUE، `account_id` |
| `accounts` | دليل الحسابات (شجرة) | `code` UNIQUE |
| `contractors` | المقاولون | `code` UNIQUE |
| `suppliers` | الموردون | `code` UNIQUE |
| `advances` | عهد المقاولين | `advance_no` UNIQUE |
| `transfers` | التحويلات | `transfer_no` UNIQUE، `bank_ref` UNIQUE جزئي |
| `advance_settlements` | إخلاء العهد | `settlement_no` UNIQUE، `(advance_id, invoice_no)` UNIQUE جزئي |
| `supplier_invoices` | فواتير الموردين | `(supplier_id, invoice_no)` UNIQUE |
| `payments` | الدفعات | `payment_no` UNIQUE |
| `attachments` | المرفقات | `(entity_type, entity_id)` |
| `users` / `roles` / `permissions` / `role_permissions` | المستخدمون والصلاحيات | |
| `sessions` | الجلسات | `id` = token |
| `audit_logs` | سجل العمليات | |
| `journal_entries` / `journal_lines` | دفتر الأستاذ | `(ref_type, ref_id)` UNIQUE جزئي |
| `sequences` | ترقيم المستندات | `key` PK |
| `settings` | الإعدادات | `key` PK |

## 3. العلاقات الخارجية

```sql
cost_centers.project_id     → projects(id)      ON DELETE RESTRICT
cost_centers.parent_id      → cost_centers(id)  ON DELETE RESTRICT
funding_sources.account_id  → accounts(id)
advances.contractor_id      → contractors(id)   ON DELETE RESTRICT
advances.project_id         → projects(id)      ON DELETE RESTRICT
advances.funding_source_id  → funding_sources(id) ON DELETE RESTRICT
transfers.funding_source_id → funding_sources(id) ON DELETE RESTRICT
transfers.contractor_id     → contractors(id)
transfers.supplier_id       → suppliers(id)
transfers.advance_id        → advances(id)
advance_settlements.advance_id → advances(id)   ON DELETE RESTRICT
supplier_invoices.supplier_id  → suppliers(id)  ON DELETE RESTRICT
payments.transfer_id        → transfers(id)     ON DELETE RESTRICT
payments.supplier_invoice_id→ supplier_invoices(id) ON DELETE RESTRICT
payments.advance_id         → advances(id)
journal_lines.entry_id      → journal_entries(id) ON DELETE CASCADE
journal_lines.account_id    → accounts(id)
users.role_id               → roles(id)         ON DELETE RESTRICT
role_permissions            → roles / permissions ON DELETE CASCADE
```

### الربط المنطقي بين `advances.transfer_id` و `transfers.advance_id`

العلاقة ثنائية الاتجاه وتُدار داخل **معاملة واحدة** في طبقة الخدمات:
- عند إنشاء تحويل مرتبط بعهدة: يُحدَّث `advances.transfer_id` و`transfers.advance_id` معًا.
- عند إلغاء أي طرف: يُفك الربط من الطرفين.
- الاتجاه المُقيَّد بقاعدة FK هو `transfers.advance_id` (لأن جدول العهد يُنشأ قبل التحويلات).
- يطابق `تقرير المطابقة` أي اختلاف محتمل بين الطرفين.

## 4. الفهارس

```
idx_cc_project, idx_cc_parent, idx_accounts_type, idx_sessions_user
idx_transfers_date, idx_transfers_source, idx_transfers_advance, idx_transfers_type
ux_transfers_bank_ref (جزئي: WHERE bank_ref IS NOT NULL AND is_void = 0)
idx_adv_transfer, idx_adv_contractor, idx_adv_project, idx_adv_source, idx_adv_date
ux_settlements_advance_invoice (جزئي: WHERE is_void = 0)
idx_set_advance, idx_set_date
idx_inv_supplier, idx_inv_date, idx_inv_project
idx_pay_transfer, idx_pay_invoice, idx_pay_advance
idx_att_entity, idx_audit_entity, idx_audit_date, idx_audit_user
idx_jl_entry, idx_jl_account, ux_journal_ref (جزئي)
```

## 5. العروض المحسوبة (Views)

```sql
v_advance_balances  → advance_id, advance_amount, settled_total, pending_total,
                      settlements_count, remaining_balance
v_invoice_balances  → invoice_id, invoice_total, paid_total, remaining_total, payments_count
```

تُستخدم للمطابقة السريعة والاستعلامات التحليلية.

## 6. حالات السجلات (CHECK Constraints)

| الجدول | الحقل | القيم المسموحة |
|---|---|---|
| `advances` | `approval_status` | draft, pending, approved, rejected |
| `advances` | `status` | open, under_settlement, partially_closed, closed |
| `transfers` | `transfer_type` | advance, supplier, other |
| `transfers` | `beneficiary_type` | contractor, supplier, other |
| `advance_settlements` | `review_status` | pending, reviewed, returned |
| `advance_settlements` | `approval_status` | pending, approved, rejected |
| `accounts` | `type` | asset, liability, equity, income, expense |
| `payments` | `payment_type` | supplier_invoice, advance, advance_payment, other |

## 7. الإلغاء بدل الحذف

كل جدول تشغيلي يحمل:

```sql
is_void INTEGER NOT NULL DEFAULT 0,
void_reason TEXT, voided_at TEXT, voided_by INTEGER
```

الفهارس الفريدة **جزئية** (`WHERE is_void = 0`) فيمكن إعادة استخدام نفس الرقم بعد الإلغاء مع بقاء السجل الأصلي للتدقيق.

## 8. دقة الأرقام

SQLite لا يملك نوع `DECIMAL`. تُخزَّن المبالغ `REAL` مع:
- تقريب إلزامي لرقمين (`round2`) قبل الكتابة.
- مقارنة مالية بعتبة `0.005` (`eqMoney` / `gteMoney`) بدل `===`.
- كل التجميعات في SQL تُغلَّف بـ `ROUND(..., 2)`.
- دفتر الأستاذ يُتحقق من توازنه (`مدين = دائن`) قبل الحفظ.
