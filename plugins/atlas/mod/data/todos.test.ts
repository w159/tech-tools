// Tests for mod/data/todos.ts under the claude-code testing kit.
// Covers: session filter, archived filter, in_progress member filter, phase
// field vs content prefix, cache hit (mtime unchanged), corrupt JSON, missing
// file, computeCounts, currentPhase precedence.
import { describe, expect, test } from 'claude-code/testing';
import type { Contract, FsLike, TodoItem } from '../contract';
import { contractGlyph } from '../theme';
import { DEPT, computeCounts, currentPhase, groupTodos, isPlanItem, planCounts, readTodos, routeCounts } from './todos';
import * as todosMod from './todos';

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
  test('keeps session items, drops other sessions completed items', async () => {
    // Completed stays session-scoped so the done count is this session's.
    const { fs } = memFs(board([
      item({ id: 'a', session_id: 's1', status: 'completed' }),
      item({ id: 'b', session_id: 's2', status: 'completed' }),
      item({ id: 'c', session_id: undefined, status: 'completed' }), // no session_id
    ]));
    const { items } = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(items.map(i => i.id)).toEqual(['a']);
  });

  test('keeps the open backlog (pending/in_progress) from any session', async () => {
    const { fs } = memFs(board([
      item({ id: 'a', session_id: 'old', status: 'pending' }),
      item({ id: 'b', session_id: undefined, status: 'in_progress' }),
      item({ id: 'c', session_id: 'old', status: 'completed' }),
      item({ id: 'd', session_id: 'old', status: 'pending', archived: true }),
    ]));
    const { items } = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(items.map(i => i.id)).toEqual(['a', 'b']);
  });

  test('drops archived even when session matches', async () => {
    const { fs } = memFs(board([
      item({ id: 'a', archived: true }),
      item({ id: 'b' }),
    ]));
    const { items } = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(items.map(i => i.id)).toEqual(['b']);
  });

  test('open items stay across sessions regardless of owner; archived never', async () => {
    const { fs } = memFs(board([
      item({ id: 'a', session_id: 'other', status: 'in_progress', owner: 'DataTodos' }),
      item({ id: 'b', session_id: 'other', status: 'in_progress', owner: 'Stranger' }),
      item({ id: 'c', session_id: 'other', status: 'completed', owner: 'DataTodos' }),
      item({ id: 'd', session_id: 'other', status: 'in_progress', owner: 'DataTodos', archived: true }),
    ]));
    const { items } = await readTodos(fs, '/r', 's1', ['DataTodos', 'lead-01a122'], CONTRACT);
    expect(items.map(i => i.id)).toEqual(['a', 'b']);
  });

  test('stamps phase: field wins over prefix; unknown prefix and no prefix stay unphased', async () => {
    const { fs } = memFs(board([
      item({ id: 'a', phase: 'implement', content: '[research] overridden' }),
      item({ id: 'b', content: '[test] prefixed' }),
      item({ id: 'c', content: '[nope] not a phase' }),
      item({ id: 'd', content: 'plain content' }),
    ]));
    const { items } = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(items.map(i => i.phase)).toEqual(['implement', 'test', undefined, undefined]);
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

  test('corrupt JSON after a good read keeps the previous items and reports corrupt', async () => {
    const files = board([item({ id: 'a' })]);
    const { fs } = memFs(files);
    const good = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(good.error).toBeUndefined();
    files[PATH] = '{not json';
    files.__tick = '5';
    const bad = await readTodos(fs, '/r', 's1', [], CONTRACT, good.cache);
    expect(bad.items.map(i => i.id)).toEqual(['a']);
    expect(bad.error).toBe('corrupt');
  });

  test('a file that exists but cannot be read keeps the previous items and reports unreadable', async () => {
    const files = board([item({ id: 'a' })]);
    const { fs } = memFs(files);
    const good = await readTodos(fs, '/r', 's1', [], CONTRACT);
    files.__tick = '5';
    const broken: FsLike = { ...fs, read: async () => { throw new Error('EACCES'); } };
    const bad = await readTodos(broken, '/r', 's1', [], CONTRACT, good.cache);
    expect(bad.items.map(i => i.id)).toEqual(['a']);
    expect(bad.error).toBe('unreadable');
  });

  test('a missing file is an empty board with no error', async () => {
    const { fs } = memFs({});
    const r = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(r.items).toEqual([]);
    expect(r.error).toBeUndefined();
  });

  test('corrupt on the very first read => empty items plus the error', async () => {
    const { fs } = memFs({ __tick: '0', [PATH]: '{not json' });
    const r = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(r.items).toEqual([]);
    expect(r.error).toBe('corrupt');
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

describe('groupTodos', () => {
  const phased = item; // item() spreads `phase` from over; no content prefix needed
  const GLYPHED: Contract = { ...CONTRACT, phases: [{ id: 'implement', glyph: 'I' }, { id: 'research', glyph: 'R' }] };

  test('unphased item lands in unsorted, not ARCHIVE; dept + glyph from contract; live first', () => {
    const groups = groupTodos([
      phased({ id: 'a', status: 'completed', phase: 'implement' }),
      phased({ id: 'b', status: 'pending', phase: 'implement' }),
      phased({ id: 'c', status: 'pending' }),
    ], GLYPHED, 's1');
    expect(groups.map(g => g.phase)).toEqual(['implement', 'unsorted']);
    expect(groups[0]).toMatchObject({ dept: 'FORGE', glyph: 'I', done: 1, total: 2 });
    expect(groups[0]?.items.map(i => i.id)).toEqual(['b', 'a']); // open before completed
    expect(groups[1]).toMatchObject({ dept: 'UNSORTED', glyph: '·' });
    expect(DEPT.research).toBe('ARCHIVE');
  });

  test('completed backlog of other sessions is not live', () => {
    const [g] = groupTodos([phased({ id: 'a', session_id: 'old', status: 'completed', phase: 'test' }), phased({ id: 'b', session_id: 'old', status: 'pending', phase: 'test' })], CONTRACT, 's1');
    expect(g?.items.map(i => [i.id, i.live])).toEqual([['b', true], ['a', false]]);
  });

  test('advisor / carried / manual-unphased rows never reach contract groups or progress; advisors collapse to one group', () => {
    const o = (id: string, origin: string, over: Partial<TodoItem> = {}) => ({ ...item({ id, ...over }), origin }) as TodoItem;
    const items = [
      o('s-ph', 'session', { phase: 'test', status: 'completed' }),
      o('s-un', 'session'),
      o('adv1', 'advisor'),
      o('adv2', 'advisor', { phase: 'test' }),
      o('adv3', 'advisor', { status: 'completed' }),
      o('car', 'carried', { session_id: 'old' }),
      o('man', 'manual'),
      o('man-ph', 'manual', { phase: 'verify', session_id: 'old' }),
    ];
    const groups = groupTodos(items, CONTRACT, 's1');
    expect(groups.map(g => g.phase)).toEqual(['test', 'verify', 'unsorted', 'advisor']);
    expect(groups.find(g => g.phase === 'unsorted')?.items.map(i => i.id)).toEqual(['s-un']);
    expect(groups.find(g => g.phase === 'test')?.items.map(i => i.id)).toEqual(['s-ph']);
    expect(groups.at(-1)).toMatchObject({ phase: 'advisor', total: 2 });
  });

  test('advisor notes list newest first by created_at, whatever the board order or session', () => {
    const adv = (id: string, created_at: number, session_id = 's1') => ({ ...item({ id, session_id }), origin: 'advisor', created_at }) as TodoItem;
    const groups = groupTodos([adv('mid', 20), adv('old', 10, 'other-session'), adv('new', 30)], CONTRACT, 's1');
    expect(groups.at(-1)?.items.map(i => i.id)).toEqual(['new', 'mid', 'old']);
  });
});

describe('groupTodos row shaping', () => {
  const one = (over: Partial<TodoItem> & { origin?: string }) =>
    groupTodos([{ ...item({ phase: 'test' }), ...over } as TodoItem], CONTRACT, 's1')[0]!.items[0]!;

  test('clips content at 160 chars with an ellipsis and evidence at 200', () => {
    const exact = one({ content: 'a'.repeat(160), evidence: 'e'.repeat(200) });
    expect(exact.content).toBe('a'.repeat(160));
    expect(exact.evidence).toBe('e'.repeat(200));
    const over = one({ content: 'a'.repeat(161), evidence: 'e'.repeat(201) });
    expect(over.content).toBe('a'.repeat(159) + '…');
    expect(over.evidence).toBe('e'.repeat(199) + '…');
  });

  test('owner passes through, absent owner and empty evidence become null', () => {
    expect(one({ owner: 'bob' }).owner).toBe('bob');
    const bare = one({ evidence: '' });
    expect(bare.owner).toBeNull();
    expect(bare.evidence).toBeNull();
  });

  test('origin is carried onto the row only when set', () => {
    expect(one({ origin: 'manual' }).origin).toBe('manual');
    expect('origin' in one({})).toBe(false);
  });

  test('advisor ordering treats a missing created_at as 0, below a positive one', () => {
    const adv = (id: string, created_at?: number) => ({ ...item({ id }), origin: 'advisor', created_at }) as TodoItem;
    const g = groupTodos([adv('none'), adv('half', 0.5)], CONTRACT, 's1').at(-1)!;
    expect(g.items.map(i => i.id)).toEqual(['half', 'none']);
  });

  test('unknown contract phase gets an upper-cased dept and a dot glyph; completed advisors are dropped', () => {
    const C: Contract = { ...CONTRACT, todoPhases: ['custom'] as never };
    const g = groupTodos([item({ phase: 'custom' as never })], C, 's1');
    expect(g[0]).toMatchObject({ phase: 'custom', dept: 'CUSTOM', glyph: '·' });
    const adv = { ...item({ status: 'completed' }), origin: 'advisor' } as TodoItem;
    expect(groupTodos([adv], C, 's1')).toEqual([]);
  });

  test('in_progress sorts before pending before completed among live rows', () => {
    const g = groupTodos([
      item({ id: 'c', phase: 'test', status: 'completed' }),
      item({ id: 'p', phase: 'test', status: 'pending' }),
      item({ id: 'i', phase: 'test', status: 'in_progress' }),
    ], CONTRACT, 's1')[0]!;
    expect(g.items.map(i => i.id)).toEqual(['i', 'p', 'c']);
  });
});

describe('isPlanItem / routeCounts / computeCounts with dispatch rows', () => {
  const disp = (id: string, status: TodoItem['status'] = 'completed') => ({ ...item({ id, status }), origin: 'dispatch' }) as TodoItem;

  test('isPlanItem is false only for dispatch-origin rows', () => {
    expect(isPlanItem({ origin: 'dispatch' })).toBe(false);
    expect(isPlanItem({ origin: 'session' })).toBe(true);
    expect(isPlanItem({})).toBe(true);
  });

  test('computeCounts ignores dispatch rows', () => {
    const c = computeCounts([item({ id: 'a', phase: 'test', status: 'completed' }), disp('d1'), disp('d2', 'pending')], CONTRACT);
    expect(c.total).toBe(1);
    expect(c.done).toBe(1);
    expect(c.byPhase.test).toEqual({ done: 1, total: 1 });
  });

  test('routeCounts counts every non-advisor group item except dispatch rows', () => {
    const row = (id: string, status: string, origin?: string) => ({ id, content: id, status, owner: null, evidence: null, live: true, ...(origin ? { origin } : {}) });
    const groups = [
      { phase: 'test', dept: 'TEST LAB', glyph: 'T', items: [row('a', 'completed'), row('b', 'pending'), row('dd', 'completed', 'dispatch')], done: 1, total: 3 },
      { phase: 'unsorted', dept: 'UNSORTED', glyph: '·', items: [row('c', 'completed')], done: 1, total: 1 },
      { phase: 'advisor', dept: 'ADVISOR NOTES', glyph: '·', items: [row('adv', 'completed')], done: 0, total: 1 },
    ] as unknown as Parameters<typeof routeCounts>[0];
    expect(routeCounts(groups)).toEqual({ done: 2, total: 3 });
    expect(routeCounts([])).toEqual({ done: 0, total: 0 });
  });
});

describe('DEPT', () => {
  test('maps every phase to its department label', () => {
    expect(DEPT).toEqual({
      research: 'ARCHIVE', theory: 'OBSERVATORY', test: 'TEST LAB', validate: 'GATE',
      implement: 'FORGE', verify: 'TRIBUNAL', done: 'HARBOUR',
    });
  });
});

describe('readTodos path and filters', () => {
  test('strips trailing slashes from root and requires session match for completed rows', async () => {
    const { fs } = memFs(board([item({ id: 'a' })]));
    expect((await readTodos(fs, '/r//', 's1', [], CONTRACT)).items.map(i => i.id)).toEqual(['a']);
  });

  test('a read failure after a successful stat yields an empty list', async () => {
    const fs: FsLike = {
      async read() { throw new Error('EACCES'); },
      async stat() { return { size: 1, mtimeMs: 5 }; },
      async exists() { return true; },
      async list() { return []; },
    };
    const r = await readTodos(fs, '/r', 's1', [], CONTRACT);
    expect(r.items).toEqual([]);
    expect(r.cache.mtimeMs).toBe(5);
  });

  test('a throwing stat is treated as a missing file', async () => {
    const fs: FsLike = {
      async read() { throw new Error('x'); },
      async stat() { throw new Error('x'); },
      async exists() { return false; },
      async list() { return []; },
    };
    expect(await readTodos(fs, '/r', 's1', [], CONTRACT)).toEqual({ items: [], cache: { mtimeMs: 0, items: [] } });
  });

  test('a custom itemPhasePrefix is escaped and parsed', async () => {
    const C: Contract = { ...CONTRACT, itemPhasePrefix: '(.*)<phase>: ' };
    const { fs } = memFs(board([item({ id: 'a', content: '(.*)test: x' }), item({ id: 'b', content: 'zz test: x' })]));
    expect((await readTodos(fs, '/r', 's1', [], C)).items.map(i => i.phase)).toEqual(['test', undefined]);
  });

  test('a prefix without <phase> never stamps a phase', async () => {
    const C: Contract = { ...CONTRACT, itemPhasePrefix: 'fixed ' };
    const { fs } = memFs(board([item({ id: 'a', content: 'fixed test' })]));
    expect((await readTodos(fs, '/r', 's1', [], C)).items[0]!.phase).toBeUndefined();
  });
});

describe('currentPhase without a stamped active phase', () => {
  test('in_progress item lacking a phase falls through to the header', () => {
    expect(currentPhase([item({ status: 'in_progress' })], 'theory')).toEqual({ phase: 'theory', source: 'header' });
  });
});

describe('carried rows re-stamped to the current session (defect A)', () => {
  const car = (id: string, phase: TodoItem['phase']) => ({ ...item({ id, phase, status: 'pending', session_id: 's-new' }), origin: 'carried' }) as TodoItem;
  const sess = (id: string, phase: TodoItem['phase']) => ({ ...item({ id, phase, status: 'pending', session_id: 's-new' }), origin: 'session' }) as TodoItem;
  test('a fresh session with only carried phased rows has no groups', () => {
    const items = [car('r', 'research'), car('i', 'implement'), car('v', 'verify')];
    expect(groupTodos(items, CONTRACT, 's-new')).toEqual([]);
  });
  test('own session rows still count beside carried ones', () => {
    const items = [car('r', 'research'), sess('t', 'test')];
    expect(groupTodos(items, CONTRACT, 's-new').map(g => g.phase)).toEqual(['test']);
  });
});

describe('currentPhase', () => {
  test('the active todo wins over the reply header (live 12.2.0: rail read verify during a research task)', () => {
    const items = [{ ...item({ status: 'in_progress', content: '[research] r' }), phase: 'research' as const }];
    expect(currentPhase(items, 'verify')).toEqual({ phase: 'research', source: 'todo' });
  });

  test('with no active todo the header phase is used', () => {
    const items = [{ ...item({ status: 'pending', content: '[test] t' }), phase: 'test' as const }];
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
    expect(currentPhase([item({ id: 'a', status: 'pending' })], null))
      .toEqual({ phase: 'research', source: 'default' });
  });
});

describe('planCounts', () => {
  const t = (id: string, status: string, origin?: string) => ({ id, status, content: id, origin }) as any;
  test('dispatch rows are excluded while a real plan exists', () => {
    expect(planCounts([t('a', 'completed'), t('b', 'pending'), t('d', 'pending', 'dispatch')])).toEqual({ done: 1, total: 2 });
  });
  test('only dispatch rows: they count, so the header matches the TODO tree', () => {
    expect(planCounts([t('d0', 'in_progress', 'dispatch'), t('d1', 'completed', 'dispatch')])).toEqual({ done: 1, total: 2 });
  });
  test('empty board: 0 of 0', () => { expect(planCounts([])).toEqual({ done: 0, total: 0 }); });
});

// ---- mod data fixes D1-D3, D9 (ui-rootcause) ----
const row = (over: Record<string, unknown>) => ({ id: 'x', content: 'real work', status: 'pending', session_id: 's1', ...over }) as any;

describe('D1 phantom rows leave the plan basis', () => {
  const real = [row({ id: 'a', status: 'completed' }), row({ id: 'b', status: 'completed' }), row({ id: 'c', status: 'in_progress' })];
  test('D1: a placeholder stub row does not count: 2 of 3, not 2 of 4', () => {
    const stub = row({ id: 'ph', content: 'placeholder', session_id: 'other' });
    expect(planCounts([...real, stub], 's1')).toEqual({ done: 2, total: 3 });
    expect(isPlanItem(stub)).toBe(false);
  });
  test('D1: another session\'s open row does not inflate this session\'s total', () => {
    const old = row({ id: 'old', content: 'last week\'s leftover', session_id: 'older', status: 'pending' });
    expect(planCounts([...real, old], 's1')).toEqual({ done: 2, total: 3 });
    expect(computeCounts([...real, old], CONTRACT, 's1').total).toBe(3);
  });
  test('D1: an empty-content row is a stub too', () => {
    expect(planCounts([...real, row({ id: 'e', content: '  ' })], 's1').total).toBe(3);
  });
});

describe('D2 one count basis', () => {
  test('D2: computeCounts, planCounts and todoCounts agree on a mixed board', () => {
    const items = [
      row({ id: 'a', status: 'completed', phase: 'implement' }),
      row({ id: 'b', status: 'pending', origin: 'manual' }), // unphased manual row: groups drop it, the count must keep it
      row({ id: 'c', status: 'pending', origin: 'advisor' }),
      row({ id: 'd', status: 'pending', origin: 'dispatch' }),
      row({ id: 'e', status: 'pending', origin: 'carried' }),
    ];
    const snap = { todos: items, todoGroups: groupTodos(items, CONTRACT, 's1'), sessionId: 's1' };
    const c = computeCounts(items, CONTRACT, 's1');
    expect((todosMod as any).todoCounts(snap)).toEqual({ done: c.done, total: c.total });
    expect(planCounts(items, 's1')).toEqual({ done: c.done, total: c.total });
    expect(c.total).toBe(2);
  });
});

describe('D3 phase after completion', () => {
  const done = (id: string, phase: string) => ({ ...item({ id, status: 'completed' }), phase }) as TodoItem;
  test('D3: every plan row completed => done, never research', () => {
    expect(currentPhase([done('a', 'research'), done('b', 'implement')], null)).toEqual({ phase: 'done', source: 'todo' });
  });
  test('D3: a stale header cannot pull a finished run back', () => {
    expect(currentPhase([done('a', 'implement')], 'research').phase).toBe('done');
  });
  test('D3/R4: nothing in progress, work pending, no header => the earliest open row\'s phase, not the stale last-completed one', () => {
    const items = [done('a', 'research'), done('c', 'implement'), { ...item({ id: 'b', status: 'pending' }), phase: 'verify' } as TodoItem];
    expect(currentPhase(items, null)).toEqual({ phase: 'verify', source: 'todo' });
  });
  test('D3: dispatch and stub rows do not hold a finished run open', () => {
    const items = [done('a', 'verify'), row({ id: 'd', origin: 'dispatch', status: 'in_progress' }), row({ id: 'p', content: 'placeholder' })];
    expect(currentPhase(items, null).phase).toBe('done');
  });
});

describe('D9 one glyph path', () => {
  test('D9: group glyphs go through contractGlyph, so the done glyph is one mark', () => {
    const c: Contract = { ...CONTRACT, phases: [{ id: 'implement', glyph: '🔧' }, { id: 'verify', glyph: '✅' }] };
    const g = groupTodos([row({ id: 'a', phase: 'implement' }), row({ id: 'b', phase: 'verify' })], c, 's1');
    expect(g.map(x => x.glyph)).toEqual([contractGlyph('🔧'), contractGlyph('✅')]);
    expect(g[1]!.glyph).toBe('✓');
  });
});

describe('regression fixes R3 R4 R7 (f4e6c29c verifier)', () => {
  const r = (over: Record<string, unknown>) => ({ id: 'x', content: 'real work', status: 'pending', session_id: 'S', ...over }) as any;
  test('R3: a carried row completed this session counts as done; a still-pending carried row stays out', () => {
    const carriedDone = r({ id: 'c', origin: 'carried', status: 'completed' });
    expect(planCounts([carriedDone, r({ id: 'n' })], 'S')).toEqual({ done: 1, total: 2 });
    expect(planCounts([r({ id: 'p', origin: 'carried' }), r({ id: 'n' })], 'S')).toEqual({ done: 0, total: 1 });
    expect(computeCounts([carriedDone, r({ id: 'n' })], CONTRACT, 'S')).toMatchObject({ done: 1, total: 2 });
  });
  test('R4: [verify completed, implement pending] reads implement; an in_progress row still wins', () => {
    const rows = [r({ id: 'v', status: 'completed', phase: 'verify' }), r({ id: 'i', phase: 'implement' })];
    expect(currentPhase(rows, null)).toEqual({ phase: 'implement', source: 'todo' });
    expect((todosMod as any).planPhase(rows, 'S')).toBe('implement');
    const withActive = [...rows, r({ id: 't', status: 'in_progress', phase: 'test' })];
    expect(currentPhase(withActive, null).phase).toBe('test');
  });
  test('R7: the groups-only count fallback scopes like planCounts: other sessions and pending carried rows leave, completed carried rows count', () => {
    const items = [
      r({ id: 'a', status: 'completed', phase: 'implement' }),
      r({ id: 'b', phase: 'implement' }),
      r({ id: 'other', session_id: 'older', phase: 'implement' }),
      r({ id: 'cp', origin: 'carried', phase: 'implement' }),
      r({ id: 'cd', origin: 'carried', status: 'completed', phase: 'implement' }),
    ];
    const withRows = { todos: items, todoGroups: groupTodos(items, CONTRACT, 'S'), sessionId: 'S' };
    const groupsOnly = { todos: [], todoGroups: withRows.todoGroups, sessionId: 'S' };
    expect(planCounts(items, 'S')).toEqual({ done: 2, total: 3 });
    expect((todosMod as any).todoCounts(groupsOnly)).toEqual((todosMod as any).todoCounts(withRows));
  });
});

describe('R8 plan rows written by `atlas_todo.py set` without --session', () => {
  // verbatim row shape of mirror(root, todos, '') (cmd set with no --session flag): origin session, session_id ''
  const setRow = (id: string, status: string) => ({
    id, content: `T ${id}`, status, owner: null, claimed_at: null, origin: 'session', session_id: '',
    created_at: 1, updated_at: 1, evidence: null, completed_at: null, archived: false,
  }) as unknown as TodoItem;
  const rows = [setRow('a', 'completed'), setRow('b', 'in_progress'), setRow('c', 'pending')];
  const dispatch = { ...setRow('d', 'pending'), origin: 'dispatch', session_id: 'S' } as unknown as TodoItem;
  test('R8: they survive readTodos, count, and render as groups next to dispatch rows', async () => {
    const { fs } = memFs(board([...rows, dispatch]));
    const { items } = await readTodos(fs, '/r', 'S', [], CONTRACT);
    expect(items.map(i => i.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(planCounts(items, 'S')).toEqual({ done: 1, total: 3 });
    expect(computeCounts(items, CONTRACT, 'S')).toMatchObject({ done: 1, total: 3 });
    const groups = groupTodos(items, CONTRACT, 'S');
    expect(groups.flatMap(g => g.items).filter(i => i.id !== 'd').length).toBe(3);
  });
});
