// Critique 14, slice C: one truth and polish. Shapes come from the live runs at build 61858003 (live-150-61858003-{1,3}, live-110-61858003-1) and
// motion-61858003/todo-strip.ans. Expectations are literal text.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { panelWorld } from '../contracts/panel-world';
import { bandTree } from './band';
import type { Ui } from './atlas-ui';
import { coreModel, type CoreModel } from './data/core';
import { gateTally } from './data/runstate';
import { busySnap } from './live_fixture';
import { bandLines, runsText, type MissionModel } from './mission-layout';
import { bodyLines, lineText, ribbonRow, type PanelModel } from './panel-layout';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => t.props.children).join('');
const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const lead = (mood: string) => ({ lead: { tool: null, since: 0, toolCount: 0, tokens: null, mood, lastLine: '' } });
const grp = (id: string, ok: boolean) => ({ id, title: id, lines: [{ id: `${id}-l`, label: id, ok }] });
const bandOf = (over: Record<string, unknown>, gates: unknown[] = [], columns = 150): string[] =>
  ((bandTree(els, { snapshot: busySnap({ squad: [], comms: [], sessionId: 'd87fbe79', activity: lead('idle'), ...(over.snap as object ?? {}) } as never), live: [], gates, columns, tick: 0, maxRows: 12, ui: mocha, core: null, ...(over.band as object ?? {}) } as never) as unknown as Node).props.children as Node[]).map(text);

describe('C1: the band is never idle once a turn runs', () => {
  test('f0017: the host spinner runs (isWorking), no hook has fired yet: the band does not read `idle`', () => {
    expect(bandOf({})[0]).toContain('idle'); // nothing known: a quiet session
    expect(bandOf({ band: { working: true } })[0]).not.toContain('idle');
  });
  test('f0091: `last run ... all ok` never sits above a failing check, even while the lead is still busy', () => {
    const done = ['alpha', 'beta', 'gamma'].map((n, i) => ({ id: `d${i}`, content: `${n} read`, status: 'completed', origin: 'dispatch', session_id: 'd87fbe79', owner: `${n}-explorer` }));
    const out = bandOf({ snap: { todos: done, activity: lead('working') } }, [grp('completion', true), grp('routing', false)]).join('\n');
    expect(out).toContain('last run');
    expect(out).toContain('▲ routing');
    expect(out).not.toContain('all ok');
    expect(bandOf({ snap: { todos: done, activity: lead('working') } }, [grp('completion', true), grp('routing', true)]).join('\n')).toContain('all ok');
  });
  test('f0095 (110): phase `done` is not drawn beside a failing check', () => {
    const m: MissionModel = { cols: 110, maxRows: 12, tick: 0, project: 'p', phases: ['research', 'plan', 'done'], phase: 'done', done: 5, total: 5, workers: [], busy: true, checks: [{ id: 'routing', ok: false, name: 'routing' }, { id: 'completion', ok: true }], ui: mocha };
    const head = runsText(bandLines(m)[0]!.runs);
    expect(head).toContain('▲');
    expect(head).not.toMatch(/\bdone\b/);
    expect(runsText(bandLines({ ...m, busy: false, checks: [{ id: 'completion', ok: true }] })[0]!.runs)).toMatch(/\bdone\b/);
  });
});

describe('C2: the gate denominator is fixed from the first frame', () => {
  const three = [grp('completion', true), grp('tripwire', true), grp('routing', true)];
  test('f0017: the header group has no reply yet; it still counts, so 3/3 never becomes x/4', () => {
    const before = gateTally([...three, { id: 'header', title: 'Header contract', lines: [] }] as never);
    expect([before.green, before.total]).toEqual([4, 4]);
    const after = gateTally([...three, { id: 'header', title: 'Header contract', lines: [{ id: 'h', label: 'Replies with header matched', ok: true }] }] as never);
    expect([after.green, after.total]).toEqual([4, 4]);
  });
  test('a pending header group is never a failure', () => {
    expect(gateTally([...three, { id: 'header', title: 'Header contract', lines: [] }] as never).failing).toEqual([]);
  });
});

describe('C3: the core tab and the gates tab say one thing', () => {
  const base = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });
  const core = JSON.parse(JSON.stringify(base)) as CoreModel;
  core.contract.evidence = { ok: 0, total: 5 };
  core.contract.verifiedDone = { ok: 0, total: 5 };
  core.routes = [{ teamId: 't1', name: 'audit', cls: 'audit', effort: 'low', isolation: 'shared', maxParallel: 3, drift: ['explorer ran 3, seat plans 1'], transport: 'in-process', seats: [{ role: 'explorer', count: 1, model: 'haiku', effort: 'low', ran: ['haiku', 'haiku', 'haiku'] }] }];
  const todos = [1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, label: `T${i}`, state: 'done' as const }));
  const gates = (a: boolean, b: boolean) => [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'a', label: 'Evidence captured', ok: a }, { id: 'b', label: 'Verified finding recorded', ok: b }] }];
  const out = (over: Partial<PanelModel> = {}, cols = 150): string[] => bodyLines(panelWorld('core', cols, mocha, { core, todos, rows: 40, ...over })).map((l) => lineText(l).trimEnd());

  test('f0001 (150-1 tab-core): the off-plan team is amber like the gates tab, never a red square', () => {
    const rows = out({ gates: gates(true, true) });
    for (const key of ['3 explorers ran, the plan said 1', 'too many']) {
      const row = rows.find((l) => l.includes(key))!;
      expect([key, row.includes('▲'), row.includes('■')]).toEqual([key, true, false]);
    }
  });
  test('gates say evidence and verified findings are fine for this run: the core rows do not flag them', () => {
    const rows = out({ gates: gates(true, true) });
    for (const name of ['evidence', 'verified']) {
      const row = rows.find((l) => new RegExp(`\\s${name}\\s+0/5`).test(l))!;
      expect([name, row.includes('▲'), row.includes('not required')]).toEqual([name, false, true]);
    }
  });
  test('gates say evidence is missing: the core row stays amber with its reason', () => {
    const row = out({ gates: gates(false, true) }).find((l) => /\sevidence\s+0\/5/.test(l))!;
    expect(row).toContain('▲');
    expect(row).toContain('5 done without evidence');
  });
  test('f0001: the core labels sit in the name column like the other tabs', () => {
    const rows = out({ gates: gates(true, true) });
    for (const name of ['done items', 'verdicts', 'reading', 'dispatches']) expect([name, rows.some((l) => new RegExp(`^ {4}${name}\\b`).test(l))]).toEqual([name, true]);
  });
});

describe('C5: plain words and one count', () => {
  test('f0017: the route tab with no plan says `no tasks yet` once', () => {
    const rows = bodyLines(panelWorld('route', 150, mocha, { todos: [], workers: [], rows: 40 })).map((l) => lineText(l));
    expect(rows.join('\n').match(/no tasks yet/g)?.length).toBe(1);
  });
  test('the team tab states its worker tally once (`3 done`), at 38 and at 150', () => {
    const w = (n: string) => ({ name: n, role: 'explorer', state: 'done' as const, detail: 'read x.py' });
    for (const cols of [38, 150]) {
      const m = panelWorld('team', cols, mocha, { todos: [], workers: [w('alpha'), w('beta'), w('gamma')], lead: { name: 'lead', role: 'lead', state: 'done', detail: '' }, rows: 40 });
      const all = [lineText(ribbonRow(m)), ...bodyLines(m).map((l) => lineText(l))].join('\n');
      expect([cols, all.match(/3 done/g)?.length]).toEqual([cols, 1]);
    }
  });
});
