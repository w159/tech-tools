// Side panel counts gates, names agents and uses its height like the band and the HUD (critique-5, Side panel and Top 5 #4).
// Each test was written to fail on c2be624f before mod/panel-layout.ts changed.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { panelWorld } from '../contracts/panel-world';
import { worldGates, worldSidebar, worldSnapshot } from '../contracts/world-live';
import { spinFrameOf, spinnerGlyph, type Ui, type UiState } from './atlas-ui';
import { bandTree } from './band';
import { liveWorkers } from './data/live';
import { gateTally } from './data/runstate';
import { panelModelOf } from './pane/sidebar-model';
import { bodyLines, lineText, panelText, type PanelModel, type PanelNote, type PanelTab, type PanelWorker } from './panel-layout';
import type { GateGroup } from './pane/sidebar-types';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const nodeText = (n: Node): string => (Array.isArray(n.props.children) ? n.props.children.map((k: Node | string) => (typeof k === 'string' ? k : nodeText(k))).join('') : String(n.props.children ?? ''));
const rowsOfTree = (tree: unknown): string[] => ((tree as Node).props.children as Node[]).map((r) => nodeText(r).trimEnd());
const body = (m: PanelModel): string[] => bodyLines(m).map(lineText).map((l) => l.trimEnd());

const worker = (name: string, over: Partial<PanelWorker> = {}): PanelWorker => ({ name, role: 'explorer', state: 'running', detail: 'read runs.ts:17', model: 'opus', task: 'T4', secs: 42, tools: 12, ...over });

// ---- 1. one gates figure --------------------------------------------------------------------------------------------

describe('gates figure: the band and the side panel read gateTally', () => {
  // The world's three groups plus the header contract group, which holds no data yet: it is neither green nor a check.
  const groups: GateGroup[] = [...worldGates(), { id: 'header', title: 'header', lines: [] }];
  const snap = worldSnapshot();

  /** The band's checks row as N and M: every check with its glyph, or `all 3 pass`, or the failing names then `N ok`. */
  const bandFigure = (): [number, number] => {
    const rows = rowsOfTree(bandTree(els, { snapshot: snap, live: liveWorkers(snap, snap.now), gates: groups, columns: 120, tick: 0, maxRows: 12, ui }));
    const checks = rows.find((r) => r.includes('checks'))!;
    const all = /all (\d+) pass/.exec(checks);
    if (all) return [Number(all[1]), Number(all[1])];
    const pairs = [...checks.matchAll(/([●■]) \S+/g)].map((x) => x[1]);
    if (pairs.length) return [pairs.filter((g) => g === '●').length, pairs.length];
    const ok = Number(/(\d+) ok/.exec(checks)![1]);
    return [ok, ok + (checks.match(/■/g) ?? []).length];
  };
  const figure = (text: string): [number, number] | undefined => {
    const m = /(\d+) of (\d+) green/.exec(text);
    return m ? [Number(m[1]), Number(m[2])] : undefined;
  };
  const panel = (tab: PanelTab) => panelText(panelModelOf({ ...worldSidebar(tab, 80, snap), gates: groups }, ui, 80));

  test('the band, the gates tab ribbon and the route tab say the same N of M for one snapshot', () => {
    const tally = gateTally(groups);
    expect(tally.total).toBe(3); // the empty group is not counted
    expect(bandFigure()).toEqual([tally.green, tally.total]);
    expect(figure(panel('gates')[0]!)).toEqual([tally.green, tally.total]);
    expect(figure(panel('route').find((l) => l.startsWith('gates'))!)).toEqual([tally.green, tally.total]);
  });

  test('a group with no data is not listed as a gate on the route row', () => {
    const row = panel('route').find((l) => l.startsWith('gates'))!;
    expect(row).not.toContain('header');
  });

  test('every gate group with an error is a failing check, not a green one', () => {
    const bad: GateGroup[] = [{ id: 'tripwire', title: 'tripwire', lines: [], error: 'hook log unreadable' }, ...worldGates().slice(0, 1)];
    const f = figure(panelText(panelModelOf({ ...worldSidebar('gates', 80, snap), gates: bad }, ui, 80))[0]!);
    expect(f).toEqual([gateTally(bad).green, gateTally(bad).total]);
    expect(f).toEqual([1, 2]);
  });
});

// ---- 2. one name per agent ------------------------------------------------------------------------------------------

describe('agent names: displayName on the team and route tabs', () => {
  const hashed = worker('explorer-3fa9c1', { goal: 'board-auditor: audit the open items' });
  const lead = worker('lead-a3a3ab', { role: 'lead' });

  test('the team tab shows the described name, and the lead reads lead', () => {
    const text = panelText(panelWorld('team', 120, ui, { workers: [hashed], lead })).join('\n');
    expect(text).toContain('board-auditor');
    expect(text).not.toContain('explorer-3fa9c1');
    expect(text).not.toContain('lead-a3a3ab');
    expect(text).toMatch(/^ {2}\S? ?lead\b|lead {2}/m);
  });

  test('the route tab names a working agent the same way', () => {
    const text = panelText(panelWorld('route', 120, ui, { todos: [], workers: [hashed] })).join('\n');
    expect(text).toContain('board-auditor');
    expect(text).not.toContain('explorer-3fa9c1');
  });

  test('a press on a renamed row still addresses the real agent', () => {
    const rows = bodyLines(panelWorld('team', 120, ui, { workers: [hashed] }));
    expect(rows.find((l) => l.press?.kind === 'worker')?.press?.name).toBe('explorer-3fa9c1');
  });

  test('a long name is never cut on the route tab at 80 columns', () => {
    const long = 'board-auditor-open-items-pass'; // 29 cells
    const text = panelText(panelWorld('route', 80, ui, { todos: [], workers: [worker(long)] })).join('\n');
    expect(text).toContain(long);
  });

  test('a long name is never cut on the team tab at 80 columns', () => {
    const long = 'board-auditor-open-items-pass';
    const text = panelText(panelWorld('team', 80, ui, { workers: [worker(long)] })).join('\n');
    expect(text).toContain(long);
  });
});

// ---- 3. the height ---------------------------------------------------------------------------------------------------

describe('fill height: a tall pane shows detail already in the snapshot', () => {
  const team = [worker('implementer-band', { goal: 'implementer-band: wire the band', detail: 'read runs.ts:17' }), worker('implementer-live', { state: 'failed', task: 'T6', detail: 'tests red 3', model: 'sonnet' }), worker('runner-land', { state: 'queued', task: 'T5', detail: 'parked' })];

  test('team: per-agent model, task and last step under each row from 30 rows', () => {
    const rows = body(panelWorld('team', 100, ui, { workers: team, rows: 36 }));
    const joined = rows.join('\n');
    expect(joined).toMatch(/model +opus/);
    expect(joined).toMatch(/task +wire the band/);
    expect(joined).toMatch(/last +read runs\.ts:17/);
    expect(joined).toMatch(/model +sonnet/);
    expect(rows.length).toBeLessThanOrEqual(36 - 6);
  });

  test('team: a short pane keeps one row per agent', () => {
    const rows = body(panelWorld('team', 100, ui, { workers: team, rows: 24 }));
    expect(rows.join('\n')).not.toMatch(/model +opus/);
  });

  test('team: the detail adds no blank rows', () => {
    const rows = body(panelWorld('team', 100, ui, { workers: team, rows: 36 }));
    expect(rows.filter((l) => l === '')).toEqual([]);
  });

  const gates = [
    { id: 'completion', title: 'completion', lines: [{ id: 'c1', label: 'every item has evidence', ok: true }, { id: 'c2', label: 'no open todo', ok: true }] },
    { id: 'tripwire', title: 'tripwire', lines: [{ id: 't1', label: 'no unverified done claim', ok: false, fix: 'run atlas_finding.py' }] },
  ];
  test('gates: each gate lists its checks from 30 rows', () => {
    const rows = body(panelWorld('gates', 100, ui, { gates, rows: 36 })).join('\n');
    expect(rows).toContain('every item has evidence');
    expect(rows).toContain('no unverified done claim');
  });
  test('gates: a short pane keeps the groups closed', () => {
    const rows = body(panelWorld('gates', 100, ui, { gates, rows: 24 })).join('\n');
    expect(rows).not.toContain('every item has evidence');
  });

  const long = 'Picked up the board audit. The owner column reads wrong when two agents share an item, so I am splitting the owner cell and then rerunning the golden tests for the board tab at every width before I report back to the lead.';
  const notes: PanelNote[] = [{ at: '10:01', from: 'implementer-band', text: 'short one' }, { at: '10:04', from: 'implementer-board', to: 'lead', text: long }];
  test('channel: the newest message reads in full over several rows from 30 rows', () => {
    const rows = body(panelWorld('channel', 100, ui, { notes, rows: 36 })).join(' ').replace(/\s+/g, ' ');
    expect(rows).toContain('before I report back to the lead');
  });
  test('channel: a short pane cuts the message to one row', () => {
    const rows = body(panelWorld('channel', 100, ui, { notes, rows: 24 })).join(' ').replace(/\s+/g, ' ');
    expect(rows).not.toContain('before I report back to the lead');
  });
  test('channel: the log stays inside the pane', () => {
    expect(panelText(panelWorld('channel', 100, ui, { notes, rows: 30 })).length).toBeLessThanOrEqual(30);
  });
});

// ---- 4. spinners -----------------------------------------------------------------------------------------------------

describe('spinners: spinFrameOf(now, worker name) on every row', () => {
  const NOW = 1_700_000_000_000;
  const glyphOf = (rows: readonly string[], name: string): string => rows.find((l) => l.includes(name))!.trimStart().replace(/^▸\s*/, '')[0]!;
  const two = [worker('alpha-one'), worker('beta-two')];
  const frame = (name: string): string => spinnerGlyph(spinFrameOf(NOW, name));

  test('the team tab turns each agent by its own phase at one clock reading', () => {
    const rows = body(panelWorld('team', 100, ui, { workers: two, now: NOW, rows: 24 }));
    expect(glyphOf(rows, 'alpha-one')).toBe(frame('alpha-one'));
    expect(glyphOf(rows, 'beta-two')).toBe(frame('beta-two'));
    expect(frame('alpha-one')).not.toBe(frame('beta-two')); // the fixture names differ in phase
  });

  test('the route tab agrees with the team tab for the same agent', () => {
    const route = body(panelWorld('route', 100, ui, { todos: [], workers: two, now: NOW }));
    expect(glyphOf(route, 'alpha-one')).toBe(frame('alpha-one'));
  });

  test('the route plan rows turn by their owner', () => {
    const todos = [{ id: 'a', label: 'Wire the band', state: 'running' as UiState, owner: 'alpha-one' }];
    const route = body(panelWorld('route', 100, ui, { todos, workers: two, now: NOW, rows: 24 }));
    expect(glyphOf(route.filter((l) => l.includes('Wire the band')), 'Wire the band')).toBe(frame('alpha-one'));
  });

  test('without a clock reading the tick still drives the frame', () => {
    const rows = body(panelWorld('team', 100, ui, { workers: [worker('alpha-one')], tick: 2, rows: 24 }));
    expect(glyphOf(rows, 'alpha-one')).toBe(spinnerGlyph(2));
  });

  test('panelModelOf carries the snapshot clock', () => {
    const snap = worldSnapshot();
    expect(panelModelOf(worldSidebar('team', 80, snap), ui, 80).now).toBeGreaterThanOrEqual(snap.now);
  });
});

// ---- 5. the agents row ---------------------------------------------------------------------------------------------

describe('route tab: the agents row heads agents', () => {
  test('the rows under `agents` are agents, not plan rows', () => {
    const done = ['implementer-band', 'implementer-live', 'runner-land', 'implementer-layout'].map((n) => worker(n, { state: 'done', detail: 'finished' }));
    const todos = ['T1', 'T2', 'T3'].map((id, i) => ({ id, label: `Plan item ${id}`, state: 'done' as UiState, owner: done[i]!.name }));
    const rows = body(panelWorld('route', 100, ui, { todos, workers: done, rows: 36 }));
    const at = rows.findIndex((l) => l.startsWith('agents'));
    const next = rows.findIndex((l, i) => i > at && l.startsWith('todo'));
    expect(at).toBeGreaterThanOrEqual(0);
    const under = rows.slice(at + 1, next).join('\n');
    for (const d of done) expect(under).toContain(d.name);
    expect(under).not.toContain('Plan item');
  });

  test('a short pane keeps the counts alone', () => {
    const done = [worker('implementer-band', { state: 'done', detail: 'finished' })];
    const rows = body(panelWorld('route', 100, ui, { todos: [], workers: done, rows: 24 }));
    const at = rows.findIndex((l) => l.startsWith('agents'));
    expect(rows[at + 1] ?? '').not.toContain('implementer-band');
  });
});
