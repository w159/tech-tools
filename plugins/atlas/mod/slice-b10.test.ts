// Critique 10, slice B: the band and the gates speak one truth. B1 one word (`warning`) for a failing check without a Stop refusal on the band,
// the gates tab and the core tab; B2 the band never reads idle while the plan has a running item; B3 no `offload` / `route ... drift` on the band;
// B4 contract figures share the plan denominator and the band counts read n/m at every width.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { panelWorld } from '../contracts/panel-world';
import { bandTree } from './band';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import { coreCells, cellsText } from './core-row';
import type { CoreModel } from './data/core';
import { planBusy } from './data/runstate';
import type { Ui } from './atlas-ui';
import { bandLines, missionLines, runsText, type MissionModel } from './mission-layout';
import { panelText, type PanelModel } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['plan', 'build', 'verify'] as const;
const model = (over: Partial<MissionModel> = {}): MissionModel => ({
  cols: 120, maxRows: 12, tick: 0, project: 'p', phases: PHASES, phase: 'build', done: 4, total: 5, workers: [], checks: null, ui, ...over,
});
const band = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs);
const all = (m: MissionModel): string => missionLines(m).map((l) => runsText(l.runs)).join('\n');

describe('B1: one word for a failing check without a Stop refusal', () => {
  const g = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'verify', label: 'verification coverage', ok: false, fix: 'run the hooks suite' }, { id: 'docs', label: 'docs updated', ok: true }] }];
  test('the gates tab says warning, never failing', () => {
    const out = panelText(panelWorld('gates', 100, ui, { rows: 24, gates: g })).join('\n');
    expect(out).toMatch(/Completion gate +warning/);
    expect(out).not.toContain('failing');
  });
  test('the band footer\'s tightest form says warning, never failing', () => {
    const checks = ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc'].map((id) => ({ id, ok: false }));
    const foot = missionLines(model({ cols: 80, phase: 'done', done: 5, checks })).map((l) => runsText(l.runs)).find((t) => t.includes('checks'))!;
    expect(foot).toContain('3 warnings');
    expect(foot).not.toContain('failing');
    const one = missionLines(model({ cols: 80, phase: 'done', done: 5, checks: [{ id: 'z'.repeat(80), ok: false }] })).map((l) => runsText(l.runs)).find((t) => t.includes('checks'));
    expect(one === undefined || one.includes('1 warning')).toBe(true);
  });
});

describe('B2: the band never reads idle while a turn is running', () => {
  test('a running plan item keeps the phase word at every width, in the standard and the rich band', () => {
    for (const cols of [160, 120, 100, 80, 60, 40]) {
      const b = band(model({ cols, busy: true }));
      expect(b).not.toContain('idle');
      if (cols >= 100) expect(b).toMatch(/working/); // round 3: the lead is `working`; the phase word is the rail's, not the one-row band's
    }
    expect(band(model({ cols: 160, rich: true, busy: true }))).not.toContain('idle');
    expect(all(model({ busy: true }))).not.toContain('idle');
  });
  test('nothing running and no busy turn still reads idle', () => {
    for (const cols of [160, 120, 80, 40]) expect(band(model({ cols }))).toContain('idle');
  });
  test('planBusy: an in-progress item of the plan, not one whose owner already returned', () => {
    expect(planBusy([{ status: 'in_progress' }], new Map())).toBe(true);
    expect(planBusy([{ status: 'pending' }, { status: 'completed' }], new Map())).toBe(false);
    expect(planBusy([{ status: 'in_progress', owner: 'a' }], new Map([['a', 'done' as const]]))).toBe(false);
    expect(planBusy([], new Map())).toBe(false);
  });
  test('the Claude band reads the plan: an in-progress item with no worker is not idle', () => {
    const els = { Box: (p: Record<string, unknown>) => ({ p }), Text: (p: Record<string, unknown>) => ({ p }) } as unknown as ClientElements;
    const snapshot = busySnap({ squad: [], activity: {}, comms: [], todos: [{ id: 'a', content: 'run the suite', status: 'in_progress', owner: null, evidence: null, live: true }, { id: 'b', content: 'ship', status: 'pending', owner: null, evidence: null, live: true }] as never });
    const text = (n: unknown): string => JSON.stringify(n);
    const run = (s: typeof snapshot): string => text(bandTree(els, { snapshot: s, live: liveWorkers(s, NOW), gates: [], columns: 120, tick: 0, maxRows: 12, ui } as never));
    expect(run(snapshot)).not.toContain('idle');
    expect(run(busySnap({ squad: [], activity: {}, comms: [] }))).toContain('idle');
  });
});

describe('B3: the band carries no offload and no route drift jargon', () => {
  const blank = (): CoreModel => ({
    contract: { header: { ok: 2, total: 2 }, evidence: { ok: 1, total: 2 }, verifiedDone: { ok: 0, total: 0 }, open: 0, openGates: 0 },
    verdicts: [], claims: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 },
    offload: { workers: [{ name: 'w', role: 'explorer', model: 'm', brief: 0, peak: 10, kept: 7000, returned: 100, costUsd: null, finished: true }], kept: 7000, returned: 100, ratio: 70 },
    routes: [],
  } as unknown as CoreModel);
  const seat = (over: Record<string, unknown> = {}) => ({ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: [], ...over });
  const rt = (over: Record<string, unknown> = {}) => ({ teamId: 't1', name: 'n', cls: 'audit', effort: 'low', isolation: 'shared', maxParallel: 1, seats: [seat({ ran: ['haiku'] })], drift: [], ...over });
  test('offload never shows', () => {
    expect(cellsText(coreCells({ ...blank(), routes: [rt()] } as CoreModel, 300))).not.toContain('offload');
  });
  test('a route that ran as planned shows nothing', () => {
    expect(cellsText(coreCells({ ...blank(), routes: [rt()] } as CoreModel, 300))).not.toContain('route');
  });
  test('a route that differs says so in plain words and never reads drift', () => {
    const m = { ...blank(), routes: [rt({ seats: [seat({ ran: ['haiku', 'haiku', 'haiku'] })], drift: ['3 explorers ran, 1 planned'] })] } as CoreModel;
    const t = cellsText(coreCells(m, 300));
    expect(t).toContain('3 explorers ran, the plan said 1');
    expect(t).not.toContain('drift');
  });
});

describe('B4: contract figures share the plan denominator; counts read n/m', () => {
  const m = {
    contract: { header: { ok: 2, total: 2 }, evidence: { ok: 3, total: 4 }, verifiedDone: { ok: 0, total: 0 }, open: 0, openGates: 0 },
    verdicts: [], claims: [], ledger: { verified: 0, refuted: 0, pending: 0, claimed: 0, unchecked: 0 },
    offload: { workers: [{ name: 'w', role: 'explorer', model: 'm', brief: 0, peak: 10, kept: 7000, returned: 100, costUsd: null, finished: true }], kept: 7000, returned: 100, ratio: 70 }, routes: [],
  } as unknown as CoreModel;
  test('the band row drops the header tally and counts evidence against the plan', () => {
    const t = cellsText(coreCells(m, 200, ui, 5));
    expect(t).not.toContain('headers');
    expect(t).toMatch(/3\/5 (done items carry )?evidence/);
    expect(t).not.toMatch(/\d of \d/);
  });
  test('without a plan the denominator is the done items', () => {
    expect(cellsText(coreCells(m, 200, ui))).toMatch(/3\/4 (done items carry )?evidence/);
  });
  test('the todo count is n/m at every width and in the rich band', () => {
    for (const cols of [160, 120, 100, 80]) {
      const b = band(model({ cols, workers: [{ name: 'a', state: 'running', secs: 1 }] }));
      expect(b).toContain('4/5');
      expect(b).not.toMatch(/\d of \d/);
    }
    expect(band(model({ cols: 160, rich: true }))).not.toMatch(/\d of \d/);
  });
  test('the core tab keeps no header row and shows evidence and verified as n/m of the plan', () => {
    const w = panelWorld('core', 100, ui, { rows: 40, core: m });
    const out = panelText(w as PanelModel).join('\n');
    const plan = (w as PanelModel).todos.length;
    expect(out).not.toMatch(/\bheader\b/);
    expect(out).toMatch(new RegExp(`evidence +3/${plan}\\b`));
    expect(out).toMatch(new RegExp(`verified +0/${plan}\\b|verified +none yet`));
  });
});
