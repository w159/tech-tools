// Side panel rows the redesign dropped tests for (verify-build section 3, "lost coverage"): the Team tab's lead row, roster rows and
// tally, the channel log's counts and columns, the core tab's caps and notes, the route tab's blocked owner and phase ticks.
// Expectations are literal text written by hand against the rev 4 vocabulary; the model is hand-built, not read from the layout.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../../../contracts/panel-world';
import type { Ui } from '../../design/atlas-ui';
import type { CoreModel } from '../../data/core';
import { bodyLines, lineText, panelText, type PanelModel, type PanelNote, type PanelTab, type PanelTodo, type PanelWorker } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
/** The short pane (24 rows) unless a test says otherwise: a pane of 30 rows or more fills its spare rows (mod/view/panel/panel-side.test.ts). */
const body = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}, ui: Ui = mocha): string[] => bodyLines(panelWorld(t, cols, ui, { rows: 24, ...over })).map((l) => lineText(l).trimEnd());
const full = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}): string[] => panelText(panelWorld(t, cols, mocha, { rows: 24, ...over }));
const w = (name: string, state: PanelWorker['state'], over: Partial<PanelWorker> = {}): PanelWorker => ({ name, state, detail: '', ...over });

describe('team tab: lead row, roster rows, lead tally', () => {
  const lead = w('lead', 'waiting', { role: 'lead', detail: 'idle' });
  const mates = [w('leader', 'queued', { role: 'unknown', detail: 'idle' })];
  for (const cols of [120, 80]) {
  }
});

describe('channel tab: header, columns and marks', () => {
  const note = (over: Partial<PanelNote> = {}): PanelNote => ({ at: '10:02', from: 'lead', text: 'hello', ...over });
});

describe('core tab: caps, notes and figures', () => {
  const empty = (): CoreModel => ({
    contract: { header: { ok: 0, total: 0 }, evidence: { ok: 0, total: 0 }, openGates: 0, verifiedDone: { ok: 0, total: 0 } },
    verdicts: [], claims: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 },
    offload: { workers: [], kept: 0, returned: 0, ratio: null }, routes: [],
  } as unknown as CoreModel);
  const verdict = (id: string, status = 'verified') => ({ id, status, title: `title of ${id}`, by: 'atlas:verifier', at: 1, evidence: 'ran it' });
  const worker = (name: string) => ({ name, model: 'claude-sonnet-5-5', peak: 1000, kept: 500, returned: 50, costUsd: 0.1234, finished: true });
  const route = (id: string, over: Record<string, unknown> = {}) => ({ teamId: id, name: id, cls: 'fix', effort: 'low', isolation: 'shared', maxParallel: 1, seats: [], drift: [], transport: 'tmux', ...over });
  const core = (c: CoreModel): string[] => body('core', 120, { core: c });

  test('only the last 8 verdicts show', () => {
    const c = empty();
    c.verdicts = Array.from({ length: 9 }, (_, i) => verdict(`v${i}`)) as never;
    const out = core(c).join('\n');
    expect(out).not.toContain('title of v0');
    expect(out).toContain('title of v1');
    expect(out).toContain('title of v8');
  });
  test('only the last 8 offload workers show', () => {
    const c = empty();
    c.offload = { workers: Array.from({ length: 9 }, (_, i) => worker(`wk-${i}`)), kept: 1, returned: 1, ratio: null } as never;
    const out = core(c).join('\n');
    expect(out).not.toContain('wk-0 ');
    expect(out).toContain('wk-1 ');
    expect(out).toContain('wk-8 ');
  });
  test('only the last 6 routes show, newest first', () => {
    const c = empty();
    c.routes = Array.from({ length: 7 }, (_, i) => route(`r${i}`)) as never;
    const names = core(c).filter((l) => /^ {4}fix team \(low effort\)/.test(l)).map((l) => l.split(/\s+/)[5]);
    expect(names).toEqual(['r6', 'r5', 'r4', 'r3', 'r2', 'r1']);
  });
  test('without in-process rows the tab says they are not shown; with them it shows the transport and no note', () => {
    const c = empty();
    c.routes = [route('t1')] as never;
    expect(core(c).at(-1)).toBe('    in-process dispatches are not shown here');
    c.inProcess = true;
    c.routes = [route('in-process:fix/low', { name: 'in-process', transport: 'in-process', isolation: '', maxParallel: 2 })] as never;
    const out = core(c);
    expect(out).toContain('    fix team (low effort) workers ran in-process (no tmux team), up to 2 at once'); // B4: plain words, not `in-process  in-process, max 2`
    expect(out.join('\n')).not.toContain('not shown here');
  });
  test('B4: with nothing read or returned the offload line is a sentence, not `0 tokens read by workers`', () => {
    const c = empty();
    c.routes = [route('t1')] as never;
    const line = body('core', 120, { core: c, workers: [] }).find((l) => l.startsWith('    reading'))!; // no worker has returned either
    expect(line).toBe('    reading  workers have read and returned nothing yet');
    expect(line).not.toMatch(/\b0 tokens\b/);
    // critique 6: workers that did return are never said to have returned nothing; in-process workers keep no token log, and the heading does not say so (critique 19 C4)
    expect(core(c).find((l) => l.startsWith('    reading'))).toBe('    reading  3 workers finished');
  });
  test('B4: a seat that ran another model says so in words', () => {
    const c = empty();
    c.routes = [route('t1', { seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['opus'] }], drift: ['explorer ran opus'] })] as never;
    const out = core(c).join('\n');
    expect(out).toContain('ran on opus, planned haiku, low effort');
    expect(out).not.toMatch(/ran opus {2}haiku\/low/);
  });
  test('B8: a route without a transport is not labelled tmux', () => {
    const c = empty();
    c.routes = [route('t1', { transport: undefined })] as never;
    const line = core(c).find((l) => l.startsWith('    fix team (low effort)'))!;
    expect(line).toBe('    fix team (low effort) t1  transport unknown, shared, max 1');
    expect(line).not.toContain('tmux');
  });
  test('the ledger drops open and unchecked counts of zero and says what is off', () => {
    const c = empty();
    c.verdicts = [verdict('v')] as never;
    c.ledger = { claimed: 1, verified: 1, refuted: 0, pending: 0, unchecked: 0 } as never;
    expect(core(c).find((l) => l.startsWith('    verdicts'))).toBe('    verdicts  1 verified · 0 refuted');
    c.ledger = { claimed: 2, verified: 1, refuted: 1, pending: 3, unchecked: 4 } as never;
    expect(core(c).find((l) => l.startsWith('    verdicts'))).toBe('    verdicts  1 verified · 1 refuted · 3 open · 4 unchecked');
  });
  test('a DONE claim with no verdict gets a warning row; a matched or non-DONE one does not', () => {
    const c = empty();
    c.verdicts = [verdict('a')] as never;
    c.claims = [{ owner: 'lonely', status: 'DONE', at: 9, matched: null }, { owner: 'matched', status: 'DONE', at: 8, matched: 'a' }, { owner: 'failed', status: 'FAILED', at: 7, matched: null }] as never;
    const out = core(c);
    expect(out).toContain('  △ lonely unchecked      says done, no verdict yet');
    expect(out.join('\n')).not.toContain('matched ');
    expect(out.join('\n')).not.toContain('failed ');
  });
  test('an offload row has exact columns, `?` for an unknown model and a cost only when known', () => {
    const c = empty();
    c.offload = { workers: [{ name: 'w1', model: null, peak: 58_800, kept: 7000, returned: 151, costUsd: null, finished: false }], kept: 7000, returned: 151, ratio: 46.4 } as never;
    const out = core(c);
    expect(out.find((l) => l.startsWith('    reading'))).toBe('    reading  7.0k tokens read by workers, 151 returned to the lead, 2% of what they read');
    expect(out.find((l) => l.startsWith('    w1'))).toBe(`    w1 ?${' '.repeat(77)}peak 58.8k  read 7.0k  returned 151`); // figures right-aligned, no cost when unknown
  });
  test('the offload share is a whole percent of what the workers read, and only when it can not pass 100', () => {
    const c = empty();
    c.offload = { workers: [worker('w')], kept: 15, returned: 10, ratio: 1.5 } as never;
    expect(core(c).find((l) => l.startsWith('    reading'))).toBe('    reading  15 tokens read by workers, 10 returned to the lead, 67% of what they read');
    c.offload = { workers: [worker('w')], kept: 10, returned: 15, ratio: 0.7 } as never;
    expect(core(c).find((l) => l.startsWith('    reading'))).not.toContain('%');
  });
});

describe('route tab: blocked owner, phase position', () => {
  const todo = (id: string, state: PanelTodo['state'], over: Partial<PanelTodo> = {}): PanelTodo => ({ id, label: `task ${id}`, state, ...over });
});
