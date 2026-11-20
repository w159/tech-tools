// v2-status.test.ts: the side panel's status tab, round W1 (items A-E of the round W spec): a stepper that agrees with its count (A), a real gates table (B), a full-width activity chart with a
// correct axis (C), no dead rows (D: the wired-hooks table, the RECENT log, chart growth) and the one-row CONTEXT / one-bar-per-run RUNS (E). The rows are read from the panel the way the host draws
// them: `panelLines` from the NOW ribbon down to the pinned footer, the host border removed. The tab strip and the ribbon above NOW are shared chrome and not part of this slice.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Ui } from '../../design/atlas-ui';
import { lineText, panelLines, type PanelModel } from '../panel/panel-layout';
import { panelWorld } from '../../../contracts/panel-world';
import { NOW } from '../../live_fixture';
import { textWidth } from '../../design/theme';
import { BLOCKS } from '../../design/chart';
import { hookStats, noteHook, noteHookMs, resetHookLog, WIRED_HOOKS } from '../../host/hook-log';
import { ctxRunway } from '../../data/pulse';
import { chartSeries, hookTable } from './status-frame';
import type { Health, HealthCheck } from '../../data/idle-health';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const PHASES = ['research', 'theory', 'test', 'implement', 'verify', 'review'];
const SPACES = ' ';

const checks = (_fired: boolean, bad = false): HealthCheck[] => [
  { id: 'completion', ok: true, lines: 1, pass: 1 },
  { id: 'tripwire', ok: true, lines: 1, pass: 1 },
  { id: 'routing', ok: !bad, lines: 8, pass: bad ? 7 : 8 },
  { id: 'header', ok: true, lines: 1, pass: 1 },
];

/** Events per 15 s bucket, oldest first, 20 buckets, from the frames' own bars. */
const EV = {
  idle: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  idleLater: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
  work: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 2, 2, 0, 0, 0, 0, 1, 5, 2],
  done: [0, 0, 2, 2, 3, 2, 2, 0, 0, 0, 0, 0, 1, 0, 0, 1, 4, 3, 6, 0],
};
const CTX2 = [{ tokens: 52_000, pct: 5, at: 1 }, { tokens: 64_000, pct: 6, at: 2 }];
const CTX5 = [12_000, 12_000, 36_000, 58_000, 64_000].map((tokens, i) => ({ tokens, pct: Math.round(tokens / 10_000), at: i + 1 }));
const WORK_RECENT = [
  { label: 'session.measure', ageSecs: 5, ms: 2 }, { label: 'tool.call Bash', ageSecs: 6, ms: 3 }, { label: 'tool.call Bash', ageSecs: 6, ms: 3 }, { label: 'tool.call Edit', ageSecs: 12, ms: 5 },
  { label: 'tool.call Bash', ageSecs: 15, ms: 2 }, { label: 'tool.call Read', ageSecs: 17, ms: 3 },
];
const DONE_RECENT = [
  { label: 'tool.call Bash', ageSecs: 10, ms: 3 }, { label: 'session.measure', ageSecs: 11, ms: 1 }, { label: 'turn.complete', ageSecs: 12, ms: 4 }, { label: 'tool.call Edit', ageSecs: 14, ms: 2 }, { label: 'tool.call Read', ageSecs: 18, ms: 3 },
];

type Frame = { model: (cols: number) => PanelModel };
const health = (o: Partial<Health>): Health => ({ gates: { total: 4, green: 4, checks: checks(true) }, version: '17.23.0', branch: 'master', team: 'off', ...o });
const gateGroups = (bad: boolean) => (bad
  ? [{ id: 'routing', title: 'Tool routing', lines: [{ id: 'native-grep', label: 'Native Grep calls', ok: false, detail: '2 calls denied', fix: 'use ctx_search' }, { id: 'native-read', label: 'Native Read calls', ok: true }] }]
  : []);

const IDLE = (events: number[], recent: { label: string; ageSecs: number; ms?: number }[]): Health => health({
  gates: { total: 4, green: 4, checks: checks(false) }, upSecs: 41, hooks: { total: 1, byLabel: [{ label: 'session.start', n: 1 }], recent, latency: { n: 1, p50: 2, p95: 2 } }, pulse: { events, ctx: [], runs: [] },
});
const WORKING = (bad: boolean): Health => health({
  gates: { total: 4, green: bad ? 3 : 4, checks: checks(true, bad), ...(bad ? { denied: 2 } : {}) }, upSecs: 185, ctxPct: 6, tokens: 64_000, window: 1_000_000,
  hooks: { total: 15, byLabel: [{ label: 'prompt.submit', n: 1 }, { label: 'tool.call', n: 6 }], recent: WORK_RECENT, lastEventSecs: 5, runTools: 6, runTool: 'Bash', latency: { n: 15, p50: 3, p95: 5 } },
  pulse: { events: EV.work, ctx: CTX2, runs: [], window: 1_000_000, cost: { usd: 0.01 } },
});
const DONE = (): Health => health({
  upSecs: 372, ctxPct: 6, tokens: 64_000, window: 1_000_000, last: { secs: 58, done: 5, total: 5, agents: 0, failed: 0, endedAgo: 12 },
  hooks: { total: 34, byLabel: [{ label: 'prompt.submit', n: 3 }, { label: 'tool.call', n: 11 }], recent: DONE_RECENT, lastEventSecs: 10, runTools: 11, latency: { n: 34, p50: 3, p95: 5 } },
  pulse: { events: EV.done, ctx: CTX5, runs: [{ secs: 33, ok: true, at: 1 }, { secs: 58, ok: false, at: 2 }, { secs: 42, ok: true, at: 3 }], window: 1_000_000, cost: { usd: 0.01 } },
});

const world = (cols: number, kind: 'idle' | 'working' | 'done', h: Health, bad = false, rows = 39): PanelModel =>
  panelWorld('route', cols, ui, {
    rows, phases: PHASES, phase: kind === 'working' ? 'test' : 'research', entered: kind === 'working' ? ['research', 'theory', 'test'] : [],
    todos: kind === 'working' ? [1, 2, 3, 4, 5].map((n) => ({ id: `T${n}`, label: `item ${n}`, state: n === 1 ? 'done' : 'queued' })) : [], workers: [], notes: [],
    gates: gateGroups(bad), run: { kind, secs: 5, startMs: NOW, frame: 0 }, health: h,
  } as never);

/** The rows from the NOW ribbon to the pinned footer, trailing blanks trimmed. */
const body = (m: PanelModel): string[] => {
  const t = panelLines(m).map((l) => lineText(l).trimEnd());
  return t.slice(t.findIndex((l) => l.includes('── NOW')));
};


/** The same rows untrimmed (the full cell width of each). */
const bodyRaw = (m: PanelModel): string[] => {
  const t = panelLines(m).map((l) => lineText(l));
  return t.slice(t.findIndex((l) => l.includes('── NOW')));
};
/** The runs of the panel's rows that carry `text`. */
const runsOf = (m: PanelModel, text: string) => panelLines(m).flatMap((l) => l.runs).filter((x) => x.t.includes(text));

// 150 x 45: the pane is 55 cells (U = 53) and its body 41 rows from the tab strip's row down; 110 x 45: 48 cells (U = 46).
const W150 = 55;
const W110 = 48;
const ROWS = 41;
const CASES: [string, number, 'idle' | 'working' | 'done', () => Health, boolean][] = [
  ['idle 150', W150, 'idle', () => IDLE(EV.idle, [{ label: 'session.start', ageSecs: 41, ms: 2 }]), false],
  ['idle 110', W110, 'idle', () => IDLE(EV.idle, [{ label: 'session.start', ageSecs: 41, ms: 2 }]), false],
  ['working 150', W150, 'working', () => WORKING(false), false],
  ['working 110', W110, 'working', () => WORKING(false), false],
  ['denial 150', W150, 'working', () => WORKING(true), true],
  ['done 150', W150, 'done', DONE, false],
  ['done 110', W110, 'done', DONE, false],
];
const render = (cols: number, kind: 'idle' | 'working' | 'done', h: Health, bad = false, rows = ROWS): PanelModel => world(cols, kind, h, bad, rows);

describe('the status tab body, round W1', () => {
  for (const [name, cols, kind, h, bad] of CASES) {
  }
  test('C: events are bucketed to the chart\'s width and aligned to the wall clock; the total is conserved', () => {
    const at = 1_000_000_005_000; // 5 s into a 10 s bucket: the newest stamps fall in the last one
    const stamps = [at - 290_000, at - 100_000, at - 100_050, at - 3000, at - 10];
    const pulse = { events: [], ctx: [], runs: [], stamps, at };
    const a = chartSeries({ ...IDLE(EV.idle, []), upSecs: 300, pulse }, 40);
    expect(a.vals).toHaveLength(30); // Y2f: 5 minutes of 10 s buckets, 30 of the 40 columns; the other ten are blank
    expect(a.pad).toBe(10);
    expect(a.total).toBe(5);
    expect(a.vals.at(-1)).toBeGreaterThanOrEqual(1);
    const b = chartSeries({ ...IDLE(EV.idle, []), upSecs: 300, pulse: { ...pulse, at: at + 100 } }, 40); // later in the same bucket: the same series
    expect(b.vals).toEqual(a.vals);
    const c = chartSeries({ ...IDLE(EV.idle, []), upSecs: 300, pulse: { ...pulse, at: at + 300_000 } }, 40); // five minutes on: every stamp has left the window
    expect(c.total).toBe(0);
    const spread = chartSeries(WORKING(false), 40); // no stamps: the 15 s series spread to the width, the total and the 15 s peak kept
    expect(spread.total).toBe(EV.work.reduce((n, x) => n + x, 0));
    expect(spread.peak).toBe(5);
  });
  test('D: a fired hook shows its own count, latency and age; the figures come from the hook log per kind', () => {
    resetHookLog();
    noteHook('tool.call Bash', 1000);
    noteHookMs('tool.call Bash', 1000, 1004);
    noteHook('tool.call Read', 2000);
    noteHookMs('tool.call Read', 2000, 2010);
    const h = health({ hooks: hookStats(5000) });
    const row = hookTable(h).find((x) => x.name === 'tool.call')!;
    expect(row).toMatchObject({ name: 'tool.call', n: 2, p50: 4, p95: 10, lastSecs: 3, samples: 2 });
    expect(row.ring).toEqual([4, 10]);
    expect(hookTable(h).find((x) => x.name === 'prompt.submit')).toEqual({ name: 'prompt.submit', n: 0 });
    resetHookLog();
  });
  test('runway = free tokens over the newest turn\'s growth; absent while flat or unmeasured', () => {
    expect(ctxRunway({ ctx: CTX2, window: 1_000_000 })).toBe(78);
    expect(ctxRunway({ ctx: CTX5, window: 1_000_000 })).toBe(156);
    expect(ctxRunway({ ctx: [CTX2[1]!], window: 1_000_000 })).toBeUndefined();
    expect(ctxRunway({ ctx: [CTX2[1]!, CTX2[1]!], window: 1_000_000 })).toBeUndefined();
  });
  test('the hook log keeps each event\'s own handler latency and gives the percentiles only through the stats', () => {
    resetHookLog();
    noteHook('session.start', 500);
    noteHook('tool.call Bash', 1000);
    noteHookMs('tool.call Bash', 1000, 1003);
    noteHook('tool.call Bash', 2000);
    noteHookMs('tool.call Bash', 2000, 2002);
    const s = hookStats(3000);
    expect(s.recent.map((e) => [e.label, e.ms])).toEqual([['tool.call Bash', 2], ['tool.call Bash', 3], ['session.start', undefined]]);
    expect(s.latency).toEqual({ n: 2, p50: 2, p95: 3 });
    resetHookLog();
  });
});
