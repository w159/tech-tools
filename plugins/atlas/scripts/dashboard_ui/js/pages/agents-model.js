// Pure logic for the Agents page and its drawer. No DOM, no network (unit-tested in agents-model.test.js).
import { baseName } from "../dom.js";

export const STATE_FILTERS = [
  { value: "all", label: "All" },
  { value: "input", label: "Needs input" },
  { value: "working", label: "Working" },
  { value: "ready", label: "Ready" },
  { value: "done", label: "Done" },
  { value: "fail", label: "Failed" },
];

/** Mirrors TARGET_RE in atlas_dash_term.py: only tmux targets can be attached over the websocket. */
const TMUX_TARGET = /^%[0-9]+$|^atlas-[A-Za-z0-9_-]+(:[A-Za-z0-9_.-]+)?$/;
export const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
/** Pane ids and worker names the agent routes accept (API.md). */
const AGENT_ID = /^[A-Za-z0-9:_.-]{1,64}$/;

export function inProject(row, project) {
  if (!project || project === "all") return true;
  const dir = (p) => p === project || String(p || "").startsWith(`${project}/`);
  return dir(row.project) || dir(row.cwd);
}

/** Rows matching the search text (name, task, project, kind) and the state chip. */
export function filterRows(rows, { q = "", state = "all" } = {}) {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (state !== "all" && r.state !== state) return false;
    if (!needle) return true;
    return [r.name, r.task, r.kind, r.project, r.cwd]
      .join("\n")
      .toLowerCase()
      .includes(needle);
  });
}

/** Group rows by project, groups ordered by name, rows with no project last. -> [{project, label, rows}] */
export function groupByProject(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.project || "";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()]
    .map(([project, rs]) => ({
      project,
      label: project ? baseName(project) : "No project",
      rows: rs,
    }))
    .sort(
      (a, b) =>
        (a.project === "") - (b.project === "") ||
        a.label.localeCompare(b.label),
    );
}

/** A channel participant that has exited: no live pane, no project, state Unknown. */
export function isRecentParticipant(row) {
  return !row.pane_id && !row.project && row.state === "unknown";
}

/** Split rows into the live table and the collapsed "Recent participants" group. */
export function splitRecent(rows) {
  const recent = rows.filter(isRecentParticipant);
  return { live: rows.filter((r) => !isRecentParticipant(r)), recent };
}

/** Counts per chip value for the filter row (always counts the unfiltered-by-state list). */
export function chipCounts(rows) {
  const out = {
    all: rows.length,
    input: 0,
    working: 0,
    ready: 0,
    done: 0,
    fail: 0,
  };
  for (const r of rows) if (r.state in out) out[r.state] += 1;
  return out;
}

/**
 * How the Terminal tab reaches a row.
 * stream: websocket via a ticket. peek: read-only text. A herdr pane id is not a tmux target,
 * so it gets peek.
 */
export function terminalPlan(row) {
  if (row.source === "seat" && row.seatKind === "shell")
    return {
      mode: "stream",
      ticket: { kind: "shell", cwd: row.cwd || undefined },
    };
  if (row.source === "seat" && row.seatKind === "tui")
    return { mode: "stream", ticket: { kind: "tui" } };
  if (row.target && TMUX_TARGET.test(row.target))
    return { mode: "stream", ticket: { kind: "pane", target: row.target } };
  return {
    mode: "peek",
    id: AGENT_ID.test(row.key) ? row.key : null,
    hint: (row.raw && row.raw.attach_hint) || "",
  };
}

/** Only an idle claude/omp pane accepts a prompt; the server enforces the rest (409). */
export function promptState(row) {
  if (row.source !== "agent" || !row.pane_id || !AGENT_ID.test(row.key))
    return { ok: false, reason: "This has no agent pane to prompt." };
  if (row.state !== "ready")
    return {
      ok: false,
      reason: `Prompts go to ready agents. This one is ${row.word.toLowerCase()}.`,
    };
  return { ok: true, reason: "" };
}

export function canStop(row) {
  return !!(row.colony && row.pane_id);
}

/** Names a row answers to in channels and on the board. */
export function identities(row) {
  return [row.name, row.address, row.key, row.pane_id].filter(Boolean);
}

/** Channels the agent belongs to (member name or lead). */
export function channelsFor(channels, row) {
  const ids = new Set(identities(row));
  return (channels || []).filter(
    (c) => ids.has(c.lead) || (c.members || []).some((m) => ids.has(m.name)),
  );
}

/** Messages to or from the agent across channel payloads, oldest first, de-duplicated by id. */
export function messagesFor(payloads, row) {
  const ids = new Set(identities(row));
  const seen = new Set();
  const out = [];
  for (const p of payloads) {
    for (const m of (p && p.messages) || []) {
      if (!ids.has(m.from) && !ids.has(m.to)) continue;
      const k = m.id ?? `${m.ts}|${m.from}|${m.body}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ...m, channel: m.channel_name || (p && p.channel) || "" });
    }
  }
  return out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

export const HUMAN_SENDERS = new Set(["you", "human"]);

/** Flatten a todos payload ({phases:[{name,items}]}) into one item list. */
export function flattenTodos(state) {
  const out = [];
  for (const ph of (state && state.phases) || [])
    for (const it of ph.items || []) out.push(it);
  return out;
}

/** Todos where claimed_by, owner or launch.target/window match the agent. */
export function todosFor(state, row) {
  const ids = new Set(identities(row));
  return flattenTodos(state).filter((t) => {
    const l = t.launch || {};
    return [t.claimed_by, t.owner, l.target, l.window].some(
      (v) => v && ids.has(v),
    );
  });
}
