/* App shell: router, toasts, shared helpers */
import { lang, setLang, t } from "./i18n.js";
import { renderStudio } from "./views/studio.js";
import { renderLibrary } from "./views/library.js";
import { renderProject } from "./views/project.js";
import { renderSettings } from "./views/settings.js";

const viewEl = document.getElementById("view");

/* ---------------- toasts ---------------- */
export function toast(message, kind = "ok", ms = 3800) {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function modal(html) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) root.innerHTML = "";
  });
  return root.querySelector(".modal");
}
export function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

/* ---------------- helpers ---------------- */
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function fmtDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}:${String(s).padStart(2, "0")}` : `${s} ث`;
}

export function statusBadge(status) {
  const labels = {
    draft: "مسودة", planning: "جارٍ كتابة السيناريو", planned: "جاهز للمراجعة",
    rendering: "جارٍ الإنتاج", done: "مكتمل", failed: "فشل",
  };
  const en = {
    draft: "Draft", planning: "Planning", planned: "Ready for review",
    rendering: "Rendering", done: "Done", failed: "Failed",
  };
  const text = lang() === "ar" ? labels[status] : en[status];
  return `<span class="badge dot ${status}">${text || status}</span>`;
}

/* ---------------- router ---------------- */
const routes = [
  { pattern: /^#?\/?$/, nav: "studio", render: renderStudio },
  { pattern: /^#\/projects\/([a-z0-9]+)$/i, nav: "projects", render: renderProject },
  { pattern: /^#\/projects$/, nav: "projects", render: renderLibrary },
  { pattern: /^#\/settings$/, nav: "settings", render: renderSettings },
];

export function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const h = location.hash || "#/";
  for (const r of routes) {
    const m = h.match(r.pattern);
    if (m) {
      document.querySelectorAll(".main-nav a").forEach((a) => {
        a.classList.toggle("active", a.dataset.nav === r.nav);
      });
      viewEl.innerHTML = `<div class="empty"><div class="big spin">⏳</div></div>`;
      try {
        await r.render(viewEl, ...(m.slice(1) || []));
      } catch (err) {
        viewEl.innerHTML = `<div class="empty"><div class="big">⚠️</div><p>${esc(err.message)}</p></div>`;
      }
      window.scrollTo({ top: 0 });
      return;
    }
  }
  navigate("#/");
}

/* ---------------- boot ---------------- */
function applyLang() {
  setLang(lang());
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18n);
  });
  const btn = document.getElementById("lang-toggle");
  btn.textContent = lang() === "ar" ? "EN" : "ع";
}

document.getElementById("lang-toggle").addEventListener("click", () => {
  setLang(lang() === "ar" ? "en" : "ar");
  applyLang();
  route();
});

window.addEventListener("hashchange", route);
applyLang();
route();
