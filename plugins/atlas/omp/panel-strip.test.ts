// Change 9: the Claude Code side panel and the omp painter draw one tab strip (same set, order and label form).
// Redesign: the strip is status health channel bored (no team, gates or board), the lit chip filled with the accent and an accent segment on the rule below it, health and channel carrying their count.
// Lives under omp/ because it imports omp/panel-view.ts; `claude plugin test` cannot load omp tests (bun:test), `bun test omp` runs it.
import { describe, expect, test } from "bun:test";
import type { ClientElements } from "claude-code";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { panelWorld } from "../contracts/panel-world";
import { worldSidebar } from "../contracts/world-live";
import type { Ui } from "../mod/design/atlas-ui";
import { BAND_BUTTONS } from "../mod/view/band/band";
import { coreModel } from "../mod/data/core";
import * as L from "../mod/view/panel/panel-layout";
import { type PanelTab, panelText } from "../mod/view/panel/panel-layout";
import { sidebarTree } from "../mod/view/panel/pane/sidebar";
import { paintPanel } from "./panel-view";

const mocha: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const TABS: PanelTab[] = ["route", "core", "channel", "bored"];
const LABELS = ["status", "health", "channel", "bored"];

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kidsOf = (n: Node): (Node | string)[] => (Array.isArray(n.props.children) ? n.props.children : n.props.children == null ? [] : [n.props.children]);
/** One element as the host prints it (no Button carries a hotkey, so none prints a `k: ` prefix). */
const inline = (n: Node | string): string => (typeof n === 'string' ? n : kidsOf(n).map(inline).join(''));
const ccRows = (tab: PanelTab, cols: number): string[] => {
  const root = sidebarTree(els, { ...worldSidebar(tab, cols), core } as never, { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} }) as unknown as Node;
  return kidsOf(root).map((k) => inline(k).trimEnd());
};
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();

describe('change 9: one tab strip on both hosts', () => {
  const WORDS = new Set([...LABELS, 'chan', 'more', '›', '‹', 'back']);
  // A strip row is only tab words and their counts (digits): `status health 1 channel 2 bored`.
  const stripOf = (rows: readonly string[]): string[] => rows.filter((l) => { const tk = l.trim().split(/\s+/); return tk.length > 0 && tk[0] !== '' && tk.every((w) => WORDS.has(w) || /^\d+$/.test(w)); });
  test('the strip tabs are status health channel bored, no keys', () => {
    expect(L.STRIP_TABS.map((t) => t.label)).toEqual(LABELS);
  });
  test('the band buttons are the same set in the same order', () => {
    expect(BAND_BUTTONS.map((b) => b.label)).toEqual(LABELS);
  });
  for (const cols of [120, 80, 60, 56, 40, 38, 30]) for (const tab of TABS) {
    test(`${tab} at ${cols}: the Claude Code strip and the omp strip print the same rows`, () => {
      const cc = stripOf(ccRows(tab, cols));
      const om = stripOf(paintPanel(panelWorld(tab, cols, mocha, { core })).map(plain));
      expect(cc.length).toBeGreaterThan(0);
      expect(om).toEqual(cc);
      expect(cc).toHaveLength(1); // one strip row at every width; the trailing tabs fold into `more ›` rather than wrap
      expect(cc[0]!).toMatch(/^ {2}\S/); // the lead cell and the chip's pad
      const said = cc.join(' ').trim().split(/\s+/).filter((w) => !/^\d+$/.test(w) && w !== 'more' && w !== '›').map((w) => (w === 'chan' ? 'channel' : w));
      expect(said).toEqual(LABELS.filter((w) => said.includes(w))); // names whole, in order; never a swapped tab
      if (cols >= 40) expect(said).toHaveLength(4); // all four on one row from 40 cells (with both counts)
      if (cols >= 40 && L.stripLayout(cols, tab).rows[0]!.some((t) => t.id === tab)) expect(said).toContain(LABELS[TABS.indexOf(tab)]!); // the lit tab keeps its word while it is not folded
    });
  }
  test('the strip is one padded row of chips at every width, never wider than the pane; the trailing tabs fold into `more ›`', () => {
    for (const cols of [30, 40, 60]) {
      expect(L.stripLayout(cols - 1, 'route').rows).toHaveLength(1);
      const row = stripOf(ccRows('route', cols))[0]!;
      expect([...row].length).toBeLessThanOrEqual(cols);
      expect(row.startsWith('  status')).toBe(true);
    }
    expect(stripOf(ccRows('route', 60))[0]!.trim().replace(/ +/g, ' ')).toMatch(/^status health( \d+)? channel( \d+)? bored$/);
    expect(stripOf(ccRows('route', 30)).map((x) => x.trim().replace(/ +/g, ' '))).toEqual(['status more ›']); // 29 inner cells: the health chip with its denial badge no longer fits, so it folds behind `more ›` with the rest
  });
  test('the lit chip is filled and an accent segment of the rule sits under it, on both hosts', () => {
    for (const tab of TABS) {
      const rows = panelText(panelWorld(tab, 120, mocha, { core }));
      const at = rows.findIndex((l) => l.startsWith('  status'));
      const word = LABELS[TABS.indexOf(tab)]!;
      expect(rows[at + 1]!.indexOf('━')).toBe(rows[at]!.indexOf(` ${word}`));
      expect(rows[at + 1]!.match(/━+/g)).toHaveLength(1);
    }
  });
});
