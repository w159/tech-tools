// Round Y1: the persisted history (Y1a), the chart window that fits the data (Y1b), one age per state (Y1c) and the narrow idle strip (Y1d), as pure frames and models.
// The live wiring (boot read, writes, the strip in the slot, the click) is y1-live.test.ts.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface } from 'claude-code';
import { uiFromEnv, type Run, type Ui } from '../../atlas-ui';
import { bandFrameRuns } from '../band/band-frame';
import { cardFrame } from './card-frame';
import { composeHistory, emptyHistory, flushHistory, HIST_LAT, HIST_MINUTES, HIST_RUNS, historyView, loadHistory, noteHistoryCtx, noteHistoryRun, parseHistory, resetHistory, serializeHistory, type History } from '../../data/history';
import { eventMinutes, hookStats, noteHook, noteHookMs, resetHookLog, seedHookLatency } from '../../host/hook-log';
import type { Health, HealthCheck } from '../../data/idle-health';
import { bucketLabel, chartMinutes, roundBucket, chartSeries, frameKit, runFigures, statusActivityRows, statusFrame, statusHooksRows, statusRunsRows, type StatusIn } from './status-frame';
import { healthStripRows, STRIP_BELOW_COLS, stripWanted } from './strip-frame';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const text = (r: readonly Run[]): string => r.map((x) => x.t).join('');
const rowsText = (rows: readonly (readonly Run[])[]): string[] => rows.map((r) => text(r).trimEnd());
const checks: HealthCheck[] = ['completion', 'tripwire', 'routing', 'header'].map((id) => ({ id, ok: true, lines: 1, pass: 1 }));
const health = (o: Partial<Health> = {}): Health => ({ gates: { total: 4, green: 4, checks }, version: '17.23.0', branch: 'master', team: 'off', ...o });
const AT = 1_000_000_000_000;
const mins = (n: number): number => Math.floor(AT / 60_000) - n;

// ---- Y1a: the file ------------------------------------------------------------------------------------------------------------------------------------------------------------------

const SAMPLE: History = {
  v: 1,
  runs: [{ secs: 41, ok: true, tools: 6, at: 1 }, { secs: 80, ok: false, tools: 9, at: 2 }],
  lat: { 'tool.call': [3, 5, 8], 'classic.Stop': [4] },
  min: [{ m: 10, n: 3 }, { m: 12, n: 7 }],
  ctx: { at: 5, pcts: [4, 6] },
  gates: [],
};

describe('Y1a: the history file', () => {
  test('a history survives the round trip through its text unchanged', () => {
    expect(parseHistory(serializeHistory(SAMPLE))).toEqual(SAMPLE);
    expect(parseHistory(serializeHistory(emptyHistory()))).toEqual(emptyHistory());
  });

  test('a missing, empty or corrupt file is an empty history and never throws', () => {
    for (const bad of [undefined, null, '', '   ', '{', 'not json', 'null', '[]', '42', '"x"', '{"runs":"x","lat":[],"min":7,"ctx":"y"}', '\u0000\u0001', '{"v":1,"runs":[null,1,"a",{}]}']) {
      expect(() => parseHistory(bad)).not.toThrow();
      expect(parseHistory(bad)).toEqual(emptyHistory());
    }
  });

  test('a file with some good entries keeps those and drops the rest', () => {
    const h = parseHistory(JSON.stringify({
      v: 1,
      runs: [{ secs: 5, ok: true, tools: 2, at: 1 }, { secs: -3, ok: true, at: 2 }, { secs: 'x', ok: true, at: 3 }, { secs: 7, ok: 'yes', at: 4 }, null, { secs: 9, ok: false, at: 5 }],
      lat: { 'tool.call': [1, 'x', -4, null, 6], bad: 'nope', empty: [] },
      min: [{ m: 4, n: 2 }, { m: 'z', n: 1 }, { m: 3, n: 0 }, { m: 2, n: 9 }],
      ctx: { at: 9, pcts: [3, 400, 'q', 8] },
    }));
    expect(h.runs.map((r) => r.secs)).toEqual([5, 9]);
    expect(h.runs[1]!.tools).toBe(0);
    expect(h.lat).toEqual({ 'tool.call': [1, 6] });
    expect(h.min).toEqual([{ m: 2, n: 9 }, { m: 4, n: 2 }]);
    expect(h.ctx).toEqual({ at: 9, pcts: [3, 8] });
  });

  test('the file is bounded: 50 runs, 64 latency samples per hook, 60 minutes', () => {
    const big = parseHistory(JSON.stringify({
      v: 1,
      runs: Array.from({ length: 80 }, (_, i) => ({ secs: i, ok: true, tools: 1, at: i })),
      lat: { 'tool.call': Array.from({ length: 200 }, (_, i) => i) },
      min: Array.from({ length: 150 }, (_, i) => ({ m: i, n: 1 })),
    }));
    expect(big.runs).toHaveLength(HIST_RUNS);
    expect(big.runs[0]!.secs).toBe(30); // the newest 50 stay
    expect(big.lat['tool.call']).toHaveLength(HIST_LAT);
    expect(big.lat['tool.call']!.at(-1)).toBe(199);
    expect(big.min).toHaveLength(HIST_MINUTES);
    expect(big.min.at(-1)!.m).toBe(149);
  });

  test('this session joins the loaded part: runs append, the hook rings continue the persisted ones, minutes sum', () => {
    resetHookLog();
    resetHistory(AT);
    seedHookLatency({ 'tool.call': [5, 6] });
    noteHook('tool.call Bash', AT);
    noteHookMs('tool.call Bash', AT, AT + 9);
    noteHook('prompt.submit', AT + 1000);
    noteHistoryRun({ secs: 12, ok: true, tools: 3, at: AT + 2000 });
    noteHistoryCtx([5, 7], AT + 3000);
    const h = composeHistory(AT + 5000);
    expect(h.runs).toEqual([{ secs: 12, ok: true, tools: 3, at: AT + 2000 }]);
    expect(h.lat['tool.call']).toEqual([5, 6, 9]);
    expect(h.min).toEqual([{ m: Math.floor(AT / 60_000), n: 2 }]);
    expect(h.ctx).toEqual({ at: AT + 3000, pcts: [5, 7] });
    expect(eventMinutes()).toEqual([{ m: Math.floor(AT / 60_000), n: 2 }]);
  });

  test('what the surfaces read as `prev` is the earlier sessions only, minutes before this session within the hour', () => {
    resetHookLog();
    const fake = fakeEngine({ '/p/.atlas/.run/history.json': serializeHistory({ ...SAMPLE, min: [{ m: mins(90), n: 4 }, { m: mins(30), n: 2 }, { m: mins(3), n: 1 }, { m: mins(0), n: 5 }] }) });
    return loadHistory(fake.$, '/p', AT).then(() => {
      const v = historyView(AT + 1000)!;
      expect(v.runs).toHaveLength(2);
      expect(v.minutes).toEqual([{ m: mins(30), n: 2 }, { m: mins(3), n: 1 }]); // the 90-minute-old minute fell out of the hour; the session's own minute is not `prev`
      expect(v.ctx).toEqual(SAMPLE.ctx!);
    });
  });
});

type Files = Record<string, string>;
function fakeEngine(files: Files) {
  const writes: string[] = [];
  const $ = {
    fs: {
      read: async (p: string) => { if (p in files) return files[p]!; throw new Error('missing'); },
      write: async (p: string, t: string) => { files[p] = t; writes.push(p); },
      exists: async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
    },
    process: {
      run: async (argv: string[]) => {
        if (argv[0] === 'mv') { files[argv[3]!] = files[argv[2]!]!; delete files[argv[2]!]; }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    },
  } as unknown as EngineInterface;
  return { $, files, writes };
}

describe('Y1a: reading and writing the file under the project root', () => {
  test('loads the file at start, writes it atomically (temp file, then mv) and a second session reads what the first wrote', async () => {
    resetHookLog();
    const files: Files = { '/p/.atlas/todos': '' };
    const a = fakeEngine(files);
    await loadHistory(a.$, '/p', AT);
    expect(historyView(AT)).toBeUndefined(); // a first-ever session has nothing prev
    noteHook('tool.call Bash', AT);
    noteHookMs('tool.call Bash', AT, AT + 4);
    noteHistoryRun({ secs: 30, ok: true, tools: 2, at: AT + 100 });
    await flushHistory(a.$, '/p', AT + 200, true);
    expect(a.writes).toEqual(['/p/.atlas/.run/history.json.tmp']); // the temp file is what the engine wrote; mv put it in place
    expect(Object.keys(files)).not.toContain('/p/.atlas/.run/history.json.tmp');
    const onDisk = parseHistory(files['/p/.atlas/.run/history.json']);
    expect(onDisk.runs.map((r) => r.secs)).toEqual([30]);
    expect(onDisk.lat['tool.call']).toEqual([4]);
    // the next session
    resetHookLog();
    const b = fakeEngine(files);
    await loadHistory(b.$, '/p', AT + 3_600_000);
    expect(historyView(AT + 3_600_000)!.runs.map((r) => r.secs)).toEqual([30]);
    expect(hookStats(AT + 3_600_000).perHook?.find((x) => x.label === 'tool.call')).toMatchObject({ n: 0, p50: 4, p95: 4, prev: true });
  });

  test('a corrupt file starts an empty history and is replaced by the next write', async () => {
    resetHookLog();
    const files: Files = { '/p/.atlas/.run/history.json': '{"runs": [' };
    const e = fakeEngine(files);
    await loadHistory(e.$, '/p', AT);
    expect(historyView(AT)).toBeUndefined();
    noteHistoryRun({ secs: 3, ok: false, tools: 0, at: AT });
    await flushHistory(e.$, '/p', AT, true);
    expect(parseHistory(files['/p/.atlas/.run/history.json']).runs).toHaveLength(1);
  });

  test('no root, no .atlas directory or a failing engine writes nothing and never throws', async () => {
    resetHookLog();
    resetHistory(AT);
    noteHistoryRun({ secs: 3, ok: true, tools: 0, at: AT });
    const none = fakeEngine({});
    await flushHistory(none.$, '', AT, true);
    await flushHistory(none.$, null, AT, true);
    await flushHistory(none.$, '/p', AT, true); // no /p/.atlas: nothing is created in a project that never used Atlas
    expect(none.writes).toEqual([]);
    const broken = { fs: { exists: async () => true, write: async () => { throw new Error('disk full'); } }, process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) } } as unknown as EngineInterface;
    await expect(flushHistory(broken, '/p', AT + 20_000, true)).resolves.toBeUndefined();
    const reader = { fs: { read: async () => { throw new Error('denied'); } } } as unknown as EngineInterface;
    await expect(loadHistory(reader, '/p', AT)).resolves.toBeUndefined();
  });

  test('an unchanged history is not written again and the interval holds back a changed one', async () => {
    resetHookLog();
    const files: Files = { '/p/.atlas/x': '' };
    const e = fakeEngine(files);
    await loadHistory(e.$, '/p', AT);
    noteHistoryRun({ secs: 3, ok: true, tools: 0, at: AT });
    await flushHistory(e.$, '/p', AT, true);
    await flushHistory(e.$, '/p', AT + 20_000);
    expect(e.writes).toHaveLength(1); // same text
    noteHistoryRun({ secs: 4, ok: true, tools: 0, at: AT + 1 });
    await flushHistory(e.$, '/p', AT + 21_000);
    expect(e.writes).toHaveLength(2); // changed, and the interval since the last write has passed
    noteHistoryRun({ secs: 5, ok: true, tools: 0, at: AT + 2 });
    await flushHistory(e.$, '/p', AT + 25_000); // inside the 10 s interval
    expect(e.writes).toHaveLength(2);
    await flushHistory(e.$, '/p', AT + 32_000);
    expect(e.writes).toHaveLength(3);
  });
});

describe('Y1a: the hook latency ring reads the persisted samples', () => {
  test('p50 and p95 come from the last 64 calls of a hook across sessions; the figure is `prev` until this session stamps one', () => {
    resetHookLog();
    seedHookLatency({ 'tool.call': [10, 20, 30, 40], 'prompt.submit': Array.from({ length: 70 }, (_, i) => i) });
    const first = hookStats(AT);
    expect(first.perHook?.find((x) => x.label === 'tool.call')).toMatchObject({ n: 0, p50: 20, p95: 40, prev: true });
    expect(first.perHook?.find((x) => x.label === 'prompt.submit')?.p95).toBe(66); // 70 seeded samples keep their newest 64 (6..69); nearest-rank p95 of those is 66
    expect(first.latency?.n).toBe(4 + 64);
    noteHook('tool.call Bash', AT);
    noteHookMs('tool.call Bash', AT, AT + 50);
    const now = hookStats(AT + 1000).perHook?.find((x) => x.label === 'tool.call')!;
    expect(now.n).toBe(1);
    expect(now.prev).toBeUndefined();
    expect(now.p95).toBe(50);
  });
});

// ---- Y1a: RUNS and HOOKS on an idle session ------------------------------------------------------------------------------------------------------------------------------------

describe('Y1a: idle RUNS and HOOKS are the persisted figures, labelled', () => {
  const kit = frameKit(ui, 46);
  const prevRuns = Array.from({ length: 12 }, (_, i) => ({ secs: 20 + i * 5, ok: i !== 4, tools: 3, at: i }));

  test('RUNS: bars for the earlier sessions` runs, `12 runs · med · p90 · 1 failed`, the rule says prev', () => {
    const rows = rowsText(statusRunsRows(kit, health({ hist: { runs: prevRuns, minutes: [] } })));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/── RUNS ─+ prev$/);
    expect(rows[1]).toMatch(/^ {5}[▁-█]{12} {2}12 runs · 1 failed$/); // the figures narrow from the right at 46 cells
    const wide = rowsText(statusRunsRows(frameKit(ui, 70), health({ hist: { runs: prevRuns, minutes: [] } })));
    const f = runFigures(prevRuns.map((r) => r.secs));
    expect(f.med).toBeGreaterThan(0);
    expect(wide[1]).toMatch(/12 runs · med \d:\d\d · p90 \d:\d\d · 1 failed$/);
  });

  test('RUNS: this session`s runs join the earlier ones and the rule says how many are prev; none at all is no section', () => {
    const rows = rowsText(statusRunsRows(kit, health({ hist: { runs: prevRuns.slice(0, 3), minutes: [] }, pulse: { events: [], ctx: [], runs: [{ secs: 9, ok: true, at: 1 }] } })));
    expect(rows[0]).toMatch(/── RUNS ─+ \+3 prev$/);
    expect(rows[1]).toContain('4 runs');
    expect(statusRunsRows(kit, health())).toEqual([]); // a first-ever session: the honest empty state
  });

  test('HOOKS: the latency columns come from the persisted ring (`last 64 calls`) while this session has no call', () => {
    const h = health({ hooks: { total: 1, byLabel: [{ label: 'session.start', n: 1 }], recent: [], perHook: [{ label: 'session.start', n: 1 }, { label: 'tool.call', n: 0, p50: 8, p95: 13, samples: 12, prev: true }] } });
    const rows = statusHooksRows(frameKit(ui, 60), h);
    expect(text(rows[1]!)).toMatch(/hook · last 64 calls +n +p50 +p95 +last/);
    const tool = rows.find((r) => text(r).includes('tool.call'))!;
    expect(text(tool)).toMatch(/tool\.call +0 +8ms +13ms +prev$/); // AA4: the persisted row is tagged `prev` and dimmed
    const cells = tool.filter((x) => x.t.trim() === '8ms' || x.t.trim() === '13ms');
    expect(cells).toHaveLength(2);
    for (const c of cells) expect(c.tone).toBe('sub'); // AA4: an earlier session's row is dimmed whole, the figures read grey
  });

  test('HOOKS: with nothing fired and no latency anywhere idle is one summary line (AA4)', () => {
    const rows = statusHooksRows(frameKit(ui, 60), health());
    expect(rowsText(rows)[1]).toMatch(/^ {5}○ 6 hooks wired · none fired yet$/);
  });
});

// ---- Y1b: the chart window ------------------------------------------------------------------------------------------------------------------------------------------------------

describe('Y1b: the chart window fits the data', () => {
  const kit = frameKit(ui, 46);
  const stampsOf = (counts: Record<number, number>): number[] => Object.entries(counts).flatMap(([ago, n]) => Array.from({ length: n }, () => AT - Number(ago)));
  const withAge = (upSecs: number, stamps: number[] = [], extra: Partial<Health> = {}): Health => health({ upSecs, pulse: { events: [], ctx: [], runs: [], stamps, at: AT }, ...extra });
  const axisOf = (h: Health, rows = 3): string => text(statusActivityRows(kit, h, rows).at(-1)!).trimEnd();

  test('the window is the session age rounded up to the next minute, 2 to 30 minutes (5 when the age is unknown)', () => {
    const w = (upSecs: number | undefined): number => chartMinutes({ upSecs } as Health);
    expect([0, 11, 60, 61, 119, 120, 121, 185, 1790, 1800, 1801, 7200].map(w)).toEqual([2, 2, 2, 2, 2, 2, 3, 4, 30, 30, 30, 30]);
    expect(w(undefined)).toBe(5);
  });

  test('the x labels follow the real window: `-3m ... now`, no fixed `-5m`', () => {
    for (const [age, first, mid] of [[30, '-2m', '-1m'], [150, '-3m', '-1.5m'], [185, '-4m', '-2m'], [1000, '-17m', '-8.5m'], [5000, '-30m', '-15m']] as const) {
      const axis = axisOf(withAge(age));
      expect(axis.indexOf(first)).toBe(8 + chartSeries(withAge(age), 46 - 4 - 3).pad); // under the first drawn column (Y2f: the chart is right-aligned)
      expect(axis).toContain(mid);
      expect(axis.endsWith('now')).toBe(true);
      expect(axis).not.toContain('-5m');
    }
  });

  test('a stamp older than the window is out of it and one inside is in, at every window', () => {
    for (const [age, windowMs] of [[30, 120_000], [250, 300_000], [1500, 1_500_000]] as const) {
      const inside = chartSeries(withAge(age, [AT - windowMs + windowMs / 10, AT - 10]), 40);
      const outside = chartSeries(withAge(age, [AT - windowMs - 5000]), 40);
      expect(inside.total).toBe(2);
      expect(outside.total).toBe(0);
      expect(inside.bucketSecs).toBe(roundBucket(windowMs / 1000, 40)); // Y2f: a round bucket, the smallest that fits the window in 40 columns
      expect(inside.vals).toHaveLength(Math.ceil(windowMs / 1000 / inside.bucketSecs));
      expect(inside.pad + inside.vals.length).toBe(40);
    }
  });

  test('the y axis maximum is the tallest bar, the rule says the same figure per bucket with the bucket size, the top cell uses the eighth ramp', () => {
    const h = withAge(120, stampsOf({ 100_000: 5, 60_000: 2, 3000: 1 }));
    const rows = rowsText(statusActivityRows(kit, h, 3));
    const { vals, peak, bucketSecs } = chartSeries(h, 46 - 4 - 3);
    expect(peak).toBe(Math.max(...vals));
    expect(peak).toBe(5);
    expect(rows[0]).toMatch(new RegExp(`── ACTIVITY ─+ 8 ev · peak 5 / ${bucketLabel(bucketSecs)}$`));
    expect(rows[1]).toMatch(/^ {5} ?5┤/); // the top gutter label is the tallest bar
    expect(rows.at(-2)).toMatch(/^ {5} 0┤/);
    const tall = [...rows[1]!.slice(8)].findIndex((c) => c === '█');
    expect(tall).toBeGreaterThanOrEqual(0);
    for (const r of rows.slice(1, 4)) expect([...r.slice(8)][tall]).toBe('█'); // the tallest bar fills every chart row
    expect(rows.slice(1, 4).join('')).toMatch(/[▁-▇]/); // the two-event bar ends in a part block (sub-row resolution)
  });

  test('AA3: the y axis never tops out below 2 events per bucket: one event is a half-height bar under a `2┤` axis, the rule still says the real peak', () => {
    const rows = rowsText(statusActivityRows(kit, withAge(60, [AT - 5000]), 3));
    expect(rows[1]).toMatch(/^ {5} ?2┤/); // AA3: the axis tops out at max(peak, 2), and the top label is that maximum
    expect(rows[0]).toMatch(/1 ev · peak 1 \/ /);
    expect(rows[1]).not.toContain('█'); // the single event does not reach the top row
  });

  test('the earlier session`s minutes sit dimmed left of a `│` marker and the window keeps the rest of the width', () => {
    const minutes = [{ m: mins(9), n: 6 }, { m: mins(8), n: 2 }, { m: mins(6), n: 4 }];
    const h = withAge(150, stampsOf({ 30_000: 2 }), { hist: { runs: [], minutes } });
    const c = chartSeries(h, 39);
    expect(c.prev.length).toBeGreaterThanOrEqual(3);
    expect(c.pad + c.prev.length + 1 + c.vals.length).toBe(39);
    expect(c.prev.some((v) => v > 0)).toBe(true);
    expect(c.peak).toBe(Math.max(...c.vals, ...c.prev));
    const rows = statusActivityRows(kit, h, 3);
    const axis = text(rows.at(-1)!).trimEnd();
    expect(axis.slice(8 + c.pad)).toMatch(/^prev/);
    expect(axis).toContain('│');
    expect(axis).toMatch(/│-3m/);
    const bars = rows[3]!;
    expect(text(bars)).toContain('│'); // the marker on every chart row
    expect(bars.some((x) => x.tone === 'sub' && /[▁-█]/.test(x.t))).toBe(true); // the earlier minutes are drawn dim
    expect(rowsText(rows)[0]).toMatch(/peak \d+ \//);
  });

  test('nothing persisted means no marker and no `prev`; minutes inside the window are not drawn twice', () => {
    expect(axisOf(withAge(150))).not.toContain('prev');
    const inWindow = withAge(150, [], { hist: { runs: [], minutes: [{ m: mins(1), n: 9 }] } }); // one minute ago lies inside the 3-minute window
    expect(chartSeries(inWindow, 39).prev).toEqual([]);
  });
});

// ---- Y1c: one age per state -----------------------------------------------------------------------------------------------------------------------------------------------------

describe('Y1c: one age per state', () => {
  const band = (kind: 'idle' | 'working' | 'done', h: Health, rest?: number): string => text(bandFrameRuns({
    cols: 150, ui, cap: [{ t: '◖ ◆ ATLAS ◗', tone: 'accent' }], kind, clockMs: 0, spin: '◐', still: true, phase: { word: 'test', n: 3, of: 6 }, ...(rest !== undefined ? { restSecs: rest } : {}), health: h,
  })).trimEnd();
  const hooks = (lastEventSecs: number): Health['hooks'] => ({ total: 9, byLabel: [], recent: [], lastEventSecs, latency: { n: 4, p50: 3, p95: 5 } });
  const full = (lastEventSecs: number): Health => health({ upSecs: 400, ctxPct: 6, hooks: hooks(lastEventSecs), pulse: { events: [0, 0, 1, 2], ctx: [], runs: [] }, button: true });

  test('band: a done band says `ended 42s` and leaves out `last 42s`; a last event that differs by more than 2 s is still said', () => {
    const same = band('done', full(42), 42);
    expect(same).toContain('ended 42s');
    expect(same).not.toMatch(/last \d/);
    expect(same.match(/42s/g)).toHaveLength(1);
    expect(band('done', full(41), 42)).not.toMatch(/last \d/); // one second apart is the same instant
    expect(band('done', full(5), 42)).not.toMatch(/last \d/); // AA2: the band says one age per state, never a `last` clock
  });

  test('band: working has no clock of its own (the host prints elapsed), idle keeps `up` only (AA2)', () => {
    const working = band('working', full(3));
    expect(working).toMatch(/◐ test 3\/6/);
    expect(working).not.toMatch(/\bended\b|\b\d+:\d\d\b/);
    expect(band('idle', full(3))).toMatch(/up 6:40/);
    expect(band('idle', full(3))).not.toMatch(/last \d/);
  });

  test('panel NOW and ACTIVITY say a finished run`s age once', () => {
    const done = health({
      upSecs: 372, last: { secs: 58, done: 5, total: 5, agents: 0, failed: 0, endedAgo: 18 },
      hooks: { total: 9, byLabel: [], recent: [], lastEventSecs: 18, runTools: 4 }, pulse: { events: [], ctx: [], runs: [{ secs: 58, ok: true, at: 1 }], stamps: [AT - 18_000], at: AT },
    });
    const a: StatusIn = { cols: 48, room: 0, ui, kind: 'done', phases: [], phase: '', spin: '◐', todos: { done: 0, total: 0 }, gates: [], health: done, lead: false };
    const rows = rowsText(statusFrame(a));
    const now = rows.find((r) => /ended \d+s ago/.test(r))!;
    const act = rows.find((r) => r.includes('── ACTIVITY'))!;
    expect(now).toContain('ended 18s ago');
    expect(act).not.toMatch(/last \d/);
    expect(rows.filter((r) => /── ACTIVITY|ended/.test(r)).join('\n').match(/\b18s\b/g)).toHaveLength(1);
  });

  test('card: ACTIVITY does not repeat the age the band says; with no run state the last event stays', () => {
    const base = health({ upSecs: 372, hooks: { total: 9, byLabel: [], recent: [], lastEventSecs: 42 }, pulse: { events: [], ctx: [], runs: [], stamps: [AT - 42_000], at: AT } });
    const card = (h: Health): string => cardFrame(h, { cols: 100, ui }).map(text).find((r) => r.includes('── ACTIVITY'))!;
    expect(card({ ...base, last: { secs: 5, done: 1, total: 1, agents: 0, failed: 0, endedAgo: 42 } })).not.toMatch(/last \d/);
    expect(card(base)).toMatch(/last 42s/);
  });
});

// ---- Y1d: the narrow idle strip -------------------------------------------------------------------------------------------------------------------------------------------------

describe('Y1d: the narrow idle health strip', () => {
  const strip = (h: Health, cols = 110): Run[][] => healthStripRows(h, { cols, ui });
  const idle = health({
    upSecs: 20, ctxPct: 6, hooks: { total: 4, byLabel: [], recent: [], latency: { n: 6, p50: 3, p95: 13 }, lastEventSecs: 4 },
    pulse: { events: [0, 0, 0, 1, 0, 0, 1], ctx: [{ tokens: 60_000, pct: 6, at: 1 }], runs: [{ secs: 5, ok: true, at: 1 }, { secs: 41, ok: true, at: 2 }, { secs: 90, ok: false, at: 3 }] },
  });

  test('it is wanted at idle below 144 columns when neither the pane nor the card is open', () => {
    const w = (o: Partial<Parameters<typeof stripWanted>[0]> = {}): boolean => stripWanted({ cols: 110, kind: 'idle', panel: false, open: false, ...o });
    expect(w()).toBe(true);
    expect(w({ cols: STRIP_BELOW_COLS - 1 })).toBe(true);
    expect(w({ cols: STRIP_BELOW_COLS })).toBe(false); // the host places the pane at rest from here
    expect(w({ cols: 150 })).toBe(false);
    expect(w({ panel: true })).toBe(false);
    expect(w({ open: true })).toBe(false);
    expect(w({ kind: 'working' })).toBe(false);
    expect(w({ kind: 'done' })).toBe(false);
  });

  test('two rows: the state, the last run and the runs figures over the gates, hooks p50, context and the events spark (AA1: the one hook figure is the median)', () => {
    const rows = rowsText(strip(idle));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^ ◌ idle · last run 1:30 failed · 3 runs · med 0:41 · 1 failed +▸ details $|^ ◌ idle · last run 1:30 failed · 3 runs · med 0:41 · 1 failed +▸ details$/);
    expect(rows[1]).toMatch(/^ gates ok · hooks p50 \d+ms · ctx 6% · [▁-█]{8} 2 ev · peak \d+ \/ \d+s/);
    for (const r of strip(idle)) expect(r.reduce((n, x) => n + [...x.t].length, 0)).toBe(110); // each row fills the width exactly
  });

  test('the values wear the semantic colours and the labels stay grey', () => {
    const k = frameKit(ui, 110).k;
    const row1 = strip(idle)[0]!;
    expect(row1.find((x) => x.t === 'failed')!.fg).toBe(k.bad);
    const ok = strip({ ...idle, pulse: { ...idle.pulse!, runs: [{ secs: 5, ok: true, at: 1 }] } })[0]!;
    expect(ok.find((x) => x.t === 'ok')!.fg).toBe(k.ok);
    const row2 = strip({ ...idle, ctxPct: 85, hooks: { ...idle.hooks!, latency: { n: 6, p50: 700, p95: 800 } } })[1]!;
    expect(row2.find((x) => x.t === '700ms')!.fg).toBe(k.bad);
    expect(row2.find((x) => x.t === '85%')!.fg).toBe(k.warn);
    expect(strip(idle)[1]!.find((x) => x.t === 'gates ')!.fg).toBe(k.dim);
  });

  test('a run of an earlier session and the earlier context are labelled prev; a first-ever session says `no runs yet`', () => {
    const prev = rowsText(strip(health({ ctxPct: undefined, hist: { runs: [{ secs: 5, ok: true, tools: 2, at: 1 }], minutes: [], ctx: { at: 1, pcts: [9] } }, pulse: { events: [], ctx: [], runs: [] } })));
    expect(prev[0]).toContain('prev run 0:05 ok · 1 run');
    expect(prev[0]).not.toContain('med'); // Z2: one run is not a median
    expect(prev[1]).toContain('ctx 9% prev');
    const first = rowsText(strip(health()));
    expect(first[0]).toContain('◌ idle · no runs yet');
    expect(first[0]).not.toMatch(/\d+ runs?/);
    expect(first[1]).toContain('gates 4 armed');
    expect(first[1]).toContain('hooks 6 armed');
  });

  test('a denial reads red and replaces `armed`', () => {
    const k = frameKit(ui, 110).k;
    const row = strip({ ...idle, gates: { total: 4, green: 3, checks: checks.map((c, i) => ({ ...c, ok: i !== 1, lines: 1, pass: i === 1 ? 0 : 1 })), denied: 2 } })[1]!;
    expect(text(row)).toContain('gates 2 denied');
    expect(row.find((x) => x.t === '2 denied')!.fg).toBe(k.bad);
  });

  test('the whole strip is one clickable area (every run presses the card toggle) with a visible `▸ details` chip', () => {
    for (const r of strip(idle)) for (const x of r) expect(x.press).toBe('band:health');
    const chip = strip(idle)[0]!.find((x) => x.t.includes('details'))!;
    expect(chip.t).toBe(' ▸ details ');
    expect(chip.hover).toBe(true);
    expect(chip.bgHex).not.toBe(strip(idle)[0]![0]!.bgHex); // raised against the band fill
  });

  test('fields give way from the right in a narrow terminal, the first is never cut, rows never pass the width', () => {
    for (const cols of [30, 38, 50, 60, 80, 143]) for (const r of strip(idle, cols)) expect(r.reduce((n, x) => n + [...x.t].length, 0)).toBeLessThanOrEqual(cols);
    expect(rowsText(strip(idle, 38))[0]).toContain('◌ idle');
    expect(rowsText(strip(idle, 38))[0]).not.toContain('details');
  });

  test('ascii draws no box or block characters', () => {
    const rows = healthStripRows(idle, { cols: 90, ui: { ...ui, ascii: true, color: 'none' } }).map(text).join('\n');
    expect(rows).not.toMatch(/[◌▸▁-█│·]/u.source === '' ? /$^/ : /[◌▸▁-█│]/);
  });
});
