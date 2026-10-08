/* ═══════════════════════════════════════════════════════════════
   وحدة عهد المقاولين — القائمة، الإدخال، البطاقة الكاملة، الإجراءات
   ═══════════════════════════════════════════════════════════════ */
'use strict';

let _contractorCache = null;
async function contractors() { if (!_contractorCache) _contractorCache = await partyOptions('contractors'); return _contractorCache; }
let _supplierCache = null;
async function suppliers() { if (!_supplierCache) _supplierCache = await partyOptions('suppliers'); return _supplierCache; }

Router.register('/advances', async ({ query, container }) => {
  await ensureMeta();
  const cons = await contractors();
  const state = {
    page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20,
    sort: query.sort || 'a.advance_date', dir: query.dir || 'desc',
    ...query
  };

  const data = await Api.get('/advances' + qs(state));
  const totals = data.rows.reduce((acc, r) => {
    acc.amount += Number(r.amount || 0); acc.settled_total += Number(r.settled_total || 0);
    acc.pending_total += Number(r.pending_total || 0); acc.remaining_balance += Number(r.remaining_balance || 0);
    return acc;
  }, { amount: 0, settled_total: 0, pending_total: 0, remaining_balance: 0 });

  container.innerHTML = `
    ${pageHead('عهد المقاولين', 'إجمالي العهدة − الإخلاءات المعتمدة = الرصيد المتبقي (يُحتسب تلقائيًا)', `
      ${Store.can('advances.create') ? '<button class="btn btn-primary" id="btnNew">＋ عهدة جديدة</button>' : ''}
      <button class="btn" id="btnExport">⬇ Excel</button>`)}

    <div class="kpi-grid">
      ${kpiCard({ label: 'إجمالي العهد (هذه القائمة)', value: money(totals.amount), icon: '🧾', color: '#1d4ed8' })}
      ${kpiCard({ label: 'إجمالي المُخلى', value: money(totals.settled_total), icon: '✅', color: '#15803d' })}
      ${kpiCard({ label: 'إخلاءات معلّقة', value: money(totals.pending_total), icon: '⏳', color: '#b45309' })}
      ${kpiCard({ label: 'الرصيد المتبقي', value: money(totals.remaining_balance), icon: '⚖️', color: '#b91c1c' })}
    </div>

    ${filtersBar('advFilters', [
      { name: 'search', label: 'بحث', placeholder: 'رقم العهدة، المقاول، البيان، رقم التحويل', value: query.search || '' },
      { name: 'contractor_id', label: 'المقاول', type: 'select', placeholder: 'كل المقاولين', value: query.contractor_id || '', options: cons.map(c => ({ value: c.id, label: `${c.name} (${c.code})` })) },
      { name: 'funding_source_id', label: 'مصدر التمويل', type: 'select', value: query.funding_source_id || '', options: fundingOptions() },
      { name: 'project_id', label: 'المشروع', type: 'select', value: query.project_id || '', options: projectOptions() },
      { name: 'status', label: 'الحالة', type: 'select', value: query.status || '', options: [{ value: 'open', label: 'مفتوحة' }, { value: 'under_settlement', label: 'تحت الإخلاء' }, { value: 'partially_closed', label: 'مغلقة جزئيًا' }, { value: 'closed', label: 'مغلقة' }] },
      { name: 'approval_status', label: 'الاعتماد', type: 'select', value: query.approval_status || '', options: [{ value: 'draft', label: 'مسودة' }, { value: 'pending', label: 'بانتظار الاعتماد' }, { value: 'approved', label: 'معتمدة' }, { value: 'rejected', label: 'مرفوضة' }] },
      { name: 'date_from', label: 'من تاريخ', type: 'date', value: query.date_from || '' },
      { name: 'date_to', label: 'إلى تاريخ', type: 'date', value: query.date_to || '' }
    ], { open: !!query.search })}

    <div class="card">
      <div class="card-body flush" id="advTable"></div>
      <div id="advPager"></div>
    </div>`;

  const cols = [
    { key: 'advance_no', label: 'رقم العهدة', sortable: true, render: r => `<div class="cell-main">${esc(r.advance_no)}</div><div class="cell-sub">${fmtDate(r.advance_date)}</div>` },
    { key: 'contractor_name', label: 'المقاول', sortable: true, render: r => `<div class="cell-main">${esc(r.contractor_name || '—')}</div><div class="cell-sub">${esc(r.contractor_code || '')}</div>` },
    { key: 'description', label: 'البيان', render: r => `<span title="${esc(r.description)}">${esc((r.description || '').slice(0, 42))}${(r.description || '').length > 42 ? '…' : ''}</span>` },
    { key: 'funding_source_name', label: 'مصدر التمويل', render: r => esc(r.funding_source_name || '—') },
    { key: 'transfer_no', label: 'التحويل', render: r => r.transfer_no ? `<a href="#/transfers?search=${encodeURIComponent(r.transfer_no)}">${esc(r.transfer_no)}</a><div class="cell-sub">${fmtDate(r.transfer_date)}</div>` : '<span class="pill pill-warn">بدون تحويل</span>' },
    { key: 'amount', label: 'مبلغ العهدة', num: true, sortable: true, render: r => `<b>${money(r.amount)}</b>` },
    { key: 'settled_total', label: 'المُخلى', num: true, render: r => money(r.settled_total) },
    { key: 'remaining_balance', label: 'الرصيد المتبقي', num: true, sortable: true, render: r => {
        const v = Number(r.remaining_balance || 0);
        return `<b style="color:${v > 0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(v)}</b>`;
      } },
    { key: 'status', label: 'الحالة', render: r => `<div>${pill(r.computed_status)}</div><div class="progress" style="width:74px"><span style="width:${r.settlement_progress}%"></span></div>` },
    { key: 'approval_status', label: 'الاعتماد', render: r => pill(r.approval_status) },
    { key: 'act', label: '', render: (r, i) => `<div class="row-actions"><button class="btn btn-sm" data-view="${r.id}">عرض</button></div>` }
  ];

  const render = () => {
    const t = document.getElementById('advTable');
    t.innerHTML = tableHTML({ columns: cols, rows: data.rows, totals, onRowClick: (i) => openAdvanceCard(data.rows[i].id), emptyText: 'لا توجد عهد مطابقة — ابدأ بإضافة عهدة جديدة' });
    document.getElementById('advPager').innerHTML = pagerHTML(data.pagination);
    bindTable(document.getElementById('view'), {
      onRowClick: (i) => openAdvanceCard(data.rows[i].id),
      onSort: (k) => {
        const dir = state.sort === k && state.dir === 'asc' ? 'desc' : 'asc';
        Router.go(`#/advances${qs({ ...state, sort: k, dir, page: 1 })}`);
      },
      onPage: (p) => Router.go(`#/advances${qs({ ...state, page: p })}`),
      onPageSize: (s) => Router.go(`#/advances${qs({ ...state, pageSize: s, page: 1 })}`)
    });
    t.querySelectorAll('[data-view]').forEach(b => b.onclick = (e) => { e.stopPropagation(); openAdvanceCard(Number(b.dataset.view)); });
  };
  render();

  bindFilters(document.getElementById('view'), (f) => {
    Router.go(`#/advances${qs({ ...f, page: 1, pageSize: state.pageSize })}`);
  });
  document.getElementById('btnExport')?.addEventListener('click', () => exportReport('advances', state));
  document.getElementById('btnNew')?.addEventListener('click', () => advanceForm(null, cons, () => Router.resolve()));
});

/* ────────────── نموذج العهدة ────────────── */
async function advanceForm(existing, cons, onSaved) {
  const meta = await ensureMeta();
  const tr = existing
    ? []
    : (await Api.get('/transfers' + qs({ transfer_type: 'advance', unlinked: 1, pageSize: 200 }))).rows;
  const transferOptions = tr
    .filter(t => !t.advance_id)
    .map(t => ({ value: t.id, label: `${t.transfer_no} — ${money(t.amount)} — ${t.beneficiary_name || ''} (${fmtDate(t.transfer_date)})` }));

  const v = existing ? existing.advance || existing : {};
  const m = modal({
    title: existing ? `تعديل العهدة ${v.advance_no}` : 'عهدة مقاول جديدة',
    size: 'wide',
    body: formHTML([
      { type: 'section', label: 'بيانات العهدة' },
      { name: 'advance_no', label: 'رقم العهدة', placeholder: 'يُولَّد تلقائيًا إن تُرك فارغًا', value: v.advance_no || '' },
      { name: 'advance_date', label: 'تاريخ العهدة', type: 'date', required: true, value: v.advance_date || today() },
      { name: 'contractor_id', label: 'المقاول', type: 'select', required: true, value: v.contractor_id || '', placeholder: '— اختر المقاول —', options: cons.map(c => ({ value: c.id, label: `${c.name} (${c.code})` })) },
      { name: 'amount', label: 'المبلغ المطلوب', type: 'number', required: true, value: v.amount || '', step: '0.01', min: '0' },
      { name: 'description', label: 'بيان العهدة', type: 'textarea', required: true, value: v.description || '' },
      { type: 'section', label: 'الربط المحاسبي' },
      { name: 'project_id', label: 'المشروع', type: 'select', required: true, value: v.project_id || defaultProjectId(), options: projectOptions(false) },
      { name: 'cost_center_id', label: 'مركز التكلفة', type: 'select', value: v.cost_center_id || '', options: costCenterOptions(v.project_id || defaultProjectId()) },
      { name: 'funding_source_id', label: 'مصدر التمويل', type: 'select', required: true, value: v.funding_source_id || '', placeholder: '— إلزامي —', options: fundingOptions(false) },
      { name: 'transfer_id', label: 'التحويل المرتبط', type: 'select', value: v.transfer_id || '', options: [{ value: '', label: '— بدون تحويل (يظهر في المطابقة) —' }, ...transferOptions] },
      { name: 'beneficiary_name', label: 'المستفيد', value: v.beneficiary_name || '', placeholder: 'يُعبأ تلقائيًا من المقاول' },
      { type: 'section', label: 'إضافي' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', value: v.notes || '' },
      { name: 'allow_amount_mismatch', type: 'checkbox', checkLabel: 'السماح بالفرق بين مبلغ العهدة وقيمة التحويل', value: false },
      { name: 'auto_approve', type: 'checkbox', checkLabel: 'اعتماد العهدة مباشرة (يتطلب صلاحية الاعتماد)', value: false }
    ]),
    buttons: [
      { label: existing ? 'حفظ التعديلات' : 'إنشاء العهدة', cls: 'btn-primary', onClick: async (el) => {
          clearFieldErrors(el);
          const payload = readForm(el);
          if (payload.auto_approve && !Store.can('advances.approve')) { toast('ليست لديك صلاحية الاعتماد', 'err'); return; }
          try {
            const saved = existing ? await Api.put(`/advances/${v.id}`, payload) : await Api.post('/advances', payload);
            closeModal(el);
            toast(existing ? 'تم تحديث العهدة' : `تم إنشاء العهدة ${saved.advance_no}`, 'ok');
            refreshBadges();
            onSaved && onSaved(saved);
          } catch (err) { handleFormError(el, err); }
        } },
      { label: 'إلغاء' }
    ]
  });
  // تحديث مراكز التكلفة عند تغيير المشروع
  m.querySelector('[name=project_id]').onchange = (e) => {
    const sel = m.querySelector('[name=cost_center_id]');
    sel.innerHTML = costCenterOptions(e.target.value).map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  };
}

function handleFormError(root, err) {
  if (err.details && typeof err.details === 'object') {
    if (err.details.missing) { toast(err.message, 'err', err.details.missing.join('، ')); return; }
    if (err.details.duplicates) {
      modal({ title: 'تحويل مكرر محتمل', size: 'narrow',
        body: `<div class="alert warn">${esc(err.message)}</div>` + tableHTML({
          columns: [{ key: 'transfer_no', label: 'رقم العملية' }, { key: 'transfer_date', label: 'التاريخ' }, { key: 'amount', label: 'المبلغ', num: true, render: r => money(r.amount) }],
          rows: err.details.duplicates
        }),
        buttons: [{ label: 'إغلاق' }] });
      return;
    }
    if (err.details.available !== undefined) {
      offerOverSettlement(root, err);
      return;
    }
  }
  if (err.code === 'UNSETTLED_BALANCE') { toast(err.message, 'warn'); return; }
  toast(err.message, 'err');
}

function offerOverSettlement(root, err) {
  const d = err.details || {};
  modal({
    title: '⚠ تجاوز رصيد العهدة', size: 'narrow',
    body: `<div class="alert danger">
        <b>الرصيد المتاح:</b> ${money(d.available)} ${CUR}<br>
        <b>المبلغ المطلوب إخلاؤه:</b> ${money(d.requested)} ${CUR}<br>
        <b>مقدار التجاوز:</b> <b>${money(d.excess)} ${CUR}</b>
      </div>
      <p class="small">تجاوز رصيد العهدة يتطلب صلاحية خاصة <b>«الموافقة على تجاوز رصيد العهدة»</b> وتأكيدًا صريحًا، وسيُسجَّل في سجل العمليات.</p>
      ${Store.can('settlements.over_settle')
        ? `<label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:13px;"><input type="checkbox" id="confirmOver" style="width:auto"> أؤكد الموافقة على تجاوز رصيد العهدة</label>`
        : `<div class="alert warn">حسابك لا يملك صلاحية تجاوز الرصيد — راجع المراجع المعتمد.</div>`}`,
    buttons: [
      { label: 'تأكيد التجاوز', cls: 'btn-danger', disabled: !Store.can('settlements.over_settle'), onClick: (el) => {
          if (!el.querySelector('#confirmOver').checked) { toast('يجب تفعيل checkbox التأكيد', 'warn'); return; }
          closeModal(el);
          const btn = root.querySelector('.modal-foot .btn-primary');
          root.dataset.allowOver = '1';
          btn.click();
        } },
      { label: 'إلغاء' }
    ]
  });
}

/* ────────────── بطاقة العهدة الكاملة ────────────── */
async function openAdvanceCard(id) {
  const d = await Api.get(`/advances/${id}`);
  const a = d.advance;
  const bal = {
    amount: Number(a.amount || 0),
    settled: Number(a.settled_total || 0),
    pending: Number(a.pending_total || 0),
    remaining: Number(a.remaining_balance || 0)
  };

  const m = modal({
    title: `بطاقة العهدة ${a.advance_no}`,
    subtitle: `${a.contractor_name || ''} · ${a.project_name || ''}`,
    size: 'wide',
    body: `
      <div class="balance-strip">
        <div class="bs"><div class="k">إجمالي العهدة</div><div class="v">${money(bal.amount)}</div></div>
        <div class="bs"><div class="k">إجمالي الإخلاء المعتمد</div><div class="v" style="color:var(--ok)">− ${money(bal.settled)}</div></div>
        <div class="bs"><div class="k">إخلاءات معلّقة</div><div class="v" style="color:var(--warn)">${money(bal.pending)}</div></div>
        <div class="bs hi"><div class="k">الرصيد المتبقي</div><div class="v" style="color:${bal.remaining > 0.005 ? 'var(--danger)' : 'var(--ok)'}">${money(bal.remaining)}</div></div>
        <div class="bs"><div class="k">الحالة</div><div class="v" style="font-size:14px">${pill(a.computed_status)}</div></div>
      </div>

      <div class="tabs">
        <div class="tab active" data-tab="info">التفاصيل</div>
        <div class="tab" data-tab="settlements">الإخلاءات (${d.settlements.length})</div>
        <div class="tab" data-tab="transfers">التحويلات (${d.transfers.length})</div>
        <div class="tab" data-tab="files">المرفقات (${d.attachments.length})</div>
        <div class="tab" data-tab="audit">سجل العمليات</div>
      </div>

      <div data-pane="info">
        <div class="detail-grid">
          ${dItem('رقم العهدة', a.advance_no)}
          ${dItem('تاريخ العهدة', fmtDate(a.advance_date))}
          ${dItem('المقاول', `${a.contractor_name || '—'} <span class="muted small">(${esc(a.contractor_code || '')})</span>`)}
          ${dItem('البيان', esc(a.description))}
          ${dItem('مصدر التمويل', a.funding_source_name || '—')}
          ${dItem('رقم التحويل', a.transfer_no || '<span class="pill pill-warn">لا يوجد</span>')}
          ${dItem('تاريخ التحويل', fmtDate(a.transfer_date))}
          ${dItem('المستفيد', esc(a.beneficiary_name || a.contractor_name || '—'))}
          ${dItem('المرجع البنكي', esc(a.bank_ref || '—'))}
          ${dItem('المشروع', a.project_name || '—')}
          ${dItem('مركز التكلفة', a.cost_center_name || '—')}
          ${dItem('الاعتماد', pill(a.approval_status))}
          ${dItem('أنشأها', esc(a.created_by_name || '—'))}
          ${dItem('اعتمدها', esc(a.approved_by_name || '—'))}
          ${dItem('تاريخ الاعتماد', a.approved_at ? fmtDateTime(a.approved_at) : '—')}
          ${dItem('ملاحظات', esc(a.notes || '—'))}
        </div>
        ${a.is_void ? `<div class="alert danger mt"><b>عهدة ملغاة.</b> السبب: ${esc(a.void_reason || '')}</div>` : ''}
      </div>

      <div data-pane="settlements" style="display:none">
        <div class="flex mb">${Store.can('settlements.create') ? `<button class="btn btn-primary btn-sm" id="btnSettle">＋ إخلاء جديد</button>` : ''}</div>
        ${tableHTML({
          columns: [
            { key: 'settlement_no', label: 'رقم الإخلاء', render: r => `<div class="cell-main">${esc(r.settlement_no)}</div><div class="cell-sub">${fmtDate(r.settlement_date)}</div>` },
            { key: 'invoice_no', label: 'رقم الفاتورة' },
            { key: 'description', label: 'البيان' },
            { key: 'net_amount', label: 'القيمة', num: true, render: r => money(r.net_amount) },
            { key: 'vat_amount', label: 'الضريبة', num: true, render: r => money(r.vat_amount) },
            { key: 'total_amount', label: 'الإجمالي', num: true, render: r => `<b>${money(r.total_amount)}</b>` },
            { key: 'review_status', label: 'المراجعة', render: r => pill(r.review_status) },
            { key: 'approval_status', label: 'الاعتماد', render: r => pill(r.approval_status) },
            { key: 'over', label: '', render: r => r.over_settlement ? '<span class="pill pill-danger">تجاوز</span>' : '' }
          ],
          rows: d.settlements,
          totals: { net_amount: d.settlements.reduce((s, r) => s + Number(r.net_amount || 0), 0), vat_amount: d.settlements.reduce((s, r) => s + Number(r.vat_amount || 0), 0), total_amount: d.settlements.reduce((s, r) => s + Number(r.total_amount || 0), 0) },
          emptyText: 'لم تُسجَّل إخلاءات على هذه العهدة'
        })}
      </div>

      <div data-pane="transfers" style="display:none">
        ${tableHTML({
          columns: [
            { key: 'transfer_no', label: 'رقم العملية' }, { key: 'transfer_date', label: 'التاريخ', render: r => fmtDate(r.transfer_date) },
            { key: 'amount', label: 'المبلغ', num: true, render: r => money(r.amount) },
            { key: 'funding_source_name', label: 'مصدر التمويل' },
            { key: 'purpose', label: 'الغرض' }, { key: 'bank_ref', label: 'المرجع البنكي' },
            { key: 'approval_status', label: 'الاعتماد', render: r => pill(r.approval_status) }
          ],
          rows: d.transfers, emptyText: 'لا توجد تحويلات مرتبطة'
        })}
      </div>

      <div data-pane="files" style="display:none"><div id="advFiles">${filesHTML(d.attachments, 'advance', a.id)}</div>
        ${Store.can('attachments.upload') ? uploadHTML('advance', a.id) : ''}</div>

      <div data-pane="audit" style="display:none">
        <div class="timeline">${d.audit_trail.map(l => `
          <div class="tl-item"><div class="tl-t">${pill(l.action === 'void' ? 'void_action' : l.action)} ${esc(l.summary || '')}</div>
          <div class="tl-m">${esc(l.username || '')} · ${fmtDateTime(l.created_at)}</div></div>`).join('') || '<div class="muted small">لا يوجد سجل</div>'}</div>
      </div>`,
    buttons: buildAdvanceActions(a, m2 => closeModal(m2), () => { closeModal(m); Router.resolve(); })
  });

  bindTabs(m);
  bindUpload(m, () => openAdvanceCard(id));
  m.querySelector('#btnSettle')?.addEventListener('click', () => {
    settlementForm({ advance_id: a.id, advance_no: a.advance_no, remaining: bal.remaining }, () => { closeModal(m); Router.resolve(); });
  });
}

function buildAdvanceActions(a, close, refresh) {
  const btns = [];
  if (Store.can('advances.update') && !a.is_void && a.approval_status !== 'approved')
    btns.push({ label: '✎ تعديل', onClick: () => { close(); advanceForm({ advance: a }, window.__cons || [], refresh); } });
  if (Store.can('advances.approve') && !a.is_void && a.approval_status !== 'approved')
    btns.push({ label: '✓ اعتماد', cls: 'btn-success', onClick: async (el) => {
        try { await Api.post(`/advances/${a.id}/approve`); toast('تم اعتماد العهدة', 'ok'); refresh(); }
        catch (err) { toast(err.message, 'err'); }
      } });
  if (Store.can('settlements.create') && !a.is_void && a.approval_status === 'approved')
    btns.push({ label: '＋ إخلاء', cls: 'btn-primary', onClick: () => { close(); settlementForm({ advance_id: a.id, advance_no: a.advance_no, remaining: Number(a.remaining_balance) }, refresh); } });
  if (Store.can('advances.update') && !a.is_void && a.computed_status !== 'closed')
    btns.push({ label: '🔒 إغلاق العهدة', onClick: async () => {
        const r = await confirmDialog({
          title: 'إغلاق العهدة', requireReason: Number(a.remaining_balance) > 0.005,
          reasonLabel: 'سبب الإغلاق مع وجود رصيد',
          message: Number(a.remaining_balance) > 0.005
            ? `العهد ${a.advance_no} لها رصيد غير مسوَّى قدره ${money(a.remaining_balance)} ${CUR}. الإغلاق سيتطلب تأكيدًا وسيسجَّل في سجل العمليات.`
            : `سيتم إغلاق العهدة ${a.advance_no} (الرصيد صفر).`,
          confirmLabel: 'إغلاق'
        });
        if (!r.ok) return;
        try { await Api.post(`/advances/${a.id}/close`, { confirm: true, reason: r.reason }); toast('تم إغلاق العهدة', 'ok'); refresh(); }
        catch (err) { toast(err.message, 'err'); }
      } });
  if (Store.can('advances.update') && !a.is_void && a.status === 'closed')
    btns.push({ label: '↺ إعادة فتح', onClick: async () => {
        try { await Api.post(`/advances/${a.id}/reopen`); toast('تمت إعادة الفتح', 'ok'); refresh(); } catch (err) { toast(err.message, 'err'); }
      } });
  if (Store.can('advances.void') && !a.is_void)
    btns.push({ label: '⊘ إلغاء العهدة', cls: 'btn-danger', onClick: async () => {
        const r = await confirmDialog({ title: 'إلغاء العهدة', message: `سيتم إلغاء العهدة ${a.advance_no} (لن تُحذف نهائيًا).`, requireReason: true, reasonLabel: 'سبب الإلغاء', danger: true, confirmLabel: 'إلغاء العهدة' });
        if (!r.ok) return;
        try { await Api.post(`/advances/${a.id}/void`, { reason: r.reason }); toast('تم إلغاء العهدة', 'ok'); refresh(); }
        catch (err) { toast(err.message, 'err'); }
      } });
  btns.push({ label: 'إغلاق' });
  return btns;
}

function dItem(k, v) { return `<div class="d-item"><div class="k">${esc(k)}</div><div class="v">${v === undefined || v === null || v === '' ? '—' : v}</div></div>`; }

function bindTabs(root) {
  root.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      root.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      root.querySelectorAll('[data-pane]').forEach(p => p.style.display = p.dataset.pane === t.dataset.tab ? '' : 'none');
    };
  });
}

/* ────────────── المرفقات ────────────── */
function filesHTML(list, entityType, entityId) {
  if (!list.length) return `<div class="empty small">لا توجد مرفقات</div>`;
  const icons = { 'application/pdf': '📕', 'image/jpeg': '🖼', 'image/png': '🖼' };
  return `<div class="attach-list">${list.map(f => `
    <div class="attach-item">
      <span class="fa">${icons[f.mime_type] || '📎'}</span>
      <div style="min-width:0"><div class="fn">${esc(f.file_name)}</div>
        <div class="fm">${esc(f.description || f.kind || '')} · ${((f.size_bytes || 0) / 1024).toFixed(0)} KB · ${fmtDateTime(f.created_at)}</div></div>
      <div class="spacer"></div>
      <a class="btn btn-sm" href="/api/attachments/${f.id}/download?token=${encodeURIComponent(Store.token)}" target="_blank">فتح</a>
      ${Store.can('attachments.delete') ? `<button class="btn btn-sm btn-ghost" data-delfile="${f.id}">حذف</button>` : ''}
    </div>`).join('')}</div>`;
}

function uploadHTML(entityType, entityId) {
  return `<div class="dropzone mt" data-drop="${entityType}:${entityId}">
    📎 اسحب الملفات هنا أو اضغط للاختيار<br>
    <span class="small">PDF، صور، Word، Excel — حتى ${15} ميجابايت</span>
    <input type="file" style="display:none" data-fileinput>
  </div>`;
}

function bindUpload(root, onDone) {
  root.querySelectorAll('[data-drop]').forEach(dz => {
    const [entityType, entityId] = dz.dataset.drop.split(':');
    const input = dz.querySelector('[data-fileinput]');
    dz.onclick = () => input.click();
    input.onchange = () => input.files[0] && doUpload(entityType, entityId, input.files[0], onDone);
    ['dragover', 'dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
      e.preventDefault();
      dz.classList.toggle('over', ev === 'dragover');
      if (ev === 'drop' && e.dataTransfer.files[0]) doUpload(entityType, entityId, e.dataTransfer.files[0], onDone);
    }));
  });
  root.querySelectorAll('[data-delfile]').forEach(b => {
    b.onclick = async () => {
      const r = await confirmDialog({ title: 'حذف المرفق', message: 'سيُعلَّم المرفق كمحذوف (لا حذف نهائي للبيانات).', requireReason: true, reasonLabel: 'سبب الحذف', danger: true, confirmLabel: 'حذف' });
      if (!r.ok) return;
      try { await Api.post(`/attachments/${b.dataset.delfile}/void`, { reason: r.reason }); toast('تم حذف المرفق', 'ok'); onDone && onDone(); }
      catch (err) { toast(err.message, 'err'); }
    };
  });
}

async function doUpload(entityType, entityId, file, onDone) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('entity_type', entityType);
  fd.append('entity_id', entityId);
  fd.append('kind', 'document');
  try {
    await Api.post('/attachments', fd);
    toast('تم رفع المرفق', 'ok');
    onDone && onDone();
  } catch (err) { toast(err.message, 'err'); }
}
