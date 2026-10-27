// The core row both harnesses draw: golden text, width bound, empty without data, and the /atlas-core report.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { coreGolden } from '../contracts/core-golden';
import { cellsText, cellsWidth, coreCells, coreReport, ratioText } from './core-row';
import { coreModel } from './data/core';

const model = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const trim = (s: string): string => s.replace(/\s+$/, '');

describe('core row', () => {
  test('golden text at 160 and 120 columns', () => {
    expect(trim(cellsText(coreCells(model, 160)))).toBe(coreGolden[160]);
    expect(trim(cellsText(coreCells(model, 120)))).toBe(coreGolden[120]);
  });
  test('empty without data', () => {
    expect(coreCells(null, 160)).toEqual([]);
    expect(coreCells(coreModel({ findings: '', teams: [], matrix: '', logs: {}, reports: [], todos: [], header: { ok: 0, total: 0 }, openGates: 0 }), 160)).toEqual([]);
  });
  test('never wider than the columns, 40 to 200', () => {
    for (let cols = 40; cols <= 200; cols++) expect(cellsWidth(coreCells(model, cols))).toBeLessThanOrEqual(cols);
  });
  test('chips lead each group', () => {
    const chips = coreCells(model, 160).filter((c) => c.chip).map((c) => c.t);
    expect(chips).toEqual(['CONTRACT', 'VERDICT', 'OFFLOAD', 'ROUTE']);
  });
});

describe('core report and status', () => {
  const report = coreReport(model);
  test('four sections with the refuted verdict, the 17.9k figure and the routes', () => {
    for (const head of ['CONTRACT', 'VERDICTS', 'OFFLOAD', 'ROUTE']) expect(report).toContain(head);
    expect(report).toMatch(/REFUTED {2}mean-iterable {2}calc\.mean does not accept iterators/);
    expect(report).toMatch(/verified {2}mean-fix/);
    expect(report).toContain('17.9k kept in tmux, 608 returned');
    expect(report).toContain('implementer-0278  claude-sonnet-5-5  peak 58.8k  kept 7.0k  returned 151  cost $0.16');
    expect(report).toContain('verify/low  gencheck');
    expect(report).toContain('1x verifier sonnet/medium  ran claude-sonnet-5-5');
    expect(report).not.toContain('DRIFT');
  });
  test('a drifted seat is listed', () => {
    const drifted = { ...model, routes: [{ ...model.routes[0]!, drift: ['implementer ran claude-opus-5-5, seat is sonnet'] }] };
    expect(coreReport(drifted)).toContain('DRIFT implementer ran claude-opus-5-5, seat is sonnet');
  });
  test('no data is one line', () => {
    expect(coreReport(null).split('\n')).toHaveLength(1);
    expect(coreReport(null)).toContain('no verdicts');
  });
  test('ratio text: one decimal under 10, none when null', () => {
    expect([ratioText(4.26), ratioText(29.5), ratioText(null)]).toEqual(['4.3x', '30x', '']);
  });
});
