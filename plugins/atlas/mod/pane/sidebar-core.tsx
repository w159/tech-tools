// Sidebar core view (hotkey g): the four Atlas pillars in plain words, then the gate groups that enforce them.
//   contract  header 3/4 · evidence none
//   verdicts  every verifier verdict (verified / refuted / needs evidence) and which claim each one checked
//   offload   per tmux worker: model, context held, context kept past its brief, report size, cost
//   route     per team: class/effort -> scope-matrix seats -> the model each seat actually ran
// Labels are dim lowercase, figures plain; only what is off takes colour (partial amber, refuted or drifted red), each beside a word.
// Pure like the other views; a press on a verdict row opens its evidence, a press on a gate row its lines.
import type { ClientElements, RenderElement } from "claude-code";
import { type CoreModel, type Verdict, hasCore, tok } from "../data/core";
import { TONE_HEX as T } from "../mission-layout";
import { fitRuns, type Segment } from "../runs";
import { fitText, textWidth } from "../theme";
import { scrub } from "./chrome";
import { gateRows } from "./sidebar-gates";
import type { SidebarHandlers, SidebarModel } from "./sidebar-types";

const line = (els: ClientElements, key: string, parts: Segment[], cols: number): RenderElement =>
  els.Box({ key, flexShrink: 0, flexDirection: "row", children: fitRuns(els, parts, cols) });
/** A section head: the dim lowercase label, then its figures. */
const head = (els: ClientElements, title: string, figures: Segment[], cols: number): RenderElement =>
  line(els, `core:h:${title}`, [{ t: `${title}  `, color: T.dim, bold: true }, ...figures], cols);
const padTo = (t: string, n: number): string => {
  const f = fitText(t, n);
  return f + " ".repeat(Math.max(0, n - textWidth(f)));
};
const tally = (ok: number, total: number): string => (total ? `${ok}/${total}` : "none");
/** Colour only what is off: a partial tally is amber, a complete or empty one stays plain. */
const tallyTone = (ok: number, total: number): string => (!total ? T.muted : ok === total ? T.text : T.warn);
const sep: Segment = { t: " · ", color: T.dim };
const joinSep = (parts: Segment[]): Segment[] => parts.flatMap((p, i) => (i ? [sep, p] : [p]));

/** `contract  header 3/4 · evidence none · verified 2/2`; open gates are listed under the gate groups below. */
function contractRows(els: ClientElements, m: CoreModel, cols: number): RenderElement[] {
  const { header: h, evidence: e, verifiedDone: v } = m.contract;
  const part = (name: string, t: { ok: number; total: number }): Segment => ({ t: `${name} ${tally(t.ok, t.total)}`, color: tallyTone(t.ok, t.total) });
  return [head(els, "contract", joinSep([part("header", h), part("evidence", e), part("verified", v)]), cols)];
}

const VERDICT_LOOK: Record<Verdict["status"], { g: string; word: string; color: string }> = {
  verified: { g: "✓", word: "verified", color: T.ok },
  rejected: { g: "✗", word: "refuted", color: T.bad },
  "needs-evidence": { g: "?", word: "needs evidence", color: T.warn },
};

/** Widest verdict word, so no word is ever cut. */
const VERDICT_WORD_W = Math.max(...Object.values(VERDICT_LOOK).map((l) => textWidth(l.word)));
/** Id cell: 15 cells of id plus one gap, so a cut id never touches the word. */
const VERDICT_ID_W = 15;

function verdictRows(els: ClientElements, m: CoreModel, model: SidebarModel, on: SidebarHandlers, cols: number): RenderElement[] {
  const l = m.ledger;
  const figures = joinSep([
    { t: `${l.verified} verified`, color: l.verified ? T.ok : T.muted },
    { t: `${l.refuted} refuted`, color: l.refuted ? T.bad : T.muted },
    ...(l.pending ? [{ t: `${l.pending} open`, color: T.warn }] : []),
    ...(l.unchecked ? [{ t: `${l.unchecked} unchecked`, color: T.warn }] : []),
  ]);
  const rows = m.verdicts.slice(-8).flatMap((v): RenderElement[] => {
    const look = VERDICT_LOOK[v.status];
    const key = `core:v:${v.id}`;
    const checked = m.claims.find((c) => c.matched === v.id);
    const parts: Segment[] = [
      { t: `  ${look.g} `, color: look.color },
      { t: `${padTo(scrub(v.id), VERDICT_ID_W)} `, color: T.text },
      { t: padTo(look.word, VERDICT_WORD_W), color: look.color, bold: v.status === "rejected" },
      { t: ` ${scrub(v.title)}`, color: T.muted },
    ];
    const open = model.ui.expanded === key;
    const detail = open
      ? [
          checked ? `checks the done claim of ${checked.owner}` : "no worker claim before it",
          `by ${v.by}`,
          `evidence: ${scrub(v.evidence) || "none recorded"}`,
        ]
      : [];
    return [
      els.Button({ key, plain: true, onPress: () => on.toggle(key), children: fitRuns(els, parts, cols) }),
      ...detail.map((t, i) => line(els, `${key}:${i}`, [{ t: `      ${t}`, color: T.muted }], cols)),
    ];
  });
  const unchecked = m.claims
    .filter((c) => c.status === "DONE" && c.matched === null)
    .map((c) =>
      line(els, `core:u:${c.owner}:${c.at}`, [
        { t: "  ⚠ ", color: T.warn },
        { t: padTo(c.owner, 16), color: T.text },
        { t: "unchecked: says done, no verdict yet", color: T.warn },
      ], cols));
  return [
    head(els, "verdicts", figures, cols),
    ...(rows.length || unchecked.length
      ? [...rows, ...unchecked]
      : [line(els, "core:v:none", [{ t: "  no verdict recorded yet", color: T.muted }], cols)]),
  ];
}

function offloadRows(els: ClientElements, m: CoreModel, cols: number): RenderElement[] {
  const o = m.offload;
  const ratio = o.ratio === null ? "" : ` (${o.ratio >= 10 ? Math.round(o.ratio) : o.ratio.toFixed(1)}x)`;
  const rows = o.workers.slice(-8).map((w) =>
    line(els, `core:o:${w.name}`, [
      { t: "  " },
      { t: padTo(w.name, 18), color: T.text },
      { t: padTo((w.model ?? "?").replace(/^claude-/, ""), 12), color: T.muted },
      { t: `${tok(w.peak).padStart(6)} held ${tok(w.kept).padStart(6)} kept ${tok(w.returned).padStart(6)} back`, color: T.text },
      { t: w.costUsd === null ? "" : `  $${w.costUsd.toFixed(2)}`, color: T.muted },
    ], cols));
  return [
    head(els, "offload", [{ t: `${tok(o.kept)} kept in tmux → ${tok(o.returned)} back`, color: T.text }, { t: ratio, color: T.muted }], cols),
    ...rows,
  ];
}

/** `ran sonnet ✓ as planned`, `ran haiku ✗ drift`, `not run yet`. */
function ranSegments(s: CoreModel["routes"][number]["seats"][number]): Segment[] {
  if (!s.ran.length) return [{ t: "  not run yet", color: T.muted }];
  const same = s.ran.every((x) => x.toLowerCase().includes(s.model.toLowerCase()) || s.model === "inherit");
  return [
    { t: `  ran ${[...new Set(s.ran)].join(", ")}`, color: T.muted },
    same ? { t: " ✓ as planned", color: T.ok } : { t: " ✗ drift", color: T.bad },
  ];
}

function routeRows(els: ClientElements, m: CoreModel, cols: number): RenderElement[] {
  const rows = m.routes.slice(-6).reverse().flatMap((r) => [
    line(els, `core:r:${r.teamId}`, [
      { t: "  " },
      { t: `${r.cls}/${r.effort}`, bold: true, color: T.text },
      { t: `  ${r.name || r.teamId}  ${r.isolation}, max ${r.maxParallel}`, color: T.muted },
      ...(r.drift.length ? [{ t: "  ✗ drift", color: T.bad }] : []),
    ], cols),
    ...r.seats.map((s, i) =>
      line(els, `core:r:${r.teamId}:${i}`, [
        { t: "    → ", color: T.muted },
        { t: `${s.count}× ${s.role} `, color: T.text },
        { t: `${s.model}/${s.effort}`, color: T.text },
        ...ranSegments(s),
      ], cols)),
  ]);
  return [head(els, "route", [{ t: "which model each seat ran", color: T.muted }], cols), ...rows];
}

const blank = (els: ClientElements, key: string): RenderElement =>
  els.Box({ key, flexShrink: 0, children: els.Text({ children: " " }) });

/** The pillars (when there is core data), then the gate groups, then a hint when there is nothing at all. */
export function coreRows(
  els: ClientElements,
  m: SidebarModel,
  on: SidebarHandlers,
  inner: number,
): RenderElement[] {
  const core = m.core;
  const gates = gateRows(els, m, on, inner);
  const gateBlock = gates.length
    ? [head(els, "gates", [{ t: "what the Stop gate will check", color: T.muted }], inner), ...gates]
    : [];
  if (!hasCore(core))
    return [
      ...gateBlock,
      ...(gateBlock.length
        ? []
        : [
            line(
              els,
              "core:none",
              [{ t: "no verdicts, workers or gates yet", color: T.muted }],
              inner,
            ),
          ]),
    ];
  return [
    ...contractRows(els, core, inner),
    blank(els, "core:b1"),
    ...verdictRows(els, core, m, on, inner),
    blank(els, "core:b2"),
    ...offloadRows(els, core, inner),
    blank(els, "core:b3"),
    ...routeRows(els, core, inner),
    ...(gateBlock.length ? [blank(els, "core:b4"), ...gateBlock] : []),
  ];
}
