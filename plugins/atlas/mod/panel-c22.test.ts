// Critique 22 (build 2cf10943), panel slice: the side panel, board and cards speak the HUD's vocabulary. One test for each rule that moved:
// the `▰▱` meter, no strikethrough, the light title rule, the board's columns and timeline, the channel's title and rows, the blocked phase, the whole agent name,
// and the spinner frame the band turns.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { DONE_DOUBT, leadSpinnerGlyph, spinClock, spinFrameOf, spinnerGlyph, type Ui } from './atlas-ui';
import { boardLines, boardText, boardTimeline, type BoardRow } from './board-model';
import { bodyLines, channelLabel, lineText, panelLines, panelText, ribbonRow, type PanelModel, type PanelNote, type PanelTab } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';
import { sidebarTree } from './pane/sidebar';
import type { SidebarModel } from './pane/sidebar-types';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const world = (tab: PanelTab, cols: number, over: Partial<PanelModel> = {}): PanelModel => panelWorld(tab, cols, mocha, { rows: 40, ...over });
const text = (tab: PanelTab, cols: number, over: Partial<PanelModel> = {}): string[] => panelText(world(tab, cols, over));
const runsOf = (m: PanelModel) => panelLines(m).flatMap((l) => l.runs);

describe('step 2: one vocabulary with the HUD', () => {
  test('every tab at 150, 110 and 80 columns: no `█░` gauge, no strikethrough, a light title rule and a heavy rule only under the lit tab', () => {
    for (const tab of ['route', 'team', 'channel', 'gates', 'core'] as PanelTab[]) for (const cols of [150, 110, 80]) {
      const m = world(tab, cols);
      const rows = panelText(m);
      expect([tab, cols, rows.some((l) => /[█▏▎▍▌▋▊▉░]/.test(l))]).toEqual([tab, cols, false]);
      expect([tab, cols, runsOf(m).some((x) => x.strike)]).toEqual([tab, cols, false]);
      expect(rows[0]).toContain('─');
      expect(rows[0]).not.toContain('━');
      expect(rows.filter((l) => l.includes('━')).length).toBe(1); // the one accent underline of the lit tab
    }
  });
  test('the route meter is the HUD one, `▰▱`', () => {
    const todos = [{ id: '1', label: 'a', state: 'done' as const }, { id: '2', label: 'b', state: 'queued' as const }];
    const row = text('route', 150, { todos }).find((l) => l.startsWith(' todo'))!;
    expect(row).toMatch(/^ todo {3}▰{4}▱{4} 1\/2/);
  });
});

describe('step 3: the board pane', () => {
  const row = (n: number, over: Partial<BoardRow> = {}): BoardRow => ({ label: `T${n} read file ${n}`, state: 'done', owner: `explorer-${n}`, detail: '', ...over });
  const rows = [row(1), row(2, { label: 'T2 read ghost.py', owner: 'ghost-explorer', state: 'blocked', detail: 'owner failed', ageSecs: 135 }), row(3, { label: 'T3 read the final summary', owner: 'beta-explorer' })];
  const pane = (cols: number, r = rows) => boardLines(r, { cols, ui: mocha, pane: true, ribbon: false, title: false });
  test('title, a two-cell gutter, the state word, the owner dim; the reason is an inline dim suffix, never a row of its own', () => {
    const lines = pane(90);
    const t = boardText(lines);
    const at = t.findIndex((l) => l.includes('T2 read ghost.py'));
    expect(t[at]).toMatch(/T2 read ghost\.py +blocked {2}ghost-explorer {2}owner failed · open 02:15$/);
    expect(t.some((l) => l.trim() === 'owner failed')).toBe(false);
    expect(lines[at]!.runs.find((x) => x.t.trim() === 'ghost-explorer')?.tone).toBe('dim');
    expect(lines[at]!.runs.find((x) => x.t.startsWith('owner failed'))?.tone).toBe('dim');
  });
  test('36 cells (the 110-column pane): every item is one row, no row wraps, the title is whole while it fits, a suffix that cannot fit is dropped', () => {
    const t = boardText(pane(36));
    const items = t.slice(2, 5);
    expect(items).toHaveLength(3);
    for (const l of items) expect(cells(l)).toBeLessThanOrEqual(35);
    expect(items[1]).toContain('T2 read ghost.py');
    expect(t.join('\n')).not.toContain('...');
  });
  test('a doubted done reads `killed` once (wave 30), never a cut word; the owner moves to the footer where the row has no room for it', () => {
    const t = boardText(pane(59, [row(1), row(2, { label: 'T2 read ghost.py', owner: 'ghost-explorer', word: DONE_DOUBT, detail: 'worker killed' })]));
    const line = t.find((l) => l.includes('T2 read ghost.py'))!;
    expect(line).toMatch(/^  ■ T2 read ghost\.py +killed {2}ghost-explorer$/);
    expect(line).not.toContain('…');
    expect(t.join('\n')).toContain('T2 killed · ghost-explorer'); // the owner is still named, in the footer
  });
  test('no strikethrough on the board, in the pane or the full form', () => {
    for (const o of [{ pane: true, ribbon: false, title: false }, {}, { rich: true }]) for (const cols of [150, 110, 80]) {
      expect(boardLines(rows, { cols, ui: mocha, ...o }).flatMap((l) => l.runs).some((x) => x.strike)).toBe(false);
    }
  });
  test('the ribbon of the whole board is the light `─`', () => {
    const rib = boardText(boardLines(rows, { cols: 120, ui: mocha }))[0]!;
    expect([rib.includes('─'), rib.includes('━')]).toEqual([true, false]);
  });
  test('the timeline is one row per agent, `alpha-explorer ████ 0:14 ●`: the solid bar as long as the run, the glyph its state, queued agents left off', () => {
    const t = boardText(boardTimeline([{ name: 'alpha-explorer', state: 'done', secs: 14 }, { name: 'gamma', state: 'running', secs: 7 }, { name: 'beta-explorer', state: 'queued' }], { cols: 60, ui: mocha }));
    expect(t).toHaveLength(4); // the two agents, the axis rule with its ticks, the tick labels
    expect(t[0]).toMatch(/^ {2}alpha-explorer [█▏▎▍▌▋▊▉]+[ ┊]* +0:14 ●$/);
    expect(t[1]).toMatch(/^ {2}gamma {10}[█▏▎▍▌▋▊▉]+[ ┊]* +0:07 [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]$/); // wave 32: a working agent row wears the band's braille
    expect(t[2]).toMatch(/^ {17}┬[─┬]+$/);
    expect(t[3]).toMatch(/^ {17}0:00 .*0:1\d$/);
    const bar = (l: string): number => [...l].filter((c) => /[█▏▎▍▌▋▊▉]/.test(c)).length;
    expect(bar(t[0]!)).toBeGreaterThan(bar(t[1]!));
    expect(boardTimeline([{ name: 'a', state: 'done', secs: 3 }], { cols: 10, ui: mocha })).toEqual([]);
  });
});

const baseSidebar = (): SidebarModel => {
  const snapshot = { root: null, sessionId: 's1', channel: 'lc-m_ca9rmi', todos: [], notes: [], members: [], squad: [], contextPct: 0, now: 100_000, contract: { phases: [], todoPhases: [], headerFirstLinePattern: '^ATLAS', itemPhasePrefix: '' }, personas: [], counts: { done: 0, total: 0, byPhase: {} }, phase: 'research', phaseSource: 'default', activity: {}, comms: [], todoGroups: [] };
  return { snapshot, columns: 60, rows: 40, tick: 0, gates: [], core: null, ui: { recipient: null, expanded: null, draft: '', view: 'channel' } } as unknown as SidebarModel;
};

describe('step 4: the channel', () => {
  test('a generated channel id is `this run`, the underscore ids of a stop run included; a named channel keeps its `#name`', () => {
    expect(channelLabel('lc-m_ca9rmi')).toBe('this run');
    expect(channelLabel('lc-opl0e60i')).toBe('this run');
    expect(channelLabel('release')).toBe('#release');
    expect(text("channel", 80, { channel: "lc-m_ca9rmi", notes: [] }).some((l) => l.includes("this run"))).toBe(true);
  });
  test('kill, refusal and closure are three timed rows with whole names', () => {
    const notes: PanelNote[] = [
      { at: '15:56', from: 'ghost-explorer', to: 'lead', kind: 'failed', text: 'worker killed' },
      { at: '15:56', from: 'stop gate', to: 'lead', kind: 'blocked', text: 'Stop refused: 1 open dispatch row' },
      { at: '15:57', from: 'lead', to: 'all', kind: 'done', text: 'T2 dispatch closed after Stop refusal · ghost-explorer', lead: true },
    ];
    const t = text('channel', 150, { notes, channel: 'lc-m_ca9rmi' });
    for (const who of ['ghost-explorer', 'stop gate', 'lead']) expect(t.some((l) => l.includes(who))).toBe(true);
    expect(t.filter((l) => /\d\d:\d\d$/.test(l)).length).toBe(3);
  });
  test('with nothing to say the pane holds one dim line under the head (left-aligned since wave 32)', () => {
    const t = text('channel', 80, { notes: [] });
    const say = t.filter((l) => l.includes('○ no messages'));
    expect(say).toHaveLength(1);
    expect(say[0]!.length - say[0]!.trimStart().length).toBe(4); // wave 32: left-aligned under the head, not centred
    const runs = panelLines(world('channel', 80, { notes: [] })).flatMap((l) => l.runs).filter((x) => x.t.includes('no messages'));
    expect(runs.map((x) => x.tone)).toEqual(['muted']); // wave 32: the muted grey (240) of the other quiet rows
  });
  test('the live model stamps a refusal and a closure with the time of the log before them, so all three rows carry a time', () => {
    const m = baseSidebar();
    const s = m.snapshot as unknown as { notes: unknown[]; squad: unknown[]; todos: unknown[]; members: unknown[]; activity: Record<string, unknown> };
    s.notes = [{ ts: '2026-11-11T15:56:00.000Z', seq: 1, owner: 'lead', to: 'all', text: 'go', channel: 'lc-m_ca9rmi' }];
    const pm = panelModelOf(m, mocha, 59);
    expect(pm.notes.every((n) => n.at !== '')).toBe(true);
  });
});

describe('step 5: the blocked phase and whole names', () => {
  test('a refused Stop reads `phase  blocked` whatever the lead last declared', () => {
    const gates = [{ id: 'completion', title: 'completion', lines: [{ id: 'stop-verdict', label: 'Last Stop blocked', ok: false, detail: 'Team gate' }] }];
    const t = text('route', 110, { phase: 'done', gates });
    expect(t.find((l) => l.startsWith(' phase'))).toMatch(/^ phase {2}▲ blocked/);
    expect(text('route', 110, { phase: 'blocked' }).find((l) => l.startsWith(' phase'))).toMatch(/^ phase {2}▲ blocked/);
  });
  test('a worker never draws a blank name: whole, or `…`', () => {
    const t = text('route', 110, { workers: [{ name: '', state: 'running', detail: '' }] });
    expect(t.some((l) => /^ {3}[◐◓◑◒] +…/.test(l.trimEnd()) || l.includes('… '))).toBe(true);
  });
  test('a half-written name from the host list (`beta-e`) reads as the whole name the plan row carries', () => {
    const m = baseSidebar();
    const s = m.snapshot as unknown as { todos: unknown[]; squad: unknown[]; activity: Record<string, unknown> };
    s.todos = [{ id: 't2', content: 'T2 read beta.py (beta-explorer)', status: 'in_progress', owner: 'beta-explorer', origin: 'plan' }];
    s.squad = [{ name: 'beta-e', persona: 'explorer', state: 'working', source: 'task' }];
    s.activity = { 'beta-e': { tool: 'Read', since: 99_000, startedAt: 90_000, toolCount: 1, tokens: null, mood: 'working', lastLine: '' } };
    const pm = panelModelOf(m, mocha, 59);
    expect(pm.workers.map((w) => w.name)).not.toContain('beta-e');
  });
});

describe('step 6: one spinner clock', () => {
  test('a running row in the panel and on the board turns the frame the band turns, spinFrameOf(spinClock(now, tick))', () => {
    for (const tick of [0, 1, 2, 3, 7]) {
      const now = 123_000;
      const glyph = spinnerGlyph(spinFrameOf(spinClock(now, tick), 'alpha-explorer'));
      const m = world('route', 110, { now: spinClock(now, tick), tick, workers: [{ name: 'alpha-explorer', state: 'running', detail: '' }], todos: [{ id: 't1', label: 'T1 read alpha.py', state: 'running', owner: 'alpha-explorer' }] });
      const rows = panelText(m).filter((l) => /alpha/.test(l));
      expect(rows.length).toBeGreaterThan(0);
      const lead = leadSpinnerGlyph(spinFrameOf(spinClock(now, tick), 'alpha-explorer'));
      for (const l of rows) expect([tick, l.match(/[◐◓◑◒⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)?.[0]]).toEqual([tick, /T1 read/.test(l) ? glyph : lead]); // the plan row turns a circle quarter, the agent row the band's braille frame
      const board = boardText(boardLines([{ label: 'T1 read alpha.py', state: 'running', owner: 'alpha-explorer', detail: '' }], { cols: 80, ui: mocha, pane: true, ribbon: false, title: false, tick, nowMs: spinClock(now, tick) }));
      expect([tick, board.find((l) => /alpha/.test(l))?.match(/[◐◓◑◒]/)?.[0]]).toEqual([tick, glyph]);
    }
  });
});

void lineText; void ribbonRow; void sidebarTree; void bodyLines;
const cells = (t: string): number => [...t].length;
