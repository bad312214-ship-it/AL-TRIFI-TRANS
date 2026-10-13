/* Studio view — compose a new film project with live cost estimate */
import { api } from "../api.js";
import { t, tOpt, lang } from "../i18n.js";
import { esc, toast, navigate } from "../app.js";

const EXAMPLES = [
  "أنشئ فيلم رسوم متحركة مدته 3 دقائق عن طفل يكتشف مدينة سحرية مخفية خلف الجبال، بأسلوب سينمائي عائلي، مع شخصيات ثلاثية الأبعاد وتفاصيل واقعية وموسيقى مؤثرة ونهاية مفاجئة",
  "فيلم وثائقي قصير عن رحلة قافلة تاريخية عبر الصحراء، سرد عميق وتصوير سينمائي",
  "إعلان تسويقي لمنتج عائلي بأسلوب مرح وسريع في 30 ثانية",
  "قصة إنسانية درامية عن لم شمل عائلة بعد سنوات طويلة، نهاية مؤثرة",
];

function selOptions(map, selected) {
  return Object.entries(map)
    .map(([k, label]) => `<option value="${k}" ${k === selected ? "selected" : ""}>${esc(label)}</option>`)
    .join("");
}

export async function renderStudio(root) {
  const providers = await api.providers().catch(() => ({ llm: [], image: [], video: [], tts: [] }));

  const llmOpts = providers.llm.map((p) => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join("");
  const imgOpts = providers.image.map((p) => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join("");
  const vidOpts = providers.video.map((p) => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join("");
  const ttsOpts = providers.tts.map((p) => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join("");

  root.innerHTML = `
    <section class="hero">
      <h1>${t("heroTitle")}</h1>
      <p>${t("heroSub")}</p>
      <div class="chips">
        ${EXAMPLES.map((e) => `<button class="chip" data-ex="${esc(e)}">✨ ${esc(e.slice(0, 52))}…</button>`).join("")}
      </div>
    </section>

    <div class="row" style="grid-template-columns: 1.7fr 1fr; align-items:start;">
      <div class="card">
        <div class="panel-title"><h2>🎬 ${t("ideaLabel")}</h2></div>
        <div class="field">
          <textarea id="idea" rows="7" placeholder="${esc(t("ideaPlaceholder"))}"></textarea>
        </div>

        <h3 style="margin: 6px 0 12px;">⚙️ ${t("productionSettings")}</h3>
        <div class="row c3">
          <div class="field">
            <label>${t("genre")}</label>
            <select id="genre">${selOptions(t("genres"), "adventure")}</select>
          </div>
          <div class="field">
            <label>${t("visualStyle")}</label>
            <select id="style">${selOptions(t("styles"), "cinematic_3d")}</select>
          </div>
          <div class="field">
            <label>${t("language")}</label>
            <select id="language">${selOptions(t("langs"), "ar")}</select>
          </div>
        </div>

        <div class="row c3">
          <div class="field">
            <label>${t("duration")}: <b class="gold" id="dur-label">60</b></label>
            <input type="range" id="duration" min="15" max="300" step="5" value="60" />
          </div>
          <div class="field">
            <label>${t("resolution")}</label>
            <select id="resolution">
              <option value="720p">720p</option>
              <option value="1080p" selected>1080p</option>
              <option value="4k">4K</option>
            </select>
          </div>
          <div class="field">
            <label>${t("aspect")}</label>
            <select id="aspect">
              <option value="16:9" selected>16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </div>
        </div>

        <div class="row c3">
          <div class="field">
            <label>${t("fps")}</label>
            <select id="fps">
              <option value="24" selected>24</option>
              <option value="30">30</option>
              <option value="60">60</option>
            </select>
          </div>
          <div class="field">
            <label>${t("voiceStyle")}</label>
            <select id="voice">${selOptions(t("voices"), "warm_narrator")}</select>
          </div>
          <div class="field">
            <label>${t("musicMood")}</label>
            <select id="mood">${selOptions(t("moods"), "emotional")}</select>
          </div>
        </div>

        <h3 style="margin: 6px 0 12px;">🤖 ${t("engineSettings")}</h3>
        <div class="row c2">
          <div class="field"><label>${t("engineLLM")}</label><select id="p-llm">${llmOpts}</select></div>
          <div class="field"><label>${t("engineImage")}</label><select id="p-img">${imgOpts}</select></div>
          <div class="field"><label>${t("engineVideo")}</label><select id="p-vid">${vidOpts}</select></div>
          <div class="field"><label>${t("engineTTS")}</label><select id="p-tts">${ttsOpts}</select></div>
        </div>

        <div class="row c2" style="margin-bottom: 18px;">
          <label class="check-line"><input type="checkbox" id="subs" checked /> ${t("subtitles")}</label>
          <label class="check-line"><input type="checkbox" id="cards" checked /> ${t("titleCards")}</label>
        </div>

        <button class="btn primary lg block" id="create-btn">🎬 ${t("createFilm")}</button>
      </div>

      <div style="display:grid; gap:18px;">
        <div class="estimate-box">
          <h3>💰 ${t("costEstimate")}</h3>
          <div class="estimate-total" id="est-total">—</div>
          <div class="muted" id="est-detail"></div>
          <p class="muted" style="margin-top:10px;">${t("estimateFree")}</p>
        </div>
        <div class="card">
          <h3>🧭 ${t("perProjectNote")}</h3>
          <ul class="muted" style="padding-inline-start:18px; display:grid; gap:8px;">
            <li>1 — ${t("stages.planning")}</li>
            <li>2 — ${t("tabScript")} / ${t("tabStoryboard")}</li>
            <li>3 — ${t("stages.shots")} & ${t("stages.voice")}</li>
            <li>4 — ${t("stages.assembly")} & ${t("tabPreview")}</li>
          </ul>
        </div>
      </div>
    </div>
  `;

  const $ = (id) => root.querySelector("#" + id);
  const fields = ["duration", "resolution", "aspect", "fps", "p-img", "p-vid", "p-tts"];

  async function refreshEstimate() {
    $("dur-label").textContent = $("duration").value;
    try {
      const est = await api.estimate({
        duration_sec: +$("duration").value,
        resolution: $("resolution").value,
        aspect: $("aspect").value,
        fps: +$("fps").value,
        llm_provider: $("p-llm").value,
        image_provider: $("p-img").value,
        video_provider: $("p-vid").value,
        tts_provider: $("p-tts").value,
        include_audio: true,
      });
      $("est-total").textContent = est.total > 0 ? `$${est.total.toFixed(3)}` : t("estimateFree");
      const b = est.breakdown;
      $("est-detail").textContent =
        `🎬 ${est.units.n_scenes} scenes · 🖼 ${est.units.n_images} images · 🎥 ${est.units.n_clips} clips · 🎙 ${est.units.tts_chars} chars`;
    } catch (e) {
      $("est-detail").textContent = "";
    }
  }

  fields.forEach((id) => $(id).addEventListener("input", refreshEstimate));
  refreshEstimate();

  root.querySelectorAll("[data-ex]").forEach((btn) =>
    btn.addEventListener("click", () => {
      $("idea").value = btn.dataset.ex;
      $("idea").focus();
    })
  );

  $("create-btn").addEventListener("click", async () => {
    const prompt = $("idea").value.trim();
    if (prompt.length < 3) {
      toast(lang() === "ar" ? "اكتب فكرة الفيلم أولًا" : "Write your film idea first", "warn");
      $("idea").focus();
      return;
    }
    const btn = $("create-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spin">⏳</span> ${t("creating")}`;
    try {
      const project = await api.createProject({
        prompt,
        language: $("language").value,
        genre: $("genre").value,
        visual_style: $("style").value,
        duration_sec: +$("duration").value,
        aspect: $("aspect").value,
        resolution: $("resolution").value,
        fps: +$("fps").value,
        voice_style: $("voice").value,
        music_mood: $("mood").value,
        subtitles: $("subs").checked,
        title_cards: $("cards").checked,
        llm_provider: $("p-llm").value,
        image_provider: $("p-img").value,
        video_provider: $("p-vid").value,
        tts_provider: $("p-tts").value,
      });
      toast(t("toasts.created"), "ok");
      await api.plan(project.id);
      navigate(`#/projects/${project.id}`);
    } catch (err) {
      toast(`${t("toasts.error")}: ${err.message}`, "err");
      btn.disabled = false;
      btn.innerHTML = `🎬 ${t("createFilm")}`;
    }
  });
}
