// core.ts: the four Atlas pillars as one pure model, read from the run scratch both harnesses write.
//   contract  - the operating contract: reply headers that matched, done items that carry evidence, open gates
//   verdicts  - the adversarial ledger: worker claims (STATUS: DONE reports) against verifier verdicts (findings.json)
//   offload   - context kept out of the lead: each tmux worker's context growth past its brief vs the report it sent back
//   routes    - the decision model: class/effort -> scope-matrix seats -> the model each worker actually ran
// Pure: strings in, plain values out (no `$`, no Node), so the Claude band, the pane, /atlas-core and the omp
// mission panel all render the same numbers. Plan: docs/plans/2026-10-27_atlas-core-mods.md.
import type { TodoItem } from "../contract";

export type VerdictStatus = "verified" | "rejected" | "needs-evidence";
export type Verdict = {
  id: string;
  status: VerdictStatus;
  title: string;
  by: string;
  at: number;
  evidence: string;
};
export type Claim = {
  owner: string;
  role: string;
  status: "DONE" | "FAILED" | "BLOCKED";
  at: number;
  matched: string | null;
};
export type Offload = {
  name: string;
  role: string;
  model: string | null;
  brief: number;
  peak: number;
  kept: number;
  returned: number;
  costUsd: number | null;
  finished: boolean;
};
export type Seat = {
  role: string;
  count: number;
  model: string;
  effort: string;
  ran: string[];
};
export type Route = {
  teamId: string;
  name: string;
  cls: string;
  effort: string;
  isolation: string;
  maxParallel: number;
  seats: Seat[];
  drift: string[];
};
export type Tally = { ok: number; total: number };

export type CoreModel = {
  contract: {
    header: Tally;
    evidence: Tally;
    openGates: number;
    verifiedDone: Tally;
  };
  verdicts: Verdict[];
  claims: Claim[];
  ledger: {
    verified: number;
    refuted: number;
    pending: number;
    claimed: number;
    unchecked: number;
  };
  offload: {
    workers: Offload[];
    kept: number;
    returned: number;
    ratio: number | null;
  };
  routes: Route[];
};

export type ReportNote = { owner: string; text: string; at: number };
export type CoreInput = {
  findings: string;
  teams: { name: string; text: string }[];
  matrix: string;
  logs: Record<string, string>;
  reports: ReportNote[];
  todos: readonly TodoItem[];
  header: Tally;
  openGates: number;
};

/** Roles whose STATUS: DONE is a claim another model must check; judges (verifier, critics, auditors) are not. */
const CLAIMANTS = new Set([
  "implementer",
  "runner",
  "test-engineer",
  "docs-curator",
]);
const STATUS_RE = /^STATUS:\s*(DONE|FAILED|BLOCKED)\b/m;
const VERDICTS: readonly VerdictStatus[] = [
  "verified",
  "rejected",
  "needs-evidence",
];

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** `implementer-0278` -> `implementer`, `docs-curator-2` -> `docs-curator`: the name less a trailing tag that has a
 * digit in it (`impl-auth` keeps its name; the team record's role wins over this guess wherever there is one). */
export const roleOfName = (name: string): string =>
  name.replace(/-(?=[0-9a-z]*\d)[0-9a-z]{1,6}$/i, "") || name;

// ---- verdicts ---------------------------------------------------------------------------

/** findings.json rows with a known verdict status; anything else in the file is ignored, a bad file reads as none. */
export function parseFindings(text: string): Verdict[] {
  const doc = parse(text);
  if (!Array.isArray(doc)) return [];
  return doc.flatMap((r: any): Verdict[] => {
    if (!r || typeof r !== "object" || !VERDICTS.includes(r.status)) return [];
    const ev = Array.isArray(r.evidence)
      ? r.evidence.map(str).filter(Boolean).join("; ")
      : str(r.evidence);
    const at = Date.parse(str(r.verified_at));
    return [
      {
        id: String(r.id ?? ""),
        status: r.status,
        title: str(r.title),
        by: str(r.verified_by) || "verifier",
        at: Number.isNaN(at) ? 0 : at,
        evidence: ev,
      },
    ];
  });
}

/** Claims from report notes, oldest first: one per claimant report with a STATUS line. */
export function claimsOf(reports: readonly ReportNote[], roles: Record<string, string> = {}): (Claim & { text?: string })[] {
  return reports
    .map((r) => ({ r, role: roles[r.owner] ?? roleOfName(r.owner), m: STATUS_RE.exec(r.text) }))
    .filter((x) => x.m && CLAIMANTS.has(x.role))
    .map(({ r, role, m }) => ({
      owner: r.owner,
      role,
      status: m![1] as Claim["status"],
      at: r.at,
      matched: null as string | null,
      text: r.text,
    }))
    .sort((a, b) => a.at - b.at);
}

/** Whole-token, case-insensitive match of a verdict id inside a report text. */
const mentions = (text: string, id: string): boolean =>
  id !== "" && new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(text);

/** A verdict checks the earliest unchecked DONE claim at or before it whose report names the verdict id.
 * Only a verdict whose id no DONE claim names falls back to time order (first unused claim at or before it);
 * a verdict whose id is named only by already-checked claims checks nothing. */
export function pairClaims(
  claims: readonly (Claim & { text?: string })[],
  verdicts: readonly Verdict[],
): Claim[] {
  const out: Claim[] = claims.map(({ text: _t, ...c }) => ({ ...c }));
  const sorted = [...verdicts].sort((a, b) => a.at - b.at);
  const named = (v: Verdict, i: number): boolean =>
    claims[i]!.status === "DONE" && mentions(claims[i]!.text ?? "", v.id);
  const fallback: Verdict[] = [];
  for (const v of sorted) {
    if (!claims.some((_, i) => named(v, i))) {
      fallback.push(v);
      continue;
    }
    const i = out.findIndex((c, k) => named(v, k) && c.matched === null && c.at <= v.at);
    if (i >= 0) out[i]!.matched = v.id;
  }
  for (const v of fallback) {
    const i = out.findIndex((c) => c.status === "DONE" && c.matched === null && c.at <= v.at);
    if (i >= 0) out[i]!.matched = v.id;
  }
  return out;
}

// ---- offload ------------------------------------------------------------------------------

type Usage = Record<string, unknown>;
/** Context one model call held: claude's input + cache read + cache write, or omp's input + cacheRead + cacheWrite. */
const ctxOf = (u: Usage): number =>
  num(u.input_tokens) +
  num(u.cache_read_input_tokens) +
  num(u.cache_creation_input_tokens) +
  num(u.input) +
  num(u.cacheRead) +
  num(u.cacheWrite);

/** The model that cost the most in a claude `result` event's modelUsage. */
function topModel(modelUsage: unknown): string | null {
  if (!modelUsage || typeof modelUsage !== "object") return null;
  const rows = Object.entries(modelUsage as Record<string, Usage>).sort(
    (a, b) => num(b[1].costUSD) - num(a[1].costUSD),
  );
  return rows[0]?.[0] ?? null;
}

/** One worker's offload from its pane log (claude stream-json or omp --mode json) and the report it returned.
 * brief: the first call's context (system prompt + brief, which the lead already holds); kept: what the worker read
 * past that; returned: the report's size in tokens (chars / 4, the usual estimate). */
export function offloadOf(name: string, log: string, report: string, role = roleOfName(name)): Offload {
  const calls = new Map<string, number>();
  let model: string | null = null;
  let cost: number | null = null;
  let finished = false;
  for (const line of log.split("\n")) {
    if (!line.startsWith("{")) continue;
    const e = parse(line) as any;
    if (!e || typeof e !== "object") continue;
    const msg = e.message && typeof e.message === "object" ? e.message : null;
    if (e.type === "assistant" && msg?.usage)
      calls.set(String(msg.id ?? calls.size), ctxOf(msg.usage));
    if (e.type === "message_end" && msg?.role === "assistant" && msg.usage)
      calls.set(`omp-${calls.size}`, ctxOf(msg.usage));
    if (msg && typeof msg.model === "string" && msg.model) model = msg.model;
    if (e.type === "result") {
      finished = true;
      cost = typeof e.total_cost_usd === "number" ? e.total_cost_usd : cost;
      model = topModel(e.modelUsage) ?? model;
    }
    if (e.type === "agent_end") finished = true;
  }
  const ctx = [...calls.values()];
  const brief = ctx[0] ?? 0;
  const peak = ctx.length ? Math.max(...ctx) : 0;
  return {
    name,
    role,
    model,
    brief,
    peak,
    kept: Math.max(0, peak - brief),
    returned: Math.ceil(report.length / 4),
    costUsd: cost,
    finished,
  };
}

// ---- routes -------------------------------------------------------------------------------

/** `claude-sonnet-5-5` ran a `sonnet` seat; `anthropic/claude-opus-5-5` ran `opus`. `inherit` matches anything. */
const ranAs = (seat: string, ran: string): boolean =>
  seat === "inherit" || ran.toLowerCase().includes(seat.toLowerCase());

function seatsOf(
  matrix: any,
  cls: string,
  effort: string,
): Omit<Seat, "ran">[] {
  const c =
    matrix?.classes?.[matrix?.class_aliases?.[cls] ?? cls]?.[
      matrix?.effort_aliases?.[effort] ?? effort
    ];
  if (!Array.isArray(c?.team)) return [];
  return c.team.map((s: any) => ({
    role: str(s.role),
    count: num(s.count) || 1,
    model: str(s.model) || "inherit",
    effort: str(s.effort) || effort,
  }));
}

/** One route per team record: the matrix cell the class/effort picked, and the model each member's log shows it ran. */
export function routesOf(
  teams: readonly { name: string; text: string }[],
  matrixText: string,
  offload: readonly Offload[],
): Route[] {
  const matrix = parse(matrixText);
  const created = (t: { text: string }): number => num((parse(t.text) as any)?.created);
  return [...teams].sort((x, y) => created(x) - created(y)).flatMap((t): Route[] => {
    const r = parse(t.text) as any;
    if (!r || typeof r !== "object" || !r.class) return [];
    const members: string[] = Array.isArray(r.members)
      ? r.members.map((m: any) => str(m?.name))
      : [];
    const ranBy = (role: string): string[] =>
      offload
        .filter((o) => members.includes(o.name) && o.role === role && o.model)
        .map((o) => o.model!);
    const seats = seatsOf(matrix, str(r.class), str(r.effort)).map((s) => ({
      ...s,
      ran: ranBy(s.role),
    }));
    const drift = seats.flatMap((s) =>
      s.ran
        .filter((m) => !ranAs(s.model, m))
        .map((m) => `${s.role} ran ${m}, seat is ${s.model}`),
    );
    return [
      {
        teamId: str(r.team_id) || t.name.replace(/\.json$/, ""),
        name: str(r.name),
        cls: str(r.class),
        effort: str(r.effort),
        isolation: str(r.isolation),
        maxParallel: num(r.max_parallel) || 1,
        seats,
        drift,
      },
    ];
  });
}

// ---- assembly -----------------------------------------------------------------------------

const lastReport = (reports: readonly ReportNote[], name: string): string =>
  [...reports].reverse().find((r) => r.owner === name)?.text ?? "";

/** Worker name -> role from every team record's members list. */
function teamRoles(teams: readonly { text: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of teams) {
    const r = parse(t.text) as any;
    for (const m of Array.isArray(r?.members) ? r.members : []) if (str(m?.name) && str(m?.role)) out[m.name] = m.role;
  }
  return out;
}

export function coreModel(input: CoreInput): CoreModel {
  const verdicts = parseFindings(input.findings);
  const roles = teamRoles(input.teams);
  const claims = pairClaims(claimsOf(input.reports, roles), verdicts);
  const workers = Object.keys(input.logs)
    .sort()
    .map((name) =>
      offloadOf(name, input.logs[name]!, lastReport(input.reports, name), roles[name]),
    );
  const kept = workers.reduce((n, w) => n + w.kept, 0);
  const returned = workers.reduce((n, w) => n + w.returned, 0);
  const done = input.todos.filter((t) => t.status === "completed");
  const verifiedIds = new Set(
    verdicts.filter((v) => v.status === "verified").map((v) => v.id),
  );
  const claimed = claims.filter((c) => c.status === "DONE").length;
  return {
    contract: {
      header: input.header,
      evidence: {
        ok: done.filter((t) => (t.evidence ?? "").trim() !== "").length,
        total: done.length,
      },
      openGates: input.openGates,
      verifiedDone: {
        ok: done.filter((t) => verifiedIds.has(t.id)).length,
        total: done.length,
      },
    },
    verdicts,
    claims,
    ledger: {
      verified: verdicts.filter((v) => v.status === "verified").length,
      refuted: verdicts.filter((v) => v.status === "rejected").length,
      pending: verdicts.filter((v) => v.status === "needs-evidence").length,
      claimed,
      unchecked: claims.filter((c) => c.status === "DONE" && c.matched === null)
        .length,
    },
    offload: {
      workers,
      kept,
      returned,
      ratio: returned > 0 && kept > 0 ? kept / returned : null,
    },
    routes: routesOf(input.teams, input.matrix, workers),
  };
}

/** True when there is anything to show: a verdict, a claim, a worker log or a team route. */
export const hasCore = (m: CoreModel | null | undefined): m is CoreModel =>
  !!m &&
  (m.verdicts.length > 0 ||
    m.claims.length > 0 ||
    m.offload.workers.length > 0 ||
    m.routes.length > 0);

/** `58.8k`, `912`, `1.2M`: token counts for one cell. */
export function tok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
