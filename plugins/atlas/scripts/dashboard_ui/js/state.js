// Status vocabulary and agent merge. Pure: no DOM, no network (unit-tested in state.test.js).

/** The only five status words the UI shows, plus Unknown. `tone` maps to the .s-* CSS classes. */
const STATUS = {
  working: { word: "Working", tone: "working" },
  input: { word: "Needs input", tone: "needs" },
  ready: { word: "Ready", tone: "idle" },
  done: { word: "Done", tone: "ok" },
  fail: { word: "Failed", tone: "fail" },
  unknown: { word: "Unknown", tone: "unknown" },
};

const RAW_TO_STATE = {
  working: "working",
  running: "working",
  busy: "working",
  active: "working",
  input: "input",
  blocked: "input",
  waiting: "input",
  needs_input: "input",
  idle: "ready",
  ready: "ready",
  done: "done",
  finished: "done",
  ended: "done",
  exited: "done",
  complete: "done",
  completed: "done",
  fail: "fail",
  failed: "fail",
  error: "fail",
};

/** Map any raw state string to one of the STATUS keys. */
export function normalizeState(raw) {
  return RAW_TO_STATE[String(raw ?? "").toLowerCase()] || "unknown";
}

/** statusOf(raw) -> {key, word, tone}. */
export function statusOf(raw) {
  const key = normalizeState(raw);
  return { key, ...STATUS[key] };
}

/** Key a row by pane id, then address, then name (brief 5.2). */
export function agentKey(rec) {
  return rec.pane_id || rec.address || rec.name || rec.key || "";
}

function firstTask(rec) {
  const t = Array.isArray(rec.tasks) && rec.tasks.length ? rec.tasks[0] : null;
  if (!t) return "";
  return typeof t === "string" ? t : t.content || t.title || "";
}

function fromAgent(a) {
  const st = statusOf(a.state || a.status);
  return {
    key: agentKey(a),
    name: a.name || a.title || a.key || "",
    kind: a.kind && a.kind !== "unknown" ? a.kind : "",
    state: st.key,
    word: st.word,
    tone: st.tone,
    project: a.project || null,
    cwd: a.cwd || "",
    task: firstTask(a) || a.title || "",
    since: a.state_changed_at || null,
    pane_id: a.pane_id || null,
    target: a.pane_id || null,
    address: a.address || null,
    colony: !!a.colony,
    deep_link: a.deep_link || null,
    channelMessages: a.messages || null,
    source: "agent",
    raw: a,
  };
}

function fromSeat(s) {
  const isShell = s.kind === "shell";
  const ended = String(s.state || "").toLowerCase() === "ended";
  const st = statusOf(isShell && !ended ? "ready" : s.state);
  return {
    key: agentKey(s),
    name: s.name || s.address || "",
    kind: isShell ? "shell" : s.kind === "tui" ? "tui" : s.runtime || "",
    state: st.key,
    word: st.word,
    tone: st.tone,
    project: s.project || null,
    cwd: s.cwd || "",
    task: "",
    since: s.last_activity || s.started_at || null,
    pane_id: s.pane || null,
    target: s.target || null,
    address: s.address || null,
    colony: false,
    deep_link: null,
    channelMessages: null,
    seatKind: s.kind || "pane",
    source: "seat",
    raw: s,
  };
}

/**
 * Merge /api/v2/agents and /api/v2/term/seats into one row list (brief 5.2).
 * Seats already represented by an agent (same pane or address; never bare name) are skipped; the rest add
 * shells and the host TUI seat.
 */
export function mergeAgents(agentsPayload, seatsPayload) {
  const rows = [];
  const seen = new Set();
  const mark = (r) => {
    for (const k of [r.key, r.pane_id, r.address]) if (k) seen.add(k);
  };
  for (const a of (agentsPayload && agentsPayload.agents) || []) {
    const r = fromAgent(a);
    if (!r.key) continue;
    rows.push(r);
    mark(r);
  }
  for (const space of (seatsPayload && seatsPayload.spaces) || []) {
    for (const s of space.seats || []) {
      const r = fromSeat(s);
      if (!r.key) continue;
      if ([r.key, r.pane_id, r.address].some((k) => k && seen.has(k)))
        continue;
      rows.push(r);
      mark(r);
    }
  }
  return rows;
}

/** Count rows per state key. */
export function countStates(rows) {
  const out = { working: 0, input: 0, ready: 0, done: 0, fail: 0, unknown: 0 };
  for (const r of rows) out[r.state] = (out[r.state] || 0) + 1;
  return out;
}

/** Tiny observable store: get, set (shallow replace), update(fn), subscribe(fn) -> unsubscribe. */
export function createStore(initial) {
  let value = initial;
  const subs = new Set();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const fn of [...subs]) fn(value);
    },
    update(fn) {
      this.set(fn(value));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
