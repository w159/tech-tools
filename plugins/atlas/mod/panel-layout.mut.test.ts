// Mutation-kill tests for panel-layout.ts (seed 1105 survivors): section headings are bold, the contract figure is plain only when
// the tally is whole, and the offload model column holds 12 cells.
//
// Equivalent mutants (no test can tell them apart):
//  - gatesRow `return null` -> `return undefined` (line 217): its one caller (routeBody) only asks `if (gates)`, which null and
//    undefined answer alike.
//  - offloadRows model `clip(.., 12)` -> `clip(.., 13)` (line 540): the text goes only into the word column (wordW 12), and
//    gridRow clips it again to wordW (atlas-ui.ts:278), so a 13-cell clip shows the same cells. The test below pins the shown text.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import type { Ui } from './atlas-ui';
import type { CoreModel } from './data/core';
import { bodyLines, headerRows, type PanelModel } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const core = (over: Partial<CoreModel> = {}): CoreModel => ({
  contract: { header: { ok: 0, total: 0 }, evidence: { ok: 0, total: 0 }, openGates: 0, verifiedDone: { ok: 0, total: 0 } },
  verdicts: [], claims: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 },
  offload: { workers: [], kept: 0, returned: 0, ratio: null }, routes: [{ teamId: 't1', name: 't1', cls: 'fix', effort: 'low', isolation: 'shared', maxParallel: 1, seats: [], drift: [], transport: 'tmux' }], ...over,
} as unknown as CoreModel);
const runs = (c: CoreModel, cols = 120, over: Partial<PanelModel> = {}) => bodyLines(panelWorld('core', cols, mocha, { core: c, ...over })).flatMap((l) => l.runs);

describe('core headings', () => {
  test('contract and dispatch titles are bold', () => {
    const rs = runs(core());
    expect(rs.find((x) => x.t === '    contract')?.bold).toBe(true);
    expect(rs.find((x) => x.t === '    teams')?.bold).toBe(true);
  });
});

describe('contract figures: tone by tally', () => {
  const tone = (ok: number, total: number): string | undefined => {
    const c = core({ contract: { header: { ok: 0, total: 0 }, evidence: { ok, total }, openGates: 0, verifiedDone: { ok: 0, total: 0 } } as never });
    const word = total ? `${ok}/${panelWorld('core', 120, mocha).todos.length}` : 'none yet'; // the figure is over the plan, the tone over the done items
    return runs(c).find((x) => x.t.trim() === word)?.tone;
  };
  test('a whole tally reads plain, a short one warns, an empty one is muted', () => {
    expect(tone(3, 3)).toBe('text');
    expect(tone(2, 3)).toBe('warn');
    expect(tone(0, 0)).toBe('muted');
  });
});

describe('gates tab: the first fix or detail stays on the group row once it fits whole', () => {
  const failing = { id: 'lint', title: 'lint', lines: [{ id: 'l1', label: 'style', ok: false, fix: 'run the formatter now' }, { id: 'l2', label: 'types', ok: true }] };
  const passing = { id: 'docs', title: 'docs', lines: [{ id: 'd1', label: 'links', ok: true, detail: 'all links resolve fine' }] };
  /** Every panel width draws the whole `tail`, on the group row or wrapped under it, and the group row holds it from `from` on. */
  const wholeAt = (g: unknown, title: string, tail: string, from: number): void => {
    for (let cols = 30; cols <= 160; cols++) {
      const rows = bodyLines(panelWorld('gates', cols, mocha, { gates: [g] as never })).map((l) => l.runs.map((x) => x.t).join(''));
      expect([cols, rows.some((t) => t.includes(tail))]).toEqual([cols, true]);
      expect([cols, rows.some((t) => t.includes(title) && t.includes(tail))]).toEqual([cols, cols >= from]);
    }
  };
  test('a failing group (with its green count) holds the first fix', () => {
    wholeAt(failing, 'lint', 'run the formatter now', 49); // `1/2 green` is three cells shorter than `1 of 2 green` (critique 12 B3)
  });
  test('a passing group never carries a check\'s detail: it stays with its own row (critique 6, label and value apart)', () => {
    for (let cols = 30; cols <= 160; cols++) {
      const rows = bodyLines(panelWorld('gates', cols, mocha, { gates: [passing] as never })).map((l) => l.runs.map((x) => x.t).join(''));
      expect([cols, rows.some((t) => t.includes('docs') && t.includes('all links'))]).toEqual([cols, false]);
    }
  });
});

describe('offload model column', () => {
  const worker = (model: string | null) => ({ name: 'wk', role: 'runner', model, brief: 10, peak: 20, kept: 30, returned: 5, costUsd: 0.5, finished: true });
  const lineOf = (model: string | null): string =>
    bodyLines(panelWorld('core', 120, mocha, { core: core({ offload: { workers: [worker(model)], kept: 30, returned: 5, ratio: 0.17 } as never }) }))
      .map((l) => l.runs.map((x) => x.t).join('')).find((t) => t.includes('wk '))!;
  test('a model name over 12 cells is cut to 12 with an ellipsis, 12 or fewer stands whole', () => {
    expect(lineOf('claude-abcdefghijklmnopq')).toContain('abcdefghi...');
    expect(lineOf('claude-abcdefghijkl')).toContain('abcdefghijkl');
    expect(lineOf('claude-abcdefghijkl')).not.toContain('...');
    expect(lineOf(null)).toContain('?');
  });
});

describe('dispatch rows: the in-process note wraps four cells inside the panel', () => {
  test('at 30 columns the note breaks at 26 cells', () => {
    const c = core({ inProcess: false } as never);
    const lines = bodyLines(panelWorld('core', 30, mocha, { core: c })).map((l) => l.runs.map((x) => x.t).join('').trim());
    const at = lines.findIndex((t) => t.startsWith('in-process'));
    expect(lines.slice(at, at + 2)).toEqual(['in-process dispatches are', 'not shown here']);
  });
});

describe('headerRows: the blank before the body starts at exactly 100 columns', () => {
  const text = (cols: number): string[] => headerRows(panelWorld('route', cols, mocha, {})).map((l) => l.runs.map((x) => x.t).join(''));
  test('99 columns end on the tab rule, 100 add a blank row after it', () => {
    const narrow = text(99);
    const wide = text(100);
    expect(wide.length).toBe(narrow.length + 1);
    expect(narrow[narrow.length - 1]!.trim()).not.toBe('');
    expect(wide[wide.length - 1]!.trim()).toBe('');
  });
});

describe('routeBody: a long task title is cut to the width less 60 from 100 columns', () => {
  const titleCells = (cols: number): number => {
    const todos = [{ id: 't1', label: 'q'.repeat(100), state: 'queued', owner: undefined, detail: undefined, evidence: null }];
    const rows = bodyLines(panelWorld('route', cols, mocha, { todos: todos as never, workers: [] })).map((l) => l.runs.map((x) => x.t).join(''));
    return (rows.find((t) => t.includes('qqq'))!.match(/q+\S*/) ?? [''])[0]!.length;
  };
  test('at 120 columns the title column is 60 cells, at 160 the whole 100 cell title shows', () => {
    expect(titleCells(120)).toBe(60);
    expect(titleCells(160)).toBe(100);
  });
});
