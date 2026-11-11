// Parity: the Claude band renders the same text rows as the omp mission panel for the shared world.
// Twin: omp/mission-panel-golden.test.ts. Both compare against contracts/band-golden.ts, blank spacer rows included.
// Both are fed by contracts/world-live.ts: there is no second fixture.
import { describe, expect, test } from "claude-code/testing";
import type { ClientElements } from "claude-code";
import { trimRows } from "../contracts/band-fixture";
import { golden, idleGolden, tierGolden } from "../contracts/band-golden";
import { worldModel } from "../contracts/band-world";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { worldGates, worldIdleSnapshot, worldSnapshot } from "../contracts/world-live";
import { bandTree, missionTree } from "./band";
import type { Ui } from "./atlas-ui";
import { coreModel } from "./data/core";
import { liveWorkers } from "./data/live";

type Node = { kind: string; props: Record<string, any> };
const mk =
  (kind: string) =>
  (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk("Box"), Text: mk("Text") } as unknown as ClientElements;
const text = (row: Node): string =>
  (row.props.children as Node[]).map((t) => t.props.children).join("");
const rowsOf = (tree: Node): string[] => trimRows((tree.props.children as Node[]).map(text));

describe("band golden rows", () => {
  test("renders the shared world to the golden rows (plain text, 120 columns, tick 0)", () => {
    const snap = worldSnapshot();
    const tree = bandTree(els, { snapshot: snap, live: liveWorkers(snap, snap.now), gates: worldGates(), columns: 120, tick: 0, maxRows: 12 }) as unknown as Node;
    expect(rowsOf(tree)).toEqual(golden);
  });

  test("idle renders the shared idle golden, core row included, a failed worker still counted, no key buttons without handlers", () => {
    const snap = worldIdleSnapshot();
    const tree = bandTree(els, {
      snapshot: snap, live: liveWorkers(snap, snap.now), gates: worldGates(), columns: 120, tick: 0, maxRows: 12,
      core: coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 }),
    }) as unknown as Node;
    expect(rowsOf(tree)).toEqual(idleGolden);
  });
});

describe("band tiers on the shared world (design evidence goldens)", () => {
  const ui: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
  // The width each tier is drawn at, and whether it is the rich (three row) band.
  const tiers: [string, number, boolean][] = [["120", 120, false], ["120-rich", 120, true], ["80", 80, false], ["60", 60, false], ["40", 40, false]];
  for (const [name, columns, rich] of tiers) {
    test(`${name} columns: ${rich ? "rich band" : "one row"} equals the golden`, () => {
      const tree = missionTree(els, worldModel(columns, ui, { rich, maxRows: rich ? 3 : 1 })) as unknown as Node;
      expect(rowsOf(tree)).toEqual(tierGolden[name]!);
      for (const row of tree.props.children as Node[]) expect(text(row).length).toBe(columns); // every row fills its columns
    });
  }
});
