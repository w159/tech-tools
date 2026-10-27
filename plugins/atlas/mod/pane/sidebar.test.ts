// Sidebar shell tests over a fake element table (the tree is plain data): the tab strip, the one-view
// switch, the gates label, the hint and the border thresholds. The row builders have their own tests.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import { sidebarTree, type GateGroup, type SidebarHandlers, type SidebarModel } from './sidebar';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
// SAFETY: a fake element table; the tree is only inspected as plain data.
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;

const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const tab = (root: Node, v: string): Node => {
  const b = all(root).find((n) => n.kind === 'Button' && n.props.key === `tab:${v}`);
  if (!b) throw new Error(`no tab ${v}`);
  return b;
};

const calls: string[] = [];
const on: SidebarHandlers = {
  selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {},
  setView: (v) => calls.push(`view:${v}`),
};
const open: GateGroup[] = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'verify', label: 'verification coverage', ok: false }] }];

const tree = (over: Partial<SidebarModel> = {}, view: SidebarModel['ui']['view'] = 'team', gates: GateGroup[] = open): Node =>
  sidebarTree(els, {
    snapshot: { ...busySnap(), phase: 'implement', now: NOW }, gates,
    ui: { recipient: null, expanded: null, draft: '', view }, columns: 70, rows: 40, ...over,
  }, on) as unknown as Node;

describe('sidebar shell', () => {
  test('four plain hotkey tabs r/t/c/g with their labels', () => {
    const t = tree();
    const tabs = (['route', 'team', 'channel', 'gates'] as const).map((v) => tab(t, v).props);
    expect(tabs.map((b) => b.hotkey)).toEqual(['r', 't', 'c', 'g']);
    expect(tabs.map((b) => b.label)).toEqual(['◎ route', '● team', '✉ channel', '◈ core ✗1']);
    expect(tabs.every((b) => b.plain === true)).toBe(true);
  });

  test('the g tab reads ◈ core when no gate is open', () => {
    expect(tab(tree({}, 'team', []), 'gates').props.label).toBe('◈ core');
  });

  test('the current tab is bold, the others dim; pressing a tab sets that view', () => {
    const t = tree({}, 'channel');
    expect(tab(t, 'channel').props.dimColor).toBe(false);
    expect(all(tab(t, 'channel')).some((n) => n.kind === 'Text' && n.props.bold === true)).toBe(true);
    expect(tab(t, 'team').props.dimColor).toBe(true);
    tab(t, 'route').props.onPress();
    expect(calls).toContain('view:route');
  });

  test('the hint shows only when the inner width is 60 or more', () => {
    expect(textOf(tree({ columns: 90 }))).toContain('press r t c g · Tab ↑↓ · Esc closes');
    expect(textOf(tree({ columns: 50 }))).not.toContain('press r t c g');
  });

  test('plain column: no borderStyle at any width (the host pane draws the one frame)', () => {
    for (const columns of [30, 40, 120]) expect(tree({ columns }).props.borderStyle).toBeUndefined();
  });

  test('exactly one view body under the strip, and no advisor section', () => {
    const t = tree();
    expect(kids(t)[0]!.props.key).toBe('tabs');
    for (const view of ['route', 'team', 'channel', 'gates'] as const) {
      expect(kids(tree({}, view)).length).toBeGreaterThan(1);
      expect(textOf(tree({}, view))).not.toContain('Advisor notes');
    }
  });
});
