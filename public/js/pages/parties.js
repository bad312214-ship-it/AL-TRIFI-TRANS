/* ═══════════════════════════════════════════════════════════════
   المقاولون · الموردون · مصادر التمويل
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ══════════════ المقاولون ══════════════ */
Router.register('/contractors', async ({ query, container }) => {
  await ensureMeta();
  const state = { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20, ...query };
  const data = await Api.get('/contractors' + qs(state));
  const totals = data.rows.reduce((a, r) => {
    a.total_advances += Number(r.total_advances || 0); a.total_settled += Number(r.total_settled || 0);
    a.total_transfers += Number(r.total_transfers || 0); return a;
  }, { total_advances: 0, total_settled: 0, total_transfers: 0 });

  container.innerHTML = `
    ${pageHead('المقاولون', 'الرصيد الحقيقي لكل مقاول = إجمالي العهد − إجمالي الإخلاءات', `
      ${Store.can('contractors.create') ? '<button class="btn btn-primary" id="btnNew">＋ مقاول جديد</button>' : ''}`)}
    ${filtersBar('cFilters', [
      { name: 'search', label: 'بحث', placeholder: 'الاسم أو الرقم', value: query.search || '' },
      { name: 'is_active', label: 'الحالة', type: 'select', value: query.is_active || '', options: [{ value: '1', label: 'نشط' }, { value: '0', label: 'موقوف' }] },
      { name: 'with_open_balance', label: '', type: 'checkbox', checkLabel: 'لديهم رصيد غير مسوَّى فقط', value: query.with_open_balance === '1' }
    ])}
    <div class="card"><div class="card-body flush">${tableHTML({
      columns: [
        { key: 'code', label: 'رقم المقاول', sortable: true, render: r => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'name', label: 'الاسم', sortable: true, render: r => `<div class="cell-main">${esc(r.name)}</div><div class="cell-sub">${esc(r.specialty || '')}</div>` },
        { key: 'phone', label: 'الجوال', render: r => esc(r.phone || '—') },
        { key: 'advances_count', label: 'عدد العهد', num: true, render: r => int(r.advances_count) },
        { key: 'total_advances', label: 'إجمالي العهد', num: true, sortable: true, render: r => money(r.total_advances) },
        { key: 'total_settled', label: 'إجمالي الإخلاءات', num: true, sortable: true, render: r => money(r.total_settled) },
        { key: 'total_transfers', label: 'إجمالي التحويلات', num: true, render: r => money(r.total_transfers) },
        { key: 'remaining_balance', label: 'الرصيد الحقيقي', num: true, render: r => {
            const v = Number(r.total_advances || 0) - Number(r.total_settled || 0);
            return `<b style="color:${v > 0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(v)}</b>`;
          } },
        { key: 'act', label: '', render: r => `<div class="row-actions"><button class="btn btn-sm" data-view="${r.id}">الملف</button></div>` }
      ], rows: data.rows, totals, onRowClick: i => openContractorCard(data.rows[i].id), emptyText: 'لا يوجد مقاولون — أضف أول مقاول'
    })}</div><div>${pagerHTML(data.pagination)}</div></div>`;

  bindTable(document.getElementById('view'), {
    onRowClick: i => openContractorCard(data.rows[i].id),
    onPage: p => Router.go(`#/contractors${qs({ ...state, page: p })}`),
    onPageSize: s => Router.go(`#/contractors${qs({ ...state, pageSize: s, page: 1 })}`)
  });
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = e => { e.stopPropagation(); openContractorCard(Number(b.dataset.view)); });
  bindFilters(document.getElementById('view'), f => Router.go(`#/contractors${qs({ ...f, page: 1 })}`));
  document.getElementById('btnNew')?.addEventListener('click', () => partyForm('contractor', null, () => Router.resolve()));
});

async function openContractorCard(id) {
  const d = await Api.get(`/contractors/${id}`);
  const c = d.contractor;
  modal({
    title: c.name, subtitle: `رقم المقاول ${c.code}`, size: 'wide',
    body: `
      <div class="balance-strip">
        <div class="bs"><div class="k">إجمالي العهد</div><div class="v">${money(c.total_advances)}</div></div>
        <div class="bs"><div class="k">إجمالي التحويلات</div><div class="v">${money(c.total_transfers)}</div></div>
        <div class="bs"><div class="k">إجمالي الإخلاءات</div><div class="v" style="color:var(--ok)">${money(c.total_settled)}</div></div>
        <div class="bs hi"><div class="k">الرصيد الحقيقي</div><div class="v" style="color:${Number(c.remaining_balance) > 0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(c.remaining_balance)}</div></div>
        <div class="bs"><div class="k">عهد مفتوحة</div><div class="v">${money(c.open_advances_amount)}</div></div>
      </div>
      <div class="tabs"><div class="tab active" data-tab="info">البيانات</div>
        <div class="tab" data-tab="adv">العهد (${d.advances.length})</div>
        <div class="tab" data-tab="st">الإخلاءات (${d.settlements.length})</div>
        <div class="tab" data-tab="tr">التحويلات (${d.transfers.length})</div>
        <div class="tab" data-tab="audit">السجل</div></div>
      <div data-pane="info"><div class="detail-grid">
        ${dItem('رقم المقاول', esc(c.code))}${dItem('الاسم', esc(c.name))}
        ${dItem('التخصص', esc(c.specialty || '—'))}${dItem('الجوال', esc(c.phone || '—'))}
        ${dItem('الرقم الضريبي', esc(c.vat_number || '—'))}${dItem('الهوية', esc(c.national_id || '—'))}
        ${dItem('الآيبان', esc(c.bank_iban || '—'))}${dItem('الحالة', c.is_active ? '<span class="pill pill-ok">نشط</span>' : '<span class="pill pill-muted">موقوف</span>')}
        ${dItem('ملاحظات', esc(c.notes || '—'))}
      </div></div>
      <div data-pane="adv" style="display:none">${tableHTML({
        columns: [
          { key: 'advance_no', label: 'رقم العهدة', render: r => `<div class="cell-main">${esc(r.advance_no)}</div><div class="cell-sub">${fmtDate(r.advance_date)}</div>` },
          { key: 'description', label: 'البيان', render: r => esc((r.description || '').slice(0, 34)) },
          { key: 'amount', label: 'المبلغ', num: true, render: r => money(r.amount) },
          { key: 'settled_total', label: 'المُخلى', num: true, render: r => money(r.settled_total) },
          { key: 'remaining_balance', label: 'المتبقي', num: true, render: r => `<b>${money(r.remaining_balance)}</b>` },
          { key: 'computed_status', label: 'الحالة', render: r => pill(r.computed_status) }
        ], rows: d.advances, totals: { amount: d.advances.reduce((s, r) => s + Number(r.amount || 0), 0), settled_total: d.advances.reduce((s, r) => s + Number(r.settled_total || 0), 0), remaining_balance: d.advances.reduce((s, r) => s + Number(r.remaining_balance || 0), 0) }, emptyText: 'لا توجد عهد' })}</div>
      <div data-pane="st" style="display:none">${tableHTML({
        columns: [{ key: 'settlement_no', label: 'رقم الإخلاء' }, { key: 'settlement_date', label: 'التاريخ', render: r => fmtDate(r.settlement_date) },
          { key: 'advance_no', label: 'العهدة' }, { key: 'invoice_no', label: 'الفاتورة' },
          { key: 'total_amount', label: 'الإجمالي', num: true, render: r => money(r.total_amount) },
          { key: 'approval_status', label: 'الاعتماد', render: r => pill(r.approval_status) }],
        rows: d.settlements, totals: { total_amount: d.settlements.reduce((s, r) => s + Number(r.total_amount || 0), 0) }, emptyText: 'لا توجد إخلاءات' })}</div>
      <div data-pane="tr" style="display:none">${tableHTML({
        columns: [{ key: 'transfer_no', label: 'رقم العملية' }, { key: 'transfer_date', label: 'التاريخ', render: r => fmtDate(r.transfer_date) },
          { key: 'amount', label: 'المبلغ', num: true, render: r => money(r.amount) },
          { key: 'funding_source_name', label: 'مصدر التمويل' }, { key: 'approval_status', label: 'الاعتماد', render: r => pill(r.approval_status) }],
        rows: d.transfers, totals: { amount: d.transfers.reduce((s, r) => s + Number(r.amount || 0), 0) }, emptyText: 'لا توجد تحويلات' })}</div>
      <div data-pane="audit" style="display:none"><div class="timeline">${d.audit_trail.map(l => `
        <div class="tl-item"><div class="tl-t">${pill(l.action === 'void' ? 'void_action' : l.action)} ${esc(l.summary || '')}</div>
        <div class="tl-m">${esc(l.username || '')} · ${fmtDateTime(l.created_at)}</div></div>`).join('') || '<div class="muted small">لا يوجد سجل</div>'}</div></div>`,
    buttons: [
      ...(Store.can('contractors.update') ? [{ label: '✎ تعديل', onClick: (el) => { closeModal(el); partyForm('contractor', c, () => Router.resolve()); } }] : []),
      { label: 'إغلاق' }
    ]
  });
  bindTabs(document.querySelector('.modal-backdrop:last-of-type'));
}

/* ══════════════ الموردون ══════════════ */
Router.register('/suppliers', async ({ query, container }) => {
  await ensureMeta();
  const state = { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20, ...query };
  const data = await Api.get('/suppliers' + qs(state));
  const totals = data.rows.reduce((a, r) => {
    a.total_invoices += Number(r.total_invoices || 0); a.total_paid += Number(r.total_paid || 0); return a;
  }, { total_invoices: 0, total_paid: 0 });
  container.innerHTML = `
    ${pageHead('الموردون', 'إجمالي الفواتير والمدفوع والمستحق لكل مورد', `
      ${Store.can('suppliers.create') ? '<button class="btn btn-primary" id="btnNew">＋ مورد جديد</button>' : ''}`)}
    ${filtersBar('sFilters', [
      { name: 'search', label: 'بحث', placeholder: 'الاسم أو الرقم', value: query.search || '' },
      { name: 'is_active', label: 'الحالة', type: 'select', value: query.is_active || '', options: [{ value: '1', label: 'نشط' }, { value: '0', label: 'موقوف' }] }
    ])}
    <div class="card"><div class="card-body flush">${tableHTML({
      columns: [
        { key: 'code', label: 'رقم المورد', render: r => `<span class="mono">${esc(r.code)}</span>` },
        { key: 'name', label: 'الاسم', render: r => `<div class="cell-main">${esc(r.name)}</div><div class="cell-sub">${esc(r.category || '')}</div>` },
        { key: 'phone', label: 'الجوال', render: r => esc(r.phone || '—') },
        { key: 'invoices_count', label: 'عدد الفواتير', num: true, render: r => int(r.invoices_count) },
        { key: 'total_invoices', label: 'إجمالي الفواتير', num: true, render: r => money(r.total_invoices) },
        { key: 'total_paid', label: 'المدفوع', num: true, render: r => money(r.total_paid) },
        { key: 'remaining_due', label: 'المستحق', num: true, render: r => {
            const v = Number(r.total_invoices || 0) - Number(r.total_paid || 0);
            return `<b style="color:${v > 0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(v)}</b>`;
          } },
        { key: 'act', label: '', render: r => `<div class="row-actions"><button class="btn btn-sm" data-view="${r.id}">الملف</button></div>` }
      ], rows: data.rows, totals, onRowClick: i => openSupplierCard(data.rows[i].id), emptyText: 'لا يوجد موردون'
    })}</div><div>${pagerHTML(data.pagination)}</div></div>`;
  bindTable(document.getElementById('view'), {
    onRowClick: i => openSupplierCard(data.rows[i].id),
    onPage: p => Router.go(`#/suppliers${qs({ ...state, page: p })}`),
    onPageSize: s => Router.go(`#/suppliers${qs({ ...state, pageSize: s, page: 1 })}`)
  });
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = e => { e.stopPropagation(); openSupplierCard(Number(b.dataset.view)); });
  bindFilters(document.getElementById('view'), f => Router.go(`#/suppliers${qs({ ...f, page: 1 })}`));
  document.getElementById('btnNew')?.addEventListener('click', () => partyForm('supplier', null, () => Router.resolve()));
});

async function openSupplierCard(id) {
  const d = await Api.get(`/suppliers/${id}`);
  const s = d.supplier;
  modal({
    title: s.name, subtitle: `رقم المورد ${s.code}`, size: 'wide',
    body: `
      <div class="balance-strip">
        <div class="bs"><div class="k">إجمالي الفواتير</div><div class="v">${money(s.total_invoices)}</div></div>
        <div class="bs"><div class="k">المدفوع</div><div class="v" style="color:var(--ok)">${money(s.total_paid)}</div></div>
        <div class="bs hi"><div class="k">المستحق</div><div class="v" style="color:${Number(s.remaining_due) > 0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(s.remaining_due)}</div></div>
        <div class="bs"><div class="k">إجمالي التحويلات</div><div class="v">${money(s.total_transfers)}</div></div>
      </div>
      <div class="tabs"><div class="tab active" data-tab="info">البيانات</div>
        <div class="tab" data-tab="inv">الفواتير (${d.invoices.length})</div>
        <div class="tab" data-tab="pay">الدفعات (${d.payments.length})</div>
        <div class="tab" data-tab="tr">التحويلات (${d.transfers.length})</div></div>
      <div data-pane="info"><div class="detail-grid">
        ${dItem('رقم المورد', esc(s.code))}${dItem('الاسم', esc(s.name))}
        ${dItem('التصنيف', esc(s.category || '—'))}${dItem('الجوال', esc(s.phone || '—'))}
        ${dItem('الرقم الضريبي', esc(s.vat_number || '—'))}${dItem('السجل التجاري', esc(s.commercial_reg || '—'))}
        ${dItem('الآيبان', esc(s.bank_iban || '—'))}${dItem('شروط السداد', `${int(s.payment_terms_days)} يوم`)}
        ${dItem('ملاحظات', esc(s.notes || '—'))}
      </div></div>
      <div data-pane="inv" style="display:none">${tableHTML({
        columns: [{ key: 'invoice_no', label: 'رقم الفاتورة' }, { key: 'invoice_date', label: 'التاريخ', render: r => fmtDate(r.invoice_date) },
          { key: 'total_amount', label: 'الإجمالي', num: true, render: r => money(r.total_amount) },
          { key: 'paid_total', label: 'المدفوع', num: true, render: r => money(r.paid_total) },
          { key: 'remaining_total', label: 'المتبقي', num: true, render: r => money(r.remaining_total) },
          { key: 'status', label: 'الحالة', render: r => pill(r.status) }],
        rows: d.invoices, totals: { total_amount: d.invoices.reduce((a, r) => a + Number(r.total_amount || 0), 0), paid_total: d.invoices.reduce((a, r) => a + Number(r.paid_total || 0), 0), remaining_total: d.invoices.reduce((a, r) => a + Number(r.remaining_total || 0), 0) }, emptyText: 'لا توجد فواتير' })}</div>
      <div data-pane="pay" style="display:none">${tableHTML({
        columns: [{ key: 'payment_no', label: 'رقم الدفعة' }, { key: 'payment_date', label: 'التاريخ', render: r => fmtDate(r.payment_date) },
          { key: 'amount', label: 'المبلغ', num: true, render: r => money(r.amount) },
          { key: 'transfer_no', label: 'التحويل', render: r => esc(r.transfer_no || '—') }],
        rows: d.payments, totals: { amount: d.payments.reduce((a, r) => a + Number(r.amount || 0), 0) }, emptyText: 'لا توجد دفعات' })}</div>
      <div data-pane="tr" style="display:none">${tableHTML({
        columns: [{ key: 'transfer_no', label: 'رقم العملية' }, { key: 'transfer_date', label: 'التاريخ', render: r => fmtDate(r.transfer_date) },
          { key: 'amount', label: 'المبلغ', num: true, render: r => money(r.amount) },
          { key: 'funding_source_name', label: 'مصدر التمويل' }, { key: 'approval_status', label: 'الاعتماد', render: r => pill(r.approval_status) }],
        rows: d.transfers, totals: { amount: d.transfers.reduce((a, r) => a + Number(r.amount || 0), 0) }, emptyText: 'لا توجد تحويلات' })}</div>`,
    buttons: [
      ...(Store.can('suppliers.update') ? [{ label: '✎ تعديل', onClick: (el) => { closeModal(el); partyForm('supplier', s, () => Router.resolve()); } }] : []),
      { label: 'إغلاق' }
    ]
  });
  bindTabs(document.querySelector('.modal-backdrop:last-of-type'));
}

function partyForm(kind, existing, onSaved) {
  const isC = kind === 'contractor';
  const v = existing || {};
  const fields = [
    { name: 'code', label: isC ? 'رقم المقاول' : 'رقم المورد', required: true, value: v.code || '' },
    { name: 'name', label: isC ? 'اسم المقاول' : 'اسم المورد', required: true, value: v.name || '' },
    { name: isC ? 'specialty' : 'category', label: isC ? 'التخصص' : 'التصنيف', value: v[isC ? 'specialty' : 'category'] || '' },
    { name: 'phone', label: 'الجوال', value: v.phone || '' },
    { name: 'vat_number', label: 'الرقم الضريبي', value: v.vat_number || '' },
    { name: isC ? 'national_id' : 'commercial_reg', label: isC ? 'رقم الهوية' : 'السجل التجاري', value: v[isC ? 'national_id' : 'commercial_reg'] || '' },
    { name: 'bank_iban', label: 'الآيبان', value: v.bank_iban || '' },
    ...(isC ? [] : [{ name: 'payment_terms_days', label: 'شروط السداد (يوم)', type: 'number', step: '1', value: v.payment_terms_days || 0 }]),
    { name: 'notes', label: 'ملاحظات', type: 'textarea', value: v.notes || '' },
    ...(existing ? [{ name: 'is_active', type: 'checkbox', checkLabel: 'نشط', value: !!v.is_active }] : [])
  ];
  modal({
    title: existing ? `تعديل ${isC ? 'المقاول' : 'المورد'}` : (isC ? 'مقاول جديد' : 'مورد جديد'), size: 'narrow',
    body: formHTML(fields),
    buttons: [
      { label: 'حفظ', cls: 'btn-primary', onClick: async (el) => {
          clearFieldErrors(el);
          const payload = readForm(el);
          try {
            if (existing) await Api.put(`/${isC ? 'contractors' : 'suppliers'}/${existing.id}`, payload);
            else await Api.post(`/${isC ? 'contractors' : 'suppliers'}`, payload);
            closeModal(el); toast('تم الحفظ', 'ok');
            _contractorCache = null; _supplierCache = null;
            onSaved && onSaved();
          } catch (err) { handleFormError(el, err); }
        } },
      { label: 'إلغاء' }
    ]
  });
}

/* ══════════════ مصادر التمويل ══════════════ */
Router.register('/funding-sources', async ({ query, container }) => {
  await ensureMeta();
  const [list, analysis] = await Promise.all([
    Api.get('/funding-sources' + qs({ pageSize: 200 })),
    Api.get('/funding-sources/analysis' + qs({ from: query.from, to: query.to, project_id: query.project_id }))
  ]);
  const totalAll = analysis.reduce((s, r) => s + Number(r.total_transfers || 0), 0);

  container.innerHTML = `
    ${pageHead('مصادر التمويل', 'جاري الشريك · أوتك · النقليات — ويمكن إضافة مصادر جديدة بدون تعديل هيكل النظام', `
      ${Store.can('funding_sources.create') ? '<button class="btn btn-primary" id="btnNew">＋ مصدر جديد</button>' : ''}
      <button class="btn" id="btnExport">⬇ Excel</button>`)}

    <div class="card mb">
      <div class="card-head"><h3>📊 تحليل مصادر التمويل</h3>
        <div class="spacer"></div>
        <div class="field" style="min-width:140px"><label>من تاريخ</label><input type="date" id="aFrom" value="${esc(query.from || '')}"></div>
        <div class="field" style="min-width:140px"><label>إلى تاريخ</label><input type="date" id="aTo" value="${esc(query.to || '')}"></div>
        <div class="field" style="min-width:150px"><label>المشروع</label><select id="aProj">${projectOptions().map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(query.project_id || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
      </div>
      <div class="card-body flush">${tableHTML({
        columns: [
          { key: 'name', label: 'مصدر التمويل', render: r => `<div class="cell-main">${esc(r.name)}</div><div class="cell-sub">${esc(r.code)}</div>` },
          { key: 'transfers_count', label: 'عدد التحويلات', num: true, render: r => int(r.transfers_count) },
          { key: 'total_transfers', label: 'إجمالي التحويلات', num: true, render: r => `<b>${money(r.total_transfers)}</b>` },
          { key: 'to_advances', label: 'إلى العهد', num: true, render: r => money(r.to_advances) },
          { key: 'to_suppliers', label: 'إلى الموردين', num: true, render: r => money(r.to_suppliers) },
          { key: 'to_other', label: 'أخرى', num: true, render: r => money(r.to_other) },
          { key: 'pending_transfers', label: 'بانتظار الاعتماد', num: true, render: r => r.pending_transfers ? money(r.pending_transfers) : '—' },
          { key: 'credit_limit', label: 'السقف', num: true, render: r => r.credit_limit === null ? '—' : money(r.credit_limit) },
          { key: 'remaining_limit', label: 'المتبقي من السقف', num: true, render: r => r.remaining_limit === null ? '—' : `<b style="color:${Number(r.remaining_limit) < 0 ? 'var(--danger)' : 'inherit'}">${money(r.remaining_limit)}</b>` },
          { key: 'pct', label: 'النسبة', num: true, render: r => pct(totalAll ? (Number(r.total_transfers) / totalAll) * 100 : 0) }
        ],
        rows: analysis,
        totals: { total_transfers: totalAll, to_advances: analysis.reduce((s, r) => s + r.to_advances, 0), to_suppliers: analysis.reduce((s, r) => s + r.to_suppliers, 0), to_other: analysis.reduce((s, r) => s + r.to_other, 0) },
        emptyText: 'لا توجد مصادر'
      })}</div>
    </div>

    <div class="card"><div class="card-head"><h3>⚙️ إدارة المصادر</h3></div>
      <div class="card-body flush">${tableHTML({
        columns: [
          { key: 'code', label: 'الرمز', render: r => `<span class="mono">${esc(r.code)}</span>` },
          { key: 'name', label: 'الاسم', render: r => `<div class="cell-main">${esc(r.name)}</div><div class="cell-sub">${esc(r.description || '')}</div>` },
          { key: 'account_name', label: 'الحساب المحاسبي', render: r => r.account_code ? `${esc(r.account_code)} — ${esc(r.account_name)}` : '<span class="pill pill-warn">غير مرتبط</span>' },
          { key: 'transfers_count', label: 'التحويلات', num: true, render: r => int(r.transfers_count) },
          { key: 'total_transferred', label: 'المحوَّل', num: true, render: r => money(r.total_transferred) },
          { key: 'is_active', label: 'الحالة', render: r => r.is_active ? '<span class="pill pill-ok">مفعَّل</span>' : '<span class="pill pill-muted">معطَّل</span>' },
          { key: 'act', label: '', render: r => `<div class="row-actions">
            ${Store.can('funding_sources.update') ? `<button class="btn btn-sm" data-edit="${r.id}">تعديل</button>` : ''}
            ${Store.can('funding_sources.void') && r.is_active ? `<button class="btn btn-sm btn-ghost" data-dis="${r.id}">تعطيل</button>` : ''}</div>` }
        ], rows: list.rows, emptyText: 'لا توجد مصادر'
      })}</div></div>`;

  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const row = list.rows.find(r => r.id === Number(b.dataset.edit));
    fundingForm(row, () => Router.resolve());
  });
  document.querySelectorAll('[data-dis]').forEach(b => b.onclick = async () => {
    const r = await confirmDialog({ title: 'تعطيل مصدر التمويل', message: 'لن يظهر المصدر في القوائم الجديدة، وتبقى عملياته محفوظة.', confirmLabel: 'تعطيل', danger: true });
    if (!r.ok) return;
    try { await Api.post(`/funding-sources/${b.dataset.dis}/void`); toast('تم التعطيل', 'ok'); Store.meta = null; Router.resolve(); } catch (e) { toast(e.message, 'err'); }
  });
  const apply = () => Router.go(`#/funding-sources${qs({ from: document.getElementById('aFrom').value, to: document.getElementById('aTo').value, project_id: document.getElementById('aProj').value })}`);
  ['aFrom', 'aTo', 'aProj'].forEach(id => document.getElementById(id).onchange = apply);
  document.getElementById('btnNew')?.addEventListener('click', () => fundingForm(null, () => Router.resolve()));
  document.getElementById('btnExport')?.addEventListener('click', () => exportReport('funding_sources', query));
});

function fundingForm(existing, onSaved) {
  const v = existing || {};
  modal({
    title: existing ? `تعديل مصدر التمويل ${v.name}` : 'مصدر تمويل جديد', size: 'narrow',
    body: formHTML([
      { name: 'code', label: 'الرمز', required: true, value: v.code || '', help: 'أحرف إنجليزية، مثال: PARTNER' },
      { name: 'name', label: 'اسم المصدر', required: true, value: v.name || '' },
      { name: 'account_id', label: 'الحساب المحاسبي المرتبط', type: 'select', value: v.account_id || '', options: accountOptions() },
      { name: 'opening_balance', label: 'رصيد افتتاحي', type: 'number', step: '0.01', value: v.opening_balance || 0 },
      { name: 'credit_limit', label: 'سقف تمويلي (اختياري)', type: 'number', step: '0.01', value: v.credit_limit ?? '', help: 'اتركه فارغًا لبدون سقف' },
      { name: 'description', label: 'الوصف', type: 'textarea', value: v.description || '' },
      ...(existing ? [{ name: 'is_active', type: 'checkbox', checkLabel: 'مفعَّل', value: !!v.is_active }] : [])
    ]),
    buttons: [
      { label: 'حفظ', cls: 'btn-primary', onClick: async (el) => {
          clearFieldErrors(el);
          const payload = readForm(el);
          try {
            if (existing) await Api.put(`/funding-sources/${existing.id}`, payload);
            else await Api.post('/funding-sources', payload);
            closeModal(el); toast('تم الحفظ', 'ok'); Store.meta = null; onSaved && onSaved();
          } catch (err) { handleFormError(el, err); }
        } },
      { label: 'إلغاء' }
    ]
  });
}
