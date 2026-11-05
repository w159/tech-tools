// Board panel: collapsed gradient progress bar, expanded item list, +N more, tick-driven frame.
import { fx } from '../contracts/todo-tree-fixture';
import { describe, expect, test } from 'claude-code/testing';
import type { TodoItem } from './contract';
import { todoRows } from './todo-panel';
import { MOCHA as M, mix, spin, textWidth } from './theme';
import type { Segment } from './runs';

const items: TodoItem[] = [
  { id: 'a', content: 'map the auth flow', status: 'completed', owner: 'explorer-1', evidence: '1. rg auth -> 3 hits' },
  { id: 'b', content: 'edit auth middleware', status: 'in_progress', owner: 'impl-auth' },
  { id: 'c', content: 'add ttl config', status: 'pending' },
  { id: 'd', content: 'wait on token decision', status: 'blocked', owner: 'impl-ttl', evidence: 'need a ttl' },
];
const text = (row: Segment[]): string => row.map((s) => s.t).join('');

describe('todo panel', () => {
  test('collapsed: one full-width row with done/total and the in-progress item', () => {
    const rows = todoRows(items, { cols: 100, tick: 0, expanded: false, maxRows: 10 });
    expect(rows).toHaveLength(1);
    expect(textWidth(text(rows[0]!))).toBe(100);
    expect(text(rows[0]!)).toContain('1/4');
    expect(text(rows[0]!)).toContain('impl-auth');
    expect(text(rows[0]!)).toContain('edit auth middleware');
  });
  test('collapsed bar fills in proportion to done/total', () => {
    const filled = (list: TodoItem[]) => text(todoRows(list, { cols: 100, tick: 0, expanded: false, maxRows: 10 })[0]!).split('█').length - 1;
    const all = items.map((i) => ({ ...i, status: 'completed' }));
    expect(filled(all)).toBeGreaterThan(filled(items));
    expect(filled(items.map((i) => ({ ...i, status: 'pending' })))).toBe(0);
  });
  test('narrow width never overflows', () => {
    for (const cols of [20, 40, 60]) expect(textWidth(text(todoRows(items, { cols, tick: 2, expanded: false, maxRows: 10 })[0]!))).toBeLessThanOrEqual(cols);
  });
  test('tick changes the frame', () => {
    const frame = (tick: number) => JSON.stringify(todoRows(items, { cols: 100, tick, expanded: false, maxRows: 10 }));
    expect(frame(0)).not.toBe(frame(1));
  });
  test('expanded: one row per item with glyph, owner and evidence', () => {
    const rows = todoRows(items, { cols: 100, tick: 0, expanded: true, maxRows: 10 }).map(text);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('✔');
    expect(rows[0]).toContain('explorer-1');
    expect(rows[0]).toContain('rg auth');
    expect(rows[2]).toContain('○');
    expect(rows[3]).toContain('✖');
  });
  test('expanded caps at the row budget with a +N more row', () => {
    const rows = todoRows(items, { cols: 100, tick: 0, expanded: true, maxRows: 3 }).map(text);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toContain('+2 more');
  });
  test('zero row budget draws nothing; blocked glyph and stripped evidence numbering', () => {
    expect(todoRows(items, { cols: 100, tick: 0, expanded: true, maxRows: 0 })).toEqual([]);
    const rows = todoRows(items, { cols: 100, tick: 0, expanded: true, maxRows: 8 }).map(text);
    expect(rows[3]).toContain('✖');
    expect(rows[0]).toContain('rg auth -> 3 hits');
    expect(rows[0]).not.toContain('1. rg');
  });
  test('no items: no rows', () => {
    expect(todoRows([], { cols: 100, tick: 0, expanded: true, maxRows: 5 })).toEqual([]);
  });
});

describe('todo panel: exact paint', () => {
  const o = (cols: number, tick = 0, expanded = true, maxRows = 20) => ({ cols, tick, expanded, maxRows });
  const one = (it: Partial<TodoItem>): TodoItem => ({ id: 'x', content: 'edit auth middleware', status: 'pending', ...it });
  const firstRow = (list: TodoItem[], opts: ReturnType<typeof o>): Segment[] => todoRows(list, opts)[0]!;
  const segOf = (row: Segment[], t: string): Segment | undefined => row.find((s) => s.t === t);

  test('status glyphs carry their colour; in_progress spins with the tick', () => {
    const rows = (st: string, tick = 0) => firstRow([one({ status: st })], o(80, tick));
    expect(segOf(rows('pending'), '○')?.color).toBe(M.muted);
    expect(segOf(rows('completed'), '✔')?.color).toBe(M.green);
    expect(segOf(rows('blocked'), '✖')?.color).toBe(M.red);
    expect(segOf(rows('weird'), '○')?.color).toBe(M.muted); // unknown status reads as pending
    expect(segOf(rows('in_progress', 0), spin(0))?.color).toBe(M.yellow);
    expect(segOf(rows('in_progress', 3), spin(3))?.color).toBe(M.yellow);
    expect(spin(0)).not.toBe(spin(3));
  });

  test('content is muted when completed, normal text otherwise', () => {
    expect(segOf(firstRow([one({ status: 'completed' })], o(80)), 'edit auth middleware')?.color).toBe(M.muted);
    expect(segOf(firstRow([one({ status: 'pending' })], o(80)), 'edit auth middleware')?.color).toBe(M.text);
    expect(segOf(firstRow([one({ status: 'in_progress' })], o(80)), 'edit auth middleware')?.color).toBe(M.text);
  });

  test('owner chip: yellow when in progress, panel2 otherwise, name truncated to 14 and padded to 10', () => {
    const chipOf = (it: Partial<TodoItem>) => firstRow([one(it)], o(80)).find((s) => s.bold && s.color === M.base)!;
    expect(chipOf({ owner: 'impl', status: 'in_progress' })).toMatchObject({ t: ' impl       ', bg: M.yellow });
    expect(chipOf({ owner: 'impl', status: 'pending' })).toMatchObject({ t: ' impl       ', bg: M.panel2 });
    expect(chipOf({ owner: 'a-very-long-owner-name', status: 'pending' }).t).toBe(' a-very-long-o… ');
    expect(text(firstRow([one({})], o(80))).startsWith(` ○ ${' '.repeat(13)}edit`)).toBe(true); // no owner: 13 blank cells
  });

  test('evidence is cleaned, separated by two spaces and cut to the remaining room', () => {
    const ev = '2) first   line\nsecond line is quite long and goes on and on and on';
    const row = text(firstRow([one({ owner: 'impl', evidence: ev })], o(60)));
    // head 16 cells, room 43, content 20 -> evidence gets 43 - 20 - 2 = 21 cells ending in an ellipsis
    expect(row).toBe(` ○  impl        edit auth middleware  first line second li… `);
    expect(textWidth(row)).toBe(60);
    expect(text(firstRow([one({ owner: 'impl', evidence: '3. ok' })], o(60)))).toContain('middleware  ok');
  });

  test('content shrinks to 60% of the room (min 10) when evidence is present', () => {
    const long = 'x'.repeat(80);
    const row = text(firstRow([one({ content: long, evidence: 'proof here' })], o(60)));
    expect(row.includes(`${'x'.repeat(24)}…`)).toBe(true); // room 60-16-1... floor(0.6 * room) cells, last one the ellipsis
    expect(row).toContain('proof here');
  });

  test('the [phase] prefix is stripped from content', () => {
    const row = text(firstRow([one({ content: '  [verify] run the suite' })], o(80)));
    expect(row).toContain('run the suite');
    expect(row).not.toContain('[verify]');
  });

  test('every width pads or cuts to exactly cols', () => {
    for (let cols = 8; cols <= 70; cols += 3) {
      for (const expanded of [false, true]) {
        const rows = todoRows(items, o(cols, 1, expanded));
        for (const r of rows) expect([cols, expanded, textWidth(text(r))]).toEqual([cols, expanded, cols]);
      }
    }
  });

  test('collapsed bar: eighths, dim empty cells, violet-to-teal gradient, lit cell follows the tick', () => {
    const list: TodoItem[] = [{ id: '1', content: 'a', status: 'completed' }, { id: '2', content: 'b', status: 'pending' }, { id: '3', content: 'c', status: 'pending' }, { id: '4', content: 'd', status: 'pending' }];
    const row = firstRow(list, o(40, 0, false)); // bar 10 cells, 1/4 -> 2.5 cells -> '██▌'
    expect(text(row).startsWith(` board ██▌${' '.repeat(7)} 1/4 `)).toBe(true);
    const empty = row.find((s) => s.t === ' '.repeat(7))!;
    expect(empty).toMatchObject({ color: M.dim, bg: M.panel2 });
    const filled = row.filter((s) => s.t === '█' || s.t === '▌' || s.t === '██');
    expect(filled.map((s) => s.color)).toEqual([mix(M.violet, M.teal, 0), mix(M.violet, M.teal, 1 / 9), mix(M.violet, M.teal, 2 / 9)]); // no in-progress item: nothing lit
    const lit = (tick: number) => firstRow([...list.slice(0, 3), { id: '4', content: 'd', status: 'in_progress' }], o(40, tick, false)).filter((s) => s.t === '█' || s.t === '▌').map((s) => s.color);
    expect(lit(0)[0]).toBe(mix(mix(M.violet, M.teal, 0), M.white, 0.6));
    expect(lit(1)[0]).toBe(mix(M.violet, M.teal, 0));
    expect(lit(1)[1]).toBe(mix(mix(M.violet, M.teal, 1 / 9), M.white, 0.6));
    expect(lit(2)[0]).toBe(lit(0)[0]); // wraps over the 2 whole cells
  });

  test('a full bar spans the whole gradient and shows no partial cell', () => {
    const all = items.map((i) => ({ ...i, status: 'completed' }));
    const row = firstRow(all, o(40, 0, false));
    expect(text(row).startsWith(` board ${'█'.repeat(10)} 4/4 `)).toBe(true);
    const colours = row.filter((s) => s.t.includes('█')).map((s) => s.color);
    expect(colours).toEqual(Array.from({ length: 10 }, (_, i) => mix(M.violet, M.teal, i / 9)));
  });

  test('collapsed tail: owner prefix, bare title, hidden when there is no room', () => {
    const cur: TodoItem[] = [{ id: '1', content: '[implement] wire the gate', status: 'in_progress', owner: 'impl-1' }];
    expect(text(firstRow(cur, o(100, 0, false)))).toContain('impl-1: wire the gate');
    expect(text(firstRow([{ ...cur[0]!, owner: undefined }], o(100, 0, false)))).toContain(`${spin(0)} wire the gate`);
    const head = ' board '.length + 6 + ' 0/1 '.length; // bar 6 cells at narrow widths
    expect(text(firstRow(cur, o(head + 1 + 6, 0, false))).includes('impl')).toBe(false); // room == 6: no tail
    expect(text(firstRow(cur, o(head + 1 + 7, 0, false))).includes(spin(0))).toBe(true); // room == 7: tail starts
  });

  test('dispatch rows stay out of done/total but can be the shown in-progress item', () => {
    const list: TodoItem[] = [
      { id: '1', content: 'plan', status: 'completed' },
      { id: '2', content: 'sub', status: 'in_progress', origin: 'dispatch' },
    ];
    const row = text(firstRow(list, o(100, 0, false)));
    expect(row).toContain(' 1/1 ');
    expect(row).toContain('sub');
  });

  test('phase tree: roman headings with done/total, unknown phases under Other, row budget cuts with +N more', () => {
    const list: TodoItem[] = [
      { id: '1', content: 'a', status: 'completed', phase: 'research' },
      { id: '2', content: 'b', status: 'pending', phase: 'research' },
      { id: '3', content: 'c', status: 'pending', phase: 'verify' },
      { id: '4', content: 'd', status: 'pending' },
      { id: '5', content: 'e', status: 'completed', phase: 'bogus' as TodoItem['phase'] },
    ];
    const rows = todoRows(list, o(40)).map((r) => text(r).trimEnd());
    expect(rows).toHaveLength(8);
    expect([rows[0], rows[3], rows[5]]).toEqual([' I. Research 1/2', ' II. Verify 0/1', ' III. Other 1/2']);
    expect(rows[1]).toMatch(/^ {3}✔ {14}a$/);
    expect(rows[2]).toMatch(/^ {3}○ {14}b$/);
    expect(rows[4]).toMatch(/^ {3}○ {14}c$/);
    expect(rows[6]).toMatch(/^ {3}○ {14}d$/); // no phase: Other, in input order
    expect(rows[7]).toMatch(/^ {3}✔ {14}e$/); // unknown phase: Other
    const cut = todoRows(list, o(40, 0, true, 4)).map((r) => text(r).trimEnd());
    expect(cut).toHaveLength(4);
    expect(cut[3]).toBe('   +5 more');
    expect(todoRows(list, o(40, 0, true, 8))).toHaveLength(8); // exactly the budget: no cut row
  });
});

describe('phase tree (shared fixture)', () => {
  test('expanded groups by phase in contract order with roman headings and identical rows to omp', () => {
    const rows = todoRows(fx.items as TodoItem[], { cols: 60, tick: 0, expanded: true, maxRows: 20 }).map((r) => text(r).trimEnd());
    expect(rows).toEqual(fx.rows);
  });
});
