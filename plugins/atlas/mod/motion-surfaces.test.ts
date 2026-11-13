// Motion on every surface (round 2, slice C): a state change on a TODO row, a SUBAGENTS row, a Board row, a side panel route or gate
// row and a band count draws at least 3 distinct in-between frames, and the end of the window is the resting render byte for byte.
// The clock is injected: the Motion saw the old state at t=0 (a first sight) and the new one at t=1000.
import { describe, expect, test } from 'claude-code/testing';
import { world, worldModel } from '../contracts/band-world';
import { worldBoardRows } from '../contracts/board-golden';
import { panelWorld } from '../contracts/panel-world';
import { worldHudAgents, worldPhases, worldPlan } from '../contracts/hud-world';
import { runsCells, runsString, type Run, type Ui, type UiState } from './atlas-ui';
import { boardBody, boardMotionItems, type BoardRow } from './board-model';
import { hudLines, hudMotionItems, type HudInput } from './hud';
import { bandLines, bandMotionItems } from './mission-layout';
import { Motion, sinceChange, windowOf, type MotionCtx, type MotionItem } from './motion';
import { bodyLines, panelMotionItems, type PanelModel } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const T0 = 1000;
// Time into the ease of the four frames: every case here turns a row done except the band count, and a done mark holds its first beat (DONE_HOLD_MS), so the frames are beats, not clock ticks.
const EASE = [0, 200, 400, 600] as const;
const atEase = (c: { done?: boolean }, ease: number): number => T0 + (c.done === false ? ease : sinceChange('done', ease));
const endOf = (c: { done?: boolean }): number => (c.done === false ? 800 : windowOf({ state: 'done' }));

/** Every run with the colour it is painted in: two frames that differ here differ on screen. */
const shot = (rows: readonly (readonly Run[])[]): string => rows.map((r) => r.map((x) => `${x.fg ?? x.tone}${x.bg ?? ''}${x.bold ? 'b' : ''}${x.strike ? 's' : ''}|${x.t}`).join('')).join('\n');

type Case = { done?: false; name: string; surface: string; before: () => MotionItem[]; after: () => MotionItem[]; render: (m: MotionCtx | undefined) => Run[][] };

function check(c: Case): void {
  test(`${c.name}: a state change draws at least 3 distinct in-between frames; the end is the resting render`, () => {
    const mo = new Motion(true);
    mo.observe(c.surface, c.before(), 0);
    mo.observe(c.surface, c.after(), T0);
    expect(mo.animating(T0)).toBe(true);
    const resting = c.render(undefined);
    const frames = EASE.map((dt) => shot(c.render(mo.ctx(atEase(c, dt)))));
    expect(new Set(frames).size).toBeGreaterThanOrEqual(3);
    for (const dt of EASE) expect(c.render(mo.ctx(atEase(c, dt))).map((r) => runsCells(r))).toEqual(resting.map((r) => runsCells(r))); // colour and glyph move, no row changes width
    expect(frames).not.toContain(shot(resting));
    expect(shot(c.render(mo.ctx(T0 + endOf(c))))).toBe(shot(resting));
    expect(JSON.stringify(c.render(mo.ctx(T0 + endOf(c) + 5000)))).toBe(JSON.stringify(resting));
    expect(mo.animating(T0 + endOf(c))).toBe(false);
  });
}

// ---- HUD: TODO and SUBAGENTS ------------------------------------------------------------------------------------------------
const hudInput = (todoStatus: string, agentState: string): HudInput => {
  const todos = worldPlan().map((t, i) => (i === 3 ? { ...t, status: todoStatus } : t));
  const agents = worldHudAgents().map((a, i) => (i === 0 ? { ...a, state: agentState, ui: agentState === 'done' ? ('done' as UiState) : agentState === 'working' ? ('running' as UiState) : ('queued' as UiState) } : a));
  return { todos, agents, phases: worldPhases() };
};
const hudView = (m: MotionCtx | undefined) => ({ cols: 120, maxRows: 60, ui, now: T0 + 5, motion: m, merge: false }); // the SUBAGENTS rows are the ones animated here (a merged block draws the agent as a calm right-hand cell)
describe('HUD rows', () => {
  check({
    name: 'TODO row', surface: 'hud-todo',
    before: () => hudMotionItems(hudInput('pending', 'working'), { now: T0 }).todos, after: () => hudMotionItems(hudInput('completed', 'working'), { now: T0 }).todos,
    render: (m) => hudLines(hudInput('completed', 'working'), hudView(m)),
  });
  check({
    name: 'SUBAGENTS row', surface: 'hud-agents',
    before: () => hudMotionItems(hudInput('pending', 'working'), { now: T0 }).agents, after: () => hudMotionItems(hudInput('pending', 'done'), { now: T0 }).agents,
    render: (m) => hudLines(hudInput('pending', 'done'), hudView(m)),
  });
  test('a TODO row that turned done flashes its own ● from bright to ok (never the ◌/◍ pop) and keeps its ▸ and bold through the fade; only it and the next row (its cursor waits) move', () => {
    const mo = new Motion(true);
    mo.observe('hud-todo', hudMotionItems(hudInput('pending', 'working'), { now: T0 }).todos, 0);
    mo.observe('hud-todo', hudMotionItems(hudInput('completed', 'working'), { now: T0 }).todos, T0);
    const rest = hudLines(hudInput('completed', 'working'), hudView(undefined));
    const f0 = hudLines(hudInput('completed', 'working'), hudView(mo.ctx(T0)));
    const moved = f0.flatMap((r, i) => (shot([r]) === shot([rest[i]!]) ? [] : [i]));
    expect(moved).toHaveLength(2); // the row that turned done, and the next open row whose ▸ waits for it
    const done = runsString(f0[moved[0]!]!);
    expect(done).toContain('●');
    expect(done).not.toMatch(/[◌◍]/); // critique 21: the dotted rings read empty
    // the cursor and the bold label hold from t=0 through the fade (critique 21: the ▸ vanished at t=0, the bold dropped a step late), and fall together on the last beat
    for (const dt of [0, 200, 400, 599]) { // wave 31: the window is 800 ms (231, then 151 held), the weight holds to the last beat
      const row = hudLines(hudInput('completed', 'working'), hudView(mo.ctx(T0 + dt)))[moved[0]!]!;
      expect([dt, runsString(row).startsWith('▸ ●')]).toEqual([dt, true]);
      expect([dt, row.find((x) => x.t.includes('Subagents block'))!.bold]).toEqual([dt, true]);
      const next = hudLines(hudInput('completed', 'working'), hudView(mo.ctx(T0 + dt)))[moved[1]!]!;
      expect([dt, next.find((x) => x.t.includes('Gate tests'))!.bold ?? false]).toEqual([dt, false]); // the next open row's focus waits for the fade
    }
    const last = hudLines(hudInput('completed', 'working'), hudView(mo.ctx(T0 + sinceChange('done', 600))));
    expect(runsString(last[moved[0]!]!).startsWith('▸')).toBe(false); // the cursor and the weight fall together on the last beat
    expect(last[moved[0]!]!.find((x) => x.t.includes('Subagents block'))!.bold ?? false).toBe(false);
    expect(last[moved[1]!]!.find((x) => x.t.includes('Gate tests'))!.bold).toBe(true);
  });
  test('a TODO row that appears reveals left to right', () => {
    const mo = new Motion(true);
    const without = hudInput('pending', 'working');
    const one = (i: HudInput): HudInput => ({ ...i, todos: i.todos.slice(0, 5) });
    mo.observe('hud-todo', hudMotionItems(one(without), { now: T0 }).todos, 0);
    mo.observe('hud-todo', hudMotionItems(without, { now: T0 }).todos, T0);
    const inks = [0, 150, 299].map((dt) => hudLines(without, hudView(mo.ctx(T0 + dt))).map((r) => runsString(r).replace(/\s/g, '').length).join(','));
    expect(new Set(inks).size).toBe(3);
  });
});

describe('a new SUBAGENTS row (critique 11 A5)', () => {
  test('its name, state word and glyph are whole on every frame of the entry: the AGENT cell is never blank or cut (critique 22)', () => {
    const full = hudInput('pending', 'working');
    const fewer: HudInput = { ...full, agents: full.agents.slice(0, -1) };
    const added = full.agents[full.agents.length - 1]!;
    const mo = new Motion(true);
    mo.observe('hud-agents', hudMotionItems(fewer, { now: T0 }).agents, 0);
    mo.observe('hud-agents', hudMotionItems(full, { now: T0 }).agents, T0);
    const rest = hudLines(full, hudView(undefined)).map(runsString);
    const at = rest.findIndex((l) => l.includes(added.name));
    expect(at).toBeGreaterThanOrEqual(0);
    const word = /\b(running|queued|done|failed|blocked|waiting)\b/.exec(rest[at]!)![1]!;
    for (const dt of [0, 50, 100, 150, 200, 299]) {
      const line = runsString(hudLines(full, hudView(mo.ctx(T0 + dt)))[at]!);
      expect(line).toContain(word);
    }
    for (const dt of [0, 50, 100, 150, 200, 299]) expect(runsString(hudLines(full, hudView(mo.ctx(T0 + dt)))[at]!)).toContain(added.name);
  });
});

// ---- Board ------------------------------------------------------------------------------------------------------------------------
const boardRows = (state: UiState): BoardRow[] => worldBoardRows().map((r, i) => (i === 1 ? { ...r, state } : r));
describe('Board rows', () => {
  check({
    name: 'Board row', surface: 'board',
    before: () => boardMotionItems(boardRows('queued')), after: () => boardMotionItems(boardRows('done')),
    render: (m) => boardBody(boardRows('done'), { cols: 120, ui, motion: m }).map((l) => l.runs),
  });
  test('every board row keeps its width in every frame', () => {
    const mo = new Motion(true);
    mo.observe('board', boardMotionItems(boardRows('queued')), 0);
    mo.observe('board', boardMotionItems(boardRows('done')), T0);
    const w = (rows: Run[][]): number[] => rows.map((r) => runsString(r).length);
    for (const dt of EASE) expect(w(boardBody(boardRows('done'), { cols: 120, ui, motion: mo.ctx(atEase({}, dt)) }).map((l) => l.runs))).toEqual(w(boardBody(boardRows('done'), { cols: 120, ui }).map((l) => l.runs)));
  });
});

// ---- side panel: route tasks and gate rows ----------------------------------------------------------------------------------------
const panelAt = (tab: 'route' | 'gates', task: UiState, gateOk: boolean, m?: MotionCtx): PanelModel => {
  const base = panelWorld(tab, 120, ui);
  return {
    ...base, motion: m,
    todos: base.todos.map((t, i) => (i === 2 ? { ...t, state: task } : t)),
    gates: base.gates.map((g, gi) => (gi === 0 ? { ...g, lines: g.lines.map((l, li) => (li === 0 ? { ...l, ok: gateOk } : l)) } : g)),
    expanded: tab === 'gates' ? `group:${base.gates[0]!.id}` : null,
  };
};
describe('side panel rows', () => {
  check({
    name: 'route task row', surface: 'panel',
    before: () => panelMotionItems(panelAt('route', 'running', true)), after: () => panelMotionItems(panelAt('route', 'done', true)),
    render: (m) => bodyLines(panelAt('route', 'done', true, m)).map((l) => l.runs),
  });
  check({
    name: 'gate row', surface: 'panel',
    before: () => panelMotionItems(panelAt('gates', 'running', false)), after: () => panelMotionItems(panelAt('gates', 'running', true)),
    render: (m) => bodyLines(panelAt('gates', 'running', true, m)).map((l) => l.runs),
  });
  check({
    name: 'team worker row', surface: 'panel',
    before: () => panelMotionItems({ ...panelAt('route', 'running', true), workers: panelWorld('team', 120, ui).workers.map((w, i) => (i === 0 ? { ...w, state: 'running' as UiState } : w)) }),
    after: () => panelMotionItems({ ...panelAt('route', 'running', true), workers: panelWorld('team', 120, ui).workers.map((w, i) => (i === 0 ? { ...w, state: 'done' as UiState } : w)) }),
    render: (m) => bodyLines({ ...panelWorld('team', 120, ui), motion: m, workers: panelWorld('team', 120, ui).workers.map((w, i) => (i === 0 ? { ...w, state: 'done' as UiState } : w)) }).map((l) => l.runs),
  });
});

// ---- band counts ------------------------------------------------------------------------------------------------------------------------
const bandAt = (running: number, m?: MotionCtx) => {
  const base = worldModel(120, ui);
  const workers = base.workers.map((w, i) => ({ ...w, state: i < running ? ('running' as const) : ('done' as const) }));
  return { ...base, workers, motion: m };
};
describe('band counts', () => {
  check({
    name: 'band running count', surface: 'band', done: false,
    before: () => bandMotionItems(bandAt(2)), after: () => bandMotionItems(bandAt(1)),
    render: (m) => bandLines(bandAt(1, m)).map((l) => l.runs),
  });
  test('the band count tints only its own state, and the world has workers to count', () => {
    expect(world.workers.length).toBeGreaterThan(2);
    const mo = new Motion(true);
    mo.observe('band', bandMotionItems(bandAt(2)), 0);
    mo.observe('band', bandMotionItems(bandAt(1)), T0);
    const rest = bandLines(bandAt(1)).map((l) => l.runs);
    const f = bandLines(bandAt(1, mo.ctx(T0))).map((l) => l.runs);
    const touched = f.flat().filter((x) => x.fg !== undefined);
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.length).toBeLessThan(rest.flat().length / 2);
  });
});

// ---- idle and reduced -------------------------------------------------------------------------------------------------------------------
describe('idle and reduced motion', () => {
  test('a disabled Motion (ATLAS_REDUCED_MOTION, NO_COLOR) hands out no ctx: every surface is the resting render', () => {
    const mo = new Motion(false);
    mo.observe('board', boardMotionItems(boardRows('queued')), 0);
    mo.observe('board', boardMotionItems(boardRows('done')), T0);
    expect(mo.ctx(T0)).toBeUndefined();
    expect(JSON.stringify(boardBody(boardRows('done'), { cols: 120, ui, motion: mo.ctx(T0) }))).toBe(JSON.stringify(boardBody(boardRows('done'), { cols: 120, ui })));
  });
  test('a surface with no change at all is the resting render in every frame', () => {
    const mo = new Motion(true);
    mo.observe('board', boardMotionItems(boardRows('done')), 0);
    mo.observe('board', boardMotionItems(boardRows('done')), T0);
    expect(mo.animating(T0 + 1)).toBe(false);
    expect(JSON.stringify(boardBody(boardRows('done'), { cols: 120, ui, motion: mo.ctx(T0 + 1) }))).toBe(JSON.stringify(boardBody(boardRows('done'), { cols: 120, ui })));
  });
});
