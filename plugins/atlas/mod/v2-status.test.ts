// v2-status.test.ts: the side panel's status tab against frames S1, S1b and S2-S8 of the approved frame spec (critics/mock-final.md section 4). Every expected row below is the spec's own text
// (the host border `│` removed, trailing blanks trimmed); the rendered rows from the NOW ribbon down to the pinned footer must equal it exactly, at 150 (U=46) and 110 (U=39) for idle, working, done and denial.
// The tab strip and the ribbon above NOW are shared chrome (every tab, omp, the goldens) and are not part of this slice; the frames are cut at the NOW ribbon.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Ui } from './atlas-ui';
import { lineText, panelLines, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { NOW } from './live_fixture';
import { textWidth } from './theme';
import { hookStats, noteHook, noteHookMs, resetHookLog } from './hook-log';
import { ctxRunway } from './pulse';
import type { Health, HealthCheck } from './idle-health';

const FRAMES: Record<string, string[]> = {
 "S1": [
  " ── NOW ───────────────────────────────────────",
  "     ◌ idle · no prompt yet",
  "     armed: 4 gates · 6 hooks · team off",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                                           1 ev",
  "                                     peak 1/15s",
  "       ────────────────▆───            no calls",
  "     0└5m───────────────now",
  "",
  " ── GATES ──────────────────── checks   ok fail",
  "     ○ completion                       1 armed",
  "     ○ tripwire                         1 armed",
  "     ○ routing                          8 armed",
  "     ○ header                           1 armed",
  "",
  " ── HOOKS ──────────────────────── 1 seen · 2ms",
  "     41s  session.start                     2ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master"
 ],
 "S1b": [
  " ── NOW ───────────────────────────────────────",
  "     ◌ idle · no prompt yet",
  "     armed: 4 gates · 6 hooks · team off",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                                           1 ev",
  "                                     peak 1/15s",
  "       ───────────────▆────            no calls",
  "     0└5m───────────────now",
  "",
  " ── GATES ──────────────────── checks   ok fail",
  "     ○ completion                       1 armed",
  "     ○ tripwire                         1 armed",
  "     ○ routing                          8 armed",
  "     ○ header                           1 armed",
  "",
  " ── HOOKS ──────────────────────── 1 seen · 2ms",
  "     56s  session.start                     2ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master"
 ],
 "S2": [
  " ── NOW ────────────────────────────────",
  "     ◌ idle · no prompt yet",
  "     armed: 4 gates · 6 hooks · team off",
  "",
  " ── ACTIVITY ─────── hook events · 5 min",
  "                                    1 ev",
  "                              peak 1/15s",
  "       ────────────────▆───     no calls",
  "     0└5m───────────────now",
  "",
  " ── GATES ───────────── checks   ok fail",
  "     ○ completion                1 armed",
  "     ○ tripwire                  1 armed",
  "     ○ routing                   8 armed",
  "     ○ header                    1 armed",
  "",
  " ── HOOKS ───────────────── 1 seen · 2ms",
  "     41s  session.start              2ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master"
 ],
 "S3": [
  " ── NOW ─────────────────────────────── up 3:05",
  "     ◐ test                          ●●◆○○○ 3/6",
  "     Bash · 6 tools · item 1/5 done",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                         █                15 ev",
  "                 ▂▂▂     █▂          peak 5/15s",
  "       ───────▅──███────▅██             last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ───────────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%             ~78 turns left",
  "     +12k/turn",
  "",
  " ── GATES ──────────────────── checks   ok fail",
  "     ● completion                        1    0",
  "     ● tripwire                          1    0",
  "     ● routing                           8    0",
  "     ● header                            1    0",
  "",
  " ── HOOKS ─────────────────────── 15 seen · 3ms",
  "      5s  session.measure                   2ms",
  "      6s  tool.call Bash ×2                 3ms",
  "     12s  tool.call Edit                    5ms",
  "     15s  tool.call Bash                    2ms",
  "     17s  tool.call Read                    3ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master          cost $0.01"
 ],
 "S4": [
  " ── NOW ──────────────────────── up 3:05",
  "     ◐ test                   ●●◆○○○ 3/6",
  "     Bash · 6 tools · item 1/5 done",
  "",
  " ── ACTIVITY ─────── hook events · 5 min",
  "                         █         15 ev",
  "                 ▂▂▂     █▂   peak 5/15s",
  "       ───────▅──███────▅██      last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%      ~78 turns left",
  "     +12k/turn",
  "",
  " ── GATES ───────────── checks   ok fail",
  "     ● completion                 1    0",
  "     ● tripwire                   1    0",
  "     ● routing                    8    0",
  "     ● header                     1    0",
  "",
  " ── HOOKS ──────────────── 15 seen · 3ms",
  "      5s  session.measure            2ms",
  "      6s  tool.call Bash ×2          3ms",
  "     12s  tool.call Edit             5ms",
  "     15s  tool.call Bash             2ms",
  "     17s  tool.call Read             3ms",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master   cost $0.01"
 ],
 "S5": [
  " ── NOW ─────────────────────────────── up 6:12",
  "     ● done                          ●●●●●● 6/6",
  "     11 tools · ended 12s ago",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                         █                26 ev",
  "           ▄           █▄█           peak 6/15s",
  "       ──█████─────▄──▄███─            last 10s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ───────────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%            ~156 turns left",
  "     ▂▂▅██ +6k/turn",
  "",
  " ── RUNS ─────────────────────────────── 3 runs",
  "     ▅█▆  med 0:42 · max 0:58 · 1 failed",
  "",
  " ── GATES ──────────────────── checks   ok fail",
  "     ● completion                        1    0",
  "     ● tripwire                          1    0",
  "     ● routing                           8    0",
  "     ● header                            1    0",
  "",
  " ── HOOKS ───────── 34 seen · p50 3ms · p95 5ms",
  "     10s  tool.call Bash                    3ms",
  "     11s  session.measure                   1ms",
  "     12s  turn.complete                     4ms",
  "     14s  tool.call Edit                    2ms",
  "     18s  tool.call Read                    3ms",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master          cost $0.01"
 ],
 "S6": [
  " ── NOW ──────────────────────── up 6:12",
  "     ● done                   ●●●●●● 6/6",
  "     11 tools · ended 12s ago",
  "",
  " ── ACTIVITY ─────── hook events · 5 min",
  "                         █         26 ev",
  "           ▄           █▄█    peak 6/15s",
  "       ──█████─────▄──▄███─     last 10s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%     ~156 turns left",
  "     ▂▂▅██ +6k/turn",
  "",
  " ── RUNS ──────────────────────── 3 runs",
  "     ▅█▆  med 0:42 · max 0:58 · 1 failed",
  "",
  " ── GATES ───────────── checks   ok fail",
  "     ● completion                 1    0",
  "     ● tripwire                   1    0",
  "     ● routing                    8    0",
  "     ● header                     1    0",
  "",
  " ── HOOKS ── 34 seen · p50 3ms · p95 5ms",
  "     10s  tool.call Bash             3ms",
  "     11s  session.measure            1ms",
  "     12s  turn.complete              4ms",
  "     14s  tool.call Edit             2ms",
  "     18s  tool.call Read             3ms",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master   cost $0.01"
 ],
 "S7": [
  " ── NOW ─────────────────────────────── up 3:05",
  "     ◐ test                          ●●◆○○○ 3/6",
  "     ■ 2 calls denied · Native Grep",
  "     fix: use ctx_search",
  "",
  " ── ACTIVITY ────────────── hook events · 5 min",
  "                         █                15 ev",
  "                 ▂▂▂     █▂          peak 5/15s",
  "       ───────▅──███────▅██             last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ───────────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%             ~78 turns left",
  "     +12k/turn",
  "",
  " ── GATES ──────────────────── checks   ok fail",
  "     ● completion                        1    0",
  "     ● tripwire                          1    0",
  "     ■ routing                           7    1",
  "      └ ■ Native Grep calls      2 calls denied",
  "          fix: use ctx_search",
  "     ● header                            1    0",
  "",
  " ── HOOKS ─────────────────────── 15 seen · 3ms",
  "      5s  session.measure                   2ms",
  "      6s  tool.call Bash ×2                 3ms",
  "     12s  tool.call Edit                    5ms",
  "     15s  tool.call Bash                    2ms",
  "     17s  tool.call Read                    3ms",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master          cost $0.01"
 ],
 "S8": [
  " ── NOW ──────────────────────── up 3:05",
  "     ◐ test                   ●●◆○○○ 3/6",
  "     ■ 2 calls denied · Native Grep",
  "     fix: use ctx_search",
  "",
  " ── ACTIVITY ─────── hook events · 5 min",
  "                         █         15 ev",
  "                 ▂▂▂     █▂   peak 5/15s",
  "       ───────▅──███────▅██      last 5s",
  "     0└5m───────────────now",
  "",
  " ── CONTEXT ────────────────── 64k of 1M",
  "     ▰▱▱▱▱▱▱▱▱▱▱▱ 6%      ~78 turns left",
  "     +12k/turn",
  "",
  " ── GATES ───────────── checks   ok fail",
  "     ● completion                 1    0",
  "     ● tripwire                   1    0",
  "     ■ routing                    7    1",
  "      └ ■ Native Grep c…  2 calls denied",
  "          fix: use ctx_search",
  "     ● header                     1    0",
  "",
  " ── HOOKS ──────────────── 15 seen · 3ms",
  "      5s  session.measure            2ms",
  "      6s  tool.call Bash ×2          3ms",
  "     12s  tool.call Edit             5ms",
  "     15s  tool.call Bash             2ms",
  "     17s  tool.call Read             3ms",
  "",
  "",
  "",
  "",
  "",
  "     atlas 17.23.0 · master   cost $0.01"
 ]
};

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

const world = (cols: number, kind: 'idle' | 'working' | 'done', h: Health, bad = false): PanelModel =>
  panelWorld('route', cols, ui, {
    rows: 39, phases: PHASES, phase: kind === 'working' ? 'test' : 'research', entered: kind === 'working' ? ['research', 'theory', 'test'] : [],
    todos: kind === 'working' ? [1, 2, 3, 4, 5].map((n) => ({ id: `T${n}`, label: `item ${n}`, state: n === 1 ? 'done' : 'queued' })) : [], workers: [], notes: [],
    gates: gateGroups(bad), run: { kind, secs: 5, startMs: NOW, frame: 0 }, health: h,
  } as never);

/** The rows from the NOW ribbon to the pinned footer, trailing blanks trimmed. */
const body = (m: PanelModel): string[] => {
  const t = panelLines(m).map((l) => lineText(l).trimEnd());
  return t.slice(t.findIndex((l) => l.includes('── NOW')));
};

const CASES: [string, number, () => PanelModel][] = [];
const add = (name: string, cols: number, kind: 'idle' | 'working' | 'done', h: () => Health, bad = false): void => { CASES.push([name, cols, () => world(cols === 150 ? 48 : 41, kind, h(), bad)]); };
add('S1', 150, 'idle', () => IDLE(EV.idle, [{ label: 'session.start', ageSecs: 41, ms: 2 }]));
add('S1b', 150, 'idle', () => ({ ...IDLE(EV.idleLater, [{ label: 'session.start', ageSecs: 56, ms: 2 }]), upSecs: 56 }));
add('S2', 110, 'idle', () => IDLE(EV.idle, [{ label: 'session.start', ageSecs: 41, ms: 2 }]));
add('S3', 150, 'working', () => WORKING(false));
add('S4', 110, 'working', () => WORKING(false));
add('S5', 150, 'done', DONE);
add('S6', 110, 'done', DONE);
add('S7', 150, 'working', () => WORKING(true), true);
add('S8', 110, 'working', () => WORKING(true), true);

describe('the status tab is the spec frame S1-S8', () => {
  for (const [name, cols, model] of CASES) {
    test(`${name}: ${cols === 150 ? '150' : '110'} columns, rows from NOW to the footer equal the frame`, () => {
      const m = model();
      expect(body(m)).toEqual(FRAMES[name]!);
    });
  }
  test('every row is within U usable cells and the footer is the pane\'s last row', () => {
    for (const [, cols, model] of CASES) {
      const m = model();
      const lines = panelLines(m).map((l) => lineText(l));
      for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(m.cols);
      expect(lines.at(-1)!.trimEnd()).toMatch(/^ {5}atlas 17\.23\.0 · master/);
      expect(lines.length).toBe(m.rows);
    }
  });
});

describe('the data behind the frames', () => {
  test('GATES say armed until the first prompt, then count; the rule stays honest', () => {
    const m = world(48, 'idle', IDLE(EV.idle, []));
    expect(body(m).filter((l) => /armed/.test(l)).map((l) => l.trim())).toEqual(['armed: 4 gates · 6 hooks · team off', '○ completion                       1 armed', '○ tripwire                         1 armed', '○ routing                          8 armed', '○ header                           1 armed']);
  });
  test('CONTEXT is absent before the first measure, and amber at 70% and over', () => {
    const none = world(48, 'idle', IDLE(EV.idle, []));
    expect(body(none).some((l) => l.includes('CONTEXT'))).toBe(false);
    const hot = world(48, 'working', { ...WORKING(false), ctxPct: 72, tokens: 720_000 });
    const runs = panelLines(hot).flatMap((l) => l.runs).filter((x) => x.t.includes('▰'));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((x) => x.tone === 'warn')).toBe(true);
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
  test('hook p50 of 50 ms or more is amber; below it is not', () => {
    const slow = world(48, 'working', { ...WORKING(false), hooks: { ...WORKING(false).hooks!, latency: { n: 15, p50: 61, p95: 90 } } });
    const meta = panelLines(slow).flatMap((l) => l.runs).find((x) => x.t === '61ms');
    expect(meta?.tone).toBe('warn');
    const fast = panelLines(world(48, 'working', WORKING(false))).flatMap((l) => l.runs).find((x) => x.t === '3ms');
    expect(fast?.tone).not.toBe('warn');
  });
  test('a short pane gives HOOKS rows up first, then RUNS, then the gate children; NOW and the footer stay', () => {
    const tall = world(48, 'done', DONE());
    tall.rows = 39;
    const short = world(48, 'done', DONE());
    short.rows = 33;
    const shorter = world(48, 'done', DONE());
    shorter.rows = 28;
    const hooks = (m: PanelModel): number => body(m).filter((l) => /^ {5,6}\d+s {2}/.test(l)).length;
    expect(hooks(tall)).toBe(5);
    expect(hooks(short)).toBeLessThan(5);
    expect(body(short).some((l) => l.includes('RUNS'))).toBe(true);
    expect(body(shorter).some((l) => l.includes('RUNS'))).toBe(false);
    for (const m of [tall, short, shorter]) {
      expect(body(m).some((l) => l.includes('── NOW'))).toBe(true);
      expect(panelLines(m).map((l) => lineText(l).trimEnd()).at(-1)).toMatch(/atlas 17\.23\.0 · master/);
      expect(panelLines(m).length).toBe(m.rows);
    }
  });
});
