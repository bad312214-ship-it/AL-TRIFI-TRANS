/* Project workspace: screenplay · storyboard · production · preview */
import { api } from "../api.js";
import { t, tOpt, lang } from "../i18n.js";
import { esc, toast, statusBadge, navigate, modal, closeModal, fmtDuration } from "../app.js";

const STAGE_ORDER = ["planning", "characters", "environments", "shots", "voice", "music", "assembly", "qc", "done"];
const STAGE_ICONS = { planning: "🧠", characters: "👤", environments: "🏔", shots: "🎥", voice: "🎙", music: "🎵", assembly: "✂️", qc: "🔍", done: "🎬" };

export async function renderProject(root, id) {
  let project = await api.getProject(id);
  let activeTab = sessionStorage.getItem(`tab_${id}`) || "script";
  let es = null;

  const destroy = () => es && es.close();

  async function refresh() {
    project = await api.getProject(id);
  }

  function paint() {
    destroy();
    root.innerHTML = `
      <div class="panel-title">
        <div>
          <h2 id="p-title" contenteditable="true" spellcheck="false" style="outline:none;">${esc(project.title)}</h2>
          <div class="muted">${esc(project.prompt.slice(0, 120))}…</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${statusBadge(project.status)}
          ${project.status === "done" ? `<a class="btn primary sm" href="/api/projects/${id}/download">⬇ ${t("downloadMP4")}</a>` : ""}
          <button class="btn sm" id="delete-p">${t("delete")}</button>
        </div>
      </div>

      <div class="progress-wrap">
        <div class="progress-bar"><i id="p-bar" style="width:${Math.round(project.progress * 100)}%"></i></div>
        <div class="progress-meta">
          <span id="p-stage">${esc(t("stages." + project.stage) || project.stage)}</span>
          <span id="p-pct">${Math.round(project.progress * 100)}%</span>
        </div>
      </div>

      ${
        (project.warnings || []).length
          ? `<div class="warn-list">${project.warnings.map((w) => `<div class="warn-item">⚠️ ${esc(w)}</div>`).join("")}</div>`
          : ""
      }
      ${project.error ? `<div class="warn-item" style="color:var(--err); border-color:rgba(240,97,109,.35); background:rgba(240,97,109,.08);">❌ ${esc(project.error)}</div>` : ""}

      <div class="tabs">
        <button data-tab="script">📝 ${t("tabScript")}</button>
        <button data-tab="storyboard">🎞 ${t("tabStoryboard")}</button>
        <button data-tab="production">⚙️ ${t("tabProduction")}</button>
        <button data-tab="preview">▶️ ${t("tabPreview")}</button>
      </div>
      <div id="tab-content"></div>
    `;

    root.querySelector("#p-title").addEventListener("blur", async (e) => {
      const title = e.target.textContent.trim();
      if (title && title !== project.title) {
        await api.updateProject(id, { title });
        project.title = title;
        toast(t("toasts.saved"), "ok");
      }
    });

    root.querySelector("#delete-p").addEventListener("click", () => {
      const m = modal(`
        <h3>${t("confirmDelete")}</h3>
        <div class="scene-actions" style="margin-top:16px; justify-content:flex-end;">
          <button class="btn ghost" id="m-cancel">${lang() === "ar" ? "إلغاء" : "Cancel"}</button>
          <button class="btn danger" id="m-ok">${t("delete")}</button>
        </div>`);
      m.querySelector("#m-cancel").onclick = closeModal;
      m.querySelector("#m-ok").onclick = async () => {
        await api.deleteProject(id);
        closeModal();
        toast(t("toasts.deleted"), "ok");
        navigate("#/projects");
      };
    });

    root.querySelectorAll(".tabs button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === activeTab);
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        sessionStorage.setItem(`tab_${id}`, activeTab);
        paint();
      });
    });

    renderTab();

    // live progress stream
    es = api.events(id, (ev) => {
      if (ev.type === "stage") {
        const bar = root.querySelector("#p-bar");
        const pct = root.querySelector("#p-pct");
        const st = root.querySelector("#p-stage");
        if (bar) bar.style.width = `${Math.round((ev.progress || 0) * 100)}%`;
        if (pct) pct.textContent = `${Math.round((ev.progress || 0) * 100)}%`;
        if (st) st.textContent = t("stages." + ev.stage) || ev.stage;
        project.progress = ev.progress || project.progress;
        project.stage = ev.stage || project.stage;
        if (ev.status) project.status = ev.status;
        if (ev.stage === "done" && activeTab === "production") setTimeout(() => paint(), 400);
      }
      if (ev.type === "job" && ev.status === "done" && ev.job_type === "plan") {
        toast(t("toasts.planned"), "ok");
        setTimeout(() => paint(), 300);
      }
      if (ev.type === "job" && ev.status === "done" && ev.job_type === "render") {
        toast(t("toasts.renderDone"), "ok", 6000);
        setTimeout(() => paint(), 300);
      }
      if (ev.type === "job" && ev.status === "failed") {
        toast(`${t("toasts.jobFailed")}: ${ev.error || ""}`, "err", 7000);
        setTimeout(() => paint(), 300);
      }
      if (ev.type === "scene" && activeTab === "storyboard") {
        setTimeout(() => refresh().then(() => paintTabOnly()), 200);
      }
    });
  }

  function paintTabOnly() {
    const el = root.querySelector("#tab-content");
    if (el) renderTab();
  }

  function renderTab() {
    const el = root.querySelector("#tab-content");
    if (!el) return;
    if (activeTab === "script") renderScript(el);
    else if (activeTab === "storyboard") renderStoryboard(el);
    else if (activeTab === "production") renderProduction(el);
    else renderPreview(el);
  }

  /* ---------------- screenplay ---------------- */
  function renderScript(el) {
    const sp = project.screenplay;
    el.innerHTML = `
      <div class="card">
        <div class="panel-title">
          <h3>📝 ${t("tabScript")}</h3>
          <div style="display:flex; gap:8px;">
            ${sp ? `<a class="btn sm" href="/api/projects/${id}/script.txt">⬇ ${t("downloadScript")}</a>` : ""}
            <button class="btn accent sm" id="gen-script">🤖 ${t("generateScript")}</button>
            ${sp ? `<button class="btn primary sm" id="save-script">💾 ${t("saveScript")}</button>` : ""}
          </div>
        </div>
        <p class="muted">${t("scriptHint")}</p>
        ${
          !sp
            ? `<div class="empty"><div class="big">📜</div><p>${t("noScript")}</p></div>`
            : `
          <div class="row c2" style="margin-top:16px;">
            <div class="field"><label>${t("logline")}</label><textarea id="sp-logline" rows="2">${esc(sp.logline || "")}</textarea></div>
            <div class="field"><label>${t("synopsis")}</label><textarea id="sp-synopsis" rows="2">${esc(sp.synopsis || "")}</textarea></div>
          </div>

          <h3 style="margin:14px 0;">👥 ${t("characters")}</h3>
          <div class="grid c3">
            ${(project.characters || [])
              .map(
                (c) => `
              <div class="provider-card">
                <div style="display:flex; gap:12px;">
                  ${c.image_url ? `<img src="${esc(c.image_url)}" style="width:74px; height:98px; object-fit:cover; border-radius:10px;" />` : `<div style="width:74px; height:98px; background:var(--bg-2); border-radius:10px;"></div>`}
                  <div>
                    <b>${esc(c.name)}</b>
                    <div class="muted" style="font-size:12px;">${esc(c.role)}</div>
                    <div class="muted" style="font-size:11.5px; margin-top:6px;">${esc((c.appearance || "").slice(0, 80))}</div>
                  </div>
                </div>
              </div>`
              )
              .join("")}
          </div>

          <h3 style="margin:18px 0 12px;">🎬 ${t("scenes")}</h3>
          <div class="stages">
            ${(sp.scenes || [])
              .map(
                (s, i) => `
              <div class="stage-item" style="display:block;" data-i="${i}">
                <div style="display:flex; gap:12px; align-items:center; margin-bottom:10px;">
                  <div class="ic">${STAGE_ICONS.planning}</div>
                  <div style="flex:1;">
                    <div class="st-title">${i + 1}. ${esc(s.title)}</div>
                    <div class="st-sub">⏱ ${s.duration_sec}s — ${esc(s.environment || "")} — ${esc(s.mood || "")}</div>
                  </div>
                </div>
                <div class="row c2">
                  <div class="field"><label>${t("sceneNarration")}</label><textarea class="s-narr" rows="2">${esc(s.narration || "")}</textarea></div>
                  <div>
                    <div class="field"><label>${t("sceneEnv")}</label><input class="s-env" value="${esc(s.environment || "")}" /></div>
                    <div class="field"><label>${t("sceneDuration")}</label><input type="number" class="s-dur" min="1" max="60" step="0.5" value="${s.duration_sec}" /></div>
                  </div>
                </div>
                ${
                  (s.dialogue || []).length
                    ? `<div class="muted">💬 ${s.dialogue.map((d) => `<b>${esc(d.character)}:</b> ${esc(d.text)}`).join(" · ")}</div>`
                    : ""
                }
              </div>`
              )
              .join("")}
          </div>`
        }
      </div>
    `;

    el.querySelector("#gen-script").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.innerHTML = `<span class="spin">⏳</span>`;
      try {
        await api.plan(id);
        toast(lang() === "ar" ? "جارٍ كتابة السيناريو…" : "Writing screenplay…", "ok");
      } catch (err) {
        toast(err.message, "err");
      }
      setTimeout(() => paint(), 800);
    });

    el.querySelector("#save-script")?.addEventListener("click", async () => {
      const scenes = [...el.querySelectorAll(".stage-item[data-i]")].map((row, i) => ({
        ...project.screenplay.scenes[i],
        narration: row.querySelector(".s-narr").value,
        environment: row.querySelector(".s-env").value,
        duration_sec: parseFloat(row.querySelector(".s-dur").value || "6"),
      }));
      try {
        await api.saveScript(id, {
          logline: el.querySelector("#sp-logline").value,
          synopsis: el.querySelector("#sp-synopsis").value,
          scenes,
        });
        await refresh();
        toast(t("scriptSaved"), "ok");
      } catch (err) {
        toast(err.message, "err");
      }
    });
  }

  /* ---------------- storyboard ---------------- */
  function renderStoryboard(el) {
    const scenes = project.scenes || [];
    el.innerHTML = `
      <div class="panel-title">
        <h3>🎞 ${t("tabStoryboard")} <span class="muted">(${scenes.length})</span></h3>
        <button class="btn primary sm" id="render-all">🎬 ${t("startProduction")}</button>
      </div>
      ${
        scenes.length === 0
          ? `<div class="empty"><div class="big">🎞</div><p>${t("noScript")}</p></div>`
          : `<div class="grid c3">
          ${scenes
            .map(
              (s) => `
            <div class="card scene-card">
              <div class="thumb">
                ${s.image_url ? `<img src="${esc(s.image_url)}" />` : `<div class="empty" style="border:none; padding:40px;">🖼</div>`}
                <div class="idx">#${s.idx}</div>
                <div class="dur">⏱ ${s.duration_sec}${t("durationSec")}</div>
              </div>
              <div class="body">
                <b>${esc(s.title)}</b>
                <div class="muted" style="font-size:12px; margin:6px 0;">${esc((s.summary || "").slice(0, 90))}</div>
                <div class="muted" style="font-size:11.5px;">📍 ${esc(s.environment || "—")} · 🎭 ${esc(s.mood || "—")}</div>
                <div class="muted" style="font-size:11.5px;">🎥 ${(s.shots || [])
                  .map((sh) => `${esc(sh.camera || "shot")} (${sh.duration_sec}s)`)
                  .join(" · ")}</div>
                <div class="scene-actions">
                  <button class="btn sm regen-btn" data-idx="${s.idx}" data-v="${s.variant_index}">🔄 ${t("regenerate")}</button>
                  ${s.clip_url ? `<a class="btn sm" href="${esc(s.clip_url)}" target="_blank">▶</a>` : ""}
                  <span class="badge ${s.status === "clipped" || s.status === "imaged" ? "done" : s.status === "failed" ? "failed" : "draft"}">${esc(s.status)}</span>
                </div>
              </div>
            </div>`
            )
            .join("")}
        </div>`
      }
    `;

    el.querySelector("#render-all").addEventListener("click", startRender);
    el.querySelectorAll(".regen-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.innerHTML = `<span class="spin">⏳</span> ${t("regenerating")}`;
        try {
          await api.regenerateScene(id, +btn.dataset.idx, { variant: +btn.dataset.v });
          toast(t("regenerating"), "ok");
        } catch (err) {
          toast(err.message, "err");
          btn.disabled = false;
        }
      })
    );
  }

  async function startRender() {
    try {
      await api.render(id, {});
      toast(lang() === "ar" ? "بدأ الإنتاج — تابع شريط التقدم" : "Production started — watch progress", "ok");
      activeTab = "production";
      paint();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  /* ---------------- production ---------------- */
  function renderProduction(el) {
    const stageIdx = STAGE_ORDER.indexOf(project.stage);
    el.innerHTML = `
      <div class="row" style="grid-template-columns: 1.4fr 1fr; align-items:start;">
        <div class="card">
          <div class="panel-title">
            <h3>⚙️ ${t("productionTitle")}</h3>
            <div style="display:flex; gap:8px;">
              <button class="btn primary" id="start-render">🎬 ${project.status === "failed" ? t("resume") : t("startProduction")}</button>
            </div>
          </div>
          <div class="stages">
            ${STAGE_ORDER.map((s, i) => {
              const state = project.status === "done" || i < stageIdx ? "done" : i === stageIdx && project.status === "rendering" ? "active" : "";
              return `
                <div class="stage-item ${state}">
                  <div class="ic">${STAGE_ICONS[s]}</div>
                  <div>
                    <div class="st-title">${t("stages." + s)}</div>
                    <div class="st-sub">${t("stageSub." + s)}</div>
                  </div>
                </div>`;
            }).join("")}
          </div>
        </div>

        <div>
          <div class="card" style="margin-bottom:18px;">
            <h3>📋 ${t("jobHistory")}</h3>
            <table>
              <thead><tr><th>${t("status")}</th><th>job</th><th>tries</th><th>error</th></tr></thead>
              <tbody>
                ${(project.jobs || [])
                  .map(
                    (j) => `
                  <tr>
                    <td><span class="badge ${j.status === "done" ? "done" : j.status === "failed" ? "failed" : "planning"}">${esc(j.status)}</span></td>
                    <td>${esc(j.type)}</td>
                    <td>${j.attempts}/${j.max_attempts}</td>
                    <td class="muted" style="max-width:160px; overflow:hidden; text-overflow:ellipsis;">${esc((j.error || "").slice(0, 60))}</td>
                  </tr>`
                  )
                  .join("") || `<tr><td colspan="4" class="muted">—</td></tr>`}
              </tbody>
            </table>
          </div>

          ${
            project.cost_estimate
              ? `<div class="estimate-box">
                  <h3>💰 ${t("costEstimate")}</h3>
                  <div class="estimate-total">${project.cost_estimate.total > 0 ? "$" + project.cost_estimate.total.toFixed(3) : t("estimateFree")}</div>
                  <div class="muted">🖼 $${project.cost_estimate.breakdown.images} · 🎥 $${project.cost_estimate.breakdown.video} · 🎙 $${project.cost_estimate.breakdown.tts} · 🧠 $${project.cost_estimate.breakdown.llm_script}</div>
                </div>`
              : ""
          }
        </div>
      </div>
    `;
    el.querySelector("#start-render").addEventListener("click", startRender);
  }

  /* ---------------- preview ---------------- */
  function renderPreview(el) {
    const m = project.manifest;
    el.innerHTML = `
      <div class="card">
        <div class="panel-title">
          <h3>▶️ ${t("previewTitle")}</h3>
          <div style="display:flex; gap:8px;">
            ${project.final_video_path ? `<a class="btn primary sm" href="/api/projects/${id}/download">⬇ ${t("downloadMP4")}</a>` : ""}
            ${project.srt_path ? `<a class="btn sm" href="${esc(project.srt_path)}">⬇ ${t("downloadSRT")}</a>` : ""}
            <a class="btn sm" href="/api/projects/${id}/script.txt">⬇ ${t("downloadScript")}</a>
          </div>
        </div>
        ${
          project.final_video_path
            ? `<div class="player-wrap"><video controls poster="${esc(project.poster_path || "")}" src="${esc(project.final_video_path)}"></video></div>
               <p class="gold" style="margin-top:12px;">✅ ${t("filmReady")}</p>`
            : `<div class="empty"><div class="big">🎬</div><p>${t("noFilm")}</p></div>`
        }
        ${
          m
            ? `<h3 style="margin:22px 0 12px;">📋 ${t("manifest")}</h3>
               <div class="manifest-list">
                 <div class="mrow"><span>${t("targetDuration")}</span><b>${m.duration_target_sec}s</b></div>
                 <div class="mrow"><span>${t("realDuration")}</span><b>${m.duration_real_sec}s</b></div>
                 <div class="mrow"><span>${t("resolution")}</span><b>${esc(m.resolution)} · ${esc(m.aspect)} · ${m.fps}fps</b></div>
                 <div class="mrow"><span>${t("usedEngines")}</span><b>${esc(JSON.stringify(m.providers))}</b></div>
                 <div class="mrow"><span>${t("subtitles")}</span><b>${m.subtitles ? "✓" : "—"}</b></div>
                 <div class="mrow"><span>scenes</span><b>${(m.scenes || []).length}</b></div>
               </div>`
            : ""
        }
      </div>
    `;
  }

  paint();
}
