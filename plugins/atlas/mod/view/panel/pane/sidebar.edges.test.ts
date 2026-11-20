// Edge pins for mod/view/panel/pane/sidebar.tsx (surviving mutants of the 553a9bce run): the pane width floor, the box flags that keep the pane from
// shrinking, the accent segment of the rule drawn under the lit tab's chip only, and the body starting right under the rule.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../../../live_fixture';
import { PALETTES } from '../../../design/atlas-ui';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './sidebar';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const on: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} };
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const tree = (columns: number, view: SidebarModel['ui']['view'] = 'team'): Node =>
  sidebarTree(els, { snapshot: { ...busySnap(), phase: 'implement', now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows: 40 }, on) as unknown as Node;
const isTabsRow = (n: Node): boolean => n.kind === 'Box' && String(n.props.key ?? '').startsWith('tabs');
const VIEWS = ['core', 'route', 'gates', 'channel'] as const;

describe('pane box', () => {
  test('the width is the columns less the border, but never under 10', () => {
    expect(tree(5).props.width).toBe(10);
    expect(tree(11).props.width).toBe(10);
    expect(tree(12).props.width).toBe(11);
    expect(tree(70).props.width).toBe(69);
  });
  test('the pane and every strip row are columns and rows that do not shrink, on the panel colour', () => {
    const root = tree(70);
    expect(root.props.flexDirection).toBe('column');
    expect(root.props.flexShrink).toBe(0);
    expect(root.props.backgroundColor).toBe(PALETTES.mocha.panel);
    const rows = kids(root).filter(isTabsRow);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.props.flexShrink).toBe(0);
  });
});

describe('the rule under the strip (the lit chip is the filled one, its rule segment the accent)', () => {
  test('one strip row at every width and for every view; exactly one tab Button is lit per view; one accent segment on the rule row right under the strip', () => {
    let wrapped = 0;
    for (const columns of [20, 24, 30, 40, 70]) for (const view of VIEWS) {
      const c = kids(tree(columns, view));
      const rowIdx = c.map((n, i) => (isTabsRow(n) ? i : -1)).filter((i) => i >= 0);
      if (rowIdx.length > 1) wrapped++;
      const rule = c[rowIdx.at(-1)! + 1]!;
      expect([columns, view, (textOf(rule).match(/━+/g) ?? []).length]).toEqual([columns, view, 1]);
      expect([columns, view, c.filter((n) => !isTabsRow(n) && n !== rule).some((n) => /━/.test(textOf(n)))]).toEqual([columns, view, false]); // no other row carries a heavy rule
      const btns = rowIdx.flatMap((i) => all(c[i]!)).filter((n) => n.kind === 'Button');
      const own = btns.filter((n) => n.props.key === `tab:${view}`).length;
      expect([columns, view, own + (own === 0 && btns.some((n) => n.props.key === 'tab:more') ? 1 : 0)]).toEqual([columns, view, 1]); // a lit tab folded behind \`more ›\` is that chip
    }
    expect(wrapped).toBe(0); // D14: the strip is one row at every width; the trailing tabs fold behind `more ›`
  });
});

describe('the body starts right under the rule', () => {
  test('no blank row between the rule and the first body row, at any width (the header is four rows)', () => {
    for (const columns of [60, 100, 101, 102, 150]) {
      const c = kids(tree(columns));
      const last = c.map((n, i) => (isTabsRow(n) ? i : -1)).filter((i) => i >= 0).at(-1)!;
      expect(textOf(c[last + 1]!)).toMatch(/^ [─━]+$/); // the rule
      expect(textOf(c[last + 2]!).trim()).toMatch(/^PHASE/); // the status body's first row
    }
  });
});

// These fixtures pin truecolor hexes; a tmux-style TERM=*256color with no COLORTERM would put the bare surfaces in 256-colour mode, so pin the depth for this file.
import { clearLook } from '../../../design/look';
import { afterAll as pinAfter, beforeAll as pinBefore } from 'bun:test';
let pinnedColorterm: string | undefined;
pinBefore(() => { clearLook(); pinnedColorterm = process.env.COLORTERM; process.env.COLORTERM = 'truecolor'; });
pinAfter(() => { if (pinnedColorterm === undefined) delete process.env.COLORTERM; else process.env.COLORTERM = pinnedColorterm; });
