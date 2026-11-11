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
const inline = (n: Node | string): string => (typeof n === 'string' ? n : (n.kind === 'Button' && n.props.hotkey ? `${n.props.hotkey}: ` : '') + kidsOf(n).map(inline).join(''));
const ccRows = (tab: PanelTab, cols: number): string[] => {
  const root = sidebarTree(els, { ...worldSidebar(tab, cols), core } as never, { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} }) as unknown as Node;
  return kidsOf(root).map((k) => inline(k).trimEnd());
};
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();

describe('change 9: one tab strip on both hosts', () => {
  const stripOf = (rows: readonly string[]): string[] => rows.filter((l) => /^(\w: \w+)( {2}\w: \w+)*$/.test(l.trim()));
  test('the strip tabs are route team channel gates core board, keys r t c g k o', () => {
    const tabs = (L as unknown as { STRIP_TABS: { id: string; key: string; label: string }[] }).STRIP_TABS;
    expect(tabs.map((t) => `${t.key}:${t.label}`)).toEqual(['r:route', 't:team', 'c:channel', 'g:gates', 'k:core', 'o:board']);
  });
  test('the band buttons are the same set in the same order', () => {
    expect(BAND_BUTTONS.map((b) => `${b.key}:${b.label}`)).toEqual(['r:route', 't:team', 'c:channel', 'g:gates', 'k:core', 'o:board']);
  });
  for (const cols of [120, 80, 56, 38]) for (const tab of TABS) {
    test(`${tab} at ${cols}: the Claude Code strip and the omp strip print the same rows`, () => {
      const cc = stripOf(ccRows(tab, cols));
      const om = stripOf(paintPanel(panelWorld(tab, cols, mocha, { core })).map(plain));
      expect(cc.length).toBeGreaterThan(0);
      expect(om).toEqual(cc);
      expect(cc.join(' ')).toContain('k: core');
      expect(cc.join(' ')).toContain('o: board');
      expect(cc.join(' ').split(/\s+/).filter((w) => /^\w:$/.test(w))).toEqual(['r:', 't:', 'c:', 'g:', 'k:', 'o:']);
    });
  }
  test('the rule sits under the lit tab on both hosts', () => {
    for (const tab of TABS) {
      const rows = panelText(panelWorld(tab, 120, mocha, { core }));
      const at = rows.findIndex((l) => l.includes('r: route'));
      expect(rows[at]!.indexOf(`: ${tab}`) + 2).toBe(rows[at + 1]!.indexOf('━'));
      expect(rows[at + 1]!.trim()).toBe('━'.repeat(tab.length));
    }
  });
});

