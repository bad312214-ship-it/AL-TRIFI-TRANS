/* ═══════════════════════════════════════════════════════════════
   التحويلات · إخلاء العهد · فواتير الموردين · الدفعات
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ══════════════════════ التحويلات ══════════════════════ */
Router.register('/transfers', async ({ query, container }) => {
  await ensureMeta();
  const cons = await contractors();
  const sups = await suppliers();
  const state = { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20, sort: query.sort || 't.transfer_date', dir: query.dir || 'desc', ...query };
  const data = await Api.get('/transfers' + qs(state));
  const total = data.rows.reduce((s, r) => s + Number(r.amount || 0), 0);

  container.innerHTML = `
    ${pageHead('التحويلات المالية', 'كل تحويل مرتبط بمصدر تمويل، ويمكن ربطه بعهدة أو فاتورة مورد', `
      ${Store.can('transfers.create') ? '<button class="btn btn-primary" id="btnNew">＋ تحويل جديد</button>' : ''}
      <button class="btn" id="btnExport">⬇ Excel</button>`)}
    <div class="kpi-grid">
      ${kpiCard({ label: 'إجمالي القائمة', value: money(total), icon: '💸', color: '#1d4ed8' })}
      ${kpiCard({ label: 'عدد التحويلات', value: int(data.pagination.total), icon: '#', color: '#0f766e', unit: '' })}
      ${kpiCard({ label: 'غير مرتبطة', value: int(data.rows.filter(r => !r.is_linked).length), icon: '🔗', color: '#b45309', unit: 'عملية' })}
    </div>
    ${filtersBar('trFilters', [
      { name: 'search', label: 'بحث', placeholder: 'رقم العملية، المرجع البنكي، المستفيد', value: query.search || '' },
      { name: 'funding_source_id', label: 'مصدر التمويل', type: 'select', value: query.funding_source_id || '', options: fundingOptions() },
      { name: 'transfer_type', label: 'نوع التحويل', type: 'select', value: query.transfer_type || '', options: [{ value: 'advance', label: 'تحويل لعهدة مقاول' }, { value: 'supplier', label: 'تحويل لمورد' }, { value: 'other', label: 'تحويل آخر' }] },
      { name: 'contractor_id', label: 'المقاول', type: 'select', placeholder: 'الكل', value: query.contractor_id || '', options: cons.map(c => ({ value: c.id, label: c.name })) },
      { name: 'supplier_id', label: 'المورد', type: 'select', placeholder: 'الكل', value: query.supplier_id || '', options: sups.map(s => ({ value: s.id, label: s.name })) },
      { name: 'approval_status', label: 'الاعتماد', type: 'select', value: query.approval_status || '', options: [{ value: 'draft', label: 'مسودة' }, { value: 'pending', label: 'بانتظار الاعتماد' }, { value: 'approved', label: 'معتمد' }, { value: 'rejected', label: 'مرفوض' }] },
      { name: 'date_from', label: 'من تاريخ', type: 'date', value: query.date_from || '' },
      { name: 'date_to', label: 'إلى تاريخ', type: 'date', value: query.date_to || '' },
      { name: 'unlinked', label: '', type: 'checkbox', checkLabel: 'غير المرتبطة فقط', value: query.unlinked === '1' }
    ], { open: !!query.search })}
    <div class="card"><div class="card-body flush" id="trTable"></div><div id="trPager"></div></div>`;

  const cols = [
    { key: 'transfer_no', label: 'رقم العملية', sortable: true, render: r => `<div class="cell-main">${esc(r.transfer_no)}</div><div class="cell-sub">${fmtDate(r.transfer_date)}</div>` },
    { key: 'amount', label: 'المبلغ', num: true, sortable: true, render: r => `<b>${money(r.amount)}</b>` },
    { key: 'funding_source_name', label: 'مصدر التمويل', render: r => `<span class="pill pill-brand plain">${esc(r.funding_source_name || '—')}</span>` },
    { key: 'transfer_type', label: 'النوع', render: r => pill(r.transfer_type) },
    { key: 'beneficiary_name', label: 'المستفيد', render: r => `<div class="cell-main">${esc(r.beneficiary_name || '—')}</div>${r.contractor_code ? `<div class="cell-sub">${esc(r.contractor_code)}</div>` : ''}` },
    { key: 'advance_no', label: 'العهدة', render: r => r.advance_no ? `<a href="#/advances?search=${encodeURIComponent(r.advance_no)}">${esc(r.advance_no)}</a>` : (r.transfer_type === 'advance' ? '<span class="pill pill-danger">غير مرتبطة</span>' : '<span class="muted">—</span>') },
    { key: 'purpose', label: 'الغرض', render: r => esc((r.purpose || '—').slice(0, 34)) },
    { key: 'bank_ref', label: 'المرجع البنكي', render: r => `<span class="mono small">${esc(r.bank_ref || '—')}</span>` },
    { key: 'approval_status', label: 'الاعتماد', render: r => pill(r.approval_status) },
    { key: 'act', label: '', render: r => `<div class="row-actions"><button class="btn btn-sm" data-view="${r.id}">عرض</button></div>` }
  ];

  const t = document.getElementById('trTable');
  t.innerHTML = tableHTML({ columns: cols, rows: data.rows, totals: { amount: total }, onRowClick: (i) => openTransferCard(data.rows[i].id), emptyText: 'لا توجد تحويلات — سجّل أول تحويل' });
  document.getElementById('trPager').innerHTML = pagerHTML(data.pagination);
  bindTable(document.getElementById('view'), {
    onRowClick: (i) => openTransferCard(data.rows[i].id),
    onSort: (k) => Router.go(`#/transfers${qs({ ...state, sort: k, dir: state.sort === k && state.dir === 'asc' ? 'desc' : 'asc', page: 1 })}`),
    onPage: (p) => Router.go(`#/transfers${qs({ ...state, page: p })}`),
    onPageSize: (s) => Router.go(`#/transfers${qs({ ...state, pageSize: s, page: 1 })}`)
  });
  t.querySelectorAll('[data-view]').forEach(b => b.onclick = (e) => { e.stopPropagation(); openTransferCard(Number(b.dataset.view)); });
  bindFilters(document.getElementById('view'), (f) => Router.go(`#/transfers${qs({ ...f, page: 1, pageSize: state.pageSize })}`));
  document.getElementById('btnExport')?.addEventListener('click', () => exportReport('transfers', state));
  document.getElementById('btnNew')?.addEventListener('click', () => transferForm(null, cons, sups, () => Router.resolve()));
});

async function transferForm(existing, cons, sups, onSaved) {
  const meta = await ensureMeta();
  const v = existing ? (existing.transfer || existing) : {};
  const advancesList = v.contractor_id
    ? (await Api.get('/advances' + qs({ contractor_id: v.contractor_id, pageSize: 200 }))).rows : [];

  const m = modal({
    title: existing ? `تعديل التحويل ${v.transfer_no}` : 'تحويل مالي جديد', size: 'wide',
    body: formHTML([
      { type: 'section', label: 'بيانات التحويل' },
      { name: 'transfer_no', label: 'رقم العملية', placeholder: 'يُولَّد تلقائيًا', value: v.transfer_no || '' },
      { name: 'transfer_date', label: 'تاريخ التحويل', type: 'date', required: true, value: v.transfer_date || today() },
      { name: 'amount', label: 'المبلغ', type: 'number', required: true, step: '0.01', min: '0', value: v.amount || '' },
      { name: 'funding_source_id', label: 'مصدر التمويل', type: 'select', required: true, value: v.funding_source_id || '', placeholder: '— إلزامي —', options: fundingOptions(false) },
      { name: 'purpose', label: 'الغرض من التحويل', value: v.purpose || '' },
      { name: 'bank_ref', label: 'المرجع البنكي', value: v.bank_ref || '', help: 'لا يمكن تكرار نفس المرجع' },
      { name: 'bank_name', label: 'البنك', value: v.bank_name || '' },
      { type: 'section', label: 'المستفيد' },
      { name: 'transfer_type', label: 'نوع التحويل', type: 'select', required: true, value: v.transfer_type || 'advance', options: [{ value: 'advance', label: 'تحويل لعهدة مقاول' }, { value: 'supplier', label: 'تحويل لمورد' }, { value: 'other', label: 'تحويل آخر' }] },
      { name: 'beneficiary_type', label: 'نوع المستفيد', type: 'select', required: true, value: v.beneficiary_type || 'contractor', options: [{ value: 'contractor', label: 'مقاول' }, { value: 'supplier', label: 'مورد' }, { value: 'other', label: 'أخرى' }] },
      { name: 'contractor_id', label: 'المقاول', type: 'select', value: v.contractor_id || '', placeholder: '— اختر —', options: cons.map(c => ({ value: c.id, label: `${c.name} (${c.code})` })) },
      { name: 'supplier_id', label: 'المورد', type: 'select', value: v.supplier_id || '', placeholder: '— اختر —', options: sups.map(s => ({ value: s.id, label: `${s.name} (${s.code})` })) },
      { name: 'beneficiary_name', label: 'اسم المستفيد', value: v.beneficiary_name || '', placeholder: 'يُعبأ تلقائيًا' },
      { name: 'advance_id', label: 'العهدة المرتبطة', type: 'select', value: v.advance_id || '', options: [{ value: '', label: '— بدون (يمكن الربط لاحقًا) —' }, ...advancesList.map(a => ({ value: a.id, label: `${a.advance_no} — ${money(a.amount)} — متبقٍ ${money(a.remaining_balance)}` }))] },
      { type: 'section', label: 'المشروع والمحاسبة' },
      { name: 'project_id', label: 'المشروع', type: 'select', required: true, value: v.project_id || defaultProjectId(), options: projectOptions(false) },
      { name: 'cost_center_id', label: 'مركز التكلفة', type: 'select', value: v.cost_center_id || '', options: costCenterOptions(v.project_id || defaultProjectId()) },
      { name: 'from_account_id', label: 'الحساب المحوَّل منه', type: 'select', value: v.from_account_id || '', options: accountOptions() },
      { name: 'to_account_id', label: 'الحساب المحوَّل إليه', type: 'select', value: v.to_account_id || '', options: accountOptions(), help: 'افتراضيًا: عهدي المقاولين / دفعات الموردين' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', value: v.notes || '' },
      { name: 'allow_duplicate', type: 'checkbox', checkLabel: 'أؤكد أنه تحويل جديد رغم وجود تحويل مطابق', value: false },
      { name: 'auto_approve', type: 'checkbox', checkLabel: 'اعتماد التحويل مباشرة (يُنشئ القيد المحاسبي)', value: false }
    ]),
    buttons: [
      { label: existing ? 'حفظ التعديلات' : 'إنشاء التحويل', cls: 'btn-primary', onClick: async (el) => {
          clearFieldErrors(el);
          const payload = readForm(el);
          if (el.dataset.allowOver) { payload.allow_duplicate = true; }
          if (payload.auto_approve && !Store.can('transfers.approve')) { toast('ليست لديك صلاحية الاعتماد', 'err'); return; }
          try {
            const saved = existing ? await Api.put(`/transfers/${v.id}`, payload) : await Api.post('/transfers', payload);
            closeModal(el); toast(existing ? 'تم تحديث التحويل' : `تم إنشاء التحويل ${saved.transfer_no}`, 'ok');
            refreshBadges(); onSaved && onSaved(saved);
          } catch (err) { handleFormError(el, err); }
        } },
      { label: 'إلغاء' }
    ]
  });

  const typeSel = m.querySelector('[name=transfer_type]');
  const bSel = m.querySelector('[name=beneficiary_type]');
  const sync = () => {
    const t = typeSel.value;
    bSel.value = t === 'advance' ? 'contractor' : t === 'supplier' ? 'supplier' : 'other';
    m.querySelector('[name=contractor_id]').disabled = bSel.value !== 'contractor';
    m.querySelector('[name=supplier_id]').disabled = bSel.value !== 'supplier';
  };
  typeSel.onchange = sync; sync();
}

async function openTransferCard(id) {
  const d = await Api.get(`/transfers/${id}`);
  const t = d.transfer;
  const m = modal({
    title: `التحويل ${t.transfer_no}`, subtitle: `${t.beneficiary_name || ''}`, size: 'wide',
    body: `
      <div class="balance-strip">
        <div class="bs hi"><div class="k">المبلغ</div><div class="v">${money(t.amount)}</div></div>
        <div class="bs"><div class="k">مصدر التمويل</div><div class="v" style="font-size:14px">${esc(t.funding_source_name || '—')}</div></div>
        <div class="bs"><div class="k">التاريخ</div><div class="v" style="font-size:15px">${fmtDate(t.transfer_date)}</div></div>
        <div class="bs"><div class="k">النوع</div><div class="v" style="font-size:14px">${pill(t.transfer_type)}</div></div>
        <div class="bs"><div class="k">الاعتماد</div><div class="v" style="font-size:14px">${pill(t.approval_status)}</div></div>
      </div>
      <div class="tabs">
        <div class="tab active" data-tab="info">التفاصيل</div>
        <div class="tab" data-tab="link">الربط (${d.advance ? 1 : 0} عهدة · ${d.payments.length} دفعة)</div>
        <div class="tab" data-tab="journal">القيد المحاسبي (${d.journal.length / 2 | 0})</div>
        <div class="tab" data-tab="files">المرفقات (${d.attachments.length})</div>
        <div class="tab" data-tab="audit">السجل</div>
      </div>
      <div data-pane="info"><div class="detail-grid">
        ${dItem('رقم العملية', esc(t.transfer_no))}${dItem('التاريخ', fmtDate(t.transfer_date))}
        ${dItem('المبلغ', `<b class="money">${money(t.amount)} ${CUR}</b>`)}
        ${dItem('مصدر التمويل', esc(t.funding_source_name || '—'))}
        ${dItem('من حساب', esc(t.from_account_name || '—'))}${dItem('إلى حساب', esc(t.to_account_name || '—'))}
        ${dItem('المستفيد', esc(t.beneficiary_name || '—'))}${dItem('الغرض', esc(t.purpose || '—'))}
        ${dItem('المرجع البنكي', esc(t.bank_ref || '—'))}${dItem('البنك', esc(t.bank_name || '—'))}
        ${dItem('المشروع', esc(t.project_name || '—'))}${dItem('مركز التكلفة', esc(t.cost_center_name || '—'))}
        ${dItem('أنشأه', esc(t.created_by_name || '—'))}${dItem('اعتمده', esc(t.approved_by_name || '—'))}
        ${dItem('ملاحظات', esc(t.notes || '—'))}
      </div></div>
      <div data-pane="link" style="display:none">
        ${d.advance ? `<div class="alert ok mb">مرتبطة بالعهدة <b>${esc(d.advance.advance_no)}</b> —
            مبلغ العهدة ${money(d.advance.amount)}، المتبقي ${money(Number(d.advance.amount) - Number(d.advance.settled_total || 0))}
            <a href="#" id="goAdv" style="margin-inline-start:8px">فتح بطاقة العهدة</a></div>`
          : `<div class="alert warn mb">هذا التحويل غير مرتبط بأي عهدة أو دفعة — سيظهر في تقرير المطابقة.
             ${Store.can('transfers.update') ? '<button class="btn btn-sm" id="btnLink">ربط بعهدة</button>' : ''}</div>`}
        ${d.payments.length ? tableHTML({
          columns: [{ key: 'payment_no', label: 'رقم الدفعة' }, { key: 'payment_date', label: 'التاريخ', render: r => fmtDate(r.payment_date) },
            { key: 'amount', label: 'المبلغ', num: true, render: r => money(r.amount) },
            { key: 'invoice_no', label: 'الفاتورة' }, { key: 'supplier_name', label: 'المورد' }],
          rows: d.payments }) : ''}
      </div>
      <div data-pane="journal" style="display:none">
        ${d.journal.length ? tableHTML({
          columns: [{ key: 'entry_no', label: 'رقم القيد' }, { key: 'account_code', label: 'الحساب' },
            { key: 'account_name', label: 'الاسم' },
            { key: 'debit', label: 'مدين', num: true, render: r => r.debit ? money(r.debit) : '' },
            { key: 'credit', label: 'دائن', num: true, render: r => r.credit ? money(r.credit) : '' }],
          rows: d.journal,
          totals: { debit: d.journal.reduce((s, r) => s + Number(r.debit || 0), 0), credit: d.journal.reduce((s, r) => s + Number(r.credit || 0), 0) }
        }) : '<div class="alert warn">لا يوجد قيد محاسبي — يُنشأ القيد عند اعتماد التحويل.</div>'}
      </div>
      <div data-pane="files" style="display:none">${filesHTML(d.attachments, 'transfer', t.id)}${Store.can('attachments.upload') ? uploadHTML('transfer', t.id) : ''}</div>
      <div data-pane="audit" style="display:none"><div class="timeline">${d.audit_trail.map(l => `
        <div class="tl-item"><div class="tl-t">${pill(l.action === 'void' ? 'void_action' : l.action)} ${esc(l.summary || '')}</div>
        <div class="tl-m">${esc(l.username || '')} · ${fmtDateTime(l.created_at)}</div></div>`).join('') || '<div class="muted small">لا يوجد سجل</div>'}</div></div>`,
    buttons: buildTransferActions(t, () => closeModal(m), () => { closeModal(m); Router.resolve(); })
  });
  bindTabs(m); bindUpload(m, () => openTransferCard(id));
  m.querySelector('#goAdv')?.addEventListener('click', (e) => { e.preventDefault(); closeModal(m); openAdvanceCard(d.advance.id); });
  m.querySelector('#btnLink')?.addEventListener('click', async () => {
    const cons = await contractors();
    const list = (await Api.get('/advances' + qs({ pageSize: 300 }))).rows.filter(a => a.approval_status === 'approved' && !a.transfer_id);
    modal({
      title: 'ربط التحويل بعهدة', size: 'narrow',
      body: formHTML([{ name: 'advance_id', label: 'العهدة', type: 'select', required: true, placeholder: '— اختر —', options: list.map(a => ({ value: a.id, label: `${a.advance_no} — ${a.contractor_name} — ${money(a.amount)}` })) }]),
      buttons: [{ label: 'ربط', cls: 'btn-primary', onClick: async (el) => {
          const v2 = readForm(el);
          if (!v2.advance_id) { toast('اختر العهدة', 'err'); return; }
          try { await Api.post(`/transfers/${t.id}/link-advance`, { advance_id: Number(v2.advance_id) }); closeModal(el); closeModal(m); toast('تم الربط', 'ok'); Router.resolve(); }
          catch (err) { toast(err.message, 'err'); }
        } }, { label: 'إلغاء' }]
    });
  });
}

function buildTransferActions(t, close, refresh) {
  const btns = [];
  if (Store.can('transfers.update') && !t.is_void && t.approval_status !== 'approved')
    btns.push({ label: '✎ تعديل', onClick: async () => { close(); transferForm({ transfer: t }, await contractors(), await suppliers(), refresh); } });
  if (Store.can('transfers.approve') && !t.is_void && t.approval_status !== 'approved')
    btns.push({ label: '✓ اعتماد', cls: 'btn-success', onClick: async () => {
        try { await Api.post(`/transfers/${t.id}/approve`); toast('تم اعتماد التحويل وإنشاء القيد المحاسبي', 'ok'); refresh(); }
        catch (err) { toast(err.message, 'err'); }
      } });
  if (Store.can('transfers.update') && !t.is_void && t.advance_id)
    btns.push({ label: '⛓ فك الارتباط', onClick: async () => {
        const r = await confirmDialog({ title: 'فك الارتباط', message: `سيتم فك ربط التحويل ${t.transfer_no} من العهدة.`, confirmLabel: 'فك' });
        if (!r.ok) return;
        try { await Api.post(`/transfers/${t.id}/unlink-advance`); toast('تم فك الارتباط', 'ok'); refresh(); } catch (err) { toast(err.message, 'err'); }
      } });
  if (Store.can('transfers.void') && !t.is_void)
    btns.push({ label: '⊘ إلغاء', cls: 'btn-danger', onClick: async () => {
        const r = await confirmDialog({ title: 'إلغاء التحويل', message: `سيتم إلغاء التحويل ${t.transfer_no} بمبلغ ${money(t.amount)}.`, requireReason: true, reasonLabel: 'سبب الإلغاء', danger: true, confirmLabel: 'إلغاء' });
        if (!r.ok) return;
        try { await Api.post(`/transfers/${t.id}/void`, { reason: r.reason }); toast('تم إلغاء التحويل', 'ok'); refresh(); } catch (err) { toast(err.message, 'err'); }
      } });
  btns.push({ label: 'إغلاق' });
  return btns;
}

/* ══════════════════════ إخلاء العهد ══════════════════════ */
Router.register('/settlements', async ({ query, container }) => {
  await ensureMeta();
  const cons = await contractors();
  const state = { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20, sort: query.sort || 's.settlement_date', dir: query.dir || 'desc', ...query };
  const data = await Api.get('/settlements' + qs(state));
  const totals = data.rows.reduce((a, r) => {
    a.net_amount += Number(r.net_amount || 0); a.vat_amount += Number(r.vat_amount || 0); a.total_amount += Number(r.total_amount || 0); return a;
  }, { net_amount: 0, vat_amount: 0, total_amount: 0 });

  container.innerHTML = `
    ${pageHead('إخلاء العهد', 'الإخلاءات المعتمدة فقط هي التي تُنقص رصيد العهدة', `
      ${Store.can('settlements.create') ? '<button class="btn btn-primary" id="btnNew">＋ إخلاء جديد</button>' : ''}
      <button class="btn" id="btnExport">⬇ Excel</button>`)}
    <div class="kpi-grid">
      ${kpiCard({ label: 'إجمالي القائمة', value: money(totals.total_amount), icon: '🧮', color: '#6d28d9' })}
      ${kpiCard({ label: 'قبل الضريبة', value: money(totals.net_amount), icon: '📄', color: '#1d4ed8' })}
      ${kpiCard({ label: 'ضريبة القيمة المضافة', value: money(totals.vat_amount), icon: '🧾', color: '#0891b2' })}
      ${kpiCard({ label: 'إخلاءات بتجاوز', value: int(data.rows.filter(r => r.over_settlement).length), icon: '⚠️', color: '#b91c1c', unit: '' })}
    </div>
    ${filtersBar('stFilters', [
      { name: 'search', label: 'بحث', placeholder: 'رقم الإخلاء، الفاتورة، العهدة، المقاول', value: query.search || '' },
      { name: 'contractor_id', label: 'المقاول', type: 'select', placeholder: 'الكل', value: query.contractor_id || '', options: cons.map(c => ({ value: c.id, label: c.name })) },
      { name: 'approval_status', label: 'الاعتماد', type: 'select', value: query.approval_status || '', options: [{ value: 'pending', label: 'بانتظار الاعتماد' }, { value: 'approved', label: 'معتمد' }, { value: 'rejected', label: 'مرفوض' }] },
      { name: 'review_status', label: 'المراجعة', type: 'select', value: query.review_status || '', options: [{ value: 'pending', label: 'قيد المراجعة' }, { value: 'reviewed', label: 'تمت المراجعة' }, { value: 'returned', label: 'مُعاد' }] },
      { name: 'project_id', label: 'المشروع', type: 'select', value: query.project_id || '', options: projectOptions() },
      { name: 'date_from', label: 'من تاريخ', type: 'date', value: query.date_from || '' },
      { name: 'date_to', label: 'إلى تاريخ', type: 'date', value: query.date_to || '' },
      { name: 'over_only', label: '', type: 'checkbox', checkLabel: 'إخلاءات تجاوزت الرصيد فقط', value: query.over_only === '1' }
    ], { open: !!query.search })}
    <div class="card"><div class="card-body flush" id="stTable"></div><div id="stPager"></div></div>`;

  const cols = [
    { key: 'settlement_no', label: 'رقم الإخلاء', sortable: true, render: r => `<div class="cell-main">${esc(r.settlement_no)}</div><div class="cell-sub">${fmtDate(r.settlement_date)}</div>` },
    { key: 'advance_no', label: 'العهدة', render: r => `<a href="#" data-adv="${r.advance_id}">${esc(r.advance_no)}</a><div class="cell-sub">مبلغ ${money(r.advance_amount)}</div>` },
    { key: 'contractor_name', label: 'المقاول', render: r => esc(r.contractor_name || '—') },
    { key: 'invoice_no', label: 'رقم الفاتورة' },
    { key: 'description', label: 'البيان', render: r => esc((r.description || '').slice(0, 36)) },
    { key: 'net_amount', label: 'القيمة', num: true, render: r => money(r.net_amount) },
    { key: 'vat_amount', label: 'الضريبة', num: true, render: r => money(r.vat_amount) },
    { key: 'total_amount', label: 'الإجمالي', num: true, sortable: true, render: r => `<b>${money(r.total_amount)}</b>` },
    { key: 'review_status', label: 'المراجعة', render: r => pill(r.review_status) },
    { key: 'approval_status', label: 'الاعتماد', render: r => `<div>${pill(r.approval_status)}</div>${r.over_settlement ? '<span class="pill pill-danger">تجاوز</span>' : ''}` },
    { key: 'act', label: '', render: r => `<div class="row-actions"><button class="btn btn-sm" data-view="${r.id}">عرض</button></div>` }
  ];
  const el = document.getElementById('stTable');
  el.innerHTML = tableHTML({ columns: cols, rows: data.rows, totals, onRowClick: i => openSettlementCard(data.rows[i].id), emptyText: 'لا توجد إخلاءات' });
  document.getElementById('stPager').innerHTML = pagerHTML(data.pagination);
  bindTable(document.getElementById('view'), {
    onRowClick: i => openSettlementCard(data.rows[i].id),
    onSort: k => Router.go(`#/settlements${qs({ ...state, sort: k, dir: state.sort === k && state.dir === 'asc' ? 'desc' : 'asc', page: 1 })}`),
    onPage: p => Router.go(`#/settlements${qs({ ...state, page: p })}`),
    onPageSize: s => Router.go(`#/settlements${qs({ ...state, pageSize: s, page: 1 })}`)
  });
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = e => { e.stopPropagation(); openSettlementCard(Number(b.dataset.view)); });
  el.querySelectorAll('[data-adv]').forEach(b => b.onclick = e => { e.stopPropagation(); openAdvanceCard(Number(b.dataset.adv)); });
  bindFilters(document.getElementById('view'), f => Router.go(`#/settlements${qs({ ...f, page: 1, pageSize: state.pageSize })}`));
  document.getElementById('btnExport')?.addEventListener('click', () => exportReport('settlements', state));
  document.getElementById('btnNew')?.addEventListener('click', () => settlementForm({}, () => Router.resolve()));
});

async function settlementForm(preset, onSaved) {
  const meta = await ensureMeta();
  const advancesList = (await Api.get('/advances' + qs({ approval_status: 'approved', pageSize: 300 }))).rows;
  if (!advancesList.length) { toast('لا توجد عهد معتمدة لإخلائها — اعتمد عهدة أولًا', 'warn'); return; }
  const v = preset || {};
  const m = modal({
    title: 'فاتورة إخلاء عهدة', size: 'wide',
    body: `
      <div id="advSummary"></div>
      ${formHTML([
        { type: 'section', label: 'العهدة المرتبطة' },
        { name: 'advance_id', label: 'العهدة', type: 'select', required: true, value: v.advance_id || '', placeholder: '— اختر العهدة —', options: advancesList.map(a => ({ value: a.id, label: `${a.advance_no} — ${a.contractor_name} — مبلغ ${money(a.amount)} / متبقٍ ${money(a.remaining_balance)}` })) },
        { name: 'settlement_date', label: 'تاريخ الإخلاء', type: 'date', required: true, value: v.settlement_date || today() },
        { name: 'settlement_no', label: 'رقم الإخلاء', placeholder: 'يُولَّد تلقائيًا', value: v.settlement_no || '' },
        { type: 'section', label: 'بيانات الفاتورة' },
        { name: 'invoice_no', label: 'رقم الفاتورة', required: true, value: v.invoice_no || '' },
        { name: 'description', label: 'البيان', required: true, value: v.description || '' },
        { name: 'net_amount', label: 'قيمة الفاتورة', type: 'number', required: true, step: '0.01', min: '0', value: v.net_amount || '' },
        { name: 'vat_amount', label: 'ضريبة القيمة المضافة', type: 'number', step: '0.01', min: '0', value: v.vat_amount || 0, help: 'افتراضيًا 15% من القيمة' },
        { name: 'total_amount', label: 'الإجمالي', type: 'number', step: '0.01', min: '0', readonly: true, value: '' },
        { name: 'account_id', label: 'الحساب المحاسبي (المصروف)', type: 'select', value: v.account_id || '', options: accountOptions() },
        { name: 'cost_center_id', label: 'مركز التكلفة', type: 'select', value: v.cost_center_id || '', options: costCenterOptions(defaultProjectId()) },
        { name: 'notes', label: 'ملاحظات', type: 'textarea', value: v.notes || '' },
        { name: 'auto_approve', type: 'checkbox', checkLabel: 'اعتماد الإخلاء مباشرة (يُنقص رصيد العهدة)', value: false }
      ])}`,
    buttons: [
      { label: 'حفظ الإخلاء', cls: 'btn-primary', onClick: async (el) => {
          clearFieldErrors(el);
          const payload = readForm(el);
          if (el.dataset.allowOver) payload.allow_over_settlement = true;
          if (payload.auto_approve && !Store.can('settlements.approve')) { toast('ليست لديك صلاحية الاعتماد', 'err'); return; }
          try {
            await Api.post('/settlements', payload);
            closeModal(el); toast('تم تسجيل الإخلاء', 'ok'); refreshBadges(); onSaved && onSaved();
          } catch (err) { handleFormError(el, err); }
        } },
      { label: 'إلغاء' }
    ]
  });

  const net = m.querySelector('[name=net_amount]');
  const vat = m.querySelector('[name=vat_amount]');
  const total = m.querySelector('[name=total_amount]');
  const recalc = () => {
    const n = Number(net.value || 0), vv = Number(vat.value || 0);
    total.value = (Math.round((n + vv) * 100) / 100).toFixed(2);
    showAdvSummary();
  };
  net.oninput = () => { if (!net.dataset.touchedVat) { vat.value = (Math.round(Number(net.value || 0) * 0.15 * 100) / 100).toFixed(2); } recalc(); };
  vat.oninput = () => { vat.dataset.touchedVat = '1'; recalc(); };
  const showAdvSummary = () => {
    const a = advancesList.find(x => String(x.id) === m.querySelector('[name=advance_id]').value);
    const box = m.querySelector('#advSummary');
    if (!a) { box.innerHTML = ''; return; }
    const t = Number(total.value || 0);
    const rem = Number(a.remaining_balance || 0);
    const after = rem - t;
    box.innerHTML = `<div class="balance-strip">
      <div class="bs"><div class="k">العهدة</div><div class="v" style="font-size:14px">${esc(a.advance_no)}</div></div>
      <div class="bs"><div class="k">مبلغ العهدة</div><div class="v">${money(a.amount)}</div></div>
      <div class="bs"><div class="k">المُخلى سابقًا</div><div class="v">${money(a.settled_total)}</div></div>
      <div class="bs hi"><div class="k">الرصيد المتاح</div><div class="v" style="color:var(--brand-600)">${money(rem)}</div></div>
      <div class="bs"><div class="k">الرصيد بعد الإخلاء</div><div class="v" style="color:${after < -0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(after)}</div></div>
    </div>${after < -0.005 ? `<div class="alert danger">⚠ هذا الإخلاء يتجاوز الرصيد المتاح بمقدار <b>${money(-after)} ${CUR}</b> — يتطلب صلاحية خاصة وتأكيدًا.</div>` : ''}`;
  };
  m.querySelector('[name=advance_id]').onchange = showAdvSummary;
  if (v.advance_id) showAdvSummary();
}

async function openSettlementCard(id) {
  const d = await Api.get(`/settlements/${id}`);
  const s = d.settlement, bal = d.balance;
  const m = modal({
    title: `الإخلاء ${s.settlement_no}`, subtitle: `العهدة ${s.advance_no} · ${s.contractor_name || ''}`, size: 'wide',
    body: `
      <div class="balance-strip">
        <div class="bs"><div class="k">مبلغ العهدة</div><div class="v">${money(bal.amount)}</div></div>
        <div class="bs"><div class="k">المُخلى المعتمد</div><div class="v" style="color:var(--ok)">${money(bal.settled_total)}</div></div>
        <div class="bs hi"><div class="k">الرصيد المتبقي</div><div class="v" style="color:${bal.remaining > 0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(bal.remaining)}</div></div>
        <div class="bs"><div class="k">قيمة هذا الإخلاء</div><div class="v">${money(s.total_amount)}</div></div>
      </div>
      ${s.over_settlement ? '<div class="alert danger">⚠ هذا الإخلاء سجَّل تجاوزًا لرصيد العهدة بموافقة خاصة.</div>' : ''}
      <div class="detail-grid">
        ${dItem('رقم الإخلاء', esc(s.settlement_no))}${dItem('التاريخ', fmtDate(s.settlement_date))}
        ${dItem('العهدة', `<a href="#" id="goAdv2">${esc(s.advance_no)}</a>`)}${dItem('المقاول', esc(s.contractor_name || '—'))}
        ${dItem('رقم الفاتورة', esc(s.invoice_no))}${dItem('البيان', esc(s.description))}
        ${dItem('قيمة الفاتورة', money(s.net_amount))}${dItem('ضريبة القيمة المضافة', money(s.vat_amount))}
        ${dItem('الإجمالي', `<b class="money">${money(s.total_amount)} ${CUR}</b>`)}
        ${dItem('الحساب المحاسبي', esc(s.account_name ? `${s.account_code} — ${s.account_name}` : '—'))}
        ${dItem('المشروع', esc(s.project_name || '—'))}${dItem('مركز التكلفة', esc(s.cost_center_name || '—'))}
        ${dItem('حالة المراجعة', pill(s.review_status))}${dItem('حالة الاعتماد', pill(s.approval_status))}
        ${dItem('أنشأه', esc(s.created_by_name || '—'))}${dItem('اعتمده', esc(s.approved_by_name || '—'))}
        ${dItem('ملاحظات', esc(s.notes || '—'))}
      </div>
      <div class="mt">${filesHTML(d.attachments, 'settlement', s.id)}${Store.can('attachments.upload') ? uploadHTML('settlement', s.id) : ''}</div>`,
    buttons: buildSettlementActions(s, () => closeModal(m), () => { closeModal(m); Router.resolve(); })
  });
  bindUpload(m, () => openSettlementCard(id));
  m.querySelector('#goAdv2')?.addEventListener('click', e => { e.preventDefault(); closeModal(m); openAdvanceCard(s.advance_id); });
}

function buildSettlementActions(s, close, refresh) {
  const btns = [];
  if (Store.can('settlements.review') && !s.is_void)
    btns.push({ label: '✓ تمت المراجعة', onClick: async () => {
        try { await Api.post(`/settlements/${s.id}/review`, { status: s.review_status === 'reviewed' ? 'pending' : 'reviewed' }); toast('تم تحديث حالة المراجعة', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); }
      } });
  if (Store.can('settlements.approve') && !s.is_void && s.approval_status !== 'approved')
    btns.push({ label: '✓ اعتماد', cls: 'btn-success', onClick: async () => {
        try { await Api.post(`/settlements/${s.id}/approve`); toast('تم اعتماد الإخلاء وتحديث رصيد العهدة', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); }
      } });
  if (Store.can('settlements.approve') && s.approval_status === 'approved')
    btns.push({ label: '↺ إلغاء الاعتماد', onClick: async () => {
        const r = await confirmDialog({ title: 'إلغاء الاعتماد', message: 'سيُعاد الإخلاء إلى حالة الانتظار ويُعاد رصيد العهدة.', requireReason: true, reasonLabel: 'السبب', confirmLabel: 'إلغاء الاعتماد' });
        if (!r.ok) return;
        try { await Api.post(`/settlements/${s.id}/unapprove`, { reason: r.reason }); toast('تم إلغاء الاعتماد', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); }
      } });
  if (Store.can('settlements.void') && !s.is_void)
    btns.push({ label: '⊘ إلغاء', cls: 'btn-danger', onClick: async () => {
        const r = await confirmDialog({ title: 'إلغاء الإخلاء', message: `سيتم إلغاء الإخلاء ${s.settlement_no}.`, requireReason: true, reasonLabel: 'السبب', danger: true, confirmLabel: 'إلغاء' });
        if (!r.ok) return;
        try { await Api.post(`/settlements/${s.id}/void`, { reason: r.reason }); toast('تم إلغاء الإخلاء', 'ok'); refresh(); } catch (e) { toast(e.message, 'err'); }
      } });
  btns.push({ label: 'إغلاق' });
  return btns;
}
