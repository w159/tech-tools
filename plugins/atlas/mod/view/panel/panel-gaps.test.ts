// The product gaps of the mod redesign (removed-tests.md "Product gaps" G1, G3, G4, G5, channel closure mark, chat field width), each asserted on the real surfaces.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../../../contracts/panel-world';
import { cells, type Ui } from '../../design/atlas-ui';
import { hudAgents, hudRows } from '../hud/hud';
import { liveWorkers, queuedMembers } from '../../data/live';
import { ownTodos } from '../../data/todos';
import { els, on, scene, sidebarModel, textOf, UI256 } from '../../surface_indices';
import { sidebarTree } from './pane/sidebar';
import { bodyLines, lineText, type PanelModel, type PanelTab } from './panel-layout';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const live = (tab: PanelTab, cols = 62, over: Partial<PanelModel> = {}): PanelModel => panelWorld(tab, cols, mocha, { rows: 40, run: { kind: 'working', secs: 5, startMs: 0, frame: 0 }, ...over });
const body = (m: PanelModel): string[] => bodyLines(m).map((l) => lineText(l).trimEnd());
const tree = (view: 'route' | 'channel', cols: number, s = scene('killed')): string => textOf(sidebarTree(els, sidebarModel(s, view, cols, UI256), on) as never).join('\n');
/** The same snapshot with each T1..T3 row naming its worker only in its title (the stoprun shape of 28d53608). */
const tailed = (s: ReturnType<typeof scene>): ReturnType<typeof scene> => ({ ...s, todos: s.todos.map((t) => (/^T[123] /.test(t.content) && t.owner ? { ...t, content: `${t.content} (${t.owner})`, owner: null } : t)) }) as never;

describe('G1: a plan row the lead closed over a failed worker reads failed', () => {
  test('the PLAN row is a red ✗, never a green ✓ and never the word `closed`; the count matches the HUD box', () => {
    const t = tree('route', 80);
    const row = t.split('\n').find((l) => /T3/.test(l) && /gamma-explorer/.test(l)) ?? '';
    expect(row).toMatch(/✗/);
    expect(row).not.toMatch(/✓/);
    expect(t).not.toMatch(/\bclosed\b/);
    const s = scene('killed');
    const hud = hudRows({ todos: ownTodos(s.todos, s.sessionId), agents: hudAgents(liveWorkers(s, s.now), s.squad, queuedMembers(s)), root: s.root }, { cols: 80, tick: 0, ui: UI256, now: s.now, maxRows: 40 } as never);
    const box = JSON.stringify(hud).match(/(\d+)\/(\d+)/)!; // the TODO box count `2/5`
    expect(t).toContain(`${box[1]} of ${box[2]}`);
  });
});

describe('G3: a row that names its worker only in the title reads that worker\'s failure', () => {
  test('the failed worker\'s row reads ✗ and never `blocked`', () => {
    const t = tree('route', 80, tailed(scene('killed')));
    const row = t.split('\n').find((l) => /T3/.test(l)) ?? '';
    expect(row).toMatch(/✗/);
    expect(row).not.toMatch(/▲/);
    expect(t).not.toMatch(/\bblocked\b/);
  });
});

describe('channel: the closure note of a failed item is a failure', () => {
  test('`T3 failed · gamma-explorer` carries the red ✗, never the green ✓', () => {
    const row = tree('channel', 62).split('\n').find((l) => /T3 failed/.test(l)) ?? '';
    expect(row).toMatch(/✗/);
    expect(row).not.toMatch(/✓/);
  });
});

describe('G4: the PHASE timeline', () => {
  const dots = (m: PanelModel): string => body(m).find((l) => /[●◉○▲–]─/.test(l) || /^ [●◉○▲–] /.test(l))!.replace(/[─ ]+/g, '');
  test('a snapshot whose phase is `done` lights every stage done', () => {
    expect(dots(live('route', 62, { phase: 'done' }))).toBe('●●●●');
    expect(dots(live('route', 62, { phase: 'done', entered: ['plan'] }))).toBe('●●●●');
  });
  test('an unknown phase lights none', () => {
    expect(dots(live('route', 62, { phase: 'nonsense' }))).toBe('○○○○');
  });
});

describe('G5: the TEAM name column', () => {
  test('a 29-cell name stays whole at 80 columns on the status and route tabs', () => {
    const name = 'board-auditor-open-items-pass';
    for (const tab of ['route', 'team'] as const) {
      const base = live(tab, 80);
      const m = { ...base, workers: [{ ...base.workers[0]!, name }, ...base.workers.slice(1)] } as PanelModel;
      expect(body(m).join('\n')).toContain(`${name} `);
    }
  });
  test('a name that cannot fit still ends in an ellipsis, inside the pane', () => {
    const base = live('route', 80);
    const name = 'x'.repeat(70);
    const m = { ...base, workers: [{ ...base.workers[0]!, name }, ...base.workers.slice(1)] } as PanelModel;
    const l = body(m).find((x) => x.includes('xxxx'))!;
    expect(l).toContain('…');
    expect(cells(l)).toBeLessThanOrEqual(80);
  });
});

describe('the chat field and the HUD focus row', () => {
  test('the channel input is one bordered box the width of the pane', () => {
    const box = JSON.stringify(sidebarTree(els, sidebarModel(scene('killed'), 'channel', 62, UI256), on));
    expect(box).toMatch(/"borderStyle":"round"[^]*"width":60|"width":60[^]*"borderStyle":"round"/);
  });
  test('the HUD focus fill ends at the right border cell: no painted run past the box width', () => {
    for (const cols of [60, 100, 120]) {
      const s = scene('running');
      const rows = hudRows({ todos: ownTodos(s.todos, s.sessionId), agents: hudAgents(liveWorkers(s, s.now), s.squad, queuedMembers(s)), root: s.root }, { cols, tick: 0, ui: UI256, now: s.now, maxRows: 40 } as never) as unknown as { t: string; bgHex?: string }[][];
      for (const r of rows.filter((x) => Array.isArray(x) && x.some((y) => y.bgHex))) expect(r.reduce((a, y) => a + cells(y.t), 0)).toBeLessThanOrEqual(cols);
    }
  });
});
