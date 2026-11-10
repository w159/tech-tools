// routeRows and gateRows over a fake element table: a vertical phase list with the current phase's items nested, rows fit, blocked items pause, one gate row per group.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap } from '../live_fixture';
import { TONE_HEX } from '../mission-layout';
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
    test(`inner ${inner}: every row fits and nothing is cut in a phase name`, () => {
      const out = rows(inner);
      for (const r of out) expect(textWidth(r)).toBeLessThanOrEqual(inner);
      expect(out.filter((r) => /^[✓⠋○] /.test(r)).map((r) => r.slice(2).replace(/ \d+\/\d+$/, ''))).toEqual(['research', 'theory', 'test', 'validate', 'implement', 'verify']);
    });
  }
  test('blocked owner shows pause; done hidden below 80 and shown at 80', () => {
    expect(rows(44).join('\n')).toContain('  ⏸ edit auth middlew… · impl-auth (blocked)');
    expect(rows(44).join('\n')).not.toContain('old refactor');
    expect(rows(80).join('\n')).toContain('old refactor');
  });
  test('wide and narrow lists carry the same phases, one per row, no glyph codes', () => {
    for (const inner of [30, 80]) expect(rows(inner).slice(0, 5).map((r) => r.slice(0, 2))).toEqual(['✓ ', '✓ ', '✓ ', '✓ ', '⠋ ']);
    expect(rows(80).join('\n')).not.toMatch(/[?※⚗☑⚒◉─]/u);
  });
});

describe('phase spinner', () => {
  test('the current mark turns with the tick, static ⠋ without one', () => {
    const at = (tick?: number) => text(routeRows(els, { ...model(80), tick }, on, 80)[4]!);
    expect(at(0)).toBe(at(undefined));
    expect(at(0)).not.toBe(at(1));
    expect(at(0)).toBe(at(10)); // the braille spinner has ten frames
    expect(at(1).startsWith('⠙ implement')).toBe(true);
  });
});

describe('gateRows', () => {
  test('one row per group, line rows only when expanded', () => {
    const out = gateRows(els, model(44), on, 44).map(text);
    expect(out).toHaveLength(gates.length);
    expect(out[0]).toBe('✗ completion  2 failing  dispatch verifier');
    expect(out[1]).toBe('✓ header  passing  matches ^# atlas:');
    expect(gateRows(els, model(44, 'group:completion'), on, 44)).toHaveLength(gates.length + 2);
  });
});

import type { LiveSnapshot } from '../orchestra-types';
import { FIXTURE_CONTRACT } from '../test_helpers';

const snapOf = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ ...busySnap({ phase: 'implement' }), ...over }) as LiveSnapshot;
const rowsOf = (snap: LiveSnapshot, inner: number, expanded: string | null = null, tick?: number): Node[] =>
  routeRows(els, { ...model(inner, expanded), snapshot: snap, tick }, on, inner) as unknown as Node[];
const groupWith = (items: LiveSnapshot['todoGroups'][number]['items'], phase = 'implement'): LiveSnapshot['todoGroups'] =>
  [{ phase, dept: 'FORGE', glyph: 'x', done: 0, total: items.length, items }] as LiveSnapshot['todoGroups'];
const item = (id: string, content: string, status: 'pending' | 'in_progress' | 'completed', over: Record<string, unknown> = {}) =>
  ({ id, content, status, owner: null, evidence: null, live: true, ...over });

describe('phase list', () => {
  test('one row per phase: done ticked, the current one spinning with its count, the rest hollow', () => {
    expect(rowsOf(snapOf(), 80).map(text)).toEqual([
      '✓ research', '✓ theory', '✓ test', '✓ validate', '⠋ implement 1/3',
      '  ⏸ edit auth middleware · impl-auth (blocked: found 3 call sites)', '  ○ add ttl config', '  ✓ old refactor · impl-auth',
      '○ verify',
    ]);
  });
  test('the list is the same at every width: names are never shortened to marks', () => {
    for (const w of [30, 54, 80]) expect(rowsOf(snapOf(), w).map(text).filter((r) => /^[✓⠋○] /.test(r))).toHaveLength(6);
  });
  test('colour is state only: done ok, current accent and bold, next muted, count muted', () => {
    const r = rowsOf(snapOf(), 80);
    const [done, cur, next] = [r[0]!, r[4]!, r[8]!].map(kids);
    expect(done!.map((n) => n.props.color)).toEqual([TONE_HEX.ok, TONE_HEX.muted]);
    expect(cur!.map((n) => [n.props.color, n.props.bold])).toEqual([[TONE_HEX.accent, true], [TONE_HEX.accent, true], [TONE_HEX.muted, undefined]]);
    expect(next!.map((n) => n.props.color)).toEqual([TONE_HEX.muted, TONE_HEX.muted]);
  });
  test('items are nested two cells under the current phase and no other phase lists items', () => {
    const t = rowsOf(snapOf(), 80).map(text);
    const at = t.findIndex((l) => l.startsWith('⠋ implement'));
    expect(t.slice(at + 1, at + 4).every((l) => l.startsWith('  '))).toBe(true);
    expect(t.filter((l) => l.startsWith('  '))).toHaveLength(3);
    expect(t.at(-1)).toBe('○ verify');
  });
  test('a phase the contract does not know still lists, hollow', () => {
    const contract = { ...FIXTURE_CONTRACT, phases: FIXTURE_CONTRACT.phases.filter((p) => p.id !== 'verify') };
    expect(rowsOf(snapOf({ contract }), 30).map(text).at(-1)).toBe('○ verify');
  });
  test('phase done ticks every phase (it used to read all hollow)', () => {
    expect(rowsOf(snapOf({ phase: 'done' }), 30).map(text).slice(0, 6)).toEqual(['✓ research', '✓ theory', '✓ test', '✓ validate', '✓ implement', '✓ verify']);
  });
  test('the count shows the current phase header only', () => {
    const r = snapOf({ phase: 'research', todoGroups: groupWith([item('a', 'look', 'pending')], 'research') });
    expect(rowsOf(r, 80).map(text).slice(0, 3)).toEqual(['⠋ research 0/1', '  ○ look', '○ theory']);
  });
});

describe('route items', () => {
  const live = () => snapOf({ todoGroups: groupWith([
    item('a', 'plain pending', 'pending'),
    item('b', 'working on it', 'in_progress', { owner: 'explorer-1' }),
    item('c', 'finished work', 'completed', { owner: 'impl-auth', evidence: 'tests   green\nall' }),
    item('d', 'blocked work', 'in_progress', { owner: 'impl-auth' }),
  ]) });
  const lines = (snap: LiveSnapshot, inner: number): string[] => rowsOf(snap, inner).map(text);
  test('marks: pending hollow, in progress live, blocked owner paused, done ticked', () => {
    const t = lines(live(), 100);
    expect(t).toContain('  ○ plain pending');
    expect(t).toContain('  ◉ working on it · explorer-1');
    expect(t).toContain('  ✓ finished work · impl-auth');
    expect(t.find((l) => l.startsWith('  ⏸ blocked work'))).toBe('  ⏸ blocked work · impl-auth (blocked: found 3 call sites)');
  });
  test('item colour is state: in progress accent, blocked tag warn, done muted', () => {
    const r = rowsOf(live(), 100);
    const row = (prefix: string) => kids(r.find((n) => text(n).startsWith(prefix))!);
    expect(row('  ◉')[1]!.props.color).toBe(TONE_HEX.accent);
    expect(row('  ⏸').at(-1)!.props.color).toBe(TONE_HEX.warn);
    expect(row('  ✓')[1]!.props.color).toBe(TONE_HEX.ok);
    expect(row('  ✓')[3]!.props.color).toBe(TONE_HEX.muted);
  });
  test('a completed item whose owner is blocked is not paused', () => {
    const t = lines(live(), 100);
    expect(t.find((l) => l.includes('finished work'))!.startsWith('  ✓')).toBe(true);
    expect(t.find((l) => l.includes('finished work'))).not.toContain('blocked');
  });
  test('done items: header counts them, rows only from 80 cells', () => {
    expect(lines(live(), 79)).toContain('⠋ implement 1/4');
    expect(lines(live(), 79).join('\n')).not.toContain('finished work');
    expect(lines(live(), 80).join('\n')).toContain('finished work');
    const none = snapOf({ todoGroups: groupWith([item('a', 'p', 'pending'), item('b', 'q', 'pending')]) });
    expect(lines(none, 100)).toContain('⠋ implement 0/2');
    const all = snapOf({ todoGroups: groupWith([item('a', 'p', 'completed'), item('b', 'q', 'completed')]) });
    expect(lines(all, 100)).toContain('⠋ implement 2/2');
  });
  test('a single item is a plan, not "nothing planned"', () => {
    const one = snapOf({ todoGroups: groupWith([item('a', 'only one', 'pending')]) });
    expect(lines(one, 60).slice(4, 7)).toEqual(['⠋ implement 0/1', '  ○ only one', '○ verify']);
  });
  test('an empty board says nothing planned, nested under the current phase', () => {
    expect(lines(snapOf({ todoGroups: groupWith([]) }), 60).slice(4, 7)).toEqual(['⠋ implement', '  nothing planned', '○ verify']);
  });
  test('an empty phase with work elsewhere points at it instead of "nothing planned"', () => {
    const elsewhere = snapOf({ todoGroups: groupWith([item('a', 'x', 'pending')], 'verify') });
    expect(lines(elsewhere, 60).slice(4, 6)).toEqual(['⠋ implement', '  nothing in implement · 1 open in other phases']);
    const drained = snapOf({ phase: 'done', todoGroups: groupWith([item('a', 'x', 'completed')], 'verify') });
    expect(lines(drained, 60).at(-1)).toBe('✓ all 1 done');
  });
  test('the blocked reason shows from 15 spare cells, otherwise a bare tag', () => {
    // indent 2 + title 20 + owner 12 + 2 = 36 used: 51 cells leave 15 spare
    expect(lines(snapOf(), 51)[5]).toBe('  ⏸ edit auth middleware · impl-auth (blocked: fou…');
    expect(lines(snapOf(), 50)[5]).toBe('  ⏸ edit auth middleware · impl-auth (blocked)');
  });
  test('an empty live line leaves the bare tag even when there is room', () => {
    const snap = snapOf();
    snap.activity = { ...snap.activity, 'impl-auth': { ...snap.activity['impl-auth']!, lastLine: '' } };
    expect(lines(snap, 100)[5]).toBe('  ⏸ edit auth middleware · impl-auth (blocked)');
  });
  test('a cut title still keeps the owner and the bare tag, filling the row exactly', () => {
    const t = lines(snapOf(), 32)[5]!;
    expect(t).toBe('  ⏸ edit … · impl-auth (blocked)');
    expect(textWidth(t)).toBe(32);
  });
  test('the title takes the cells left by the owner and tag (no spare, no overflow)', () => {
    const snap = snapOf({ todoGroups: groupWith([item('a', 'a title that is rather long indeed', 'pending', { owner: 'someone' })]) });
    for (const inner of [22, 26, 32]) {
      const t = lines(snap, inner)[5]!;
      expect(textWidth(t)).toBe(inner);
      expect(t.endsWith(' · someone')).toBe(true);
    }
    expect(lines(snap, 26)[5]).toBe('  ○ a title tha… · someone');
  });
  test('pressing an item toggles its key; expanded it shows its evidence on one line, nested one level deeper', () => {
    const pressed: string[] = [];
    const handlers = { toggle: (k: string) => pressed.push(k), copy() {} } as unknown as SidebarHandlers;
    const r = routeRows(els, { ...model(100), snapshot: live() }, handlers, 100) as unknown as Node[];
    r.find((n) => n.props.key === 'task:c')!.props.onPress();
    expect(pressed).toEqual(['task:c']);
    expect(rowsOf(live(), 100).filter((n) => n.kind === 'Box' && n.props.key === undefined && textOf(n).startsWith('    ')).map(text)).toEqual([]);
    const open = rowsOf(live(), 100, 'task:c');
    expect(open.map(text)).toContain('    tests green all');
    const box = open.find((n) => text(n) === '    tests green all')!;
    expect(box.props.flexShrink).toBe(0);
    expect(open).toHaveLength(rowsOf(live(), 100).length + 1);
    expect(rowsOf(live(), 100, 'task:a').map(text)).toContain('    no evidence yet');
  });
});

describe('routeRows: unphased board items sit under the current phase', () => {
  const item = (id: string, status: string, origin?: string) => ({ id, content: `task ${id}`, status, owner: 'explorer-a843', evidence: null, origin });
  const snap = (todos: unknown[]) => ({ snapshot: busySnap({ phase: 'research', todoGroups: [], todos: todos as any }), gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'route' }, columns: 80, rows: 40 }) as unknown as SidebarModel;
  test('dispatch rows with no phase are listed, not `nothing planned`', () => {
    const out = routeRows(els, snap([item('d0', 'in_progress', 'dispatch'), item('d1', 'pending', 'dispatch')]), on, 60).map(text);
    expect(out.join('\n')).not.toContain('nothing planned');
    expect(out.join('\n')).toContain('task d0');
    expect(out.join('\n')).toContain('task d1');
    expect(out.find((r) => r.includes('research'))).toContain('0/2');
  });
  test('an empty board still says `nothing planned`', () => {
    expect(routeRows(els, snap([]), on, 60).map(text).join('\n')).toContain('nothing planned');
  });
});
