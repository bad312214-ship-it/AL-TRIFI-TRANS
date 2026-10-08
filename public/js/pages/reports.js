/* ═══════════════════════════════════════════════════════════════
   التقارير · المطابقة · سجل العمليات · إعدادات النظام
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const REPORT_ICONS = {
  advances: '🧾', settlements: '✅', contractors: '👷', suppliers: '🏭', transfers: '💸',
  funding_sources: '💰', balances: '⚖️', unlinked: '🔗', expenses_by_project: '🏗',
  expenses_by_funding: '📊', journal: '📚'
};

async function exportReport(key, filters = {}) {
  const params = qs({ ...filters, page: undefined, pageSize: undefined, sort: undefined, dir: undefined });
  try {
    toast('جارٍ تجهيز الملف...', 'info');
    await Api.download(`/export/${key}/xlsx${params}`, `${key}-${today()}.xlsx`);
    toast('تم تنزيل ملف Excel', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

Router.register('/reports', async ({ query, container }) => {
  await ensureMeta();
  const defs = await Api.get('/reports');
  const key = query.key || 'advances';
  const def = defs.find(d => d.key === key) || defs[0];

  const cons = await contractors();
  const sups = await suppliers();

  container.innerHTML = `
    ${pageHead('التقارير', 'كل التقارير محسوبة من العمليات المسجلة وقابلة للتصدير', `
      <button class="btn btn-primary" id="btnXlsx">⬇ Excel</button>
      <button class="btn" id="btnCsv">⬇ CSV</button>
      <button class="btn" id="btnPdf">🖨 PDF</button>
      <button class="btn" id="btnWorkbook" title="تنزيل كل التقارير في ملف Excel واحد">📚 كل التقارير</button>`)}
    <div class="card mb"><div class="card-body" style="display:flex;gap:9px;flex-wrap:wrap;">
      ${defs.map(d => `<button class="btn btn-sm ${d.key === def.key ? 'btn-primary' : ''}" data-rk="${d.key}">${REPORT_ICONS[d.key] || '📄'} ${esc(d.title)}</button>`).join('')}
    </div></div>

    ${filtersBar('repFilters', [
      { name: 'search', label: 'بحث', placeholder: 'نص حر حسب التقرير', value: query.search || '' },
      { name: 'project_id', label: 'المشروع', type: 'select', value: query.project_id || '', options: projectOptions() },
      { name: 'from', label: 'من تاريخ', type: 'date', value: query.from || '' },
      { name: 'to', label: 'إلى تاريخ', type: 'date', value: query.to || '' },
      ...(def.key === 'advances' || def.key === 'contractors' ? [{ name: 'contractor_id', label: 'المقاول', type: 'select', placeholder: 'الكل', value: query.contractor_id || '', options: cons.map(c => ({ value: c.id, label: c.name })) }] : []),
      ...(def.key === 'suppliers' ? [{ name: 'supplier_id', label: 'المورد', type: 'select', placeholder: 'الكل', value: query.supplier_id || '', options: sups.map(s => ({ value: s.id, label: s.name })) }] : []),
      ...(def.key === 'transfers' || def.key === 'funding_sources' || def.key === 'expenses_by_funding' ? [{ name: 'funding_source_id', label: 'مصدر التمويل', type: 'select', value: query.funding_source_id || '', options: fundingOptions() }] : []),
      { name: 'status', label: 'الحالة', type: 'select', value: query.status || '', options: [{ value: 'open', label: 'مفتوحة' }, { value: 'closed', label: 'مغلقة' }, { value: 'unpaid', label: 'غير مدفوعة' }, { value: 'partial', label: 'مدفوعة جزئيًا' }, { value: 'paid', label: 'مدفوعة بالكامل' }] },
      { name: 'approval_status', label: 'الاعتماد', type: 'select', value: query.approval_status || '', options: [{ value: 'draft', label: 'مسودة' }, { value: 'pending', label: 'بانتظار الاعتماد' }, { value: 'approved', label: 'معتمدة' }, { value: 'rejected', label: 'مرفوضة' }] }
    ], { open: true })}

    <div class="card">
      <div class="card-head"><h3>${REPORT_ICONS[def.key] || '📄'} ${esc(def.title)}</h3>
        <span class="hint">${esc(def.description || '')}</span>
        <div class="spacer"></div><span class="hint" id="rowCount"></span></div>
      <div class="card-body flush" id="repBody"><div class="spinner"></div></div>
    </div>`;

  const params = qs({ ...query, key: undefined });

  const load = async () => {
    const body = document.getElementById('repBody');
    body.innerHTML = '<div class="spinner"></div>';
    const rep = await Api.get(`/reports/${def.key}${params}`);
    document.getElementById('rowCount').textContent = `${int(rep.row_count)} سجل · ${fmtDateTime(rep.generated_at)}`;
    body.innerHTML = tableHTML({
      columns: rep.columns.map(c => ({ key: c.key, label: c.label, num: c.type === 'money', render: c.type === 'money' ? (r) => money(r[c.key]) : (r) => esc(r[c.key]) })),
      rows: rep.rows, totals: rep.totalKeys && rep.totalKeys.length ? rep.totals : null,
      emptyText: 'لا توجد بيانات ضمن الفلاتر المحددة'
    });
  };
  await load();

  document.querySelectorAll('[data-rk]').forEach(b => b.onclick = () => Router.go(`#/reports${qs({ ...query, key: b.dataset.rk })}`));
  bindFilters(document.getElementById('view'), f => Router.go(`#/reports${qs({ ...f, key: def.key })}`));
  const paramsForExport = () => qs({ ...query, key: undefined, page: undefined, pageSize: undefined });
  document.getElementById('btnXlsx').onclick = async () => {
    try { await Api.download(`/export/${def.key}/xlsx${paramsForExport()}`, `${def.key}-${today()}.xlsx`); toast('تم تنزيل Excel', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  document.getElementById('btnCsv').onclick = async () => {
    try { await Api.download(`/export/${def.key}/csv${paramsForExport()}`, `${def.key}-${today()}.csv`); toast('تم تنزيل CSV', 'ok'); } catch (e) { toast(e.message, 'err'); }
  };
  document.getElementById('btnPdf').onclick = () => {
    window.open(`/api/print/${def.key}${paramsForExport()}&token=${encodeURIComponent(Store.token)}`, '_blank');
  };
  document.getElementById('btnWorkbook').onclick = async () => {
    try {
      toast('جارٍ تجهيز مصنف التقارير الكامل...', 'info');
      await Api.download(`/export/workbook/xlsx${paramsForExport()}`, `oyaynah-reports-${today()}.xlsx`);
      toast('تم تنزيل كل التقارير في ملف واحد', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
});

/* ══════════════════════ المطابقة ══════════════════════ */
Router.register('/reconciliation', async ({ query, container }) => {
  await ensureMeta();
  const d = await Api.get('/reconciliation' + qs(query));

  container.innerHTML = `
    ${pageHead('تقرير المطابقة', 'يكشف العمليات غير المرتبطة والمكررة وغير المسوَّاة', `
      <button class="btn btn-primary" id="btnXlsx">⬇ Excel</button>`)}

    <div class="kpi-grid">
      ${kpiCard({ label: 'إجمالي الملاحظات', value: int(d.total_issues), icon: '🔗', color: '#1d4ed8', unit: '' })}
      ${kpiCard({ label: 'أهمية عالية', value: int(d.high), icon: '🔴', color: '#b91c1c', unit: '' })}
      ${kpiCard({ label: 'أهمية متوسطة', value: int(d.medium), icon: '🟠', color: '#b45309', unit: '' })}
      ${kpiCard({ label: 'أهمية منخفضة', value: int(d.low), icon: '🔵', color: '#0891b2', unit: '' })}
    </div>

    ${filtersBar('recFilters', [
      { name: 'project_id', label: 'المشروع', type: 'select', value: query.project_id || '', options: projectOptions() },
      { name: 'from', label: 'من تاريخ', type: 'date', value: query.from || '' },
      { name: 'to', label: 'إلى تاريخ', type: 'date', value: query.to || '' },
      { name: 'checks', label: 'نوع الفحص', type: 'select', value: query.checks || '', options: d.checks.map(c => ({ value: c.key, label: c.label })) },
      { name: 'overdue_only', label: '', type: 'checkbox', checkLabel: 'الفواتير المتأخرة فقط', value: query.overdue_only === '1' }
    ])}

    ${d.summary.length ? `<div class="card mb"><div class="card-head"><h3>📋 ملخص الفحوصات</h3></div>
      <div class="card-body flush">${tableHTML({
        columns: [
          { key: 'label', label: 'الفحص', render: r => `<div class="cell-main">${esc(r.label)}</div><div class="cell-sub">${esc(r.key)}</div>` },
          { key: 'severity', label: 'الأهمية', render: r => pill(r.severity) },
          { key: 'count', label: 'عدد الحالات', num: true, render: r => `<b>${int(r.count)}</b>` },
          { key: 'amount', label: 'المبلغ المتأثر', num: true, render: r => money(r.amount) }
        ], rows: d.summary, totals: { amount: d.summary.reduce((s, r) => s + Number(r.amount || 0), 0) }
      })}</div></div>` : ''}

    <div class="card">
      <div class="card-head"><h3>🔎 تفاصيل العمليات التي تحتاج مراجعة</h3><span class="hint">${int(d.items.length)} عملية</span></div>
      <div class="card-body flush">${tableHTML({
        columns: [
          { key: 'severity', label: 'الأهمية', render: r => pill(r.severity) },
          { key: 'category_label', label: 'التصنيف', render: r => `<span class="pill pill-muted plain">${esc(r.category_label)}</span>` },
          { key: 'entity_label', label: 'العملية', render: r => `<div class="cell-main">${esc(r.entity_label || '—')}</div><div class="cell-sub">${esc(r.entity_type)}</div>` },
          { key: 'reference', label: 'المرجع', render: r => `<span class="mono small">${esc(r.reference || '—')}</span>` },
          { key: 'date', label: 'التاريخ', render: r => fmtDate(r.date) },
          { key: 'amount', label: 'المبلغ', num: true, render: r => r.amount === null ? '—' : money(r.amount) },
          { key: 'party', label: 'الطرف', render: r => esc(r.party || '—') },
          { key: 'issue', label: 'الملاحظة', render: r => `<span class="small">${esc(r.issue || '')}</span>` },
          { key: 'act', label: '', render: r => {
              if (r.advance_id) return `<button class="btn btn-sm" data-adv="${r.advance_id}">العهدة</button>`;
              if (r.transfer_id) return `<button class="btn btn-sm" data-tr="${r.transfer_id}">التحويل</button>`;
              if (r.settlement_id) return `<button class="btn btn-sm" data-st="${r.settlement_id}">الإخلاء</button>`;
              if (r.invoice_id) return `<a class="btn btn-sm" href="#/supplier-invoices">الفاتورة</a>`;
              return '';
            } }
        ], rows: d.items, emptyText: '✅ لا توجد عمليات تحتاج مراجعة — كل العمليات مطابقة'
      })}</div>
    </div>`;

  document.querySelectorAll('[data-adv]').forEach(b => b.onclick = () => openAdvanceCard(Number(b.dataset.adv)));
  document.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => openTransferCard(Number(b.dataset.tr)));
  document.querySelectorAll('[data-st]').forEach(b => b.onclick = () => openSettlementCard(Number(b.dataset.st)));
  bindFilters(document.getElementById('view'), f => Router.go(`#/reconciliation${qs(f)}`));
  document.getElementById('btnXlsx').onclick = () => exportReport('unlinked', query);
});

/* ══════════════════════ سجل العمليات ══════════════════════ */
Router.register('/audit-logs', async ({ query, container }) => {
  await ensureMeta();
  const state = { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 30, ...query };
  const data = await Api.get('/audit-logs' + qs(state));
  const users = (Store.meta?.users) || [];
  container.innerHTML = `
    ${pageHead('سجل العمليات', 'كل إضافة وتعديل واعتماد وإلغاء — مع البيانات القديمة والجديدة', `
      ${Store.can('audit_logs.purge') ? '<button class="btn btn-danger" id="btnPurge">🗑 حذف سجلات قديمة</button>' : ''}`)}
    ${filtersBar('alFilters', [
      { name: 'search', label: 'بحث', placeholder: 'الوصف أو المستخدم', value: query.search || '' },
      { name: 'action', label: 'نوع العملية', type: 'select', value: query.action || '', options: ['create', 'update', 'approve', 'reject', 'review', 'void', 'close', 'reopen', 'login', 'logout', 'export', 'upload', 'over_settle'].map(a => ({ value: a, label: (STATUS_PILLS[a === 'void' ? 'void_action' : a] || [, a])[1] })) },
      { name: 'entity_type', label: 'الوحدة', type: 'select', value: query.entity_type || '', options: ['advance', 'transfer', 'settlement', 'supplier_invoice', 'payment', 'contractor', 'supplier', 'funding_source', 'user', 'role', 'settings', 'attachment', 'report'].map(e => ({ value: e, label: e })) },
      { name: 'date_from', label: 'من تاريخ', type: 'date', value: query.date_from || '' },
      { name: 'date_to', label: 'إلى تاريخ', type: 'date', value: query.date_to || '' }
    ])}
    <div class="card"><div class="card-body flush">${tableHTML({
      columns: [
        { key: 'created_at', label: 'التاريخ والوقت', render: r => `<span class="small mono">${fmtDateTime(r.created_at)}</span>` },
        { key: 'username', label: 'المستخدم', render: r => `<div class="cell-main">${esc(r.username || '—')}</div><div class="cell-sub">${esc(r.full_name || '')}</div>` },
        { key: 'action', label: 'العملية', render: r => pill(r.action === 'void' ? 'void_action' : r.action) },
        { key: 'entity_type', label: 'الوحدة', render: r => `<span class="pill pill-muted plain">${esc(r.entity_type)}</span>` },
        { key: 'entity_label', label: 'السجل', render: r => esc(r.entity_label || '—') },
        { key: 'summary', label: 'الوصف', render: r => `<span class="small">${esc(r.summary || '')}</span>` },
        { key: 'act', label: '', render: r => (r.old_values || r.new_values) ? `<button class="btn btn-sm" data-diff="${r.id}">التفاصيل</button>` : '' }
      ], rows: data.rows, emptyText: 'لا توجد سجلات'
    })}</div><div>${pagerHTML(data.pagination)}</div></div>`;

  bindTable(document.getElementById('view'), {
    onPage: p => Router.go(`#/audit-logs${qs({ ...state, page: p })}`),
    onPageSize: s => Router.go(`#/audit-logs${qs({ ...state, pageSize: s, page: 1 })}`)
  });
  bindFilters(document.getElementById('view'), f => Router.go(`#/audit-logs${qs({ ...f, page: 1, pageSize: state.pageSize })}`));
  document.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => {
    const row = data.rows.find(r => r.id === Number(b.dataset.diff));
    let oldV = {}, newV = {};
    try { oldV = JSON.parse(row.old_values || '{}'); } catch { /* ignore */ }
    try { newV = JSON.parse(row.new_values || '{}'); } catch { /* ignore */ }
    const keys = Array.from(new Set([...Object.keys(oldV), ...Object.keys(newV)]));
    modal({
      title: `تفاصيل العملية — ${row.summary || ''}`, size: 'wide',
      body: tableHTML({
        columns: [{ key: 'k', label: 'الحقل' }, { key: 'o', label: 'القيمة القديمة' }, { key: 'n', label: 'القيمة الجديدة' }],
        rows: keys.map(k => ({
          k, o: fmtVal(oldV[k]), n: fmtVal(newV[k]),
          changed: JSON.stringify(oldV[k]) !== JSON.stringify(newV[k])
        })).filter(r => r.changed),
        emptyText: 'لا توجد تغييرات'
      }) + `<div class="small muted mt">المستخدم: ${esc(row.username || '')} · ${fmtDateTime(row.created_at)} · IP: ${esc(row.ip || '—')}</div>`,
      buttons: [{ label: 'إغلاق' }]
    });
  });
  document.getElementById('btnPurge')?.addEventListener('click', async () => {
    const m = modal({
      title: 'حذف سجلات قديمة', size: 'narrow',
      body: `<div class="alert danger">⚠ هذا إجراء حساس يخص مدير النظام فقط. السجلات المحاسبية لا تُحذف نهائيًا — يُفضَّل استخدام الإلغاء.</div>
        ${formHTML([{ name: 'before_date', label: 'حذف السجلات قبل تاريخ', type: 'date', required: true, value: '' }])}`,
      buttons: [{ label: 'حذف', cls: 'btn-danger', onClick: async (el) => {
          const v = readForm(el);
          if (!v.before_date) { toast('حدد التاريخ', 'err'); return; }
          const c = await confirmDialog({ title: 'تأكيد نهائي', message: `سيتم حذف كل السجلات قبل ${v.before_date} نهائيًا.`, danger: true, confirmLabel: 'حذف نهائي' });
          if (!c.ok) return;
          try { const r = await Api.post('/audit-logs/purge', { before_date: v.before_date }); closeModal(el); toast(`تم حذف ${r.deleted} سجل`, 'ok'); Router.resolve(); }
          catch (e) { toast(e.message, 'err'); }
        } }, { label: 'إلغاء' }]
    });
  });
});

function fmtVal(v) {
  if (v === null || v === undefined) return '<span class="muted">—</span>';
  if (typeof v === 'object') return `<code class="small">${esc(JSON.stringify(v))}</code>`;
  return esc(String(v));
}

/* ══════════════════════ إعدادات النظام ══════════════════════ */
Router.register('/admin', async ({ query, container }) => {
  await ensureMeta();
  const tab = query.tab || 'projects';
  container.innerHTML = `
    ${pageHead('إعدادات النظام', 'المشاريع ومراكز التكلفة ودليل الحسابات والمستخدمون والصلاحيات')}
    <div class="tabs">
      ${[['projects', 'المشاريع ومراكز التكلفة'], ['accounts', 'دليل الحسابات'], ['users', 'المستخدمون'], ['roles', 'الأدوار والصلاحيات'], ['settings', 'إعدادات عامة']]
        .map(([k, l]) => `<div class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${l}</div>`).join('')}
    </div>
    <div id="adminPane"><div class="spinner"></div></div>`;

  const pane = document.getElementById('adminPane');
  const load = async () => {
    pane.innerHTML = '<div class="spinner"></div>';
    if (tab === 'projects') pane.innerHTML = await adminProjects();
    else if (tab === 'accounts') pane.innerHTML = await adminAccounts();
    else if (tab === 'users') pane.innerHTML = await adminUsers();
    else if (tab === 'roles') pane.innerHTML = await adminRoles();
    else if (tab === 'settings') pane.innerHTML = await adminSettings();
    bindAdminActions(tab);
  };
  await load();
  container.querySelectorAll('.tab').forEach(t => t.onclick = () => Router.go(`#/admin?tab=${t.dataset.tab}`));
});

async function adminProjects() {
  const projects = await Api.get('/projects');
  const ccs = await Api.get('/cost-centers');
  return `
    <div class="card mb"><div class="card-head"><h3>🏗 المشاريع</h3><div class="spacer"></div>
      ${Store.can('settings.update') ? '<button class="btn btn-sm btn-primary" data-newproject>＋ مشروع</button>' : ''}</div>
      <div class="card-body flush">${tableHTML({
        columns: [
          { key: 'code', label: 'الرمز', render: r => `<span class="mono">${esc(r.code)}</span>` },
          { key: 'name', label: 'الاسم', render: r => `<div class="cell-main">${esc(r.name)}</div><div class="cell-sub">${esc(r.description || '')}</div>` },
          { key: 'is_default', label: 'الافتراضي', render: r => r.is_default ? '<span class="pill pill-ok">نعم</span>' : '—' },
          { key: 'cost_centers_count', label: 'مراكز التكلفة', num: true, render: r => int(r.cost_centers_count) },
          { key: 'advances_count', label: 'العهد', num: true, render: r => int(r.advances_count) }
        ], rows: projects
      })}</div></div>
    <div class="card"><div class="card-head"><h3>🎯 مراكز التكلفة</h3><div class="spacer"></div>
      ${Store.can('settings.update') ? '<button class="btn btn-sm btn-primary" data-newcc>＋ مركز تكلفة</button>' : ''}</div>
      <div class="card-body flush">${tableHTML({
        columns: [
          { key: 'code', label: 'الرمز', render: r => `<span class="mono">${esc(r.code)}</span>` },
          { key: 'name', label: 'الاسم' },
          { key: 'project_name', label: 'المشروع' },
          { key: 'parent_name', label: 'المركز الأب', render: r => esc(r.parent_name || '—') },
          { key: 'is_main', label: 'رئيسي', render: r => r.is_main ? '<span class="pill pill-brand">رئيسي</span>' : '—' }
        ], rows: ccs
      })}</div></div>`;
}

async function adminAccounts() {
  const accounts = await Api.get('/accounts');
  const types = { asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات' };
  return `<div class="card"><div class="card-head"><h3>📚 دليل الحسابات</h3>
    <span class="hint">الحسابات النظامية لا تُحذف وتُستخدم في توليد القيود تلقائيًا</span><div class="spacer"></div>
    ${Store.can('accounts.manage') ? '<button class="btn btn-sm btn-primary" data-newacc>＋ حساب</button>' : ''}</div>
    <div class="card-body flush">${tableHTML({
      columns: [
        { key: 'code', label: 'الرمز', render: r => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'name', label: 'الاسم', render: r => `<div class="cell-main">${esc(r.name)}</div><div class="cell-sub">${esc(r.parent_name || '')}</div>` },
        { key: 'type', label: 'النوع', render: r => `<span class="pill pill-brand plain">${types[r.type] || r.type}</span>` },
        { key: 'nature', label: 'الطبيعة', render: r => r.nature === 'debit' ? 'مدين' : 'دائن' },
        { key: 'is_system', label: 'نظامي', render: r => r.is_system ? '<span class="pill pill-muted plain">نظامي</span>' : '' }
      ], rows: accounts
    })}</div></div>`;
}

async function adminUsers() {
  const users = await Api.get('/users');
  const roles = await Api.get('/roles');
  return `<div class="card"><div class="card-head"><h3>👥 المستخدمون</h3><div class="spacer"></div>
    ${Store.can('users.create') ? '<button class="btn btn-sm btn-primary" data-newuser>＋ مستخدم</button>' : ''}</div>
    <div class="card-body flush">${tableHTML({
      columns: [
        { key: 'username', label: 'اسم المستخدم', render: r => `<span class="mono">${esc(r.username)}</span>` },
        { key: 'full_name', label: 'الاسم' },
        { key: 'role_name', label: 'الدور', render: r => `<span class="pill pill-brand plain">${esc(r.role_name)}</span>` },
        { key: 'is_active', label: 'الحالة', render: r => r.is_active ? '<span class="pill pill-ok">نشط</span>' : '<span class="pill pill-muted">موقوف</span>' },
        { key: 'last_login_at', label: 'آخر دخول', render: r => r.last_login_at ? fmtDateTime(r.last_login_at) : '—' },
        { key: 'act', label: '', render: r => Store.can('users.update') ? `<div class="row-actions">
            <button class="btn btn-sm" data-edituser="${r.id}">تعديل</button>
            <button class="btn btn-sm btn-ghost" data-resetpw="${r.id}">إعادة كلمة المرور</button></div>` : '' }
      ], rows: users
    })}</div></div>`;
}

async function adminRoles() {
  const roles = await Api.get('/roles');
  const { permissions, modules } = await Api.get('/permissions');
  const byModule = {};
  permissions.forEach(p => { (byModule[p.module] = byModule[p.module] || []).push(p); });
  return roles.map(role => `
    <div class="card mb"><div class="card-head"><h3>${esc(role.name)}</h3>
      <span class="hint">${esc(role.description || '')}</span><div class="spacer"></div>
      <span class="pill pill-brand plain">${role.permissions.length} صلاحية</span></div>
      <div class="card-body">
        ${Object.entries(byModule).map(([mod, perms]) => `
          <div style="margin-bottom:12px;">
            <div class="small" style="font-weight:800;color:var(--brand-600);margin-bottom:5px;">${esc(modules[mod] || mod)}</div>
            <div class="flex" style="gap:6px;">
              ${perms.map(p => `<label style="display:flex;gap:5px;align-items:center;font-size:12px;background:var(--bg-soft);border:1px solid var(--border);padding:4px 9px;border-radius:7px;">
                <input type="checkbox" style="width:auto" data-perm="${esc(p.code)}" data-role="${role.id}" ${role.permissions.includes(p.code) ? 'checked' : ''} ${!Store.can('users.roles') ? 'disabled' : ''}> ${esc(p.name)}</label>`).join('')}
            </div>
          </div>`).join('')}
        ${Store.can('users.roles') ? `<button class="btn btn-primary btn-sm" data-saverole="${role.id}">حفظ صلاحيات الدور</button>` : ''}
      </div></div>`).join('');
}

async function adminSettings() {
  const s = await Api.get('/settings');
  return `<div class="card" style="max-width:620px"><div class="card-head"><h3>⚙️ إعدادات عامة</h3></div>
    <div class="card-body">${formHTML([
      { name: 'company_name', label: 'اسم الجهة / المشروع', value: s.company_name || '' },
      { name: 'currency', label: 'رمز العملة', value: s.currency || 'SAR' },
      { name: 'currency_label', label: 'اسم العملة', value: s.currency_label || 'ريال' },
      { name: 'default_vat_rate', label: 'نسبة ضريبة القيمة المضافة', value: s.default_vat_rate || '0.15' },
      { name: 'fiscal_year_start', label: 'بداية السنة المالية', type: 'date', value: s.fiscal_year_start || '' }
    ])}
    ${Store.can('settings.update') ? '<button class="btn btn-primary mt" data-savesettings>حفظ الإعدادات</button>' : ''}
    </div></div>`;
}

function bindAdminActions(tab) {
  const view = document.getElementById('view');
  view.querySelector('[data-newproject]')?.addEventListener('click', () => {
    modal({ title: 'مشروع جديد', size: 'narrow',
      body: formHTML([{ name: 'code', label: 'رمز المشروع', required: true }, { name: 'name', label: 'اسم المشروع', required: true }, { name: 'description', label: 'الوصف', type: 'textarea' }]),
      buttons: [{ label: 'حفظ', cls: 'btn-primary', onClick: async (el) => {
        try { await Api.post('/projects', readForm(el)); closeModal(el); toast('تمت الإضافة', 'ok'); Store.meta = null; Router.resolve(); } catch (e) { toast(e.message, 'err'); }
      } }, { label: 'إلغاء' }] });
  });
  view.querySelector('[data-newcc]')?.addEventListener('click', () => {
    modal({ title: 'مركز تكلفة جديد', size: 'narrow',
      body: formHTML([
        { name: 'project_id', label: 'المشروع', type: 'select', required: true, value: defaultProjectId(), options: projectOptions(false) },
        { name: 'code', label: 'الرمز', required: true }, { name: 'name', label: 'الاسم', required: true },
        { name: 'parent_id', label: 'المركز الأب', type: 'select', value: '', options: [{ value: '', label: '— بدون —' }, ...(Store.meta?.cost_centers || []).map(c => ({ value: c.id, label: c.name }))] }
      ]),
      buttons: [{ label: 'حفظ', cls: 'btn-primary', onClick: async (el) => {
        try { await Api.post('/cost-centers', readForm(el)); closeModal(el); toast('تمت الإضافة', 'ok'); Store.meta = null; Router.resolve(); } catch (e) { toast(e.message, 'err'); }
      } }, { label: 'إلغاء' }] });
  });
  view.querySelector('[data-newacc]')?.addEventListener('click', () => {
    modal({ title: 'حساب جديد', size: 'narrow',
      body: formHTML([
        { name: 'code', label: 'رمز الحساب', required: true }, { name: 'name', label: 'اسم الحساب', required: true },
        { name: 'type', label: 'النوع', type: 'select', required: true, value: 'expense', options: [{ value: 'asset', label: 'أصول' }, { value: 'liability', label: 'التزامات' }, { value: 'equity', label: 'حقوق ملكية' }, { value: 'income', label: 'إيرادات' }, { value: 'expense', label: 'مصروفات' }] },
        { name: 'nature', label: 'الطبيعة', type: 'select', value: 'debit', options: [{ value: 'debit', label: 'مدين' }, { value: 'credit', label: 'دائن' }] }
      ]),
      buttons: [{ label: 'حفظ', cls: 'btn-primary', onClick: async (el) => {
        try { await Api.post('/accounts', readForm(el)); closeModal(el); toast('تمت الإضافة', 'ok'); Store.meta = null; Router.resolve(); } catch (e) { toast(e.message, 'err'); }
      } }, { label: 'إلغاء' }] });
  });
  view.querySelector('[data-newuser]')?.addEventListener('click', async () => {
    const roles = await Api.get('/roles');
    modal({ title: 'مستخدم جديد', size: 'narrow',
      body: formHTML([
        { name: 'username', label: 'اسم المستخدم', required: true, help: 'أحرف إنجليزية صغيرة وأرقام' },
        { name: 'full_name', label: 'الاسم الكامل', required: true },
        { name: 'password', label: 'كلمة المرور', type: 'password', required: true, help: '8 أحرف على الأقل' },
        { name: 'role_id', label: 'الدور', type: 'select', required: true, options: roles.map(r => ({ value: r.id, label: r.name })) },
        { name: 'email', label: 'البريد الإلكتروني' }, { name: 'phone', label: 'الجوال' }
      ]),
      buttons: [{ label: 'حفظ', cls: 'btn-primary', onClick: async (el) => {
        try { await Api.post('/users', readForm(el)); closeModal(el); toast('تمت إضافة المستخدم', 'ok'); Router.resolve(); } catch (e) { toast(e.message, 'err'); }
      } }, { label: 'إلغاء' }] });
  });
  view.querySelectorAll('[data-resetpw]').forEach(b => b.onclick = () => {
    modal({ title: 'إعادة تعيين كلمة المرور', size: 'narrow',
      body: formHTML([{ name: 'new_password', label: 'كلمة المرور الجديدة', type: 'password', required: true, help: 'سيُطلب من المستخدم تغييرها عند أول دخول' }]),
      buttons: [{ label: 'تعيين', cls: 'btn-primary', onClick: async (el) => {
        try { await Api.post(`/users/${b.dataset.resetpw}/reset-password`, readForm(el)); closeModal(el); toast('تم التعيين', 'ok'); } catch (e) { toast(e.message, 'err'); }
      } }, { label: 'إلغاء' }] });
  });
  view.querySelectorAll('[data-edituser]').forEach(b => b.onclick = async () => {
    const [users, roles] = await Promise.all([Api.get('/users'), Api.get('/roles')]);
    const u = users.find(x => x.id === Number(b.dataset.edituser));
    modal({ title: `تعديل المستخدم ${u.username}`, size: 'narrow',
      body: formHTML([
        { name: 'full_name', label: 'الاسم الكامل', value: u.full_name },
        { name: 'role_id', label: 'الدور', type: 'select', value: u.role_id, options: roles.map(r => ({ value: r.id, label: r.name })) },
        { name: 'email', label: 'البريد الإلكتروني', value: u.email || '' },
        { name: 'phone', label: 'الجوال', value: u.phone || '' },
        { name: 'is_active', type: 'checkbox', checkLabel: 'نشط', value: !!u.is_active }
      ]),
      buttons: [{ label: 'حفظ', cls: 'btn-primary', onClick: async (el) => {
        try { await Api.put(`/users/${u.id}`, readForm(el)); closeModal(el); toast('تم الحفظ', 'ok'); Router.resolve(); } catch (e) { toast(e.message, 'err'); }
      } }, { label: 'إلغاء' }] });
  });
  view.querySelectorAll('[data-saverole]').forEach(b => b.onclick = async () => {
    const roleId = Number(b.dataset.saverole);
    const perms = Array.from(view.querySelectorAll(`[data-perm][data-role="${roleId}"]:checked`)).map(x => x.dataset.perm);
    try { await Api.put(`/roles/${roleId}/permissions`, { permissions: perms }); toast('تم حفظ الصلاحيات', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
  view.querySelector('[data-savesettings]')?.addEventListener('click', async () => {
    try { await Api.put('/settings', readForm(view)); toast('تم حفظ الإعدادات', 'ok'); } catch (e) { toast(e.message, 'err'); }
  });
}

/* ══════════════════════ 404 ══════════════════════ */
Router.register('/404', ({ container }) => {
  container.innerHTML = `<div class="card"><div class="card-body" style="text-align:center;padding:60px;">
    <div style="font-size:44px">🧭</div><h2>الصفحة غير موجودة</h2>
    <p class="muted">تحقق من الرابط أو عد إلى لوحة التحكم.</p>
    <a class="btn btn-primary" href="#/dashboard">العودة للوحة التحكم</a></div></div>`;
});
