// Board panel: collapsed gradient progress bar, expanded item list, +N more, tick-driven frame.
import { fx } from '../contracts/todo-tree-fixture';
import { describe, expect, test } from 'claude-code/testing';
import type { TodoItem } from './contract';
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

describe('phase tree (shared fixture)', () => {
  test('expanded groups by phase in contract order with roman headings and identical rows to omp', () => {
    const rows = todoRows(fx.items, { cols: 60, tick: 0, expanded: true, maxRows: 20 }).map((r) => text(r).trimEnd());
    expect(rows).toEqual(fx.rows);
  });
});
