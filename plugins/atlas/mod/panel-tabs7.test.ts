// Critique 7, side panel: the channel, team and core tabs carry the panel surface down to the pane's foot row (C5), the core tab says what
// happened in plain words (C5), the route tab's progress bar is quieter than a state (C5), and the team footer keeps the tab's indent (C6).
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld } from '../contracts/panel-world';
import { GRID_LEAD, PALETTES, type Ui } from './atlas-ui';
import { coreModel, type CoreModel } from './data/core';
import { bodyLines, fillRows, headerRows, lineText, panelLines, type PanelModel, type PanelTab } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const core: CoreModel = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
const body = (t: PanelTab, cols: number, over: Partial<PanelModel> = {}, ui: Ui = mocha): string[] => bodyLines(panelWorld(t, cols, ui, { rows: 40, ...over })).map((l) => lineText(l).trimEnd());

describe('C5: content plus fill reaches the foot row', () => {
  for (const rows of [30, 40]) {
    for (const tab of ['channel', 'team', 'core'] as PanelTab[]) {
      test(`${tab} at ${rows} rows: the live-sized body plus its fill is exactly rows - 1 lines`, () => {
        const m = panelWorld(tab, 37, mocha, { core, rows, notes: panelWorld('channel', 37, mocha).notes.slice(0, 3) } as never);
        const used = panelLines(m).length;
        const fill = fillRows(m, bodyLines(m).length);
        expect([tab, rows, used + fill.length]).toEqual([tab, rows, rows - 1]);
        for (const l of fill) expect(l.runs.length === 0 || lineText(l).trim() === '').toBe(true); // blank rows: the panel surface, no ink
      });
    }
  }
  test('a body already as tall as the pane gets no fill, and the other tabs are not stretched', () => {
    const m = panelWorld('team', 37, mocha, { rows: 8 });
    expect(headerRows(m).length + bodyLines(m).length).toBeGreaterThanOrEqual(7);
    expect(fillRows(m, bodyLines(m).length)).toEqual([]);
    for (const tab of ['route', 'gates'] as PanelTab[]) expect(fillRows(panelWorld(tab, 37, mocha, { rows: 40 }), 3)).toEqual([]);
  });
});

describe('C5: the core tab says what happened', () => {
  const c = JSON.parse(JSON.stringify(core)) as CoreModel;
  c.routes = [{ teamId: 't1', name: 'audit', cls: 'audit', effort: 'low', isolation: 'shared', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
  const text = body('core', 120, { core: c }).join('\n');
  test('a team that ran differently reads "planned audit team (low effort), ran 3 explorers"', () => {
    expect(text).toContain('3 explorers ran, the plan said 1');
  });
  test('no jargon: not "drift", not "the plan and what ran", not "3x explorer drift", not "audit/low drift"', () => {
    for (const bad of ['drift', 'plan and what ran', 'x explorer drift']) expect([bad, text.includes(bad)]).toEqual([bad, false]);
    for (const w of [37, 60, 80, 120]) expect([w, body('core', w, { core: c }).join('\n').includes('drift')]).toEqual([w, false]);
  });
  test('the seat row says "off plan" where it used to say "drift" and then "differs"', () => {
    expect(text).toMatch(/3x explorer +too many +3 ran, the plan said 1/);
  });
});

describe('C5: the route progress bar is quieter than a state', () => {
  const todos = [{ id: '1', label: 'a', state: 'done' as const }, { id: '2', label: 'b', state: 'running' as const }, { id: '3', label: 'c', state: 'queued' as const }, { id: '4', label: 'd', state: 'queued' as const }];
  const bar = (ui: Ui) => bodyLines(panelWorld('route', 80, ui, { rows: 40, todos } as never)).flatMap((l) => l.runs).filter((r) => /^[█▏▎▍▌▋▊▉░]+$/.test(r.t));
  test('the fill is the ok tone and the track the muted tone, never info or line', () => {
    const runs = bar(mocha);
    expect(runs.find((r) => /█/.test(r.t))?.tone).toBe('ok');
    expect(runs.find((r) => /░/.test(r.t))?.tone).toBe('muted');
    expect(PALETTES.mocha.ok).not.toBe(PALETTES.mocha.info);
  });
});

describe('C6: the team footer keeps the tab indent', () => {
  test('"workers 0 running · 3 done" starts in the name column, like the lead row above it (the lead is named once, critique 11 A4)', () => {
    const lead = { name: 'lead', role: 'lead', state: 'waiting' as const, detail: 'waiting for you' };
    const workers = panelWorld('team', 80, mocha).workers.slice(0, 3).map((w) => ({ ...w, state: 'done' as const }));
    const rows = body('team', 80, { lead, workers, rows: 24 });
    const foot = rows.at(-1)!;
    expect(foot).toBe('    workers  0 running · 3 done');
    expect(foot.indexOf('workers')).toBe(GRID_LEAD);
    expect(rows.find((l) => /\blead\b +waiting/.test(l))!.indexOf('lead')).toBe(foot.indexOf('workers')); // the lead's own row starts in the same column
    expect(rows.filter((l) => /\blead\b/.test(l))).toHaveLength(1);
  });
});
