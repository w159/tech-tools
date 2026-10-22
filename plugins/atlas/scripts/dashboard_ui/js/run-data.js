// fallow-ignore-file complexity -- fallow estimates 0% coverage for node:test suites; run-data.test.js exercises every branch
// Pure adapters from live API payloads to the Run page view models. No fetch, no DOM, no clock:
// every time-dependent function takes `now` (epoch ms). Fixtures in ./fixtures were captured from the server.
//
// Payload facts (verified against the captured fixtures):
//  - /api/v2/overview: kpis[] {id,label,value,delta (percent vs prior, number|null),prior,status,hint,series}.
//    The five figures are the kpis with id runs, dispatches, silent_failures, tool_errors, findings_open
//    (rendered by numbers() at pages/overview.js:~115; runsPanel at :165 is only the recent_runs table).
//    attention[] {id,kind,severity,project,title,detail,what,next,count,first,last,action:{label,target}}.
//  - /api/v2/agents: agents[] keys key,name,kind,status,state,pane_id,workspace_id,workspace,tab_id,tab_label,cwd,
//    title,focused,deep_link,project,colony,run,parent_pane,children,children_total,state_change_seq,
//    completion_seq,state_changed_at,state_changed_source,tasks,messages,sources. There is NO session_id and
//    NO last_message_at in the live payload, so leadSessionId returns null until the server adds session_id.
//  - /api/v2/colony: members[] {name,kind (lead|worker),state,parked,last_active (epoch SECONDS),tasks,last_note}.
//  - /api/v2/channels/<name>: messages[] {id,ts (ISO),from,to,body,kind}; no seq, text lives in `body`.
import { STATE_GLYPH, roleLetter } from "./glyph-table.js";
import { relTime, baseName } from "./dom.js";
import { waitingAgents } from "./pages/overview-model.js";

// ponytail: one cell per 7.5 minutes of idle time, 8 cells max; tune CELL_MS if the band feels too slow.
const CELL_MS = 7.5 * 60 * 1000;
const MAX_CELLS = 8;
const METRIC_CELLS = 13;
// Mirrors headerFirstLinePattern in plugins/atlas/contracts/operating-contract.json:14, with phase and n/m captured.
const HEADER_RE =
  /^ATLAS \| \S+ (research|theory|test|validate|implement|verify|done|blocked)(?: (\d+)\/(\d+))? \| \S/;

const list = (v) => (Array.isArray(v) ? v : (v && v.agents) || []);

function parseHeader(header) {
  const lines = String(header || "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = HEADER_RE.exec(lines[i].trim());
    if (m)
      return { phase: m[1], n: m[2] ? +m[2] : null, m: m[3] ? +m[3] : null };
  }
  return { phase: "research", n: null, m: null };
}

export function toBand(overview, colony, header) {
  const c = colony && colony.ok ? colony : null;
  const members = (c && c.members) || [];
  const count = (f) => members.filter(f).length;
  return {
    project: c && c.project ? baseName(c.project) : "",
    branch: (c && c.channel && c.channel.branch) || "",
    lead: (c && c.lead && c.lead.name) || "",
    ...parseHeader(header),
    counts: {
      working: count((m) => m.state === "running" && !m.parked),
      needs: c ? ((overview && overview.attention) || []).length : 0,
      failed: count((m) => m.state === "failed" || m.state === "stuck"),
      parked: count((m) => m.parked || m.state === "parked"),
    },
  };
}

// Colony member names are `<prefix>-<slice>`; the prefix names the role.
const PREFIX_ROLE = {
  impl: "implementer",
  docs: "docs-curator",
  test: "test-engineer",
  review: "reviewer",
  rereview: "reviewer",
};

function roleOf(name, kind) {
  if (kind === "lead") return "lead";
  const p = String(name || "").split("-")[0];
  return PREFIX_ROLE[p] || p || "";
}

function seat(name, role, state, stamp, now, extra) {
  const t = typeof stamp === "number" ? stamp : Date.parse(stamp);
  const cells =
    Number.isFinite(t) && Number.isFinite(now)
      ? Math.floor(Math.max(0, now - t) / CELL_MS)
      : 0;
  return {
    name,
    role,
    letter: roleLetter(role),
    state,
    glyph: STATE_GLYPH[state] || STATE_GLYPH.idle,
    tool: "",
    elapsedCells: Math.min(MAX_CELLS, cells),
    age: Number.isFinite(t) ? relTime(t, now) : "",
    colony: false,
    lead: role === "lead",
    selected: false,
    ...extra,
  };
}

export function toSeats(agents, colony, now) {
  if (colony && colony.ok && Array.isArray(colony.members)) {
    return colony.members.map((m) => {
      const active = (m.tasks || []).find((t) => t.status === "in_progress");
      return seat(
        m.name,
        roleOf(m.name, m.kind),
        m.parked ? "parked" : m.state,
        (m.last_active || 0) * 1000 || null,
        now,
        {
          tool: (active && active.title) || "",
          colony: true,
        },
      );
    });
  }
  return list(agents).map((a) =>
    seat(
      a.name,
      roleOf(a.name, a.kind === "lead" ? "lead" : ""),
      a.state,
      a.state_changed_at || a.last_message_at,
      now,
      {
        colony: !!a.colony,
      },
    ),
  );
}

const KIND_GLYPH = {
  done: STATE_GLYPH.finished,
  blocked: STATE_GLYPH.stuck,
  question: STATE_GLYPH.input,
};
const NEEDS_KIND = new Set(["blocked", "question", "needs"]);

export function toFeed(notes) {
  const seen = new Set();
  const rows = [];
  for (const n of notes || []) {
    const text = n.body ?? n.text ?? "";
    const key = String(n.seq ?? n.id ?? `${n.ts}${n.from}${text}`);
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = n.kind || "note";
    const hm = HEADER_RE.exec(String(text).trim());
    rows.push({
      key,
      t: n.ts,
      kindGlyph: KIND_GLYPH[kind] || STATE_GLYPH.parked,
      kindClass: `k-${kind}`,
      from: n.from || "",
      fromClass: `r-${roleOf(n.from, "")}`,
      text,
      needs: NEEDS_KIND.has(kind) || /^needs\b/i.test(text),
      ...(hm ? { phase: hm[1] } : {}),
    });
  }
  return rows.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

function stateLine(word, since, now) {
  const age = Number.isFinite(now) && since ? relTime(since, now) : "";
  return age ? `${word} ${age}` : word;
}

export function toNeeds(overview, agents, now) {
  const items = waitingAgents(
    Array.isArray(agents) ? { agents } : agents,
    null,
  ).map((a) => ({
    key: a.key,
    title: a.name,
    detail: a.project || "",
    state: "waiting",
    stateLine: stateLine("waiting", a.since, now),
    actions: [{ label: "Open", target: `agents#${a.key}` }],
  }));
  for (const it of (overview && overview.attention) || []) {
    const state = /crit|fail|err|high/i.test(it.severity || "")
      ? "failing"
      : "warning";
    items.push({
      key: it.id || it.title,
      title: it.title || "",
      detail: it.detail || it.what || "",
      state,
      stateLine: stateLine(state, it.since || it.first, now),
      actions:
        it.action && it.action.target
          ? [{ label: it.action.label || "Open", target: it.action.target }]
          : [],
    });
  }
  return items;
}

export function toGates(gates) {
  return ((gates && gates.ok && gates.lines) || []).map((l) => ({
    letter: l.letter,
    label: l.label,
    ok: l.passed,
    message: l.message,
  }));
}

// id, label, and whether a lower count is the good direction.
const METRICS = [
  ["runs", "Runs", false],
  ["dispatches", "Dispatches", false],
  ["silent_failures", "Silent failures", true],
  ["tool_errors", "Tool errors", true],
  ["findings_open", "Doctor findings", true],
];

export function toMetrics(overview) {
  const kpis = (overview && overview.kpis) || [];
  const rows = METRICS.map(([id, label, lowerBetter]) => {
    const k = kpis.find((x) => x.id === id);
    const d = k && Number.isFinite(k.delta) ? k.delta : 0;
    const tone =
      d === 0
        ? "flat"
        : d < 0
          ? lowerBetter
            ? "up"
            : "dn"
          : lowerBetter
            ? "bad"
            : "up";
    return {
      id,
      label,
      n: k ? k.value : null,
      cells: 0,
      delta: d === 0 ? "0" : `${d > 0 ? "+" : ""}${d.toFixed(1)}%`,
      tone,
    };
  });
  const max = Math.max(0, ...rows.map((r) => r.n || 0));
  for (const r of rows)
    r.cells = max ? Math.round(((r.n || 0) / max) * METRIC_CELLS) : 0;
  return rows;
}

// The gates route reads this session's transcript; the lead is named by the colony, else the agent of kind lead.
export function leadSessionId(agents, colony) {
  const all = list(agents);
  const name = colony && colony.lead && colony.lead.name;
  const a =
    (name && all.find((x) => x.name === name)) ||
    all.find((x) => x.kind === "lead");
  return (a && a.session_id) || null;
}
