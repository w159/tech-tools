// Change 9: the Claude Code side panel and the omp painter draw one tab strip (same set, order and label form, both with `board`).
// Lives under omp/ because it imports omp/panel-view.ts; `claude plugin test` cannot load omp tests (bun:test), `bun test omp` runs it.
import { describe, expect, test } from "bun:test";
import type { ClientElements } from "claude-code";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { panelWorld } from "../contracts/panel-world";
import { worldSidebar } from "../contracts/world-live";
import type { Ui } from "../mod/atlas-ui";
import { BAND_BUTTONS } from "../mod/view/band/band";
import { coreModel } from "../mod/data/core";
import * as L from "../mod/view/panel/panel-layout";
import { type PanelTab, panelText } from "../mod/view/panel/panel-layout";
import { sidebarTree } from "../mod/view/panel/pane/sidebar";
import { paintPanel } from "./panel-view";

const mocha: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const TABS: PanelTab[] = ["route", "team", "channel", "gates", "core"];

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kidsOf = (n: Node): (Node | string)[] => (Array.isArray(n.props.children) ? n.props.children : n.props.children == null ? [] : [n.props.children]);
/** One element as the host prints it (wave 43: no Button carries a hotkey, so none prints a `k: ` prefix). */
const inline = (n: Node | string): string => (typeof n === 'string' ? n : n.kind === 'Box' && n.props.width === 0 ? '' : (n.kind === 'Button' && n.props.hotkey ? `${n.props.hotkey}: ` : '') + kidsOf(n).map(inline).join(''));
const ccRows = (tab: PanelTab, cols: number): string[] => {
  const root = sidebarTree(els, { ...worldSidebar(tab, cols), core } as never, { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} }) as unknown as Node;
  return kidsOf(root).map((k) => inline(k).trimEnd());
};
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();

describe('change 9: one tab strip on both hosts', () => {
  const WORDS = new Set(['status', 'team', 'channel', 'chan', 'gates', 'core', 'board', 'more', '›', '▸', '▾']);
  // A strip row is only keys and tab words: `r: route  t: team ...`, or the bare words alone (a narrow pane draws no `k: ` and binds the keys itself).
  const stripOf = (rows: readonly string[]): string[] => rows.filter((l) => { const tk = l.trim().split(/\s+/); return tk.length > 0 && tk[0] !== '' && tk.every((w) => /^[rtcgko]:$/.test(w) || WORDS.has(w)); });
  test('the strip tabs are status team channel gates core board, no keys', () => {
    const tabs = (L as unknown as { STRIP_TABS: { id: string; label: string }[] }).STRIP_TABS;
    expect(tabs.map((t) => t.label)).toEqual(['status', 'team', 'channel', 'gates', 'core', 'board']);
  });
  test('the band buttons are the same set in the same order', () => {
    expect(BAND_BUTTONS.map((b) => b.label)).toEqual(['status', 'team', 'channel', 'gates', 'core', 'board']);
  });
  for (const cols of [120, 80, 60, 56, 40, 38, 30]) for (const tab of TABS) {
    test(`${tab} at ${cols}: the Claude Code strip and the omp strip print the same rows`, () => {
      const cc = stripOf(ccRows(tab, cols));
      const om = stripOf(paintPanel(panelWorld(tab, cols, mocha, { core })).map(plain));
      expect(cc.length).toBeGreaterThan(0);
      expect(om).toEqual(cc);
      expect(cc).toHaveLength(1); // D14: one strip row at every width; the trailing tabs fold into `more ›` rather than wrap
      expect(cc[0]!).toMatch(/^ \S/); // one cell of padding from the left rule
      const said = cc.join(' ').trim().split(/\s+/).filter((w) => w !== '▸' && w !== 'more' && w !== '›').map((w) => (w === 'chan' ? 'channel' : w)); // AA5: the one short label
      const ALL = ['status', 'team', 'channel', 'gates', 'core', 'board'];
      expect(said.every((w) => ALL.includes(w))).toBe(true); // names only, whole
      expect(said).toEqual(ALL.filter((w) => said.includes(w))); // in order; AA5: never a swapped tab, the rest behind `more ›`
      if (cols >= 45) expect(said).toHaveLength(6); // AA5: all six on one row from 45 cells, the short `chan` below 48
      expect(cc.join(' ')).not.toMatch(/\b[rtcgko]:/); // never a key letter in the strip
      if (L.stripLayout(cols, tab).rows[0]!.some((t) => t.id === tab)) expect(said).toContain(tab === 'route' ? 'status' : tab); // the lit tab keeps its word while it is not folded
      // words go from the right end only: once a tab shows its word, every tab to its left does too (the lit tab is the one exception)
    });
  }
  test('the strip is one padded row of chips at every width, never wider than the pane; the trailing tabs fold into `more ›`', () => {
    for (const cols of [30, 40, 60]) {
      expect(L.stripLayout(cols - 1, 'route').rows).toHaveLength(1);
      const row = stripOf(ccRows('route', cols))[0]!;
      expect([...row].length).toBeLessThanOrEqual(cols);
      expect(row.startsWith(' status')).toBe(true);
    }
    expect(stripOf(ccRows('route', 60))[0]!.trim()).toBe('status   team   channel   gates   core   board');
    expect(stripOf(ccRows('route', 30)).map((x) => x.trim())).toEqual(['status   team   more ›']);
    expect(stripOf(ccRows('route', 40)).map((x) => x.trim())).toEqual(['status   team   chan   gates   more ›']); // AA5: the short label, never a swapped tab
    expect(stripOf(ccRows('route', 38)).map((x) => x.trim())).toEqual(['status   team   chan   more ›']);
    expect(stripOf(ccRows('route', 46)).map((x) => x.trim())).toEqual(['status   team   chan   gates   core   board']); // all six on one row from 45 cells
    expect(stripOf(ccRows('route', 52)).map((x) => x.trim())).toEqual(['status   team   channel   gates   core   board']);
    expect(stripOf(ccRows('route', 110)).map((x) => x.trim())).toEqual(['status   team   channel   gates   core   board']);
  });
  test('no rule under the lit tab on either host: the lit chip is the filled one', () => {
    for (const tab of TABS) {
      const rows = panelText(panelWorld(tab, 120, mocha, { core }));
      const at = rows.findIndex((l) => l.includes('status   team'));
      expect(rows[at]!.startsWith(' status   team')).toBe(true);
      expect(rows.slice(at, at + 2).join('')).not.toContain('━');
    }
  });
});

