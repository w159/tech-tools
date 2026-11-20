// One run-state model: the band, the checks row and the side panel's gates count read the same derived values.
import { describe, expect, test } from 'claude-code/testing';
import type { Ui } from '../design/atlas-ui';
import { textWidth } from '../design/theme';
import { gateTally, blockReasons, warningText, ranWorkers } from './runstate';
import { endedOf, settleDispatch } from './todos';
import { bandLines, runsText, missionLines, type MissionModel } from '../view/band/mission-layout';
import type { ClientElements } from 'claude-code';
import { bandTree } from '../view/band/band';
import { busySnap } from '../live_fixture';
import { coreFixture, coreMatrix } from '../../contracts/core-fixture';
import { panelWorld } from '../../contracts/panel-world';
import { coreModel } from './core';
import { withHeaderTally } from './runstate';
import { panelText } from '../view/panel/panel-layout';
import type { PanelModel } from '../view/panel/panel-layout';
import type { GateGroup } from '../view/panel/pane/sidebar-types';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['plan', 'research', 'build', 'verify', 'ship'] as const;
const model = (over: Partial<MissionModel> = {}): MissionModel => ({
  cols: 120, maxRows: 12, tick: 0, project: 'p', phases: PHASES, phase: 'done', done: 5, total: 5, workers: [], checks: null, ui, ...over,
});
const line = (ok: boolean, id = 'x') => ({ id, label: id, ok });
const groups = [
  { id: 'header', title: 'Header', lines: [line(true)] },
  { id: 'completion', title: 'C', lines: [line(true)] },
  { id: 'tripwire', title: 'T', lines: [line(false)] },
  { id: 'routing', title: 'R', lines: [line(true)] },
  { id: 'empty', title: 'E', lines: [] },
] as never;

describe('runstate: gates and checks are one count', () => {
  test('gateTally counts every group with data, the header included', () => {
    const t = gateTally(groups);
    expect(t.total).toBe(4);
    expect(t.green).toBe(3);
    expect(t.failing).toEqual(['tripwire']);
    expect(t.checks.map((c) => c.id)).toEqual(['header', 'completion', 'tripwire', 'routing']);
  });
  test('the checks row total equals the tally total', () => {
    const t = gateTally(groups);
    const row = runsText(missionLines(model({ checks: t.checks, cols: 120, workers: [] })).map((l) => l.runs).flat());
    expect(row).toContain('tripwire');
    for (const id of ['header', 'completion', 'tripwire', 'routing']) expect(row).toContain(id);
    expect(missionLines(model({ checks: t.checks.slice(0, 1), cols: 80 })).length).toBeGreaterThan(0);
  });
});

describe('runstate: blocked shows glyph, word and reason at every width; a failing check alone is a warning', () => {
  const checks = [{ id: 'routing', ok: true }, { id: 'tripwire', ok: false }];
  for (const cols of [40, 60, 80, 120]) {
    test(`${cols} cells`, () => {
      const t = runsText(bandLines(model({ cols, checks, stopGates: ['tripwire'] }))[0]!.runs);
      expect(t).toContain('▲ blocked');
      expect(textWidth(t)).toBeLessThanOrEqual(cols);
      if (cols >= 60) expect(t).toContain('stop refused'); // state 38: the gate's own name is gone
      const w = runsText(bandLines(model({ cols, checks }))[0]!.runs);
      expect(w).not.toContain('blocked');
      expect(w).toContain('△');
      expect(textWidth(w)).toBeLessThanOrEqual(cols);
      if (cols >= 60) expect(w).toContain('1 gate to check');
    });
  }
  test('the tally reads the Stop verdict line and never counts it as a check', () => {
    const stop = (label: string, detail?: string) => ({ id: 'completion', title: 'C', lines: [line(true, 'a'), { id: 'stop-verdict', label, ok: true, ...(detail ? { detail } : {}) }] });
    expect(gateTally([stop('Last Stop blocked', 'Team gate, Todos drained')] as never).stop).toEqual({ blocked: true, gates: ['team gate', 'todos drained'] });
    expect(gateTally([stop('Last Stop allowed')] as never).stop).toEqual({ blocked: false, gates: [] });
    expect(gateTally(groups).stop).toBeNull();
    const only = gateTally([{ id: 'completion', title: 'C', lines: [{ id: 'stop-verdict', label: 'Last Stop allowed', ok: true }] }] as never);
    expect(only.total).toBe(0); // a group holding only the verdict has no data
    expect(gateTally([stop('Last Stop blocked', 'Team gate')] as never).failing).toEqual([]); // blocked Stop is not a failing check
  });
  test('critique 9 (state 38): the reason is `stop refused` at every width; never a gate letter, a gate word or `stop:`', () => {
    const stop = (detail: string) => ({ id: 'completion', title: 'C', lines: [{ id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail }] });
    const gates = gateTally([stop('1 todo open')] as never).stop!.gates;
    expect(gates).toEqual(['1 todo open']);
    for (const cols of [60, 80, 110, 150]) {
      const t = runsText(bandLines(model({ cols, stopGates: gates, done: 4, openWork: 1 }))[0]!.runs); // an open plan row: `4/5` and `1 todo open` agree (a full plan reads `retry stop`, critique 18 A1)
      expect(t).toContain('blocked · stop refused');
      expect(t).not.toContain('stop:');
      expect(t).not.toMatch(/\br\b/);
    }
    // a bare letter or the stand-in word becomes a sentence, not a letter
    expect(gateTally([stop('r')] as never).stop!.gates).toEqual(['stop refused']);
    expect(gateTally([stop('gate')] as never).stop!.gates).toEqual(['stop refused']);
    // however many gates refused, the reason is the one word pair
    expect(blockReasons(false, ['1 agent running', '3 todos open']).long).toBe('stop refused');
    expect(blockReasons(false, ['verified finding recorded', 'implementer work verified']).long).toBe('stop refused');
  });
  test('warningText', () => {
    expect(warningText(['tripwire'])).toBe('tripwire warning');
    expect(warningText(['a', 'b'])).toBe('2 gates warning');
  });
  test('declared blocked has no reason of its own (state 38: no `needs you`)', () => {
    const t = runsText(bandLines(model({ blocked: true, phase: 'blocked' }))[0]!.runs);
    expect(t).toContain('▲ blocked');
    expect(t).not.toContain('needs you');
  });
  test('blockReasons', () => {
    expect(blockReasons(false, ['tripwire']).long).toBe('stop refused');
    expect(blockReasons(false, ['a', 'b']).long).toBe('stop refused');
    // one string at every width: the short form is the long form
    expect(blockReasons(false, ['tripwire']).short).toBe('stop refused');
    expect(blockReasons(true, ['a']).long).toBe('stop refused');
    expect(blockReasons(true, []).long).toBe('run blocked');
    expect(blockReasons(true, [], undefined, undefined, 1).long).toBe('1 failed');
  });
});

describe('runstate: one vocabulary at every width', () => {
  const m = (cols: number) => model({ cols, phase: 'build', done: 3, total: 0, workers: [{ name: 'a', state: 'running', secs: 1 }, { name: 'f', state: 'failed', secs: 1 }] });
  for (const cols of [60, 80, 120]) {
    test(`${cols} cells use the long word`, () => {
      const t = runsText(bandLines(m(cols))[0]!.runs);
      expect(t).toContain('phase 3/5');
      expect(t).not.toMatch(/\bph \d/);
    });
  }
  test('abbreviates only when the long word does not fit', () => {
    const t = runsText(bandLines(m(48))[0]!.runs);
    expect(textWidth(t)).toBeLessThanOrEqual(48);
    expect(t).toContain('phase 3/5'); // round 3: the long word fits at 48 (the lead is shorter), so it is never abbreviated
    expect(t).not.toMatch(/\bph \d/);
  });
});

describe('runstate: last run counts real dispatches', () => {
  test('dispatch rows that ran count even when the host no longer lists them', () => {
    expect(ranWorkers(['gamma'], ['alpha', 'beta', 'gamma', 'delta']).sort()).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });
});

describe('runstate: dispatch rows close from agent completion (S1)', () => {
  test('a reported agent absent from the squad settles its row', () => {
    const ended = endedOf([], { stage: { a1: 'reported' }, meta: { a1: { name: 'alpha' } }, activity: { a1: { mood: 'done' } } } as never);
    expect(ended).toEqual({ alpha: 'done' });
    const rows = settleDispatch([{ status: 'pending', owner: 'alpha', origin: 'dispatch' }], ended);
    expect(rows[0]!.status).toBe('ended');
  });
});

describe('runstate-band', () => {
// Band adapter side of the one run-state model: the checks row and the last-run count come from the same data as the other surfaces.

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => t.props.children).join('');
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const idleSnap = (over: Record<string, unknown> = {}) => busySnap({ squad: [], activity: {}, comms: [], ...over } as never);
const render = (snapshot: ReturnType<typeof busySnap>, gates: unknown[], columns = 120): string => {
  const node = bandTree(els, { snapshot, live: [], gates, columns, tick: 0, maxRows: 12, ui } as never) as unknown as Node;
  return (node.props.children as Node[]).map(text).join('\n');
};
const grp = (id: string, ok: boolean) => ({ id, title: id, lines: [{ id: `${id}-l`, label: id, ok }] });

describe('band: one run state', () => {
  test('the checks row lists the same groups as the gates tab, header included', () => {
    const out = render(idleSnap(), [grp('completion', true), grp('tripwire', false), grp('routing', true), grp('header', true)]);
    for (const id of ['completion', 'tripwire', 'routing', 'header']) expect(out).toContain(id);
  });
  test('last run counts the dispatches that ran, not the workers still listed', () => {
    const rows = ['alpha', 'beta', 'gamma', 'delta'].map((owner, n) => ({ id: `d${n}`, content: `dispatch ${owner}`, status: 'completed', origin: 'dispatch', owner }));
    expect(render(idleSnap({ todos: rows }), [])).toContain('4 workers');
  });
});
});

describe('truth-a', () => {
// Critique 8, slice A: the header contract has one evaluation (core row and gates tab), and BLOCKED follows the Stop verdict only.

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const headerPass = { id: 'header', title: 'Header contract', lines: [{ id: 'header-matched', label: 'Last reply header matched', ok: true, detail: 'declared phase: research' }] } as GateGroup;
const core = (ok: number, total: number) => coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok, total }, openGates: 0 });
const text = (tab: PanelModel['tab'], over: Partial<PanelModel>): string[] => panelText(panelWorld(tab, 120, ui, { rows: 40, ...over }));

describe('A3: header n of m and the Header contract row are one evaluation', () => {
  test('the last reply matched but 6 of 8 replies did: the gate is not passing', () => {
    const groups = withHeaderTally([headerPass], { ok: 6, total: 8 });
    expect(groups[0]!.lines).toEqual([{ id: 'header-matched', label: 'Replies with header matched', ok: false, detail: '6 of 8' }]);
    const t = gateTally(groups as never);
    expect(t.failing).toEqual(['header']);
  });
  test('every reply matched: the gate passes and says n of n', () => {
    const groups = withHeaderTally([headerPass], { ok: 8, total: 8 });
    expect(groups[0]!.lines[0]).toMatchObject({ ok: true, detail: '8 of 8' });
  });
  test('no replies counted yet: the gate keeps its own line', () => {
    expect(withHeaderTally([headerPass], { ok: 0, total: 0 })[0]).toBe(headerPass);
    expect(withHeaderTally([headerPass], undefined)[0]).toBe(headerPass);
    expect(withHeaderTally([], { ok: 1, total: 2 })).toEqual([]);
  });
  test('the gates tab reads the core tally: core amber 6 of 8 never sits beside a passing Header contract', () => {
    const rows = text('gates', { gates: [headerPass] as never, core: core(6, 8) }).join('\n');
    expect(rows).toMatch(/✗ Replies with header matched/); // redesign: a failing line is a red `✗` row (and a DENIED entry), not an amber `△ ... warning` one
    expect(rows).not.toContain('Last reply header matched');
    expect(rows).toContain('6 of 8'); // critique 19 C4: the figure is the reply tally, not the one line's `0/1 green`
    const all = text('gates', { gates: [headerPass] as never, core: core(8, 8) }).join('\n');
    expect(all).not.toMatch(/✗ Replies with header/);
    expect(all).toContain('✓ Replies with header matched'); // every reply matched: the one line is green
  });
});
});
