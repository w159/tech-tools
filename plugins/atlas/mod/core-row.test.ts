// The core row both harnesses draw: golden text, width bound, empty without data, and the /atlas-core report.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { coreGolden } from '../contracts/core-golden';
import { cellsText, cellsWidth, coreCells, coreReport, ratioText } from './core-row';
import { coreModel, type CoreModel } from './data/core';

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

// ---- hand-built models: tones, plurals, widening order, report lines (mutation-driven) ----
const blank = (): CoreModel => ({
  contract: { header: { ok: 0, total: 0 }, evidence: { ok: 0, total: 0 }, verifiedDone: { ok: 0, total: 0 }, openGates: 0 },
  verdicts: [], claims: [],
  ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 },
  offload: { workers: [], kept: 0, returned: 0, ratio: null },
  routes: [],
});
const route = (over: Record<string, unknown> = {}) =>
  ({ teamId: 't1', name: 'meanfix', cls: 'fix', effort: 'low', isolation: 'shared', maxParallel: 1, seats: [], drift: [], ...over });
const seat = (over: Record<string, unknown> = {}) => ({ role: 'implementer', count: 1, model: 'sonnet', effort: 'medium', ran: [], ...over });
const worker = (name: string, over: Record<string, unknown> = {}) =>
  ({ name, role: 'implementer', model: 'claude-sonnet-5-5', brief: 0, peak: 58_800, kept: 7_000, returned: 151, costUsd: 0.159, finished: true, ...over });
const hueOf = (cells: ReturnType<typeof coreCells>, text: string) => cells.find((x) => x.t === text)?.hue;

describe('core row cells', () => {
  test('ratio: exactly 10 rounds, below 10 keeps a decimal', () => {
    expect([ratioText(10), ratioText(9.96), ratioText(9.94), ratioText(0)]).toEqual(['10x', '10.0x', '9.9x', '0.0x']);
  });
  test('cellsWidth counts chips with their padding and starts from zero', () => {
    expect(cellsWidth([])).toBe(0);
    expect(cellsWidth([{ t: 'ab', hue: 'text' }])).toBe(2);
    expect(cellsWidth([{ t: 'ab', hue: 'text' }, { t: 'XY', hue: 'red', chip: true }])).toBe(6);
    expect(cellsText([{ t: 'ab', hue: 'text' }, { t: 'XY', hue: 'red', chip: true }])).toBe('ab XY ');
  });
  test('contract tallies are muted when empty, green when complete, yellow when partial', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.contract = { header: { ok: 0, total: 0 }, evidence: { ok: 2, total: 2 }, verifiedDone: { ok: 0, total: 0 }, openGates: 0 };
    const empty = coreCells(m, 300);
    expect(hueOf(empty, 'header -')).toBe('muted');
    expect(hueOf(empty, 'evidence 2/2')).toBe('green');
    expect(hueOf(empty, '✔ gates')).toBe('green');
    m.contract = { header: { ok: 1, total: 3 }, evidence: { ok: 0, total: 2 }, verifiedDone: { ok: 0, total: 0 }, openGates: 2 };
    const part = coreCells(m, 300);
    expect(hueOf(part, 'header 1/3')).toBe('yellow');
    expect(hueOf(part, 'evidence 0/2')).toBe('yellow');
    expect(hueOf(part, '✖ 2 gates')).toBe('red');
  });
  test('compact forms at the narrowest width that fits all four groups', () => {
    const m = blank();
    m.contract.openGates = 1;
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.ledger = { claimed: 1, verified: 1, refuted: 0, pending: 0, unchecked: 0 };
    m.offload = { workers: [worker('w')] as any, kept: 7000, returned: 151, ratio: 46.4 };
    m.routes = [route({ seats: [seat()] }) as any];
    let narrow = 0;
    for (let cols = 20; cols < 300; cols++) if (coreCells(m, cols).some((x) => x.t === 'ROUTE')) { narrow = cols; break; }
    expect(trim(cellsText(coreCells(m, narrow)))).toBe('  CONTRACT  hdr - ev - ✖1   VERDICT  ✔1 ✖0 ?0 ⚠0   OFFLOAD  7.0k→151 46x   ROUTE  fix/low sonnet …');
  });
  test('below the four compact groups: contract and verdict only, below that nothing', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.routes = [route() as any];
    let four = 0;
    for (let cols = 20; cols < 300; cols++) if (coreCells(m, cols).some((x) => x.t === 'ROUTE')) { four = cols; break; }
    const two = coreCells(m, four - 1);
    expect(two.filter((x) => x.chip).map((x) => x.t)).toEqual(['CONTRACT', 'VERDICT']);
    expect(cellsWidth(two)).toBeLessThanOrEqual(four - 1);
    expect(coreCells(m, cellsWidth(two) - 1)).toEqual([]);
    expect(coreCells(m, cellsWidth(two)).length).toBeGreaterThan(0);
  });
  test('with room every group widens to its full form', () => {
    const m = blank();
    m.contract = { header: { ok: 1, total: 1 }, evidence: { ok: 1, total: 1 }, verifiedDone: { ok: 0, total: 0 }, openGates: 0 };
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.ledger = { claimed: 2, verified: 1, refuted: 1, pending: 1, unchecked: 1 };
    m.offload = { workers: [worker('a'), worker('b')] as any, kept: 14_000, returned: 302, ratio: 3.2 };
    m.routes = [route({ teamId: 't2' }), route({ seats: [seat({ count: 2 }), seat({ role: 'verifier', model: 'haiku' })] })] as any;
    expect(trim(cellsText(coreCells(m, 500)))).toBe(
      '  CONTRACT  header 1/1 · evidence 1/1 · ✔ gates   VERDICT  2 claims · ✔ 1 verified · ✖ 1 refuted · ? 1 open · ⚠ 1 unchecked   OFFLOAD  14.0k kept in 2 workers → 302 back (3.2x)   ROUTE  fix/low → 2× implementer sonnet, verifier haiku … +1',
    );
  });
  test('claims and workers are singular for one', () => {
    const m = blank();
    m.ledger.claimed = 1;
    m.offload = { workers: [worker('a')] as any, kept: 7000, returned: 151, ratio: null };
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    const t = cellsText(coreCells(m, 500));
    expect(t).toContain('1 claim ·');
    expect(t).not.toContain('1 claims');
    expect(t).toContain('7.0k kept in 1 worker →');
    expect(t).not.toContain('1 workers');
  });
  test('verdict figures are muted at zero and coloured when non-zero', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    const zero = coreCells(m, 500);
    for (const t of ['✔ 0 verified', '✖ 0 refuted', '? 0 open', '⚠ 0 unchecked']) expect(hueOf(zero, t)).toBe('muted');
    m.ledger = { claimed: 4, verified: 1, refuted: 1, pending: 1, unchecked: 1 };
    const some = coreCells(m, 500);
    expect([hueOf(some, '✔ 1 verified'), hueOf(some, '✖ 1 refuted'), hueOf(some, '? 1 open'), hueOf(some, '⚠ 1 unchecked')]).toEqual(['green', 'red', 'yellow', 'yellow']);
  });
  test('offload without workers says so; ROUTE without a team says so', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.ledger.verified = 1;
    const t = cellsText(coreCells(m, 500));
    expect(t).toContain('OFFLOAD  no workers yet');
    expect(t).toContain('ROUTE  no team yet');
  });
  test('route marks: drift, ran, not yet; seats fall back to "?"', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    const at = (r: unknown) => { m.routes = [r as any]; return cellsText(coreCells(m, 500)).split('ROUTE  ')[1]!.trim(); };
    expect(at(route({ seats: [seat()], drift: ['x'] }))).toBe('fix/low → implementer sonnet ✖ drift');
    expect(at(route({ seats: [seat({ ran: ['claude-sonnet-5-5'] })] }))).toBe('fix/low → implementer sonnet ✔');
    expect(at(route({ seats: [seat()] }))).toBe('fix/low → implementer sonnet …');
    expect(at(route())).toBe('fix/low → ? …');
  });
});

describe('core report lines', () => {
  test('tallies, open gates and the empty-verdict note', () => {
    const m = blank();
    m.offload.workers = [worker('w1', { costUsd: null, model: null })] as any;
    m.contract = { header: { ok: 1, total: 2 }, evidence: { ok: 0, total: 0 }, verifiedDone: { ok: 3, total: 3 }, openGates: 2 };
    const r = coreReport(m).split('\n');
    expect(r).toContain('  header    1/2 replies opened with the ATLAS header');
    expect(r).toContain('  evidence  - done items carry evidence');
    expect(r).toContain('  verified  3/3 done items have a verified finding');
    expect(r).toContain('  gates     2 open');
    expect(r).toContain('  no verdict recorded yet');
    expect(r).toContain('  w1  ?  peak 58.8k  kept 7.0k  returned 151  cost ?');
    expect(r).toContain('  no team yet');
    expect(r).not.toContain('  no workers yet');
    expect(coreReport({ ...m, contract: { ...m.contract, openGates: 0 } }).split('\n')).toContain('  gates     all clear');
  });
  test('verdict words and unchecked claims; the empty note only when nothing is open or unchecked', () => {
    const m = blank();
    m.verdicts = [
      { id: 'a', status: 'verified', title: 'ta', by: 'b', at: 1, evidence: '' },
      { id: 'b', status: 'rejected', title: 'tb', by: 'b', at: 2, evidence: '' },
      { id: 'c', status: 'needs-evidence', title: 'tc', by: 'b', at: 3, evidence: '' },
    ];
    m.claims = [
      { owner: 'lonely', role: 'x', status: 'DONE', at: 1, matched: null },
      { owner: 'paired', role: 'x', status: 'DONE', at: 1, matched: 'a' },
      { owner: 'failed', role: 'x', status: 'FAILED', at: 1, matched: null },
    ];
    m.ledger = { claimed: 1, verified: 1, refuted: 1, pending: 1, unchecked: 1 };
    m.offload = { workers: [], kept: 0, returned: 0, ratio: 12 };
    const r = coreReport(m).split('\n');
    expect(r).toContain('VERDICTS  1 claim, 1 verified, 1 refuted, 1 open, 1 unchecked');
    expect(r).toContain('  verified  a  ta');
    expect(r).toContain('  REFUTED  b  tb');
    expect(r).toContain('  needs evidence  c  tc');
    expect(r).toContain('  unchecked  lonely claims DONE, no verdict yet');
    expect(r.join('\n')).not.toContain('paired claims');
    expect(r.join('\n')).not.toContain('failed claims');
    expect(r).not.toContain('  no verdict recorded yet');
    expect(r).toContain('OFFLOAD  0 kept in tmux, 0 returned (12x)');
    expect(r).toContain('  no workers yet');
    // an unchecked claim alone also suppresses the empty note
    m.verdicts = [];
    expect(coreReport(m).split('\n')).not.toContain('  no verdict recorded yet');
    m.ledger.unchecked = 0;
    expect(coreReport(m).split('\n')).toContain('  no verdict recorded yet');
  });
  test('routes: seats, ran models once each, not run yet, fallback name', () => {
    const m = blank();
    m.verdicts = [{ id: 'a', status: 'verified', title: 'ta', by: 'b', at: 1, evidence: '' }];
    m.routes = [route({ name: '', seats: [seat({ ran: ['m1', 'm1', 'm2'] }), seat({ count: 2, role: 'verifier', model: 'haiku', effort: 'low' })], drift: ['why'] })] as any;
    const r = coreReport(m).split('\n');
    expect(r).toContain('  fix/low  t1  shared, max 1');
    expect(r).toContain('    1x implementer sonnet/medium  ran m1, m2');
    expect(r).toContain('    2x verifier haiku/low  not run yet');
    expect(r).toContain('    DRIFT why');
  });
  test('no ratio means no parenthesis on the offload line', () => {
    const m = blank();
    m.verdicts = [{ id: 'a', status: 'verified', title: 'ta', by: 'b', at: 1, evidence: '' }];
    expect(coreReport(m)).toContain('OFFLOAD  0 kept in tmux, 0 returned\n');
  });
});
