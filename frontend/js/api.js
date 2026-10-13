/* API client — talks to the FastAPI backend */
const BASE = "";

async function request(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  const token = localStorage.getItem("trifi_token");
  if (token) opts.headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
    } catch (_) {}
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  health: () => request("GET", "/api/health"),
  providers: () => request("GET", "/api/providers"),
  testProvider: (kind, name) => request("POST", "/api/providers/test", { kind, name }),
  sampleProvider: (kind, name, language = "ar") =>
    request("POST", "/api/providers/generate-sample", { kind, name, language }),
  settings: () => request("GET", "/api/settings"),
  saveSettings: (values) => request("PUT", "/api/settings", { values }),
  estimate: (payload) => request("POST", "/api/estimate", payload),

  createProject: (payload) => request("POST", "/api/projects", payload),
  listProjects: () => request("GET", "/api/projects"),
  getProject: (id) => request("GET", `/api/projects/${id}`),
  updateProject: (id, patch) => request("PATCH", `/api/projects/${id}`, patch),
  deleteProject: (id) => request("DELETE", `/api/projects/${id}`),

  plan: (id, payload = {}) => request("POST", `/api/projects/${id}/plan`, payload),
  saveScript: (id, payload) => request("PUT", `/api/projects/${id}/script`, payload),
  render: (id, payload = {}) => request("POST", `/api/projects/${id}/render`, payload),
  regenerateScene: (id, idx, payload = {}) =>
    request("POST", `/api/projects/${id}/scenes/${idx}/regenerate`, payload),
  jobs: (id) => request("GET", `/api/projects/${id}/jobs`),

  events(id, onEvent) {
    const token = localStorage.getItem("trifi_token");
    const es = new EventSource(BASE + `/api/projects/${id}/events`);
    es.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data));
      } catch (_) {}
    };
    return es;
  },
};
