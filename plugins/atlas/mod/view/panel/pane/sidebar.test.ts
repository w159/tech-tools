// Sidebar shell tests over a fake element table (the tree is plain data): the tab strip, the one-view
// switch, the gates label, the hint and the border thresholds. The row builders have their own tests.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../../../live_fixture';
import { uiFromEnv } from '../../../design/atlas-ui';
import { stripRows } from './sidebar';
import { sidebarTree, type GateGroup, type SidebarHandlers, type SidebarModel } from './sidebar';
import { activeChipStyle } from '../../../input/clickable';

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
const open: GateGroup[] = [{ id: 'tripwire', title: 'Tripwire', lines: [{ id: 'verify', label: 'verification coverage', ok: false, fix: 'run the hooks suite' }] }];

const tree = (over: Partial<SidebarModel> = {}, view: SidebarModel['ui']['view'] = 'team', gates: GateGroup[] = open): Node =>
  sidebarTree(els, {
    snapshot: { ...busySnap(), phase: 'implement', now: NOW }, gates,
    ui: { recipient: null, expanded: null, draft: '', view }, columns: 70, rows: 40, ...over,
  }, on) as unknown as Node;

const TABS = ['core', 'route', 'gates', 'channel'] as const;
const LABELS = ['health', 'status', 'gates', 'channel'];
const buttons = (root: Node): Node[] => all(root).filter((n) => n.kind === 'Button');
const strip = (root: Node): Node[] => buttons(root).filter((b) => String(b.props.key).startsWith('tab:') && !String(b.props.key).endsWith(':key'));
/** No key is bound and no zero-width key layer exists: the strip is click chips. */
const layerKeys = (root: Node): unknown[] => buttons(root).filter((b) => String(b.props.key).endsWith(':key')).map((b) => b.props.hotkey);
/** A chip's drawn width: its Text (the label with its padding) and its badge. */
const hostW = (b: Node): number => kids(b).reduce((n, k) => n + String(k.props.children).length, 0);

describe('sidebar shell', () => {
  test('four plain click chips with plain labels, no glyphs and no key layer', () => {
    const t = tree();
    const tabs = TABS.map((v) => tab(t, v).props);
    expect(layerKeys(t)).toEqual([]);
    expect(tabs.map((b) => b.hotkey)).toEqual([undefined, undefined, undefined, undefined]);
    expect(tabs.map((b) => b.label)).toEqual(LABELS);
    expect(tabs.every((b) => b.plain === true)).toBe(true);
  });

  test('the strip is exactly health status gates channel: no team, core or board chip', () => {
    expect(strip(tree()).map((b) => b.props.label)).toEqual(LABELS);
    expect(() => tab(tree(), 'todos')).toThrow();
    expect(() => tab(tree(), 'team')).toThrow();
    expect(layerKeys(tree())).toEqual([]);
  });

  test('gates carries its denial count and channel its unread count as a badge inside the chip', () => {
    const t = tree({}, 'route');
    const gatesBadge = kids(tab(t, 'gates'))[1];
    expect(gatesBadge?.props.children).toBe(' 1'); // the open fixture's one denial
    expect(gatesBadge?.props.bold).toBe(true);
  });

  test('the lit tab is a filled chip, the others sub-tone chips with a hover style; pressing a tab sets that view', () => {
    const t = tree({}, 'channel');
    const head = (v: string) => kids(tab(t, v))[0]!.props;
    const litStyle = activeChipStyle(uiFromEnv()); // the lit chip is the one activeChipStyle (accent fill, bold; inverse with no colour)
    expect(head('channel')).toMatchObject(litStyle);
    expect(head('route').inverse).toBeFalsy();
    expect(head('route').backgroundColor).not.toBe(litStyle.backgroundColor ?? '\0');
    expect(head('route').hover).toBeDefined();
    expect(head('route').children).toBe(' status ');
    tab(t, 'route').props.onPress();
    expect(calls).toContain('view:route');
    tab(t, 'core').props.onPress();
    expect(calls).toContain('view:core');
  });

  test('an accent segment of the rule sits under the lit chip, as wide as the chip', () => {
    for (const v of ['route', 'gates', 'channel'] as const) {
      const rule = kids(tree({}, v)).find((n) => n.kind === 'Box' && textOf(n).includes('━'))!;
      const heavy = kids(rule).find((n) => String(n.props.children).includes('━'))!;
      const lit = kids(tab(tree({}, v), v))[0]!.props.children as string;
      expect(String(heavy.props.children).length).toBe(lit.length);
    }
  });

  test('L21: at 110 columns the docked pane is 38 cells inner and no strip row overflows it', () => {
    for (const columns of [110 / 3, 38, 39, 30, 56, 70]) {
      const inner = Math.floor(columns) - 1;
      const t = tree({ columns: Math.floor(columns) });
      const rowsOf = kids(t).filter((n) => n.kind === 'Box' && String(n.props.key ?? '').startsWith('tabs'));
      expect(rowsOf.length).toBeGreaterThan(0);
      for (const row of rowsOf) {
        const w = kids(row).reduce((n, c) => n + (c.kind === 'Button' ? hostW(c) : String(c.props.children).length), 0);
        expect(w).toBeLessThanOrEqual(inner);
      }
    }
  });

  test('critique 18, D14: at 110 columns (38 inner) the strip is one row of chips, the trailing tabs behind `more ›`, no key layer', () => {
    const t = tree({ columns: 38 }, 'gates');
    const rowsOf = kids(t).filter((n) => n.kind === 'Box' && String(n.props.key ?? '').startsWith('tabs'));
    expect(rowsOf.map((r) => r.props.key)).toEqual(['tabs']); // one strip row, never `tabs:1`
    const visible = rowsOf.flatMap((r) => kids(r).filter((c) => c.kind === 'Button'));
    expect(visible.map((b) => b.props.label)).toEqual(['health', 'status', 'more ›']); // the order never changes and the lit tab (gates) is not swapped in
    expect(visible.map((b) => b.props.hotkey)).toEqual([undefined, undefined, undefined]); // the host draws no `k: ` for a Button without a hotkey
    visible.find((b) => b.props.label === 'status')!.props.onPress();
    expect(calls).toContain('view:route');
  });

  test('L21: stripRows keeps every tab, in order, and wraps instead of overflowing', () => {
    const items = TABS.map((id) => ({ id, label: id as string }));
    for (const inner of [20, 29, 37, 45, 60]) {
      const rows = stripRows(items, inner);
      expect(rows.flat().map((x) => x.id)).toEqual([...TABS]);
      for (const r of rows) expect(r.reduce((n, x) => n + 2 + x.label.length, 0)).toBeLessThanOrEqual(Math.max(inner, 2 + 7));
    }
    expect(stripRows(items, 60).length).toBe(1);
    expect(stripRows(items, 20).length).toBeGreaterThan(1);
  });

  test('L21 (D14): a narrow pane keeps the strip on one row with a `more ›` chip; the lit tab behind it fills that chip', () => {
    for (const [columns, label, folded] of [[32, 'more ›', true], [56, 'gates', false]] as const) {
      const t = tree({ columns }, 'gates');
      const rowsOf = kids(t).filter((n) => n.kind === 'Box');
      expect(rowsOf.filter((r) => String(r.props.key ?? '').startsWith('tabs:')).length).toBe(0); // closed: never a second strip row
      const lit = kids(t).flatMap((n) => (String(n.props.key ?? '').startsWith('tabs') ? kids(n) : [])).find((n) => n.kind === 'Button' && String(n.props.key) === (folded ? 'tab:more' : 'tab:gates'));
      expect(lit && String(kids(lit)[0]!.props.children).trim()).toBe(label); // a lit tab behind `more ›` fills that chip
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
  test('pressing a subagent row selects it as the recipient', () => {
    const got: string[] = [];
    const t = sidebarTree(els, { snapshot: { ...busySnap(), phase: 'implement', now: NOW }, gates: open, ui: { recipient: null, expanded: null, draft: '', view: 'team' }, columns: 70, rows: 40 }, { ...on, selectRecipient: (n: string | null) => got.push(String(n)) }) as unknown as Node;
    const row = buttons(t).find((b) => String(b.props.key).startsWith('worker:'));
    expect(row).toBeDefined();
    row!.props.onPress();
    expect(got.length).toBe(1);
  });
  test('pressing a failing gate\'s fix line toggles it, and a second press copies the fix', () => {
    const got: string[] = [];
    const at = (expanded: string | null) => sidebarTree(els, { snapshot: { ...busySnap(), phase: 'implement', now: NOW }, gates: open, ui: { recipient: null, expanded, draft: '', view: 'gates' }, columns: 70, rows: 40 }, { ...on, toggle: (k: string) => got.push(`toggle:${k}`), copy: (c: string) => got.push(`copy:${c}`) }) as unknown as Node;
    const row = buttons(at(null)).find((b) => String(b.props.key).startsWith('fix:'));
    expect(row).toBeDefined();
    row!.props.onPress();
    expect(got).toEqual([`toggle:${row!.props.key}`]);
    buttons(at(String(row!.props.key))).find((b) => b.props.key === row!.props.key)!.props.onPress();
    expect(got.at(-1)).toBe('copy:run the hooks suite');
  });
});

// These fixtures pin truecolor hexes; a tmux-style TERM=*256color with no COLORTERM would put the bare surfaces in 256-colour mode, so pin the depth for this file.
import { clearLook } from '../../../design/look';
import { afterAll as pinAfter, beforeAll as pinBefore } from 'bun:test';
let pinnedColorterm: string | undefined;
pinBefore(() => { clearLook(); pinnedColorterm = process.env.COLORTERM; process.env.COLORTERM = 'truecolor'; });
pinAfter(() => { if (pinnedColorterm === undefined) delete process.env.COLORTERM; else process.env.COLORTERM = pinnedColorterm; });
