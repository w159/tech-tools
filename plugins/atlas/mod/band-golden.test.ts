// Parity: the Claude band renders the same text rows as the omp mission panel for the shared band fixture.
// Twin: omp/mission-panel-golden.test.ts. Both compare against contracts/band-golden.ts.
import { describe, expect, test } from "claude-code/testing";
import type { ClientElements } from "claude-code";
import { fx, trimRows } from "../contracts/band-fixture";
import { golden } from "../contracts/band-golden";
import { bandTree } from "./band";
import { liveWorkers } from "./data/live";
import { busySnap } from "./live_fixture";

type Node = { kind: string; props: Record<string, any> };
const mk =
  (kind: string) =>
  (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk("Box"), Text: mk("Text") } as unknown as ClientElements;
const text = (row: Node): string =>
  (row.props.children as Node[]).map((t) => t.props.children).join("");

/** The fixture as a LiveSnapshot: lead plus the two fixture workers, board, notes and gate groups. */
function snapshot() {
  const start = (secs: number): number => fx.now - secs * 1000;
  const calls = (spark: number[]): number[] =>
    spark.flatMap((n, i) =>
      Array.from({ length: n }, (_, k) => fx.now - (11 - i) * 5000 - 100 - k),
    );
  const activity = Object.fromEntries(
    fx.workers.map((w) => [
      w.name,
      {
        tool: w.active ? w.tool : null,
        lastTool: w.active ? null : w.tool,
        target: w.target,
        since: fx.now,
        startedAt: start(w.secs),
        toolCount: 1,
        tokens: null,
        mood: "working" as const,
        lastLine: "",
        calls: calls(w.spark),
        scope: fx.scope,
      },
    ]),
  );
  const done = fx.todos.filter((t) => t.status === "completed").length;
  return busySnap({
    root: `/r/${fx.project}`,
    channel: `${fx.project}@${fx.branch}/${fx.lead}`,
    phase: fx.phase as any,
    now: fx.now,
    contextPct: 0,
    squad: fx.workers.map((w) => ({
      name: w.name,
      persona: w.role,
      state: "running" as const,
      source: "task" as const,
      task: "",
    })),
    activity: {
      lead: {
        tool: null,
        since: fx.now,
        toolCount: 0,
        tokens: null,
        mood: "idle",
        lastLine: "",
      },
      ...activity,
    } as any,
    todos: fx.todos as any,
    todoGroups: [
      {
        phase: fx.phase,
        dept: "FORGE",
        glyph: "",
        done,
        total: fx.todos.length,
        items: fx.todos.map((t) => ({ ...t, owner: (t as any).owner ?? null, evidence: null, live: true })),
      },
    ] as any,
    comms: fx.notes.map((n, i) => ({
      seq: i,
      ts: n.ts,
      from: n.from,
      to: n.to,
      text: n.text,
      kind: "say" as const,
    })),
  });
}
const gates = fx.gates.map((g) => ({
  id: g.id,
  title: g.id,
  lines: [{ ok: g.ok, label: g.id }],
})) as any;

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
    }) as unknown as Node;
    expect(trimRows((tree.props.children as Node[]).map(text))).toEqual(golden);
  });
});
