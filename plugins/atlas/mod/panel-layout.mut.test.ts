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
import { bodyLines, type PanelModel } from './panel-layout';

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
    expect(rs.find((x) => x.t === 'contract')?.bold).toBe(true);
    expect(rs.find((x) => x.t === 'dispatch')?.bold).toBe(true);
  });
});

describe('contract figures: tone by tally', () => {
  const tone = (ok: number, total: number): string | undefined => {
    const c = core({ contract: { header: { ok, total }, evidence: { ok: 0, total: 0 }, openGates: 0, verifiedDone: { ok: 0, total: 0 } } as never });
    const word = total ? `${ok} of ${total}` : 'none yet';
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
  test('a failing group (with its failing count) and a passing group (without a value)', () => {
    wholeAt(failing, 'lint', 'run the formatter now', 54);
    wholeAt(passing, 'docs', 'all links resolve fine', 40);
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
