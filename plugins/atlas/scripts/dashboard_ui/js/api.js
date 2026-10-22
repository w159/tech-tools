// API client: token header, error envelope, one SSE stream with polling fallback, topic stores.
import { createStore } from "./state.js";

const meta = (name) => {
  const m =
    typeof document !== "undefined" &&
    document.querySelector(`meta[name="${name}"]`);
  return (m && m.getAttribute("content")) || "";
};

export const BASE =
  (typeof window !== "undefined" && window.__ATLAS_BASE__) || "";
const TOKEN = meta("atlas-token");
const VERSION = meta("atlas-version");

/** Error raised for any non-2xx or {ok:false} reply. Carries the server envelope as .data. */
class ApiError extends Error {
  constructor(message, { status = 0, data = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function qs(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== "") q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function request(method, path, { params, body, timeoutMs = 20000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const headers = { "X-Atlas-Token": TOKEN };
  const init = { method, headers, signal: ctl.signal };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${BASE}${path}${qs(params)}`, init);
  } catch (e) {
    const why =
      e.name === "AbortError"
        ? "the request timed out"
        : "the dashboard daemon is not reachable";
    throw new ApiError(why, {
      data: {
        ok: false,
        error: "network",
        why,
        do: "check that the dashboard is running, then retry",
      },
    });
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // Non-JSON body: keep data null and fall through to the status check below.
    data = null;
  }
  if (!res.ok || (data && data.ok === false)) {
    const msg =
      (data && (data.error || data.why)) || `${res.status} ${res.statusText}`;
    throw new ApiError(msg, { status: res.status, data });
  }
  return data;
}

export const get = (path, params, opts) =>
  request("GET", path, { params, ...opts });
export const post = (path, body = {}, opts) =>
  request("POST", path, { body, ...opts });
const put = (path, body = {}, opts) =>
  request("PUT", path, { body, ...opts });

/** Format an ApiError for a toast: {message, detail} where detail is the "do" hint. */
export function describeError(err) {
  const d = (err && err.data) || {};
  return {
    message:
      [d.error, d.why].filter(Boolean).join(": ") ||
      (err && err.message) ||
      "Request failed",
    detail: d.do || "",
  };
}

// --- Stores ---

export const prefs = createStore({
  theme: "dark",
  density: "compact",
  default_project: "all",
  refresh_seconds: 8,
  pinned_projects: [],
  hidden_projects: [],
});
export const project = createStore("all");
export const live = createStore("connecting"); // connecting | live | reconnecting | offline

const TOPICS = ["agents", "herd", "todos", "irc", "health", "improve"];
export const topics = Object.fromEntries(
  TOPICS.map((t) => [t, createStore(null)]),
);

// Endpoints polled when the stream is down (only the three that feed the sidebar counts).
const POLL = {
  agents: "/api/v2/agents",
  todos: "/api/v2/todos",
  health: "/api/v2/health",
};

let source = null;
let pollTimer = null;

async function pollOnce() {
  await Promise.all(
    Object.entries(POLL).map(async ([t, path]) => {
      try {
        topics[t].set(await get(path));
        if (pollTimer) live.set("reconnecting");
      } catch (e) {
        if (pollTimer) live.set("offline");
      }
    }),
  );
}

function startPolling() {
  if (pollTimer) return;
  const every = Math.max(2, Number(prefs.get().refresh_seconds) || 8) * 1000;
  pollOnce();
  pollTimer = setInterval(pollOnce, every);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

/** Open the single EventSource. Safe to call twice. EventSource retries itself; polling covers the gap. */
export function startStream() {
  if (source || typeof EventSource === "undefined") {
    if (!source) startPolling();
    return;
  }
  source = new EventSource(`${BASE}/api/v2/stream${qs({ token: TOKEN })}`);
  source.onopen = () => {
    live.set("live");
    stopPolling();
  };
  source.onerror = () => {
    live.set("reconnecting");
    startPolling();
  };
  for (const t of TOPICS) {
    source.addEventListener(t, (ev) => {
      try {
        topics[t].set(JSON.parse(ev.data));
      } catch (e) {
        console.error(`stream topic ${t}: bad payload`, e);
      }
    });
  }
}

let prefsVersion = 0; // bumped by savePrefs so an older GET never overwrites a newer save

/** Version-guarded prefs GET. Boot awaits this alone so the first paint uses real prefs. */
export async function primePrefs() {
  const seen = prefsVersion;
  try {
    const res = await get("/api/v2/prefs");
    if (seen === prefsVersion)
      prefs.set({ ...prefs.get(), ...(res.prefs || res) });
  } catch (e) {
    // Prefs stay at their defaults; the Settings page reports the failure itself.
    console.error("prefs load failed", e);
  }
}

/** Topic priming so pages have data before the first stream event; slow, never awaited at boot. */
export const primeTopics = () => pollOnce();

/** Save prefs; the server validates and returns the stored copy. */
export async function savePrefs(patch) {
  prefsVersion++;
  const res = await put("/api/v2/prefs", patch);
  prefs.set({ ...prefs.get(), ...(res.prefs || patch) });
  return res;
}
