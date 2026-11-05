// Sidebar shell geometry: the tab strip fills exactly the inner width, the board toggle, label compaction and the column clamp.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
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
    // 4 plain labels: 7+6+9+6 + 4*6 - 3 = 49 cells; hint is 35 cells -> gap 2 at inner 86.
    expect(textWidth(HINT)).toBe(35);
    expect(textOf(strip(tree(87))).endsWith(HINT)).toBe(true); // inner 86: gap 2
    expect(textOf(strip(tree(86))).endsWith(HINT)).toBe(false); // inner 85: gap 1
    expect(textOf(strip(tree(86)))).not.toContain('press');
  });

  test('the strip width is exact for every open-gate digit count', () => {
    for (const n of [1, 9, 10]) {
      const t = strip(tree(110, plain, open(n)));
      expect([n, textWidth(textOf(t))]).toEqual([n, 109 - 12]);
      expect(textOf(t)).toContain(`core ✗${n}`);
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

  test('wired: a plain dim hotkey button after a separator, pressing it calls the handler, hint lists o', () => {
    const t = tree(120, withBoard);
    const b = todosBtn(t)!;
    expect(b.props).toMatchObject({ plain: true, hotkey: 'o', dimColor: true, label: '▤ board' });
    expect(textOf(b)).toBe('▤ board');
    calls.length = 0;
    b.props.onPress();
    expect(calls).toEqual(['todos']);
    const ks = kids(strip(t));
    expect(textOf(ks[ks.indexOf(b) - 1]!)).toBe(' │ ');
    expect(ks.indexOf(b)).toBe(8); // four tabs, three separators, the board separator, then the board
    expect(textOf(strip(t)).endsWith(HINT_O)).toBe(true);
    expect(textWidth(textOf(strip(t)))).toBe(119 - 5 * 3); // five prefixed buttons
  });

  test('labels go compact (no glyphs) once strip + 13 exceeds the inner width', () => {
    // plain labels 49 cells + 13 for the board = 62: inner 62 fits, inner 61 compacts.
    const full = tree(63, withBoard);
    const tight = tree(62, withBoard);
    expect(textOf(kids(strip(full))[0]!)).toBe('◎ route');
    expect(textOf(todosBtn(full)!)).toBe('▤ board');
    expect(textOf(kids(strip(tight))[0]!)).toBe('route');
    expect(textOf(todosBtn(tight)!)).toBe('board');
    expect(todosBtn(tight)!.props.label).toBe('board');
    // without the board the same width needs no compaction
    expect(textOf(kids(strip(tree(62)))[0]!)).toBe('◎ route');
    expect(textOf(kids(strip(tree(50)))[0]!)).toBe('◎ route'); // inner 49 == strip width: fits
    expect(textOf(kids(strip(tree(49)))[0]!)).toBe('route'); // inner 48: compact
  });

  test('compact labels for every tab', () => {
    const labels = kids(strip(tree(40, withBoard))).filter((n) => n.kind === 'Button').map((n) => n.props.label);
    expect(labels).toEqual(['route', 'team', 'channel', 'core', 'board']);
    const open2 = kids(strip(tree(40, withBoard, open(2)))).filter((n) => n.kind === 'Button').map((n) => n.props.label);
    expect(open2).toEqual(['route', 'team', 'channel', 'core ✗2', 'board']);
  });
});

describe('view switch', () => {
  test('each view mounts its own body', () => {
    expect(textOf(tree(100, plain, none, 'channel'))).toContain('#lead-1  3 nicks');
    for (const v of ['route', 'team', 'gates'] as const) expect(textOf(tree(100, plain, none, v))).not.toContain('nicks');
    expect(textOf(tree(100, plain, open(1), 'gates'))).toContain('g  1 open');
    expect(textOf(tree(100, plain, open(1), 'team'))).not.toContain('g  1 open');
  });

  test('pressing a tab sets its view; only the current tab is highlighted', () => {
    const t = tree(100, plain, none, 'gates');
    calls.length = 0;
    for (const v of ['route', 'team', 'channel', 'gates']) kids(strip(t)).find((n) => n.props.key === `tab:${v}`)!.props.onPress();
    expect(calls).toEqual(['view:route', 'view:team', 'view:channel', 'view:gates']);
    const cur = kids(strip(t)).find((n) => n.props.key === 'tab:gates')!;
    expect(kids(cur)[0]!.props).toMatchObject({ bold: true, inverse: true });
    const other = kids(strip(t)).find((n) => n.props.key === 'tab:route')!;
    expect(kids(other)[0]!.props.bold).toBeUndefined();
    expect(kids(other)[0]!.props.inverse).toBeUndefined();
  });
});
