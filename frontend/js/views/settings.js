/* Settings view — provider keys (server-side, masked), defaults, prices */
import { api } from "../api.js";
import { t } from "../i18n.js";
import { esc, toast } from "../app.js";

const SECRET_FIELDS = [
  { key: "llm_api_key", label: "LLM API Key (OpenAI-compatible)" },
  { key: "openai_api_key", label: "OpenAI API Key (Images + TTS)" },
  { key: "replicate_api_token", label: "Replicate API Token" },
  { key: "fal_key", label: "fal.ai Key" },
  { key: "stability_api_key", label: "Stability AI Key" },
  { key: "elevenlabs_api_key", label: "ElevenLabs API Key" },
];

const TEXT_FIELDS = [
  { key: "llm_base_url", label: "LLM Base URL (OpenAI-compatible)" },
  { key: "llm_model", label: "LLM Model" },
];

function providerBlock(kind, providers) {
  return `
    <div class="card" style="margin-bottom:18px;">
      <h3>${{ llm: "🧠", image: "🖼", video: "🎥", tts: "🎙", music: "🎵" }[kind] || "⚙"} ${kind.toUpperCase()}</h3>
      ${(providers || [])
        .map(
          (p) => `
        <div class="provider-card">
          <div class="p-head">
            <div>
              <div class="p-name">${esc(p.label)}</div>
              <div class="muted">${esc(p.details?.note || "")}</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <span class="badge ${p.configured ? "done" : "draft"}">${p.configured ? t("connected") : t("notConnected")}</span>
              <button class="btn sm test-btn" data-kind="${kind}" data-name="${esc(p.name)}">${t("test")}</button>
              ${kind !== "llm" && kind !== "music" ? `<button class="btn sm sample-btn" data-kind="${kind}" data-name="${esc(p.name)}">${t("sample")}</button>` : ""}
            </div>
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

export async function renderSettings(root) {
  const [providers, settings] = await Promise.all([api.providers(), api.settings()]);

  root.innerHTML = `
    <div class="panel-title"><h2>⚙️ ${t("settingsTitle")}</h2></div>
    <p class="muted" style="margin-bottom:18px;">${t("settingsNote")}</p>

    <div class="row" style="grid-template-columns: 1fr 1fr; align-items:start;">
      <div>
        <div class="card" style="margin-bottom:18px;">
          <h3>🔑 ${t("apiKey")}</h3>
          ${SECRET_FIELDS.map(
            (f) => `
            <div class="field">
              <label>${esc(f.label)} ${settings[f.key + "_set"] ? `<span class="gold">(${t("connected")})</span>` : ""}</label>
              <input type="password" id="s-${f.key}" value="${settings[f.key] ? esc(settings[f.key]) : ""}" placeholder="${settings[f.key + "_set"] ? "•••••••• (saved)" : "sk-..."}" />
            </div>`
          ).join("")}
          ${TEXT_FIELDS.map(
            (f) => `
            <div class="field">
              <label>${esc(f.label)}</label>
              <input type="text" id="s-${f.key}" value="${esc(settings[f.key] || "")}" />
            </div>`
          ).join("")}
          <button class="btn primary block" id="save-btn">${t("saveSettings")}</button>
        </div>

        <div class="card">
          <h3>💵 ${t("prices")}</h3>
          <div class="row c2">
            <div class="field"><label>${t("priceImage")}</label><input type="number" step="0.001" id="s-price_image" value="${settings.price_image ?? 0.04}" /></div>
            <div class="field"><label>${t("priceVideo")}</label><input type="number" step="0.001" id="s-price_video_second" value="${settings.price_video_second ?? 0.05}" /></div>
            <div class="field"><label>${t("priceTTS")}</label><input type="number" step="0.001" id="s-price_tts_1k_chars" value="${settings.price_tts_1k_chars ?? 0.015}" /></div>
            <div class="field"><label>${t("priceLLM")}</label><input type="number" step="0.001" id="s-price_llm_1k_tokens" value="${settings.price_llm_1k_tokens ?? 0.001}" /></div>
          </div>
        </div>
      </div>

      <div>
        ${providerBlock("llm", providers.llm)}
        ${providerBlock("image", providers.image)}
        ${providerBlock("video", providers.video)}
        ${providerBlock("tts", providers.tts)}
        ${providerBlock("music", providers.music)}
      </div>
    </div>
  `;

  root.querySelector("#save-btn").addEventListener("click", async () => {
    const values = {};
    root.querySelectorAll("input[id^='s-']").forEach((inp) => {
      const key = inp.id.slice(2);
      values[key] = key.startsWith("price_") ? parseFloat(inp.value || "0") : inp.value;
    });
    try {
      await api.saveSettings(values);
      toast(t("settingsSaved"), "ok");
    } catch (err) {
      toast(err.message, "err");
    }
  });

  root.querySelectorAll(".test-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.innerHTML = `<span class="spin">⏳</span> ${t("testing")}`;
      try {
        const res = await api.testProvider(btn.dataset.kind, btn.dataset.name);
        toast(res.ok ? `${t("connected")} — ${res.label}` : `${t("notConnected")}: ${res.error || res.details?.note || ""}`, res.ok ? "ok" : "warn");
      } catch (err) {
        toast(err.message, "err");
      }
      btn.disabled = false;
      btn.textContent = t("test");
    })
  );

  root.querySelectorAll(".sample-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.innerHTML = `<span class="spin">⏳</span>…`;
      try {
        const res = await api.sampleProvider(btn.dataset.kind, btn.dataset.name);
        if (res.ok) toast(`✓ ${res.file} (${res.bytes} bytes) — ${JSON.stringify(res.meta)}`, "ok", 6000);
        else toast(`${t("notConnected")}: ${res.error}`, "warn", 6000);
      } catch (err) {
        toast(err.message, "err");
      }
      btn.disabled = false;
      btn.textContent = t("sample");
    })
  );
}
