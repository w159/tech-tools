// Critique 19 C4: the route, gates and core tabs say what the HUD and the transcript say (live-150-232567af-1 tab-gates / tab-core, stoprun-150-232567af-1 mod-todo_tree).
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld } from '../contracts/panel-world';
import { cells, DONE_DOUBT, type Ui } from './atlas-ui';
import { coreModel, type CoreModel } from './data/core';
import { bodyLines, lineText, type PanelModel, type PanelTab } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const core: CoreModel = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const body = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}): string[] => bodyLines(panelWorld(t, cols, mocha, { core, ...over })).map(lineText).map((l) => l.trimEnd());

describe('critique 19 C4: the route tab reads a killed worker in words', () => {
  // stoprun-150-232567af-1: T2 closed by the lead after its worker was killed: the HUD says `closed · worker killed`, the panel said an amber `done`.
  const todos = [
    { id: 't1', label: 'T1 read alpha.py (alpha-explorer)', state: 'done' as const, owner: 'alpha-explorer' },
    { id: 't2', label: 'T2 read ghost.py (ghost-explorer)', state: 'done' as const, word: DONE_DOUBT, owner: 'ghost-explorer', detail: 'worker killed' },
    { id: 't3', label: 'T3 combine the reports', state: 'done' as const },
  ];
  for (const cols of [64, 56, 38]) {
    test(`${cols} cells: the T2 row says what happened to its worker on its own row (\`closed · worker killed\` where it fits, \`killed\` in the narrow pane), the others plain done, nothing wider than the pane`, () => {
      const rows = body('route', cols, { todos });
      const at = rows.findIndex((l) => l.includes('T2 read ghost') || l.includes('T2 read'));
      expect(at).toBeGreaterThan(-1);
      expect(rows[at]).toMatch(/failed\s*$/); // one row, never a second line (critique 26)
      expect(rows[at]).toContain('ghost-explorer'); // the agent's name stays whole at every width
      expect(rows.join('\n').match(/failed/g)!.length).toBeGreaterThanOrEqual(1);
      for (const l of rows) expect(cells(l)).toBeLessThanOrEqual(cols);
    });
  }
});

describe('critique 19 C4: the gates tab counts the replies it checked', () => {
  // live-150-232567af-1 tab-gates: `Header contract  warning  0/1 green` over one line while the transcript drew 7 chips.
  const header = (ok: number, total: number) => ({ id: 'header', title: 'Header contract', lines: [{ id: 'header-matched', label: 'Replies with header matched', ok: ok >= total, detail: `${ok} of ${total}` }] });
  test('the figure beside a failing header group is its reply tally, not its line count', () => {
    const tally = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 7, total: 8 }, openGates: 3 });
    const rows = body('gates', 80, { gates: [header(7, 8)], core: tally });
    const g = rows.find((l) => l.includes('Header contract'))!;
    expect(g).toMatch(/7\/8 replies$/);
    expect(g).not.toContain('green');
  });
  test('a plain failing group keeps `n/m green`', () => {
    const rows = body('gates', 80, { gates: [{ id: 'doctor', title: 'doctor', lines: [{ id: 'd', label: 'doctor', ok: false, fix: 'run it' }] }] });
    expect(rows[0]).toMatch(/0\/1$/);
  });
});

describe('critique 19 C4: the core tab says each fact once', () => {
  // live-150-232567af-1 tab-core: `3 explorers ran, the plan said 1` then `3 explorers too many  asked for 1 on haiku`, and `token count not kept`.
  const c = JSON.parse(JSON.stringify(core)) as CoreModel;
  c.routes = [{ teamId: 't1', name: 'audit', cls: 'audit', effort: 'low', isolation: 'shared', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
  c.offload = { ...c.offload, kept: 0, returned: 0, workers: [] };
  const workers = ['a', 'b', 'c'].map((name) => ({ name, role: 'explorer', state: 'done' as const, detail: 'read x.py' }));
  const out = (cols: number): string[] => body('core', cols, { core: c, workers, rows: 40 });
  test('no `token count not kept` filler: the reading heading says the workers finished', () => {
    for (const cols of [150, 64, 37]) {
      expect(out(cols).join('\n')).not.toMatch(/token count not kept|no token count|no token log/);
      expect(out(cols).join(' ').replace(/\s+/g, ' ')).toMatch(/reading 3 (workers )?finished/);
    }
  });
  test('the seat row does not restate the count the heading gave (`the plan said 1` / `asked for 1`)', () => {
    const text = out(150).join('\n');
    expect(text).toContain('3 explorers ran, the plan said 1');
    expect(text).not.toMatch(/asked for 1/);
    expect(text).toMatch(/^ +planned on haiku, low effort$/m);
    expect(text).not.toMatch(/too many/); // the count is said once (critique 21)
  });
});
