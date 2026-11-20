// Wave 24, slice C: the side panel's board, team, channel, gates and core tabs, and the transcript cards. One test for each visible rule that moved.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../../../contracts/core-fixture';
import { panelWorld } from '../../../contracts/panel-world';
import { cells, DONE_DOUBT, type Ui } from '../../design/atlas-ui';
import { boardLines, boardRibbon, boardSummary, boardText, boardTimeline, clipE, type BoardRow } from '../board/board-model';
import { coreModel, type CoreModel } from '../../data/core';
import { bodyLines, lineText, panelText, verifiedFigure, type PanelModel, type PanelTab } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const core0: CoreModel = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const body = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}): string[] => bodyLines(panelWorld(t, cols, mocha, { rows: 40, ...over })).map((l) => lineText(l).trimEnd());

const item = (n: number, over: Partial<BoardRow> = {}): BoardRow => ({ label: `T${n} read module ${n}`, state: 'done', owner: `explorer-${n}`, detail: '', ...over });
const five = [1, 2, 3, 4, 5].map((n) => item(n));
const dispatchRows = [6, 7, 8].map((n) => item(n, { dispatch: true, label: `dispatch ${n}` }));
const pane = (rows: BoardRow[], cols: number, over: Partial<Parameters<typeof boardLines>[1]> = {}): string[] =>
  boardText(boardLines(rows, { cols, ui: mocha, pane: true, ribbon: false, title: false, ...over }));

describe('board (step 1)', () => {
  test('the summary reads `5 items · 3 dispatches` with a ▰▱ meter on the right edge', () => {
    for (const cols of [50, 37]) {
      const head = pane([...five, ...dispatchRows], cols, { dispatches: 3 })[0]!;
      expect([cols, head]).toEqual([cols, expect.stringMatching(/^ {2}5 items · 3 dispatches +[▰▱]{4,10}$/)]);
      expect(cells(head)).toBeLessThanOrEqual(cols - 1);
    }
  });
  test('the meter fills with the items done and never counts a dispatch row', () => {
    const half = [item(1), item(2), item(3, { state: 'running' }), item(4, { state: 'queued' })];
    const head = pane([...half, ...dispatchRows], 50, { dispatches: 3 })[0]!;
    expect(head).toMatch(/^ {2}4 items · 3 dispatches +▰{4}▱{4}$/);
    expect(boardSummary([...half, ...dispatchRows])).toEqual({ items: 4, dispatches: 3, done: 2 });
  });
  test('the owner sits in one right-hand column on every row and never wraps onto a second line', () => {
    const rows = [item(1, { owner: 'alpha' }), item(2, { owner: 'ghost-explorer', state: 'running' }), item(3, { owner: 'a-very-long-owner-name-that-cannot-fit', state: 'queued' })];
    for (const cols of [50]) { // titles first (critique 22): a pane too narrow for the widest title and an owner drops the owner column, it never cuts the title
      const out = pane(rows, cols);
      const rowsOnly = out.slice(2, 5); // the summary, a blank, then one line per item
      expect(rowsOnly).toHaveLength(3);
      const at = rowsOnly.map((l) => l.search(/ (alpha|ghost|a-very)/));
      expect(at.every((n) => n > 0)).toBe(true);
      expect(new Set(at).size).toBe(1);
      for (const l of rowsOnly) expect(cells(l)).toBeLessThanOrEqual(cols - 1);
      expect(rowsOnly[2]).toContain('…'); // a long owner is cut with one ellipsis
      expect(out.join('\n')).not.toContain('...');
    }
  });
  test('a plan that is all done adds no closing line (wave 32, critique 30: `closed · 5 of 5 items done` repeated the summary row)', () => {
    expect(pane(five, 50).join('\n')).not.toMatch(/closed|of 5 items done/);
    expect(pane(five, 50).at(-1)).toMatch(/T5/);
  });
  test('the counts match the tab everywhere: a dispatch row is never an item (5, not 8)', () => {
    const rows = [...five, ...dispatchRows];
    expect(boardRibbon(rows).right).toBe('5 items');
    expect(pane(rows, 50)[0]).toContain('5 items');
    expect(pane(rows, 50, { dispatches: 3 }).join('\n')).not.toMatch(/\b8 items\b/);
  });
  test('an empty board is one dim line, nothing else', () => {
    expect(pane([], 50)).toEqual([]);
  });
});

describe('team tab (step 2)', () => {
  const workers = [
    { name: 'alpha', role: 'explorer', state: 'running' as const, secs: 42, detail: 'read a.py' },
    { name: 'ghost-explorer', role: 'explorer', state: 'failed' as const, secs: 135, detail: 'worker killed' },
    { name: 'beta', role: 'verifier', state: 'done' as const, secs: 3700, detail: 'verified' },
    { name: 'gamma', role: 'runner', state: 'queued' as const, secs: 5, detail: 'waits' },
  ];
  test('a name that is its own role leaves the role column blank instead of saying it twice', () => {
    const out = body('team', 80, { workers: [{ name: 'implementer-band', role: 'implementer', state: 'running' as const, secs: 9, detail: '' }], mates: [] });
    expect(out.find((l) => l.includes('implementer-band'))).not.toMatch(/implementer-band +implementer/);
  });
});

describe('channel tab (step 3)', () => {
  const note = (over: Partial<PanelModel['notes'][number]> = {}): PanelModel['notes'][number] => ({ at: '10:02', from: 'lead', text: 'hello', ...over });
});

describe('gates and core agree (step 4)', () => {
  const core = JSON.parse(JSON.stringify(core0)) as CoreModel;
  core.contract.evidence = { ok: 8, total: 8 };
  core.contract.verifiedDone = { ok: 0, total: 8 };
  const todos = [1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, label: `T${i}`, state: 'done' as const }));
  const gates = (b: boolean) => [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'a', label: 'Evidence captured', ok: true }, { id: 'b', label: 'Verified finding recorded', ok: b }] }];
  test('one source for the verified figure: the plan items, never the 8 rows the dispatches add', () => {
    expect(verifiedFigure({ core, todos, gates: gates(false) })).toEqual({ ok: 0, total: 5, waived: false });
    expect(verifiedFigure({ core, todos, gates: gates(true) })).toEqual({ ok: 0, total: 5, waived: true });
    expect(verifiedFigure({ core: undefined, todos, gates: gates(true) })).toBeNull();
  });
  test('the core tab reads 5 of 5 / evidence 5/5, never 8 against a 5-item plan', () => {
    const out = body('core', 120, { core, todos, gates: gates(false) }).join('\n');
    expect(out).toMatch(/done items +5 of 5/);
    expect(out).toMatch(/evidence +5\/5/);
    expect(out).toMatch(/verified +0\/5/);
    expect(out).not.toMatch(/\b8\b/);
  });
  test('the dispatch route says the over-run once: the heading carries the count, the seat line only the plan', () => {
    const c = JSON.parse(JSON.stringify(core0)) as CoreModel;
    c.routes = [{ teamId: 't1', name: 'audit', cls: 'audit', effort: 'low', isolation: 'shared', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
    const out = panelText(panelWorld('core', 150, mocha, { core: c, rows: 40 })).join('\n');
    expect(out.match(/3 explorers ran, the plan said 1/g)).toHaveLength(1);
    expect(out).not.toMatch(/3 explorers +too many/);
    expect(out).toMatch(/\n +planned on haiku, low effort/);
  });
});

describe('truncation (step 5)', () => {
  test('a cut is one `…`, never the ASCII `...`, and the result is exactly n cells', () => {
    expect(clipE('abcdefghij', 6)).toBe('abcde…');
    expect(cells(clipE('abcdefghij', 6))).toBe(6);
    expect(clipE('abc', 6)).toBe('abc');
    expect(clipE('abcdefghij', 1)).toBe('…');
  });
  test('no panel tab at any width draws an ASCII `...`', () => {
    for (const tab of ['route', 'team', 'channel', 'gates', 'core'] as PanelTab[]) for (const cols of [120, 80, 56, 37]) {
      expect([tab, cols, panelText(panelWorld(tab, cols, mocha, { core: core0, rows: 40 })).join('\n').includes('...')]).toEqual([tab, cols, false]);
    }
  });
});
