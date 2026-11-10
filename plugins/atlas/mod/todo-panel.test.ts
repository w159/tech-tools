// Board panel: collapsed it is `N of M tasks` with a thin single-tone bar, expanded it is the route view's marks
// (✓ done, ◉ in progress, ⏸ blocked with the word, ○ pending), +N more at the row budget. Colour is state only.
import { fx } from '../contracts/todo-tree-fixture';
import { describe, expect, test } from 'claude-code/testing';
import type { TodoItem } from './contract';
import { PANEL_BG, TONE_HEX as T } from './mission-layout';
import { todoRows } from './todo-panel';
import { textWidth } from './theme';
import type { Segment } from './runs';

const items: TodoItem[] = [
  { id: 'a', content: 'map the auth flow', status: 'completed', owner: 'explorer-1', evidence: '1. rg auth -> 3 hits' },
  { id: 'b', content: 'edit auth middleware', status: 'in_progress', owner: 'impl-auth' },
  { id: 'c', content: 'add ttl config', status: 'pending' },
  { id: 'd', content: 'wait on token decision', status: 'blocked', owner: 'impl-ttl', evidence: 'need a ttl' },
];
const text = (row: Segment[]): string => row.map((s) => s.t).join('');
const o = (cols: number, tick = 0, expanded = true, maxRows = 20) => ({ cols, tick, expanded, maxRows });
const one = (it: Partial<TodoItem>): TodoItem => ({ id: 'x', content: 'edit auth middleware', status: 'pending', ...it });
const firstRow = (list: TodoItem[], opts: ReturnType<typeof o>): Segment[] => todoRows(list, opts)[0]!;
const segOf = (row: Segment[], t: string): Segment | undefined => row.find((s) => s.t === t);
const allDone = (list: TodoItem[]): TodoItem[] => list.map((i) => ({ ...i, status: 'completed' }));

describe('collapsed board', () => {
  test('one full-width row: `N of M tasks`, a bar, then the in-progress item', () => {
    const rows = todoRows(items, o(100, 0, false, 10));
    expect(rows).toHaveLength(1);
    expect(textWidth(text(rows[0]!))).toBe(100);
    expect(text(rows[0]!).trimEnd()).toBe(' 1 of 4 tasks ━━━━━━────────────────── ◉ impl-auth: edit auth middleware');
  });
  test('the count is in words and singular for one task', () => {
    expect(text(firstRow([one({})], o(60, 0, false)))).toContain(' 0 of 1 task ');
    expect(text(firstRow(items, o(60, 0, false)))).toContain(' 1 of 4 tasks ');
  });
  test('the bar fills in proportion to done/total, with no gradient or partial cell', () => {
    const filled = (list: TodoItem[]) => text(firstRow(list, o(100, 0, false))).split('━').length - 1;
    expect(filled(allDone(items))).toBe(24);
    expect(filled(items)).toBe(6); // 1 of 4 of 24 cells
    expect(filled(items.map((i) => ({ ...i, status: 'pending' })))).toBe(0);
  });
  test('the bar is one tone: accent while work is running, ok when complete, muted when idle; empty cells dim', () => {
    const bar = (list: TodoItem[]) => firstRow(list, o(100, 0, false)).filter((s) => /^[━─]+$/.test(s.t));
    expect(bar(items)).toEqual([
      { t: '━━━━━━', color: T.accent, bg: PANEL_BG, bold: undefined },
      { t: '─'.repeat(18), color: T.dim, bg: PANEL_BG, bold: undefined },
    ]);
    expect(bar(allDone(items))).toEqual([{ t: '━'.repeat(24), color: T.ok, bg: PANEL_BG, bold: undefined }]);
    const waiting = items.map((i) => (i.status === 'in_progress' ? { ...i, status: 'pending' } : i));
    expect(bar(waiting)[0]).toMatchObject({ color: T.muted });
  });
  test('the count is bold plain text; the tail is a ◉ mark in accent then the item in text', () => {
    const row = firstRow(items, o(100, 0, false));
    expect(segOf(row, '1 of 4 tasks')).toMatchObject({ color: T.text, bold: true });
    expect(segOf(row, '◉')).toMatchObject({ color: T.accent });
    expect(row.every((s) => s.bg === PANEL_BG)).toBe(true);
  });
  test('nothing moves: the frame is the same on every tick', () => {
    const frame = (tick: number) => JSON.stringify(todoRows(items, o(100, tick, false)));
    expect(frame(0)).toBe(frame(1));
    expect(frame(0)).toBe(frame(7));
  });
  test('narrow width never overflows and every width pads to exactly cols', () => {
    for (let cols = 8; cols <= 70; cols += 3) {
      for (const expanded of [false, true]) {
        for (const r of todoRows(items, o(cols, 1, expanded))) expect([cols, expanded, textWidth(text(r))]).toEqual([cols, expanded, cols]);
      }
    }
  });
  test('tail: owner prefix, bare title, hidden when there is no room', () => {
    const cur: TodoItem[] = [{ id: '1', content: '[implement] wire the gate', status: 'in_progress', owner: 'impl-1' }];
    expect(text(firstRow(cur, o(100, 0, false)))).toContain('◉ impl-1: wire the gate');
    expect(text(firstRow([{ ...cur[0]!, owner: undefined }], o(100, 0, false)))).toContain('◉ wire the gate');
    const head = ' 0 of 1 task '.length + 7 + 1; // the bar is 7 cells at 28 cols (cols / 4), one gap after it
    expect(text(firstRow(cur, o(head + 1 + 6, 0, false))).includes('◉')).toBe(false); // room == 6: no tail
    expect(text(firstRow(cur, o(head + 1 + 7, 0, false))).includes('◉')).toBe(true); // room == 7: tail starts
  });
  test('dispatch rows stay out of the count but can be the shown in-progress item', () => {
    const list: TodoItem[] = [
      { id: '1', content: 'plan', status: 'completed' },
      { id: '2', content: 'sub', status: 'in_progress', origin: 'dispatch' },
    ];
    const row = text(firstRow(list, o(100, 0, false)));
    expect(row).toContain(' 1 of 1 task ');
    expect(row).toContain('◉ sub');
  });
});

describe('expanded board', () => {
  test('one row per item: the route view marks, title, owner, then the evidence', () => {
    const rows = todoRows(items, o(100, 0, true, 10)).map((r) => text(r).trimEnd());
    expect(rows).toEqual([
      ' ✓ map the auth flow · explorer-1  rg auth -> 3 hits',
      ' ◉ edit auth middleware · impl-auth',
      ' ○ add ttl config',
      ' ⏸ wait on token decision · impl-ttl  blocked  need a ttl',
    ]);
  });
  test('marks carry their tone: ok, accent, warn, muted; an unknown status reads as pending', () => {
    const row = (st: string) => firstRow([one({ status: st })], o(80));
    expect(segOf(row('completed'), '✓')?.color).toBe(T.ok);
    expect(segOf(row('in_progress'), '◉')?.color).toBe(T.accent);
    expect(segOf(row('blocked'), '⏸')?.color).toBe(T.warn);
    expect(segOf(row('pending'), '○')?.color).toBe(T.muted);
    expect(segOf(row('weird'), '○')?.color).toBe(T.muted);
  });
  test('nothing spins, even in progress: the same mark on every tick', () => {
    const at = (tick: number) => text(firstRow([one({ status: 'in_progress' })], o(80, tick)));
    expect(at(0)).toBe(at(3));
    expect(at(0)).toContain('◉');
  });
  test('a blocked row says the word in warn; other rows never do', () => {
    const blocked = firstRow([one({ status: 'blocked' })], o(80));
    expect(segOf(blocked, '  blocked')).toMatchObject({ color: T.warn });
    expect(text(firstRow([one({ status: 'pending' })], o(80)))).not.toContain('blocked');
  });
  test('content is muted when completed, plain text otherwise; the owner is muted after a dot', () => {
    expect(segOf(firstRow([one({ status: 'completed' })], o(80)), 'edit auth middleware')?.color).toBe(T.muted);
    expect(segOf(firstRow([one({ status: 'pending' })], o(80)), 'edit auth middleware')?.color).toBe(T.text);
    expect(segOf(firstRow([one({ status: 'in_progress' })], o(80)), 'edit auth middleware')?.color).toBe(T.text);
    expect(segOf(firstRow([one({ owner: 'impl' })], o(80)), ' · impl')?.color).toBe(T.muted);
    expect(text(firstRow([one({ owner: 'a-very-long-owner-name' })], o(80)))).toContain(' · a-very-long-o…');
  });
  test('evidence is cleaned, separated by two spaces and cut to the remaining room', () => {
    const ev = '2) first   line\nsecond line is quite long and goes on and on and on';
    const row = text(firstRow([one({ owner: 'impl', evidence: ev })], o(60)));
    expect(row).toBe(' ○ edit auth middleware · impl  first line second line is … ');
    expect(textWidth(row)).toBe(60);
    expect(text(firstRow([one({ owner: 'impl', evidence: '3. ok' })], o(60)))).toContain('impl  ok');
    expect(segOf(firstRow([one({ evidence: 'proof' })], o(60)), '  proof')?.color).toBe(T.muted);
  });
  test('the title shrinks to 60% of the room (min 10) when evidence is present', () => {
    const long = 'x'.repeat(80);
    const row = text(firstRow([one({ content: long, evidence: 'proof here' })], o(60)));
    expect(row.includes(`${'x'.repeat(32)}…`)).toBe(true);
    expect(row).toContain('proof here');
  });
  test('the [phase] prefix is stripped from content', () => {
    const row = text(firstRow([one({ content: '  [verify] run the suite' })], o(80)));
    expect(row).toContain('run the suite');
    expect(row).not.toContain('[verify]');
  });
  test('expanded caps at the row budget with a +N more row', () => {
    const rows = todoRows(items, o(100, 0, true, 3)).map((r) => text(r).trimEnd());
    expect(rows).toHaveLength(3);
    expect(rows[2]).toBe('   +2 more');
    expect(segOf(todoRows(items, o(100, 0, true, 3))[2]!, '   +2 more')?.color).toBe(T.muted);
  });
  test('zero row budget draws nothing, and no items draws nothing', () => {
    expect(todoRows(items, o(100, 0, true, 0))).toEqual([]);
    expect(todoRows([], o(100, 0, true, 5))).toEqual([]);
  });
  test('phase groups: lowercase heading with `N of M`, unknown phases under other, row budget cuts with +N more', () => {
    const list: TodoItem[] = [
      { id: '1', content: 'a', status: 'completed', phase: 'research' },
      { id: '2', content: 'b', status: 'pending', phase: 'research' },
      { id: '3', content: 'c', status: 'pending', phase: 'verify' },
      { id: '4', content: 'd', status: 'pending' },
      { id: '5', content: 'e', status: 'completed', phase: 'bogus' as TodoItem['phase'] },
    ];
    const rows = todoRows(list, o(40)).map((r) => text(r).trimEnd());
    expect(rows).toEqual([
      ' research  1 of 2',
      '   ✓ a',
      '   ○ b',
      ' verify  0 of 1',
      '   ○ c',
      ' other  1 of 2',
      '   ○ d',
      '   ✓ e',
    ]);
    const head = todoRows(list, o(40))[0]!;
    expect(segOf(head, ' research')).toMatchObject({ color: T.text, bold: true });
    expect(segOf(head, '  1 of 2')).toMatchObject({ color: T.muted });
    const cut = todoRows(list, o(40, 0, true, 4)).map((r) => text(r).trimEnd());
    expect(cut).toHaveLength(4);
    expect(cut[3]).toBe('   +5 more');
    expect(todoRows(list, o(40, 0, true, 8))).toHaveLength(8); // exactly the budget: no cut row
  });
});

describe('phase groups (shared fixture items)', () => {
  test('expanded groups by phase in contract order, state shown by mark and word', () => {
    const rows = todoRows(fx.items as TodoItem[], o(60, 0, true, 20)).map((r) => text(r).trimEnd());
    expect(rows).toEqual(fx.rows);
  });
});
