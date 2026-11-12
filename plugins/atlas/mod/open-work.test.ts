// Critique 9, slice A: one open-work truth. The Board fold never hides an open dispatch row (A2), and the core tab's counts, the band's
// plan count and Stop's open-item count are stated from one store (A3; the python half is hooks/test_atlas_gates.py on the same fixture).
import { describe, expect, test } from 'claude-code/testing';
import store_fx from '../contracts/open-work-store.json';
import { runsString, type Ui } from './atlas-ui';
import { boardFolded, boardLines, boardOpenFolded, boardRowsOf, boardText } from './board-model';
import { coreModel, openWork } from './data/core';
import { ownTodos, planCounts, settleDispatch } from './data/todos';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const SESSION = 'adc00375';
type Row = { id: string; content: string; status: string; owner?: string; origin?: string; session_id?: string; evidence?: string | null; archived?: boolean };
const fx = store_fx as unknown as { expect: { open: number; evidence: { ok: number; total: number }; plan: { done: number; total: number } }; items: Row[] };
const store = (gamma = 'pending'): Row[] => fx.items.map((i) => ({ ...JSON.parse(JSON.stringify(i).replace('"SESSION"', JSON.stringify(SESSION))), ...(i.id === 't56c769ef' ? { status: gamma } : {}) }) as Row);
const input = (todos: Row[]) => ({ findings: '', reports: [], logs: {}, teams: [], matrix: '', todos, header: { ok: 0, total: 0 }, openGates: 0 }) as never;

describe('A2: the Board fold never hides an open row', () => {
  const asBoard = (rows: Row[]) => rows.map((r) => ({ content: r.content, status: r.status, ...(r.owner ? { owner: r.owner } : {}), ...(r.origin ? { origin: r.origin } : {}), ...(r.evidence ? { evidence: r.evidence } : {}) }));
  test('critique 15 B5: all five plan rows done, the gamma dispatch row open: the open row is unfolded as its own row with its owner, so the board lists 6 items', () => {
    const items = asBoard(ownTodos(store(), SESSION));
    expect(boardFolded(items)).toBe(2); // the two closed dispatch rows fold; the open one does not
    expect(boardOpenFolded(items)).toBe(0);
    const rows = boardRowsOf(items);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'queued']);
    expect(rows[5]!.owner).toBe('gamma-explorer');
    const text = boardText(boardLines(rows, { cols: 80, ui, folded: boardFolded(items), openFolded: boardOpenFolded(items) }));
    expect(text.join('\n')).toContain('gamma-explorer');
    expect(text.at(-1)).toBe('  2 dispatches folded');
  });
  test('the agent ended but the store row is open (settled to ended): its own row reads returned, never done', () => {
    const items = asBoard(settleDispatch(ownTodos(store(), SESSION), { 'gamma-explorer': 'done' }));
    const rows = boardRowsOf(items);
    expect(rows[5]!.word).toBe('returned');
    expect(rows[5]!.state).not.toBe('done');
    expect(rows[2]!.state).toBe('done');
  });
  test('every dispatch row closed: the quiet fold footer, all rows done', () => {
    const items = asBoard(ownTodos(store('completed'), SESSION));
    expect(boardOpenFolded(items)).toBe(0);
    expect(boardRowsOf(items).every((r) => r.state === 'done')).toBe(true);
    expect(boardText(boardLines(boardRowsOf(items), { cols: 80, ui, folded: 3, openFolded: 0 })).at(-1)).toBe('  3 dispatches folded');
  });
});

describe('A3: one store, one open-work rule', () => {
  test('openWork is Stop\'s count; the core tab and the plan count state the same store', () => {
    const todos = store();
    expect(openWork(todos, SESSION)).toBe(fx.expect.open);
    const m = coreModel(input(todos));
    expect(m.contract.evidence).toEqual(fx.expect.evidence); // `evidence 0 of 5`: the gates row states 0 of 5 from the same store
    expect(m.contract.open).toBe(fx.expect.open);
    expect(planCounts(todos, SESSION)).toEqual(fx.expect.plan); // the band's `todo 5/5` counts the plan; the open dispatch row is the 1 beyond it
    expect(openWork(todos, SESSION) - (planCounts(todos, SESSION).total - planCounts(todos, SESSION).done)).toBe(1);
    expect(runsString([{ t: String(openWork(store('completed'), SESSION)), tone: 'text' }])).toBe('0');
  });
  test('openWork leaves out manual notes, archived rows and other sessions\' rows, like Stop', () => {
    const extra: Row[] = [
      { id: 'm', content: 'human note', status: 'pending', origin: 'manual', session_id: SESSION },
      { id: 'a', content: 'old', status: 'pending', origin: 'session', session_id: SESSION, archived: true },
      { id: 'o', content: 'elsewhere', status: 'pending', origin: 'session', session_id: 'other' },
    ];
    expect(openWork([...store(), ...extra], SESSION)).toBe(1);
  });
});
