// Band polish (rev 4): the band keeps counts only while the HUD's Subagents block lists the workers, the idle band reads
// "idle", the live phase rail needs HudInput.phases, and the gauges ease on frame functions that stop when nothing moves.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { easedFrames, EASE_MS, type Ui } from './atlas-ui';
import { bandTree, hudPhases, railPhase } from './band';
import { displayed, gaugeTargets, retarget, settled, type Move } from './band-motion';
import { hudAgents, hudListsAgents, hudRows } from './hud';
import { liveWorkers, type LiveWorker } from './data/live';
import { busySnap, NOW } from './live_fixture';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => t.props.children).join('');
const UI: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const idleSnap = () => busySnap({ squad: [], activity: {}, comms: [] });

const rowsOf = (columns: number, over: Record<string, unknown> = {}): string[] => {
  const snapshot = (over.snapshot as ReturnType<typeof busySnap>) ?? busySnap();
  const live = (over.live as LiveWorker[] | undefined) ?? liveWorkers(snapshot, NOW);
  const node = bandTree(els, { snapshot, live, gates: [], columns, tick: 3, maxRows: 12, ui: UI, ...over } as never) as unknown as Node;
  return (node.props.children as Node[]).map(text);
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const NAMES = liveWorkers(busySnap(), NOW).map((w) => w.name);

describe('band beside the Subagents block: counts only', () => {
  test('without the HUD block the band lists its workers', () => {
    const all = rowsOf(160).join('\n');
    for (const n of NAMES) expect(all).toContain(n);
  });
  test('with the HUD block the band lists no worker and keeps the counts', () => {
    const rows = rowsOf(160, { workersInHud: true, snapshot: busySnap({ comms: [] }) });
    const all = rows.join('\n');
    for (const n of NAMES) expect(all).not.toContain(n);
    expect(all).not.toContain('implementer');
    expect(rows[0]).toContain('1 running');
    expect(rows[0]).toContain('1 failed');
    expect(rows.length).toBeLessThan(rowsOf(160, { snapshot: busySnap({ comms: [] }) }).length);
  });
  test('the band counts equal the HUD block: a working worker with no tool yet is running in both', () => {
    const base = liveWorkers(busySnap(), NOW);
    const fresh = base.map((w) => ({ ...w, state: 'working', tool: null, lastTool: null })) as LiveWorker[];
    const hud = hudRows({ todos: [], agents: hudAgents(fresh, []) }, { cols: 160, maxRows: 20, ui: UI }).map((r) => r.map((x) => x.t).join('')).join('\n');
    const inHud = rowsOf(160, { live: fresh, workersInHud: true })[0]!;
    expect(hud).toContain(`${fresh.length} running`);
    expect(inHud).toContain(`${fresh.length} running`);
    expect(inHud).not.toContain('queued');
    expect(rowsOf(160, { live: fresh })[0]).toContain(`${fresh.length} queued`); // listed: the row says starting
  });
  test('narrow bands list nothing either way (the single row)', () => {
    expect(rowsOf(60, { workersInHud: true })).toHaveLength(1);
  });
});

describe('idle band', () => {
  test('reads idle, with the phase position and no running count, at every width', () => {
    for (const columns of [160, 100, 80, 60, 40]) {
      const row = rowsOf(columns, { snapshot: idleSnap(), live: [] })[0]!;
      expect(row).toContain('idle');
      expect(row).not.toContain('running');
      expect(row).not.toContain('implement');
    }
    expect(rowsOf(160, { snapshot: idleSnap(), live: [] })[0]).toContain('idle · phase 4/6');
  });
  test('rich idle also says idle; a running band does not', () => {
    expect(rowsOf(160, { snapshot: idleSnap(), live: [], rich: true, maxRows: 12 }).join('\n')).toContain('idle');
    expect(rowsOf(160, { rich: true }).join('\n')).not.toContain('idle');
    expect(rowsOf(160)[0]).not.toContain('idle');
  });
});

describe('the live phase rail for the HUD', () => {
  test('hudPhases is the rail ids and the lit index; done lights every phase; blocked keeps the last phase', () => {
    const s = busySnap();
    const ids = s.contract.phases.map((p) => p.id as string).filter((id) => id !== 'validate' && id !== 'blocked');
    expect(hudPhases(s)).toEqual({ ids, active: ids.indexOf('implement') });
    expect(hudPhases({ ...s, phase: 'done' } as never).active).toBe(ids.length);
    const blocked = { ...s, phase: 'blocked' } as never;
    expect(hudPhases(blocked, 'test').active).toBe(ids.indexOf('test'));
    expect(hudPhases(blocked, 'test').ids[hudPhases(blocked, 'test').active]).toBe(railPhase(blocked, 'test'));
  });
  test('the HUD draws the rail from it', () => {
    const s = busySnap();
    const todos = [{ id: 'a', content: 'map the auth flow', status: 'in_progress', owner: 'explorer-1' }] as never;
    const agents = hudAgents(liveWorkers(s, NOW), []);
    const draw = (phases?: { ids: readonly string[]; active: number }) => hudRows({ todos, agents, ...(phases ? { phases } : {}) }, { cols: 120, maxRows: 30, ui: UI, rich: true }).map((r) => r.map((x) => x.t).join('')).join('\n');
    expect(draw()).not.toContain('4 implement');
    expect(draw(hudPhases(s))).toContain('4 implement'); // the numbered rail, step 4 lit
  });
});

describe('eased gauges', () => {
  test('the band draws the eased value; the label keeps the true figure', () => {
    const plain = rowsOf(160)[0]!;
    const half = rowsOf(160, { eased: { todo: 0.9, ctx: 0.9 } })[0]!;
    expect(half).not.toBe(plain);
    expect(half).toContain('1 of 4');
    expect(half).toContain('12%');
  });
  test('retarget starts a move from the value on screen, and an unchanged target keeps the same move', () => {
    const t0: Move = { from: 0.2, to: 0.2, at: 0 };
    const t1 = retarget(t0, 0.8, 1000);
    expect(t1).toEqual({ from: 0.2, to: 0.8, at: 1000 });
    expect(retarget(t1, 0.8, 1050)).toBe(t1);
    const mid = retarget(t1, 0.5, 1000 + EASE_MS / 2);
    expect(near(mid.from, displayed(t1, 1000 + EASE_MS / 2))).toBe(true);
    expect(mid.to).toBe(0.5);
  });
  test('displayed follows the frame functions and lands on the target; settled once EASE_MS has passed', () => {
    const m: Move = { from: 0, to: 1, at: 500 };
    expect(displayed(m, 500)).toBe(0);
    expect(displayed(m, 500 + EASE_MS)).toBe(1);
    const frames = easedFrames(0, 1);
    for (let k = 0; k < frames.length; k++) expect(near(displayed(m, 500 + ((k + 1) / frames.length) * EASE_MS), frames[k]!)).toBe(true);
    expect(settled(m, 500 + EASE_MS - 1)).toBe(false);
    expect(settled(m, 500 + EASE_MS)).toBe(true);
  });
  test('gaugeTargets reads the plan ratio and the context fill; context is absent at 0', () => {
    const s = busySnap({ contextPct: 40 });
    expect(near(gaugeTargets(s).ctx!, 0.4)).toBe(true);
    expect(gaugeTargets({ ...s, contextPct: 0 }).ctx).toBeUndefined();
    expect(gaugeTargets(s).todo).toBeGreaterThanOrEqual(0);
  });
});

describe('when the band may drop its worker rows', () => {
  const agents = hudAgents(liveWorkers(busySnap(), NOW), []);
  const rows = (maxRows: number, cols = 160, list = agents) => hudRows({ todos: [], agents: list }, { cols, maxRows, ui: UI });
  test('true only while the Subagents block lists at least one agent', () => {
    expect(hudListsAgents(rows(20))).toBe(true);
    expect(hudListsAgents(rows(2, 160, agents.slice(0, 1)))).toBe(true); // ribbon and its one row
    expect(hudListsAgents(rows(2))).toBe(false); // three agents do not fit two rows: the ribbon keeps the counts, the band lists
  });
  test('false with the ribbon alone (starved), below 80 columns (no block) and with nothing running', () => {
    expect(rows(1).length).toBe(1);
    expect(hudListsAgents(rows(1))).toBe(false);
    expect(hudListsAgents(rows(20, 70))).toBe(false);
    expect(hudListsAgents(rows(20, 160, []))).toBe(false);
    expect(hudListsAgents([])).toBe(false);
  });
});
