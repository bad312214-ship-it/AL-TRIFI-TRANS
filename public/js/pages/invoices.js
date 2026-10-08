/* ═══════════════════════════════════════════════════════════════
   فواتير الموردين · الدفعات
   ═══════════════════════════════════════════════════════════════ */
'use strict';

Router.register('/supplier-invoices', async ({ query, container }) => {
  await ensureMeta();
  const sups = await suppliers();
  const state = { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20, sort: query.sort || 'i.invoice_date', dir: query.dir || 'desc', ...query };
  const data = await Api.get('/supplier-invoices' + qs(state));
  const totals = data.rows.reduce((a, r) => {
    a.total_amount += Number(r.total_amount || 0); a.paid_total += Number(r.paid_total || 0);
    a.remaining_total += Number(r.remaining_total || 0); a.vat_amount += Number(r.vat_amount || 0); return a;
  }, { total_amount: 0, paid_total: 0, remaining_total: 0, vat_amount: 0 });

  container.innerHTML = `
    ${pageHead('فواتير الموردين', 'المدفوع يُحتسب من الدفعات المرتبطة بالتحويلات', `
      ${Store.can('supplier_invoices.create') ? '<button class="btn btn-primary" id="btnNew">＋ فاتورة جديدة</button>' : ''}
      ${Store.can('payments.create') ? '<button class="btn" id="btnPay">💵 تسجيل دفعة</button>' : ''}
      <button class="btn" id="btnExport">⬇ Excel</button>`)}
    <div class="kpi-grid">
      ${kpiCard({ label: 'إجمالي الفواتير', value: money(totals.total_amount), icon: '📄', color: '#0891b2' })}
      ${kpiCard({ label: 'ضريبة القيمة المضافة', value: money(totals.vat_amount), icon: '🧾', color: '#6d28d9' })}
      ${kpiCard({ label: 'المدفوع', value: money(totals.paid_total), icon: '✅', color: '#15803d' })}
      ${kpiCard({ label: 'المتبقي', value: money(totals.remaining_total), icon: '⏳', color: '#b91c1c' })}
    </div>
    ${filtersBar('invFilters', [
      { name: 'search', label: 'بحث', placeholder: 'رقم الفاتورة، المورد، الوصف', value: query.search || '' },
      { name: 'supplier_id', label: 'المورد', type: 'select', placeholder: 'الكل', value: query.supplier_id || '', options: sups.map(s => ({ value: s.id, label: s.name })) },
      { name: 'project_id', label: 'المشروع', type: 'select', value: query.project_id || '', options: projectOptions() },
      { name: 'status', label: 'حالة السداد', type: 'select', value: query.status || '', options: [{ value: 'unpaid', label: 'غير مدفوعة' }, { value: 'partial', label: 'مدفوعة جزئيًا' }, { value: 'paid', label: 'مدفوعة بالكامل' }] },
      { name: 'approval_status', label: 'الاعتماد', type: 'select', value: query.approval_status || '', options: [{ value: 'draft', label: 'مسودة' }, { value: 'pending', label: 'بانتظار الاعتماد' }, { value: 'approved', label: 'معتمدة' }] },
      { name: 'date_from', label: 'من تاريخ', type: 'date', value: query.date_from || '' },
      { name: 'date_to', label: 'إلى تاريخ', type: 'date', value: query.date_to || '' },
      { name: 'overdue_only', label: '', type: 'checkbox', checkLabel: 'المتأخرة فقط', value: query.overdue_only === '1' }
    ], { open: !!query.search })}
    <div class="card"><div class="card-body flush" id="invTable"></div><div id="invPager"></div></div>`;

  const cols = [
    { key: 'invoice_no', label: 'رقم الفاتورة', sortable: true, render: r => `<div class="cell-main">${esc(r.invoice_no)}</div><div class="cell-sub">${fmtDate(r.invoice_date)}</div>` },
    { key: 'supplier_name', label: 'المورد', render: r => `<div class="cell-main">${esc(r.supplier_name || '—')}</div><div class="cell-sub">${esc(r.supplier_code || '')}</div>` },
    { key: 'description', label: 'الوصف', render: r => esc((r.description || '').slice(0, 34)) },
    { key: 'net_amount', label: 'قبل الضريبة', num: true, render: r => money(r.net_amount) },
    { key: 'vat_amount', label: 'الضريبة', num: true, render: r => money(r.vat_amount) },
    { key: 'total_amount', label: 'الإجمالي', num: true, sortable: true, render: r => `<b>${money(r.total_amount)}</b>` },
    { key: 'paid_total', label: 'المدفوع', num: true, render: r => money(r.paid_total) },
    { key: 'remaining_total', label: 'المتبقي', num: true, sortable: true, render: r => `<b style="color:${Number(r.remaining_total) > 0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(r.remaining_total)}</b>` },
    { key: 'due_date', label: 'الاستحقاق', sortable: true, render: r => r.due_date ? `<span class="${r.is_overdue ? 'pill pill-danger plain' : ''}">${fmtDate(r.due_date)}</span>` : '—' },
    { key: 'status', label: 'الحالة', render: r => pill(r.status) },
    { key: 'act', label: '', render: r => `<div class="row-actions"><button class="btn btn-sm" data-view="${r.id}">عرض</button>${Store.can('payments.create') && Number(r.remaining_total) > 0.005 ? `<button class="btn btn-sm btn-success" data-pay="${r.id}">دفعة</button>` : ''}</div>` }
  ];
  const el = document.getElementById('invTable');
  el.innerHTML = tableHTML({ columns: cols, rows: data.rows, totals, onRowClick: i => openInvoiceCard(data.rows[i].id), emptyText: 'لا توجد فواتير موردين' });
  document.getElementById('invPager').innerHTML = pagerHTML(data.pagination);
  bindTable(document.getElementById('view'), {
    onRowClick: i => openInvoiceCard(data.rows[i].id),
    onSort: k => Router.go(`#/supplier-invoices${qs({ ...state, sort: k, dir: state.sort === k && state.dir === 'asc' ? 'desc' : 'asc', page: 1 })}`),
    onPage: p => Router.go(`#/supplier-invoices${qs({ ...state, page: p })}`),
    onPageSize: s => Router.go(`#/supplier-invoices${qs({ ...state, pageSize: s, page: 1 })}`)
  });
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = e => { e.stopPropagation(); openInvoiceCard(Number(b.dataset.view)); });
  el.querySelectorAll('[data-pay]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    const inv = data.rows.find(r => r.id === Number(b.dataset.pay));
    paymentForm({ supplier_invoice_id: inv.id, supplier_id: inv.supplier_id, invoice_no: inv.invoice_no, remaining: inv.remaining_total, project_id: inv.project_id }, () => Router.resolve());
  });
  bindFilters(document.getElementById('view'), f => Router.go(`#/supplier-invoices${qs({ ...f, page: 1, pageSize: state.pageSize })}`));
  document.getElementById('btnExport')?.addEventListener('click', () => exportReport('suppliers', state));
  document.getElementById('btnNew')?.addEventListener('click', () => invoiceForm(null, sups, () => Router.resolve()));
  document.getElementById('btnPay')?.addEventListener('click', () => paymentForm({}, () => Router.resolve()));
});

async function invoiceForm(existing, sups, onSaved) {
  const meta = await ensureMeta();
  const v = existing ? (existing.invoice || existing) : {};
  const m = modal({
    title: existing ? `تعديل الفاتورة ${v.invoice_no}` : 'فاتورة مورد جديدة', size: 'wide',
    body: formHTML([
      { type: 'section', label: 'بيانات الفاتورة' },
      { name: 'supplier_id', label: 'المورد', type: 'select', required: true, value: v.supplier_id || '', placeholder: '— اختر المورد —', options: sups.map(s => ({ value: s.id, label: `${s.name} (${s.code})` })) },
      { name: 'invoice_no', label: 'رقم الفاتورة', required: true, value: v.invoice_no || '', help: 'لا يمكن تكراره لنفس المورد' },
      { name: 'invoice_date', label: 'تاريخ الفاتورة', type: 'date', required: true, value: v.invoice_date || today() },
      { name: 'due_date', label: 'تاريخ الاستحقاق', type: 'date', value: v.due_date || '' },
      { name: 'description', label: 'وصف الفاتورة', type: 'textarea', required: true, value: v.description || '' },
      { type: 'section', label: 'المبالغ' },
      { name: 'net_amount', label: 'القيمة قبل الضريبة', type: 'number', required: true, step: '0.01', min: '0', value: v.net_amount || '' },
      { name: 'vat_amount', label: 'ضريبة القيمة المضافة', type: 'number', step: '0.01', min: '0', value: v.vat_amount || 0 },
      { name: 'total_amount', label: 'الإجمالي', type: 'number', step: '0.01', readonly: true, value: v.total_amount || '' },
      { type: 'section', label: 'التصنيف المحاسبي' },
      { name: 'project_id', label: 'المشروع', type: 'select', required: true, value: v.project_id || defaultProjectId(), options: projectOptions(false) },
      { name: 'cost_center_id', label: 'مركز التكلفة', type: 'select', value: v.cost_center_id || '', options: costCenterOptions(v.project_id || defaultProjectId()) },
      { name: 'account_id', label: 'الحساب المحاسبي', type: 'select', value: v.account_id || '', options: accountOptions() },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', value: v.notes || '' },
      { name: 'auto_approve', type: 'checkbox', checkLabel: 'اعتماد الفاتورة مباشرة (يُنشئ القيد المحاسبي)', value: false }
    ]),
    buttons: [
      { label: existing ? 'حفظ التعديلات' : 'إنشاء الفاتورة', cls: 'btn-primary', onClick: async (el) => {
          clearFieldErrors(el);
          const payload = readForm(el);
          if (payload.auto_approve && !Store.can('supplier_invoices.approve')) { toast('ليست لديك صلاحية الاعتماد', 'err'); return; }
          try {
            const saved = existing ? await Api.put(`/supplier-invoices/${v.id}`, payload) : await Api.post('/supplier-invoices', payload);
            closeModal(el); toast(existing ? 'تم تحديث الفاتورة' : `تم إنشاء الفاتورة ${saved.invoice_no}`, 'ok'); refreshBadges(); onSaved && onSaved(saved);
          } catch (err) { handleFormError(el, err); }
        } },
      { label: 'إلغاء' }
    ]
  });
  const net = m.querySelector('[name=net_amount]'), vat = m.querySelector('[name=vat_amount]'), total = m.querySelector('[name=total_amount]');
  const recalc = () => { total.value = (Math.round((Number(net.value || 0) + Number(vat.value || 0)) * 100) / 100).toFixed(2); };
  net.oninput = () => { if (!vat.dataset.touched) vat.value = (Math.round(Number(net.value || 0) * 0.15 * 100) / 100).toFixed(2); recalc(); };
  vat.oninput = () => { vat.dataset.touched = '1'; recalc(); };
  m.querySelector('[name=project_id]').onchange = e => {
    m.querySelector('[name=cost_center_id]').innerHTML = costCenterOptions(e.target.value).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  };
  if (v.net_amount) recalc();
}

async function openInvoiceCard(id) {
  const d = await Api.get(`/supplier-invoices/${id}`);
  const i = d.invoice;
  const m = modal({
    title: `فاتورة المورد ${i.invoice_no}`, subtitle: i.supplier_name || '', size: 'wide',
    body: `
      <div class="balance-strip">
        <div class="bs"><div class="k">إجمالي الفاتورة</div><div class="v">${money(i.total_amount)}</div></div>
        <div class="bs"><div class="k">المدفوع</div><div class="v" style="color:var(--ok)">${money(i.paid_total)}</div></div>
        <div class="bs hi"><div class="k">المتبقي</div><div class="v" style="color:${Number(i.remaining_total) > 0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(i.remaining_total)}</div></div>
        <div class="bs"><div class="k">الحالة</div><div class="v" style="font-size:14px">${pill(i.status)}</div></div>
      </div>
      <div class="tabs"><div class="tab active" data-tab="info">التفاصيل</div>
        <div class="tab" data-tab="pays">الدفعات (${d.payments.length})</div>
        <div class="tab" data-tab="files">المرفقات (${d.attachments.length})</div>
        <div class="tab" data-tab="audit">السجل</div></div>
      <div data-pane="info"><div class="detail-grid">
        ${dItem('المورد', `${esc(i.supplier_name || '—')} <span class="muted small">(${esc(i.supplier_code || '')})</span>`)}
        ${dItem('رقم الفاتورة', esc(i.invoice_no))}${dItem('تاريخ الفاتورة', fmtDate(i.invoice_date))}
        ${dItem('تاريخ الاستحقاق', i.due_date ? `${fmtDate(i.due_date)}${i.is_overdue ? ' <span class="pill pill-danger">متأخرة</span>' : ''}` : '—')}
        ${dItem('الوصف', esc(i.description))}
        ${dItem('قبل الضريبة', money(i.net_amount))}${dItem('ضريبة القيمة المضافة', money(i.vat_amount))}
        ${dItem('الإجمالي', `<b class="money">${money(i.total_amount)} ${CUR}</b>`)}
        ${dItem('الحساب المحاسبي', esc(i.account_name ? `${i.account_code} — ${i.account_name}` : '—'))}
        ${dItem('المشروع', esc(i.project_name || '—'))}${dItem('مركز التكلفة', esc(i.cost_center_name || '—'))}
        ${dItem('الاعتماد', pill(i.approval_status))}${dItem('أنشأها', esc(i.created_by_name || '—'))}
        ${dItem('اعتمدها', esc(i.approved_by_name || '—'))}${dItem('ملاحظات', esc(i.notes || '—'))}
      </div></div>
      <div data-pane="pays" style="display:none">
        <div class="flex mb">${Store.can('payments.create') && Number(i.remaining_total) > 0.005 ? `<button class="btn btn-primary btn-sm" id="btnPay2">💵 تسجيل دفعة</button>` : ''}</div>
        ${tableHTML({
          columns: [
            { key: 'payment_no', label: 'رقم الدفعة' }, { key: 'payment_date', label: 'التاريخ', render: r => fmtDate(r.payment_date) },
            { key: 'amount', label: 'المبلغ', num: true, render: r => `<b>${money(r.amount)}</b>` },
            { key: 'transfer_no', label: 'التحويل', render: r => r.transfer_no ? esc(r.transfer_no) : '<span class="pill pill-warn">بدون تحويل</span>' },
            { key: 'funding_source_name', label: 'مصدر التمويل', render: r => esc(r.funding_source_name || '—') }
          ], rows: d.payments, totals: { amount: d.payments.reduce((s, r) => s + Number(r.amount || 0), 0) }, emptyText: 'لا توجد دفعات'
        })}
      </div>
      <div data-pane="files" style="display:none">${filesHTML(d.attachments, 'supplier_invoice', i.id)}${Store.can('attachments.upload') ? uploadHTML('supplier_invoice', i.id) : ''}</div>
      <div data-pane="audit" style="display:none"><div class="timeline">${d.audit_trail.map(l => `
        <div class="tl-item"><div class="tl-t">${pill(l.action === 'void' ? 'void_action' : l.action)} ${esc(l.summary || '')}</div>
        <div class="tl-m">${esc(l.username || '')} · ${fmtDateTime(l.created_at)}</div></div>`).join('') || '<div class="muted small">لا يوجد سجل</div>'}</div></div>`,
    buttons: [
      ...(Store.can('supplier_invoices.update') && !i.is_void && i.paid_total == 0 && i.approval_status !== 'approved'
        ? [{ label: '✎ تعديل', onClick: async () => { closeModal(m); invoiceForm({ invoice: i }, await suppliers(), () => Router.resolve()); } }] : []),
      ...(Store.can('supplier_invoices.approve') && !i.is_void && i.approval_status !== 'approved'
        ? [{ label: '✓ اعتماد', cls: 'btn-success', onClick: async () => {
            try { await Api.post(`/supplier-invoices/${i.id}/approve`); toast('تم اعتماد الفاتورة', 'ok'); closeModal(m); Router.resolve(); } catch (e) { toast(e.message, 'err'); }
          } }] : []),
      ...(Store.can('supplier_invoices.void') && !i.is_void
        ? [{ label: '⊘ إلغاء', cls: 'btn-danger', onClick: async () => {
            const r = await confirmDialog({ title: 'إلغاء الفاتورة', message: `سيتم إلغاء الفاتورة ${i.invoice_no}.`, requireReason: true, reasonLabel: 'السبب', danger: true, confirmLabel: 'إلغاء' });
            if (!r.ok) return;
            try { await Api.post(`/supplier-invoices/${i.id}/void`, { reason: r.reason }); toast('تم الإلغاء', 'ok'); closeModal(m); Router.resolve(); } catch (e) { toast(e.message, 'err'); }
          } }] : []),
      { label: 'إغلاق' }
    ]
  });
  bindTabs(m); bindUpload(m, () => openInvoiceCard(id));
  m.querySelector('#btnPay2')?.addEventListener('click', () => paymentForm({
    supplier_invoice_id: i.id, supplier_id: i.supplier_id, invoice_no: i.invoice_no,
    remaining: i.remaining_total, project_id: i.project_id
  }, () => { closeModal(m); Router.resolve(); }));
}

/* ══════════════════════ الدفعات ══════════════════════ */
Router.register('/payments', async ({ query, container }) => {
  await ensureMeta();
  const state = { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20, ...query };
  const data = await Api.get('/payments' + qs(state));
  const total = data.rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  container.innerHTML = `
    ${pageHead('الدفعات', 'ربط الدفعات بالتحويلات وفواتير الموردين', `
      ${Store.can('payments.create') ? '<button class="btn btn-primary" id="btnNew">＋ دفعة جديدة</button>' : ''}`)}
    <div class="kpi-grid">
      ${kpiCard({ label: 'إجمالي الدفعات', value: money(total), icon: '🏦', color: '#15803d' })}
      ${kpiCard({ label: 'عدد الدفعات', value: int(data.pagination.total), icon: '#', color: '#1d4ed8', unit: '' })}
    </div>
    ${filtersBar('payFilters', [
      { name: 'search', label: 'بحث', placeholder: 'رقم الدفعة، الفاتورة، التحويل', value: query.search || '' },
      { name: 'payment_type', label: 'نوع الدفعة', type: 'select', value: query.payment_type || '', options: [{ value: 'supplier_invoice', label: 'سداد فاتورة مورد' }, { value: 'advance', label: 'دفعة على عهدة' }, { value: 'advance_payment', label: 'دفعة مقدمة' }, { value: 'other', label: 'أخرى' }] },
      { name: 'project_id', label: 'المشروع', type: 'select', value: query.project_id || '', options: projectOptions() },
      { name: 'date_from', label: 'من تاريخ', type: 'date', value: query.date_from || '' },
      { name: 'date_to', label: 'إلى تاريخ', type: 'date', value: query.date_to || '' }
    ])}
    <div class="card"><div class="card-body flush">${tableHTML({
      columns: [
        { key: 'payment_no', label: 'رقم الدفعة', render: r => `<div class="cell-main">${esc(r.payment_no)}</div><div class="cell-sub">${fmtDate(r.payment_date)}</div>` },
        { key: 'amount', label: 'المبلغ', num: true, render: r => `<b>${money(r.amount)}</b>` },
        { key: 'payment_type', label: 'النوع', render: r => pill(r.payment_type) },
        { key: 'supplier_name', label: 'المورد', render: r => esc(r.supplier_name || '—') },
        { key: 'contractor_name', label: 'المقاول', render: r => esc(r.contractor_name || '—') },
        { key: 'invoice_no', label: 'الفاتورة', render: r => r.invoice_no ? esc(r.invoice_no) : '—' },
        { key: 'advance_no', label: 'العهدة', render: r => r.advance_no ? esc(r.advance_no) : '—' },
        { key: 'transfer_no', label: 'التحويل', render: r => r.transfer_no ? esc(r.transfer_no) : '<span class="pill pill-warn">بدون تحويل</span>' },
        { key: 'funding_source_name', label: 'مصدر التمويل', render: r => esc(r.funding_source_name || '—') },
        { key: 'act', label: '', render: r => Store.can('payments.void') ? `<button class="btn btn-sm btn-ghost" data-void="${r.id}">إلغاء</button>` : '' }
      ], rows: data.rows, totals: { amount: total }, emptyText: 'لا توجد دفعات'
    })}</div><div>${pagerHTML(data.pagination)}</div></div>`;
  bindTable(document.getElementById('view'), {
    onPage: p => Router.go(`#/payments${qs({ ...state, page: p })}`),
    onPageSize: s => Router.go(`#/payments${qs({ ...state, pageSize: s, page: 1 })}`)
  });
  bindFilters(document.getElementById('view'), f => Router.go(`#/payments${qs({ ...f, page: 1 })}`));
  document.getElementById('btnNew')?.addEventListener('click', () => paymentForm({}, () => Router.resolve()));
  document.querySelectorAll('[data-void]').forEach(b => b.onclick = async () => {
    const r = await confirmDialog({ title: 'إلغاء الدفعة', message: 'سيتم إلغاء الدفعة وإعادة المتبقي على الفاتورة.', requireReason: true, reasonLabel: 'السبب', danger: true, confirmLabel: 'إلغاء' });
    if (!r.ok) return;
    try { await Api.post(`/payments/${b.dataset.void}/void`, { reason: r.reason }); toast('تم إلغاء الدفعة', 'ok'); Router.resolve(); } catch (e) { toast(e.message, 'err'); }
  });
});

async function paymentForm(preset, onSaved) {
  const meta = await ensureMeta();
  const v = preset || {};
  const sups = await suppliers();
  const invoices = (await Api.get('/supplier-invoices' + qs({ approval_status: 'approved', pageSize: 300 }))).rows
    .filter(i => Number(i.remaining_total) > 0.005);
  const transfers = (await Api.get('/transfers' + qs({ transfer_type: 'supplier', pageSize: 300 }))).rows
    .filter(t => t.approval_status === 'approved' && Number(t.unpaid_total) > 0.005);

  modal({
    title: v.invoice_no ? `دفعة على الفاتورة ${v.invoice_no}` : 'تسجيل دفعة', size: 'wide',
    body: `
      ${v.remaining !== undefined ? `<div class="alert">المتبقي على الفاتورة: <b>${money(v.remaining)} ${CUR}</b></div>` : ''}
      ${formHTML([
        { name: 'payment_date', label: 'تاريخ الدفعة', type: 'date', required: true, value: v.payment_date || today() },
        { name: 'payment_no', label: 'رقم الدفعة', placeholder: 'يُولَّد تلقائيًا', value: v.payment_no || '' },
        { name: 'payment_type', label: 'نوع الدفعة', type: 'select', required: true, value: v.payment_type || (v.supplier_invoice_id ? 'supplier_invoice' : 'supplier_invoice'), options: [{ value: 'supplier_invoice', label: 'سداد فاتورة مورد' }, { value: 'advance', label: 'دفعة على عهدة' }, { value: 'advance_payment', label: 'دفعة مقدمة لمورد' }, { value: 'other', label: 'أخرى' }] },
        { name: 'amount', label: 'المبلغ', type: 'number', required: true, step: '0.01', min: '0', value: v.amount || v.remaining || '' },
        { name: 'supplier_invoice_id', label: 'فاتورة المورد', type: 'select', value: v.supplier_invoice_id || '', placeholder: '— اختر الفاتورة —', options: invoices.map(i => ({ value: i.id, label: `${i.invoice_no} — ${i.supplier_name} — متبقٍ ${money(i.remaining_total)}` })) },
        { name: 'supplier_id', label: 'المورد', type: 'select', value: v.supplier_id || '', placeholder: '— اختر —', options: sups.map(s => ({ value: s.id, label: s.name })) },
        { name: 'transfer_id', label: 'التحويل المرتبط', type: 'select', value: v.transfer_id || '', placeholder: '— اختر التحويل —', options: transfers.map(t => ({ value: t.id, label: `${t.transfer_no} — ${money(t.amount)} — متبقٍ ${money(t.unpaid_total)}` })), help: 'لا يمكن أن تتجاوز الدفعات قيمة التحويل' },
        { name: 'project_id', label: 'المشروع', type: 'select', required: true, value: v.project_id || defaultProjectId(), options: projectOptions(false) },
        { name: 'notes', label: 'ملاحظات', type: 'textarea', value: v.notes || '' }
      ])}`,
    buttons: [
      { label: 'تسجيل الدفعة', cls: 'btn-primary', onClick: async (el) => {
          clearFieldErrors(el);
          const payload = readForm(el);
          try {
            await Api.post('/payments', payload);
            closeModal(el); toast('تم تسجيل الدفعة وتحديث رصيد الفاتورة', 'ok'); onSaved && onSaved();
          } catch (err) { handleFormError(el, err); }
        } },
      { label: 'إلغاء' }
    ]
  });
}
