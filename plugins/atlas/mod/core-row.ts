// core-row.ts: the one "Atlas core" row both harnesses draw on the idle panel: four labelled groups (contract,
// verdicts, offload, route), each a dim lowercase label and its plain figures. Only what is off takes colour (a
// refuted claim red, a partial tally amber). Cells are mission-layout runs, so the Claude band and the omp mission
// panel paint identical text. Golden: contracts/core-golden.ts.
import { type CoreModel, type Route, type Verdict, hasCore, tok } from "./data/core";
import { type Run, runsText, runsWidth, type Tone } from "./mission-layout";

/** Core cells are layout runs: a tone, not a colour (mission-layout.ts TONE_HEX paints them on both harnesses). */
export type Cell = Run;

const c = (t: string, tone: Tone = "text"): Cell => ({ t, tone });
const label = (t: string): Cell => ({ t: `${t}  `, tone: "dim" });
const sep: Cell = c(" · ", "dim");
const gap: Cell = c("   ");

/** `4.3x`, `18x`: the kept-to-returned ratio, one decimal below 10. Empty for none. */
export const ratioText = (r: number | null): string =>
  r === null ? "" : `${r >= 10 ? Math.round(r) : r.toFixed(1)}x`;

const tally = (ok: number, total: number): string => (total ? `${ok}/${total}` : "none");
/** Colour only what is off: a partial tally is amber, a complete or empty one stays plain. */
const toneOf = (ok: number, total: number): Tone => (!total ? "muted" : ok === total ? "text" : "warn");
const joinSep = (parts: Cell[]): Cell[] => parts.flatMap((p, i) => (i ? [sep, p] : [p]));

/** `contract  header 3/4 · evidence 7/7`; compact drops the evidence tally when nothing carries evidence yet. */
function contract(m: CoreModel, full: boolean): Cell[] {
  const { header: h, evidence: e } = m.contract;
  const parts = [c(`header ${tally(h.ok, h.total)}`, toneOf(h.ok, h.total))];
  if (full || e.total) parts.push(c(`evidence ${tally(e.ok, e.total)}`, toneOf(e.ok, e.total)));
  return [label("contract"), ...joinSep(parts)];
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

/** `offload  17.9k kept in 3 workers → 608 back (30x)`; compact `offload  17.9k → 608 (30x)`. */
function offload(m: CoreModel, full: boolean): Cell[] {
  const o = m.offload;
  if (!o.workers.length) return [label("offload"), c("none yet", "muted")];
  const ratio = ratioText(o.ratio);
  const n = o.workers.length;
  const body = full ? `${tok(o.kept)} kept in ${n} worker${n === 1 ? "" : "s"} → ${tok(o.returned)} back` : `${tok(o.kept)} → ${tok(o.returned)}`;
  return [label("offload"), c(body), ...(ratio ? [c(` (${ratio})`, "muted")] : [])];
}

/** The newest route: `route  fix/low → implementer sonnet ✓`; a drifted seat reads `✗ drift` in red; `+N more` older routes. */
function route(m: CoreModel, full: boolean): Cell[] {
  const r: Route | undefined = m.routes[m.routes.length - 1];
  if (!r) return [label("route"), c("no team yet", "muted")];
  const seats = r.seats.map((s) => `${s.count > 1 ? `${s.count}× ` : ""}${s.role} ${s.model}`).join(", ");
  const ran = r.seats.some((s) => s.ran.length);
  const markCell = r.drift.length ? c(" ✗ drift", "bad") : ran ? c(" ✓", "ok") : c(" …", "muted");
  const more = full && m.routes.length > 1 ? [c(` +${m.routes.length - 1} more`, "muted")] : [];
  return [label("route"), c(`${r.cls}/${r.effort}`), ...(full ? [c(" → ", "dim"), c(seats || "?")] : []), markCell, ...more];
}

export const cellsWidth = (cells: readonly Cell[]): number => runsWidth(cells);
/** The row's plain text, for goldens and text surfaces. */
export const cellsText = (cells: readonly Cell[]): string => runsText(cells);

type Group = (m: CoreModel, full: boolean) => Cell[];
const GROUPS: readonly Group[] = [contract, verdict, offload, route];
/** Which groups widen first when there is room: the adversarial ledger, then the route, the offload, the contract. */
const WIDEN: readonly number[] = [1, 3, 2, 0];

/** All four groups, compact, then each widened to its full form in WIDEN order while the row still fits `cols`
 * (one leading cell). Narrower than four compact groups: contract + verdicts only. Empty without core data or room. */
export function coreCells(m: CoreModel | null | undefined, cols: number): Cell[] {
  if (!hasCore(m)) return [];
  const build = (full: readonly boolean[], groups: readonly Group[] = GROUPS): Cell[] =>
    [c(" "), ...groups.flatMap((g, i) => [...(i ? [gap] : []), ...g(m, full[i] ?? false)])];
  const full = [false, false, false, false];
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
