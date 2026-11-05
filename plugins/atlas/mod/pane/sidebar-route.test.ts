// routeRows and gateRows over a fake element table: rail never truncates, rows fit, blocked items pause, one gate row per group.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap } from '../live_fixture';
import { textWidth } from '../theme';
import { gateRows } from './sidebar-gates';
import { routeRows } from './sidebar-route';
import type { GateGroup, SidebarHandlers, SidebarModel } from './sidebar-types';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const on = { toggle() {}, copy() {} } as unknown as SidebarHandlers;

const gates: GateGroup[] = [
  { id: 'completion', title: 'completion', lines: [
    { id: 'c1', label: 'verifier verdict', ok: false, fix: 'dispatch verifier' },
    { id: 'c2', label: 'docs', ok: false, fix: 'dispatch docs-curator' },
  ] },
  { id: 'header', title: 'header', lines: [{ id: 'h1', label: 'first line', ok: true, detail: 'matches ^# atlas:' }] },
];
const model = (columns: number, expanded: string | null = null): SidebarModel =>
  ({ snapshot: busySnap({ phase: 'implement' }), gates, ui: { recipient: null, expanded, draft: '', view: 'route' }, columns, rows: 40 });
const text = (r: unknown): string => textOf(r as Node);
const rows = (inner: number, expanded: string | null = null) => routeRows(els, model(inner, expanded), on, inner).map(text);

describe('routeRows', () => {
  for (const inner of [30, 44, 80]) {
    test(`inner ${inner}: rail has no ellipsis, every row fits`, () => {
      const out = rows(inner);
      expect(out[0]).not.toContain('…');
      expect(out[0]).toContain('◉');
      for (const r of out) expect(textWidth(r)).toBeLessThanOrEqual(inner);
    });
  }
  test('wide rail names phases, narrow rail is glyph+state', () => {
    expect(rows(80)[0]).toContain('research ✓');
    expect(rows(30)[0]).not.toContain('research');
  });
  test('blocked owner shows pause; done hidden below 80 and shown at 80', () => {
    expect(rows(44).join('\n')).toContain('⏸ edit auth middleware · impl-auth (blocked');
    expect(rows(44).join('\n')).not.toContain('old refactor');
    expect(rows(80).join('\n')).toContain('old refactor');
  });
});

describe('rail pulse', () => {
  test('current-phase mark alternates on tick, static without one', () => {
    const at = (tick?: number) => text(routeRows(els, { ...model(80), tick }, on, 80)[0]);
    expect(at(0)).not.toBe(at(1));
    expect(at(0)).toBe(at(6)); // phase tables are six frames
    expect(at(undefined)).toContain('◉');
  });
});

describe('gateRows', () => {
  test('one row per group, line rows only when expanded', () => {
    const out = gateRows(els, model(44), on, 44).map(text);
    expect(out).toHaveLength(gates.length);
    expect(out[0]).toBe('✗ completion  2 open  dispatch verifier');
    expect(out[1]).toBe('✓ header  ok  matches ^# atlas:');
    expect(gateRows(els, model(44, 'group:completion'), on, 44)).toHaveLength(gates.length + 2);
  });
});

// ---- exact rail, item marks, blocked reason and counters (mutation-driven) ----
import type { LiveSnapshot } from '../orchestra-types';
import { FIXTURE_CONTRACT } from '../test_helpers';

const snapOf = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ ...busySnap({ phase: 'implement' }), ...over }) as LiveSnapshot;
const rowsOf = (snap: LiveSnapshot, inner: number, expanded: string | null = null, tick?: number): Node[] =>
  routeRows(els, { ...model(inner, expanded), snapshot: snap, tick }, on, inner) as unknown as Node[];
const groupWith = (items: LiveSnapshot['todoGroups'][number]['items'], phase = 'implement'): LiveSnapshot['todoGroups'] =>
  [{ phase, dept: 'FORGE', glyph: 'x', done: 0, total: items.length, items }] as LiveSnapshot['todoGroups'];
const item = (id: string, content: string, status: 'pending' | 'in_progress' | 'completed', over: Record<string, unknown> = {}) =>
  ({ id, content, status, owner: null, evidence: null, live: true, ...over });

describe('route rail', () => {
  test('wide rail: each phase glyph and name, done phases ticked, the current one marked, the rest hollow', () => {
    expect(text(rowsOf(snapOf(), 80)[0]!)).toBe('? research ✓ ─ ※ theory ✓ ─ ⚗ test ✓ ─ ☑ validate ✓ ─ ⚒ implement ◉ ─ ✓ verify ○');
  });
  test('narrow rail keeps glyph and state only, one cell per mark', () => {
    expect(text(rowsOf(snapOf(), 30)[0]!)).toBe('?✓ ─ ※✓ ─ ⚗✓ ─ ☑✓ ─ ⚒◉ ─ ✓○');
    // the full rail is 80 cells; at 79 it already folds
    expect(text(rowsOf(snapOf(), 80)[0]!)).toContain('research');
    expect(text(rowsOf(snapOf(), 79)[0]!)).not.toContain('research');
  });
  test('the current phase is bold and focus-coloured; separators are done-coloured up to it, muted after', () => {
    const parts = kids(rowsOf(snapOf(), 80)[0]!);
    const cur = parts.findIndex((n) => String(n.props.children).includes('implement'));
    expect(parts[cur]!.props.bold).toBe(true);
    expect(parts[cur + 1]!.props.bold).toBe(true);
    expect(parts[0]!.props.bold).toBe(false);
    expect(parts[cur]!.props.color).toBeDefined();
    expect(parts[0]!.props.color).toBeUndefined();
    const seps = parts.filter((n) => n.props.children === ' ─ ');
    expect(seps).toHaveLength(5);
    expect(seps[3]!.props.color).toBe(seps[0]!.props.color);
    expect(seps[4]!.props.color).not.toBe(seps[3]!.props.color);
    // state marks: ticked, current, hollow
    expect(parts[cur + 1]!.props.color).toBe(parts[cur]!.props.color);
    expect(parts.at(-1)!.props.color).not.toBe(parts[1]!.props.color);
  });
  test('a phase the contract has no glyph for falls back to a hollow ring', () => {
    const contract = { ...FIXTURE_CONTRACT, phases: FIXTURE_CONTRACT.phases.filter((p) => p.id !== 'verify') };
    expect(text(rowsOf(snapOf({ contract }), 30)[0]!)).toBe('?✓ ─ ※✓ ─ ⚗✓ ─ ☑✓ ─ ⚒◉ ─ ○○');
    expect(text(rowsOf(snapOf({ contract }), 30)[1]!)).toBe('⚒ implement 1/3');
  });
  test('the phase header uses the glyph of the phase asked for', () => {
    const r = snapOf({ phase: 'research', todoGroups: groupWith([item('a', 'look', 'pending')], 'research') });
    expect(text(rowsOf(r, 80)[1]!)).toBe('? research 0/1');
  });
});

describe('route items', () => {
  const live = () => snapOf({ todoGroups: groupWith([
    item('a', 'plain pending', 'pending'),
    item('b', 'working on it', 'in_progress', { owner: 'explorer-1' }),
    item('c', 'finished work', 'completed', { owner: 'impl-auth', evidence: 'tests   green\nall' }),
    item('d', 'blocked work', 'in_progress', { owner: 'impl-auth' }),
  ]) });
  test('marks: pending hollow, in progress live, blocked owner paused, done ticked', () => {
    const t = rowsOf(live(), 100).map(text);
    expect(t).toContain('○ plain pending');
    expect(t).toContain('◉ working on it · explorer-1');
    expect(t).toContain('✓ finished work · impl-auth');
    expect(t.find((l) => l.startsWith('⏸ blocked work'))).toBe('⏸ blocked work · impl-auth (blocked: found 3 call sites)');
  });
  test('a completed item whose owner is blocked is not paused', () => {
    const t = rowsOf(live(), 100).map(text);
    expect(t.find((l) => l.includes('finished work'))!.startsWith('✓')).toBe(true);
    expect(t.find((l) => l.includes('finished work'))).not.toContain('blocked');
  });
  test('done items: header counts them, rows only from 80 cells', () => {
    expect(text(rowsOf(live(), 79)[1]!)).toBe('⚒ implement 1/4');
    expect(rowsOf(live(), 79).map(text).join('\n')).not.toContain('finished work');
    expect(rowsOf(live(), 80).map(text).join('\n')).toContain('finished work');
    const none = snapOf({ todoGroups: groupWith([item('a', 'p', 'pending'), item('b', 'q', 'pending')]) });
    expect(text(rowsOf(none, 100)[1]!)).toBe('⚒ implement 0/2');
    const all = snapOf({ todoGroups: groupWith([item('a', 'p', 'completed'), item('b', 'q', 'completed')]) });
    expect(text(rowsOf(all, 100)[1]!)).toBe('⚒ implement 2/2');
  });
  test('a single item is a plan, not "nothing planned"', () => {
    const one = snapOf({ todoGroups: groupWith([item('a', 'only one', 'pending')]) });
    expect(rowsOf(one, 60).map(text).slice(1)).toEqual(['⚒ implement 0/1', '○ only one']);
  });
  test('no items, or no group for the phase, says nothing planned', () => {
    expect(rowsOf(snapOf({ todoGroups: groupWith([]) }), 60).map(text).at(-1)).toBe('nothing planned');
    expect(rowsOf(snapOf({ todoGroups: groupWith([item('a', 'x', 'pending')], 'verify') }), 60).map(text).at(-1)).toBe('nothing planned');
    expect(rowsOf(snapOf({ todoGroups: groupWith([]) }), 60)).toHaveLength(2);
  });
  test('the blocked reason shows from 15 spare cells, otherwise a bare tag', () => {
    // title 20 + owner 12 + 2 = 34 used: 49 cells leave 15 spare
    expect(text(rowsOf(snapOf(), 49)[2]!)).toBe('⏸ edit auth middleware · impl-auth (blocked: fou…');
    expect(text(rowsOf(snapOf(), 48)[2]!)).toBe('⏸ edit auth middleware · impl-auth (blocked)');
  });
  test('an empty live line leaves the bare tag even when there is room', () => {
    const snap = snapOf();
    snap.activity = { ...snap.activity, 'impl-auth': { ...snap.activity['impl-auth']!, lastLine: '' } };
    expect(text(rowsOf(snap, 100)[2]!)).toBe('⏸ edit auth middleware · impl-auth (blocked)');
  });
  test('a cut title still keeps the owner and the bare tag, filling the row exactly', () => {
    const t = text(rowsOf(snapOf(), 30)[2]!);
    expect(t).toBe('⏸ edit … · impl-auth (blocked)');
    expect(textWidth(t)).toBe(30);
  });
  test('the title takes the cells left by the owner and tag (no spare, no overflow)', () => {
    const snap = snapOf({ todoGroups: groupWith([item('a', 'a title that is rather long indeed', 'pending', { owner: 'someone' })]) });
    for (const inner of [20, 24, 30]) {
      const t = text(rowsOf(snap, inner)[2]!);
      expect(textWidth(t)).toBe(inner);
      expect(t.endsWith(' · someone')).toBe(true);
    }
    expect(text(rowsOf(snap, 24)[2]!)).toBe('○ a title tha… · someone');
  });
  test('pressing an item toggles its key; expanded it shows its evidence on one line', () => {
    const pressed: string[] = [];
    const handlers = { toggle: (k: string) => pressed.push(k), copy() {} } as unknown as SidebarHandlers;
    const r = routeRows(els, { ...model(100), snapshot: live() }, handlers, 100) as unknown as Node[];
    r.find((n) => n.props.key === 'task:c')!.props.onPress();
    expect(pressed).toEqual(['task:c']);
    expect(rowsOf(live(), 100).filter((n) => n.kind === 'Box' && n.props.key === undefined && textOf(n).startsWith('  ')).map(text)).toEqual([]);
    const open = rowsOf(live(), 100, 'task:c');
    expect(open.map(text)).toContain('  tests green all');
    const box = open.find((n) => text(n) === '  tests green all')!;
    expect(box.props.flexShrink).toBe(0);
    expect(open).toHaveLength(rowsOf(live(), 100).length + 1);
    expect(rowsOf(live(), 100, 'task:a').map(text)).toContain('  no evidence yet');
  });
});
