-- =====================================================================
--  نظام أرض العيينة المحاسبي - المخطط الأولي لقاعدة البيانات
--  Schema: SQLite (Relational)
--  جميع الأرصدة تُحتسب من العمليات المسجلة (Data-Driven) ولا تُخزَّن كقيم ثابتة
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1) المشاريع
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  description   TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

-- ---------------------------------------------------------------------
-- 2) مراكز التكلفة (شجرة: مشروع رئيسي + مراكز فرعية مستقبلية)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_centers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  parent_id     INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
  code          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  is_main       INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_cc_project ON cost_centers(project_id);
CREATE INDEX IF NOT EXISTS idx_cc_parent  ON cost_centers(parent_id);

-- ---------------------------------------------------------------------
-- 3) مصادر التمويل (قابل للتوسعة: جاري الشريك / أوتك / النقليات / ...)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS funding_sources (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT    NOT NULL UNIQUE,
  name             TEXT    NOT NULL,
  account_id       INTEGER,                      -- مرتبط بدليل الحسابات
  opening_balance  REAL    NOT NULL DEFAULT 0,   -- رصيد افتتاحي (حساب جاري)
  credit_limit     REAL,                         -- سقف تمويلي اختياري
  description      TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_by       INTEGER,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);

-- ---------------------------------------------------------------------
-- 4) دليل الحسابات المحاسبية
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  type          TEXT    NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  parent_id     INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
  nature        TEXT    NOT NULL DEFAULT 'debit' CHECK (nature IN ('debit','credit')),
  is_system     INTEGER NOT NULL DEFAULT 0,     -- حسابات النظام لا تُحذف
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);

-- ---------------------------------------------------------------------
-- 5) المقاولون
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contractors (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT    NOT NULL UNIQUE,          -- رقم المقاول
  name             TEXT    NOT NULL,
  specialty        TEXT,
  phone            TEXT,
  vat_number       TEXT,
  national_id      TEXT,
  bank_iban        TEXT,
  opening_balance  REAL    NOT NULL DEFAULT 0,
  notes            TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_by       INTEGER,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);

-- ---------------------------------------------------------------------
-- 6) الموردون
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT    NOT NULL UNIQUE,          -- رقم المورد
  name             TEXT    NOT NULL,
  category         TEXT,
  phone            TEXT,
  vat_number       TEXT,
  commercial_reg   TEXT,
  bank_iban        TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0,
  opening_balance  REAL    NOT NULL DEFAULT 0,
  notes            TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_by       INTEGER,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);

-- ---------------------------------------------------------------------
-- 7) المستخدمين والأدوار والصلاحيات
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,   -- مثال: advances.approve
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  full_name     TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  email         TEXT,
  phone         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------------------------------------------------------------------
-- 8) التحويلات المالية (مركز الحركة المالية)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_no      TEXT    NOT NULL UNIQUE,          -- رقم العملية
  transfer_date    TEXT    NOT NULL,
  amount           REAL    NOT NULL CHECK (amount > 0),
  funding_source_id INTEGER NOT NULL REFERENCES funding_sources(id) ON DELETE RESTRICT,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  cost_center_id   INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
  from_account_id  INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
  to_account_id    INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
  transfer_type    TEXT    NOT NULL CHECK (transfer_type IN ('advance','supplier','other')),
  beneficiary_type TEXT    NOT NULL CHECK (beneficiary_type IN ('contractor','supplier','other')),
  beneficiary_name TEXT,                             -- اسم المستفيد (نص حر عند عدم وجود سجل)
  contractor_id    INTEGER REFERENCES contractors(id) ON DELETE RESTRICT,
  supplier_id      INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  advance_id       INTEGER,                          -- مرجع للعهدة (يُدار داخل الخدمة ضمن معاملة واحدة)
  purpose          TEXT,                             -- الغرض من التحويل
  bank_ref         TEXT,                             -- المرجع البنكي (فريد عند تعبئته)
  bank_name        TEXT,
  notes            TEXT,
  approval_status  TEXT    NOT NULL DEFAULT 'draft'
                   CHECK (approval_status IN ('draft','pending','approved','rejected')),
  is_void          INTEGER NOT NULL DEFAULT 0,
  void_reason      TEXT,
  voided_at        TEXT,
  voided_by        INTEGER,
  created_by       INTEGER REFERENCES users(id),
  approved_by      INTEGER REFERENCES users(id),
  approved_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_transfers_bank_ref
  ON transfers(bank_ref) WHERE bank_ref IS NOT NULL AND bank_ref <> '' AND is_void = 0;
CREATE INDEX IF NOT EXISTS idx_transfers_date    ON transfers(transfer_date);
CREATE INDEX IF NOT EXISTS idx_transfers_source  ON transfers(funding_source_id);
CREATE INDEX IF NOT EXISTS idx_transfers_advance ON transfers(advance_id);
CREATE INDEX IF NOT EXISTS idx_transfers_type    ON transfers(transfer_type);

-- ---------------------------------------------------------------------
-- 9) عهد المقاولين
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advances (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  advance_no       TEXT    NOT NULL UNIQUE,          -- رقم العهدة
  advance_date     TEXT    NOT NULL,
  contractor_id    INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  cost_center_id   INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
  funding_source_id INTEGER NOT NULL REFERENCES funding_sources(id) ON DELETE RESTRICT,
  transfer_id      INTEGER,                          -- التحويل المموِّل (FK منطقي يُدار بالخدمة)
  transfer_no      TEXT,                             -- رقم التحويل (مرجعي)
  transfer_date    TEXT,                             -- تاريخ التحويل
  beneficiary_name TEXT,                             -- المستفيد
  description      TEXT    NOT NULL,                 -- بيان العهدة
  amount           REAL    NOT NULL CHECK (amount > 0),  -- المبلغ المطلوب
  currency         TEXT    NOT NULL DEFAULT 'SAR',
  approval_status  TEXT    NOT NULL DEFAULT 'draft'
                   CHECK (approval_status IN ('draft','pending','approved','rejected')),
  status           TEXT    NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','under_settlement','partially_closed','closed')),
  status_locked_by_user INTEGER NOT NULL DEFAULT 0,  -- حالة محددة يدويًا بواسطة المستخدم
  notes            TEXT,
  is_void          INTEGER NOT NULL DEFAULT 0,
  void_reason      TEXT,
  voided_at        TEXT,
  voided_by        INTEGER,
  created_by       INTEGER REFERENCES users(id),
  approved_by      INTEGER REFERENCES users(id),
  approved_at      TEXT,
  closed_at        TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_adv_transfer   ON advances(transfer_id);
CREATE INDEX IF NOT EXISTS idx_adv_contractor ON advances(contractor_id);
CREATE INDEX IF NOT EXISTS idx_adv_project    ON advances(project_id);
CREATE INDEX IF NOT EXISTS idx_adv_source     ON advances(funding_source_id);
CREATE INDEX IF NOT EXISTS idx_adv_date       ON advances(advance_date);

-- ---------------------------------------------------------------------
-- 10) إخلاء العهد (فواتير الإخلاء)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS advance_settlements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_no    TEXT    NOT NULL UNIQUE,          -- رقم الإخلاء
  settlement_date  TEXT    NOT NULL,
  advance_id       INTEGER NOT NULL REFERENCES advances(id) ON DELETE RESTRICT,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  cost_center_id   INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
  account_id       INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,  -- حساب المصروف
  invoice_no       TEXT    NOT NULL,                 -- رقم الفاتورة
  description      TEXT    NOT NULL,                 -- البيان
  net_amount       REAL    NOT NULL CHECK (net_amount >= 0),  -- قيمة الفاتورة
  vat_amount       REAL    NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount     REAL    NOT NULL CHECK (total_amount >= 0),
  review_status    TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (review_status IN ('pending','reviewed','returned')),
  approval_status  TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (approval_status IN ('pending','approved','rejected')),
  over_settlement  INTEGER NOT NULL DEFAULT 0,       -- تجاوز رصيد العهدة (بصلاحية خاصة)
  notes            TEXT,
  is_void          INTEGER NOT NULL DEFAULT 0,
  void_reason      TEXT,
  voided_at        TEXT,
  voided_by        INTEGER,
  created_by       INTEGER REFERENCES users(id),
  approved_by      INTEGER REFERENCES users(id),
  approved_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);
-- منع تكرار رقم فاتورة الإخلاء لنفس العهدة
CREATE UNIQUE INDEX IF NOT EXISTS ux_settlements_advance_invoice
  ON advance_settlements(advance_id, invoice_no) WHERE is_void = 0;
CREATE INDEX IF NOT EXISTS idx_set_advance ON advance_settlements(advance_id);
CREATE INDEX IF NOT EXISTS idx_set_date    ON advance_settlements(settlement_date);

-- ---------------------------------------------------------------------
-- 11) فواتير الموردين
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_invoices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id      INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  invoice_no       TEXT    NOT NULL,
  invoice_date     TEXT    NOT NULL,
  due_date         TEXT,
  description      TEXT    NOT NULL,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  cost_center_id   INTEGER REFERENCES cost_centers(id) ON DELETE RESTRICT,
  account_id       INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
  net_amount       REAL    NOT NULL CHECK (net_amount >= 0),
  vat_amount       REAL    NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  total_amount     REAL    NOT NULL CHECK (total_amount >= 0),
  approval_status  TEXT    NOT NULL DEFAULT 'draft'
                   CHECK (approval_status IN ('draft','pending','approved','rejected')),
  notes            TEXT,
  is_void          INTEGER NOT NULL DEFAULT 0,
  void_reason      TEXT,
  voided_at        TEXT,
  voided_by        INTEGER,
  created_by       INTEGER REFERENCES users(id),
  approved_by      INTEGER REFERENCES users(id),
  approved_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT,
  UNIQUE(supplier_id, invoice_no)                    -- منع ازدواجية الفاتورة لنفس المورد
);
CREATE INDEX IF NOT EXISTS idx_inv_supplier ON supplier_invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inv_date     ON supplier_invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_inv_project  ON supplier_invoices(project_id);

-- ---------------------------------------------------------------------
-- 12) الدفعات (ربط التحويلات بفواتير الموردين / العهد)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_no       TEXT    NOT NULL UNIQUE,
  payment_date     TEXT    NOT NULL,
  amount           REAL    NOT NULL CHECK (amount > 0),
  transfer_id      INTEGER REFERENCES transfers(id) ON DELETE RESTRICT,
  supplier_invoice_id INTEGER REFERENCES supplier_invoices(id) ON DELETE RESTRICT,
  advance_id       INTEGER REFERENCES advances(id) ON DELETE RESTRICT,
  supplier_id      INTEGER REFERENCES suppliers(id) ON DELETE RESTRICT,
  contractor_id    INTEGER REFERENCES contractors(id) ON DELETE RESTRICT,
  payment_type     TEXT    NOT NULL CHECK (payment_type IN ('supplier_invoice','advance','advance_payment','other')),
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  notes            TEXT,
  approval_status  TEXT    NOT NULL DEFAULT 'approved'
                   CHECK (approval_status IN ('draft','pending','approved','rejected')),
  is_void          INTEGER NOT NULL DEFAULT 0,
  void_reason      TEXT,
  voided_at        TEXT,
  voided_by        INTEGER,
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_transfer ON payments(transfer_id);
CREATE INDEX IF NOT EXISTS idx_pay_invoice  ON payments(supplier_invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_advance  ON payments(advance_id);

-- ---------------------------------------------------------------------
-- 13) المرفقات
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attachments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL,     -- advance | transfer | settlement | supplier_invoice | payment | contractor | supplier
  entity_id     INTEGER NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'document', -- invoice | transfer_proof | document | other
  file_name     TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  description   TEXT,
  is_void       INTEGER NOT NULL DEFAULT 0,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_att_entity ON attachments(entity_type, entity_id);

-- ---------------------------------------------------------------------
-- 14) سجل العمليات (Audit Log)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER,
  username      TEXT,
  action        TEXT NOT NULL,     -- create|update|approve|reject|void|restore|delete|login|logout|export|over_settle
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER,
  entity_label  TEXT,
  summary       TEXT,
  old_values    TEXT,              -- JSON
  new_values    TEXT,              -- JSON
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_date   ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id);

-- ---------------------------------------------------------------------
-- 15) القيود المحاسبية اليومية (دفتر الأستاذ العام - قيد مزدوج)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS journal_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no      TEXT NOT NULL UNIQUE,
  entry_date    TEXT NOT NULL,
  ref_type      TEXT NOT NULL,   -- advance | transfer | settlement | payment | supplier_invoice
  ref_id        INTEGER NOT NULL,
  description   TEXT,
  project_id    INTEGER,
  is_void       INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_journal_ref ON journal_entries(ref_type, ref_id) WHERE is_void = 0;

CREATE TABLE IF NOT EXISTS journal_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id      INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit         REAL NOT NULL DEFAULT 0,
  credit        REAL NOT NULL DEFAULT 0,
  cost_center_id INTEGER,
  memo          TEXT
);
CREATE INDEX IF NOT EXISTS idx_jl_entry   ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_id);

-- ---------------------------------------------------------------------
-- 16) تسلسل أرقام المستندات + الإعدادات
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sequences (
  key        TEXT PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT
);

-- ---------------------------------------------------------------------
-- 17) عرض محسوب: أرصدة العهد
-- ---------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_advance_balances AS
SELECT
  a.id                                                          AS advance_id,
  a.amount                                                      AS advance_amount,
  COALESCE(s.approved_total, 0)                                 AS settled_total,
  COALESCE(s.pending_total, 0)                                  AS pending_total,
  COUNT(s.id)                                                   AS settlements_count,
  ROUND(a.amount - COALESCE(s.approved_total, 0), 2)            AS remaining_balance
FROM advances a
LEFT JOIN (
  SELECT advance_id,
         SUM(CASE WHEN approval_status = 'approved' AND is_void = 0 THEN total_amount ELSE 0 END) AS approved_total,
         SUM(CASE WHEN approval_status = 'pending'  AND is_void = 0 THEN total_amount ELSE 0 END) AS pending_total,
         COUNT(CASE WHEN is_void = 0 THEN 1 END) AS id
  FROM advance_settlements
  GROUP BY advance_id
) s ON s.advance_id = a.id;

-- ---------------------------------------------------------------------
-- 18) عرض محسوب: أرصدة فواتير الموردين
-- ---------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_invoice_balances AS
SELECT
  i.id                                                    AS invoice_id,
  i.total_amount                                          AS invoice_total,
  COALESCE(p.paid_total, 0)                               AS paid_total,
  ROUND(i.total_amount - COALESCE(p.paid_total, 0), 2)    AS remaining_total,
  COALESCE(p.payments_count, 0)                           AS payments_count
FROM supplier_invoices i
LEFT JOIN (
  SELECT supplier_invoice_id,
         SUM(CASE WHEN approval_status = 'approved' AND is_void = 0 THEN amount ELSE 0 END) AS paid_total,
         COUNT(CASE WHEN is_void = 0 THEN 1 END) AS payments_count
  FROM payments
  GROUP BY supplier_invoice_id
) p ON p.supplier_invoice_id = i.id;
