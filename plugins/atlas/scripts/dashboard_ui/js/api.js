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

let TOKEN = readToken();
// A daemon restart mints a new token, so an open tab's copy goes stale and every poll 401s. Re-scrape
// the index once per stale answer; while that fails, stay quiet for AUTH_BACKOFF_MS instead of looping.
const AUTH_BACKOFF_MS = 60000;
let authDeadUntil = 0;
let refreshing = null;
async function refreshToken() {
  refreshing ??= (async () => {
    try {
      const res = await fetch(PREFIX + "/", { credentials: "same-origin", cache: "no-store" });
      const m = /<meta\s+name="atlas-token"\s+content="([^"]*)"/i.exec(await res.text());
      const next = m && m[1] !== "__ATLAS_TOKEN__" ? m[1] : "";
      if (res.ok && next && next !== TOKEN) {
        TOKEN = next;
        return true;
      }
    } catch (_err) {
      // daemon down: fall through to backoff
    }
    return false;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
// Same-origin gateway prefix (<meta name="atlas-base" content="/atlas">); empty when served standalone.
const PREFIX = ((document.querySelector('meta[name="atlas-base"]') || {}).content || "").replace(/\/+$/, "");
const BASE = PREFIX + "/api/v2/";

function normalizePath(path) {
  if (path.startsWith("/api/")) return PREFIX + path;
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

// JSON of `value` without per-tick volatile keys (mirrors the server's SSE hash), so pages can skip
// a rebuild when a refetch changed nothing real.
const VOLATILE = new Set(["idle_seconds", "updated", "last_ok", "generated_at", "now", "age_seconds"]);
export function stableJson(value) {
  return JSON.stringify(value, (k, v) => (VOLATILE.has(k) ? undefined : v));
}

// hidden_projects pref: merged ("all") views of overview and work drop rows that belong
// to a hidden project root. Rows carry the root as `project` or `root`.
let hiddenRoots = new Set();
export function setHiddenRoots(list) {
  hiddenRoots = new Set(list || []);
}

function dropHidden(node) {
  if (Array.isArray(node)) {
    return node
      .filter((x) => !(x && typeof x === "object" && (hiddenRoots.has(x.project) || hiddenRoots.has(x.root))))
      .map(dropHidden);
  }
  if (node && typeof node === "object") {
    for (const k of Object.keys(node)) node[k] = dropHidden(node[k]);
  }
  return node;
}

async function request(method, path, params, body, retried = false) {
  if (Date.now() < authDeadUntil) throw new ApiError(401, "bad_token", "The dashboard token is stale.", "Reload the page to obtain a fresh token.");
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
    if (res.status === 401 && d.error === "bad_token") {
      if (!retried && (await refreshToken())) return request(method, path, params, body, true);
      authDeadUntil = Date.now() + AUTH_BACKOFF_MS;
    }
    const err = new ApiError(res.status, d.error || res.statusText || "Request failed", d.why || "", d.do || d.hint || "");
    err.data = d;
    throw err;
  }
  if (method === "GET") document.dispatchEvent(new CustomEvent("atlas:fetched")); // drives the top bar "as of" stamp
  if (method === "GET" && hiddenRoots.size && (!params || !params.project || params.project === "all") && /^\/?(api\/v2\/)?(overview|todos)(\?|$)/.test(path)) {
    data = dropHidden(data);
  }
  return data === null ? {} : data;
}

export const api = {
  hasToken: Boolean(TOKEN),
  mode: "idle",
  lastEventId: "",
  // Layer 1 probe (MASTER 9.14): GET /api/health needs no token. Resolves {up:true,data} or {up:false,error}.
  async probe() {
    try {
      const res = await fetch(PREFIX + "/api/health", { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      return { up: res.ok, data, status: res.status };
    } catch (err) {
      return { up: false, error: String((err && err.message) || err) };
    }
  },
  get: (path, params) => request("GET", path, params),
  post: (path, body) => request("POST", path, null, body),
  put: (path, body) => request("PUT", path, null, body),

  // stream({ project, onEvent(name, data), onMode(mode), poll(), pollMs })
  // Opens SSE and falls back to polling poll() every pollMs (default 8s) if the stream drops.
  stream(opts) {
    const options = opts || {};
    const names = ["herd", "todos", "irc", "health", "improve", "route_error", "tick"];
    const pollMs = options.pollMs || 8000; // default only; app.js passes prefs.refresh_seconds
    let source = null;
    let pollTimer = null;
    let closed = false;
    let failures = 0;
    let reopenMs = 2500;

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
        if (document.hidden) return; // hidden tab: no background polling
        if (options.poll) options.poll();
        if (options.onEvent) options.onEvent("tick", { ts: new Date().toISOString(), polled: true });
      }, pollMs);
    };

    let opening = false;
    const open = () => {
      // hidden: stay closed so the server sampler sees no subscriber; onVisibility reopens
      if (document.hidden || source || opening) return;
      if (closed || typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      // EventSource cannot set headers and the long-lived token must not ride in a URL: mint a
      // single-use ticket per (re)connect.
      opening = true;
      api
        .post("/api/v2/stream/ticket", {})
        .then((res) => {
          opening = false;
          if (closed || source || document.hidden) return;
          if (!res || !res.ticket) throw new Error("no stream ticket issued");
          connect(res.ticket);
        })
        .catch(() => {
          opening = false;
          startPolling();
          if (!closed) setTimeout(open, reopenMs);
        });
    };

    const connect = (ticket) => {
      const qs = new URLSearchParams();
      if (options.project && options.project !== "all") qs.set("project", options.project);
      qs.set("ticket", ticket);
      source = new EventSource(BASE + "stream?" + qs.toString());
      source.onopen = () => {
        failures = 0;
        reopenMs = 2500;
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
          // The browser re-sends this as Last-Event-ID on its own reconnects, so the server only replays what changed.
          if (evt.lastEventId) api.lastEventId = evt.lastEventId;
          if (options.onEvent) options.onEvent(name, data);
        });
      }
      source.onerror = () => {
        failures += 1;
        if (failures === 1) setMode("reconnecting");
        if (failures >= 2) startPolling();
        // A native retry would replay the burnt ticket URL: always drop it and reconnect with a new ticket.
        if (source) source.close();
        source = null;
        if (!closed) {
          reopenMs = Math.min(reopenMs * 2, AUTH_BACKOFF_MS);
          refreshToken().finally(() => setTimeout(open, reopenMs));
        }
      };
    };

    // ponytail: close the stream while hidden (server sampler exits at zero subscribers), reopen and
    // poll once on return. Fixed behavior, no knob.
    const onVisibility = () => {
      if (closed) return;
      if (document.hidden) {
        if (source) source.close();
        source = null;
        return;
      }
      failures = 0;
      open();
      if (options.poll) options.poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    open();

    return {
      close() {
        closed = true;
        document.removeEventListener("visibilitychange", onVisibility);
        stopPolling();
        if (source) source.close();
        source = null;
        api.mode = "idle";
      },
    };
  },
};

