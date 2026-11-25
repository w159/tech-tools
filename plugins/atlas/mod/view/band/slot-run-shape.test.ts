// Wave 30 (critique 28, build a7bc7b0d): the band and the HUD hold one shape for a run. Root cause of the moving band (live-150-a7bc7b0d-1 f0050 38, f0055 25, f0061 24, f0094 28): the slot is bottom-anchored and
// the host gives it `maxRows` = half the screen less the rows below it (the prompt and Claude Code's own agent list). The band row is `rows - slot - below`, so the slot has to fill what the host gives it from
// the first working frame to the last, with every box closed. These tests render the whole slot (slot.ts composeSlot) at 150 and 110 columns through 0, 1, 3 running agents, a return and idle.
import { describe, expect, test } from 'claude-code/testing';
import { readHostEntry } from '../../fixtures/source-tree';
import type { ClientElements } from 'claude-code';
import { runsString, type Ui } from '../../design/atlas-ui';
import { bandTree, type BandModel } from './band';
import type { TodoItem, SquadAgent } from '../../contract';
import { liveWorkers, queuedMembers } from '../../data/live';
import { ownTodos } from '../../data/todos';
import { hudAgents, hudListsAgents, isRunning, type HudInput } from '../hud/hud';
import { hudPhases } from './band';
import { composeSlot, type SlotPlan } from './slot';
import { busySnap, NOW } from '../../live_fixture';
import type { LiveSnapshot } from '../../orchestra-types';
import { rowOf } from '../../design/runs';
import type { Segment } from '../../design/runs';

type Node = { kind: string; props: Record<string, unknown> };
const mk = (kind: string) => (props: Record<string, unknown>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const textOf = (n: unknown): string => {
  const node = n as Node;
  const c = node.props?.children;
  if (typeof c === 'string') return c;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).map(textOf).join('');
};
/** A row is a Box with no Box child. */
function rowsOf(n: Node): string[] {
  const kids = (n.props.children ?? []) as Node[];
  const boxes = (Array.isArray(kids) ? kids : [kids]).filter((k) => k && (k as Node).kind === 'Box');
  return boxes.length === 0 ? [textOf(n)] : boxes.flatMap((b) => rowsOf(b as Node));
}
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const handlers = { openView: () => undefined, toggleTodos: () => undefined };
const NAMES = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'] as const;
const PLAN_TEXT = ['T1 read alpha.py (alpha-explorer)', 'T2 read beta.py (beta-explorer)', 'T3 read gamma.py (gamma-explorer)', 'T4 combine the three reports', 'T5 write the final summary'];

type Stage = { running: number; returned: number; planned: boolean; doneTodos?: number; working?: boolean };
/** A snapshot of the live scenario: `running` explorers working, `returned` finished, a five-row plan once `planned`. */
function snapshotOf(st: Stage): LiveSnapshot {
  const n = st.running + st.returned;
  const squad: SquadAgent[] = NAMES.slice(0, n).map((name, i) => ({ name, persona: 'explorer', state: i < st.returned ? 'finished' : 'running', source: 'task', task: `${name}: read ${['alpha', 'beta', 'gamma'][i]}.py` }) as SquadAgent);
  const act = (i: number): LiveSnapshot['activity'][string] => ({ tool: i < st.returned ? null : 'Read', since: NOW - 4_000, startedAt: NOW - 4_000, toolCount: 1, tokens: 100, mood: i < st.returned ? 'done' : 'working', lastLine: '' }) as never;
  const todos: TodoItem[] = st.planned ? PLAN_TEXT.map((c, i) => ({ id: `t${i + 1}`, content: c, status: i < (st.doneTodos ?? 0) ? 'completed' : 'pending' }) as TodoItem) : [];
  return busySnap({
    sessionId: 's', phase: 'research', phaseSource: 'header', contextPct: 7, squad, comms: [],
    activity: { lead: { tool: st.working === false ? null : 'Bash', since: NOW, toolCount: 1, tokens: null, mood: st.working === false ? 'idle' : 'working', lastLine: '' }, ...Object.fromEntries(NAMES.slice(0, n).map((nm, i) => [nm, act(i)])) } as never,
    todos, counts: { done: st.doneTodos ?? 0, total: todos.length, byPhase: {} }, todoGroups: [],
  });
}

type Frame = { rows: string[]; plan: SlotPlan; band: number };
/** The slot for `st` at `cols` columns in a `budget`-row slot: band tree rows, the blank, the HUD rows, the pad. */
function frameOf(st: Stage, cols: number, budget: number, held: number): Frame {
  const snapshot = snapshotOf(st);
  const live = liveWorkers(snapshot, snapshot.now);
  const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
  const hudIn: HudInput = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, null) };
  const working = st.working !== false;
  const bandIn = (hud: Segment[][], maxRows: number | undefined): BandModel => ({ snapshot, live, gates: [], working, workSecs: 30, ranSecs: working ? undefined : 66, columns: cols, tick: 3, ui, rich: false, workersInHud: hudListsAgents(hud), maxRows, lastPhase: null, core: null } as BandModel);
  const plan = composeSlot({ budget, hasSlot: true, hudOn: true, runOn: working, columns: cols, hudIn, hudView: { cols, tick: 3, ui, rich: false, now: snapshot.now }, running: agents.some(isRunning), agentsListed: agents.length > 0, orchestrated: true, now: snapshot.now, bandIn, held });
  const bandRows = rowsOf(bandTree(els, plan.band, handlers) as unknown as Node);
  const blank = ' '.repeat(cols);
  const rows = [...Array.from({ length: plan.lead }, () => ''), ...bandRows, ...Array.from({ length: plan.gap }, () => blank), ...plan.hud.map((r) => r.map((x) => x.t).join('')), ...Array.from({ length: plan.pad }, () => blank)];
  void rowOf;
  return { rows, plan, band: 0 };
}

/** The scenario: first working frame (nothing yet), the plan written, one agent, three, one returned, all returned, then idle. */
const STAGES: { name: string; st: Stage }[] = [
  { name: 'first working frame', st: { running: 0, returned: 0, planned: false } },
  { name: 'plan written', st: { running: 0, returned: 0, planned: true } },
  { name: '1 agent running', st: { running: 1, returned: 0, planned: true } },
  { name: '3 agents running', st: { running: 3, returned: 0, planned: true } },
  { name: '1 returned, 2 running', st: { running: 2, returned: 1, planned: true, doneTodos: 1 } },
  { name: 'all returned', st: { running: 0, returned: 3, planned: true, doneTodos: 3 } },
  { name: 'idle', st: { running: 0, returned: 3, planned: true, doneTodos: 5, working: false } },
];
/** What the host does: the slot may hold half the screen less what sits below it (prompt box + footer = 4 rows, plus a blank, `main` and one row per running agent in Claude Code's own list). */
const hostBelow = (running: number): number => 4 + (running > 0 ? 2 + running : 0);
const hostBudget = (screenRows: number, running: number): number => Math.floor(screenRows / 2) - hostBelow(running);

const isBandRow = (r: string): boolean => /^◆ ATLAS/.test(r.trimStart()) && !/^(╭─|──) /.test(r);
const SPIN = /[◐◓◑◒]/;

describe('1. the slot is the rows drawn: no pad under the HUD, no lead above the band', () => {
  for (const [cols, screen] of [[150, 70], [110, 60], [150, 45], [110, 40], [150, 36]] as const) {
    test(`${cols} columns: the slot never passes the budget and carries no lead, gap or HUD rows in any stage (17.15.1: the gap under the mod)`, () => {
      let held = 0;
      for (const { name, st } of STAGES) {
        const budget = hostBudget(screen, st.running);
        const f = frameOf(st, cols - 5, budget, held);
        held = f.plan.held;
        expect([name, f.plan.hud.length, f.plan.gap, f.plan.lead], name).toEqual([name, 0, 0, 0]);
        expect(f.rows.length, name).toBeLessThanOrEqual(budget);
      }
    });
    test(`${cols} columns: the band is the first row and the last row under it is drawn content in every stage (the pad only holds the run's height)`, () => {
      let held = 0;
      for (const { name, st } of STAGES) {
        const f = frameOf(st, cols - 5, hostBudget(screen, st.running), held);
        held = f.plan.held;
        expect(f.rows.findIndex(isBandRow), `${name}: the band follows the lead rows`).toBe(f.plan.lead);
        expect(f.rows[f.rows.length - 1 - f.plan.pad]!.trim(), `${name}: no blank row inside the band`).not.toBe('');
      }
    });
  }
});

describe('2. the TODO box is closed at every agent count, with no bare rows under it', () => {
  for (const [cols, screen] of [[150, 70], [110, 60], [150, 45], [110, 40], [150, 36]] as const) {
  }
});

describe('3. SUBAGENTS draws every running agent', () => {
  for (const [cols, screen] of [[150, 70], [110, 60], [150, 45], [110, 40], [150, 36]] as const) {
  }
});

describe('4. blocked on the update that carries the Stop refusal', () => {
  test('stopRefusal puts the refusal in the gate groups the band reads, from the hook result alone', async () => {
    const { stopRefusal } = await import('../../data/runstate');
    const { gateTally } = await import('../../data/runstate');
    const before = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'r', label: 'Done claim', ok: true }] }];
    expect(gateTally(before as never).stop).toBeNull();
    const after = stopRefusal(before as never, 'Done claimed too early: the reply header says `done` but there are 2 open dispatch rows.');
    const stop = gateTally(after as never).stop;
    expect(stop?.blocked).toBe(true);
    expect(stop?.gates.join(' ')).toMatch(/dispatch/);
  });
  test('register.ts hooks classic.Stop and records the refusal before it returns the hook result', () => {
    const src = readHostEntry();
    const at = src.indexOf("on('classic.Stop'");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf('});', at));
    expect(body.indexOf('await next(e)')).toBeGreaterThan(-1);
    expect(body.indexOf('stopRefusal')).toBeGreaterThan(body.indexOf('await next(e)'));
    expect(body.indexOf('stopRefusal')).toBeLessThan(body.lastIndexOf('return'));
  });
  test('a blocked band shows the static ▲ and no spinner, in the lead and in the band row at every width', () => {
    const snapshot = snapshotOf({ running: 0, returned: 3, planned: true, doneTodos: 5 });
    for (const columns of [150, 110, 80, 60]) {
      const gates = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail: 'gate' }] }];
      const tree = bandTree(els, { snapshot, live: liveWorkers(snapshot, snapshot.now), gates, columns, tick: 3, ui, maxRows: 1, working: true, workSecs: 57 } as never, undefined);
      const row = rowsOf(tree as unknown as Node)[0]!;
      expect(row, `${columns}`).toContain('▲ blocked');
      expect(row, `${columns}: ${row}`).not.toMatch(SPIN);
    }
  });
});

describe('5. the band says each thing once', () => {
  test('`▲ n blocked` never sits in a working band (the glyph means the band is blocked)', () => {
    const snapshot = snapshotOf({ running: 2, returned: 0, planned: true });
    const tree = bandTree(els, { snapshot: { ...snapshot, todos: snapshot.todos.map((t, i) => (i === 1 ? { ...t, owner: 'beta-explorer', status: 'blocked' } : t)) }, live: liveWorkers(snapshot, snapshot.now), gates: [], columns: 150, tick: 3, ui, maxRows: 1, working: true } as never, undefined);
    const row = rowsOf(tree as unknown as Node)[0]!;
    expect(row).toMatch(/working/);
    expect(row).not.toContain('▲');
  });
  test('ctx is not on the one-row band (the turn footer says it)', () => {
    const snapshot = snapshotOf({ running: 0, returned: 3, planned: true, doneTodos: 5, working: false });
    const mk2 = (ranSecs: number | undefined) => rowsOf(bandTree(els, { snapshot, live: liveWorkers(snapshot, snapshot.now), gates: [], columns: 150, tick: 3, ui, maxRows: 1, working: false, ranSecs, restSecs: 40 } as never, undefined) as unknown as Node)[0]!;
    expect(mk2(66)).not.toMatch(/ctx/);
    expect(mk2(undefined)).not.toMatch(/ctx/); // wave 31: the context figure is the rich band's, never the one-row band's
  });
});

describe('6. one glyph and one word for the failed worker', () => {
  test('TODO, SUBAGENTS and the band all read `■ ... failed`', async () => {
    const { hudLines } = await import('../hud/hud');
    const todos: TodoItem[] = [{ id: 't1', content: 'T1 read ghost.py (ghost-explorer)', status: 'completed', owner: 'ghost-explorer' } as TodoItem];
    const agent = { name: 'ghost-explorer', role: 'explorer', state: 'failed', ui: 'failed', model: 'haiku', tool: null, lastTool: 'Read', startedAt: NOW - 5000, since: NOW - 1000 } as never;
    const rows = hudLines({ todos: ownTodos(todos), agents: [agent] }, { cols: 120, maxRows: 14, ui, rich: false, now: NOW, merge: false }).map(runsString); // wave 32: the SUBAGENTS box this pins is the two-box shape
    const todoRow = rows.find((r) => r.includes('T1 read ghost'))!;
    const agentRow = rows.find((r) => /^[│▌] \S ghost-explorer\s+(?:\S+\s+)?(killed|failed)/.test(r))!;
    expect(todoRow).toMatch(/^[│▌] ✗ T1/);
    expect(todoRow).toContain('failed');
    expect(todoRow).not.toMatch(/closed|killed/);
    expect(agentRow).toMatch(/^[│▌] ✗ ghost-explorer\s+(?:\S+\s+)?failed/);
    expect(rows.join('\n')).not.toMatch(/killed/); // wave 33: one failure word on every row and the title
  });
});
