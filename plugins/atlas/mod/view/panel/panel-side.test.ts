// Side panel counts gates, names agents and uses its height like the band and the HUD (critique-5, Side panel and Top 5 #4).
// Each test was written to fail on c2be624f before mod/view/panel/panel-layout.ts changed.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { panelWorld } from '../../../contracts/panel-world';
import { worldGates, worldSidebar, worldSnapshot } from '../../../contracts/world-live';
import { leadSpinnerGlyph, spinFrameOf, spinnerGlyph, type Ui, type UiState } from '../../design/atlas-ui';
import { bandTree } from '../band/band';
import { liveWorkers } from '../../data/live';
import { gateTally } from '../../data/runstate';
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
  // The world's three groups plus the header contract group, which holds no reply yet: it is a pending check from the first frame (critique 14: `3/3` never becomes `x/4`), never a failure.
  const groups: GateGroup[] = [...worldGates(), { id: 'header', title: 'header', lines: [] }];
  const snap = worldSnapshot();

  /** The band's checks row as N and M: every check with its glyph, or `all 3 pass`, or the failing names then `N ok`. */
  const bandFigure = (): [number, number] => {
    const rows = rowsOfTree(bandTree(els, { snapshot: snap, live: liveWorkers(snap, snap.now), gates: groups, columns: 120, tick: 0, maxRows: 12, ui }));
    const checks = rows.find((r) => r.includes('checks'))!;
    const all = /all (\d+) pass/.exec(checks);
    if (all) return [Number(all[1]), Number(all[1])];
    const pairs = [...checks.matchAll(/([●▲△]) \S+/g)].map((x) => x[1]);
    if (pairs.length) return [pairs.filter((g) => g === '●').length, pairs.length];
    const ok = Number(/(\d+) ok/.exec(checks)![1]);
    return [ok, ok + (checks.match(/[▲△]/g) ?? []).length];
  };
  /** The panel's one gate figure: `ok` (0 denied) or `N denied` (the gates ribbon and the route tab's gates row). */
  const denied = (text: string): number | undefined => { const m = /(?:\bok|(\d+) denied)\s*$/.exec(text.trimEnd()); return m ? Number(m[1] ?? 0) : undefined; };
  const panel = (tab: PanelTab) => panelText(panelModelOf({ ...worldSidebar(tab, 80, snap), gates: groups }, ui, 80));



});

// ---- 2. one name per agent ------------------------------------------------------------------------------------------

describe('agent names: displayName on the team and route tabs', () => {
  const hashed = worker('explorer-3fa9c1', { goal: 'board-auditor: audit the open items' });
  const lead = worker('lead-a3a3ab', { role: 'lead' });


  test('the route tab names a working agent the same way', () => {
    const text = panelText(panelWorld('route', 120, ui, { todos: [], workers: [hashed] })).join('\n');
    expect(text).toContain('board-auditor');
    expect(text).not.toContain('explorer-3fa9c1');
  });

  test('a press on a renamed row still addresses the real agent', () => {
    const rows = bodyLines(panelWorld('team', 120, ui, { workers: [hashed] }));
    expect(rows.find((l) => l.press?.kind === 'worker')?.press?.name).toBe('explorer-3fa9c1');
  });


});

// ---- 3. the height ---------------------------------------------------------------------------------------------------

describe('fill height: a tall pane shows detail already in the snapshot', () => {
  const team = [worker('implementer-band', { goal: 'implementer-band: wire the band', detail: 'read runs.ts:17' }), worker('implementer-live', { state: 'failed', task: 'T6', detail: 'tests red 3', model: 'sonnet' }), worker('runner-land', { state: 'queued', task: 'T5', detail: 'parked' })];


  test('team: a short pane keeps one row per agent', () => {
    const rows = body(panelWorld('team', 100, ui, { workers: team, rows: 24 }));
    expect(rows.join('\n')).not.toMatch(/model +opus/);
  });

  test('team: the detail adds no blank rows between agents (wave 30: the only blanks are the gaps before the summary and the recent posts)', () => {
    const rows = body(panelWorld('team', 100, ui, { workers: team, rows: 36 }));
    expect(rows.filter((l) => l === '').length).toBeLessThanOrEqual(3);
  });
  test('gates: each gate lists its checks from 30 rows', () => {
    const rows = body(panelWorld('gates', 100, ui, { gates, rows: 36 })).join('\n');
    expect(rows).toContain('every item has evidence');
    expect(rows).toContain('no unverified done claim');
  });

  const gates = [
    { id: 'completion', title: 'completion', lines: [{ id: 'c1', label: 'every item has evidence', ok: true }, { id: 'c2', label: 'no open todo', ok: true }] },
    { id: 'tripwire', title: 'tripwire', lines: [{ id: 't1', label: 'no unverified done claim', ok: false, fix: 'run atlas_finding.py' }] },
  ];
  test('gates: the grid lists every line of every group by name, on a short pane too (the groups are not folded)', () => {
    const rows = body(panelWorld('gates', 100, ui, { gates, rows: 24 })).join('\n');
    expect(rows).toContain('every item has evidence');
  });

  const long = 'Picked up the board audit. The owner column reads wrong when two agents share an item, so I am splitting the owner cell and then rerunning the golden tests for the board tab at every width before I report back to the lead.';
  const notes: PanelNote[] = [{ at: '10:01', from: 'implementer-band', text: 'short one' }, { at: '10:04', from: 'implementer-board', to: 'lead', text: long }];
  test('channel: the newest message reads in full over several rows from 30 rows', () => {
    const rows = body(panelWorld('channel', 100, ui, { notes, rows: 36 })).join(' ').replace(/\s+/g, ' ');
    expect(rows).toContain('before I report back to the lead');
  });
  test('channel: the log stays inside the pane', () => {
    expect(panelText(panelWorld('channel', 100, ui, { notes, rows: 30 })).length).toBeLessThanOrEqual(30);
  });
});

// ---- 4. spinners -----------------------------------------------------------------------------------------------------

describe('spinners: spinFrameOf(now, worker name) on every row', () => {
  const NOW = 1_700_000_000_000;
  const glyphOf = (rows: readonly string[], name: string): string => rows.find((l) => l.includes(name))!.trimStart().replace(/^[▸▹▿]\s*/, '')[0]!;
  const two = [worker('alpha-one'), worker('beta-two')];
  const frame = (name: string): string => leadSpinnerGlyph(spinFrameOf(NOW, name)); // agent rows turn the band's spinner frame
  const planFrame = (name: string): string => spinnerGlyph(spinFrameOf(NOW, name)); // plan rows keep the circle quarters (the scorer parses them by glyph)

  test('the team tab turns every agent by the one shared phase at one clock reading', () => {
    const rows = body(panelWorld('team', 100, ui, { workers: two, now: NOW, rows: 24 }));
    expect(glyphOf(rows, 'alpha-one')).toBe(frame('alpha-one'));
    expect(glyphOf(rows, 'beta-two')).toBe(frame('beta-two'));
    expect(frame('alpha-one')).toBe(frame('beta-two')); // rev 5: one shared phase, so every spinner on a surface turns together
  });

  test('the route tab agrees with the team tab for the same agent', () => {
    const route = body(panelWorld('route', 100, ui, { todos: [], workers: two, now: NOW }));
    expect(glyphOf(route, 'alpha-one')).toBe(frame('alpha-one'));
  });

  test('the route plan rows turn by their owner', () => {
    const todos = [{ id: 'a', label: 'Wire the band', state: 'running' as UiState, owner: 'alpha-one' }];
    const route = body(panelWorld('route', 100, ui, { todos, workers: two, now: NOW, rows: 24 }));
    expect(glyphOf(route.filter((l) => l.includes('Wire the band')), 'Wire the band')).toBe(planFrame('alpha-one'));
  });

  test('without a clock reading the tick still drives the frame', () => {
    const rows = body(panelWorld('team', 100, ui, { workers: [worker('alpha-one')], tick: 2, rows: 24 }));
    expect(glyphOf(rows, 'alpha-one')).toBe(leadSpinnerGlyph(2));
  });

  test('panelModelOf carries the snapshot clock', () => {
    const snap = worldSnapshot();
    expect(panelModelOf(worldSidebar('team', 80, snap), ui, 80).now).toBeGreaterThanOrEqual(snap.now);
  });
});

// ---- 5. the agents row ---------------------------------------------------------------------------------------------

describe('route tab: the agents row heads agents', () => {

  test('a short pane keeps the counts alone', () => {
    const done = [worker('implementer-band', { state: 'done', detail: 'finished' })];
    const rows = body(panelWorld('route', 100, ui, { todos: [], workers: done, rows: 24 }));
    const at = rows.findIndex((l) => l.startsWith(' agents'));
    expect(rows[at + 1] ?? '').not.toContain('implementer-band');
  });
});
