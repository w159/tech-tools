// Round 3 panel and card rules (spec-r3 E1-E9, E11, E12): the status view is an instrument (a focal ACTIVITY chart with axes, context trend, run bars, ribbon headers on one grid), fills its height with a pinned footer,
// uses one control idiom (carets on expandable rows only, one row of tabs, `more ›` swapping the set in place), keeps one stepper form at every width, empty tabs are skeletons, and the card is a capped two-column layout.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Ui } from '../../design/atlas-ui';
import { healthCardRows } from '../hud/hud-surface';
import { bodyLines, headerRows, lineText, panelLines, tabRows, MORE_KEY, type PanelModel, type PanelTab } from './panel-layout';
import { panelWorld } from '../../../contracts/panel-world';
import { NOW } from '../../live_fixture';
import * as model from './pane/sidebar-model';
import { textWidth } from '../../design/theme';
import type { Health } from '../../data/idle-health';

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
const FOOT = 'atlas 17.24.0 · master';
const BRAILLE = /[⠀-⣿]/;


describe('E6: the pane is filled, RECENT takes the rest, the footer is the last row', () => {
  test('a short pane gives up rows but keeps the footer and the ribbons it has room for', () => {
    const t = text(world(54, 24));
    expect(t).toHaveLength(24);
    expect(t.at(-1)!.trim()).toBe(FOOT);
    expect(t.some((l) => l.includes('── ACTIVITY'))).toBe(true);
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
  test('no `▹` anywhere on any tab; an expandable row is a chip with `▾` or `▸` in its first cell, a leaf row carries the tree branch (frame spec 2.3)', () => {
    for (const tab of ['route', 'team', 'channel', 'gates', 'core'] as PanelTab[]) {
      const m = world(54, 40, 'working', { gates, expanded: 'group:tripwire', lead: { name: 'lead', state: 'running', detail: '' } }, tab);
      expect([...headerRows(m), ...bodyLines(m)].map(lineText).join('\n')).not.toMatch(/[▹▿]/);
    }
    const t = bodyLines(gm(54)).map(lineText);
    const group = t.find((l) => /tripwire/.test(l))!;
    expect(group.slice(0, 4)).toBe('  ▾ ');
    const leaf = t.find((l) => l.includes('Rule held'))!;
    expect(leaf.trimStart().slice(0, 4)).toBe('├ ● ');
    const fixable = t.find((l) => l.includes('Needs a fix'))!;
    expect(fixable.trimStart().slice(0, 4)).toBe('└ ■ ');
    expect(t.some((l) => l.includes('fix: run it'))).toBe(true);
  });
  test('AA5: tabs are one row at 46 columns with all six (the short `chan`); a narrower pane folds its trailing tabs: `more ›` swaps the set in place and the second set ends in `‹ back`', () => {
    const closed = tabRows(world(46, 40));
    expect(closed).toHaveLength(1);
    expect(lineText(closed[0]!).trimEnd()).toMatch(/^ status {3}team {3}chan {3}gates {3}core {3}board$/);
    const narrow = tabRows(world(40, 40));
    expect(lineText(narrow[0]!).trimEnd()).toMatch(/^ status {3}team {3}chan {3}gates {3}more ›$/);
    const open = tabRows({ ...world(40, 40), expanded: MORE_KEY });
    expect(open).toHaveLength(1);
    expect(lineText(open[0]!).trimEnd()).toMatch(/^ core {3}board {3}‹ back$/);
    expect(open[0]!.runs.find((x) => x.t === ' ‹ back ')!.press).toBe(MORE_KEY);
    for (const cols of [54, 46, 36]) for (const expanded of [null, MORE_KEY]) expect(tabRows({ ...world(cols, 40), expanded })).toHaveLength(1);
    expect(headerRows({ ...world(40, 40), expanded: MORE_KEY })).toHaveLength(headerRows(world(40, 40)).length);
  });
});

describe('E9: the stepper has one form at every width', () => {
  const stage = (t: string[]): string => t.join(' ').replace(/\s+/g, ' ');
});

describe('E12: a tab with nothing to show is a ribbon, one sentence, one measured fact and the footer (frame spec 2.5), never one centred line', () => {
  const empty = { workers: [], notes: [], gates: [], todos: [], core: null, lead: undefined } as Partial<PanelModel>;
  const cases: [PanelTab, RegExp, string[]][] = [['team', /── TEAM ─+ off/, ['no workers']], ['channel', /── CHAT ─+/, ['no notes yet']], ['gates', /── GATES ─+/, ['pass deny last']], ['core', /── CORE ─+/, ['no verdicts yet']]];
  for (const [tab, ribbon, words] of cases) for (const cols of [54, 37]) {
    test(`${tab} at ${cols} columns`, () => {
      const m = world(cols, 40, 'idle', { ...empty, health: health({ team: 'off' }) }, tab);
      const t = bodyLines(m).map((l) => lineText(l));
      expect(t.some((l) => ribbon.test(l))).toBe(true);
      for (const w of words) expect(t.join('\n')).toContain(w);
      expect(t.at(-1)!.trim()).toBe(FOOT);
      expect(t.join('\n')).not.toMatch(/nobody dispatched|no gates reported|no verdicts, workers|Team mode is off|No notes yet|No verdicts yet/);
      for (const l of t) expect(textWidth(l)).toBeLessThanOrEqual(cols);
    });
  }
});

describe('E11/X4: the card is two equal columns from 120 and one below (round X)', () => {
  const flat = (cols: number): string[] => healthCardRows(health(), { cols, ui }).map((r) => r.map((x) => x.t).join(''));
  test('no row is wider than the terminal; the title chip is followed by a rule to the last cell', () => {
    for (const cols of [150, 120, 110, 96, 80]) for (const l of flat(cols)) expect(textWidth(l)).toBe(cols);
    expect(flat(150)[0]!.trimEnd()).toMatch(/^ +▾ HEALTH +─{80,}$/);
    expect(textWidth(flat(150)[0]!.trimEnd())).toBe(149);
    expect(flat(150)[0]).not.toContain('ATLAS'); // the band right under it carries the pill
  });
  test('150 columns: two equal columns, a 3-cell gutter; ACTIVITY and GATES start on one row, CONTEXT and HOOKS on one row', () => {
    const t = flat(150);
    const row = t.find((l) => l.includes('ACTIVITY'))!;
    expect(row).toContain('GATES');
    const u = Math.floor((150 - 4) / 2) - 1;
    expect(row.indexOf('GATES') - row.indexOf('ACTIVITY')).toBe(u + 1 + 3);
    expect(t.findIndex((l) => l.includes('── ACTIVITY'))).toBe(t.findIndex((l) => l.includes('── GATES')));
    const second = t.find((l) => l.includes('── CONTEXT'))!;
    expect(second).toContain('── HOOKS');
    expect(t.indexOf(second)).toBe(t.findIndex((l) => l.includes('── HOOKS')));
    for (const word of ['completion', 'tripwire', 'routing', 'header', '64k of 1M']) expect(t.join('\n')).toContain(word);
    expect(t.join('\n')).toMatch(/\d:\d\d (ok|failed) · /); // AA3: two runs are a one-line list
  });
  test('110 columns: one column, the sections stacked, each on its own rows', () => {
    const t = flat(110);
    for (const l of t) expect([['ACTIVITY', 'GATES'], ['CONTEXT', 'RUNS'], ['ACTIVITY', 'CONTEXT'], ['HOOKS', 'GATES']].some(([a, b]) => l.includes(a!) && l.includes(b!))).toBe(false);
    const at = ['ACTIVITY', 'CONTEXT', 'RUNS', 'GATES', 'HOOKS'].map((h) => t.findIndex((l) => l.includes(`── ${h}`)));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  test('the card title is the toggle (round W M): the one `▾ HEALTH` chip carries the card key; no other run carries a press', () => {
    const pressed = healthCardRows(health(), { cols: 150, ui }).flat().filter((x) => x.press !== undefined);
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.press).toBe('band:health');
    expect(pressed[0]!.t.trim()).toBe('▾ HEALTH');
  });
  test('no `none yet`, no gate ratio', () => {
    for (const cols of [150, 80]) expect(flat(cols).join('\n')).not.toMatch(/none yet|\b\d+\/\d+\b/);
  });
});
