// Change 9: the Claude Code side panel and the omp painter draw one tab strip (same set, order and label form, both with `board`).
// Lives under omp/ because it imports omp/panel-view.ts; `claude plugin test` cannot load omp tests (bun:test), `bun test omp` runs it.
import { describe, expect, test } from "bun:test";
import type { ClientElements } from "claude-code";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { panelWorld } from "../contracts/panel-world";
import { worldSidebar } from "../contracts/world-live";
import type { Ui } from "../mod/atlas-ui";
import { BAND_BUTTONS } from "../mod/band";
import { coreModel } from "../mod/data/core";
import * as L from "../mod/panel-layout";
import { type PanelTab, panelText } from "../mod/panel-layout";
import { sidebarTree } from "../mod/pane/sidebar";
import { paintPanel } from "./panel-view";

const mocha: Ui = { theme: "mocha", ascii: false, color: "truecolor" };
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const TABS: PanelTab[] = ["route", "team", "channel", "gates", "core"];

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kidsOf = (n: Node): (Node | string)[] => (Array.isArray(n.props.children) ? n.props.children : n.props.children == null ? [] : [n.props.children]);
/** One element as the host prints it: a hotkey Button reads `k: label`. */
const inline = (n: Node | string): string => (typeof n === 'string' ? n : n.kind === 'Box' && n.props.width === 0 ? '' : (n.kind === 'Button' && n.props.hotkey ? `${n.props.hotkey}: ` : '') + kidsOf(n).map(inline).join(''));
const ccRows = (tab: PanelTab, cols: number): string[] => {
  const root = sidebarTree(els, { ...worldSidebar(tab, cols), core } as never, { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} }) as unknown as Node;
  return kidsOf(root).map((k) => inline(k).trimEnd());
};
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();

describe('change 9: one tab strip on both hosts', () => {
  const WORDS = new Set(['route', 'team', 'channel', 'gates', 'core', 'board']);
  // A strip row is only keys and tab words: `r: route  t: team ...`, or the bare words alone (a narrow pane draws no `k: ` and binds the keys itself).
  const stripOf = (rows: readonly string[]): string[] => rows.filter((l) => { const tk = l.trim().split(/\s+/); return tk.length > 0 && tk[0] !== '' && tk.every((w) => /^[rtcgko]:$/.test(w) || WORDS.has(w)); });
  const bareAt = (cols: number): boolean => L.stripLayout(cols - 1, 'route').bare;
  test('the strip tabs are route team channel gates core board, keys r t c g k o', () => {
    const tabs = (L as unknown as { STRIP_TABS: { id: string; key: string; label: string }[] }).STRIP_TABS;
    expect(tabs.map((t) => `${t.key}:${t.label}`)).toEqual(['r:route', 't:team', 'c:channel', 'g:gates', 'k:core', 'o:board']);
  });
  test('the band buttons are the same set in the same order', () => {
    expect(BAND_BUTTONS.map((b) => `${b.key}:${b.label}`)).toEqual(['r:route', 't:team', 'c:channel', 'g:gates', 'k:core', 'o:board']);
  });
  for (const cols of [120, 80, 60, 56, 40, 38, 30]) for (const tab of TABS) {
    test(`${tab} at ${cols}: the Claude Code strip and the omp strip print the same rows`, () => {
      const cc = stripOf(ccRows(tab, cols));
      const om = stripOf(paintPanel(panelWorld(tab, cols, mocha, { core })).map(plain));
      expect(cc.length).toBeGreaterThan(0);
      expect(om).toEqual(cc);
      if (cols >= 60) expect(cc).toHaveLength(1); // one strip row from 60 cells; below the tabs wrap onto a second row rather than lose a word
      expect(cc[0]!).toMatch(/^ \S/); // one cell of padding from the left rule
      if (bareAt(cols)) expect(cc.join(' ').trim().split(/\s+/)).toEqual(['route', 'team', 'channel', 'gates', 'core', 'board']); // A1: one row of bare words, the keys stay bound by the host layer
      else expect(cc.join(' ').split(/\s+/).filter((w) => /^\w:$/.test(w))).toEqual(['r:', 't:', 'c:', 'g:', 'k:', 'o:']); // every key stays
      expect(cc.join('\n')).not.toMatch(/\w: *(\n|$)|\w: {2,}/); // no tab is ever blank
      expect(cc.join(' ')).not.toMatch(/\b[rtcgko]: (rt|tm|ch|gt|co|bd)\b/); // C4: never the two-letter form
      expect(cc.join(' ')).toMatch(new RegExp(bareAt(cols) ? `\\b${tab}\\b` : `\\b${L.STRIP_TABS.find((t) => t.id === tab)!.key}: (${tab}|chan)\\b`)); // the lit tab keeps its word
      // words go from the right end only: once a tab shows its word, every tab to its left does too (the lit tab is the one exception)
    });
  }
  test('at 30, 40 and 60 cells the strip is padded, whole and never wider than the pane', () => {
    for (const cols of [30, 40, 60]) {
      const { rows } = L.stripLayout(cols - 1, 'route');
      if (cols >= 60) expect(rows).toHaveLength(1);
      const row = stripOf(ccRows('route', cols))[0]!;
      expect([...row].length).toBeLessThanOrEqual(cols);
      expect(row.startsWith(bareAt(cols) ? ' route' : ' r: route')).toBe(true);
    }
    expect(stripOf(ccRows('route', 60))[0]!.trim()).toBe('r: route  t: team  c: channel  g: gates  k: core  o: board');
    // C4: below the one-row width the full words wrap onto a second row; the two-letter form is gone
    expect(stripOf(ccRows('route', 30)).map((x) => x.trim())).toEqual(['r: route  t: team  c: channel', 'g: gates  k: core  o: board']);
    // Critique 17 B5: one form on every tab (the form follows the width only). Critique 18: the 110-column pane (about 38 cells) holds the six whole words on one row, so it draws them, the keys stay bound
    expect(stripOf(ccRows('route', 40)).map((x) => x.trim())).toEqual(['route team channel gates core board']);
    expect(stripOf(ccRows('route', 38)).map((x) => x.trim())).toEqual(['route team channel gates core board']);
    expect(stripOf(ccRows('route', 46)).map((x) => x.trim())).toEqual(['route  team  channel  gates  core  board']);
    expect(stripOf(ccRows('route', 110)).map((x) => x.trim())).toEqual(['r: route  t: team  c: channel  g: gates  k: core  o: board']);
  });
  test('the rule sits under the lit tab on both hosts', () => {
    for (const tab of TABS) {
      const rows = panelText(panelWorld(tab, 120, mocha, { core }));
      const at = rows.findIndex((l) => l.includes('r: route'));
      expect(rows[at]!.indexOf(`: ${tab}`) + 2).toBe(rows[at + 1]!.indexOf('━'));
      expect(rows[at]!.startsWith(' r: route')).toBe(true);
      expect(rows[at + 1]!.trim()).toBe('━'.repeat(tab.length));
    }
  });
});

