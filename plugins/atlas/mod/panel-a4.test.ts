// A4 (critique 14): at 110 columns the pane is 37 cells. Route rows cut their titles (`T1 read alpha.py (alpha...`) while the title fits the
// pane without its state word, and the state word was jammed against the title (`T5 write the final summary done`). A title that does not
// fit beside its state word is drawn whole (its state on the row under it); the state column keeps a gap of two cells.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld } from '../contracts/panel-world';
import type { Ui } from './atlas-ui';
import { cells } from './atlas-ui';
import { coreModel, type CoreModel } from './data/core';
import { bodyLines, lineText, panelText, type PanelTodo } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const LIVE: PanelTodo[] = [
  { id: 't1', label: 'T1 read alpha.py (alpha-explorer)', state: 'done' },
  { id: 't2', label: 'T2 read beta.py (beta-explorer)', state: 'done' },
  { id: 't3', label: 'T3 read gamma.py (gamma-explorer)', state: 'done' },
  { id: 't4', label: 'T4 combine the three reports', state: 'done' },
  { id: 't5', label: 'T5 write the final summary', state: 'done' },
];
const route = (cols: number, todos: PanelTodo[] = LIVE): string[] => bodyLines(panelWorld('route', cols, ui, { todos, workers: [], phase: 'done' })).map((l) => lineText(l));

describe('A4: route rows at the 110-column pane', () => {
  for (const cols of [37, 38, 43]) {
    test(`pane ${cols}: one row per task, the task text is cut with an ellipsis and the owner's name never is, no row wraps or overflows`, () => {
      const rows = route(cols);
      const tasks = rows.filter((r) => /T\d /.test(r));
      expect(tasks).toHaveLength(5); // never a second row for a title or a state (critique 26: no wrapped row)
      for (const t of LIVE.slice(0, 3)) expect(rows.join('\n')).toContain(`(${t.label.match(/\((.*)\)/)![1]})`); // the agent's name, whole, on every owned row
      expect(rows.join('\n')).not.toContain('...');
      for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(cols);
      for (const r of tasks) expect(r).toMatch(/\S +done\s*$/); // the state word closes the same row
      expect(rows.filter((r) => /^\s+done\s*$/.test(r))).toHaveLength(0); // the state is never a row of its own (critique 15 C2)
    });
  }
  test('a pane with room keeps one row per task (nothing moves to a second row)', () => {
    const rows = route(80);
    expect(rows.filter((r) => /T\d /.test(r))).toHaveLength(5);
    expect(rows.filter((r) => /^\s+done\s*$/.test(r))).toHaveLength(0);
  });
  test('a title longer than the pane is cut with an ellipsis on its one row, the state beside it', () => {
    const long: PanelTodo = { id: 'x', label: 'T9 reconcile the schema drift report against the migration plan', state: 'running' };
    const rows = route(37, [long]);
    const task = rows.filter((r) => /T9 /.test(r));
    expect(task).toHaveLength(1);
    expect(task[0]).toMatch(/…\s+running\s*$/);
    for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(37);
  });
});

// Core at the 110-column pane (live-110-61858003-3/tab-core.png): `5 done withou...`, `0 verified fi...`, `3 workers returned, no token` over `figures kept`,
// `planned audit team (low effort)...`. Nothing is cut with `...`; a figure that does not fit its row goes to a row under it on purpose.
describe('A4: core rows at the 110-column pane', () => {
  const base: CoreModel = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
  const planDone = Array.from({ length: 5 }, (_, i) => ({ id: `t${i + 1}`, label: `T${i + 1}`, state: 'done' as const, evidence: null }));
  const c = JSON.parse(JSON.stringify(base)) as CoreModel;
  c.verdicts = []; c.claims = []; c.offload = { workers: [], kept: 0, returned: 0, ratio: null } as never;
  c.ledger = { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 } as never;
  c.contract = { ...c.contract, evidence: { ok: 0, total: 5 }, verifiedDone: { ok: 0, total: 5 } };
  c.routes = [{ teamId: 'in-process:audit/low', name: 'in-process', cls: 'audit', effort: 'low', isolation: '', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }] as never;
  const done3 = ['alpha', 'beta', 'gamma'].map((n) => ({ name: `${n}-explorer`, state: 'done' as const, detail: 'read x.py', secs: 9 }));
  for (const cols of [37, 38]) {
    test(`pane ${cols}: no row is cut with ..., none is wider than the pane, every sentence is whole`, () => {
      const rows = panelText(panelWorld('core', cols, ui, { rows: 40, core: c, todos: planDone, workers: done3 }));
      const text = rows.join('\n');
      expect(text).not.toContain('...');
      for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(cols);
      const flat = text.replace(/\s+/g, ' ');
      for (const phrase of ['5 done without evidence', '0 verified findings so far', '3 explorers ran, the plan said 1']) expect(flat).toContain(phrase);
      expect(flat).toMatch(/reading 3 workers finished/); // critique 19 C4: no `token count not kept` filler
    });
    test(`pane ${cols}: a figure that does not fit beside its label goes under it, indented, not clipped`, () => {
      const rows = panelText(panelWorld('core', cols, ui, { rows: 40, core: c, todos: planDone, workers: done3 }));
      const at = rows.findIndex((r) => /evidence +0\/5/.test(r));
      expect(rows[at]).not.toMatch(/without/);
      expect(rows[at + 1]).toMatch(/^ {4}5 done without evidence\s*$/);
    });
  }
  test('pane 37: verdict titles are whole on the row under their verdict, not cut with ...', () => {
    const rows = panelText(panelWorld('core', 37, ui, { rows: 40, core: base, workers: done3 }));
    const flat = rows.join(' ').replace(/\s+/g, ' ');
    expect(flat).toContain('calc.mean fixed for [2,4,6],[],[1,2],[5]; unittest passes');
    expect(flat).toContain('calc.mean does not accept iterators; mean(iter([1,2,3])) raises TypeError');
    expect(rows.join('\n')).not.toContain('...');
    for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(37);
  });
});
