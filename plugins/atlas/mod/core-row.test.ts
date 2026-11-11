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
  test('a muted lowercase label leads each group', () => {
    const labels = coreCells(model, 160).filter((c) => c.tone === 'muted' && /^[a-z]+ {2}$/.test(c.t)).map((c) => c.t.trim());
    expect(labels).toEqual(['contract', 'verdicts']); // offload and a route that ran as planned are not on the band (critique 10 B3)
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
  contract: { header: { ok: 0, total: 0 }, evidence: { ok: 0, total: 0 }, verifiedDone: { ok: 0, total: 0 }, open: 0, openGates: 0 },
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
  test('contract evidence is muted when empty, plain when complete, amber when a done item lacks it; gates are not repeated here', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.contract = { header: { ok: 0, total: 0 }, evidence: { ok: 0, total: 0 }, verifiedDone: { ok: 0, total: 0 }, open: 0, openGates: 0 };
    expect(toneOf(coreCells(m, 300), 'no done items yet')).toBe('muted');
    m.contract = { header: { ok: 0, total: 0 }, evidence: { ok: 2, total: 2 }, verifiedDone: { ok: 0, total: 0 }, open: 0, openGates: 0 };
    expect(toneOf(coreCells(m, 300), '2/2 done items carry evidence')).toBe('text');
    m.contract = { header: { ok: 1, total: 3 }, evidence: { ok: 0, total: 2 }, verifiedDone: { ok: 0, total: 0 }, open: 0, openGates: 2 };
    const part = coreCells(m, 300);
    expect(toneOf(part, '0/2 done items carry evidence')).toBe('warn');
    expect(cellsText(part)).not.toMatch(/gates|header/); // the footer's checks row owns gate results; the reply tally is a different unit (critique 10 B4)
  });
  test('critique 10 B4: the evidence figure shares the plan denominator the band `todo n/m` uses; the tone still reads the done items', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.contract = { header: { ok: 2, total: 2 }, evidence: { ok: 3, total: 3 }, verifiedDone: { ok: 0, total: 0 }, open: 0, openGates: 0 };
    const withPlan = coreCells(m, 300, undefined, 5);
    expect(cellsText(withPlan)).toContain('3/5 done items carry evidence');
    expect(toneOf(withPlan, '3/5 done items carry evidence')).toBe('text'); // every done item has evidence: not amber because two plan rows are still open
    expect(cellsText(coreCells(m, 300))).toContain('3/3 done items carry evidence');
  });
  test('compact forms at the narrowest width that fits both groups; below that nothing', () => {
    const m = blank();
    m.contract.evidence = { ok: 2, total: 2 };
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.ledger = { claimed: 1, verified: 1, refuted: 0, pending: 0, unchecked: 0 };
    let narrow = 0;
    for (let cols = 20; cols < 300; cols++) if (coreCells(m, cols).length) { narrow = cols; break; }
    const two = coreCells(m, narrow);
    expect(two.filter((x) => x.tone === 'muted' && /^[a-z]+ {2}$/.test(x.t)).map((x) => x.t.trim())).toEqual(['contract', 'verdicts']);
    expect(trim(cellsText(two))).toBe(' contract  2/2 evidence   verdicts  1 verified · 0 refuted');
    expect(cellsWidth(two)).toBeLessThanOrEqual(narrow);
    expect(coreCells(m, narrow - 1)).toEqual([]);
  });
  test('with room every group widens to its full form', () => {
    const m = blank();
    m.contract = { header: { ok: 1, total: 1 }, evidence: { ok: 1, total: 1 }, verifiedDone: { ok: 0, total: 0 }, open: 0, openGates: 0 };
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.ledger = { claimed: 2, verified: 1, refuted: 1, pending: 1, unchecked: 1 };
    m.offload = { workers: [worker('a'), worker('b')] as any, kept: 14_000, returned: 302, ratio: 3.2 };
    m.routes = [route({ teamId: 't2' }), route({ seats: [seat({ count: 2 }), seat({ role: 'verifier', model: 'haiku' })] })] as any;
    expect(trim(cellsText(coreCells(m, 500)))).toBe(
      ' contract  1/1 done items carry evidence   verdicts  2 claims · 1 verified · 1 refuted · 1 open · 1 unchecked',
    );
  });
  test('claims are singular for one', () => {
    const m = blank();
    m.ledger.claimed = 1;
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    const t = cellsText(coreCells(m, 500));
    expect(t).toContain('1 claim ·');
    expect(t).not.toContain('1 claims');
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
  test('critique 10 B3: no offload on the band, and no route unless it ran differently from its plan', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    m.ledger.verified = 1;
    m.offload = { workers: [worker('a')] as any, kept: 7000, returned: 151, ratio: 46.4 };
    const none = cellsText(coreCells(m, 500));
    expect(none).not.toContain('offload');
    expect(none).not.toContain('route');
    m.routes = [route({ seats: [seat({ ran: ['claude-sonnet-5-5'] })] }) as any];
    expect(cellsText(coreCells(m, 500))).not.toContain('route'); // ran as planned: nothing to say
    m.routes = [route() as any];
    expect(cellsText(coreCells(m, 500))).not.toContain('route'); // not run yet: nothing to say
  });
  test('critique 10 B3: a team that ran differently says so in plain words, never `drift`', () => {
    const m = blank();
    m.verdicts = [{ id: 'v', status: 'verified', title: 't', by: 'b', at: 1, evidence: '' }];
    const at = (r: unknown) => { m.routes = [r as any]; return cellsText(coreCells(m, 500)).split('route  ')[1]?.trim(); };
    expect(at(route({ cls: 'audit', effort: 'low', seats: [seat({ role: 'explorer', ran: ['haiku', 'haiku', 'haiku'] })], drift: ['x'] }))).toBe('planned audit/low, ran 3 explorers');
    expect(at(route({ seats: [seat({ role: 'verifier', ran: ['opus'] })], drift: ['x'] }))).toBe('planned fix/low, ran 1 verifier');
    expect(at(route({ seats: [seat()], drift: ['x'] }))).toBe('planned fix/low, ran nothing');
    expect(cellsText(coreCells(m, 500))).not.toContain('drift');
    expect(cellsText(coreCells(m, 500))).not.toContain('■');
  });
});

describe('core report lines', () => {
  test('tallies, open gates and the empty-verdict note', () => {
    const m = blank();
    m.offload.workers = [worker('w1', { costUsd: null, model: null })] as any;
    m.contract = { header: { ok: 1, total: 2 }, evidence: { ok: 0, total: 0 }, verifiedDone: { ok: 3, total: 3 }, open: 0, openGates: 2 };
    const r = coreReport(m).split('\n');
    expect(r).toContain('  header    1 of 2 replies opened with the ATLAS header'); // one n of m unit on every tab
    expect(r).toContain('  evidence  none done items carry evidence');
    expect(r).toContain('  verified  3 of 3 done items have a verified finding');
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
