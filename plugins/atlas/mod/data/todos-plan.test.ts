// 17.28.0: the Atlas TODO block read `plan rows appear here` in the tech-tools repo while the board held the plan.
// Probe over the real .atlas/.run/todos.json (2 039 470 bytes, 2812 rows, session 3f25ef76): readTodos 22 -> ownTodos 10
// -> planBasis 10 -> ownPlan 10 -> HUD (ownTodos + isPlanItem) 10. The selection never dropped to zero and the host read cap
// ($.fs.read 4 MiB) is above the board's size. The rows vanished upstream: hooks/test_atlas_contract.py boots session_boot.py
// with session_id `contract` against the real repo, and carry_over re-stamps every open row of another session to that id
// (origin carried); ownRow then rightly leaves them out. These tests pin the real shape so the selection stays correct.
import { describe, expect, test } from 'claude-code/testing';
import type { Contract, FsLike, TodoItem } from '../contract';
import { isPlanItem, ownPlan, ownTodos, planBasis, planCounts, readTodos } from './todos';

const CONTRACT: Contract = {
  phases: [],
  todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'],
  headerFirstLinePattern: '',
  itemPhasePrefix: '[<phase>] ',
};
const PATH = '/r/.atlas/.run/todos.json';
const SID = '3f25ef76-c6ea-4b61-906d-60dca7d35456';

function memFs(text: string): FsLike {
  return {
    async read(p) { if (p !== PATH) throw new Error('ENOENT'); return text; },
    async stat(p) { return p === PATH ? { size: text.length, mtimeMs: 1 } : undefined; },
    async exists(p) { return p === PATH; },
    async list() { return []; },
  };
}

type Row = TodoItem & { created_at?: number; archived_reason?: string };
const row = (i: number, over: Partial<Row>): Row => ({
  id: `r${i}`, content: `[implement] backlog row ${i} ${'x'.repeat(1600)}`, status: 'pending', session_id: 'contract', origin: 'carried',
  carries: 6, created_at: 1_763_000_000 + i, updated_at: 1_763_000_000 + i, ...over,
});

/** The real board's shape, trimmed: hundreds of foreign rows (archived-in-place contract and empty-session rows, live carried
 * contract rows, other sessions' completed and advisor rows) around the session's own TodoWrite rows. */
function realShape(): Row[] {
  const foreign: Row[] = [
    ...Array.from({ length: 300 }, (_, i) => row(i, { archived: true, archived_reason: 'carry_expired' })),
    ...Array.from({ length: 120 }, (_, i) => row(300 + i, { session_id: '', archived: true })),
    ...Array.from({ length: 130 }, (_, i) => row(500 + i, {})), // carried to `contract` and still open
    ...Array.from({ length: 200 }, (_, i) => row(700 + i, { session_id: '01a122d2-7', origin: 'advisor', status: 'completed', archived: true })),
    row(950, { session_id: 'other', origin: 'session', status: 'in_progress' }),
  ];
  const own: Row[] = [
    row(1000, { session_id: SID, origin: 'session', status: 'completed', content: 'Root causes mapped' }),
    ...['routing', 'panel', 'agents', 'todo', 'settings'].map((w, i) => row(1001 + i, { session_id: SID, origin: 'session', status: 'in_progress', content: `${w}: fix` })),
    ...['docs', 'push', 'ssh'].map((w, i) => row(1010 + i, { session_id: SID, origin: 'session', status: 'pending', content: `${w}: next` })),
  ];
  return [...foreign.slice(0, 400), ...own, ...foreign.slice(400)];
}

describe('plan on a large board with foreign pending rows', () => {
  test('a board past 1 MB is read whole, and the HUD selection keeps exactly the session rows', async () => {
    const text = JSON.stringify({ version: 1, items: realShape() });
    expect(text.length).toBeGreaterThan(1_000_000);
    const { items, error } = await readTodos(memFs(text), '/r', SID, [], CONTRACT);
    expect(error).toBeUndefined();
    const own = ownTodos(items, SID);
    const hud = own.filter(isPlanItem); // register.ts hudIn + hud.ts surfaces
    expect(hud.map((r) => r.id)).toEqual(['r1000', 'r1001', 'r1002', 'r1003', 'r1004', 'r1005', 'r1010', 'r1011', 'r1012']);
    expect(ownPlan(items, SID).length).toBe(9);
    expect(planBasis(items, SID).length).toBe(9);
    expect(planCounts(items, SID)).toEqual({ done: 1, total: 9 });
  });

  test('rows a boot under another session id carried away leave the plan: the loss is the carry, not the selection', async () => {
    // What carry_over(root, 'contract') does to the session's open rows (session_id re-stamped, origin carried, status pending).
    const stolen = realShape().map((r) => (r.session_id === SID && r.status !== 'completed'
      ? { ...r, session_id: 'contract', origin: 'carried', status: 'pending' } : r));
    const { items } = await readTodos(memFs(JSON.stringify({ version: 1, items: stolen })), '/r', SID, [], CONTRACT);
    expect(ownPlan(items, SID).map((r) => r.id)).toEqual(['r1000']);
  });
});
