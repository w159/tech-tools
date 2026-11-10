// Parity: the Claude band renders the same text rows as the omp mission panel for the shared band fixture.
// Twin: omp/mission-panel-golden.test.ts. Both compare against contracts/band-golden.ts, blank spacer rows included.
import { describe, expect, test } from "claude-code/testing";
import type { ClientElements } from "claude-code";
import { fx, idleFx, trimRows } from "../contracts/band-fixture";
import { golden, idleGolden, railGolden } from "../contracts/band-golden";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { bandTree, railRow } from "./band";
import { coreModel } from "./data/core";
import { liveWorkers } from "./data/live";
import { busySnap } from "./live_fixture";

type Node = { kind: string; props: Record<string, any> };
const mk =
  (kind: string) =>
  (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk("Box"), Text: mk("Text") } as unknown as ClientElements;
const text = (row: Node): string =>
  (row.props.children as Node[]).map((t) => t.props.children).join("");

const base = {
  root: `/r/${fx.project}`,
  channel: `${fx.project}@${fx.branch}/${fx.lead}`,
  now: fx.now,
  contextPct: 0,
};
const comms = fx.notes.map((n, i) => ({ seq: i, ts: n.ts, from: n.from, to: n.to, text: n.text, kind: "say" as const }));
const todoGroups = (todos: readonly { id: string; content: string; status: string }[]) => [
  {
    phase: fx.phase,
    dept: "FORGE",
    glyph: "",
    done: todos.filter((t) => t.status === "completed").length,
    total: todos.length,
    items: todos.map((t) => ({ ...t, owner: (t as any).owner ?? null, evidence: null, live: true })),
  },
] as any;
const leadIdle = { tool: null, since: fx.now, toolCount: 0, tokens: null, mood: "idle", lastLine: "" };

/** The fixture as a LiveSnapshot: lead plus the two fixture workers, board, notes and gate groups. */
function snapshot() {
  const activity = Object.fromEntries(
    fx.workers.map((w) => [
      w.name,
      {
        tool: w.active ? w.tool : null,
        lastTool: w.active ? null : w.tool,
        target: w.target,
        since: fx.now,
        startedAt: fx.now - w.secs * 1000,
        toolCount: 1,
        tokens: null,
        mood: "working" as const,
        lastLine: "",
        calls: [],
        scope: fx.scope,
      },
    ]),
  );
  return busySnap({
    ...base,
    phase: fx.phase as any,
    squad: fx.workers.map((w) => ({ name: w.name, persona: w.role, state: "running" as const, source: "task" as const, task: "" })),
    activity: { lead: leadIdle, ...activity } as any,
    todos: fx.todos as any,
    todoGroups: todoGroups(fx.todos),
    comms,
  });
}

/** The closed run: three workers finished 30 s ago (past the 15 s linger), every task done. */
function idleSnapshot() {
  const squad = idleFx.finished.map((w) => ({ name: w.name, persona: w.role, state: "finished" as const, source: "task" as const, task: "" }));
  const activity = Object.fromEntries(
    idleFx.finished.map((w) => [
      w.name,
      { tool: null, lastTool: null, target: null, since: fx.now - w.endedAgoSecs * 1000, startedAt: fx.now - w.startedAgoSecs * 1000, toolCount: 1, tokens: null, mood: "done" as const, lastLine: "", calls: [], scope: fx.scope },
    ]),
  );
  return busySnap({
    ...base,
    phase: idleFx.phase as any,
    squad,
    activity: { lead: leadIdle, ...activity } as any,
    todos: idleFx.todos as any,
    todoGroups: todoGroups(idleFx.todos),
    comms,
  });
}
const gates = fx.gates.map((g) => ({
  id: g.id,
  title: g.id,
  lines: [{ ok: g.ok, label: g.id }],
})) as any;

const rowsOf = (tree: Node): string[] => trimRows((tree.props.children as Node[]).map(text));

describe("band golden rows", () => {
  test("renders the shared fixture to the golden rows (plain text, 120 columns, tick 0)", () => {
    const snap = snapshot();
    const tree = bandTree(els, {
      snapshot: snap,
      live: liveWorkers(snap, fx.now),
      gates,
      columns: fx.columns,
      tick: 0,
      maxRows: 12,
      team: fx.scope, // omp takes it from the team record; register.ts passes none
      leadName: fx.lead,
    }) as unknown as Node;
    expect(rowsOf(tree)).toEqual(golden);
  });

  test("idle renders the shared idle golden, core row included, no key buttons without handlers", () => {
    const snap = idleSnapshot();
    const tree = bandTree(els, {
      snapshot: snap,
      live: liveWorkers(snap, fx.now),
      gates,
      columns: fx.columns,
      tick: 0,
      maxRows: 12,
      core: coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 }),
    }) as unknown as Node;
    expect(rowsOf(tree)).toEqual(idleGolden);
  });
});

describe("band rail tiers", () => {
  // The stepper keeps the widest form that fits: full names, three letters, then marks (twin: omp mission-panel-golden).
  for (const [cols, want] of Object.entries(railGolden)) {
    test(`${cols} columns`, () => {
      // The stepper itself: below 80 columns the band folds to one summary row, while omp keeps its layout.
      const rail = railRow(snapshot(), fx.phase, 0, Number(cols), true).map((r) => r.t).join("").trimEnd();
      expect(rail).toBe(want);
    });
  }
});
