/* ═══════════════════════════════════════════════════════════════
   النواة: API + الحالة + مكوّنات الواجهة + الرسوم + الراوتر
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ────────────── الحالة العامة ────────────── */
const Store = {
  token: localStorage.getItem('oy_token') || null,
  user: JSON.parse(localStorage.getItem('oy_user') || 'null'),
  meta: null,
  theme: localStorage.getItem('oy_theme') || 'light',
  filters: {},          // فلاتر محفوظة لكل صفحة
  setSession(token, user) {
    this.token = token; this.user = user;
    localStorage.setItem('oy_token', token);
    localStorage.setItem('oy_user', JSON.stringify(user));
  },
  clear() {
    this.token = null; this.user = null; this.meta = null;
    localStorage.removeItem('oy_token'); localStorage.removeItem('oy_user');
  },
  can(perm) {
    if (!this.user) return false;
    if (this.user.role === 'admin') return true;
    return (this.user.permissions || []).includes(perm);
  },
  anyPerm(...list) { return list.some(p => this.can(p)); }
};

/* ────────────── الاتصال بالخادم ────────────── */
class ApiError extends Error {
  constructor(message, status, code, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

const Api = {
  base: '/api',
  async request(method, path, body, opts = {}) {
    const headers = {};
    if (Store.token) headers['Authorization'] = `Bearer ${Store.token}`;
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(this.base + path, {
        method, headers,
        body: body === undefined ? undefined : (body instanceof FormData ? body : JSON.stringify(body))
      });
    } catch (e) {
      throw new ApiError('تعذَّر الاتصال بالخادم. تحقق من تشغيل الخدمة.', 0, 'NETWORK');
    }
    if (res.status === 401 && !opts.allowUnauthorized) {
      Store.clear();
      if (location.hash !== '#/login') location.hash = '#/login';
      throw new ApiError('انتهت الجلسة — يرجى تسجيل الدخول', 401, 'UNAUTHORIZED');
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok || (data && data.ok === false)) {
      const err = (data && data.error) || {};
      throw new ApiError(err.message || `خطأ ${res.status}`, res.status, err.code, err.details);
    }
    return data && data.data !== undefined ? data.data : data;
  },
  get(p) { return this.request('GET', p); },
  post(p, b) { return this.request('POST', p, b || {}); },
  put(p, b) { return this.request('PUT', p, b || {}); },
  /** تنزيل ملف (تصدير) */
  async download(path, filename) {
    const res = await fetch(this.base + path, { headers: Store.token ? { Authorization: `Bearer ${Store.token}` } : {} });
    if (!res.ok) {
      let msg = `خطأ ${res.status}`;
      try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* ignore */ }
      throw new ApiError(msg, res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
  }
};

function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.append(k, v);
  });
  const s = p.toString();
  return s ? '?' + s : '';
}

/* ────────────── أدوات التنسيق ────────────── */
const CUR = 'ريال';
function money(v, withUnit = false) {
  const n = Number(v || 0);
  const s = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withUnit ? `${s} ${CUR}` : s;
}
function num(v) { return Number(v || 0).toLocaleString('en-US'); }
function int(v) { return Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
function pct(v) { return `${Number(v || 0).toFixed(1)}%`; }
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function today() { return new Date().toISOString().slice(0, 10); }
function monthStart(offset = 0) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 10);
}
function fmtDateTime(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z'));
  if (isNaN(d)) return s;
  return d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}
function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
function daysFromNow(s) { return Math.floor((new Date(s) - new Date()) / 86400000); }

/* ────────────── شارات الحالة ────────────── */
const STATUS_PILLS = {
  open: ['pill-info', 'مفتوحة'],
  under_settlement: ['pill-warn', 'تحت الإخلاء'],
  partially_closed: ['pill-purple', 'مغلقة جزئيًا'],
  closed: ['pill-ok', 'مغلقة'],
  draft: ['pill-muted', 'مسودة'],
  pending: ['pill-warn', 'بانتظار الاعتماد'],
  approved: ['pill-ok', 'معتمدة'],
  rejected: ['pill-danger', 'مرفوضة'],
  reviewed: ['pill-ok', 'تمت المراجعة'],
  returned: ['pill-warn', 'مُعاد'],
  unpaid: ['pill-danger', 'غير مدفوعة'],
  partial: ['pill-warn', 'مدفوعة جزئيًا'],
  paid: ['pill-ok', 'مدفوعة بالكامل'],
  void: ['pill-muted', 'ملغاة'],
  advance: ['pill-brand', 'عهدة مقاول'],
  supplier: ['pill-purple', 'مورد'],
  other: ['pill-muted', 'أخرى'],
  supplier_invoice: ['pill-brand', 'سداد فاتورة'],
  advance_payment: ['pill-purple', 'دفعة مقدمة'],
  contractor: ['pill-brand', 'مقاول'],
  high: ['pill-danger', 'عالية'],
  medium: ['pill-warn', 'متوسطة'],
  low: ['pill-info', 'منخفضة'],
  create: ['pill-ok', 'إضافة'],
  update: ['pill-info', 'تعديل'],
  approve: ['pill-ok', 'اعتماد'],
  review: ['pill-info', 'مراجعة'],
  reject: ['pill-danger', 'رفض'],
  void_action: ['pill-muted', 'إلغاء'],
  close: ['pill-ok', 'إغلاق'],
  reopen: ['pill-warn', 'إعادة فتح'],
  login: ['pill-info', 'دخول'],
  logout: ['pill-muted', 'خروج'],
  export: ['pill-purple', 'تصدير'],
  upload: ['pill-info', 'رفع مرفق'],
  over_settle: ['pill-danger', 'تجاوز رصيد'],
  reset_password: ['pill-warn', 'إعادة تعيين كلمة مرور'],
  purge: ['pill-danger', 'حذف سجلات'],
  download: ['pill-muted', 'تنزيل'],
  login_failed: ['pill-danger', 'دخول فاشل']
};
function pill(status, customText) {
  const [cls, label] = STATUS_PILLS[status] || ['pill-muted', status || '—'];
  return `<span class="pill ${cls}">${esc(customText || label)}</span>`;
}

/* ────────────── التنبيهات ────────────── */
function toast(message, type = 'info', sub = '') {
  let host = document.querySelector('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host); }
  const icons = { ok: '✓', err: '✕', warn: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="t-ico">${icons[type] || 'ℹ'}</div><div><div class="t-msg">${esc(message)}</div>${sub ? `<div class="t-sub">${esc(sub)}</div>` : ''}</div>`;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, type === 'err' ? 6500 : 3800);
}

/* ────────────── المودال ────────────── */
function closeModal(el) { if (el) el.remove(); }

/**
 * @param {object} o { title, body, size, buttons:[{label,cls,onClick,keepOpen}], onMount }
 */
function modal(o) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const buttons = (o.buttons || []).map((b, i) =>
    `<button class="btn ${b.cls || ''}" data-b="${i}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}</button>`).join('');
  backdrop.innerHTML = `
    <div class="modal ${o.size || ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(o.title || '')}</h3>${o.subtitle ? `<span class="small muted">${esc(o.subtitle)}</span>` : ''}<button class="x-btn" data-x>×</button></div>
      <div class="modal-body">${o.body || ''}</div>
      ${buttons ? `<div class="modal-foot">${buttons}</div>` : ''}
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('[data-x]').onclick = () => closeModal(backdrop);
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop && o.dismissable !== false) closeModal(backdrop); });
  document.addEventListener('keydown', function esc_(e) {
    if (e.key === 'Escape' && o.dismissable !== false) { closeModal(backdrop); document.removeEventListener('keydown', esc_); }
  });
  (o.buttons || []).forEach((b, i) => {
    const btn = backdrop.querySelector(`[data-b="${i}"]`);
    if (btn) btn.onclick = () => b.onClick ? b.onClick(backdrop) : closeModal(backdrop);
  });
  if (o.onMount) o.onMount(backdrop);
  const first = backdrop.querySelector('input:not([type=hidden]), select, textarea');
  if (first && o.autofocus !== false) setTimeout(() => first.focus(), 60);
  return backdrop;
}

/** حوار تأكيد */
function confirmDialog({ title, message, confirmLabel = 'تأكيد', cancelLabel = 'إلغاء', danger = false, requireReason = false, reasonLabel = 'السبب' }) {
  return new Promise(resolve => {
    let done = false;
    const m = modal({
      title, size: 'narrow',
      body: `<p style="margin:0 0 12px; font-size:13.5px;">${esc(message)}</p>
        ${requireReason ? `<div class="field"><label>${esc(reasonLabel)} <span class="req">*</span></label><textarea name="reason" placeholder="اكتب السبب..."></textarea></div>` : ''}`,
      buttons: [
        { label: confirmLabel, cls: danger ? 'btn-danger' : 'btn-primary', onClick: (el) => {
            if (requireReason) {
              const v = el.querySelector('[name=reason]').value.trim();
              if (!v) { toast('يجب كتابة السبب', 'err'); return; }
              done = true; closeModal(el); resolve({ ok: true, reason: v }); return;
            }
            done = true; closeModal(el); resolve({ ok: true });
          } },
        { label: cancelLabel, onClick: (el) => { done = true; closeModal(el); resolve({ ok: false }); } }
      ]
    });
    m.querySelector('.modal-backdrop, .modal')?.addEventListener('mousedown', () => { });
    const origClose = closeModal;
    setTimeout(() => { if (!done && !document.body.contains(m)) resolve({ ok: false }); }, 0);
    const observer = new MutationObserver(() => { if (!document.body.contains(m) && !done) { done = true; resolve({ ok: false }); observer.disconnect(); } });
    observer.observe(document.body, { childList: true });
  });
}

/* ────────────── بناء النماذج ────────────── */
function fieldHTML(f) {
  const val = f.value === undefined || f.value === null ? '' : f.value;
  const common = `name="${esc(f.name)}" ${f.required ? 'required' : ''} ${f.readonly ? 'readonly' : ''} ${f.disabled ? 'disabled' : ''} placeholder="${esc(f.placeholder || '')}"`;
  let control = '';
  if (f.type === 'select') {
    const opts = (f.options || []).map(o => {
      const ov = o.value ?? o, ol = o.label ?? o;
      return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`;
    }).join('');
    control = `<select ${common} ${f.multiple ? 'multiple' : ''}>${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${opts}</select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea ${common} rows="${f.rows || 3}">${esc(val)}</textarea>`;
  } else if (f.type === 'checkbox') {
    control = `<label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;">
      <input type="checkbox" name="${esc(f.name)}" ${val ? 'checked' : ''} style="width:auto;"> ${esc(f.checkLabel || '')}</label>`;
  } else {
    control = `<input type="${f.type || 'text'}" ${common} value="${esc(val)}" ${f.type === 'number' ? `step="${f.step || '0.01'}" min="${f.min ?? ''}"` : ''}>`;
  }
  if (f.type === 'section') return `<div class="section-title">${esc(f.label)}</div>`;
  return `<div class="field" data-field="${esc(f.name)}">
    ${f.label ? `<label>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>` : ''}
    ${control}
    ${f.help ? `<div class="help">${esc(f.help)}</div>` : ''}
  </div>`;
}

function formHTML(fields) {
  let out = '<div class="field-row">';
  for (const f of fields) {
    if (f.type === 'section') { out += `</div><div class="section-title">${esc(f.label)}</div><div class="field-row">`; continue; }
    out += fieldHTML(f);
  }
  return out + '</div>';
}

/** قراءة قيم النموذج */
function readForm(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach(el => {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.disabled) return;
    else out[el.name] = el.value.trim ? el.value.trim() : el.value;
  });
  return out;
}

function markFieldError(root, name, msg) {
  const f = root.querySelector(`[data-field="${name}"]`);
  if (!f) return;
  f.classList.add('error');
  let e = f.querySelector('.err-msg');
  if (!e) { e = document.createElement('div'); e.className = 'err-msg'; f.appendChild(e); }
  e.textContent = msg;
}
function clearFieldErrors(root) {
  root.querySelectorAll('.field.error').forEach(f => { f.classList.remove('error'); f.querySelector('.err-msg')?.remove(); });
}

/* ────────────── الجدول + الترقيم ────────────── */
/**
 * @param {object} cfg { columns:[{key,label,render,num,sortable}], rows, onRowClick, actions }
 */
function tableHTML(cfg) {
  if (!cfg.rows || !cfg.rows.length) {
    return `<div class="empty"><div class="big">🗂</div><div>${esc(cfg.emptyText || 'لا توجد سجلات مطابقة')}</div></div>`;
  }
  const head = cfg.columns.map(c =>
    `<th class="${c.num ? 'num' : ''} ${c.sortable ? 'sortable' : ''}" ${c.sortable ? `data-sort="${esc(c.key)}"` : ''}>${esc(c.label)}${c.sortable && cfg.sort === c.key ? ` <span class="sort-ind">${cfg.dir === 'desc' ? '▼' : '▲'}</span>` : ''}</th>`).join('');
  const body = cfg.rows.map((r, i) =>
    `<tr class="${cfg.onRowClick ? 'clickable' : ''}" data-i="${i}">${cfg.columns.map(c => {
      const v = c.render ? c.render(r, i) : esc(r[c.key]);
      return `<td class="${c.num ? 'num' : ''}">${v === undefined || v === null ? '' : v}</td>`;
    }).join('')}</tr>`).join('');
  let foot = '';
  if (cfg.totals) {
    foot = `<tfoot><tr>${cfg.columns.map((c, idx) => {
      if (idx === 0) return `<td>الإجمالي</td>`;
      if (cfg.totals[c.key] !== undefined) return `<td class="num">${money(cfg.totals[c.key])}</td>`;
      return '<td></td>';
    }).join('')}</tr></tfoot>`;
  }
  return `<div class="table-wrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`;
}

function pagerHTML(pg) {
  if (!pg || pg.totalPages <= 1) return `<div class="pager"><span>إجمالي السجلات: <b>${int(pg ? pg.total : 0)}</b></span></div>`;
  const btns = [];
  btns.push(`<button class="pg-btn" data-pg="${pg.page - 1}" ${pg.page <= 1 ? 'disabled' : ''}>›</button>`);
  const win = [];
  for (let i = 1; i <= pg.totalPages; i++) {
    if (i === 1 || i === pg.totalPages || Math.abs(i - pg.page) <= 2) win.push(i);
    else if (win[win.length - 1] !== '…') win.push('…');
  }
  for (const i of win) {
    btns.push(i === '…' ? `<span class="muted">…</span>` : `<button class="pg-btn ${i === pg.page ? 'active' : ''}" data-pg="${i}">${i}</button>`);
  }
  btns.push(`<button class="pg-btn" data-pg="${pg.page + 1}" ${pg.page >= pg.totalPages ? 'disabled' : ''}>‹</button>`);
  return `<div class="pager"><span>إجمالي السجلات: <b>${int(pg.total)}</b></span><div class="spacer"></div>${btns.join('')}
    <select class="pg-size" style="padding:4px 7px;border:1px solid var(--border);border-radius:7px;background:var(--bg-elev);color:var(--text);">
      ${[20, 50, 100, 200].map(n => `<option value="${n}" ${n === pg.pageSize ? 'selected' : ''}>${n} / صفحة</option>`).join('')}
    </select></div>`;
}

/** ربط أحداث الجدول والترقيم */
function bindTable(root, { onRowClick, onSort, onPage, onPageSize }) {
  root.querySelectorAll('tbody tr.clickable').forEach(tr => {
    tr.onclick = (e) => {
      if (e.target.closest('button, a, select, input')) return;
      onRowClick && onRowClick(Number(tr.dataset.i));
    };
  });
  root.querySelectorAll('th.sortable').forEach(th => {
    th.onclick = () => onSort && onSort(th.dataset.sort);
  });
  root.querySelectorAll('[data-pg]').forEach(b => { b.onclick = () => b.disabled || onPage(Number(b.dataset.pg)); });
  const size = root.querySelector('.pg-size');
  if (size) size.onchange = () => onPageSize(Number(size.value));
}

/* ────────────── الرسوم البيانية (SVG/CSS خالص) ────────────── */
function barsChart(data, { valueKey = 'amount', labelKey = 'name', color } = {}) {
  const max = Math.max(1, ...data.map(d => Number(d[valueKey] || 0)));
  if (!data.length) return `<div class="empty small">لا توجد بيانات</div>`;
  return `<div class="bars">${data.map(d => {
    const v = Number(d[valueKey] || 0);
    const w = (v / max) * 100;
    return `<div class="bar-row"><div class="lbl" title="${esc(d[labelKey])}">${esc(d[labelKey])}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${w}%;${color ? `background:${color}` : ''}"></div></div>
      <div class="val">${money(v)}</div></div>`;
  }).join('')}</div>`;
}

function donutChart(segments, { size = 132, thickness = 22, centerLabel, centerValue } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const circles = total > 0 ? segments.filter(s => s.value > 0).map(s => {
    const len = (s.value / total) * c;
    const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}"
      stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="butt"><title>${esc(s.label)}: ${money(s.value)}</title></circle>`;
    offset += len;
    return el;
  }).join('') : `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${thickness}"/>`;

  const legend = segments.map(s => `<div class="li"><span class="dot" style="background:${s.color}"></span><span>${esc(s.label)}</span><span class="lv">${money(s.value)}</span></div>`).join('');
  return `<div class="donut-wrap">
    <div style="position:relative;width:${size}px;height:${size}px;flex-shrink:0;">
      <svg width="${size}" height="${size}">${circles}</svg>
      <div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center;">
        <div><div class="small muted">${esc(centerLabel || '')}</div><div style="font-weight:800;font-size:15px;">${esc(centerValue || money(total))}</div></div>
      </div>
    </div>
    <div class="legend" style="flex:1;min-width:150px;">${legend}</div>
  </div>`;
}

function columnChart(data, { valueKey = 'amount', labelKey = 'month' } = {}) {
  if (!data.length) return `<div class="empty small">لا توجد بيانات</div>`;
  const max = Math.max(1, ...data.map(d => Number(d[valueKey] || 0)));
  return `<div class="sparkbars">${data.map(d => {
    const v = Number(d[valueKey] || 0);
    const h = Math.max(3, (v / max) * 100);
    const label = String(d[labelKey] || '');
    return `<div class="sb" title="${esc(label)}: ${money(v)}"><div class="vv">${v ? money(v).split('.')[0] : ''}</div>
      <div class="col" style="height:${h}%"></div><div class="cap">${esc(label.slice(2))}</div></div>`;
  }).join('')}</div>`;
}

/* ────────────── الراوتر ────────────── */
const Routes = {};
const Router = {
  current: null,
  register(path, handler) { Routes[path] = handler; },
  go(hash) { if (location.hash === hash) this.resolve(); else location.hash = hash; },
  resolve() {
    const raw = (location.hash || '#/dashboard').replace(/^#/, '');
    const [pathPart, queryPart] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean);
    const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
    const container = document.getElementById('view');
    if (!container) return;

    if (!Store.token) {
      if (pathPart !== '/login') { location.hash = '#/login'; return; }
    } else if (pathPart === '/login') {
      location.hash = '#/dashboard'; return;
    }

    const key = '/' + (parts[0] || 'dashboard');
    const handler = Routes[key] || Routes['/404'];
    this.current = { key, params: parts.slice(1), query, pathPart };
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === key || (el.dataset.route === '/advances' && key === '/advance'));
    });
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.backdrop')?.remove();
    container.innerHTML = `<div class="spinner"></div>`;
    window.scrollTo({ top: 0 });
    try {
      const r = handler({ params: parts.slice(1), query, container });
      if (r && typeof r.catch === 'function') r.catch(err => renderError(container, err));
    } catch (err) { renderError(container, err); }
  }
};

function renderError(container, err) {
  console.error(err);
  container.innerHTML = `<div class="card"><div class="card-body">
    <div class="alert danger"><b>حدث خطأ</b><br>${esc(err && err.message ? err.message : String(err))}</div>
    <button class="btn" onclick="Router.resolve()">إعادة المحاولة</button></div></div>`;
}

function pageHead(title, subtitle, actionsHTML = '') {
  return `<div class="page-head"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><div class="spacer"></div><div class="flex">${actionsHTML}</div></div>`;
}

/** شريط فلاتر موحّد */
function filtersBar(id, fields, { open = false } = {}) {
  return `<div class="card mb"><div class="card-head" style="cursor:pointer" data-toggle-filters>
      <h3>🔎 البحث والتصفية</h3><span class="hint">يمكنك الجمع بين أكثر من فلتر</span>
      <div class="spacer"></div><span class="btn btn-sm btn-ghost" data-toggle-filters>${open ? 'إخفاء ▲' : 'عرض ▼'}</span>
    </div>
    <div class="filters ${open ? '' : 'collapsed'}" id="${id}">${fields.map(fieldHTML).join('')}
      <div class="field" style="justify-content:flex-end;"><label>&nbsp;</label>
        <div class="flex"><button class="btn btn-primary btn-sm" data-apply>تطبيق</button>
        <button class="btn btn-sm" data-reset>مسح</button></div></div>
    </div></div>`;
}

function bindFilters(root, onChange) {
  root.querySelectorAll('[data-toggle-filters]').forEach(el => {
    el.onclick = () => {
      const box = root.querySelector('.filters');
      box.classList.toggle('collapsed');
      const btn = root.querySelector('[data-toggle-filters].btn');
      if (btn) btn.textContent = box.classList.contains('collapsed') ? 'عرض ▼' : 'إخفاء ▲';
    };
  });
  root.querySelector('[data-apply]')?.addEventListener('click', () => onChange(readForm(root.querySelector('.filters'))));
  root.querySelector('[data-reset]')?.addEventListener('click', () => {
    root.querySelectorAll('.filters [name]').forEach(el => { if (el.type === 'checkbox') el.checked = false; else el.value = ''; });
    onChange({});
  });
  root.querySelectorAll('.filters select, .filters input[type=date]').forEach(el => {
    el.addEventListener('change', () => onChange(readForm(root.querySelector('.filters'))));
  });
}

/* ────────────── قوائم الخيارات من البيانات المرجعية ────────────── */
async function ensureMeta() {
  if (Store.meta) return Store.meta;
  Store.meta = await Api.get('/meta');
  return Store.meta;
}
function projectOptions(extra = true) {
  const list = (Store.meta?.projects || []).map(p => ({ value: p.id, label: `${p.name}` }));
  return extra ? [{ value: '', label: 'كل المشاريع' }, ...list] : list;
}
function defaultProjectId() {
  const p = (Store.meta?.projects || []).find(x => x.is_default) || (Store.meta?.projects || [])[0];
  return p ? p.id : null;
}
function fundingOptions(extra = true) {
  const list = (Store.meta?.funding_sources || []).map(f => ({ value: f.id, label: f.name }));
  return extra ? [{ value: '', label: 'كل المصادر' }, ...list] : list;
}
function accountOptions(extra = true) {
  const list = (Store.meta?.accounts || []).filter(a => a.is_active).map(a => ({ value: a.id, label: `${a.code} — ${a.name}` }));
  return extra ? [{ value: '', label: '— اختياري —' }, ...list] : list;
}
function costCenterOptions(projectId, extra = true) {
  let list = (Store.meta?.cost_centers || []).filter(c => !projectId || Number(c.project_id) === Number(projectId));
  const opts = list.map(c => ({ value: c.id, label: `${c.code} — ${c.name}` }));
  return extra ? [{ value: '', label: 'المركز الرئيسي تلقائيًا' }, ...opts] : opts;
}
async function partyOptions(kind) {
  return await Api.get(`/options/${kind}`);
}
