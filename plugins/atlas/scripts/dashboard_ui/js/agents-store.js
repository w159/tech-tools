// Live agent model for the Command Center (PAGES.md section 0): one AgentRecord per herdr pane,
// joined client-side with the colony panes, todo owners and channel messages, plus the honest
// three-layer health of the stack (Atlas daemon, herdr socket, herdr web UI; MASTER 9.14).
//
// Pages and the shell never fetch herd/todos/irc themselves for the fleet: they subscribe here.
//   const off = agentsStore.subscribe((state) => ...);   // called now and after every real change
//   agentsStore.start({ project, pollMs }); agentsStore.stop();
// The store owns the single SSE stream (api.stream) and forwards non-fleet topics to onEvent().

import { api, ApiError, stableJson } from "./api.js";

// ---- vocabulary (MASTER 5.2) ------------------------------------------------

export const STATES = ["input", "fail", "working", "idle", "done", "unknown"];
export const STATE_WORD = { input: "Needs input", fail: "Failed", working: "Working", idle: "Ready", done: "Done", unknown: "Not measured" };
const RANK = { input: 0, fail: 1, working: 2, idle: 3, done: 4, unknown: 5 };
const FROM_HERD = { blocked: "input", working: "working", idle: "idle", done: "done", unknown: "unknown" };

// herd / todo / health status -> Command Center state id.
export function mapState(raw) {
  const k = String(raw === null || raw === undefined ? "unknown" : raw).toLowerCase();
  if (FROM_HERD[k]) return FROM_HERD[k];
  if (k === "in_progress") return "working";
  if (k === "open") return "idle";
  if (k === "fail" || k === "failed" || k === "error") return "fail";
  if (k === "needs_input") return "input";
  return "unknown";
}

export const WORKER_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const EXIT_RE = /^exit (-?\d+)(?: \[failed: (.*)\])?/;

// herdr titles carry the harness glyph and a spinner ("\u03c0 \u280f Fix it", "\u03c0 > Fix it"). Strip them.
export function cleanTitle(title) {
  return String(title || "")
    .replace(/^[\s\u03c0>*\u2800-\u28ff\u2022\u00b7\u2733\u273b-\u273d]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function workerName(title, label) {
  const t = cleanTitle(title);
  if (WORKER_NAME.test(t)) return t;
  const l = String(label || "").trim();
  if (WORKER_NAME.test(l)) return l;
  return t;
}

const KIND_ALIASES = { pi: "omp", "claude-code": "claude", "claude_code": "claude" };
function kindOf(agent) {
  const k = String(agent || "").toLowerCase();
  const kk = KIND_ALIASES[k] || k;
  return ["omp", "claude", "codex", "shell"].includes(kk) ? kk : "unknown";
}

// ---- the join (pure; unit-testable) -----------------------------------------

function flattenTodos(payload) {
  const items = [];
  for (const phase of (payload && payload.phases) || []) {
    for (const it of phase.items || []) items.push(it);
  }
  if (!items.length && payload && Array.isArray(payload.items)) items.push(...payload.items);
  return items;
}

function projectFor(cwd, roots) {
  if (!cwd) return null;
  let best = null;
  for (const r of roots) {
    if (!r) continue;
    if ((cwd === r || cwd.startsWith(r.replace(/\/+$/, "") + "/")) && (!best || r.length > best.length)) best = r;
  }
  return best;
}

export function ageSeconds(rec, now) {
  return rec && rec.since ? Math.max(0, Math.round(((now || Date.now()) - rec.since) / 1000)) : null;
}

// join({ herd, todos, irc, colony, projects, seen }) -> AgentRecord[] sorted by urgency
export function joinAgents({ herd, todos, irc, colony, projects, seen, now }) {
  const rows = (herd && herd.agents) || [];
  const roots = ((projects && projects.projects) || []).map((p) => p.root);
  const todoItems = flattenTodos(todos);
  const messages = (irc && (irc.messages || irc.items)) || [];
  const colonyPanes = new Set(((colony && colony.panes) || []).map((p) => p.pane_id || p.id || p.pane).filter(Boolean));
  const ts = now || Date.now();
  const out = rows.map((a) => {
    const key = a.pane_id;
    const name = workerName(a.title, a.label);
    let state = mapState(a.status);
    const tasks = todoItems.filter((t) => t.claimed_by === name || t.owner === name || (t.launch && t.launch.target === key));
    const msgs = messages.filter((m) => m.from === name || m.to === name || m.from === key || m.to === key);
    // A finished agent whose last channel line is a non-zero exit is a failure, not "Done".
    const lastExit = msgs.filter((m) => m.kind === "exit").pop();
    const exit = lastExit ? EXIT_RE.exec(String(lastExit.body || "")) : null;
    if (exit && Number(exit[1]) !== 0 && (state === "done" || state === "idle" || state === "unknown")) state = "fail";
    // Age: the daemon stamps state_changed_at; source "first_seen" is only a lower bound. Without it, count from the
    // first time this state_change_seq was observed here.
    const srv = a.state_changed_at ? Date.parse(a.state_changed_at) : NaN;
    let since = ts;
    let approx = true;
    if (Number.isFinite(srv)) {
      since = srv;
      approx = a.state_changed_source === "first_seen";
    } else {
      const mark = seen.get(key);
      if (mark && mark.seq === a.state_change_seq) {
        since = mark.at;
        approx = mark.approx;
      } else {
        seen.set(key, { seq: a.state_change_seq, at: ts, approx: !mark });
        approx = !mark;
      }
    }
    return {
      key,
      name,
      title: cleanTitle(a.title) || name || key,
      kind: kindOf(a.agent),
      state,
      rawStatus: a.status,
      pane_id: a.pane_id,
      workspace_id: a.workspace_id,
      workspace: a.workspace,
      tab_id: a.tab_id,
      cwd: a.cwd || "",
      deep_link: a.deep_link || "",
      focused: Boolean(a.focused),
      project: projectFor(a.cwd, roots),
      tasks,
      messages: msgs,
      colony: colonyPanes.has(key),
      parent: a.parent_pane || null, // GAP G2: absent today
      children: [],
      since,
      sinceApprox: approx,
      seq: a.state_change_seq,
      exit: exit ? { code: Number(exit[1]), error: exit[2] || "" } : null,
      task: (tasks.find((t) => t.status === "in_progress") || tasks.find((t) => t.status === "blocked") || tasks[0] || {}).content || "",
      lastMsg: (msgs.filter((m) => m.kind !== "exit" && m.body).pop() || {}).body || "",
    };
  });
  const byKey = new Map(out.map((r) => [r.key, r]));
  for (const r of out) {
    if (r.parent && byKey.has(r.parent)) byKey.get(r.parent).children.push(r);
  }
  out.sort((a, b) => RANK[a.state] - RANK[b.state] || b.since - a.since || String(a.key).localeCompare(String(b.key)));
  return out;
}

export function countStates(agents) {
  const c = { input: 0, fail: 0, working: 0, idle: 0, done: 0, unknown: 0, total: agents.length };
  for (const a of agents) c[a.state] += 1;
  return c;
}

// workspace > agents roll-up for the rail tree; roll-up state is the most urgent child (same order as the strip).
export function groupByWorkspace(agents, workspaces) {
  const map = new Map();
  for (const w of workspaces || []) map.set(w.workspace_id, { id: w.workspace_id, label: w.label, focused: Boolean(w.focused), paneCount: w.pane_count, agents: [] });
  for (const a of agents) {
    if (!map.has(a.workspace_id)) map.set(a.workspace_id, { id: a.workspace_id, label: a.workspace || a.workspace_id, focused: false, paneCount: 0, agents: [] });
    map.get(a.workspace_id).agents.push(a);
  }
  const list = [...map.values()].filter((w) => w.agents.length || w.paneCount);
  for (const w of list) {
    w.state = w.agents.length ? w.agents.reduce((best, a) => (RANK[a.state] < RANK[best] ? a.state : best), "unknown") : "unknown";
    w.agents = w.agents.filter((a) => !a.parent || !agents.some((p) => p.key === a.parent)); // children render under their parent
  }
  list.sort((a, b) => RANK[a.state] - RANK[b.state] || String(a.label).localeCompare(String(b.label)));
  return list;
}

// ---- layers (MASTER 9.14): name the first layer that is down, nothing else ----

function layersFrom(src, daemonUp, daemonError) {
  const herd = src.herd;
  return {
    daemon: { state: daemonUp ? "up" : "down", reason: daemonError || "" },
    herdr: herd ? { state: herd.herdr && herd.herdr.reachable ? "up" : "down", reason: (herd.herdr && herd.herdr.reason) || "" } : { state: "unknown", reason: "" },
    webui: herd && herd.web_ui ? { state: herd.web_ui.healthy ? "up" : "down", url: herd.web_ui.url || "", authRequired: Boolean(herd.web_ui.auth_required) } : { state: "unknown", url: "", authRequired: false },
  };
}

// First failing layer, or null. The UI shows exactly one message for it.
export function firstDownLayer(layers) {
  if (layers.daemon.state === "down") return "daemon";
  if (layers.herdr.state === "down") return "herdr";
  if (layers.webui.state === "down") return "webui";
  return null;
}

// ---- the store ---------------------------------------------------------------

const SOURCES = {
  herd: (project) => api.get("herd/agents", { project }),
  todos: (project) => api.get("todos", { project }),
  irc: (project) => api.get("irc", { project, limit: 200 }),
  colony: () => api.get("herd/colony"),
  projects: () => api.get("projects"),
};

function createAgentsStore() {
  const subs = new Set();
  const eventSubs = new Set();
  const seen = new Map(); // pane_id -> { seq, at, approx }
  const src = { herd: null, todos: null, irc: null, colony: null, projects: null };
  const status = {}; // source -> { ok, error, at }
  let project = "all";
  let pollMs = 8000;
  let stream = null;
  let conn = "idle";
  let daemonUp = true;
  let daemonError = "";
  let lastJson = "";
  let generation = 0;
  let state = buildState(new Set());
  let colonyWatch = 0;
  let colonyTimer = null;
  let projectsTimer = null;
  let started = false;

  function buildState(changed) {
    const agents = joinAgents({ ...src, seen });
    const workspaces = (src.herd && src.herd.workspaces) || [];
    const names = new Set(agents.map((a) => a.name));
    // Todo owners / channel senders with no herdr pane: listed for the Board and Channel lenses, never as ghost cells.
    const others = new Set();
    for (const t of flattenTodos(src.todos)) for (const n of [t.owner, t.claimed_by]) if (n && !names.has(n)) others.add(n);
    const layers = layersFrom(src, daemonUp, daemonError);
    return {
      agents,
      byKey: new Map(agents.map((a) => [a.key, a])),
      counts: countStates(agents),
      workspaces,
      tree: groupByWorkspace(agents, workspaces),
      others: [...others].sort(),
      layers,
      down: firstDownLayer(layers),
      conn,
      project,
      sources: { ...status },
      loaded: Boolean(src.herd) || Boolean(status.herd),
      changed,
      todos: src.todos,
      irc: src.irc,
      colony: src.colony,
      projects: (src.projects && src.projects.projects) || [],
      herd: src.herd,
      lastEventId: api.lastEventId,
      generation,
    };
  }

  function emit(force) {
    const prev = state;
    const next = buildState(new Set());
    const prevByKey = prev.byKey;
    for (const a of next.agents) {
      const p = prevByKey.get(a.key);
      if (!p || p.state !== a.state || p.title !== a.title || p.task !== a.task || p.tasks.length !== a.tasks.length || p.messages.length !== a.messages.length) next.changed.add(a.key);
    }
    const json = stableJson({ a: next.agents.map((a) => [a.key, a.state, a.title, a.task, a.tasks.length, a.messages.length, a.project, a.colony, a.since]), l: next.layers, c: next.conn, w: next.workspaces, o: next.others, s: Object.values(next.sources).map((s) => s.ok + ":" + (s.error || "")) });
    if (!force && json === lastJson) return;
    lastJson = json;
    generation += 1;
    next.generation = generation;
    state = next;
    for (const fn of subs) {
      try {
        fn(state);
      } catch (err) {
        console.error("agents-store subscriber failed", err);
      }
    }
  }

  function note(name, err) {
    status[name] = { ok: !err, error: err ? (err.error || err.message || String(err)) : "", why: err && err.why ? err.why : "", at: Date.now(), code: err && err.status !== undefined ? err.status : 0 };
  }

  async function checkDaemon(err) {
    // Only a network failure (status 0) can mean the daemon is down; HTTP errors mean it answered.
    if (err instanceof ApiError && err.status === 0) {
      const p = await api.probe();
      daemonUp = p.up;
      daemonError = p.up ? "" : err.error;
    }
  }

  async function load(name) {
    try {
      const body = await SOURCES[name](project);
      src[name] = body;
      note(name, null);
      daemonUp = true;
      daemonError = "";
    } catch (err) {
      note(name, err);
      await checkDaemon(err);
    }
  }

  async function refresh(names) {
    const list = names || ["herd", "todos", "irc"];
    await Promise.all(list.map(load));
    emit();
  }

  function onEvent(name, data) {
    if (name === "herd" && data && data.agents) {
      src.herd = data;
      note("herd", null);
      daemonUp = true;
      emit();
    } else if (name === "todos" && data && data.phases) {
      src.todos = data;
      note("todos", null);
      emit();
    } else if (name === "irc" && data && (data.messages || data.items)) {
      src.irc = data;
      note("irc", null);
      emit();
    } else if (name === "route_error" && data && data.topic) {
      const key = data.topic === "herd" ? "herd" : data.topic;
      if (status[key] || SOURCES[key]) {
        note(key, { error: data.error });
        emit();
      }
    }
    for (const fn of eventSubs) {
      try {
        fn(name, data);
      } catch (err) {
        console.error("agents-store event subscriber failed", err);
      }
    }
  }

  function setConn(mode) {
    conn = mode === "live" ? "live" : mode === "poll" ? "poll" : mode === "idle" ? "idle" : mode;
    emit(true);
  }

  function openStream() {
    if (stream) stream.close();
    stream = api.stream({
      project,
      pollMs,
      onMode: (mode) => {
        // The first poll tick after a stream failure also flags reconnecting until SSE opens again.
        setConn(mode);
        if (mode === "live") refresh();
      },
      poll: () => refresh(),
      onEvent,
    });
  }

  function tickColony() {
    clearInterval(colonyTimer);
    colonyTimer = null;
    if (colonyWatch > 0 && started) {
      load("colony").then(() => emit());
      colonyTimer = setInterval(() => load("colony").then(() => emit()), 8000);
    }
  }

  return {
    // Begin (or retarget) the live model. Safe to call again with a new project.
    async start(opts) {
      const o = opts || {};
      project = o.project || "all";
      pollMs = o.pollMs || 8000;
      started = true;
      src.herd = src.todos = src.irc = null;
      openStream();
      clearInterval(projectsTimer);
      projectsTimer = setInterval(() => load("projects").then(() => emit()), 60000);
      await Promise.all([refresh(), load("projects")]);
      emit(true);
      tickColony();
    },
    stop() {
      started = false;
      if (stream) stream.close();
      stream = null;
      clearInterval(colonyTimer);
      clearInterval(projectsTimer);
      colonyTimer = projectsTimer = null;
    },
    // The user changed the refresh interval.
    setPollMs(ms) {
      if (ms && ms !== pollMs && started) {
        pollMs = ms;
        openStream();
      }
    },
    refresh,
    recheck: () => refresh(["herd"]),
    // Subscribe to state changes. Invoked once immediately with the current state. Returns unsubscribe.
    subscribe(fn) {
      subs.add(fn);
      try {
        fn(state);
      } catch (err) {
        console.error("agents-store subscriber failed", err);
      }
      return () => subs.delete(fn);
    },
    // Raw SSE/poll events for pages (health, improve, tick). Returns unsubscribe.
    onEvent(fn) {
      eventSubs.add(fn);
      return () => eventSubs.delete(fn);
    },
    // Colony panes are polled (8s) only while someone watches. Returns release().
    watchColony() {
      colonyWatch += 1;
      if (colonyWatch === 1) tickColony();
      let done = false;
      return () => {
        if (done) return;
        done = true;
        colonyWatch -= 1;
        if (colonyWatch === 0) tickColony();
      };
    },
    getState: () => state,
    get: (key) => state.byKey.get(key) || null,
    // Resolve a hash/deep-link reference (pane_id, worker name, or title) to a record.
    find(ref) {
      if (!ref) return null;
      return state.byKey.get(ref) || state.agents.find((a) => a.name === ref) || null;
    },
  };
}

export const agentsStore = createAgentsStore();
export default agentsStore;
