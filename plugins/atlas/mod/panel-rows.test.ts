// Side panel rows the redesign dropped tests for (verify-build section 3, "lost coverage"): the Team tab's lead row, roster rows and
// tally, the channel log's counts and columns, the core tab's caps and notes, the route tab's blocked owner and phase ticks.
// Expectations are literal text written by hand against the rev 4 vocabulary; the model is hand-built, not read from the layout.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { teamLiveGolden } from '../contracts/panel-golden';
import type { Ui } from './atlas-ui';
import type { CoreModel } from './data/core';
import { bodyLines, lineText, panelText, type PanelModel, type PanelNote, type PanelTab, type PanelTodo, type PanelWorker } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
/** The short pane (24 rows) unless a test says otherwise: a pane of 30 rows or more fills its spare rows (mod/panel-side.test.ts). */
const body = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}, ui: Ui = mocha): string[] => bodyLines(panelWorld(t, cols, ui, { rows: 24, ...over })).map((l) => lineText(l).trimEnd());
const full = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}): string[] => panelText(panelWorld(t, cols, mocha, { rows: 24, ...over }));
const w = (name: string, state: PanelWorker['state'], over: Partial<PanelWorker> = {}): PanelWorker => ({ name, state, detail: '', ...over });

describe('team tab: lead row, roster rows, lead tally', () => {
  const lead = w('lead', 'waiting', { role: 'lead', detail: 'idle' });
  const mates = [w('leader', 'queued', { role: 'unknown', detail: 'idle' })];
  for (const cols of [120, 80]) {
    test(`the live shape at ${cols} equals the hand-written golden`, () => {
      expect(body('team', cols, { lead, mates, rows: 40 })).toEqual(teamLiveGolden[cols]); // the live pane: 40 rows
    });
  }
  test('the lead row is first and the tally is last; the ribbon counts only the workers', () => {
    const out = body('team', 120, { lead, mates });
    expect(out[0]!.startsWith('  ◉ lead')).toBe(true);
    expect(out.at(-1)).toBe('lead  1 queued · 1 running · 2 done · 1 failed');
  });
  test('the tally always says running, and drops the other states with no worker', () => {
    expect(body('team', 80, { lead, workers: [] }).at(-1)).toBe('lead  0 running');
    expect(body('team', 80, { lead, workers: [w('a', 'failed')] }).at(-1)).toBe('lead  0 running · 1 failed');
    expect(body('team', 80, { lead, workers: [w('a', 'done'), w('b', 'done')] }).at(-1)).toBe('lead  0 running · 2 done');
    expect(body('team', 80, { lead, workers: [w('a', 'running'), w('b', 'waiting')] }).at(-1)).toBe('lead  1 running · 1 waiting');
  });
  test('no workers and no roster keeps the hint, and the lead stays above it', () => {
    expect(body('team', 80, { lead, workers: [], mates: [] })).toEqual(['  ◉ lead    waiting', '(no state)  nobody dispatched yet, ask the lead to start a worker', 'lead  0 running']);
    expect(body('team', 80, { lead: undefined, workers: [], mates: [] })).toEqual(['(no state)  nobody dispatched yet, ask the lead to start a worker']);
  });
  test('a roster member the squad does not list reads queued and is not counted in the agents row', () => {
    const route = full('route', 120, { mates, lead }).join('\n');
    expect(route).toContain('agents  ◇ 1 queued   ◐ 1 running   ● 2 done   ■ 1 failed');
    expect(body('team', 120, { lead, mates }).some((l) => /^ {2}◇ leader +queued/.test(l))).toBe(true);
  });
  test('a parked worker draws a queued row with its word instead of throwing', () => {
    const out = body('team', 80, { workers: [w('pk', 'queued', { detail: 'parked' })] });
    expect(out).toEqual(['  ◇ pk      queued']);
  });
  test('the recipient can be the lead: it takes the focus marker', () => {
    expect(body('team', 80, { lead, mates, recipient: 'lead' })[0]!.startsWith('▸ ◉ lead')).toBe(true);
    expect(body('team', 80, { lead, mates }).filter((l) => l.startsWith('▸'))).toHaveLength(1);
  });
  test('an open lead row has no age line (the lead has no start time)', () => {
    const out = body('team', 80, { lead, workers: [], mates: [], expanded: 'worker:lead' });
    expect(out.some((l) => l.includes('running ') && l.includes('tool calls'))).toBe(false);
    expect(out[1]).toBe('    idle');
  });
});

describe('channel tab: header, columns and marks', () => {
  const note = (over: Partial<PanelNote> = {}): PanelNote => ({ at: '10:02', from: 'lead', text: 'hello', ...over });
  test('one person is singular, more are plural', () => {
    expect(body('channel', 80, { people: 1, unread: 0, notes: [] })[0]).toBe('#atlas-board-mod  1 person');
    expect(body('channel', 80, { people: 2, unread: 0, notes: [] })[0]).toBe('#atlas-board-mod  2 people');
  });
  test('a missing channel name reads #channel', () => {
    expect(body('channel', 80, { channel: undefined, people: 3, unread: 0, notes: [] })[0]).toBe('#channel  3 people');
  });
  test('unread is shown only when not zero, with its word', () => {
    expect(body('channel', 80, { unread: 4, notes: [] })[0]).toBe('#atlas-board-mod  5 people · 4 unread');
    expect(body('channel', 80, { unread: 0, notes: [] })[0]).toBe('#atlas-board-mod  5 people');
  });
  test('the time column starts at 50 cells', () => {
    expect(body('channel', 50, { notes: [note()] })[1]).toBe('    lead hello                               10:02'); // the right-aligned value column
    expect(body('channel', 49, { notes: [note()] })[1]).toBe('    lead hello');
  });
  test('the nick column is 4 cells at least, 10 at most below 100 columns, 18 from 100, cut with an ellipsis', () => {
    const first = (cols: number, from: string): string => body('channel', cols, { notes: [note({ from })] })[1]!.replace(/ +10:02$/, '');
    expect(first(80, 'ab')).toBe('    ab hello');
    expect(first(80, 'implementer-band')).toBe('    implement... hello'); // cut at its end, never in the middle
    expect(first(120, 'implementer-band')).toBe('    implementer-band hello');
    expect(first(120, 'x'.repeat(30))).toBe(`    ${'x'.repeat(21)}... hello`);
  });
  test('the nick column is as wide as the widest nick shown in the log', () => {
    const out = body('channel', 80, { notes: [note({ from: 'ab' }), note({ from: 'abcdefg', text: 'two' })] });
    expect(out.slice(1).map((l) => l.replace(/ +10:02$/, ''))).toEqual(['    ab      hello', '    abcdefg two']);
  });
  test('marks: blocked and handoff carry a glyph and a word; a note to a peer names it; a note to all names nobody', () => {
    const out = body('channel', 120, { notes: [note({ kind: 'blocked', from: 'a' }), note({ kind: 'handoff', from: 'b' }), note({ kind: 'done', from: 'c' }), note({ from: 'd', to: 'peer-1' }), note({ from: 'e', to: 'all' }), note({ from: 'f', kind: 'blocked', to: 'peer-1' })] });
    expect(out.slice(1).map((l) => l.replace(/ +10:02$/, ''))).toEqual([
      '  ▲ a  blocked hello', '  ● b  handoff hello', '  ● c  done    hello', '    d          ▸ peer-1 hello', '    e          hello', '  ▲ f  blocked hello',
    ]);
  });
  test('a note is one line: whitespace and line breaks collapse', () => {
    expect(body('channel', 80, { notes: [note({ text: 'a   b\n c\t d' })] })[1]!.replace(/ +10:02$/, '')).toBe('    lead a b c d');
  });
  test('ASCII mode marks a note to a peer with > and draws plain ASCII', () => {
    const out = body('channel', 120, { notes: [note({ to: 'peer-1' })] }, ascii);
    expect(out[1]!.replace(/ +10:02$/, '')).toBe('    lead > peer-1 hello');
  });
  test('no persona colour: a nick is bold text whoever speaks', () => {
    const l = bodyLines(panelWorld('channel', 120, mocha, { notes: [note({ from: 'implementer-live' }), note({ from: 'lead' })] }));
    const nick = (i: number) => l[i]!.runs.find((x) => x.bold && x.t.trim() !== '')!;
    expect([nick(1).tone, nick(2).tone]).toEqual(['text', 'text']);
  });
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
    const names = core(c).filter((l) => /^ {4}fix\/low/.test(l)).map((l) => l.split(/\s+/)[2]);
    expect(names).toEqual(['r6', 'r5', 'r4', 'r3', 'r2', 'r1']);
  });
  test('without in-process rows the tab says they are not shown; with them it shows the transport and no note', () => {
    const c = empty();
    c.routes = [route('t1')] as never;
    expect(core(c).at(-1)).toBe('    in-process dispatches are not shown here');
    c.inProcess = true;
    c.routes = [route('in-process:fix/low', { name: 'in-process', transport: 'in-process', isolation: '', maxParallel: 2 })] as never;
    const out = core(c);
    expect(out).toContain('    fix/low workers ran in-process (no tmux team), up to 2 at once'); // B4: plain words, not `in-process  in-process, max 2`
    expect(out.join('\n')).not.toContain('not shown here');
  });
  test('B4: with nothing read or returned the offload line is a sentence, not `0 tokens read by workers`', () => {
    const c = empty();
    c.routes = [route('t1')] as never;
    const line = body('core', 120, { core: c, workers: [] }).find((l) => l.startsWith(' reading'))!; // no worker has returned either
    expect(line).toBe(' reading  workers have read and returned nothing yet');
    expect(line).not.toMatch(/\b0 tokens\b/);
    // critique 6: workers that did return are never said to have returned nothing; in-process workers keep no token log
    expect(core(c).find((l) => l.startsWith(' reading'))).toBe(' reading  3 workers returned, no token figures kept');
  });
  test('B4: a seat that ran another model says so in words', () => {
    const c = empty();
    c.routes = [route('t1', { seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['opus'] }], drift: ['explorer ran opus'] })] as never;
    const out = core(c).join('\n');
    expect(out).toContain('ran on opus, plan haiku/low');
    expect(out).not.toMatch(/ran opus {2}haiku\/low/);
  });
  test('B8: a route without a transport is not labelled tmux', () => {
    const c = empty();
    c.routes = [route('t1', { transport: undefined })] as never;
    const line = core(c).find((l) => l.startsWith('    fix/low'))!;
    expect(line).toBe('    fix/low t1  transport unknown, shared, max 1');
    expect(line).not.toContain('tmux');
  });
  test('the ledger drops open and unchecked counts of zero and says what is off', () => {
    const c = empty();
    c.verdicts = [verdict('v')] as never;
    c.ledger = { claimed: 1, verified: 1, refuted: 0, pending: 0, unchecked: 0 } as never;
    expect(core(c).find((l) => l.startsWith(' verdicts'))).toBe(' verdicts  1 verified · 0 refuted');
    c.ledger = { claimed: 2, verified: 1, refuted: 1, pending: 3, unchecked: 4 } as never;
    expect(core(c).find((l) => l.startsWith(' verdicts'))).toBe(' verdicts  1 verified · 1 refuted · 3 open · 4 unchecked');
  });
  test('a DONE claim with no verdict gets a warning row; a matched or non-DONE one does not', () => {
    const c = empty();
    c.verdicts = [verdict('a')] as never;
    c.claims = [{ owner: 'lonely', status: 'DONE', at: 9, matched: null }, { owner: 'matched', status: 'DONE', at: 8, matched: 'a' }, { owner: 'failed', status: 'FAILED', at: 7, matched: null }] as never;
    const out = core(c);
    expect(out).toContain('  ▲ lonely unchecked      says done, no verdict yet');
    expect(out.join('\n')).not.toContain('matched ');
    expect(out.join('\n')).not.toContain('failed ');
  });
  test('an offload row has exact columns, `?` for an unknown model and a cost only when known', () => {
    const c = empty();
    c.offload = { workers: [{ name: 'w1', model: null, peak: 58_800, kept: 7000, returned: 151, costUsd: null, finished: false }], kept: 7000, returned: 151, ratio: 46.4 } as never;
    const out = core(c);
    expect(out.find((l) => l.startsWith(' reading'))).toBe(' reading  7.0k tokens read by workers, 151 returned to the lead, 2% of what they read');
    expect(out.find((l) => l.startsWith('    w1'))).toBe(`    w1 ?${' '.repeat(77)}peak 58.8k  read 7.0k  returned 151`); // figures right-aligned, no cost when unknown
  });
  test('the offload share is a whole percent of what the workers read, and only when it can not pass 100', () => {
    const c = empty();
    c.offload = { workers: [worker('w')], kept: 15, returned: 10, ratio: 1.5 } as never;
    expect(core(c).find((l) => l.startsWith(' reading'))).toBe(' reading  15 tokens read by workers, 10 returned to the lead, 67% of what they read');
    c.offload = { workers: [worker('w')], kept: 10, returned: 15, ratio: 0.7 } as never;
    expect(core(c).find((l) => l.startsWith(' reading'))).not.toContain('%');
  });
});

describe('route tab: blocked owner, phase position', () => {
  const todo = (id: string, state: PanelTodo['state'], over: Partial<PanelTodo> = {}): PanelTodo => ({ id, label: `task ${id}`, state, ...over });
  test('a blocked task shows the blocked mark, its word, its owner and why from 100 columns', () => {
    const out = body('route', 120, { todos: [todo('b', 'blocked', { owner: 'impl-live', detail: 'blocked: waiting for lead reply' })] });
    expect(out.find((l) => l.includes('task b'))).toBe(`  ▲ task b                blocked blocked: waiting for lead reply${' '.repeat(46)}impl-live`);
  });
  test('below 100 columns the reason leaves the row (the owner stays right-aligned); the mark, label and word stay', () => {
    const out = body('route', 80, { todos: [todo('b', 'blocked', { owner: 'impl-live', detail: 'blocked: waiting for lead reply' })] });
    expect(out.find((l) => l.includes('task b'))).toBe(`  ▲ task b                blocked${' '.repeat(38)}impl-live`); // the reason leaves the row at 80 (open the row to read it)
    expect(body('route', 80, { todos: [todo('b', 'blocked', { owner: 'impl-live', detail: 'blocked: waiting for lead reply' })], expanded: 'task:b' }).join('\n')).toContain('    owner impl-live · blocked: waiting for lead reply');
  });
  test('the phase row shows the position on the rail; an unknown phase has none; done ticks the whole rail', () => {
    const phase = (p: string): string => body('route', 80, { phase: p, phases: ['research', 'theory', 'build', 'verify'] })[0]!;
    expect(phase('build')).toBe('phase  build 3 of 4');
    expect(phase('somewhere')).toBe('phase  somewhere');
    expect(phase('done')).toBe('phase  done 4 of 4');
  });
});
