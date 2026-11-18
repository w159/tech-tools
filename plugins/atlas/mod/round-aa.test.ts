// round-aa.test.ts: round AA (critics/spec-aa.md AA1-AA7): one metrics source for every surface, fixed band and card geometry, a chart that reads the same everywhere, idle sections that summarise,
// one tab strip in one order, one chip idiom, and tabs that do not repeat each other.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Run, type Ui } from './atlas-ui';
import { bandRuns, type BandModel } from './view/band/band';
import { cardFrame } from './card-frame';
import type { Health, HealthCheck } from './data/idle-health';
import { busySnap, NOW } from './live_fixture';
import { metricsOf, PANEL_CHART_COLS } from './data/metrics';
import { lineText, panelLines, stripLayout, tabRows, type PanelModel, type PanelTab } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { frameKit, statusActivityRows, statusGatesRows, statusHooksRows, statusRunsRows } from './status-frame';
import { healthStripRows } from './strip-frame';
import { tabFrame, tabText, type TabId, type TabIn } from './tabs-frame';
import { textWidth } from './theme';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const text = (rs: readonly Run[]): string => rs.map((x) => x.t).join('');
const checks = (): HealthCheck[] => [
  { id: 'completion', ok: true, lines: 1, pass: 1 }, { id: 'tripwire', ok: true, lines: 2, pass: 2 },
  { id: 'routing', ok: true, lines: 8, pass: 8 }, { id: 'header', ok: true, lines: 1, pass: 1 },
];
const GROUPS = checks().map((c) => ({ id: c.id, title: c.id, lines: [{ id: 'a', label: 'line a', ok: true, detail: 'ok' }] }));
const AT = 1_000_000_000_000;
/** A health with a pulse that carries stamps, so every surface buckets the same wall-clock series. */
const health = (o: Partial<Health> = {}): Health => ({
  gates: { total: 4, green: 4, checks: checks() }, version: '17.23.0', branch: 'master', team: 'off', upSecs: 300, ctxPct: 6, tokens: 64_000, window: 1_000_000,
  last: { secs: 42, done: 5, total: 5, agents: 0, failed: 0, endedAgo: 12 },
  hooks: { total: 12, byLabel: [{ label: 'tool.call', n: 6 }], recent: [{ label: 'tool.call Bash', ageSecs: 4, ms: 3 }], lastEventSecs: 4, runTools: 3, latency: { n: 12, p50: 7, p95: 21 } },
  pulse: { events: [], ctx: [{ tokens: 64_000, pct: 6, at: 2 }], runs: [{ secs: 5, ok: true, at: 1 }, { secs: 42, ok: true, at: 2 }, { secs: 3, ok: false, at: 3 }], stamps: [AT - 2000, AT - 2100, AT - 2300, AT - 9000, AT - 40_000, AT - 41_000], at: AT },
  ...o,
});
const rowsOfCard = (h: Health, cols: number): string[] => cardFrame(h, { cols, ui }).map((r) => text(r).trimEnd());
const PHASES = ['research', 'theory', 'test', 'implement', 'verify', 'review'];
const world = (tab: PanelTab, cols: number, h: Health, rows = 45, over: Record<string, unknown> = {}): PanelModel =>
  panelWorld(tab, cols, ui, { rows, phases: PHASES, phase: 'research', entered: [], channel: 'lead-1', gates: GROUPS, workers: [], todos: [], notes: [], run: { kind: 'idle', secs: 5, startMs: NOW, frame: 0 }, health: h, ...over } as never);
const panelRows = (m: PanelModel): string[] => panelLines(m).map((l) => lineText(l).trimEnd());

// ---- AA1: one metrics module ---------------------------------------------------------------------------------------------------------------------------------------------------------

describe('AA1: every surface reads the figures from metricsOf, once', () => {
  const h = health();
  const m = metricsOf(h);
  test('one Health computes one set of figures: the same object on every read, equal when built twice from the same inputs', () => {
    expect(metricsOf(h)).toBe(m);
    expect(metricsOf(health()).peakText).toBe(m.peakText);
    expect(m.activity.vals.length).toBeLessThanOrEqual(PANEL_CHART_COLS);
    expect(m.scale).toBe(Math.max(2, m.activity.peak));
    expect(m.run?.text).toBe('0:03'); // the newest run's one m:ss text
  });
  const band = (cols: number, panel: boolean): string => {
    const snap = busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 6, now: NOW });
    return text(bandRuns({ snapshot: snap, live: [], gates: [], columns: cols, tick: 0, maxRows: 12, ui, health: { ...h, ...(panel ? { panel: true } : { button: true }) } } as BandModel, true));
  };
  test('the activity peak and its bucket read the same in the band, the panel, the card, the strip and the tabs', () => {
    expect(m.peakText).toMatch(/^peak \d+ \/ \d+(\.\d)?[sm]$/);
    expect(band(145, false)).toContain(m.peakText);
    expect(panelRows(world('route', 55, h)).join('\n')).toContain(m.peakText);
    expect(rowsOfCard(h, 145).join('\n')).toContain(m.peakText);
    expect(healthStripRows(h, { cols: 100, ui }).map(text).join('\n')).toContain(m.peakText);
    expect(tabText(tabFrame(tabIn('team', 48, { health: h }))).join('\n')).toContain(m.peakText);
  });
  test('the hook p50, the context percent and the newest run read the same on every surface that draws them', () => {
    expect(band(145, false)).toMatch(/hook p50 +7ms/);
    expect(band(145, false)).toMatch(/ctx +6%/);
    const status = panelRows(world('route', 55, h)).join('\n');
    expect(status).toContain('6%');
    expect(status).toMatch(/HOOKS .*p50 7ms/);
    expect(status).toContain(`last run ${m.run!.text}`);
    expect(rowsOfCard(h, 145).join('\n')).toContain('6%');
    expect(rowsOfCard(h, 145).join('\n')).toMatch(/p50 7ms/);
    expect(healthStripRows(h, { cols: 100, ui }).map(text).join('\n')).toMatch(/hooks p50 7ms · ctx 6%/);
    expect(healthStripRows(h, { cols: 100, ui }).map(text).join('\n')).toContain('last run 0:03 failed');
  });
});

// ---- AA2: fixed geometry --------------------------------------------------------------------------------------------------------------------------------------------------------------

type Kind = 'idle' | 'working' | 'done';
const bandAt = (kind: Kind, cols: number, panel: boolean, h: Partial<Health> = {}): string => {
  const snap = busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 'ctxPct' in h && h.ctxPct === undefined ? 0 : 6, now: NOW, ...(kind === 'done' ? { phase: 'done' as never } : {}) });
  const model = {
    snapshot: snap, live: [], gates: [], columns: cols, tick: 0, maxRows: 12, ui,
    health: { ...health(), ...(panel ? { panel: true } : { button: true }), ...h },
    ...(kind === 'working' ? { working: true, workSecs: 3 } : {}), ...(kind === 'done' ? { ranSecs: 5, restSecs: 12 } : {}),
  } as BandModel;
  return text(bandRuns(model, true));
};
const seps = (row: string): number[] => [...row].flatMap((c, i) => (c === '│' ? [i] : []));

describe('AA2: the band is slots of one width each', () => {
  for (const [cols, panel] of [[145, false], [100, false], [89, true], [55, true]] as const) {
    test(`at ${cols} (${panel ? 'pane open' : 'pane closed'}) the separators sit at the same columns in idle, working and done`, () => {
      const [a, b, c] = (['idle', 'working', 'done'] as Kind[]).map((k) => seps(bandAt(k, cols, panel)));
      expect(a!.length).toBeGreaterThanOrEqual(2);
      expect(b).toEqual(a);
      expect(c).toEqual(a);
    });
  }
  test('the spark is 8 cells at every width where it shows, whatever the data', () => {
    for (const cols of [145, 120, 110, 100, 89, 70, 55]) for (const kind of ['idle', 'working', 'done'] as Kind[]) {
      const row = bandAt(kind, cols, cols < 100);
      const run = row.match(/[▁-█]+/)?.[0];
      if (run) expect([...run], `${kind}@${cols}`).toHaveLength(8);
    }
    expect([...bandAt('idle', 145, false, { pulse: undefined }).match(/[▁-█]+/)![0]]).toHaveLength(8); // no pulse: the same 8 dim cells
  });
  test('from 110 columns `hook p50` and `ctx` are always there, a dim dash before their data', () => {
    for (const cols of [145, 110]) {
      const row = bandAt('idle', cols, false, { hooks: { total: 0, byLabel: [], recent: [] }, ctxPct: undefined, pulse: { events: [], ctx: [], runs: [] } });
      expect(row, String(cols)).toMatch(/hook p50 +—/);
      expect(row, String(cols)).toMatch(/ctx +—/);
    }
  });
  test('below 110 columns ctx is shed first, then hook', () => {
    expect(bandAt('working', 109, false)).not.toContain('ctx');
    expect(bandAt('working', 109, false)).toContain('hook p50');
    expect(bandAt('working', 100, false)).not.toContain('ctx');
    expect(bandAt('working', 89, true)).toContain('hook p50');
    expect(bandAt('working', 70, false)).not.toContain('hook p50');
    for (const cols of [145, 109, 89, 70, 55, 44]) expect(textWidth(bandAt('working', cols, cols < 100))).toBeLessThanOrEqual(cols);
  });
  test('no interior holes in the state slot: the detail closes up after the head', () => {
    expect(bandAt('done', 145, false)).toMatch(/● done 6\/6 · ended 12s +│/);
    expect(bandAt('working', 145, false, { hooks: { total: 1, byLabel: [], recent: [], runTool: 'Bash' } })).toMatch(/implement 5\/6 · Bash +│/);
    expect(bandAt('idle', 145, false)).toMatch(/◌ idle up 5:00 +│/);
  });
  test('the card caps its tables at 48 cells and every section rule spans exactly its column', () => {
    const tail = (rows: string[], sec: string): number[] => rows.flatMap((r) => { const at = r.indexOf(`── ${sec} `); return at >= 0 ? [textWidth(r.slice(at).trimEnd())] : []; });
    for (const cols of [145, 110]) {
      const rows = rowsOfCard(health(), cols);
      for (const sec of ['GATES', 'HOOKS']) expect(tail(rows, sec), `${sec}@${cols}`).toEqual([48]); // the table column is capped at 48 and its rule fills it
    }
    const one = rowsOfCard(health(), 110);
    expect(new Set(['ACTIVITY', 'CONTEXT', 'RUNS'].flatMap((sec) => tail(one, sec))).size).toBe(1); // the one column's rules are all one width
    const two = rowsOfCard(health(), 145).map((r) => r.slice(0, 74));
    expect(new Set(['ACTIVITY', 'CONTEXT', 'RUNS'].flatMap((sec) => two.flatMap((r) => { const at = r.indexOf(`── ${sec} `); return at >= 0 ? [textWidth(r.slice(at).trimEnd().replace(/ +$/, ''))] : []; }))).size).toBe(1);
  });
});

// ---- AA3: the activity chart and RUNS ------------------------------------------------------------------------------------------------------------------------------------------------

describe('AA3: ACTIVITY and RUNS', () => {
  const kit = frameKit(ui, 46);
  const rows = (h: Health, n = 3): string[] => statusActivityRows(kit, h, n).map((r) => text(r).trimEnd());
  test('the y axis tops at max(peak, 2) and the top label is that maximum', () => {
    const quiet = health({ pulse: { events: [], ctx: [], runs: [], stamps: [], at: AT } });
    expect(rows(quiet)[1]).toMatch(/^ {5} ?2┤/);
    const one = health({ pulse: { events: [], ctx: [], runs: [], stamps: [AT - 1000], at: AT } });
    expect(rows(one)[1]).toMatch(/^ {5} ?2┤/);
    const busy = health({ pulse: { events: [], ctx: [], runs: [], stamps: [AT - 100, AT - 200, AT - 300, AT - 400, AT - 500], at: AT } });
    expect(rows(busy)[1]).toMatch(/^ {5} ?5┤/);
  });
  test('zero buckets are blank above a dim `─` baseline, and the region before the session is a dim `·` on that baseline', () => {
    const r = rows(health({ pulse: { events: [], ctx: [], runs: [], stamps: [AT - 1000], at: AT } }));
    const chart = r.filter((l) => /┤|│/.test(l));
    const base = chart.find((l) => /0┤/.test(l))!;
    const cells = [...base.slice(8)];
    expect(cells.every((c) => c === '·' || c === '─' || c === '▁' || c === '█' || /[▂-▇]/.test(c))).toBe(true);
    expect(cells.some((c) => c === '·')).toBe(true);
    expect(cells.some((c) => c === '─')).toBe(true);
    for (const l of chart.filter((x) => !/0┤/.test(x))) expect([...l.slice(8)].filter((c) => c !== ' ' && !/[▁-█]/.test(c))).toEqual([]); // above the baseline only bars or blanks
    expect(cells.length).toBe(46 - 7); // the plot spans the full width
  });
  test('RUNS is at most 6 rows however many runs there are', () => {
    const runs = Array.from({ length: 30 }, (_, i) => ({ secs: 5 + i * 3, ok: i % 7 !== 0, at: i + 1 }));
    const h = health({ pulse: { events: [], ctx: [], runs, stamps: [], at: AT } });
    for (const tall of [3, 6, 12, 40]) expect(statusRunsRows(frameKit(ui, 46), h).length, String(tall)).toBeLessThanOrEqual(6);
  });
  test('fewer than 3 runs are a one-line list', () => {
    const h = health({ pulse: { events: [], ctx: [], runs: [{ secs: 5, ok: true, at: 1 }, { secs: 2, ok: true, at: 2 }], stamps: [], at: AT } });
    const r = statusRunsRows(kit, h).map((x) => text(x).trimEnd());
    expect(r).toHaveLength(2);
    expect(r[1]).toMatch(/^ {5}[▁-█] 0:05 ok · [▁-█] 0:02 ok$/);
  });
});

// ---- AA4: idle summarises ------------------------------------------------------------------------------------------------------------------------------------------------------------

const NOSRC = { gates: [], prompted: false };
describe('AA4: idle GATES and HOOKS summarise; earlier sessions read as `prev`', () => {
  const kit = frameKit(ui, 46);
  const idle = health({ hooks: { total: 1, byLabel: [{ label: 'session.start', n: 1 }], recent: [], perHook: [{ label: 'session.start', n: 1, lastSecs: 13 }] }, gates: { total: 4, green: 4, checks: checks().map((c) => ({ ...c, pass: 0, lines: 0 })) } });
  test('before any check GATES is one line; before any latency HOOKS is one line naming the last hook', () => {
    expect(statusGatesRows(kit, idle, NOSRC, false).map((r) => text(r).trimEnd()).slice(1)).toEqual(['     ○ 4 gates armed · 0 checks yet']);
    expect(statusHooksRows(kit, idle).map((r) => text(r).trimEnd()).slice(1)).toEqual(['     ○ 6 hooks wired · last session.start 13s']);
  });
  test('with persisted history the gates show as dimmed rows tagged prev', () => {
    const seeded = { ...idle, hist: { runs: [], minutes: [], gates: [{ id: 'completion', pass: 3, deny: 0 }, { id: 'routing', pass: 9, deny: 1 }] } } as Health;
    const rows = statusGatesRows(kit, seeded, NOSRC, false);
    const t = rows.map((r) => text(r).trimEnd());
    expect(t.some((l) => /completion +3 +0 +prev$/.test(l))).toBe(true);
    expect(t.some((l) => /routing +9 +1 +prev$/.test(l))).toBe(true);
    for (const r of rows.slice(1)) expect(r.filter((x) => x.t.trim() !== '').every((x) => x.tone === 'sub' || x.tone === 'dim')).toBe(true);
  });
  test('the p95 column appears only once some row has 5 samples', () => {
    const few = health({ hooks: { total: 4, byLabel: [], recent: [], perHook: [{ label: 'tool.call', n: 3, p50: 8, p95: 12, lastSecs: 2, samples: 3 }], latency: { n: 3, p50: 8, p95: 12 } } });
    const many = health({ hooks: { total: 9, byLabel: [], recent: [], perHook: [{ label: 'tool.call', n: 9, p50: 8, p95: 12, lastSecs: 2, samples: 9 }], latency: { n: 9, p50: 8, p95: 12 } } });
    expect(text(statusHooksRows(kit, few)[1]!)).not.toMatch(/p95/);
    expect(text(statusHooksRows(kit, many)[1]!)).toMatch(/p50 +p95/);
  });
  test('a hook row with 2 or more samples gets an 8-cell latency spark', () => {
    const h = health({ hooks: { total: 9, byLabel: [], recent: [], perHook: [{ label: 'tool.call', n: 9, p50: 8, p95: 12, lastSecs: 2, samples: 9, ring: [3, 5, 8, 20, 4, 6] }, { label: 'turn.complete', n: 1, p50: 4, p95: 4, lastSecs: 5, samples: 1, ring: [4] }], latency: { n: 9, p50: 8, p95: 12 } } });
    const rows = statusHooksRows(frameKit(ui, 56), h).map((r) => text(r).trimEnd());
    expect(rows.find((l) => l.includes('tool.call'))!.match(/[▁-█]+/)![0]).toHaveLength(8);
    expect(rows.find((l) => l.includes('turn.complete'))!).not.toMatch(/[▁-█]/);
  });
});

// ---- AA5: the tab strip ---------------------------------------------------------------------------------------------------------------------------------------------------------------

describe('AA5: one strip, one order, at every width', () => {
  const labels = (cols: number): string[] => stripLayout(cols).rows.flat().map((t) => t.label);
  test('at 110 columns (the 47-cell pane) all six tabs are on one row with the short labels, in the 150 order', () => {
    expect(labels(47)).toEqual(['status', 'team', 'chan', 'gates', 'core', 'board']);
    expect(stripLayout(47).more).toBe(false);
    expect(labels(48)).toEqual(['status', 'team', 'channel', 'gates', 'core', 'board']);
    expect(labels(57)).toEqual(['status', 'team', 'channel', 'gates', 'core', 'board']);
    const row = tabRows(world('route', 47, health())).map(lineText);
    expect(row).toHaveLength(1);
    expect(row[0]!.trim().split(/\s+/)).toEqual(['status', 'team', 'chan', 'gates', 'core', 'board']);
  });
  test('no more / back chip and no swapped tab at the live pane widths; the lit tab never changes the strip', () => {
    for (const cols of [47, 48, 57]) for (const tab of ['route', 'team', 'channel', 'gates', 'core'] as const) {
      const row = tabRows(world(tab, cols, health())).map(lineText).join('\n');
      expect(row).not.toMatch(/more|back/);
      expect(row.trim().split(/\s+/)).toHaveLength(6);
    }
    for (const cols of [30, 38, 44]) { const order = stripLayout(cols, 'route').rows.flat().map((t) => t.id); for (const tab of ['team', 'core', 'board']) expect(stripLayout(cols, tab).rows.flat().map((t) => t.id)).toEqual(order); }
  });
  test('the header always names the active tab', () => {
    for (const [tab, name] of [['route', 'status'], ['team', 'team'], ['channel', 'channel'], ['gates', 'gates'], ['core', 'core']] as const) {
      expect(panelRows(world(tab, 47, health()))[0]).toContain(`SIDEPANEL · ${name}`);
    }
  });
});

// ---- AA6: one control idiom ----------------------------------------------------------------------------------------------------------------------------------------------------------

const tabIn = (t: TabId, cols: number, o: Partial<TabIn> = {}): TabIn => ({ tab: t, cols, room: 45, ui, kind: 'idle', health: health(), gates: GROUPS, workers: [], todos: [], notes: [], channel: 'c', people: 1, recipient: null, flips: [], lead: false, ...o });
const filled = (r: readonly Run[]): Run[] => r.filter((x) => x.bgHex !== undefined);

describe('AA6: every clickable is the same raised chip', () => {
  test('tab chips and the band chips wear the raised fill and carry a press', () => {
    const tabs = tabRows(world('route', 48, health()));
    for (const l of tabs) for (const x of l.runs.filter((y) => y.t.trim() !== '')) expect(x.bgHex !== undefined || x.bg === 'accent', x.t).toBe(true); // raised, or the lit one filled
    const row = bandRuns({ snapshot: busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 6, now: NOW }), live: [], gates: [], columns: 145, tick: 0, maxRows: 12, ui, health: { ...health(), button: true } } as BandModel, true);
    for (const w of ['gates', 'health']) { const chip = row.filter((x) => x.t.includes(w) && x.press !== undefined); expect(chip.length, w).toBeGreaterThan(0); expect(chip.every((x) => x.bgHex !== undefined), w).toBe(true); }
  });
  test('an expandable gate row is a chip with the caret inside its fill; the card title and `+N more ›` are chips too', () => {
    const lines = tabFrame(tabIn('gates', 48, { kind: 'working' }));
    const g = lines.find((l) => l.press?.kind === 'flip' && /[▸▾]/.test(text(l.runs)))!;
    const carets = g.runs.filter((x) => /[▸▾]/.test(x.t));
    expect(carets.every((x) => x.bgHex !== undefined)).toBe(true);
    expect(filled(g.runs).map((x) => x.t).join('')).toMatch(/[▸▾].*completion|[▸▾].*tripwire|[▸▾].*routing|[▸▾].*header/); // the fill runs across the label
    const card = cardFrame(health(), { cols: 145, ui });
    expect(card[0]!.some((x) => x.bgHex !== undefined && /HEALTH/.test(x.t))).toBe(true);
    const short = cardFrame(health(), { cols: 145, ui, maxRows: 12 }).flat().filter((x) => /more ›/.test(x.t));
    if (short.length) expect(short.every((x) => x.bgHex !== undefined && x.press !== undefined)).toBe(true);
  });
  test('the channel compose field is a bordered one-row field with a visible cursor cell', () => {
    const lines = tabText(tabFrame(tabIn('channel', 48, { kind: 'working' })));
    const c = lines.find((l) => /message/.test(l))!;
    expect(c).toMatch(/✎ message[^│]*│▌ +│$/);
    expect(textWidth(c)).toBeLessThanOrEqual(48);
  });
});

// ---- AA7: tabs do not repeat each other ---------------------------------------------------------------------------------------------------------------------------------------

describe('AA7: each tab owns its sections', () => {
  const sections = (tab: PanelTab, over: Record<string, unknown> = {}): string[] => panelRows(world(tab, 48, health(), 49, over)).flatMap((l) => [...l.matchAll(/── ([A-Z]+) /g)].map((m) => m[1]!));
  const recent = { notes: [{ at: '10:01', ms: NOW - 5000, from: 'lead', text: 'start' }] };
  test('RECENT lives in status and channel only', () => {
    expect(sections('route')).toContain('RECENT');
    expect(sections('channel', recent)).toContain('RECENT');
    for (const tab of ['team', 'gates', 'core'] as const) expect(sections(tab), tab).not.toContain('RECENT');
  });
  test('core is routing data only: no GATES table and no HOOKS; gates owns GATES and HOOKS', () => {
    expect(sections('core')).not.toContain('GATES');
    expect(sections('core')).not.toContain('HOOKS');
    const g = sections('gates');
    expect(g).toContain('GATES');
    expect(g).toContain('HOOKS');
  });
  test('status stays the overview: ACTIVITY, CONTEXT, RUNS, GATES, HOOKS', () => {
    const s = sections('route');
    for (const name of ['ACTIVITY', 'CONTEXT', 'RUNS', 'GATES', 'HOOKS']) expect(s).toContain(name);
  });
});
