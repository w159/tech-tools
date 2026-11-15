// Round 3 panel and card rules (spec-r3 E1-E9, E11, E12): the status view is an instrument (a focal ACTIVITY chart with axes, context trend, run bars, ribbon headers on one grid), fills its height with a pinned footer,
// uses one control idiom (carets on expandable rows only, one row of tabs, `▸ more` swapping the set in place), keeps one stepper form at every width, empty tabs are skeletons, and the card is a capped two-column layout.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Ui } from './atlas-ui';
import { healthCardRows } from './hud-surface';
import { bodyLines, headerRows, lineText, panelLines, tabRows, MORE_KEY, type PanelModel, type PanelTab } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { NOW } from './live_fixture';
import * as model from './pane/sidebar-model';
import { textWidth } from './theme';
import type { Health } from './idle-health';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const green = (id: string, lines = 8) => ({ id, ok: true, lines, pass: lines });
const PHASES = ['research', 'theory', 'test', 'implement', 'verify'];
const RECENT = [
  { label: 'turn.complete', ageSecs: 3 }, { label: 'tool.call Bash', ageSecs: 5 }, { label: 'session.measure', ageSecs: 9 }, { label: 'tool.call Read', ageSecs: 12 }, { label: 'tool.call Edit', ageSecs: 15 },
  { label: 'prompt.submit', ageSecs: 21 }, { label: 'tool.call Bash', ageSecs: 34 }, { label: 'classic.Stop blocked', ageSecs: 40 }, { label: 'tool.call Grep', ageSecs: 55 }, { label: 'tool.call Glob', ageSecs: 70 },
  ...Array.from({ length: 30 }, (_, i) => ({ label: 'tool.call Bash', ageSecs: 100 + i * 20 })),
];
const health = (over: Partial<Health> = {}): Health => ({
  gates: { total: 4, green: 3, checks: [green('completion', 1), green('tripwire'), green('routing'), { id: 'header', ok: true, lines: 0, pass: 0 }] },
  ctxPct: 6, tokens: 64_000, window: 1_000_000, upSecs: 36, branch: 'master', version: '17.24.0',
  hooks: { total: 40, byLabel: [{ label: 'tool.call', n: 3 }], recent: RECENT, lastEventSecs: 3 },
  pulse: {
    events: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 4, 3, 0, 0, 1, 2, 1],
    ctx: [{ tokens: 20_000, pct: 2, at: 1 }, { tokens: 52_000, pct: 5, at: 2 }, { tokens: 64_000, pct: 6, at: 3 }],
    runs: [{ secs: 5, ok: true, at: 1 }, { secs: 7, ok: false, at: 2 }],
    window: 1_000_000,
  },
  ...over,
});
type Kind = 'idle' | 'working' | 'done';
const world = (cols: number, rows: number, kind: Kind = 'working', over: Partial<PanelModel> = {}, tab: PanelTab = 'route'): PanelModel =>
  panelWorld(tab, cols, ui, { rows, phases: PHASES, phase: 'theory', entered: ['research', 'theory'], todos: [], workers: [], gates: [], notes: [], run: { kind, secs: 5, startMs: NOW, frame: 0 }, health: health(), ...over } as never);
const text = (m: PanelModel): string[] => panelLines(m).map((l) => lineText(l).trimEnd());
const FOOT = 'atlas 17.24.0 · hooks loaded';
const BRAILLE = /[⠀-⣿]/;

describe('E1: ACTIVITY is the focal chart, with axes', () => {
  test('the section opens on a ribbon with the events of the last 5 minutes, then braille rows, the axis and the stats line', () => {
    const t = text(world(54, 40));
    const at = t.findIndex((l) => /^ ── ACTIVITY ─+ 14 in 5m ──$/.test(l));
    expect(at).toBeGreaterThan(0);
    const chart = t.slice(at + 1).filter((l, i, a) => i < a.findIndex((x) => /-7m/.test(x)));
    expect(chart.length).toBeGreaterThanOrEqual(3);
    for (const l of chart) expect(l).toMatch(BRAILLE);
    expect(chart[0]!.slice(0, 14).trim()).toBe('4'); // the y maximum, top left of the chart
    expect(chart.at(-1)!.slice(0, 14).trim()).toBe('0'); // the baseline
    const axis = t.find((l) => /-7m/.test(l))!;
    expect(axis.startsWith(' '.repeat(14) + '-7m')).toBe(true);
    expect(axis.trimEnd().endsWith('now')).toBe(true);
    const stats = t[t.indexOf(axis) + 1]!;
    expect(stats).toMatch(/^ {14}14 events · \d\.\d\/min · peak 4 · 3 tools$/);
  });
  test('the chart is 3 rows on a short pane and grows to 6 as the pane gets taller (24, 40, 50 rows)', () => {
    const heights = [24, 40, 50].map((rows) => {
      const t = text(world(54, rows));
      const at = t.findIndex((l) => l.includes('ACTIVITY'));
      return t.findIndex((l, i) => i > at && /-7m/.test(l)) - at - 1;
    });
    expect(heights[0]).toBe(3);
    expect(heights[0]!).toBeLessThanOrEqual(heights[1]!);
    expect(heights[1]!).toBeLessThanOrEqual(heights[2]!);
    expect(heights[2]).toBe(6);
  });
  test('the newest column is one ink brighter than the body', () => {
    const rows = panelLines(world(54, 40)).filter((l) => BRAILLE.test(lineText(l)));
    const fgs = new Set(rows.flatMap((l) => l.runs.filter((x) => BRAILLE.test(x.t)).map((x) => x.fg)));
    expect(fgs.size).toBeGreaterThanOrEqual(2);
  });
});

describe('E2: every section is a ribbon on one grid', () => {
  for (const cols of [54, 37]) {
    test(`${cols} columns: PHASE, ACTIVITY, CONTEXT, RUNS, GATES and RECENT open on a flat ribbon, no plain uppercase labels`, () => {
      const t = text(world(cols, 40));
      for (const head of ['PHASE', 'ACTIVITY', 'CONTEXT', 'RUNS', 'GATES', 'RECENT']) expect(t.some((l) => new RegExp(`^ ── ${head} ─+`).test(l))).toBe(true);
      for (const old of ['PULSE', 'HEALTH']) expect(t.some((l) => l.trim() === old)).toBe(false);
      for (const l of t.filter((x) => x.startsWith(' ──'))) expect(textWidth(l)).toBeLessThanOrEqual(cols - 1);
    });
  }
  test('label column 4, value column 14: session, chart, context and runs rows', () => {
    const t = text(world(54, 40));
    expect(t.find((l) => l.startsWith('    session'))!.slice(14)).toMatch(/^up 0:36 · master/);
    expect(t.find((l) => /^ {14}[▏█▉▊▋▌▍▎]*░*/.test(l) && l.includes('6%'))).toBeDefined();
    expect(t.find((l) => l.includes('2 runs'))!.indexOf('▁') >= 14 || t.find((l) => l.includes('2 runs'))!.search(/\S/) === 14).toBe(true);
    expect(t.find((l) => l.includes('turn finished'))!.indexOf('turn finished')).toBe(14);
  });
  test('CONTEXT: a 2-row chart, the gauge without brackets, and `6% · 64k of 1M · +12k/turn`', () => {
    const t = text(world(54, 40));
    const at = t.findIndex((l) => l.includes('── CONTEXT'));
    expect(t.slice(at + 1, at + 3).some((l) => BRAILLE.test(l))).toBe(true);
    expect(t.slice(at + 1, at + 5).filter((l) => l.trim() === '' || BRAILLE.test(l))).toHaveLength(2);
    expect(t.slice(at + 1, at + 5).some((l) => /^ {14}[▏▎▍▌▋▊▉█]*░* 6% · 64k of 1M · \+12k\/turn$/.test(l))).toBe(true);
    expect(t.join('\n')).not.toMatch(/[▕\[]/);
  });
  test('context colour: data ink under 50, amber to 80, red above; never green', () => {
    const tone = (pct: number) => panelLines(world(54, 40, 'working', { health: health({ ctxPct: pct, pulse: { events: [], ctx: [{ tokens: 1, pct, at: 1 }], runs: [] } }) })).flatMap((l) => l.runs).find((x) => /^[█▉▊▋▌▍▎▏]+$/.test(x.t))!.tone;
    expect(tone(6)).toBe('sub');
    expect(tone(60)).toBe('warn');
    expect(tone(90)).toBe('bad');
  });
  test('RUNS: eighth blocks, one per run, ok green and failed red, `2 runs · avg 0:06 · 1 fail`, no `last`', () => {
    const lines = panelLines(world(54, 40));
    const row = lines.find((l) => lineText(l).includes('2 runs'))!;
    expect(lineText(row)).toMatch(/^ {14}[▁▂▃▄▅▆▇█]+ {2}2 runs · avg 0:06 · 1 fail$/);
    expect(row.runs.some((x) => x.tone === 'ok' && /[▁-█]/.test(x.t))).toBe(true);
    expect(row.runs.some((x) => x.tone === 'bad' && /[▁-█]/.test(x.t))).toBe(true);
    expect(text(world(54, 40, 'working', { health: health({ pulse: { events: [], ctx: [], runs: [] } }) })).join('\n')).toMatch(/▁+ {2}no runs yet/);
  });
  test('GATES: one row per gate with its numbers; green only with a pass and no deny, grey when not fired; the header figure is `ok`', () => {
    const lines = panelLines(world(54, 40));
    const t = lines.map(lineText);
    expect(t.some((l) => /^ ── GATES ─+ ok ──$/.test(l))).toBe(true);
    expect(t.some((l) => /^ {4}● completion {2}1 pass · 0 deny$/.test(l))).toBe(true);
    expect(t.some((l) => /^ {4}○ header +not fired$/.test(l))).toBe(true);
    const denied = panelLines(world(54, 40, 'working', { health: health({ gates: { total: 1, green: 0, checks: [{ id: 'completion', ok: false, lines: 3, pass: 1 }] } }) }));
    expect(denied.map(lineText).some((l) => / ── GATES ─+ 2 denied ──$/.test(l))).toBe(true);
    expect(denied.find((l) => lineText(l).includes('completion'))!.runs.find((x) => x.t === '●')!.tone).toBe('bad');
  });
  test('the session row keeps `up` (its only home): no `last 32s`, no `last 0:05`, no `last` figure anywhere on the status view', () => {
    for (const cols of [54, 37]) expect(text(world(cols, 40)).join('\n')).not.toMatch(/\blast \d/);
  });
});

describe('E6: the pane is filled, RECENT takes the rest, the footer is the last row', () => {
  for (const cols of [54, 37]) for (const rows of [30, 40, 50]) {
    test(`${cols}x${rows}: exactly ${rows} rows, the footer last, no run of more than 3 blank rows, RECENT newest first`, () => {
      const t = text(world(cols, rows));
      expect(t).toHaveLength(rows);
      expect(t[rows - 1]!.trim()).toBe(FOOT);
      let run = 0;
      let worst = 0;
      for (const l of t) { run = l.trim() === '' ? run + 1 : 0; worst = Math.max(worst, run); }
      expect(worst).toBeLessThanOrEqual(3);
      const at = t.findIndex((l) => l.includes('── RECENT'));
      expect(at).toBeGreaterThan(0);
      const ages = t.slice(at + 1).map((l) => /^ {4}([ \d]\d)([smh]) /.exec(l)).filter((x): x is RegExpExecArray => !!x).map((m) => Number(m[1]) * (m[2] === 'h' ? 3600 : m[2] === 'm' ? 60 : 1));
      expect(ages.length).toBeGreaterThanOrEqual(rows >= 40 ? 3 : 1);
      expect(ages).toEqual([...ages].sort((a, b) => a - b));
    });
  }
  test('RECENT grows with the pane: more rows at 50 than at 30', () => {
    const n = (rows: number): number => text(world(54, rows)).filter((l) => /^ {4}[ \d]\d[smh] /.test(l)).length;
    expect(n(50)).toBeGreaterThan(n(30));
  });
  test('a short pane gives up rows but keeps the footer and the ribbons it has room for', () => {
    const t = text(world(54, 24));
    expect(t).toHaveLength(24);
    expect(t.at(-1)!.trim()).toBe(FOOT);
    expect(t.some((l) => l.includes('── ACTIVITY'))).toBe(true);
  });
  test('the gates list collapses to the `▸ gates` chip only when the height needs it', () => {
    expect(text(world(54, 40)).some((l) => l.includes('▸ gates'))).toBe(false);
    const short = panelLines(world(54, 20));
    const chip = short.flatMap((l) => l.runs).find((x) => x.press === 'health:gates');
    expect(chip?.t).toBe(' ▸ gates ');
  });
});

describe('E8: carets, tabs and the gates tab', () => {
  const gates = [{ id: 'tripwire', title: 'Tripwire', lines: [{ id: 'team', label: 'Team mode: off', ok: true }, { id: 'rule', label: 'Rule held', ok: true }, { id: 'bad', label: 'Needs a fix', ok: false, fix: 'run it' }] }];
  const gm = (cols: number): PanelModel => world(cols, 40, 'working', { gates, expanded: 'group:tripwire' }, 'gates');
  test('`Team mode: off` is the grey hollow `○`, never the green dot', () => {
    const row = panelLines(gm(54)).find((l) => lineText(l).includes('Team mode: off'))!;
    const mark = row.runs.find((x) => /^[●○]/.test(x.t.trim()))!;
    expect(mark.t.trim()).toBe('○');
    expect(mark.tone).not.toBe('ok');
    const held = panelLines(gm(54)).find((l) => lineText(l).includes('Rule held'))!;
    expect(held.runs.find((x) => /^[●○]/.test(x.t.trim()))!.t.trim()).toBe('●');
  });
  test('no `▹` anywhere on any tab; a leaf row has a blank caret column, an expandable row `▸` or `▾` in the first cell after the gutter', () => {
    for (const tab of ['route', 'team', 'channel', 'gates', 'core'] as PanelTab[]) {
      const m = world(54, 40, 'working', { gates, expanded: 'group:tripwire', lead: { name: 'lead', state: 'running', detail: '' } }, tab);
      expect([...headerRows(m), ...bodyLines(m)].map(lineText).join('\n')).not.toMatch(/[▹▿]/);
    }
    const t = bodyLines(gm(54)).map(lineText);
    const group = t.find((l) => l.includes('Tripwire'))!;
    expect(group.slice(0, 2)).toBe(' ▾');
    const leaf = t.find((l) => l.includes('Rule held'))!;
    expect(leaf.slice(0, 2)).toBe('  ');
    const fixable = t.find((l) => l.includes('Needs a fix'))!;
    expect(fixable.slice(0, 2)).toBe(' ▸');
  });
  test('tabs are one row at 47 columns: `▸ more` swaps the set in place and the second set ends in `‹ back`', () => {
    const closed = tabRows(world(46, 40));
    expect(closed).toHaveLength(1);
    expect(lineText(closed[0]!).trimEnd()).toMatch(/^ status {3}team {3}channel {3}gates {3}▸ more$/);
    const open = tabRows({ ...world(46, 40), expanded: MORE_KEY });
    expect(open).toHaveLength(1);
    expect(lineText(open[0]!).trimEnd()).toMatch(/^ core {3}board {3}‹ back$/);
    expect(open[0]!.runs.find((x) => x.t === ' ‹ back ')!.press).toBe(MORE_KEY);
    for (const cols of [54, 46, 36]) for (const expanded of [null, MORE_KEY]) expect(tabRows({ ...world(cols, 40), expanded })).toHaveLength(1);
    expect(headerRows({ ...world(46, 40), expanded: MORE_KEY })).toHaveLength(headerRows(world(46, 40)).length);
  });
});

describe('E9: the stepper has one form at every width', () => {
  const stage = (t: string[]): string => t.join(' ').replace(/\s+/g, ' ');
  for (const cols of [54, 47, 37]) {
    test(`${cols} columns: every stage is spelled out, wrapping to a second row where it must, never dots alone`, () => {
      const t = text(world(cols, 40));
      const joined = stage(t.slice(t.findIndex((l) => l.includes('── PHASE')) + 1, t.findIndex((l) => l.includes('── ACTIVITY'))));
      for (const name of PHASES) expect(joined).toContain(name);
      expect(t.join('\n')).not.toMatch(/res thy|\bthy\b|● ◐ ○ ○ ○/);
    });
  }
  test('at 47 columns the stages wrap to two rows; at 150 they sit on one', () => {
    const rowsOf = (cols: number): number => { const t = text(world(cols, 40)); return t.findIndex((l) => l.includes('── ACTIVITY')) - t.findIndex((l) => l.includes('── PHASE')) - 1; };
    expect(rowsOf(46)).toBe(2);
    expect(rowsOf(149)).toBe(1);
  });
  test('passed stages stay `●` after the run ends, until the next prompt', () => {
    const enteredFor = (c: string, ids: string[], phase: string, kind: string): { entered: string[] } => (model as unknown as { enteredOf: (...a: unknown[]) => { entered: string[] } }).enteredOf(c, ids, phase, kind);
    model.forgetPhases();
    expect(enteredFor('c', PHASES, 'research', 'idle')).toEqual({ entered: [] }); // a fresh idle pane has entered nothing
    expect(enteredFor('c', PHASES, 'research', 'working')).toEqual({ entered: ['research'] });
    expect(enteredFor('c', PHASES, 'research', 'done')).toEqual({ entered: ['research'] });
    expect(enteredFor('c', PHASES, 'research', 'idle')).toEqual({ entered: ['research'] }); // idle after done keeps what the run passed
    const t = text(world(54, 40, 'idle', { phase: 'research', entered: ['research'] }));
    expect(t.some((l) => /^ {4}● research ○ theory ○ test ○ implement ○ verify$/.test(l))).toBe(true);
    expect(enteredFor('c', PHASES, 'research', 'working')).toEqual({ entered: ['research'] }); // the next prompt starts over
    model.forgetPhases();
  });
});

describe('E12: a tab with nothing to show is a ribbon, a skeleton, the live fact and the footer, never one centred line', () => {
  const empty = { workers: [], notes: [], gates: [], todos: [], core: null, lead: undefined } as Partial<PanelModel>;
  const cases: [PanelTab, RegExp, string][] = [['team', /── TEAM ─+ team off · 0 workers ──/, 'team off · 0 workers'], ['channel', /── CHANNEL ─+ 0 messages ──/, '0 messages'], ['gates', /── GATES ─+ 0 gates ──/, '0 gates'], ['core', /── CORE ─+ 0 verdicts ──/, '0 verdicts']];
  for (const [tab, ribbon] of cases) for (const cols of [54, 37]) {
    test(`${tab} at ${cols} columns`, () => {
      const m = world(cols, 40, 'idle', { ...empty, health: health({ team: 'off' }) }, tab);
      const t = bodyLines(m).map((l) => lineText(l));
      expect(t.some((l) => (cols === 54 ? ribbon : /──/).test(l))).toBe(true);
      const skeleton = t.filter((l) => l.includes('···'));
      if (tab === 'team' || tab === 'channel') expect(skeleton.length).toBeGreaterThanOrEqual(1); // gates and core hold their own zero rows (health gates, `0 of 0 done items`)
      expect(t.at(-1 - (tab === 'team' || tab === 'channel' ? 0 : 0))!.trim()).toBe(FOOT);
      expect(t.join('\n')).not.toMatch(/nobody dispatched|no gates reported|no verdicts, workers/);
      for (const l of t) expect(textWidth(l)).toBeLessThanOrEqual(cols);
      const lines = bodyLines(m);
      const dim = lines.filter((l) => lineText(l).includes('···')).every((l) => l.runs.some((x) => x.tone === 'dim'));
      expect(dim).toBe(true);
    });
  }
  test('team: the live fact `team off · 0 workers` is on the page at every width', () => {
    for (const cols of [54, 37]) expect(bodyLines(world(cols, 40, 'idle', { ...empty, health: health({ team: 'off' }) }, 'team')).map(lineText).join('\n')).toContain('team off · 0 workers');
  });
});

describe('E11: the card is capped at 96 columns and has two columns from 96', () => {
  const flat = (cols: number): string[] => healthCardRows(health(), { cols, ui }).map((r) => r.map((x) => x.t).join(''));
  test('no row is wider than the terminal; the ribbon, the rules and the sections stop at 96 cells', () => {
    for (const cols of [150, 110, 96, 80]) for (const l of flat(cols)) expect(textWidth(l)).toBe(cols);
    for (const l of flat(150)) expect(l.slice(96).trim()).toBe('');
    expect(flat(150)[0]!.trimEnd()).toMatch(/^── ▾ HEALTH ─{80,}$/);
    expect(textWidth(flat(150)[0]!.trimEnd())).toBe(96);
  });
  test('150 columns: ACTIVITY and CONTEXT on the left, GATES and RUNS on the right, side by side', () => {
    const t = flat(150);
    const row = t.find((l) => l.includes('ACTIVITY'))!;
    expect(row.indexOf('GATES')).toBeGreaterThan(row.indexOf('ACTIVITY'));
    expect(row.indexOf('GATES')).toBeGreaterThanOrEqual(47);
    expect(t.find((l) => l.includes('── RUNS'))!.indexOf('RUNS')).toBeGreaterThanOrEqual(47);
    expect(t.find((l) => l.includes('── CONTEXT'))!.indexOf('CONTEXT')).toBeLessThan(47);
    for (const word of ['completion', 'tripwire', 'routing', 'header', '2 runs', 'session', '64k of 1M', 'master']) expect(t.join('\n')).toContain(word);
  });
  test('80 columns: one column, the sections stacked, each on its own rows', () => {
    const t = flat(80);
    for (const l of t) expect([['ACTIVITY', 'GATES'], ['CONTEXT', 'RUNS'], ['ACTIVITY', 'CONTEXT']].some(([a, b]) => l.includes(a!) && l.includes(b!))).toBe(false);
    const at = ['ACTIVITY', 'CONTEXT', 'RUNS', 'GATES'].map((h) => t.findIndex((l) => l.includes(`── ${h}`)));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  test('the title chip `▾ HEALTH` is the only control (key band:health)', () => {
    const pressed = healthCardRows(health(), { cols: 150, ui }).flat().filter((x) => x.press !== undefined);
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatchObject({ press: 'band:health', t: ' ▾ HEALTH ' });
  });
  test('no `none yet`, no gate ratio, no duplicate `last` figure', () => {
    for (const cols of [150, 80]) expect(flat(cols).join('\n')).not.toMatch(/none yet|\b\d+\/\d+\b|\blast \d/);
  });
});
