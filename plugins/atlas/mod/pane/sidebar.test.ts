// Sidebar shell tests over a fake element table (the tree is plain data): the tab strip, the one-view
// switch, the gates label, the hint and the border thresholds. The row builders have their own tests.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import { PALETTES } from '../atlas-ui';
import { stripRows } from './sidebar';
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

const TABS = ['route', 'team', 'channel', 'gates', 'core'] as const;
const buttons = (root: Node): Node[] => all(root).filter((n) => n.kind === 'Button');
const strip = (root: Node): Node[] => buttons(root).filter((b) => String(b.props.key).startsWith('tab:'));
// The host draws a hotkey Button as `k: label`: width = 3 + label.
const hostW = (b: Node): number => (b.props.hotkey ? 3 : 0) + String(b.props.label).length; // a bare-strip tab carries no hotkey: label alone
const KEYS_W0 = (n: Node): boolean => n.kind === 'Box' && n.props.width === 0; // the clipped zero-width layer that holds a bare strip's keys

describe('sidebar shell', () => {
  test('five plain hotkey tabs r t c g k with plain labels, no glyphs', () => {
    const t = tree();
    const tabs = TABS.map((v) => tab(t, v).props);
    expect(tabs.map((b) => b.hotkey)).toEqual(['r', 't', 'c', 'g', 'k']);
    expect(tabs.map((b) => b.label)).toEqual(['route', 'team', 'channel', 'gates', 'core']);
    expect(tabs.every((b) => b.plain === true)).toBe(true);
  });

  test('the board key o is always in the strip (the same six tabs as omp); it presses only when the board is wired', () => {
    expect(strip(tree()).map((b) => b.props.hotkey)).toEqual(['r', 't', 'c', 'g', 'k', 'o']);
    expect(() => tab(tree(), 'todos').props.onPress()).not.toThrow(); // unwired: a no-op
    expect(calls).not.toContain('board');
    const wired = sidebarTree(els, { snapshot: { ...busySnap(), phase: 'implement', now: NOW }, gates: open, ui: { recipient: null, expanded: null, draft: '', view: 'team' }, columns: 70, rows: 40 }, { ...on, toggleTodos: () => calls.push('board') }) as unknown as Node;
    expect(strip(wired).map((b) => b.props.hotkey)).toEqual(['r', 't', 'c', 'g', 'k', 'o']);
    tab(wired, 'todos').props.onPress();
    expect(calls).toContain('board');
  });

  test('the lit tab is bold text, the others muted; pressing a tab sets that view', () => {
    const t = tree({}, 'channel');
    const head = (v: string) => kids(tab(t, v))[0]!.props;
    expect(head('channel').bold).toBe(true);
    expect(head('team').bold).toBeFalsy();
    expect(head('team').color).toBe(PALETTES.mocha.muted);
    expect(head('channel').color).not.toBe(head('team').color);
    tab(t, 'route').props.onPress();
    expect(calls).toContain('view:route');
    tab(t, 'core').props.onPress();
    expect(calls).toContain('view:core');
  });

  test('L21: at 110 columns the docked pane is 38 cells inner and no strip row overflows it', () => {
    for (const columns of [110 / 3, 38, 39, 30, 56, 70]) {
      const inner = Math.floor(columns) - 1;
      const t = tree({ columns: Math.floor(columns) });
      const rowsOf = kids(t).filter((n) => n.kind === 'Box' && String(n.props.key ?? '').startsWith('tabs'));
      expect(rowsOf.length).toBeGreaterThan(0);
      for (const row of rowsOf) {
        const w = kids(row).reduce((n, c) => n + (KEYS_W0(c) ? 0 : c.kind === 'Button' ? hostW(c) : String(c.props.children).length), 0);
        expect(w).toBeLessThanOrEqual(inner);
      }
    }
  });

  test('critique 18: at 110 columns (38 inner) the strip is one row of the six whole words, the keys bound on the zero-width layer', () => {
    const t = tree({ columns: 38 }, 'gates');
    const rowsOf = kids(t).filter((n) => n.kind === 'Box' && String(n.props.key ?? '').startsWith('tabs'));
    expect(rowsOf.map((r) => r.props.key)).toEqual(['tabs']); // one strip row, never `tabs:1`
    const visible = rowsOf.flatMap((r) => kids(r).filter((c) => c.kind === 'Button'));
    expect(visible.map((b) => b.props.label)).toEqual(['route', 'team', 'channel', 'gates', 'core', 'board']);
    expect(visible.map((b) => b.props.hotkey)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]); // the host draws no `k: ` for a Button without a hotkey
    const layer = rowsOf.flatMap((r) => kids(r).filter(KEYS_W0));
    expect(layer).toHaveLength(1);
    expect(kids(layer[0]!).map((b) => b.props.hotkey)).toEqual(['r', 't', 'c', 'g', 'k', 'o']); // the keys stay bound
    visible.find((b) => b.props.label === 'team')!.props.onPress();
    expect(calls).toContain('view:team');
  });

  test('L21: stripRows keeps every tab, in order, and wraps instead of overflowing', () => {
    const items = [...'rtcgk'].map((k, i) => ({ id: TABS[i]!, key: k, label: TABS[i]! as string }));
    for (const inner of [20, 29, 37, 45, 60]) {
      const rows = stripRows(items, inner);
      expect(rows.flat().map((x) => x.id)).toEqual([...TABS]);
      for (const r of rows) expect(r.reduce((n, x, i) => n + (i ? 2 : 0) + 3 + x.label.length, 0)).toBeLessThanOrEqual(Math.max(inner, 3 + 7));
    }
    expect(stripRows(items, 60).length).toBe(1);
    expect(stripRows(items, 37).length).toBe(2);
    expect(stripRows(items, 37, 1).length).toBe(2);
  });

  test('L21: a narrow pane wraps the strip onto a second row of whole words and rules the lit tab under its drawn label', () => {
    for (const [columns, label, wrapped] of [[32, 'gates', true], [56, 'gates', false]] as const) {
      const t = tree({ columns }, 'gates');
      const rowsOf = kids(t).filter((n) => n.kind === 'Box');
      expect(rowsOf.filter((r) => String(r.props.key ?? '').startsWith('tabs:')).length > 0).toBe(wrapped); // 32 cells: not even the bare words fit one row, so a second strip row, never two-letter words
      const strip = rowsOf.find((r) => String(r.props.key).startsWith('tabs') && r.props.key !== 'tabs:rule' && textOf(rowsOf[rowsOf.indexOf(r) + 1]!).includes('━'))!;
      const rule = textOf(rowsOf[rowsOf.indexOf(strip) + 1]!);
      expect(rule.replace(/ /g, '')).toBe('━'.repeat(label.length));
      const drawn = kids(strip).map((c) => (c.kind === 'Button' ? `${c.props.hotkey}: ${c.props.label}` : String(c.props.children))).join('');
      expect(drawn.slice(rule.indexOf('━'), rule.indexOf('━') + label.length)).toBe(label);
    }
  });

  test('the panel paints the rev 4 panel token, never the legacy #11111b', () => {
    const t = tree();
    expect(t.props.backgroundColor).toBe('#181825');
    expect(JSON.stringify(t)).not.toContain('"backgroundColor":"#11111b"');
  });

  test('plain column: no borderStyle at any width (the host pane draws the one frame)', () => {
    for (const columns of [30, 40, 120]) expect(tree({ columns }).props.borderStyle).toBeUndefined();
  });

  test('the root is exactly as wide as the pane minus the host border cell', () => {
    for (const columns of [30, 38, 70, 120]) expect(tree({ columns }).props.width).toBe(columns - 1);
  });

  test('exactly one view body under the strip, and no advisor section', () => {
    for (const view of TABS) {
      expect(kids(tree({}, view)).length).toBeGreaterThan(3);
      expect(textOf(tree({}, view))).not.toContain('Advisor notes');
    }
  });
});

describe('sidebar interactions', () => {
  const pressable = (root: Node, key: string): Node => {
    const b = buttons(root).find((n) => n.props.key === key);
    if (!b) throw new Error(`no button ${key}`);
    return b;
  };
  test('pressing a subagent row selects it as the recipient', () => {
    const got: string[] = [];
    const t = sidebarTree(els, { snapshot: { ...busySnap(), phase: 'implement', now: NOW }, gates: open, ui: { recipient: null, expanded: null, draft: '', view: 'team' }, columns: 70, rows: 40 }, { ...on, selectRecipient: (n: string | null) => got.push(String(n)) }) as unknown as Node;
    const row = buttons(t).find((b) => String(b.props.key).startsWith('worker:'));
    expect(row).toBeDefined();
    row!.props.onPress();
    expect(got.length).toBe(1);
  });
  test('pressing a gate group toggles it', () => {
    const got: string[] = [];
    const t = sidebarTree(els, { snapshot: { ...busySnap(), phase: 'implement', now: NOW }, gates: open, ui: { recipient: null, expanded: null, draft: '', view: 'gates' }, columns: 70, rows: 40 }, { ...on, toggle: (k: string) => got.push(k) }) as unknown as Node;
    const row = buttons(t).find((b) => !String(b.props.key).startsWith('tab:'));
    expect(row).toBeDefined();
    row!.props.onPress();
    expect(got.length).toBe(1);
  });
  void pressable;
});
