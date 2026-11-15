// Edge pins for mod/pane/sidebar.tsx (surviving mutants of the 553a9bce run): the pane width floor, the box flags that keep the pane from
// shrinking, the rule drawn under the lit tab's row only, and the blank row under the strip from 100 columns.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import { PALETTES } from '../atlas-ui';
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
const VIEWS = ['route', 'team', 'channel', 'gates', 'core'] as const;

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

describe('no rule under the lit tab (idle polish 3: the lit chip is the filled one)', () => {
  test('no strip row is followed by a rule box, at every width and for every view; exactly one tab Button is lit per view', () => {
    let wrapped = 0;
    for (const columns of [12, 16, 20, 24, 30, 40, 70]) for (const view of VIEWS) {
      const c = kids(tree(columns, view));
      const rowIdx = c.map((n, i) => (isTabsRow(n) ? i : -1)).filter((i) => i >= 0);
      if (rowIdx.length > 1) wrapped++;
      expect([columns, view, c.some((n) => /━/.test(textOf(n)))]).toEqual([columns, view, false]);
      const btns = rowIdx.flatMap((i) => all(c[i]!)).filter((n) => n.kind === 'Button');
      const own = btns.filter((n) => n.props.key === `tab:${view}`).length;
      expect([columns, view, own + (own === 0 && btns.some((n) => n.props.key === 'tab:more') ? 1 : 0)]).toEqual([columns, view, 1]); // a lit tab folded behind \`▸ more\` is that chip
    }
    expect(wrapped).toBe(0); // D14: the strip is one row at every width; the trailing tabs fold behind `▸ more`
  });
});

describe('the blank row under the strip', () => {
  test('there from 100 columns of pane width (101 host columns), not before', () => {
    const after = (columns: number): string => {
      const c = kids(tree(columns));
      let last = c.map((n, i) => (isTabsRow(n) ? i : -1)).filter((i) => i >= 0).at(-1)!;
      if (c[last + 1] && !isTabsRow(c[last + 1]!) && c[last + 1]!.props.key === undefined && textOf(c[last + 1]!).includes('━')) last++;
      return textOf(c[last + 1]!);
    };
    expect(after(100)).not.toBe(' '); // pane width 99
    expect(after(101)).toBe(' '); // pane width 100
    expect(after(102)).toBe(' ');
  });
});
