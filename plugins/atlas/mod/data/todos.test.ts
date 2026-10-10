// Tests for mod/data/todos.ts under the claude-code testing kit.
// Covers: session filter, archived filter, in_progress member filter, phase
// field vs content prefix, cache hit (mtime unchanged), corrupt JSON, missing
// file, computeCounts, currentPhase precedence.
import { describe, expect, test } from 'claude-code/testing';
import type { Contract, FsLike, TodoItem } from '../contract';
import { computeCounts, currentPhase, readTodos } from './todos';

const CONTRACT: Contract = {
  phases: [],
  todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'],
  headerFirstLinePattern: '',
  itemPhasePrefix: '[<phase>] ',
};

const PATH = '/r/.atlas/.run/todos.json';

/** In-memory FsLike over {path: text}; undefined value = missing file (read throws, stat undefined). */
function memFs(files: Record<string, string>) {
  const reads = { count: 0 };
  const fs: FsLike = {
    async read(path) {
      reads.count++;
      const v = files[path];
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    async stat(path) {
      const v = files[path];
      if (v === undefined) return undefined;
      return { size: v.length, mtimeMs: Number(files.__tick ?? 0) + v.length };
    },
    async exists(path) { return files[path] !== undefined; },
    async list() { return []; },
  };
  return { fs, reads };
}

function board(items: TodoItem[], tick = 0): Record<string, string> {
  return { __tick: String(tick), [PATH]: JSON.stringify({ version: 1, items }) };
}

const item = (over: Partial<TodoItem>): TodoItem => ({
  id: 'x', content: 'do a thing', status: 'pending', session_id: 's1', ...over,
});

describe('readTodos', () => {
  test('keeps session items, drops other sessions', async () => {
    const { fs } = memFs(board([
      item({ id: 'a', session_id: 's1' }),
      item({ id: 'b', session_id: 's2' }),
      item({ id: 'c', session_id: undefined }), // no session_id
    ]));
    const { items } = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(items.map(i => i.id)).toEqual(['a']);
  });

  test('drops archived even when session matches', async () => {
    const { fs } = memFs(board([
      item({ id: 'a', archived: true }),
      item({ id: 'b' }),
    ]));
    const { items } = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(items.map(i => i.id)).toEqual(['b']);
  });

  test('keeps in_progress items owned by channel members across sessions', async () => {
    const { fs } = memFs(board([
      item({ id: 'a', session_id: 'other', status: 'in_progress', owner: 'DataTodos' }),
      item({ id: 'b', session_id: 'other', status: 'in_progress', owner: 'Stranger' }),
      item({ id: 'c', session_id: 'other', status: 'pending', owner: 'DataTodos' }),
      item({ id: 'd', session_id: 'other', status: 'in_progress', owner: 'DataTodos', archived: true }),
    ]));
    const { items } = await readTodos(fs, '/r', 's1', ['DataTodos', 'lead-01a122'], CONTRACT);
    expect(items.map(i => i.id)).toEqual(['a']);
  });

  test('stamps phase: field wins over prefix; unknown prefix and no prefix => research', async () => {
    const { fs } = memFs(board([
      item({ id: 'a', phase: 'implement', content: '[research] overridden' }),
      item({ id: 'b', content: '[test] prefixed' }),
      item({ id: 'c', content: '[nope] not a phase' }),
      item({ id: 'd', content: 'plain content' }),
    ]));
    const { items } = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(items.map(i => i.phase)).toEqual(['implement', 'test', 'research', 'research']);
  });

  test('cache hit: same mtime returns cached items without re-reading', async () => {
    const { fs, reads } = memFs(board([item({ id: 'a' })]));
    const first = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(reads.count).toBe(1);
    const second = await readTodos(fs, '/r', 's1', [], CONTRACT, first.cache);
    expect(second.items).toBe(first.cache.items);
    expect(reads.count).toBe(1);
  });

  test('changed mtime re-reads and refreshes the cache', async () => {
    const files = board([item({ id: 'a' })]);
    const { fs, reads } = memFs(files);
    const first = await readTodos(fs, '/r', 's1', [], CONTRACT);
    files[PATH] = JSON.stringify({ version: 1, items: [item({ id: 'a' }), item({ id: 'b' })] });
    files.__tick = '1';
    const second = await readTodos(fs, '/r', 's1', [], CONTRACT, first.cache);
    expect(second.items.map(i => i.id)).toEqual(['a', 'b']);
    expect(second.cache.mtimeMs).not.toBe(first.cache.mtimeMs);
    expect(reads.count).toBe(2);
  });

  test('missing file => empty items, zero-mtime cache, and a stable second read', async () => {
    const { fs, reads } = memFs({});
    const first = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(first.items).toEqual([]);
    expect(first.cache.mtimeMs).toBe(0);
    const second = await readTodos(fs, '/r', 's1', [], CONTRACT, first.cache);
    expect(second.items).toBe(first.cache.items);
    expect(reads.count).toBe(0);
  });

  test('corrupt JSON => empty items, cached by mtime, recovers when file changes', async () => {
    const files: Record<string, string> = { __tick: '0', [PATH]: '{not json' };
    const { fs, reads } = memFs(files);
    const first = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(first.items).toEqual([]);
    expect(first.cache.mtimeMs).toBeGreaterThan(0);
    const second = await readTodos(fs, '/r', 's1', [], CONTRACT, first.cache);
    expect(second.items).toBe(first.cache.items); // no re-parse while mtime holds
    expect(reads.count).toBe(1);
    files[PATH] = JSON.stringify({ version: 1, items: [item({ id: 'ok' })] });
    files.__tick = '9';
    const third = await readTodos(fs, '/r', 's1', [], CONTRACT, first.cache);
    expect(third.items.map(i => i.id)).toEqual(['ok']);
  });

  test('non-array items field => empty', async () => {
    const { fs } = memFs({ [PATH]: JSON.stringify({ version: 1, items: 5 }) });
    const { items } = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(items).toEqual([]);
  });
});

describe('computeCounts', () => {
  test('totals overall and per phase', () => {
    const counts = computeCounts([
      item({ id: 'a', content: '[research] r', status: 'completed' }),
      item({ id: 'b', content: '[research] r2' }),
      item({ id: 'c', content: 'plain', status: 'completed' }),
      item({ id: 'd', content: '[implement] i', status: 'completed' }),
    ], CONTRACT);
    expect(counts.total).toBe(4);
    expect(counts.done).toBe(3);
    expect(counts.byPhase.research).toEqual({ done: 1, total: 2 });
    expect(counts.byPhase.research?.total).toBe(2);
    expect(counts.byPhase.plain?.total).toBeUndefined(); // unstamped no-prefix item: totals only, no phase bucket
    expect(counts.byPhase.research?.done).toBe(1);
    expect(counts.byPhase.implement).toEqual({ done: 1, total: 1 });
    expect(counts.byPhase.theory).toEqual({ done: 0, total: 0 });
  });
});

describe('currentPhase', () => {
  test('header wins over in_progress items', () => {
    const items = [{ ...item({ status: 'in_progress', content: '[test] t' }), phase: 'test' as const }];
    expect(currentPhase(items, 'implement')).toEqual({ phase: 'implement', source: 'header' });
  });

  test('first in_progress item phase next', () => {
    const items = [
      { ...item({ id: 'a', content: '[research] r', status: 'pending' }), phase: 'research' as const },
      { ...item({ id: 'b', content: '[validate] v', status: 'in_progress' }), phase: 'validate' as const },
      { ...item({ id: 'c', content: '[theory] th', status: 'in_progress' }), phase: 'theory' as const },
    ];
    expect(currentPhase(items, null)).toEqual({ phase: 'validate', source: 'todo' });
  });

  test('falls back to research with default source', () => {
    expect(currentPhase([], null)).toEqual({ phase: 'research', source: 'default' });
    expect(currentPhase([item({ id: 'a', status: 'completed' })], null))
      .toEqual({ phase: 'research', source: 'default' });
  });
});
