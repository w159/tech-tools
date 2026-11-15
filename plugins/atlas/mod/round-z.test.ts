// round-z.test.ts: round Z (y2-critic defects Z1-Z7): a chart scale that does not shout, honest percentiles, threshold colours that agree between panel and card, tabs that fill to the footer
// with real data, the active tab always in the strip, one live health figure on the idle band, and the card in the status tab's order.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Run, type Ui } from './atlas-ui';
import { bandRuns, type BandModel } from './band';
import { cardFrame } from './card-frame';
import { busySnap, NOW } from './live_fixture';
import type { Health, HealthCheck } from './idle-health';
import { lineText, panelLines, stripLayout, tabRows, type PanelModel, type PanelTab } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { CHART_AXIS_MIN, chartRows, latencyLevel, P95_MIN_SAMPLES } from './status-frame';
import { healthStripRows } from './strip-frame';
import { textWidth } from './theme';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const PHASES = ['research', 'theory', 'test', 'implement', 'verify', 'review'];
const text = (rs: readonly Run[]): string => rs.map((x) => x.t).join('');
const checks = (deny = 0): HealthCheck[] => [
  { id: 'completion', ok: true, lines: 1, pass: 1 }, { id: 'tripwire', ok: true, lines: 1, pass: 1 },
  { id: 'routing', ok: deny === 0, lines: 8, pass: 8 - deny }, { id: 'header', ok: true, lines: 1, pass: 1 },
];
const RECENT = Array.from({ length: 48 }, (_, i) => ({ label: ['tool.call Bash', 'tool.call Read', 'session.measure', 'turn.complete'][i % 4]!, ageSecs: 4 + i * 3, ms: 2 + (i % 5) }));
const PER = [
  { label: 'tool.call', n: 40, p50: 40, p95: 120, lastSecs: 5, samples: 40 },
  { label: 'turn.complete', n: 9, p50: 90, p95: 600, lastSecs: 9, samples: 9 },
  { label: 'session.start', n: 1, p50: 2, p95: 2, lastSecs: 41, samples: 1 },
  { label: 'prompt.submit', n: 3, p50: 300, p95: 300, lastSecs: 20, samples: 3 },
];
const health = (o: Partial<Health> = {}): Health => ({
  gates: { total: 4, green: 4, checks: checks() }, version: '17.23.0', branch: 'master', team: 'off', upSecs: 372, ctxPct: 6, tokens: 64_000, window: 1_000_000,
  last: { secs: 58, done: 5, total: 5, agents: 0, failed: 0, endedAgo: 12 },
  hooks: { total: 60, byLabel: [{ label: 'prompt.submit', n: 3 }, { label: 'tool.call', n: 40 }], recent: RECENT, lastEventSecs: 4, runTools: 11, latency: { n: 60, p50: 13, p95: 120 }, perHook: PER },
  pulse: { events: [0, 0, 2, 2, 3, 2, 2, 0, 0, 0, 0, 0, 1, 0, 0, 1, 4, 3, 1, 0], ctx: [{ tokens: 52_000, pct: 5, at: 1 }, { tokens: 64_000, pct: 6, at: 2 }], runs: [{ secs: 33, ok: true, at: 1 }, { secs: 58, ok: false, at: 2 }, { secs: 42, ok: true, at: 3 }], window: 1_000_000 },
  ...o,
});
const GROUPS = checks().map((c) => ({ id: c.id, title: c.id, lines: [{ id: 'a', label: 'line a', ok: true, detail: 'ok' }] }));
const WORKERS = [
  { name: 'explorer', role: 'explorer', state: 'done', detail: 'mapped', secs: 58 }, { name: 'impl-band', role: 'implementer', state: 'running', detail: 'edit', secs: 102 },
] as never[];
const TODOS = [1, 2, 3].map((n) => ({ id: `T${n}`, label: `item ${n}`, state: n === 1 ? 'done' : 'queued' })) as never[];
const NOTES = [{ at: '10:01', ms: NOW - 5000, from: 'lead', text: 'start' }, { at: '10:02', ms: NOW - 3000, from: 'impl', text: 'done' }] as never[];

const world = (tab: PanelTab, cols: number, h: Health, o: Record<string, unknown> = {}, board = false, rows = 39, kind: 'idle' | 'working' | 'done' = 'working'): PanelModel =>
  panelWorld(tab, cols, ui, {
    rows, phases: PHASES, phase: kind === 'working' ? 'test' : 'research', entered: kind === 'working' ? ['research', 'theory', 'test'] : [], channel: 'lead-104043', people: 3,
    workers: [], todos: [], notes: [], gates: GROUPS, run: { kind, secs: 5, startMs: NOW, frame: 0 }, health: h, ...(board ? { board: true } : {}), ...o,
  } as never);
const rowsOf = (m: PanelModel): string[] => panelLines(m).map((l) => lineText(l).trimEnd());
const fromRibbon = (m: PanelModel): string[] => { const t = rowsOf(m); return t.slice(t.findIndex((l) => l.startsWith(' ── '))); };
const blanksAboveFooter = (m: PanelModel): number => { const t = fromRibbon(m); let i = t.length - 1; let n = 0; while (i > 0 && t[i - 1] === '') { n++; i--; } return n; };
const runsOf = (rows: readonly (readonly Run[])[], t: string): Run[] => rows.flatMap((r) => r.filter((x) => x.t.trim() === t));
const panelRuns = (m: PanelModel, t: string): Run[] => panelLines(m).flatMap((l) => l.runs).filter((x) => x.t.trim() === t);
const style = (r: Run): string => `${r.tone ?? ''}|${r.fg ?? ''}`;

describe('Z1: chart scale and height', () => {
  const axisTop = (m: PanelModel): string => fromRibbon(m).find((l) => /^ {5}\s?\d+┤/.test(l))!;
  test('AA3: the y axis tops at max(peak, 2): one event is a half-height bar under a `2┤` axis, never a full-height one', () => {
    expect(CHART_AXIS_MIN).toBe(2);
    const one = health({ pulse: { events: [...new Array<number>(19).fill(0), 1], ctx: [], runs: [], window: 1_000_000 } });
    const m = world('route', 55, one, {}, false, 41, 'idle');
    const rows = fromRibbon(m);
    const top = rows.findIndex((l) => /^ {5}\s?\d+┤/.test(l));
    expect(rows[top]).toMatch(/^ {5}\s?2┤/);
    expect(rows[top]!.slice(rows[top]!.indexOf('┤') + 1).trim()).toBe(''); // nothing reaches the top row
  });
  test('a peak above 4 still sets the axis', () => {
    const big = health({ pulse: { events: [...new Array<number>(19).fill(0), 9], ctx: [], runs: [], window: 1_000_000 } });
    expect(axisTop(world('route', 55, big, {}, false, 41, 'done'))).toMatch(/^ {5}\s?9┤/);
  });
  test('the chart height is a function of the pane: idle, working and done draw the same rows; freed rows go to RECENT', () => {
    const count = (rows: number, kind: 'idle' | 'working' | 'done'): number => {
      const t = fromRibbon(world('route', 55, health(), {}, false, rows, kind));
      return t.findIndex((l) => /^ {5}\s?0┤/.test(l)) - t.findIndex((l) => /^ {5}\s?\d+┤/.test(l)) + 1;
    };
    for (const rows of [30, 36, 41, 49]) expect(new Set([count(rows, 'idle'), count(rows, 'working'), count(rows, 'done')]).size, `rows ${rows}`).toBe(1);
    expect([30, 41, 49].map((r) => chartRows(r))).toEqual([4, 6, 6]);
    expect(chartRows(26)).toBe(4);
    expect(chartRows(10)).toBe(3);
  });
});

describe('Z2: honest percentiles', () => {
  const hookRows = (m: PanelModel): string[] => fromRibbon(m).filter((l) => /^ {5}(tool\.call|turn\.complete|session\.start|prompt\.submit)/.test(l));
  test('a hook with fewer than 5 samples shows its one value as p50 and a dash as p95; n is the count', () => {
    expect(P95_MIN_SAMPLES).toBe(5);
    const rows = hookRows(world('route', 55, health(), {}, false, 49));
    const by = (n: string): string[] => rows.find((l) => l.trimStart().startsWith(n))!.trim().split(/\s+/);
    expect(by('session.start')).toEqual(['session.start', '1', '2ms', '—', '41s']);
    expect(by('prompt.submit').slice(1, 4)).toEqual(['3', '300ms', '—']);
    expect(by('tool.call').slice(1, 4)).toEqual(['40', '40ms', '120ms']);
    expect(by('turn.complete').slice(1, 4)).toEqual(['9', '90ms', '600ms']);
  });
  test('no row anywhere prints one number twice as two statistics from fewer than 5 samples', () => {
    for (const cols of [55, 48]) for (const rows of hookRows(world('route', cols, health(), {}, false, 49))) {
      const c = rows.trim().split(/\s+/);
      if (Number(c[1]) < 5) expect(c[3], rows).toBe('—');
    }
    const card = cardFrame(health(), { cols: 145, ui }).map((r) => text(r).trimEnd());
    expect(card.join('\n')).not.toMatch(/session\.start\s+1\s+2ms\s+2ms/);
  });
  test('the idle strip says p50 under 5 samples and p95 from 5', () => {
    const few = health({ hooks: { total: 2, byLabel: [], recent: [], latency: { n: 2, p50: 7, p95: 7 } } });
    const many = health({ hooks: { total: 9, byLabel: [], recent: [], latency: { n: 9, p50: 7, p95: 30 } } });
    const t = (h: Health): string => healthStripRows(h, { cols: 100, ui }).map((r) => text(r)).join('\n');
    expect(t(few)).toMatch(/hooks p50 7ms/); // AA1: the one hook figure everywhere is the median
    expect(t(many)).toMatch(/hooks p50 7ms/);
    expect(t(many)).not.toMatch(/hooks p95/);
  });
});

describe('Z3: threshold colours agree between panel, tabs and card', () => {
  const m = world('route', 55, health(), {}, false, 49);
  const card = cardFrame(health(), { cols: 145, ui });
  test('<=100ms green, >100 amber, >500 red', () => {
    expect([latencyLevel(40), latencyLevel(100), latencyLevel(101), latencyLevel(500), latencyLevel(501)]).toEqual(['ok', 'ok', 'warn', 'warn', 'bad']);
  });
  test('the panel and the card colour the same figure the same way', () => {
    for (const [fig, tone] of [['120ms', 'warn'], ['600ms', 'bad'], ['40ms', 'ok'], ['90ms', 'ok']] as const) {
      const p = panelRuns(m, fig); const c = runsOf(card, fig);
      expect(p.length, fig).toBeGreaterThan(0); expect(c.length, fig).toBeGreaterThan(0);
      expect(new Set(p.map(style)), fig).toEqual(new Set(c.map(style)));
      expect(p[0]!.tone, fig).toBe(tone);
    }
  });
  test('the tabs colour them the same too', () => {
    const t = world('gates', 48, health(), {}, false, 45);
    expect(panelRuns(t, '600ms')[0]?.tone).toBe('bad');
    expect(panelRuns(t, '120ms')[0]?.tone).toBe('warn');
  });
  test('labels stay neutral: the hook names carry no threshold tone', () => {
    for (const r of [...panelRuns(m, 'tool.call'), ...runsOf(card, 'tool.call')]) expect(['ok', 'warn', 'bad']).not.toContain(r.tone);
  });
  test('gate dots: green with passes and no deny, red on a deny, grey hollow before any check', () => {
    const green = world('route', 55, health(), {}, false, 49, 'working');
    const dot = (mm: PanelModel, name: string): Run => panelLines(mm).map((l) => l.runs).find((rs) => text(rs).includes(`${name} `) && /[●■○]/.test(text(rs)))!.find((x) => /[●■○]/.test(x.t))!;
    expect(dot(green, 'completion').t).toBe('●');
    expect(dot(green, 'completion').tone).toBe('ok');
    const red = world('route', 55, health({ gates: { total: 4, green: 3, checks: checks(2) } }), {}, false, 49, 'working');
    expect(dot(red, 'routing').t).toBe('■');
    expect(dot(red, 'routing').tone).toBe('bad');
    const idle = world('route', 55, health({ hooks: { total: 0, byLabel: [], recent: [], latency: { n: 0, p50: 0, p95: 0 } }, pulse: { events: [], ctx: [], runs: [], window: 1_000_000 } }), {}, false, 49, 'idle');
    expect(fromRibbon(idle).some((l) => /○ 4 gates armed · 0 checks yet/.test(l))).toBe(true); // AA4: before any check the section is one summary line
    const cardDot = cardFrame(health({ gates: { total: 4, green: 3, checks: checks(2) } }), { cols: 145, ui }).flat().find((x) => x.t === '■');
    expect(cardDot?.tone).toBe('bad');
  });
  test('context uses its ramp in panel and card alike', () => {
    for (const pct of [6, 71, 92]) {
      const h = health({ ctxPct: pct });
      const p = panelLines(world('route', 55, h, {}, false, 49)).flatMap((l) => l.runs).filter((x) => x.t.includes(`${pct}%`));
      const c = cardFrame(h, { cols: 145, ui }).flat().filter((x) => x.t.includes(`${pct}%`));
      expect(p.length, String(pct)).toBeGreaterThan(0); expect(c.length, String(pct)).toBeGreaterThan(0);
      expect(new Set(p.map(style)), String(pct)).toEqual(new Set(c.map(style)));
    }
  });
});

describe('Z4: tabs fill to the footer with real data', () => {
  const cases: [string, PanelTab, boolean, Record<string, unknown>][] = [
    ['board', 'route', true, { workers: WORKERS, todos: TODOS }],
    ['team', 'team', false, { workers: WORKERS, lead: { name: 'lead', role: 'lead', state: 'running', detail: '', secs: 185 } }],
    ['channel', 'channel', false, { notes: NOTES }],
    ['core', 'core', false, { todos: TODOS }],
    ['gates', 'gates', false, {}],
  ];
  for (const [name, tab, board, over] of cases) for (const cols of [48, 41]) {
    test(`${name} at ${cols}: ${tab === 'channel' ? 'ends within one blank row of the footer' : 'ends at the footer, the elastic RECENT log lives on status and channel only (AA7)'}`, () => {
      const m = world(tab, cols, health(), over, board, 45);
      if (tab === 'channel') expect(blanksAboveFooter(m), `${name}@${cols}\n${fromRibbon(m).join('\n')}`).toBeLessThanOrEqual(1);
      else expect(fromRibbon(m).some((l) => l.includes('── RECENT'))).toBe(false);
      expect(rowsOf(m).at(-1)!.trim()).toMatch(/^atlas /);
    });
  }
  test('board: RUNS is a multi-row bar chart, ok green and fail red, oldest and newest on the axis', () => {
    const runs = [33, 58, 42, 20, 75, 12, 61, 48].map((secs, k) => ({ secs, ok: k !== 1 && k !== 5, at: k + 1 }));
    const m = world('route', 48, health({ pulse: { ...health().pulse!, runs } }), { workers: WORKERS, todos: TODOS }, true, 45);
    const t = fromRibbon(m);
    const i = t.findIndex((l) => l.includes('── RUNS'));
    expect(i).toBeGreaterThan(0);
    const end = t.findIndex((l, k) => k > i && /oldest/.test(l));
    expect(end - i - 1, t.join('\n')).toBeGreaterThanOrEqual(3); // the axis, at least one row of bars between, the base
    expect(t.slice(i).join('\n')).toMatch(/oldest\s+newest/);
    const bars = panelLines(m).flatMap((l) => l.runs).filter((x) => /[▁-█]/.test(x.t) && x.tone !== undefined);
    expect(bars.some((x) => x.tone === 'ok')).toBe(true);
    expect(bars.some((x) => x.tone === 'bad')).toBe(true);
  });
  test('team: the slot table comes first, with no invented workers, then ACTIVITY (no RECENT: AA7)', () => {
    const m = world('team', 48, health(), {}, false, 45);
    const t = fromRibbon(m).join('\n');
    expect(t).toMatch(/slots/);
    expect(t).toMatch(/tmux/);
    expect(t).toMatch(/mode/);
    const order = ['── TEAM', '── ACTIVITY'].map((k) => t.indexOf(k));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect(t).not.toContain('── RECENT');
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).not.toMatch(/worker-\d|alpha|beta/);
  });
  test('core: routing data only (AA7): no GATES table (the gates tab owns it), no RECENT', () => {
    const t = fromRibbon(world('core', 48, health({ gates: { total: 4, green: 3, checks: checks(2) } }), { todos: TODOS, gates: [{ id: 'routing', title: 'Tool routing', lines: [{ id: 'g', label: 'Native Grep calls', ok: false, detail: '2 calls denied' }] }] }, false, 45)).join('\n');
    expect(t).toContain('── CORE');
    expect(t).not.toContain('── GATES');
    expect(t).not.toContain('── RECENT');
    expect(t).not.toMatch(/Native Grep calls/);
  });
  test('when a log runs out the tab stops: a one-event log leaves its blanks and invents no rows', () => {
    const h = health({ hooks: { total: 1, byLabel: [], recent: [{ label: 'session.start', ageSecs: 41, ms: 2 }], latency: { n: 1, p50: 2, p95: 2 } } });
    const t = fromRibbon(world('route', 55, h, {}, false, 49));
    expect(t.filter((l) => /^ {5}\d+s /.test(l))).toHaveLength(1);
  });
});

describe('AA5 (replaces Z5): the strip is one fixed order, never swapped; the header names the active tab', () => {
  const ALL = ['route', 'team', 'channel', 'gates', 'core', 'board'] as const;
  const ORDER = ['status', 'team', 'channel', 'gates', 'core', 'board'];
  const labels = (rows: readonly (readonly { label: string }[])[]): string[] => rows.flat().map((x) => x.label);
  for (const cols of [38, 44, 45, 47, 48, 110, 150]) for (const tab of ALL) {
    test(`at ${cols} cells with ${tab} lit, the visible tabs are a prefix of the one order (no swap)`, () => {
      const shown = labels(stripLayout(cols, tab).rows).map((x) => (x === 'chan' ? 'channel' : x));
      expect(shown, `${cols}/${tab}`).toEqual(ORDER.slice(0, shown.length));
    });
  }
  test('at 45 cells and up all six are on one row, with the short label `chan` below 48', () => {
    for (const cols of [45, 47]) { const s = stripLayout(cols, 'core'); expect(labels(s.rows)).toEqual(['status', 'team', 'chan', 'gates', 'core', 'board']); expect(s.more).toBe(false); }
    for (const cols of [48, 110, 150]) { const s = stripLayout(cols, 'core'); expect(labels(s.rows)).toEqual(ORDER); expect(s.more).toBe(false); }
  });
  test('the rendered strip at 48 columns carries the lit board chip without moving it', () => {
    const m = world('route', 48, health(), { workers: WORKERS, todos: TODOS }, true, 45);
    const strip = tabRows(m).map((r) => lineText(r)).join('\n');
    expect(strip).toMatch(/status\s+team\s+channel\s+gates\s+core\s+board/);
    expect(strip).not.toMatch(/more [›>]/);
  });
});

describe('Z6: the idle band carries one live health figure after the spark', () => {
  const model = (cols: number, panel: boolean, h: object): BandModel => {
    const snap = busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 6, phase: 'test' as never, now: NOW });
    return {
      snapshot: snap, live: [], gates: [], columns: cols, tick: 0, maxRows: 12, ui,
      health: { upSecs: 41, hooks: { total: 3, byLabel: [{ label: 'prompt.submit', n: 1 }], recent: [], lastEventSecs: 4, runTools: 0, latency: { n: 3, p50: 13, p95: 30 } }, pulse: { events: [0, 0, 1, 3, 0, 2, 5, 1], ctx: [], runs: [] }, button: true, ...(panel ? { panel: true } : {}), ...h },
    } as BandModel;
  };
  const band = (cols: number, panel: boolean, h: object = {}): Run[] => bandRuns(model(cols, panel, h), true);
  test('with the pane open and room, `hook p50 13ms` follows the spark, coloured by its threshold', () => {
    const rs = band(150, true);
    expect(text(rs)).toMatch(/hook p50\s+13ms/);
    const fig = rs.find((x) => x.t.includes('13ms'));
    expect(fig?.tone).toBe('ok');
    const slow = band(150, true, { hooks: { total: 3, byLabel: [{ label: 'prompt.submit', n: 1 }], recent: [], lastEventSecs: 4, runTools: 0, latency: { n: 3, p50: 600, p95: 700 } } });
    expect(slow.find((x) => x.t.includes('600ms'))?.tone).toBe('bad');
  });
  test('AA2: without a hook latency the slot reads a dim dash and ctx keeps its slot beside it', () => {
    const t = text(band(150, true, { hooks: { total: 3, byLabel: [{ label: 'prompt.submit', n: 1 }], recent: [], lastEventSecs: 4, runTools: 0 }, ctxPct: 6 }));
    expect(t).toMatch(/hook p50 +—/);
    expect(t).toMatch(/ctx\s+6%/);
  });
  test('AA2: the slots are shed from the end (ctx, then hook) below 110 and every width fits; the spark keeps its 8 cells', () => {
    for (const cols of [89, 70, 57, 40]) {
      const rs = band(cols, true);
      expect(textWidth(text(rs)), String(cols)).toBeLessThanOrEqual(cols);
      if (!/peak/.test(text(rs))) expect(text(rs), String(cols)).not.toMatch(/hook p50|ctx\s+\d/);
    }
  });
});

describe('Z7: the health card follows the status tab order', () => {
  const ORDER = ['ACTIVITY', 'CONTEXT', 'RUNS', 'GATES', 'HOOKS'];
  const names = (rows: readonly (readonly Run[])[]): string[] => rows.flatMap((r) => [...text(r).matchAll(/── ([A-Z]+) /g)].map((m) => m[1]!));
  test('one column below 120 cells lists the sections in the status order', () => {
    expect(names(cardFrame(health(), { cols: 100, ui }))).toEqual(ORDER);
  });
  test('two columns from 120 split that order left then right, without reordering', () => {
    const rows = cardFrame(health(), { cols: 145, ui });
    const left = rows.flatMap((r) => [...text(r).matchAll(/── ([A-Z]+) /g)].filter((m) => m.index! < 70).map((m) => m[1]!));
    const right = rows.flatMap((r) => [...text(r).matchAll(/── ([A-Z]+) /g)].filter((m) => m.index! >= 70).map((m) => m[1]!));
    expect(left).toEqual(['ACTIVITY', 'CONTEXT', 'RUNS']);
    expect(right).toEqual(['GATES', 'HOOKS']);
  });
  test('a short card keeps a prefix of the order, never a gap', () => {
    for (let b = 12; b <= 40; b++) {
      const got = names(cardFrame(health(), { cols: 100, ui, maxRows: b }));
      expect(got, String(b)).toEqual(ORDER.slice(0, got.length));
    }
  });
});
