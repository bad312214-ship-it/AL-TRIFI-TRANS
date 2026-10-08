/* ═══════════════════════════════════════════════════════════════
   لوحة التحكم — مؤشرات مشروع أرض العيينة
   ═══════════════════════════════════════════════════════════════ */
'use strict';

function kpiCard({ label, value, icon, color, foot, unit = CUR }) {
  return `<div class="kpi" style="--k:${color}">
    <div class="kpi-top"><div class="kpi-ico">${icon}</div><div class="kpi-label">${esc(label)}</div></div>
    <div class="kpi-value">${esc(value)}<span class="kpi-unit">${esc(unit)}</span></div>
    ${foot ? `<div class="kpi-foot">${foot}</div>` : ''}
  </div>`;
}

Router.register('/dashboard', async ({ query, container }) => {
  await ensureMeta();
  const projectId = query.project_id || defaultProjectId() || '';
  const from = query.from || '';
  const to = query.to || '';

  const d = await Api.get('/dashboard' + qs({ project_id: projectId, from, to }));
  const k = d.kpis;
  const projName = d.project ? d.project.name : 'كل المشاريع';

  const fsRows = d.funding_sources;
  const fsTotal = fsRows.reduce((s, r) => s + (r.total_transfers || 0), 0);

  container.innerHTML = `
    ${Store.environment === 'demo' ? `<div class="alert warn"><b>بيئة تجريبية.</b> الأرقام أدناه مأخوذة من بيانات Demo ولا تمثل عمليات حقيقية. للبدء ببيانات حقيقية شغّل النظام بوضع production.</div>` : ''}
    ${pageHead(`لوحة تحكم — ${projName}`, 'كل الأرقام محسوبة لحظيًا من العمليات المسجلة في النظام', `
      <div class="field" style="min-width:150px"><label>المشروع</label>
        <select id="fProject">${projectOptions().map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(projectId) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
      <div class="field" style="min-width:140px"><label>من تاريخ</label><input type="date" id="fFrom" value="${esc(from)}"></div>
      <div class="field" style="min-width:140px"><label>إلى تاريخ</label><input type="date" id="fTo" value="${esc(to)}"></div>
      <button class="btn btn-sm" id="fReset">إلغاء الفترة</button>
    `)}

    <div class="kpi-grid">
      ${kpiCard({ label: 'إجمالي التحويلات', value: money(k.transfers.total), icon: '💸', color: '#1d4ed8', foot: `${int(k.transfers.count)} عملية${k.transfers.pending ? ` · <b>${money(k.transfers.pending)}</b> بانتظار الاعتماد` : ''}` })}
      ${kpiCard({ label: 'إجمالي عهد المقاولين', value: money(k.advances.total), icon: '🧾', color: '#0f766e', foot: `${int(k.advances.count)} عهدة` })}
      ${kpiCard({ label: 'رصيد العهد القائمة', value: money(k.advances.open_amount), icon: '⏳', color: '#b45309', foot: `${int(k.advances.open_count)} عهدة غير مغلقة · أصل ${money(k.advances.open_principal)}` })}
      ${kpiCard({ label: 'العهد المغلقة', value: money(k.advances.closed_amount), icon: '✅', color: '#15803d', foot: `${int(k.advances.closed_count)} عهدة مسوَّاة بالكامل` })}
      ${kpiCard({ label: 'إجمالي إخلاءات العهد', value: money(k.settlements.total), icon: '🧮', color: '#6d28d9', foot: `${int(k.settlements.count)} فاتورة إخلاء${k.settlements.pending ? ` · <b>${money(k.settlements.pending)}</b> معلّقة` : ''}` })}
      ${kpiCard({ label: 'إجمالي فواتير الموردين', value: money(k.supplier_invoices.total), icon: '📄', color: '#0891b2', foot: `${int(k.supplier_invoices.count)} فاتورة` })}
      ${kpiCard({ label: 'المدفوع للموردين', value: money(k.suppliers.paid), icon: '🏦', color: '#15803d', foot: `نسبة السداد ${pct(k.supplier_invoices.total ? (k.suppliers.paid / k.supplier_invoices.total) * 100 : 0)}` })}
      ${kpiCard({ label: 'المستحق للموردين', value: money(k.suppliers.due), icon: '⚠️', color: '#b91c1c', foot: 'مبالغ غير مسددة بعد' })}
    </div>

    <div class="card mb">
      <div class="card-head"><h3>💰 تحليل مصادر التمويل</h3>
        <span class="hint">إجمالي التمويل ${money(fsTotal)} ${CUR} — من أي مصدر تم تمويل المشروع</span>
        <div class="spacer"></div><a class="btn btn-sm" href="#/funding-sources">تفاصيل المصادر</a></div>
      <div class="card-body flush">
        ${tableHTML({
          columns: [
            { key: 'name', label: 'مصدر التمويل', render: r => `<div class="cell-main">${esc(r.name)}</div><div class="cell-sub">${esc(r.code)}</div>` },
            { key: 'transfers_count', label: 'عدد التحويلات', num: true, render: r => int(r.transfers_count) },
            { key: 'total_transfers', label: 'إجمالي التحويلات', num: true, render: r => `<b>${money(r.total_transfers)}</b>` },
            { key: 'to_advances', label: 'إلى العهد', num: true, render: r => money(r.to_advances) },
            { key: 'to_suppliers', label: 'إلى الموردين', num: true, render: r => money(r.to_suppliers) },
            { key: 'to_other', label: 'أخرى', num: true, render: r => money(r.to_other) },
            { key: 'pending_transfers', label: 'بانتظار الاعتماد', num: true, render: r => r.pending_transfers ? `<span class="pill pill-warn">${money(r.pending_transfers)}</span>` : '<span class="muted">—</span>' },
            { key: 'pct', label: 'النسبة', num: true, render: r => pct(fsTotal ? (r.total_transfers / fsTotal) * 100 : 0) }
          ],
          rows: fsRows,
          totals: { total_transfers: fsTotal, to_advances: fsRows.reduce((s, r) => s + r.to_advances, 0), to_suppliers: fsRows.reduce((s, r) => s + r.to_suppliers, 0), to_other: fsRows.reduce((s, r) => s + r.to_other, 0), pending_transfers: fsRows.reduce((s, r) => s + r.pending_transfers, 0) },
          emptyText: 'لا توجد تحويلات مسجَّلة بعد'
        })}
      </div>
    </div>

    <div class="chart-row">
      <div class="card"><div class="card-head"><h3>🍩 توزيع العهد حسب الحالة</h3></div>
        <div class="card-body">${donutChart([
          { label: 'مفتوحة (لم تُخلى)', value: d.charts.status_distribution.open_amount || 0, color: '#1d4ed8' },
          { label: 'مغلقة جزئيًا', value: d.charts.status_distribution.partial_amount || 0, color: '#b45309' },
          { label: 'مغلقة بالكامل', value: d.charts.status_distribution.closed_amount || 0, color: '#15803d' }
        ], { centerLabel: 'إجمالي العهد', centerValue: money(k.advances.total) })}</div></div>

      <div class="card"><div class="card-head"><h3>📅 حركة التحويلات الشهرية</h3><span class="hint">آخر 6 أشهر</span></div>
        <div class="card-body">${columnChart(d.charts.monthly_transfers.map(m => ({ month: m.month, amount: m.amount })))}</div></div>
    </div>

    <div class="chart-row">
      <div class="card"><div class="card-head"><h3>👷 أعلى المقاولين بالعهود</h3></div>
        <div class="card-body">${barsChart(d.charts.top_contractors.map(c => ({ name: c.name, amount: c.total_advances })))}</div></div>
      <div class="card"><div class="card-head"><h3>🚨 عمليات تحتاج مراجعة</h3>
        <div class="spacer"></div><a class="btn btn-sm" href="#/reconciliation">تقرير المطابقة الكامل</a></div>
        <div class="card-body"><div class="alerts-grid">
          ${alertBox(d.alerts.transfers_pending_approval, 'تحويلات بانتظار الاعتماد', '/transfers?approval_status=pending', 'warm')}
          ${alertBox(d.alerts.advances_pending_approval, 'عهد بانتظار الاعتماد', '/advances?approval_status=pending', 'warm')}
          ${alertBox(d.alerts.settlements_pending, 'إخلاءات معلّقة', '/settlements?approval_status=pending', 'warm')}
          ${alertBox(d.alerts.invoices_pending, 'فواتير موردين بانتظار الاعتماد', '/supplier-invoices?approval_status=pending', 'warm')}
          ${alertBox(d.alerts.advances_unsettled, 'عهد برصيد غير مسوَّى', '/reconciliation', 'cool')}
          ${alertBox(d.alerts.over_settlements, 'إخلاءات تجاوزت الرصيد', '/settlements?over_only=1', 'hot')}
          ${alertBox(d.alerts.overdue_invoices, 'فواتير موردين متأخرة', '/supplier-invoices?overdue_only=1', 'hot')}
        </div></div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>🕘 آخر العمليات</h3><div class="spacer"></div><a class="btn btn-sm" href="#/audit-logs">السجل الكامل</a></div>
      <div class="card-body"><div class="timeline">
        ${d.activity.length ? d.activity.map(a => `
          <div class="tl-item">
            <div class="tl-t">${pill(a.action === 'void' ? 'void_action' : a.action)} ${esc(a.summary || '')}</div>
            <div class="tl-m">${esc(a.username || '')} · ${fmtDateTime(a.created_at)}</div>
          </div>`).join('') : '<div class="muted small">لا توجد عمليات بعد — ابدأ بتسجيل تحويل أو عهدة.</div>'}
      </div></div>
    </div>`;

  const apply = () => {
    const p = document.getElementById('fProject').value;
    const f = document.getElementById('fFrom').value;
    const t = document.getElementById('fTo').value;
    Router.go(`#/dashboard${qs({ project_id: p, from: f, to: t })}`);
  };
  ['fProject', 'fFrom', 'fTo'].forEach(id => document.getElementById(id).onchange = apply);
  document.getElementById('fReset').onclick = () => Router.go(`#/dashboard${qs({ project_id: projectId })}`);
});

function alertBox(n, label, href, tone = 'cool') {
  return `<a class="alert-box ${tone}" href="#${href}"><span class="n">${int(n)}</span><span class="l">${esc(label)}</span></a>`;
}
