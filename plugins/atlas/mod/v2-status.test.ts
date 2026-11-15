// v2-status.test.ts: the side panel's status tab, round W1 (items A-E of the round W spec): a stepper that agrees with its count (A), a real gates table (B), a full-width activity chart with a
// correct axis (C), no dead rows (D: the wired-hooks table, the RECENT log, chart growth) and the one-row CONTEXT / one-bar-per-run RUNS (E). The rows are read from the panel the way the host draws
// them: `panelLines` from the NOW ribbon down to the pinned footer, the host border removed. The tab strip and the ribbon above NOW are shared chrome and not part of this slice.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Ui } from './atlas-ui';
import { lineText, panelLines, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { NOW } from './live_fixture';
import { textWidth } from './theme';
import { BLOCKS } from './chart';
import { hookStats, noteHook, noteHookMs, resetHookLog, WIRED_HOOKS } from './hook-log';
import { ctxRunway } from './pulse';
import { chartSeries, hookTable } from './status-frame';
import type { Health, HealthCheck } from './idle-health';

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
    test(`${name}: every row fits, the footer is the last row, no two blank rows in a row, the row above the footer is content`, () => {
      const m = render(cols, kind, h(), bad);
      const lines = panelLines(m).map((l) => lineText(l));
      for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(m.cols);
      expect(lines.length).toBe(m.rows);
      expect(lines.at(-1)!.trimEnd()).toMatch(/^ {5}atlas 17\.23\.0 · master/);
      const rows = body(m);
      for (let i = 1; i < rows.length; i++) expect(rows[i] === '' && rows[i - 1] === '').toBe(false);
      expect(rows.at(-2)).not.toBe('');
    });
  }
  test('A: the stepper agrees with its count: passed ●, current ◆, pending ○; done fills every pip', () => {
    const working = body(render(W150, 'working', WORKING(false)));
    expect(working.find((l) => /\d\/6$/.test(l))).toMatch(/●●◆○○○ 3\/6$/);
    const done = body(render(W150, 'done', DONE()));
    expect(done.find((l) => /\d\/6$/.test(l))).toMatch(/●●●●●● 6\/6$/);
    const m = world(W150, 'working', WORKING(false));
    m.entered = ['research', 'test']; // a run that skipped `theory`: that pip stays open and is not counted
    expect(body(m).find((l) => /\d\/6$/.test(l))).toMatch(/●○◆○○○ 2\/6$/);
  });
  test('A: the pips are green when passed and violet when current', () => {
    const m = render(W150, 'working', WORKING(false));
    expect(runsOf(m, '●●').some((x) => x.tone === 'ok')).toBe(true);
    expect(runsOf(m, '◆').filter((x) => /^◆$/.test(x.t)).map((x) => x.tone)).toEqual(['accent']);
  });
  test('B: GATES is a table: the rule names the columns and every row ends in three 5-cell right-aligned cells under them', () => {
    for (const [, cols, kind, h, bad] of CASES) {
      const rows = body(render(cols, kind, h(), bad));
      const head = rows.find((l) => l.includes('── GATES'))!;
      expect(head).toMatch(/ pass deny last$/);
      const names = rows.filter((l) => /^ {5}[○●■] (completion|tripwire|routing|header)/.test(l));
      expect(names).toHaveLength(4);
      for (const r of names) {
        expect(textWidth(r)).toBe(textWidth(head));
        const cells = r.slice(-15);
        expect(cells).toMatch(/^ {1,4}\S+ {1,4}\S+ {1,4}\S+$/);
        expect(cells.slice(0, 5).trim()).toMatch(/^\d+$/);
        expect(cells.slice(5, 10).trim()).toMatch(/^\d+$/);
        expect(cells.slice(10).trim()).toMatch(/^(\d+[smh]|—)$/);
      }
    }
  });
  test('B: before any check a row is a hollow grey ○ with dim `0 0 —`; the word armed sits in no number column', () => {
    const m = render(W150, 'idle', IDLE(EV.idle, []));
    const rows = body(m);
    const gates = rows.filter((l) => /^ {5}○ (completion|tripwire|routing|header)/.test(l));
    expect(gates).toHaveLength(4);
    for (const r of gates) expect(r.slice(-15)).toBe('    0    0    —');
    expect(rows.filter((l) => /armed/.test(l)).map((l) => l.trim())).toEqual(['armed: 4 gates · 6 hooks · team off']);
    expect(runsOf(m, '○').every((x) => x.tone === 'sub')).toBe(true);
  });
  test('B: after the first prompt the rows count pass and deny and say when they last ran', () => {
    const rows = body(render(W150, 'working', WORKING(true), true));
    // round W N: `last` is each gate's own age (the newest event of the hook it runs on), or `—`: never one shared value. No classic.Stop event was seen, so completion and routing read `—`; the tripwire runs on tool.call (6 s).
    expect(rows.find((l) => /● completion/.test(l))!.slice(-15)).toBe('    1    0    —');
    expect(rows.find((l) => /■ routing/.test(l))!.slice(-15)).toBe('    7    1    —');
    expect(rows.find((l) => /tripwire/.test(l))!.slice(-15)).toBe('    1    0   6s');
    expect(rows.some((l) => /└ ■ Native Grep/.test(l))).toBe(true);
  });
  test('C: the chart spans the content width: one column per cell after the 4-cell indent and the 3-cell y gutter', () => {
    for (const cols of [W150, W110]) {
      const u = cols - 2;
      const rows = bodyRaw(render(cols, 'idle', IDLE([], [])));
      const base = rows.find((l) => /^ {5} 0┤/.test(l))!;
      expect(textWidth(base)).toBe(u + 1);
      expect([...base.slice(8)].filter((c) => c === BLOCKS[0]).length + [...base.slice(8)].filter((c) => c !== BLOCKS[0]).length).toBe(u - 7);
      expect([...base.slice(8)].every((c) => c === BLOCKS[0])).toBe(true); // idle: the dim zero glyph in every empty column, the band spark's own
    }
  });
  test('C: the y gutter reads the scale on the top row and 0 on the baseline; the x labels sit under the chart\'s first and last columns', () => {
    const u = W150 - 2;
    const rows = bodyRaw(render(W150, 'working', WORKING(false)));
    const top = rows.findIndex((l) => /^ {5}\s?\d+┤/.test(l));
    const base = rows.findIndex((l) => /^ {5} 0┤/.test(l));
    expect(top).toBeGreaterThan(0);
    expect(base - top).toBeGreaterThanOrEqual(2);
    expect(rows[top]!.slice(5, 8)).toMatch(/^ ?\d┤$|^\d\d┤$/);
    for (let i = top + 1; i < base; i++) expect(rows[i]!.slice(5, 8)).toBe('  │');
    const axis = rows[base + 1]!;
    expect(axis.indexOf('-4m')).toBe(8); // Y1b: the window is the session's age (185 s) rounded up to the next minute
    expect(axis.indexOf('now') + 3).toBe(u + 1);
    expect(axis).toContain('-2m');
    expect(axis.indexOf('-2m')).toBeGreaterThan(8 + 3);
    expect(axis.indexOf('-2m') + 3).toBeLessThan(axis.indexOf('now'));
  });
  test('C: the stats ride the section rule; idle with no events says waiting', () => {
    expect(body(render(W150, 'idle', IDLE([], []))).find((l) => l.includes('── ACTIVITY'))).toMatch(/0 ev · waiting$/);
    expect(body(render(W150, 'working', WORKING(false))).find((l) => l.includes('── ACTIVITY'))).toMatch(/── 15 ev · peak 5 \/ \d+(\.\d)?s · last 5s$/);
    expect(body(render(W150, 'working', WORKING(false))).some((l) => /no calls|^ {20,}\d+ ev$/.test(l))).toBe(false);
  });
  test('C: events are bucketed to the chart\'s width and aligned to the wall clock; the total is conserved', () => {
    const at = 1_000_000_000_000;
    const stamps = [at - 290_000, at - 100_000, at - 100_050, at - 3000, at - 10];
    const pulse = { events: [], ctx: [], runs: [], stamps, at };
    const a = chartSeries({ ...IDLE(EV.idle, []), upSecs: 300, pulse }, 40);
    expect(a.vals).toHaveLength(40);
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
  test('C: the chart grows from 3 rows by the free height, to 8 and only past it when nothing else can use the rows', () => {
    const count = (rows: number): number => {
      const t = body(render(W150, 'done', DONE(), false, rows));
      return t.findIndex((l) => /^ {5} 0┤/.test(l)) - t.findIndex((l) => /^ {5}\s?\d+┤/.test(l)) + 1;
    };
    expect(count(30)).toBeGreaterThanOrEqual(3);
    expect(count(30)).toBeLessThanOrEqual(count(36));
    expect(count(41)).toBeGreaterThanOrEqual(8);
    expect(count(41)).toBeLessThanOrEqual(12);
  });
  test('D: HOOKS lists every wired hook, fired or not, with count, p50, p95, last; a hook that never fired is dim 0 — — —', () => {
    const m = render(W150, 'idle', IDLE(EV.idle, [{ label: 'session.start', ageSecs: 41, ms: 2 }]));
    const rows = body(m);
    for (const name of WIRED_HOOKS) expect(rows.some((l) => l.trim().startsWith(name))).toBe(true);
    const never = rows.find((l) => l.trim().startsWith('prompt.submit'))!;
    expect(never).toMatch(/ 0 +— +— +—$/);
    expect(runsOf(m, 'prompt.submit').every((x) => x.tone === 'sub')).toBe(true);
    expect(rows.find((l) => l.includes('── HOOKS'))).toMatch(/p95 amber>100ms red>500ms$/);
    expect(rows.find((l) => /^ {5}hook /.test(l))).toMatch(/ n {3}p50 {3}p95 last$/);
  });
  test('D: a fired hook shows its own count, latency and age; the figures come from the hook log per kind', () => {
    resetHookLog();
    noteHook('tool.call Bash', 1000);
    noteHookMs('tool.call Bash', 1000, 1004);
    noteHook('tool.call Read', 2000);
    noteHookMs('tool.call Read', 2000, 2010);
    const h = health({ hooks: hookStats(5000) });
    const row = hookTable(h).find((x) => x.name === 'tool.call')!;
    expect(row).toEqual({ name: 'tool.call', n: 2, p50: 4, p95: 10, lastSecs: 3 });
    expect(hookTable(h).find((x) => x.name === 'prompt.submit')).toEqual({ name: 'prompt.submit', n: 0 });
    resetHookLog();
  });
  test('D: latency cells take amber over 100 ms and red over 500 ms, and nothing else does', () => {
    const hooks = { ...WORKING(false).hooks!, perHook: [{ label: 'tool.call', n: 6, p50: 40, p95: 120, lastSecs: 5 }, { label: 'turn.complete', n: 1, p50: 90, p95: 600, lastSecs: 9 }, { label: 'classic.Stop', n: 1, p50: 100, p95: 100, lastSecs: 9 }] };
    const m = render(W150, 'working', { ...WORKING(false), hooks });
    const tone = (t: string): string | undefined => runsOf(m, t).find((x) => x.t.trim() === t)?.tone;
    expect(tone('120ms')).toBe('warn');
    expect(tone('600ms')).toBe('bad');
    expect(tone('40ms')).toBe('text');
    expect(tone('90ms')).toBe('text');
    expect(runsOf(m, '100ms').filter((x) => x.t.trim() === '100ms').every((x) => x.tone === 'text')).toBe(true);
  });
  test('D: rows past the sections go to the RECENT log of real events', () => {
    const rows = body(render(W150, 'done', DONE(), false, 49));
    expect(rows.some((l) => l.includes('── RECENT'))).toBe(true);
    expect(rows.filter((l) => /^ {5}\d+s [·●■] /.test(l)).length).toBeGreaterThanOrEqual(3);
  });
  test('E: CONTEXT is one row: the gauge and `6% · 64k of 1M · +Nk/turn`, the runway on the rule', () => {
    const rows = body(render(W150, 'working', WORKING(false)));
    const i = rows.findIndex((l) => l.includes('── CONTEXT'));
    expect(rows[i]).toMatch(/~78 turns left$/);
    expect(rows[i + 1]).toBe('     ▰▱▱▱▱▱▱▱▱▱▱▱ 6% · 64k of 1M · +12k/turn');
    expect(rows[i + 2]).toBe('');
  });
  test('E: RUNS is one bar per run scaled to the longest, green ok and red failed, then the figures', () => {
    const m = render(W150, 'done', DONE());
    const rows = body(m);
    const i = rows.findIndex((l) => l.includes('── RUNS'));
    expect(rows[i + 1]).toMatch(/^ {5}[▁-█]{3} {2}3 runs · med 0:42 · p90 0:58 · 1 failed$/);
    const bars = panelLines(m).map((l) => l.runs).find((rs) => rs.some((x) => /^[▁-█]+$/.test(x.t) && x.tone === 'ok'))!;
    expect(bars.some((x) => x.tone === 'bad')).toBe(true);
  });
  test('GATES say armed in NOW until the first prompt; CONTEXT is absent before the first measure and amber at 70% and over', () => {
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
  test('a short pane gives HOOKS rows up first, then RUNS, then the gate children, then CONTEXT; NOW and the footer stay', () => {
    const hooks = (m: PanelModel): number => body(m).filter((l) => WIRED_HOOKS.some((n) => l.trim().startsWith(n))).length;
    let sawCut = false;
    let sawNoRuns = false;
    let sawNoContext = false;
    for (let rows = 41; rows >= 14; rows--) {
      const m = world(48, 'done', DONE(), false, rows);
      const t = body(m);
      const runs = t.some((l) => l.includes('── RUNS'));
      const ctx = t.some((l) => l.includes('── CONTEXT'));
      if (!runs) expect(hooks(m)).toBeLessThanOrEqual(1); // RUNS goes only after the hooks rows are down to one
      if (!ctx) expect(runs).toBe(false); // CONTEXT goes last
      if (hooks(m) < WIRED_HOOKS.length && runs) sawCut = true;
      if (!runs) sawNoRuns = true;
      if (!ctx) sawNoContext = true;
      expect(t.some((l) => l.includes('── NOW'))).toBe(true);
      expect(panelLines(m).map((l) => lineText(l).trimEnd()).at(-1)).toMatch(/atlas 17\.23\.0 · master/);
      expect(panelLines(m).length).toBe(rows);
    }
    expect(sawCut && sawNoRuns && sawNoContext).toBe(true);
  });
});
