/* Library view — all projects with status & progress */
import { api } from "../api.js";
import { t } from "../i18n.js";
import { esc, toast, statusBadge, navigate, modal, closeModal } from "../app.js";

export async function renderLibrary(root) {
  const projects = await api.listProjects();

  root.innerHTML = `
    <div class="panel-title">
      <h2>📚 ${t("projectsTitle")}</h2>
      <button class="btn primary" id="new-btn">＋ ${t("newProject")}</button>
    </div>
    ${
      projects.length === 0
        ? `<div class="empty"><div class="big">🎬</div><p>${t("noProjects")}</p></div>`
        : `<div class="grid c3">
            ${projects
              .map(
                (p) => `
              <div class="card project-card" data-id="${p.id}">
                <div class="poster">
                  ${p.poster_path ? `<img src="${esc(p.poster_path)}" alt="" />` : `<div class="ph">🎬</div>`}
                </div>
                <div class="body">
                  <h3>${esc(p.title)}</h3>
                  <div class="muted" style="margin-bottom:10px;">${esc(p.prompt.slice(0, 70))}…</div>
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                    ${statusBadge(p.status)}
                    <span class="muted">${p.duration_sec}s · ${esc(p.resolution)} · ${esc(p.aspect)}</span>
                  </div>
                  <div class="progress-wrap" style="margin:10px 0 0;">
                    <div class="progress-bar"><i style="width:${Math.round(p.progress * 100)}%"></i></div>
                  </div>
                  <div class="scene-actions">
                    <button class="btn sm open-btn">${t("open")}</button>
                    <button class="btn sm danger del-btn">${t("delete")}</button>
                  </div>
                </div>
              </div>`
              )
              .join("")}
          </div>`
    }
  `;

  root.querySelector("#new-btn")?.addEventListener("click", () => navigate("#/"));

  root.querySelectorAll(".project-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelector(".open-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      navigate(`#/projects/${id}`);
    });
    card.querySelector(".del-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const m = modal(`
        <h3>${t("confirmDelete")}</h3>
        <div class="scene-actions" style="margin-top:16px; justify-content:flex-end;">
          <button class="btn ghost" id="m-cancel">${t("delete") === "Delete" ? "Cancel" : "إلغاء"}</button>
          <button class="btn danger" id="m-ok">${t("delete")}</button>
        </div>`);
      m.querySelector("#m-cancel").onclick = closeModal;
      m.querySelector("#m-ok").onclick = async () => {
        await api.deleteProject(id);
        closeModal();
        toast(t("toasts.deleted"), "ok");
        renderLibrary(root);
      };
    });
    card.addEventListener("click", () => navigate(`#/projects/${id}`));
  });
}
