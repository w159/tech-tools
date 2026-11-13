// 17.15.1 regressions reported on 17.15.0: "a large empty space between the prompt window and the bottom of the mod" and "the status line disappears".
// Cause 1 (slot.ts composeFixed, from 0a2fba13): the slot was padded to the host's whole budget with blank rows under the HUD. Cause 2 (register.ts): the mod published `starved` and the
// status line script then shrank to one row. These tests render the whole slot (slot.ts composeSlot) at 150x45 and 110x40 through every state, SUBAGENTS folded included.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements, EngineInterface } from 'claude-code';
import type { Ui } from './atlas-ui';
import { stopRefusal } from './data/runstate';
import { hudAgents, isRunning, type HudInput } from './hud';
import { bandKindOf, bandTree, hudPhases, type BandModel } from './band';
import type { SquadAgent, TodoItem } from './contract';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import { busySnap, NOW } from './live_fixture';
import type { LiveSnapshot } from './orchestra-types';
import { publishHudState, resetHudStateSig } from './register';
import type { Segment } from './runs';
import { composeSlot, type SlotPlan } from './slot';

type Node = { kind: string; props: Record<string, unknown> };
const mk = (kind: string) => (props: Record<string, unknown>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const textOf = (n: unknown): string => {
  const node = n as Node;
  const c = node.props?.children;
  if (typeof c === 'string') return c;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).map(textOf).join('');
};
function rowsOf(n: Node): string[] {
  const kids = (n.props.children ?? []) as Node[];
  const boxes = (Array.isArray(kids) ? kids : [kids]).filter((k) => k && (k as Node).kind === 'Box');
  return boxes.length === 0 ? [textOf(n)] : boxes.flatMap((b) => rowsOf(b as Node));
}
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ui256: Ui = { theme: 'mocha', ascii: false, color: '256' };
const handlers = { openView: () => undefined, toggleTodos: () => undefined };
const NAMES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((n) => `${n}-explorer`);
const PLAN = ['T1 read alpha.py', 'T2 read beta.py', 'T3 read gamma.py', 'T4 read delta.py', 'T5 write the summary'];

type Stage = { name: string; running: number; returned: number; blocked?: boolean; rest?: number; working?: boolean; /** The plan titles carry the `(agent)` suffix the dispatch writes. */ suffix?: boolean; /** The returned agents have ended but the lead has not closed their plan rows yet. */ handBack?: boolean };
const STAGES: Stage[] = [
  { name: '0 running', running: 0, returned: 0 },
  { name: '1 running', running: 1, returned: 0 },
  { name: '3 running', running: 3, returned: 0 },
  { name: '5 running', running: 5, returned: 0 },
  { name: 'one returned', running: 2, returned: 1 },
  { name: 'blocked', running: 0, returned: 3, blocked: true },
  { name: 'done', running: 0, returned: 3, working: false, rest: 5 },
  { name: 'idle', running: 0, returned: 3, working: false, rest: 60 },
];

function snapshotOf(st: Stage): LiveSnapshot {
  const n = st.running + st.returned;
  const squad: SquadAgent[] = NAMES.slice(0, n).map((name, i) => ({ name, persona: 'explorer', state: i < st.returned ? 'finished' : 'running', source: 'task', task: `${name}: read ${name.split('-')[0]}.py` }) as SquadAgent);
  const act = (i: number) => ({ tool: i < st.returned ? null : 'Read', since: NOW - 4_000, startedAt: NOW - 4_000 - i * 1000, toolCount: 1, tokens: 100, mood: i < st.returned ? 'done' : 'working', lastLine: '' }) as never;
  const finished = st.working === false;
  const todos: TodoItem[] = PLAN.map((c, i) => ({ id: `t${i + 1}`, content: st.suffix && i < n ? `${c} (${NAMES[i]})` : c, status: finished || (i < st.returned && !st.handBack) ? 'completed' : i < n ? 'in_progress' : 'pending', ...(i < n ? { owner: NAMES[i] } : {}) }) as TodoItem);
  return busySnap({
    sessionId: 's', phase: finished ? 'done' : 'research', phaseSource: 'header', contextPct: 7, squad, comms: [],
    activity: { lead: { tool: finished ? null : 'Bash', since: NOW, toolCount: 1, tokens: null, mood: finished ? 'idle' : 'working', lastLine: '' }, ...Object.fromEntries(NAMES.slice(0, n).map((nm, i) => [nm, act(i)])) } as never,
    todos, counts: { done: finished ? 5 : st.returned, total: 5, byPhase: {} }, todoGroups: [],
  });
}

type Frame = { rows: string[]; plan: SlotPlan; hud: Segment[][] };
const hostBelow = (running: number): number => 4 + (running > 0 ? 2 + running : 0);
const hostBudget = (screen: number, running: number): number => Math.floor(screen / 2) - hostBelow(running);

function frameOf(st: Stage, cols: number, budget: number, held: number, gates: unknown[] = []): Frame {
  const snapshot = snapshotOf(st);
  const live = liveWorkers(snapshot, snapshot.now);
  const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
  const hudIn: HudInput = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, null) };
  const working = st.working !== false;
  const grp = st.blocked ? stopRefusal([], 'Done claimed too early: 1 open dispatch row.') : gates;
  const bandIn = (_hud: Segment[][], maxRows: number | undefined): BandModel => ({ snapshot, live, gates: grp as never, working, workSecs: 30, ranSecs: working ? undefined : 58, ...(st.rest !== undefined ? { restSecs: st.rest } : {}), columns: cols, tick: 3, ui, rich: false, maxRows, lastPhase: null, core: null } as BandModel);
  const plan = composeSlot({ budget, hasSlot: true, hudOn: true, runOn: working, columns: cols, hudIn, hudView: { cols, tick: 3, ui, rich: false, now: snapshot.now }, running: agents.some(isRunning), agentsListed: agents.length > 0, orchestrated: true, now: snapshot.now, bandIn, held });
  const bandRows = rowsOf(bandTree(els, plan.band, handlers) as unknown as Node);
  const hud = plan.hud.map((r) => r.map((x) => x.t).join(''));
  const rows = [...Array.from({ length: plan.lead }, () => ''), ...bandRows, ...Array.from({ length: plan.gap }, () => ' '.repeat(cols)), ...hud, ...Array.from({ length: plan.pad }, () => '')];
  return { rows, plan, hud: plan.hud };
}

const SCREENS = [[150, 45, 145], [110, 40, 105], [150, 45, 93], [110, 40, 56]] as const;
const isBlank = (r: string): boolean => r.trim() === '';
/** Blank rows at the bottom of the slot: the rows between the last drawn mod row and the prompt. */
const trailingBlanks = (rows: string[]): number => { let n = 0; for (let i = rows.length - 1; i >= 0 && isBlank(rows[i]!); i--) n++; return n; };

describe('no empty rows between the mod and the prompt', () => {
  for (const [screen, , cols] of SCREENS.map(([c, s, w]) => [s, c, w] as const)) {
    test(`${cols} cells on a ${screen}-row screen: the slot ends on a drawn row in idle, working, blocked and done, SUBAGENTS folded or not`, () => {
      let held = 0;
      for (const st of STAGES) {
        const f = frameOf(st, cols, hostBudget(screen, st.running), held);
        held = f.plan.held;
        expect([st.name, 'pad', f.plan.pad]).toEqual([st.name, 'pad', 0]);
        expect([st.name, 'lead', f.plan.lead]).toEqual([st.name, 'lead', 0]);
        expect([st.name, 'blank rows under the mod', trailingBlanks(f.rows)]).toEqual([st.name, 'blank rows under the mod', 0]);
        expect(f.rows.length, `${st.name}: the slot requests exactly the rows it draws`).toBe(rowsOf(bandTree(els, f.plan.band, handlers) as unknown as Node).length + f.plan.gap + f.hud.length);
      }
    });
    test(`${cols} cells on a ${screen}-row screen: a slot shorter than the budget stays short (the roomy budget is not filled)`, () => {
      const idle = frameOf(STAGES.find((s) => s.name === 'idle')!, cols, 200, 0);
      expect(idle.rows.length).toBeLessThan(40);
      expect(trailingBlanks(idle.rows)).toBe(0);
    });
  }
  test('a folded SUBAGENTS (five agents in a small budget) still ends on a drawn row', () => {
    const f = frameOf(STAGES.find((s) => s.name === '5 running')!, 110, 9, 0);
    expect(f.hud.length).toBeGreaterThan(0);
    expect(trailingBlanks(f.rows)).toBe(0);
  });
});

describe('the status line is never asked to shrink', () => {
  test('publishHudState writes starved false while the HUD is short of rows (tight slot, five agents)', async () => {
    resetHudStateSig();
    const files = new Map<string, string>();
    const $ = { clock: { now: async () => 5 }, fs: { write: async (p: string, t: string) => { files.set(p, t); } }, process: { run: async (a: string[]) => { files.set(a[3]!, files.get(a[2]!) ?? ''); return {}; } } } as unknown as EngineInterface;
    const f = frameOf(STAGES.find((s) => s.name === '5 running')!, 56, hostBudget(40, 5), 0);
    await publishHudState($, '/tmp/p', { maxRows: hostBudget(40, 5), wanted: 15, shown: f.hud.length, fullscreen: true });
    expect(f.hud.length).toBeLessThan(15); // the HUD is folded: the old rule (shown < wanted) said starved here
    expect(JSON.parse(files.get('/tmp/p/.atlas/.run/hud-state.json')!)).toMatchObject({ shown: f.hud.length, wanted: 15, starved: false });
  });
});
