/* ═══════════════════════════════════════════════════════════════
   الهيكل العام: التنقل، الشريط العلوي، تسجيل الدخول، بدء التشغيل
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const NAV = [
  { group: 'الرئيسية', items: [
    { route: '/dashboard', icon: '📊', label: 'لوحة التحكم', perm: 'dashboard.view' }
  ]},
  { group: 'العمليات المالية', items: [
    { route: '/transfers', icon: '💸', label: 'التحويلات', perm: 'transfers.view' },
    { route: '/advances', icon: '🧾', label: 'عهد المقاولين', perm: 'advances.view' },
    { route: '/settlements', icon: '✅', label: 'إخلاء العهد', perm: 'settlements.view' },
    { route: '/supplier-invoices', icon: '📄', label: 'فواتير الموردين', perm: 'supplier_invoices.view' },
    { route: '/payments', icon: '🏦', label: 'الدفعات', perm: 'payments.view' }
  ]},
  { group: 'الأطراف والتمويل', items: [
    { route: '/contractors', icon: '👷', label: 'المقاولون', perm: 'contractors.view' },
    { route: '/suppliers', icon: '🏭', label: 'الموردون', perm: 'suppliers.view' },
    { route: '/funding-sources', icon: '💰', label: 'مصادر التمويل', perm: 'funding_sources.view' }
  ]},
  { group: 'التقارير والرقابة', items: [
    { route: '/reports', icon: '📈', label: 'التقارير', perm: 'reports.view' },
    { route: '/reconciliation', icon: '🔗', label: 'المطابقة', perm: 'reconciliation.view' },
    { route: '/audit-logs', icon: '🕘', label: 'سجل العمليات', perm: 'audit_logs.view' }
  ]},
  { group: 'الإدارة', items: [
    { route: '/admin', icon: '⚙️', label: 'إعدادات النظام', perm: 'settings.view' }
  ]}
];

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  Store.theme = theme;
  localStorage.setItem('oy_theme', theme);
}

function renderLogin() {
  const root = document.getElementById('root');
  root.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm">
        <div class="login-logo">
          <div class="brand-mark">ع ع</div>
          <div><h1>نظام أرض العيينة المحاسبي</h1><p>إدارة عهد المقاولين والتحويلات وإخلاء العهد</p></div>
        </div>
        <div class="field"><label>اسم المستخدم <span class="req">*</span></label>
          <input name="username" autocomplete="username" required autofocus></div>
        <div class="field"><label>كلمة المرور <span class="req">*</span></label>
          <input name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center;padding:10px;" type="submit">تسجيل الدخول</button>
        <div id="loginMsg"></div>
        <div class="login-foot">
          نظام محاسبي مترابط · مصدر التمويل → التحويل → العهدة → الإخلاء<br>
          جميع الأرصدة تُحتسب تلقائيًا من العمليات المسجلة
        </div>
      </form>
    </div>`;
  applyTheme(Store.theme);
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'جارٍ التحقق...';
    const msg = document.getElementById('loginMsg');
    msg.innerHTML = '';
    try {
      const data = await Api.post('/auth/login', readForm(e.target), { allowUnauthorized: true });
      Store.setSession(data.token, data.user);
      Store.environment = data.environment;
      toast(`مرحبًا ${data.user.fullName}`, 'ok');
      await bootShell();
      location.hash = '#/dashboard';
      Router.resolve();
    } catch (err) {
      msg.innerHTML = `<div class="alert danger" style="margin-top:12px">${esc(err.message)}</div>`;
      btn.disabled = false; btn.textContent = 'تسجيل الدخول';
    }
  };
}

function renderShell() {
  const root = document.getElementById('root');
  const navHTML = NAV.map(g => {
    const items = g.items.filter(i => Store.can(i.perm));
    if (!items.length) return '';
    return `<div class="nav-group"><div class="nav-title">${esc(g.group)}</div>
      ${items.map(i => `<div class="nav-item" data-route="${i.route}"><span class="ico">${i.icon}</span><span>${esc(i.label)}</span><span class="badge-count" data-badge="${i.route}" style="display:none"></span></div>`).join('')}
    </div>`;
  }).join('');

  root.innerHTML = `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-mark">ع ع</div>
          <div class="brand-text"><h1>أرض العيينة</h1><p>النظام المحاسبي المتكامل</p></div>
        </div>
        <nav class="nav">${navHTML}</nav>
        <div class="sidebar-foot">
          <span>الإصدار 1.0.0</span>
          <span class="env-badge ${Store.environment === 'demo' ? 'demo' : ''}">${Store.environment === 'demo' ? 'DEMO' : 'LIVE'}</span>
        </div>
      </aside>
      <div class="main">
        ${Store.environment === 'demo' ? '<div class="demo-banner">⚠ بيئة تجريبية (DEMO) — البيانات المعروضة للاختبار فقط وليست عمليات حقيقية</div>' : ''}
        <header class="topbar">
          <button class="menu-toggle" id="menuToggle">☰</button>
          <div>
            <div class="topbar-title" id="pageTitle">لوحة التحكم</div>
            <div class="topbar-sub" id="pageSub">مشروع أرض العيينة</div>
          </div>
          <div class="spacer"></div>
          <div class="searchbox">
            <input id="globalSearch" placeholder="بحث شامل: رقم عهدة، تحويل، فاتورة، مقاول، مورد..." autocomplete="off">
            <span class="s-ico">🔍</span>
            <div class="search-results" id="searchResults"></div>
          </div>
          <button class="btn btn-sm btn-ghost" id="themeBtn" title="الوضع الليلي">🌙</button>
          <div class="menu">
            <div class="avatar" id="userBtn">${esc((Store.user?.fullName || '?').trim().charAt(0))}</div>
            <div class="menu-pop" id="userMenu">
              <div style="padding:9px 11px;border-bottom:1px solid var(--border);margin-bottom:5px;">
                <div style="font-weight:700;font-size:13px;">${esc(Store.user?.fullName || '')}</div>
                <div class="small muted">@${esc(Store.user?.username || '')} · ${esc(Store.user?.roleName || '')}</div>
              </div>
              <button data-act="password">🔑 تغيير كلمة المرور</button>
              ${Store.can('settings.view') ? '<button data-act="admin">⚙️ إعدادات النظام</button>' : ''}
              <hr><button data-act="logout">🚪 تسجيل الخروج</button>
            </div>
          </div>
        </header>
        <main class="content" id="view"></main>
      </div>
    </div>`;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.onclick = () => Router.go('#' + el.dataset.route);
  });
  document.getElementById('menuToggle').onclick = () => {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('open');
    let bd = document.querySelector('.backdrop');
    if (sb.classList.contains('open')) {
      if (!bd) { bd = document.createElement('div'); bd.className = 'backdrop'; document.body.appendChild(bd); }
      bd.onclick = () => { sb.classList.remove('open'); bd.remove(); };
    } else bd?.remove();
  };
  document.getElementById('themeBtn').onclick = () => {
    applyTheme(Store.theme === 'dark' ? 'light' : 'dark');
    document.getElementById('themeBtn').textContent = Store.theme === 'dark' ? '☀️' : '🌙';
  };
  document.getElementById('themeBtn').textContent = Store.theme === 'dark' ? '☀️' : '🌙';

  const userBtn = document.getElementById('userBtn');
  const userMenu = document.getElementById('userMenu');
  userBtn.onclick = (e) => { e.stopPropagation(); userMenu.classList.toggle('open'); };
  document.addEventListener('click', () => userMenu.classList.remove('open'));
  userMenu.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      userMenu.classList.remove('open');
      const act = b.dataset.act;
      if (act === 'logout') doLogout();
      else if (act === 'admin') Router.go('#/admin');
      else if (act === 'password') changePasswordDialog();
    };
  });

  bindGlobalSearch();
}

async function doLogout() {
  const r = await confirmDialog({ title: 'تسجيل الخروج', message: 'هل تريد تسجيل الخروج من النظام؟', confirmLabel: 'خروج', danger: true });
  if (!r.ok) return;
  try { await Api.post('/auth/logout'); } catch { /* ignore */ }
  Store.clear();
  renderLogin();
}

function changePasswordDialog() {
  const m = modal({
    title: 'تغيير كلمة المرور', size: 'narrow',
    body: formHTML([
      { name: 'old_password', label: 'كلمة المرور الحالية', type: 'password', required: true },
      { name: 'new_password', label: 'كلمة المرور الجديدة', type: 'password', required: true, help: '8 أحرف على الأقل' },
      { name: 'confirm_password', label: 'تأكيد كلمة المرور', type: 'password', required: true }
    ]),
    buttons: [
      { label: 'حفظ', cls: 'btn-primary', onClick: async (el) => {
          const v = readForm(el);
          if (v.new_password !== v.confirm_password) { toast('كلمتا المرور غير متطابقتين', 'err'); return; }
          try {
            await Api.post('/auth/change-password', { old_password: v.old_password, new_password: v.new_password });
            closeModal(el); toast('تم تغيير كلمة المرور', 'ok');
          } catch (err) { toast(err.message, 'err'); }
        } },
      { label: 'إلغاء' }
    ]
  });
}

/* ────────────── البحث الشامل ────────────── */
let searchTimer = null;
function bindGlobalSearch() {
  const input = document.getElementById('globalSearch');
  const box = document.getElementById('searchResults');
  if (!input) return;
  input.oninput = () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2) { box.classList.remove('open'); box.innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const data = await Api.get('/search' + qs({ q, limit: 6 }));
        if (!data.groups.length) {
          box.innerHTML = `<div class="sr-group"><div class="sr-head">لا توجد نتائج لـ «${esc(q)}»</div></div>`;
        } else {
          box.innerHTML = data.groups.map(g => `
            <div class="sr-group"><div class="sr-head">${esc(g.label)} (${g.count})</div>
              ${g.rows.map(r => `<div class="sr-item" data-goto="${esc(g.link)}" data-id="${r.id}">
                <span class="t">${esc(r.title)}</span><span class="s">${esc(r.subtitle || '')}</span>
                ${r.amount ? `<span class="amt">${money(r.amount)}</span>` : ''}</div>`).join('')}
            </div>`).join('');
        }
        box.classList.add('open');
        box.querySelectorAll('[data-goto]').forEach(el => {
          el.onclick = () => { box.classList.remove('open'); input.value = ''; Router.go(el.dataset.goto); };
        });
      } catch (e) { /* ignore */ }
    }, 260);
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.searchbox')) box.classList.remove('open'); });
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const q = input.value.trim();
      if (q) { box.classList.remove('open'); Router.go('#/reports?key=advances&search=' + encodeURIComponent(q)); }
    }
  };
}

/** تحديث شارات التنبيهات في القائمة الجانبية */
async function refreshBadges() {
  try {
    const d = await Api.get('/dashboard');
    const map = {
      '/transfers': d.alerts.transfers_pending_approval,
      '/advances': d.alerts.advances_pending_approval,
      '/settlements': d.alerts.settlements_pending,
      '/supplier-invoices': d.alerts.invoices_pending
    };
    Object.entries(map).forEach(([route, n]) => {
      const el = document.querySelector(`[data-badge="${route}"]`);
      if (!el) return;
      if (n > 0) { el.textContent = n; el.style.display = ''; } else el.style.display = 'none';
    });
    window.__alerts = d.alerts;
  } catch { /* ignore */ }
}

const PAGE_TITLES = {
  '/dashboard': ['لوحة التحكم', 'نظرة شاملة على الحركة المالية للمشروع'],
  '/transfers': ['التحويلات المالية', 'كل التحويلات المرتبطة بمصادر التمويل'],
  '/advances': ['عهد المقاولين', 'متابعة العهد وأرصدتها المتبقية'],
  '/settlements': ['إخلاء العهد', 'فواتير الإخلاء والاعتماد'],
  '/supplier-invoices': ['فواتير الموردين', 'الفواتير والمدفوع والمتبقي'],
  '/payments': ['الدفعات', 'ربط الدفعات بالتحويلات والفواتير'],
  '/contractors': ['المقاولون', 'بيانات المقاولين وأرصدتهم'],
  '/suppliers': ['الموردون', 'بيانات الموردين ومستحقاتهم'],
  '/funding-sources': ['مصادر التمويل', 'جاري الشريك، أوتك، النقليات وغيرها'],
  '/reports': ['التقارير', 'تقارير مالية قابلة للتصدير'],
  '/reconciliation': ['تقرير المطابقة', 'كشف العمليات غير المرتبطة'],
  '/audit-logs': ['سجل العمليات', 'تتبع كل الإضافة والتعديل والاعتماد'],
  '/admin': ['إعدادات النظام', 'المشاريع، الحسابات، المستخدمون، الصلاحيات']
};

async function bootShell() {
  renderShell();
  try { await ensureMeta(); } catch (e) { console.warn('meta', e); }
  refreshBadges();
}

/* ────────────── بدء التشغيل ────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  applyTheme(Store.theme);
  if (!Store.token) { renderLogin(); return; }
  try {
    const me = await Api.get('/auth/me');
    Store.user = me.user; Store.environment = me.environment;
    localStorage.setItem('oy_user', JSON.stringify(me.user));
  } catch { renderLogin(); return; }
  await bootShell();
  window.addEventListener('hashchange', () => Router.resolve());
  Router.resolve();
});

/* تحديث عنوان الصفحة بعد كل تنقل */
const _origResolve = Router.resolve.bind(Router);
Router.resolve = function () {
  _origResolve();
  const key = this.current ? this.current.key : '/dashboard';
  const [t, s] = PAGE_TITLES[key] || ['', ''];
  const pt = document.getElementById('pageTitle');
  const ps = document.getElementById('pageSub');
  if (pt) pt.textContent = t;
  if (ps) ps.textContent = s;
};
