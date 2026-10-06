// API client. Sends the per-daemon token (X-Atlas-Token) and JSON Content-Type on
// every call, throws ApiError on failures, and exposes SSE with a polling fallback.

export class ApiError extends Error {
  constructor(status, error, why, doNext) {
    super(error || "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.error = error || "Request failed";
    this.why = why || "";
    this.do = doNext || "";
  }
}

function readToken() {
  const meta = document.querySelector('meta[name="atlas-token"]');
  const value = meta ? meta.getAttribute("content") || "" : "";
  // The server substitutes the placeholder at serve time; an unreplaced one means no token.
  return value && value !== "__ATLAS_TOKEN__" ? value : "";
}

const TOKEN = readToken();
const BASE = "/api/v2/";

function normalizePath(path) {
  if (path.startsWith("/api/")) return path;
  return BASE + path.replace(/^\/+/, "");
}

function buildUrl(path, params) {
  const url = normalizePath(path);
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const text = qs.toString();
  return text ? url + (url.includes("?") ? "&" : "?") + text : url;
}

async function request(method, path, params, body) {
  const headers = { Accept: "application/json" };
  if (TOKEN) headers["X-Atlas-Token"] = TOKEN;
  const init = { method, headers, credentials: "same-origin" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body === undefined ? {} : body);
  }
  let res;
  try {
    res = await fetch(buildUrl(path, params), init);
  } catch (_err) {
    throw new ApiError(0, "Cannot reach the Atlas dashboard", "The local server did not answer.", "Check that the dashboard daemon is running, then retry.");
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_err) {
      data = null;
    }
  }
  if (!res.ok || (data && data.ok === false)) {
    const d = data || {};
    throw new ApiError(res.status, d.error || res.statusText || "Request failed", d.why || "", d.do || d.hint || "");
  }
  return data === null ? {} : data;
}

export const api = {
  hasToken: Boolean(TOKEN),
  mode: "idle",
  get: (path, params) => request("GET", path, params),
  post: (path, body) => request("POST", path, null, body),
  put: (path, body) => request("PUT", path, null, body),

  // stream({ project, onEvent(name, data), onMode(mode), poll() , pollMs })
  // Opens SSE and falls back to polling poll() every 8s if the stream drops.
  stream(opts) {
    const options = opts || {};
    const names = ["colony", "todos", "irc", "health", "improve", "tick"];
    const pollMs = options.pollMs || 8000;
    let source = null;
    let pollTimer = null;
    let closed = false;
    let failures = 0;

    const setMode = (mode) => {
      if (api.mode === mode) return;
      api.mode = mode;
      if (options.onMode) options.onMode(mode);
    };

    const stopPolling = () => {
      clearInterval(pollTimer);
      pollTimer = null;
    };

    const startPolling = () => {
      if (pollTimer || closed) return;
      setMode("poll");
      pollTimer = setInterval(() => {
        if (options.poll) options.poll();
        if (options.onEvent) options.onEvent("tick", { ts: new Date().toISOString(), polled: true });
      }, pollMs);
    };

    const open = () => {
      if (closed || typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      const qs = new URLSearchParams();
      if (options.project && options.project !== "all") qs.set("project", options.project);
      if (TOKEN) qs.set("token", TOKEN);
      const text = qs.toString();
      source = new EventSource(BASE + "stream" + (text ? "?" + text : ""));
      source.onopen = () => {
        failures = 0;
        stopPolling();
        setMode("live");
      };
      for (const name of names) {
        source.addEventListener(name, (evt) => {
          let data = {};
          try {
            data = evt.data ? JSON.parse(evt.data) : {};
          } catch (_err) {
            data = {};
          }
          if (options.onEvent) options.onEvent(name, data);
        });
      }
      source.onerror = () => {
        failures += 1;
        // EventSource retries itself (server sends retry: 3000). After repeated failures,
        // poll so the UI keeps updating while it keeps trying to reconnect.
        if (failures >= 2) startPolling();
        if (source && source.readyState === 2) {
          source.close();
          source = null;
          if (!closed) setTimeout(open, 5000);
        }
      };
    };

    open();

    return {
      close() {
        closed = true;
        stopPolling();
        if (source) source.close();
        source = null;
        api.mode = "idle";
      },
    };
  },
};

export default api;
