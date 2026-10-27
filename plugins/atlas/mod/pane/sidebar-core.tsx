// Sidebar core view (hotkey g): the four Atlas pillars in detail, then the gate groups that enforce them.
//   CONTRACT  reply headers, done items with evidence, open gates
//   VERDICTS  every verifier verdict (verified / REFUTED / needs evidence) and which claim each one checked
//   OFFLOAD   per tmux worker: model, context held, context kept past its brief, report size, cost
//   ROUTE     per team: class/effort -> scope-matrix seats -> the model each seat actually ran
// Pure like the other views; a press on a verdict row opens its evidence, a press on a gate row its lines.
import type { ClientElements, RenderElement } from "claude-code";
import { type CoreModel, type Verdict, hasCore, tok } from "../data/core";
import { fitRuns, type Segment } from "../runs";
import { chartRoom as C, fitText, textWidth } from "../theme";
import { scrub } from "./chrome";
import { gateRows } from "./sidebar-gates";
import type { SidebarHandlers, SidebarModel } from "./sidebar-types";

const line = (
  els: ClientElements,
  key: string,
  parts: Segment[],
  cols: number,
): RenderElement =>
  els.Box({
    key,
    flexShrink: 0,
    flexDirection: "row",
    children: fitRuns(els, parts, cols),
  });
const head = (
  els: ClientElements,
  title: string,
  note: string,
  cols: number,
): RenderElement =>
  line(
    els,
    `core:h:${title}`,
    [
      { t: title, bold: true },
      { t: note ? `  ${note}` : "", color: C.muted },
    ],
    cols,
  );
const padTo = (t: string, n: number): string => {
  const f = fitText(t, n);
  return f + " ".repeat(Math.max(0, n - textWidth(f)));
};
const tally = (ok: number, total: number): string =>
  total ? `${ok}/${total}` : "-";
const mark = (ok: boolean, none: boolean): Segment =>
  none
    ? { t: "- ", color: C.muted }
    : ok
      ? { t: "✓ ", color: C.ok }
      : { t: "✗ ", color: C.fail };

function contractRows(
  els: ClientElements,
  m: CoreModel,
  cols: number,
): RenderElement[] {
  const { header: h, evidence: e, verifiedDone: v, openGates } = m.contract;
  const row = (
    id: string,
    ok: boolean,
    none: boolean,
    label: string,
    text: string,
  ) =>
    line(
      els,
      `core:c:${id}`,
      [
        { t: "  " },
        mark(ok, none),
        { t: padTo(label, 10) },
        { t: text, color: C.muted },
      ],
      cols,
    );
  return [
    head(els, "CONTRACT", "the operating contract, live", cols),
    row(
      "hdr",
      h.ok === h.total,
      !h.total,
      "header",
      `${tally(h.ok, h.total)} replies opened with the ATLAS header`,
    ),
    row(
      "ev",
      e.ok === e.total,
      !e.total,
      "evidence",
      `${tally(e.ok, e.total)} done items carry evidence`,
    ),
    row(
      "vd",
      v.ok === v.total,
      !v.total,
      "verified",
      `${tally(v.ok, v.total)} done items have a verified finding`,
    ),
    row(
      "gates",
      openGates === 0,
      false,
      "gates",
      openGates ? `${openGates} open, listed under GATES` : "all clear",
    ),
  ];
}

const VERDICT_LOOK: Record<
  Verdict["status"],
  { g: string; word: string; color: string }
> = {
  verified: { g: "✓", word: "verified", color: C.ok },
  rejected: { g: "✗", word: "REFUTED", color: C.fail },
  "needs-evidence": { g: "?", word: "needs evidence", color: C.warn },
};

function verdictRows(
  els: ClientElements,
  m: CoreModel,
  model: SidebarModel,
  on: SidebarHandlers,
  cols: number,
): RenderElement[] {
  const l = m.ledger;
  const note = `${l.claimed} claim${l.claimed === 1 ? "" : "s"}, ${l.verified} verified, ${l.refuted} refuted, ${l.pending} open, ${l.unchecked} unchecked`;
  const rows = m.verdicts.slice(-8).flatMap((v): RenderElement[] => {
    const look = VERDICT_LOOK[v.status];
    const key = `core:v:${v.id}`;
    const checked = m.claims.find((c) => c.matched === v.id);
    const parts: Segment[] = [
      { t: `  ${look.g} `, color: look.color },
      { t: padTo(scrub(v.id), 16) },
      {
        t: padTo(look.word, 10),
        color: look.color,
        bold: v.status === "rejected",
      },
      { t: ` ${scrub(v.title)}`, color: C.muted },
    ];
    const open = model.ui.expanded === key;
    const detail = open
      ? [
          checked
            ? `checks the DONE claim of ${checked.owner}`
            : "no worker claim before it",
          `by ${v.by}`,
          `evidence: ${scrub(v.evidence) || "none recorded"}`,
        ]
      : [];
    return [
      els.Button({
        key,
        plain: true,
        onPress: () => on.toggle(key),
        children: fitRuns(els, parts, cols),
      }),
      ...detail.map((t, i) =>
        line(els, `${key}:${i}`, [{ t: `      ${t}`, color: C.muted }], cols),
      ),
    ];
  });
  const unchecked = m.claims
    .filter((c) => c.status === "DONE" && c.matched === null)
    .map((c) =>
      line(
        els,
        `core:u:${c.owner}:${c.at}`,
        [
          { t: "  ⚠ ", color: C.warn },
          { t: padTo(c.owner, 16) },
          { t: "claims DONE, no verdict yet", color: C.warn },
        ],
        cols,
      ),
    );
  return [
    head(els, "VERDICTS", note, cols),
    ...(rows.length || unchecked.length
      ? [...rows, ...unchecked]
      : [
          line(
            els,
            "core:v:none",
            [{ t: "  no verdict recorded yet", color: C.muted }],
            cols,
          ),
        ]),
  ];
}

function offloadRows(
  els: ClientElements,
  m: CoreModel,
  cols: number,
): RenderElement[] {
  const o = m.offload;
  const ratio =
    o.ratio === null
      ? ""
      : `, ${o.ratio >= 10 ? Math.round(o.ratio) : o.ratio.toFixed(1)}x`;
  const rows = o.workers
    .slice(-8)
    .map((w) =>
      line(
        els,
        `core:o:${w.name}`,
        [
          { t: "  " },
          { t: padTo(w.name, 18) },
          {
            t: padTo((w.model ?? "?").replace(/^claude-/, ""), 12),
            color: C.muted,
          },
          { t: `${tok(w.peak).padStart(6)} held ` },
          { t: `${tok(w.kept).padStart(6)} kept`, color: C.ok },
          { t: `${tok(w.returned).padStart(6)} back`, color: C.live },
          {
            t: w.costUsd === null ? "" : `  $${w.costUsd.toFixed(2)}`,
            color: C.muted,
          },
        ],
        cols,
      ),
    );
  return [
    head(
      els,
      "OFFLOAD",
      `${tok(o.kept)} kept in tmux, ${tok(o.returned)} returned${ratio}`,
      cols,
    ),
    ...rows,
  ];
}

function routeRows(
  els: ClientElements,
  m: CoreModel,
  cols: number,
): RenderElement[] {
  const rows = m.routes
    .slice(-6)
    .reverse()
    .flatMap((r) => [
      line(
        els,
        `core:r:${r.teamId}`,
        [
          { t: "  " },
          { t: `${r.cls}/${r.effort}`, bold: true },
          {
            t: `  ${r.name || r.teamId}  ${r.isolation}, max ${r.maxParallel}`,
            color: C.muted,
          },
          ...(r.drift.length ? [{ t: "  ✗ drift", color: C.fail }] : []),
        ],
        cols,
      ),
      ...r.seats.map((s, i) =>
        line(
          els,
          `core:r:${r.teamId}:${i}`,
          [
            { t: "    → ", color: C.muted },
            { t: `${s.count}× ${s.role} ` },
            { t: `${s.model}/${s.effort}`, color: C.live },
            ...(s.ran.length
              ? [
                  {
                    t: `  ran ${[...new Set(s.ran)].join(", ")}`,
                    color: C.muted,
                  },
                  {
                    t: s.ran.every(
                      (x) =>
                        x.toLowerCase().includes(s.model.toLowerCase()) ||
                        s.model === "inherit",
                    )
                      ? " ✓"
                      : " ✗",
                    color: r.drift.length ? C.fail : C.ok,
                  },
                ]
              : [{ t: "  not run yet", color: C.muted }]),
          ],
          cols,
        ),
      ),
    ]);
  return [
    head(
      els,
      "ROUTE",
      "decision model: class/effort -> seats -> model run",
      cols,
    ),
    ...rows,
  ];
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
    ? [head(els, "GATES", "what the Stop gate will check", inner), ...gates]
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
              [{ t: "no verdicts, workers or gates yet", color: C.muted }],
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
