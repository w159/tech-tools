// core-row.ts: the one "Atlas core" row both harnesses draw on the idle panel: four labelled groups (contract,
// verdicts, offload, route), each a dim lowercase label and its plain figures. Only what is off takes colour (a
// refuted claim red, a partial tally amber). Cells are mission-layout runs, so the Claude band and the omp mission
// panel paint identical text. Golden: contracts/core-golden.ts.
import { type CoreModel, type Route, type Verdict, hasCore, plannedText, tok } from "./data/core";
import { uiFromEnv, type Ui } from "./atlas-ui";
import { type Run, runsText, runsWidth, type Tone } from "./mission-layout";

/** Core cells are layout runs: a tone, not a colour (mission-layout.ts TONE_HEX paints them on both harnesses). */
export type Cell = Run;

const c = (t: string, tone: Tone = "text"): Cell => ({ t, tone });
const label = (t: string): Cell => ({ t: `${t}  `, tone: "muted" });
const sep: Cell = c(" · ", "muted");
const gap: Cell = c("   ");

/** `4.3x`, `18x`: the kept-to-returned ratio, one decimal below 10. Empty for none. */
export const ratioText = (r: number | null): string =>
  r === null ? "" : `${r >= 10 ? Math.round(r) : r.toFixed(1)}x`;

const tally = (ok: number, total: number): string => (total ? `${ok} of ${total}` : "none");
/** Colour only what is off: a partial tally is amber, a complete or empty one stays plain. */
const toneOf = (ok: number, total: number): Tone => (!total ? "muted" : ok === total ? "text" : "warn");
const joinSep = (parts: Cell[]): Cell[] => parts.flatMap((p, i) => (i ? [sep, p] : [p]));

/** `contract  3/5 evidence`: the done items that carry evidence over the plan's items (`plan`, the same denominator as the band's `todo n/m`; the done
 * items when no plan is known). The header tally counts replies, a different unit, so it is not on the band (the gates tab holds it). Full reads
 * `3/5 done items carry evidence`. */
function contract(m: CoreModel, full: boolean, _ui: Ui, plan?: number): Cell[] {
  const e = m.contract.evidence;
  const total = plan && plan > 0 ? Math.max(plan, e.ok) : e.total;
  const of = `${e.ok}/${total}`;
  return [label("contract"), c(e.total ? (full ? `${of} done items carry evidence` : `${of} evidence`) : "no done items yet", toneOf(e.ok, e.total))] // amber when a done item lacks evidence: the figure is over the plan, the tone over the done items;
}

/** `verdicts  1 verified · 1 refuted`; a refuted claim is red, open and unchecked ones amber. Full adds the claim
 * count and the zero tallies. */
function verdict(m: CoreModel, full: boolean): Cell[] {
  const l = m.ledger;
  if (!m.verdicts.length && l.verified + l.refuted + l.pending === 0) { // an empty ledger says so; it never reads 0 verified · 0 refuted
    return [label("verdicts"), ...joinSep([
      ...(full ? [c(`${l.claimed} claim${l.claimed === 1 ? "" : "s"}`, "muted")] : []),
      c("no verdicts yet", "muted"),
      ...(l.unchecked ? [c(`${l.unchecked} unchecked`, "warn")] : []),
    ])];
  }
  const parts = [
    ...(full ? [c(`${l.claimed} claim${l.claimed === 1 ? "" : "s"}`, "muted")] : []),
    c(`${l.verified} verified`, l.verified ? "ok" : "muted"),
    c(`${l.refuted} refuted`, l.refuted ? "bad" : "muted"),
    ...(full || l.pending ? [c(`${l.pending} open`, l.pending ? "warn" : "muted")] : []),
    ...(full || l.unchecked ? [c(`${l.unchecked} unchecked`, l.unchecked ? "warn" : "muted")] : []),
  ];
  return [label("verdicts"), ...joinSep(parts)];
}

/** The newest route, only when it ran differently from its plan: `route  planned audit team (low effort), ran 3 explorers`. A team that ran as planned is not news on the band
 * (the core tab lists every team); nothing without one. */
function route(m: CoreModel): Cell[] {
  const r: Route | undefined = m.routes[m.routes.length - 1];
  return r && r.drift.length ? [label("route"), c(plannedText(r), "warn")] : [];
}

export const cellsWidth = (cells: readonly Cell[]): number => runsWidth(cells);
/** The row's plain text, for goldens and text surfaces. */
export const cellsText = (cells: readonly Cell[]): string => runsText(cells);

type Group = (m: CoreModel, full: boolean, ui: Ui, plan?: number) => Cell[];
const GROUPS: readonly Group[] = [contract, verdict, route];
/** Which groups widen first when there is room: the adversarial ledger, then the contract. (The route group has no wide form.) */
const WIDEN: readonly number[] = [1, 0];

/** The groups, compact, then each widened to its full form in WIDEN order while the row still fits `cols` (one leading cell). A group with nothing to say
 * (a route that ran as planned) is left out. Narrower than the groups together: contract + verdicts only. Empty without core data or room. `plan`: the
 * plan's item count, the denominator of the contract's evidence figure. */
export function coreCells(m: CoreModel | null | undefined, cols: number, ui: Ui = uiFromEnv(), plan?: number): Cell[] {
  if (!hasCore(m)) return [];
  const build = (full: readonly boolean[], groups: readonly Group[] = GROUPS): Cell[] =>
    [c(" "), ...groups.map((g, i) => g(m, full[i] ?? false, ui, plan)).filter((cs) => cs.length).flatMap((cs, i) => [...(i ? [gap] : []), ...cs])];
  const full = [false, false, false];
  if (cellsWidth(build(full)) > cols) {
    const two = build(full, GROUPS.slice(0, 2));
    return cellsWidth(two) <= cols ? two : [];
  }
  for (const i of WIDEN) {
    full[i] = true;
    if (cellsWidth(build(full)) > cols) full[i] = false;
  }
  return build(full);
}

const VERDICT_WORD: Record<Verdict["status"], string> = {
  verified: "verified",
  rejected: "REFUTED",
  "needs-evidence": "needs evidence",
};

/** Row caps keep the report on one terminal screen; the ledger file holds the rest. */
const MAX_VERDICT_ROWS = 12;
const MAX_UNCHECKED_ROWS = 3;
const MAX_WORKER_ROWS = 8;

/** The /atlas-core text: the four sections as plain lines. One line when there is nothing to report. */
export function coreReport(m: CoreModel | null): string {
  if (!hasCore(m)) return "atlas core: no verdicts, workers or teams recorded yet";
  const { header: h, evidence: e, verifiedDone: v, openGates } = m.contract;
  const l = m.ledger;
  const findings = l.verified + l.refuted + l.pending;
  const unlabeled = m.verdicts.filter((x) => !x.id && !x.title).length;
  const out: string[] = [
    "CONTRACT",
    `  header    ${tally(h.ok, h.total)} replies opened with the ATLAS header`,
    `  evidence  ${tally(e.ok, e.total)} done items carry evidence`,
    `  verified  ${tally(v.ok, v.total)} done items have a verified finding`,
    `  gates     ${openGates ? `${openGates} open` : "all clear"}`,
    "",
    `VERDICTS  ${!m.verdicts.length && findings === 0 ? "no verdicts yet" : `${findings} finding${findings === 1 ? "" : "s"}: ${l.verified} verified, ${l.refuted} refuted, ${l.pending} open`}${unlabeled ? ` (${unlabeled} unlabeled)` : ""}  |  ${l.claimed} claim${l.claimed === 1 ? "" : "s"} this run, ${l.unchecked} unchecked`,
  ];
  // attention first (refuted, open), then verified; newest first within each (file order is append order)
  const newest = m.verdicts.filter((x) => x.id || x.title).reverse();
  const shown = [...newest.filter((x) => x.status !== "verified"), ...newest.filter((x) => x.status === "verified")];
  for (const x of shown.slice(0, MAX_VERDICT_ROWS)) out.push(`  ${[VERDICT_WORD[x.status], x.id, x.title].filter(Boolean).join("  ")}`);
  if (shown.length > MAX_VERDICT_ROWS) out.push(`  ... ${shown.length - MAX_VERDICT_ROWS} more (full ledger: .atlas/.run/findings.json)`);
  const lonely = m.claims.filter((c) => c.status === "DONE" && c.matched === null);
  for (const c of lonely.slice(0, MAX_UNCHECKED_ROWS)) out.push(`  unchecked  ${c.owner} claims DONE, no verdict yet`);
  if (lonely.length > MAX_UNCHECKED_ROWS) out.push(`  ... ${lonely.length - MAX_UNCHECKED_ROWS} more unchecked`);
  if (!m.verdicts.length && !l.unchecked) out.push("  no verdict recorded yet");
  const ratio = ratioText(m.offload.ratio);
  const nw = m.offload.workers.length;
  out.push("", `OFFLOAD  ${tok(m.offload.kept)} kept in tmux, ${tok(m.offload.returned)} returned${ratio ? ` (${ratio})` : ""}, all ${nw} recorded worker${nw === 1 ? "" : "s"}`);
  // workers have no timestamp: the list is name-sorted, so the tail is the newest by spawn order
  const live = [...m.offload.workers].reverse().filter((w) => w.peak > 0 || w.kept > 0 || w.returned > 0);
  for (const w of live.slice(0, MAX_WORKER_ROWS))
    out.push(`  ${w.name}  ${w.model ?? "?"}  peak ${tok(w.peak)}  kept ${tok(w.kept)}  returned ${tok(w.returned)}  cost ${w.costUsd === null ? "?" : `$${w.costUsd.toFixed(2)}`}`);
  const hidden = live.length - MAX_WORKER_ROWS;
  const empty = nw - live.length;
  if (hidden > 0 || empty > 0)
    out.push(`  ... ${[hidden > 0 ? `${hidden} more` : "", empty > 0 ? `${empty} with no data` : ""].filter(Boolean).join(", ")}`);
  if (!nw) out.push("  no workers yet");
  out.push("", "ROUTE");
  for (const r of m.routes) {
    out.push(`  ${r.cls}/${r.effort}  ${r.name || r.teamId}  ${r.isolation}, max ${r.maxParallel}`);
    for (const s of r.seats) {
      const ran = [...new Set(s.ran)];
      const ranText = !s.ran.length ? "not run yet" : s.ran.length > s.count ? `ran ${s.ran.length} / planned ${s.count} (${ran.join(", ")})` : `ran ${ran.join(", ")}`;
      out.push(`    ${s.count}x ${s.role} ${s.model}/${s.effort}  ${ranText}`);
    }
    for (const d of r.drift) out.push(`    DRIFT ${d}`);
  }
  if (!m.routes.length) out.push("  no team yet");
  return out.join("\n");
}
