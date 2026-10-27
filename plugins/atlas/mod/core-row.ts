// core-row.ts: the one "Atlas core" row both harnesses draw under the phase rail: four chips (CONTRACT, VERDICT,
// OFFLOAD, ROUTE), each followed by its live figures. Cells carry a hue name, not a color, so the Claude band
// (Segment via MOCHA) and the omp mission panel (ANSI via the same hex) paint identical text.
// Twins: mod/band.tsx coreSegments, omp/mission-panel.ts coreLine. Golden: contracts/core-golden.ts.
import { type CoreModel, type Route, type Verdict, hasCore, tok } from "./data/core";
import { textWidth } from "./theme";

export type Hue =
  | "text"
  | "muted"
  | "green"
  | "red"
  | "yellow"
  | "violet"
  | "sky"
  | "peach"
  | "teal";
/** chip: drawn as a filled label (`bg` the hue); otherwise plain text in the hue. */
export type Cell = { t: string; hue: Hue; chip?: boolean };

const c = (t: string, hue: Hue = "text"): Cell => ({ t, hue });
const k = (t: string, hue: Hue): Cell => ({ t, hue, chip: true });
const gap: Cell = c("  ");

/** `4.3x`, `18x`: the kept-to-returned ratio, one decimal below 10. Empty for none. */
export const ratioText = (r: number | null): string =>
  r === null ? "" : `${r >= 10 ? Math.round(r) : r.toFixed(1)}x`;

const tally = (ok: number, total: number): string =>
  total ? `${ok}/${total}` : "-";
const toneOf = (ok: number, total: number): Hue =>
  !total ? "muted" : ok === total ? "green" : "yellow";

function contract(m: CoreModel, full: boolean): Cell[] {
  const { header: h, evidence: e, openGates } = m.contract;
  const sep = c(full ? ' · ' : ' ', 'muted');
  const gates = openGates ? c(full ? `✖ ${openGates} gates` : `✖${openGates}`, 'red') : c(full ? '✔ gates' : '✔', 'green');
  return [
    k('CONTRACT', 'violet'), c(' '),
    c(`${full ? 'header' : 'hdr'} ${tally(h.ok, h.total)}`, toneOf(h.ok, h.total)), sep,
    c(`${full ? 'evidence' : 'ev'} ${tally(e.ok, e.total)}`, toneOf(e.ok, e.total)), sep,
    gates,
  ];
}

function verdict(m: CoreModel, full: boolean): Cell[] {
  const l = m.ledger;
  const sep = c(full ? " · " : " ", "muted");
  const parts: Cell[] = [
    c(
      full ? `✔ ${l.verified} verified` : `✔${l.verified}`,
      l.verified ? "green" : "muted",
    ),
    c(
      full ? `✖ ${l.refuted} refuted` : `✖${l.refuted}`,
      l.refuted ? "red" : "muted",
    ),
    c(
      full ? `? ${l.pending} open` : `?${l.pending}`,
      l.pending ? "yellow" : "muted",
    ),
    c(
      full ? `⚠ ${l.unchecked} unchecked` : `⚠${l.unchecked}`,
      l.unchecked ? "yellow" : "muted",
    ),
  ];
  const claims = full
    ? [c(`${l.claimed} claim${l.claimed === 1 ? "" : "s"}`, "text"), sep]
    : [];
  return [
    k("VERDICT", "peach"),
    c(" "),
    ...claims,
    ...parts.flatMap((p, i) => (i ? [sep, p] : [p])),
  ];
}

function offload(m: CoreModel, full: boolean): Cell[] {
  const o = m.offload;
  if (!o.workers.length)
    return [k("OFFLOAD", "sky"), c(" "), c("no workers yet", "muted")];
  const ratio = ratioText(o.ratio);
  const n = o.workers.length;
  const body = full
    ? `${tok(o.kept)} kept in ${n} worker${n === 1 ? "" : "s"} → ${tok(o.returned)} back`
    : `${tok(o.kept)}→${tok(o.returned)}`;
  return [
    k("OFFLOAD", "sky"),
    c(" "),
    c(body, "text"),
    ...(ratio ? [c(full ? ` (${ratio})` : ` ${ratio}`, "teal")] : []),
  ];
}

/** The newest route: `fix/low → implementer sonnet ✔`; a drifted seat reads `✖ drift`; `+N` older routes. */
function route(m: CoreModel, full: boolean): Cell[] {
  const r: Route | undefined = m.routes[m.routes.length - 1];
  if (!r) return [k("ROUTE", "teal"), c(" "), c("no team yet", "muted")];
  const seats = r.seats
    .map((s) =>
      full
        ? `${s.count > 1 ? `${s.count}× ` : ""}${s.role} ${s.model}`
        : s.model,
    )
    .join(full ? ", " : "+");
  const ran = r.seats.some((s) => s.ran.length);
  const mark = r.drift.length
    ? c(full ? " ✖ drift" : " ✖", "red")
    : ran
      ? c(" ✔", "green")
      : c(" …", "muted");
  const more =
    m.routes.length > 1 ? [c(` +${m.routes.length - 1}`, "muted")] : [];
  return [
    k("ROUTE", "teal"),
    c(" "),
    c(`${r.cls}/${r.effort}`, "text"),
    c(full ? " → " : " ", "muted"),
    c(seats || "?", "text"),
    mark,
    ...more,
  ];
}

export const cellsWidth = (cells: readonly Cell[]): number =>
  cells.reduce((n, x) => n + textWidth(x.chip ? ` ${x.t} ` : x.t), 0);
/** The row's plain text (chips padded as drawn), for goldens and text surfaces. */
export const cellsText = (cells: readonly Cell[]): string =>
  cells.map((x) => (x.chip ? ` ${x.t} ` : x.t)).join("");

type Group = (m: CoreModel, full: boolean) => Cell[];
const GROUPS: readonly Group[] = [contract, verdict, offload, route];
/** Which groups widen first when there is room: the adversarial ledger, then the offload, the contract, the route. */
const WIDEN: readonly number[] = [1, 2, 0, 3];

/** All four groups, compact, then each widened to its full form in WIDEN order while the row still fits `cols`
 * (one leading cell). Narrower than four compact groups: contract + verdict only. Empty without core data or room. */
export function coreCells(m: CoreModel | null | undefined, cols: number): Cell[] {
  if (!hasCore(m)) return [];
  const build = (full: readonly boolean[], groups: readonly Group[] = GROUPS): Cell[] =>
    [c(' '), ...groups.flatMap((g, i) => [...(i ? [gap] : []), ...g(m, full[i] ?? false)])];
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

/** The /atlas-core text: the four sections as plain lines. One line when there is nothing to report. */
export function coreReport(m: CoreModel | null): string {
  if (!hasCore(m)) return "atlas core: no verdicts, workers or teams recorded yet";
  const { header: h, evidence: e, verifiedDone: v, openGates } = m.contract;
  const l = m.ledger;
  const out: string[] = [
    "CONTRACT",
    `  header    ${tally(h.ok, h.total)} replies opened with the ATLAS header`,
    `  evidence  ${tally(e.ok, e.total)} done items carry evidence`,
    `  verified  ${tally(v.ok, v.total)} done items have a verified finding`,
    `  gates     ${openGates ? `${openGates} open` : "all clear"}`,
    "",
    `VERDICTS  ${l.claimed} claim${l.claimed === 1 ? "" : "s"}, ${l.verified} verified, ${l.refuted} refuted, ${l.pending} open, ${l.unchecked} unchecked`,
  ];
  for (const x of m.verdicts) out.push(`  ${VERDICT_WORD[x.status]}  ${x.id}  ${x.title}`);
  for (const c of m.claims) if (c.status === "DONE" && c.matched === null) out.push(`  unchecked  ${c.owner} claims DONE, no verdict yet`);
  if (!m.verdicts.length && !l.unchecked) out.push("  no verdict recorded yet");
  const ratio = ratioText(m.offload.ratio);
  out.push("", `OFFLOAD  ${tok(m.offload.kept)} kept in tmux, ${tok(m.offload.returned)} returned${ratio ? ` (${ratio})` : ""}`);
  for (const w of m.offload.workers)
    out.push(`  ${w.name}  ${w.model ?? "?"}  peak ${tok(w.peak)}  kept ${tok(w.kept)}  returned ${tok(w.returned)}  cost ${w.costUsd === null ? "?" : `$${w.costUsd.toFixed(2)}`}`);
  if (!m.offload.workers.length) out.push("  no workers yet");
  out.push("", "ROUTE");
  for (const r of m.routes) {
    out.push(`  ${r.cls}/${r.effort}  ${r.name || r.teamId}  ${r.isolation}, max ${r.maxParallel}`);
    for (const s of r.seats) {
      const ran = [...new Set(s.ran)];
      out.push(`    ${s.count}x ${s.role} ${s.model}/${s.effort}  ${ran.length ? `ran ${ran.join(", ")}` : "not run yet"}`);
    }
    for (const d of r.drift) out.push(`    DRIFT ${d}`);
  }
  if (!m.routes.length) out.push("  no team yet");
  return out.join("\n");
}
