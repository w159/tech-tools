// Sidebar shell geometry: the tab bar fills exactly the inner width, the board toggle, failing-count compaction and the column clamp.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import { TONE_HEX } from '../mission-layout';
import { textWidth } from '../theme';
import { sidebarTree, type GateGroup, type SidebarHandlers, type SidebarModel } from './sidebar';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
// SAFETY: a fake element table; the tree is only inspected as plain data.
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));

const HINT = 'press r t c g · Tab ↑↓ · Esc closes';
const HINT_O = 'press r t c g o · Tab ↑↓ · Esc closes';
const none: GateGroup[] = [];
const open = (n: number): GateGroup[] => [{ id: 'g', title: 'g', lines: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, label: `l${i}`, ok: false })) }] as unknown as GateGroup[];
const calls: string[] = [];
const base = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView: (v: string) => calls.push(`view:${v}`) };
const plain = base as unknown as SidebarHandlers;
const withBoard = { ...base, toggleTodos: () => calls.push('todos') } as unknown as SidebarHandlers;

const tree = (columns: number, on: SidebarHandlers = plain, gates: GateGroup[] = none, view: SidebarModel['ui']['view'] = 'team'): Node =>
  sidebarTree(els, {
    snapshot: { ...busySnap(), now: NOW }, gates, ui: { recipient: null, expanded: null, draft: '', view }, columns, rows: 40,
  }, on) as unknown as Node;
const strip = (t: Node): Node => kids(t)[0]!;

describe('tab strip geometry', () => {
  test('with room, tabs + spacer + hint fill exactly the inner width', () => {
    for (const [columns, gates] of [[100, none], [91, none], [120, open(3)], [100, open(12)]] as const) {
      // The host draws a 3-cell `k: ` hotkey prefix before each of the 4 buttons; the strip budgets for it.
      const inner = columns - 1 - 4 * 3;
      expect([columns, textWidth(textOf(strip(tree(columns, plain, gates))))]).toEqual([columns, inner]);
      expect(textOf(strip(tree(columns, plain, gates))).endsWith(HINT)).toBe(true);
    }
  });

  test('the hint needs a gap of at least 2 cells', () => {
    // 4 plain labels: 5+4+7+5 = 21, + 4 hotkey prefixes of 3, + 3 gaps of 2 = 39 cells; hint is 35 cells -> gap 2 at inner 76.
    expect(textWidth(HINT)).toBe(35);
    expect(textOf(strip(tree(77))).endsWith(HINT)).toBe(true); // inner 76: gap 2
    expect(textOf(strip(tree(76))).endsWith(HINT)).toBe(false); // inner 75: gap 1
    expect(textOf(strip(tree(76)))).not.toContain('press');
  });

  test('the strip width is exact for every open-gate digit count', () => {
    for (const n of [1, 9, 10]) {
      const t = strip(tree(110, plain, open(n)));
      expect([n, textWidth(textOf(t))]).toEqual([n, 109 - 12]);
      expect(textOf(t)).toContain(`gates ${n} failing`);
    }
  });

  test('the strip is a non-shrinking row keyed tabs; the column is clamped to at least 10 wide', () => {
    const t = tree(100);
    expect(strip(t).props).toMatchObject({ key: 'tabs', flexDirection: 'row', flexShrink: 0 });
    expect(t.props).toMatchObject({ flexDirection: 'column', flexShrink: 0, width: 99 });
    expect(tree(40).props.width).toBe(39);
    expect(tree(11).props.width).toBe(10);
    expect(tree(10).props.width).toBe(10);
    expect(tree(1).props.width).toBe(10);
  });
});

describe('board toggle', () => {
  const todosBtn = (t: Node): Node | undefined => kids(strip(t)).find((n) => n.props.key === 'tab:todos');

  test('absent without a toggleTodos handler; the hint omits o', () => {
    expect(todosBtn(tree(120))).toBeUndefined();
    expect(textOf(strip(tree(120)))).not.toContain('board');
    expect(textOf(strip(tree(120)))).toContain(HINT);
    expect(textOf(strip(tree(120)))).not.toContain(' o ·');
  });

  test('wired: a plain muted hotkey button after a gap, pressing it calls the handler, hint lists o', () => {
    const t = tree(120, withBoard);
    const b = todosBtn(t)!;
    expect(b.props).toMatchObject({ plain: true, hotkey: 'o', label: 'board' });
    expect(kids(b)[0]!.props.color).toBe(TONE_HEX.muted);
    expect(textOf(b)).toBe('board');
    calls.length = 0;
    b.props.onPress();
    expect(calls).toEqual(['todos']);
    const ks = kids(strip(t));
    expect(textOf(ks[ks.indexOf(b) - 1]!)).toBe('  ');
    expect(ks.indexOf(b)).toBe(8); // four tabs, three gaps, the board gap, then the board
    expect(textOf(strip(t)).endsWith(HINT_O)).toBe(true);
    expect(textWidth(textOf(strip(t)))).toBe(119 - 5 * 3); // five prefixed buttons
  });

  test('the failing count folds to a bare number once bar + board exceeds the inner width', () => {
    // gates 2 failing: labels 5+4+7+15 = 31, + 12 prefixes + 6 gaps = 49; the board adds 2+3+5 = 10 -> 59.
    const gatesLabel = (columns: number, on: SidebarHandlers) => kids(strip(tree(columns, on, open(2)))).find((n) => n.props.key === 'tab:gates')!.props.label;
    expect(gatesLabel(60, withBoard)).toBe('gates 2 failing'); // inner 59 fits
    expect(gatesLabel(59, withBoard)).toBe('gates 2'); // inner 58 compacts
    expect(gatesLabel(50, plain)).toBe('gates 2 failing'); // without the board inner 49 fits
    expect(gatesLabel(49, plain)).toBe('gates 2');
  });

  test('labels per tab: names only, the gates tab carries the count in words; no glyph or code', () => {
    const labels = kids(strip(tree(120, withBoard))).filter((n) => n.kind === 'Button').map((n) => n.props.label);
    expect(labels).toEqual(['route', 'team', 'channel', 'gates', 'board']);
    const open2 = kids(strip(tree(120, withBoard, open(2)))).filter((n) => n.kind === 'Button').map((n) => n.props.label);
    expect(open2).toEqual(['route', 'team', 'channel', 'gates 2 failing', 'board']);
    expect(textOf(strip(tree(120, withBoard, open(2))))).not.toMatch(/[✗◈◎●✉▤│]/u);
  });
});

describe('view switch', () => {
  test('each view mounts its own body', () => {
    expect(textOf(tree(100, plain, none, 'channel'))).toContain('#lead-1  3 people');
    for (const v of ['route', 'team', 'gates'] as const) expect(textOf(tree(100, plain, none, v))).not.toContain('people');
    expect(textOf(tree(100, plain, open(1), 'gates'))).toContain('g  1 failing');
    expect(textOf(tree(100, plain, open(1), 'team'))).not.toContain('g  1 failing');
  });

  test('pressing a tab sets its view; only the current tab is highlighted', () => {
    const t = tree(100, plain, none, 'gates');
    calls.length = 0;
    for (const v of ['route', 'team', 'channel', 'gates']) kids(strip(t)).find((n) => n.props.key === `tab:${v}`)!.props.onPress();
    expect(calls).toEqual(['view:route', 'view:team', 'view:channel', 'view:gates']);
    const cur = kids(strip(t)).find((n) => n.props.key === 'tab:gates')!;
    expect(kids(cur)[0]!.props).toMatchObject({ bold: true, color: TONE_HEX.accent });
    const other = kids(strip(t)).find((n) => n.props.key === 'tab:route')!;
    expect(kids(other)[0]!.props.color).toBe(TONE_HEX.muted);
    expect(kids(other)[0]!.props.bold).toBe(false);
    expect(kids(other)[0]!.props.inverse).toBeUndefined();
  });

  test('the failing count is red beside the word failing, even on the active tab', () => {
    const t = tree(100, plain, open(3), 'gates');
    const g = kids(strip(t)).find((n) => n.props.key === 'tab:gates')!;
    expect(kids(g).map((n) => [n.props.children, n.props.color])).toEqual([['gates', TONE_HEX.accent], [' 3 failing', TONE_HEX.bad]]);
    const off = kids(strip(tree(100, plain, open(3), 'team'))).find((n) => n.props.key === 'tab:gates')!;
    expect(kids(off).map((n) => [n.props.children, n.props.color])).toEqual([['gates', TONE_HEX.muted], [' 3 failing', TONE_HEX.bad]]);
    expect(kids(strip(tree(100, plain, none, 'gates'))).find((n) => n.props.key === 'tab:gates')!.props.label).toBe('gates');
  });
});
