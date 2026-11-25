// M6: err and stale are live. Every case starts at a READER result (the atlas_gates.py groups of a run that failed or not, the team and matrix files of the core read), notes it the way
// register.ts does (data/readinfo.ts), builds the panel model the way the host does (panelModelOf) and reads the rendered cell. No `read` object is built by hand here.
import { describe, expect, test as bare } from 'claude-code/testing';
import { busySnap, NOW } from '../../live_fixture';
import type { LiveSnapshot } from '../../orchestra-types';
import { bodyLines, lineText, panelLines } from '../panel/panel-layout';
import type { PanelGate } from '../panel/panel-layout';
import { panelModelOf } from '../panel/pane/sidebar-model';
import type { SidebarModel } from '../panel/pane/sidebar';
import { forgetRefusals } from '../../data/channels';
import { coreModel } from '../../data/core';
import type { Health } from '../../data/idle-health';
import { noteGatesRead, noteRoutesRead, readInfoOf, resetReads } from '../../data/readinfo';
import { gatesError, parseGates } from '../../host/gates';
import type { Ui } from '../../design/atlas-ui';

const ui: Ui = { theme: 'mocha', ascii: true, color: 'truecolor' };
const GOOD = JSON.stringify({ groups: [{ id: 'completion', title: 'Completion', lines: [{ id: 'd', label: 'Code changes delegated', ok: true }] }, { id: 'tripwire', title: 'Tripwire', lines: [{ id: 't', label: 'Team mode', ok: true }] }] });
const MATRIX = JSON.stringify({ classes: {} });
const TEAM = JSON.stringify({ class: 'implement', effort: 'low', channel: 'lead-abc', members: [{ name: 'w-1' }], created: 1 });

const health = (): Health => ({
  gates: { total: 2, green: 2, checks: [{ id: 'completion', ok: true, lines: 1, pass: 1 }, { id: 'tripwire', ok: true, lines: 1, pass: 1, lastSecs: 6 }] }, version: '1.0.0', branch: 'main', team: 'off', upSecs: 100,
  hooks: { total: 4, byLabel: [{ label: 'prompt.submit', n: 1 }, { label: 'tool.call', n: 3 }], recent: [{ label: 'tool.call Bash', ageSecs: 7, ms: 3 }, { label: 'prompt.submit', ageSecs: 30, ms: 4 }], lastEventSecs: 7, runTools: 3, latency: { n: 4, p50: 3, p95: 4 } },
  pulse: { events: [0, 1, 2], ctx: [], runs: [] },
} as Health);
const world = (): LiveSnapshot => (forgetRefusals(), { ...busySnap(), squad: [], activity: {}, comms: [], members: [], todos: [], now: NOW }) as LiveSnapshot;

const model = (view: SidebarModel['ui']['view'], clock: number, over: Partial<SidebarModel> = {}) => panelModelOf(
  { snapshot: world(), gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: 121, rows: 60, tick: 0, clock, run: { kind: 'working', secs: 5, startMs: NOW, frame: 0 }, health: health(), ...over } as SidebarModel, ui, 120);
const status = (clock: number): string[] => panelLines(model('route', clock)).map((l) => lineText(l).trimEnd());
const gatesTab = (clock: number, gates: PanelGate[]): string[] => bodyLines(model('gates', clock, { gates: gates as never })).map((l) => lineText(l).trimEnd());
const row = (rows: string[], name: string): string => rows.find((l) => l.includes(name)) ?? '';
const gatesHead = (clock: number): string => row(gatesTab(clock, parseGates(GOOD) as never), 'GATES'); // the gates tab's header carries how the gates were read: nothing for a fresh read, `~1m` for a stale one, `err` for a failed one
const gatesOf = (stdout: string) => parseGates(stdout);

const test = (name: string, fn: () => void): void => bare(name, () => { resetReads(); try { fn(); } finally { resetReads(); } });

describe('gates: reader result to rendered cell', () => {
  test('nothing read yet: no ReadInfo, the row keeps its plain age', () => {
    expect(readInfoOf(NOW)).toBeUndefined();
    expect(gatesHead(NOW)).not.toMatch(/~|err/);
  });
  test('fresh read (inside the 30 s interval): plain age, no mark', () => {
    noteGatesRead(gatesOf(GOOD), NOW);
    const r = gatesHead(NOW + 5_000);
    expect(r).toContain('this run');
    expect(r).not.toContain('~');
    expect(r).not.toContain('err');
  });
  test('old read (past the interval): the figure is `~` and carries the real age (its own plus the snapshot s)', () => {
    noteGatesRead(gatesOf(GOOD), NOW);
    expect(gatesHead(NOW + 90_000)).toMatch(/~1m/); // 6 s + 90 s
  });
  test('stale gates never age the hook rows: the hook log is in memory with no refresh interval', () => {
    noteGatesRead(gatesOf(GOOD), NOW);
    const out = bodyLines(model('core', NOW + 90_000)).map((l) => lineText(l).trimEnd());
    const hooks = out.filter((l) => /hook p50|tools\/min/.test(l));
    expect(hooks.length).toBe(2);
    expect(hooks.some((l) => l.includes('~'))).toBe(false);
  });
  test('missing script (nonzero exit becomes an error group): the rows say err, not the no-data dash', () => {
    noteGatesRead([gatesError('python3: can not open file atlas_gates.py')], NOW);
    expect(gatesHead(NOW)).toMatch(/err/);
  });
  test('unreadable output (bad JSON throws in the parser, the run stores the error group): the gates tab says err and the reason', () => {
    let groups;
    try { groups = parseGates('not json'); } catch (e) { groups = [gatesError(String(e))]; }
    noteGatesRead(groups, NOW);
    const out = gatesTab(NOW, groups as never).join('\n');
    expect(out).toMatch(/err/);
  });
  test('a later good read clears the failure', () => {
    noteGatesRead([gatesError('boom')], NOW);
    noteGatesRead(gatesOf(GOOD), NOW + 1_000);
    expect(gatesHead(NOW + 2_000)).not.toContain('err');
  });
});

describe('routes: reader result to the core tab', () => {
  const core = () => coreModel({ findings: '', teams: [{ name: 't.json', text: TEAM }], matrix: MATRIX, logs: {}, reports: [], todos: [], header: { ok: 0, total: 0 }, openGates: 0, channels: ['lead-abc'], dispatches: [] } as never);
  const coreTab = (): string => bodyLines(model('core', NOW, { core: core() })).map((l) => lineText(l).trimEnd()).join('\n');
  test('readable matrix and team files: ROUTING draws the route, no failure word', () => {
    noteRoutesRead({ matrix: MATRIX, teams: [{ text: TEAM }] }, NOW);
    const out = coreTab();
    expect(out).toContain('ROUTING');
    expect(out).not.toContain('read failed');
  });
  test('missing scope-matrix.json (null from the reader): ROUTING says read failed', () => {
    noteRoutesRead({ matrix: null, teams: [{ text: TEAM }] }, NOW);
    expect(coreTab()).toMatch(/ROUTING[\s\S]*read failed/);
  });
  test('an unreadable team record (null) and a torn one (not JSON) both fail; an empty one (write in progress) does not', () => {
    noteRoutesRead({ matrix: MATRIX, teams: [{ text: null }] }, NOW);
    expect(coreTab()).toContain('read failed');
    noteRoutesRead({ matrix: MATRIX, teams: [{ text: '{"class":' }] }, NOW);
    expect(coreTab()).toContain('read failed');
    noteRoutesRead({ matrix: MATRIX, teams: [{ text: '' }] }, NOW);
    expect(coreTab()).not.toContain('read failed');
  });
});
