// Critique 18, slice A (build 562576ed): one truth on the band, the route, the gates and the core tab.
// Shapes: stoprun-110-562576ed-1 f0102 / f0113 (band reason), stoprun-150-562576ed-2 f0097 + tab-board.png (green count, `■2`), stoprun-150-562576ed-3 tab-route.ans:40
// (missing `·`), live-150-562576ed-1 tab-core.png (core words).
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { cells, type Ui } from './atlas-ui';
import type { CoreModel } from './data/core';
import { asksUser, blockReasons, gateTally } from './data/runstate';
import { bodyLines, lineText, panelText } from './panel-layout';
import { bandLines, missionLines, runsText, type MissionModel } from './mission-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const m = (cols: number, over: Partial<MissionModel> = {}): MissionModel => ({
  cols, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'implement', 'verify', 'done'], phase: 'done', ui, workers: [], checks: null, done: 5, total: 5, ...over,
});
const row = (mm: MissionModel): string => runsText(bandLines(mm)[0]!.runs);
const failed = { name: 'ghost-explorer', state: 'failed' as const, secs: 9 };

describe('A1: a reason never contradicts the todo figure beside it', () => {
  // stoprun-110-562576ed-1 f0113: Stop refused on the ghost dispatch row, the lead closed it; the plan reads 5/5 and nothing is open.
  const closed = (cols: number): string => row(m(cols, { blocked: false, stopGates: ['1 todo open'], openWork: 0, openDispatch: 0, workers: [failed] }));
  test('f0113: n/n with nothing open reads `retry stop`, never `1 todo open`', () => {
    for (const cols of [62, 80, 110, 150]) {
      const t = closed(cols);
      expect([cols, /todo open/.test(t)]).toEqual([cols, false]);
      expect(t).toMatch(/blocked · [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] retrying/);
      expect(t).toMatch(/todo [^\d]*5\/5/);
    }
  });
  test('f0102 and f0113 are one state: the open dispatch row is named while it is open', () => {
    const open = row(m(110, { stopGates: ['1 todo open'], openWork: 1, openDispatch: 1, openDispatchTitle: 'T2 read ghost.py', workers: [failed] }));
    expect(open).toContain('blocked · needs: close dispatch T2');
    expect(open).not.toMatch(/\b1 todo open\b/);
  });
  test('n/n with another open row reads `stop refused` (the todo figure names the row); a plan with open rows keeps `1 todo open` beside a count that is not n/n', () => {
    expect(row(m(110, { stopGates: ['1 todo open'], openWork: 1, openDispatch: 0 }))).toContain('blocked · stop refused');
    const planOpen = row(m(110, { stopGates: ['1 todo open'], done: 4, total: 5, openWork: 1 }));
    expect(planOpen).toContain('blocked · 1 todo open');
    expect(planOpen).toContain('todo 4/5');
  });
  test('blockReasons: no open-now context keeps the gate words', () => {
    expect(blockReasons(false, ['1 todo open']).long).toBe('1 todo open');
    expect(blockReasons(false, ['team gate'], undefined, { allDone: true, openLeft: 0 }).long).toBe('team gate');
    expect(blockReasons(false, ['team gate', 'todos drained'], undefined, { allDone: true, openLeft: 0 }).long).toBe('team gate, retry stop');
  });
});

describe('A2: the gates figure counts the green marks drawn', () => {
  // stoprun-150-562576ed-2 f0097: `checks ◇ completion ● tripwire ▲ routing ● header 3/4 green` with 2 green marks.
  const checks = [{ id: 'completion', ok: true, pending: true }, { id: 'tripwire', ok: true }, { id: 'routing', ok: false, name: 'routing' }, { id: 'header', ok: true }];
  const footer = (cols: number): string => missionLines(m(cols, { maxRows: 6, workers: [], checks, done: 1, total: 5 })).map((l) => runsText(l.runs)).filter((t) => t.includes('checks')).join(' ').replace(/\s+/g, ' '); // the checks row only: the band row leads with its own `●`
  test('the band footer says 2/4 green beside two ● marks', () => {
    const t = footer(150);
    expect(t).toContain('2/4 green');
    expect((t.match(/●/g) ?? []).length).toBe(2);
    expect(t).not.toContain('3/4 green');
  });
  test('gateTally.green is the green marks: a pending and a failing group are not green', () => {
    const g = (id: string, ok: boolean, pending = false) => ({ id, title: id, lines: [{ id: `${id}1`, label: id, ok: ok || pending, ...(pending ? { pending: true } : {}) }] });
    const t = gateTally([g('completion', true, true), g('tripwire', true), g('routing', false), g('header', true)] as never);
    expect([t.green, t.total]).toEqual([2, 4]);
  });
  test('a pending check with no failure still shows what is not green: `◇ completion  3/4 green`', () => {
    const t = runsText(missionLines(m(80, { maxRows: 6, workers: [], checks: [checks[0]!, checks[1]!, checks[3]!], done: 1, total: 5 })).flatMap((l) => l.runs));
    expect(t.replace(/\s+/g, ' ')).toContain('checks ◇ completion ● tripwire ● header 2/3 green');
  });
});

describe('A3: a middle dot between band segments, and a count never loses its word to a bare glyph', () => {
  // stoprun-150-562576ed-3 tab-route.ans:40: `todo 4/5 ▲ 1 blocked · ■ 1 failed`; stoprun-150-562576ed-2 tab-board.png (82 columns): `... · ■2`, `▲ 1 blocked` lost.
  const warn = (cols: number): string => row(m(cols, { phase: 'research', done: 1, total: 5, openWork: 2, openDispatch: 2, todoBlocked: 1, checks: [{ id: 'routing', ok: false, name: 'routing' }], workers: [{ ...failed, name: 'beta-explorer' }, failed] }));
  test('no `n ▲ 1 blocked` without a dot at any width', () => {
    for (let cols = 40; cols <= 150; cols++) expect([cols, /\d ▲ \d+ blocked/.test(warn(cols))]).toEqual([cols, false]);
    expect(row(m(110, { done: 4, total: 5, todoBlocked: 1, blocked: true, stopGates: [], workers: [failed] }))).toContain('todo 4/5 · ▲ 1 blocked');
  });
  test('82 columns (the tab open): the words stay, a lower-priority segment goes', () => {
    const t = warn(82);
    expect(t).toMatch(/■ 2 failed/);
    expect(t).toMatch(/▲ 1 blocked/);
    expect(t).not.toMatch(/■2/);
    expect(t).not.toContain('dispatches open');
  });
  test('no bare glyph-and-number count while a form with the words fits', () => {
    for (let cols = 62; cols <= 150; cols++) { // 62: the lead `○ idle · ▲ routing warning` is 7 cells longer than the old bare warning
      const t = warn(cols);
      expect([cols, /[■▲◐]\d/.test(t)]).toEqual([cols, false]);
      expect([cols, cells(t.trimEnd()) <= cols]).toEqual([cols, true]);
    }
  });
});

describe('A4: the lead waits on the person', () => {
  test('asksUser reads the live words (stoprun-150-562576ed-2 f0097, -3 tab-route)', () => {
    expect(asksUser('Still open:\n- T3 (read beta.py): beta-explorer was stopped by mistake earlier and will not return.\n  Waiting on your decision.\n\nChoose one:\n1. Re-dispatch')).toBe(true);
    expect(asksUser("- Open choice: the scenario asks me to mark T2 completed. If you want the done header anyway, say so and I'll write it.")).toBe(true);
    expect(asksUser('Which do you want?')).toBe(true);
  });
  test('plain progress never reads as an ask', () => {
    expect(asksUser("alpha-explorer finished: alpha.py defines alpha_one. I'm updating the board now: T1 completed, and T2 blocked because ghost-explorer was stopped.")).toBe(false);
    expect(asksUser('The three explorers listed their functions. All five board items are completed.')).toBe(false);
    expect(asksUser('')).toBe(false);
    expect(asksUser(null)).toBe(false);
  });
  test('a declared block reads `needs you` and the route phase reads blocked, not `research`', () => {
    expect(row(m(150, { phase: 'research', blocked: true, done: 1, total: 5 }))).toContain('▲ blocked · needs you');
    const route = bodyLines(panelWorld('route', 120, ui, { phase: 'blocked' as never, workers: [], todos: [] })).map(lineText).find((l) => l.trimStart().startsWith('phase'))!;
    expect(route).toContain('blocked');
  });
  test('a refused Stop makes the route phase blocked whatever the last header said', () => {
    const stop = [{ id: 'completion', title: 'C', lines: [{ id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail: 'team gate' }] }];
    for (const phase of ['research', 'done'] as const) {
      const line = bodyLines(panelWorld('route', 120, ui, { phase, gates: stop as never, workers: [], todos: [] })).map(lineText).find((l) => l.trimStart().startsWith('phase'))!;
      expect([phase, line]).toEqual([phase, expect.stringContaining('blocked')]);
    }
  });
});

describe('A5: the core tab in plain words', () => {
  // live-150-562576ed-1 tab-core.png: an orphan `contract`, `3x explorer too many 3 ran, plan said 1 (haiku)`, `reading 3 workers finished, their token use is not recorded`.
  const core = {
    contract: { header: { ok: 3, total: 3 }, evidence: { ok: 0, total: 5 }, open: 0, openGates: 0, verifiedDone: { ok: 0, total: 5 } },
    verdicts: [], claims: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 },
    offload: { workers: [], kept: 0, returned: 0, ratio: null },
    routes: [{ teamId: 'in-process:audit/low', name: 'in-process', cls: 'audit', effort: 'low', isolation: '', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }],
    inProcess: true,
  } as unknown as CoreModel;
  const done3 = ['alpha', 'beta', 'gamma'].map((n) => ({ name: `${n}-explorer`, state: 'done' as const, detail: 'read x.py', secs: 9 }));
  for (const cols of [37, 60, 80, 120, 150]) {
    test(`at ${cols}: no \`contract\`, no \`3x\`, no \`plan said 1 (haiku)\`, no \`token use is not recorded\``, () => {
      const out = panelText(panelWorld('core', cols, ui, { rows: 40, core, workers: done3 })).join('\n');
      expect(out).not.toMatch(/\bcontract\b/);
      expect(out).not.toMatch(/\dx explorer/);
      expect(out).not.toContain('plan said 1 (haiku');
      expect(out).not.toContain('is not recorded');
      expect(out.replace(/\s+/g, ' ')).toContain('3 explorers ran, the plan said 1'); // the heading still says what happened
    });
  }
  test('the heading carries a figure and the seat line names the plan in words', () => {
    const out = panelText(panelWorld('core', 150, ui, { rows: 40, core, workers: done3 })).map((l) => l.trimEnd());
    expect(out.some((l) => /^\s+done items\s+\d+ of \d+$/.test(l))).toBe(true);
    expect(out.some((l) => /^\s+planned on haiku, low effort$/.test(l))).toBe(true); // critique 21: the heading says the count, the seat names only the plan
    expect(out.some((l) => /too many/.test(l))).toBe(false);
    expect(out.some((l) => /reading\s+3 workers finished/.test(l))).toBe(true);
  });
});
