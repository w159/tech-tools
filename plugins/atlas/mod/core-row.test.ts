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
  test('a dim lowercase label leads each group', () => {
    const labels = coreCells(model, 160).filter((c) => c.tone === 'dim' && c.t.trim() !== '·').map((c) => c.t.trim());
    expect(labels).toEqual(['contract', 'verdicts', 'offload', 'route']);
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
const toneOf = (cells: ReturnType<typeof coreCells>, text: string) => cells.find((x) => x.t === text)?.tone;

describe('core row cells', () => {
  test('ratio: exactly 10 rounds, below 10 keeps a decimal', () => {
    expect([ratioText(10), ratioText(9.96), ratioText(9.94), ratioText(0)]).toEqual(['10x', '10.0x', '9.9x', '0.0x']);
  });
  test('cellsWidth sums the run widths and starts from zero; cellsText joins them', () => {
    expect(cellsWidth([])).toBe(0);
    expect(cellsWidth([{ t: 'ab', tone: 'text' }])).toBe(2);
    expect(cellsWidth([{ t: 'ab', tone: 'text' }, { t: 'XY', tone: 'bad' }])).toBe(4);
    expect(cellsText([{ t: 'ab', tone: 'text' }, { t: 'XY', tone: 'bad' }])).toBe('abXY');
  });
  test('contract tallies are muted when empty, plain when complete, amber when partial; gates are not repeated here', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.contract = { header: { ok: 0, total: 0 }, evidence: { ok: 2, total: 2 }, verifiedDone: { ok: 0, total: 0 }, openGates: 0 };
    const empty = coreCells(m, 300);
    expect(toneOf(empty, 'header none')).toBe('muted');
    expect(toneOf(empty, 'evidence 2/2')).toBe('text');
    m.contract = { header: { ok: 1, total: 3 }, evidence: { ok: 0, total: 2 }, verifiedDone: { ok: 0, total: 0 }, openGates: 2 };
    const part = coreCells(m, 300);
    expect(toneOf(part, 'header 1/3')).toBe('warn');
    expect(toneOf(part, 'evidence 0/2')).toBe('warn');
    expect(cellsText(part)).not.toMatch(/gates/); // the footer's checks row owns gate results
  });
  test('compact forms at the narrowest width that fits all four groups', () => {
    const m = blank();
    m.contract.openGates = 1;
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.ledger = { claimed: 1, verified: 1, refuted: 0, pending: 0, unchecked: 0 };
    m.offload = { workers: [worker('w')] as any, kept: 7000, returned: 151, ratio: 46.4 };
    m.routes = [route({ seats: [seat()] }) as any];
    let narrow = 0;
    for (let cols = 20; cols < 300; cols++) if (coreCells(m, cols).some((x) => x.t === 'route  ')) { narrow = cols; break; }
    expect(narrow).toBe(104);
    expect(trim(cellsText(coreCells(m, narrow)))).toBe(' contract  header none   verdicts  1 verified · 0 refuted   offload  7.0k → 151 (46x)   route  fix/low …');
  });
  test('below the four compact groups: contract and verdict only, below that nothing', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.routes = [route() as any];
    let four = 0;
    for (let cols = 20; cols < 300; cols++) if (coreCells(m, cols).some((x) => x.t === 'route  ')) { four = cols; break; }
    const two = coreCells(m, four - 1);
    expect(two.filter((x) => x.tone === 'dim' && x.t.trim() !== '·').map((x) => x.t.trim())).toEqual(['contract', 'verdicts']);
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
      ' contract  header 1/1 · evidence 1/1   verdicts  2 claims · 1 verified · 1 refuted · 1 open · 1 unchecked   offload  14.0k kept in 2 workers → 302 back (3.2x)   route  fix/low → 2× implementer sonnet, verifier haiku … +1 more',
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
    for (const t of ['0 verified', '0 refuted', '0 open', '0 unchecked']) expect(toneOf(zero, t)).toBe('muted');
    m.ledger = { claimed: 4, verified: 1, refuted: 1, pending: 1, unchecked: 1 };
    const some = coreCells(m, 500);
    expect([toneOf(some, '1 verified'), toneOf(some, '1 refuted'), toneOf(some, '1 open'), toneOf(some, '1 unchecked')]).toEqual(['ok', 'bad', 'warn', 'warn']);
  });
  test('offload without workers says so; route without a team says so', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.ledger.verified = 1;
    const t = cellsText(coreCells(m, 500));
    expect(t).toContain('offload  none yet');
    expect(t).toContain('route  no team yet');
  });
  test('route marks: drift, ran, not yet; seats fall back to "?"', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    const at = (r: unknown) => { m.routes = [r as any]; return cellsText(coreCells(m, 500)).split('route  ')[1]!.trim(); };
    expect(at(route({ seats: [seat()], drift: ['x'] }))).toBe('fix/low → implementer sonnet ✗ drift');
    expect(at(route({ seats: [seat({ ran: ['claude-sonnet-5-5'] })] }))).toBe('fix/low → implementer sonnet ✓');
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
    expect(r).toContain('  evidence  none done items carry evidence');
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
    expect(r).toContain('VERDICTS  3 findings: 1 verified, 1 refuted, 1 open  |  1 claim this run, 1 unchecked');
    expect(r).toContain('  verified  a  ta');
    expect(r).toContain('  REFUTED  b  tb');
    expect(r).toContain('  needs evidence  c  tc');
    expect(r).toContain('  unchecked  lonely claims DONE, no verdict yet');
    expect(r.join('\n')).not.toContain('paired claims');
    expect(r.join('\n')).not.toContain('failed claims');
    expect(r).not.toContain('  no verdict recorded yet');
    expect(r).toContain('OFFLOAD  0 kept in tmux, 0 returned (12x), all 0 recorded workers');
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
    m.routes = [route({ name: '', seats: [seat({ count: 3, ran: ['m1', 'm1', 'm2'] }), seat({ count: 2, role: 'verifier', model: 'haiku', effort: 'low' })], drift: ['why'] })] as any;
    const r = coreReport(m).split('\n');
    expect(r).toContain('  fix/low  t1  shared, max 1');
    expect(r).toContain('    3x implementer sonnet/medium  ran m1, m2');
    expect(r).toContain('    2x verifier haiku/low  not run yet');
    expect(r).toContain('    DRIFT why');
  });
  test('no ratio means no parenthesis on the offload line', () => {
    const m = blank();
    m.verdicts = [{ id: 'a', status: 'verified', title: 'ta', by: 'b', at: 1, evidence: '' }];
    expect(coreReport(m)).toContain('OFFLOAD  0 kept in tmux, 0 returned, all 0 recorded workers\n');
  });
});

describe('core report is bounded', () => {
  const verdictRows = (r: string): string[] => r.slice(r.indexOf('VERDICTS'), r.indexOf('OFFLOAD')).split('\n').filter((l) => /^ {2}(verified|REFUTED|needs evidence) {2}/.test(l));
  const v = (id: string, status: 'verified' | 'rejected' | 'needs-evidence', at: number, title = `t-${id}`) => ({ id, status, title, by: 'b', at, evidence: '' });

  test('40 distinct findings print at most 12 rows, refuted and open first, then a more line', () => {
    const m = blank();
    m.verdicts = [
      ...Array.from({ length: 36 }, (_, i) => v(`ok${i}`, 'verified', 100 + i)),
      v('bad1', 'rejected', 1), v('bad2', 'rejected', 2), v('open1', 'needs-evidence', 3), v('bad3', 'rejected', 4),
    ];
    m.ledger = { claimed: 0, verified: 36, refuted: 3, pending: 1, unchecked: 0 };
    const out = coreReport(m);
    const rows = verdictRows(out);
    expect(rows).toHaveLength(12);
    expect(rows.slice(0, 4).every((l) => !l.startsWith('  verified'))).toBe(true);
    expect(rows[4]).toBe('  verified  ok35  t-ok35'); // newest verified first
    expect(out).toContain('  ... 28 more (full ledger: .atlas/.run/findings.json)');
  });
  test('the counts on the VERDICTS line sum to the findings total', () => {
    const m = blank();
    m.verdicts = [v('a', 'verified', 1), v('b', 'rejected', 2), v('c', 'needs-evidence', 3), v('d', 'verified', 4)];
    m.ledger = { claimed: 0, verified: 2, refuted: 1, pending: 1, unchecked: 0 };
    expect(coreReport(m)).toContain('VERDICTS  4 findings: 2 verified, 1 refuted, 1 open  |  0 claims this run, 0 unchecked');
  });
  test('an entry with no id and no title is counted as unlabeled, not printed as a blank row', () => {
    const m = blank();
    m.verdicts = [v('a', 'verified', 1), v('', 'verified', 2, '')];
    m.ledger = { claimed: 0, verified: 2, refuted: 0, pending: 0, unchecked: 0 };
    const out = coreReport(m);
    expect(verdictRows(out)).toEqual(['  verified  a  t-a']);
    expect(out).toContain('1 unlabeled');
    expect(out.split('\n').filter((l) => /^ {2}(verified|REFUTED|needs evidence) *$/.test(l))).toEqual([]); // no empty row
  });
  test('30 workers of which 10 carry no data print at most 8 rows and a more line', () => {
    const m = blank();
    m.verdicts = [v('a', 'verified', 1)];
    m.offload.workers = [
      ...Array.from({ length: 20 }, (_, i) => worker(`w${String(i).padStart(2, '0')}`)),
      ...Array.from({ length: 10 }, (_, i) => worker(`z${i}`, { peak: 0, kept: 0, returned: 0, model: null, costUsd: null })),
    ] as any;
    const out = coreReport(m);
    const rows = out.split('\n').filter((l) => /^ {2}[wz]\d+ {2}/.test(l));
    expect(rows).toHaveLength(8);
    expect(rows.some((l) => l.includes('peak 0'))).toBe(false);
    expect(out).toContain('  ... 12 more, 10 with no data');
    expect(out).toContain('all 30 recorded workers');
  });
});

describe('D7 / D4 shared core row and report', () => {
  const none = { ...model, verdicts: [], claims: [], ledger: { claimed: 1, verified: 0, refuted: 0, pending: 0, unchecked: 0 } } as CoreModel;
  test('D7: the band row and the report say `no verdicts yet`, never 0 verified · 0 refuted', () => {
    const row = cellsText(coreCells(none, 160));
    expect(row).toContain('no verdicts yet');
    expect(row).not.toMatch(/0 verified|0 refuted/);
    const rep = coreReport(none);
    expect(rep).toContain('VERDICTS  no verdicts yet');
    expect(rep).not.toContain('0 findings');
  });
  test('D4: the report shows ran 3 / planned 1 for three explorers on a one-explorer seat', () => {
    const m = { ...model, routes: [{ teamId: 't', name: 'x', cls: 'audit', effort: 'low', isolation: '', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process',
      seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['claude-haiku-5', 'claude-haiku-5', 'claude-haiku-5'] }] }] } as CoreModel;
    const rep = coreReport(m);
    expect(rep).toContain('ran 3 / planned 1 (claude-haiku-5)');
    expect(rep).toContain('DRIFT explorer ran 3, seat plans 1');
  });
});
