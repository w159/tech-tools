// Wave 32 (hud32): the band, the TODO block and the SUBAGENTS rule hold one height and one 3-column grid for the whole run. Harness copied from wave31-hud.test.ts.
// (Wave 31: the band and the HUD are one fixed block.) These tests render the whole slot (slot.ts composeSlot) at the live widths (150 and 110 columns with the side pane docked: 93 and 56
// cells of body) and at the undocked widths through 0, 1, 3 and 5 running agents, a return, blocked, done and idle, and replay the host's Stop event order.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements, EngineInterface, On } from 'claude-code';
import { PALETTE5, PALETTES, hostTo256, type Ui } from './atlas-ui';
import { bandKindOf, bandTree, hudPhases, type BandModel } from './band';
import type { SquadAgent, TodoItem } from './contract';
import { gateTally, stopRefusal } from './data/runstate';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import { hudAgents, hudLines, hudRows, isRunning, type HudInput } from './hud';
import { busySnap, NOW } from './live_fixture';
import { bandLines } from './mission-layout';
import { DONE_FADE, MOTION_STEP_MS, type MotionCtx } from './motion';
import type { LiveSnapshot } from './orchestra-types';
import { resetCore, register, STOP_SETTLE_MS } from './register';
import type { Segment } from './runs';
import { composeSlot, type SlotPlan } from './slot';
import { memState } from './test_helpers';
import { FRAME_MS } from './band-motion';

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

const SIZES = [[150, 45, 93], [110, 40, 56], [150, 45, 145], [110, 40, 105]] as const;
const bandIndex = (f: Frame): number => f.plan.lead;
const MARKER = '◖ ◆ ATLAS ◗ ▸ SUBAGENTS';

/** The whole scenario at one size, `held` carried between stages as the register does. */
function scenario(screen: number, cols: number): { st: Stage; f: Frame }[] {
  let held = 0;
  return STAGES.map((st) => {
    const f = frameOf(st, cols, hostBudget(screen, st.running), held);
    held = f.plan.held;
    return { st, f };
  });
}


const stage = (name: string): Stage => STAGES.find((x) => x.name === name)!;
const txt = (row: Segment[]): string => row.map((x) => x.t).join('');
const BRAILLE = /[⠀-⣿]/;
const PLANROW = /^[ ▸] [●◐◓◑◒◇] T\d/;

describe('1. the Atlas region holds one height and the band one screen row for the whole run', () => {
  for (const [, screen, cols] of SIZES) {
    test(`${cols} cells: the slot is the budget tall in every state, with no rows above the band`, () => {
      for (const { st, f } of scenario(screen, cols)) {
        expect([st.name, f.rows.length]).toEqual([st.name, hostBudget(screen, st.running)]);
        expect([st.name, f.plan.lead, f.plan.gap]).toEqual([st.name, 0, 0]);
      }
    });
    test(`${cols} cells: the band stays on one screen row from working to done to idle (host list coming and going)`, () => {
      const rowOf = scenario(screen, cols).map(({ st, f }) => [st.name, screen - hostBelow(st.running) - f.rows.length + bandIndex(f)] as const);
      expect(new Set(rowOf.map(([, r]) => r)).size, JSON.stringify(rowOf)).toBe(1);
    });
    test(`${cols} cells: the TODO top rule is the next row and the SUBAGENTS table follows the plan box, in every state`, () => {
      for (const { st, f } of scenario(screen, cols)) {
        expect(f.rows[1]!, st.name).toMatch(/^╭─ ◖ ◆ ATLAS ◗ ▸ TODO /);
        const listed = st.running + st.returned > 0; // wave 36: with any agent the squad is a table under the plan's closed box, running or not; before the first agent one closing rule says so
        const title = f.rows.filter((r) => (listed ? /^╭.*▸ SUBAGENTS/ : /^╰.*▸ SUBAGENTS/).test(r));
        expect([st.name, title.length]).toEqual([st.name, 1]);
        expect(f.rows.some((r) => (listed ? /^╰.*▸ SUBAGENTS/ : /^╭.*▸ SUBAGENTS/).test(r)), `${st.name}: one form or the other`).toBe(false);
        const plans = f.rows.findIndex((r) => /^╰/.test(r)); // the plan box's own bottom rule
        if (listed) expect(f.rows.indexOf(title[0]!), st.name).toBe(plans + 1);
      }
    });
    test(`${cols} cells: the label is always todo n/m (never phase n/m), from the first frame`, () => {
      for (const { st, f } of scenario(screen, cols)) {
        expect(f.rows[0]!, st.name).toMatch(/todo (?:[▰▱]+ )?\d\/5/);
        expect(f.rows[0]!, st.name).not.toMatch(/phase \d/);
      }
    });
  }
});

describe('2. the SUBAGENTS title: a braille 141 spinner while they work, the squad line once they are done', () => {
  const rule = (f: Frame): Segment[] => f.hud.find((r) => /^[╰╭].*▸ SUBAGENTS/.test(txt(r)))!;
  test('working: `⠹ 3 running` with the spinner in the accent (141), over a table row per agent', () => {
    const f = frameOf(stage('3 running'), 150, hostBudget(45, 3) + 8, 0);
    expect(txt(rule(f))).toMatch(/▸ SUBAGENTS [⠀-⣿] 3 running ─+╮$/);
    const spin = rule(f).find((x) => BRAILLE.test(x.t) && x.t.trim().length === 1)!;
    expect(spin.color).toBe(PALETTES.mocha.accent); // 141
    expect(f.hud.map(txt).filter((r) => /^ {2}\S+-explorer\s+[⠀-⣿] running\s+0:/.test(r)).length).toBe(3);
  });
  test('done and idle: `● 3 done` on the title, a table row per agent with its clock, no spinner', () => {
    for (const name of ['done', 'idle']) {
      const f = frameOf(stage(name), 150, hostBudget(45, 0), 0);
      expect(txt(rule(f)), name).toMatch(/▸ SUBAGENTS ● 3 done ─+╮$/); // wave 35: the times moved onto the table rows
      expect(f.hud.map(txt).filter((r) => /^ {2}\S+-explorer\s+● done\s+0:0\d/.test(r)).length, name).toBe(3);
      expect(txt(rule(f)), name).not.toMatch(BRAILLE);
    }
  });
  test('every working indicator in the band is a braille frame too', () => {
    const f = frameOf(stage('3 running'), 150, hostBudget(45, 3), 0);
    expect(f.rows[0]!).toMatch(/[⠀-⣿] working/);
    expect(f.rows[0]!).toMatch(/[⠀-⣿] 3 running/);
  });
});

describe('3. the band bar draws no handle of its own (wave 33: the host draws the one `[-]` right of the tree)', () => {
  for (const [, screen, cols] of SIZES) {
    test(`${cols} cells: the first row is exactly the bar's width and holds no \`[-]\``, () => {
      for (const { st, f } of scenario(screen, cols)) {
        expect([st.name, [...f.rows[0]!].length]).toEqual([st.name, cols]);
        expect(f.rows[0]!, st.name).not.toMatch(/\[[-+]\]/);
      }
    });
  }
});

describe('4. the TODO rows are a 3-column grid: title, agent (15), time (5), one right edge', () => {
  const GRID = [[93, 45], [56, 40]] as const;
  for (const [cols, screen] of GRID) {
    test(`${cols} cells: the agent column starts 22 cells from the right edge and the clock fills the 5 cells before the last, on every row`, () => {
      let seen = 0;
      for (const { st, f } of scenario(screen, cols)) {
        for (const r of f.hud.map(txt).filter((x) => PLANROW.test(x) && /-explor/.test(x))) {
          seen++;
          expect([st.name, [...r].length]).toEqual([st.name, cols]);
          expect([st.name, r, /^\S.{13}[^ ]? $/.test(r.slice(cols - 22, cols - 6)) || /^[a-z-]+ *$/.test(r.slice(cols - 22, cols - 6))]).toEqual([st.name, r, true]);
          expect([st.name, r, /^ *\d+:\d\d$/.test(r.slice(cols - 6, cols - 1))]).toEqual([st.name, r, true]);
          expect(r.endsWith(' '), r).toBe(true);
        }
      }
      expect(seen).toBeGreaterThan(10);
    });
  }
  test('a name past 15 cells ends in an ellipsis; the column never widens', () => {
    for (const [cols, screen] of GRID) {
      const f = frameOf(stage('5 running'), cols, hostBudget(screen, 5) + 8, 0); // wave 36: five agents are a table under the plan, so the slot is roomier to hold both
      const r = f.hud.map(txt).find((x) => /T5 /.test(x))!;
      expect(r.slice(cols - 22, cols - 6)).toBe('epsilon-explor… ');
      const r1 = f.hud.map(txt).find((x) => /T1 /.test(x))!;
      expect(r1.slice(cols - 22, cols - 6)).toBe('alpha-explorer  ');
    }
  });
  test('the title drops the (agent) suffix, so the name appears once per row', () => {
    const st: Stage = { name: '3 running', running: 3, returned: 0, suffix: true };
    for (const [cols, screen] of GRID) {
      const f = frameOf(st, cols, hostBudget(screen, 3) + 6, 0);
      const rows = f.hud.map(txt).filter((x) => PLANROW.test(x) && /-explorer/.test(x));
      expect(rows.length).toBe(3);
      for (const r of rows) {
        expect(r, r).not.toMatch(/\(\w+-explorer\)/);
        expect((r.match(/-explorer/g) ?? []).length, r).toBe(1);
      }
    }
  });
});

describe('5. a done row: dim title, no `done` word, the agent and its time kept, no `returned`', () => {
  test('in done and idle the finished rows read `● title ... agent time`', () => {
    for (const name of ['done', 'idle']) {
      const f = frameOf(stage(name), 150, hostBudget(45, 0), 0);
      const rows = f.hud.filter((r) => /^[ ▸] ● T\d/.test(txt(r)));
      expect(rows.length, name).toBe(5);
      for (const r of rows) {
        const t = txt(r);
        expect(t, name).not.toMatch(/\bdone\b|returned/);
        const title = r.find((x) => /^T\d /.test(x.t))!;
        expect([name, t, title.color]).toEqual([name, t, PALETTE5.dim]); // 240
      }
      expect(txt(rows[0]!), name).toMatch(/alpha-explorer\s+0:04 $/);
    }
  });
  test('no frame of the run says `returned` or counts N returned', () => {
    for (const { st, f } of scenario(45, 150)) expect(f.rows.join('\n'), st.name).not.toMatch(/\d+ returned|\breturned\b/);
  });
});

describe('6. gates: the one amber 179 on the bar is the separate `△ gates 2/4` chip, in every state (wave 36)', () => {
  const base = { cols: 150, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'research', done: 5, total: 5, openWork: 0, openDispatch: 0, todoBlocked: 0, workers: [], checks: [{ id: 'g', ok: true }, { id: 'h', ok: false }, { id: 'i', ok: true }, { id: 'j', ok: false }], ui, bar: true } as const;
  const tone = (extra: object): [string, string | undefined] => {
    const runs = bandLines({ ...base, ...extra } as never)[0]!.runs;
    const g = runs.find((x) => /^ gates \d\/\d$/.test(x.t));
    return [g?.t ?? 'none', g?.tone];
  };
  test('the chip is warn in every state, and the figure is green-of-total', () => {
    expect(tone({ busy: true, turnSecs: 20 })).toEqual([' gates 2/4', 'warn']);
    expect(tone({ busy: false, phase: 'done', restSecs: 3, ranSecs: 58 })).toEqual([' gates 2/4', 'warn']);
    expect(tone({ busy: false, restSecs: 60, ranSecs: 58 })).toEqual([' gates 2/4', 'warn']);
  });
  test('no failing gate, no segment', () => {
    expect(tone({ busy: true, turnSecs: 20, checks: [{ id: 'g', ok: true }] })[0]).toBe('none');
  });
});

describe('7. same-frame truth: the row flips to done on the event that ends the agent, and the band counts it then', () => {
  const returned: Stage = { name: 'handed back', running: 2, returned: 1, handBack: true };
  test('the HUD row is done (no word) and not `returned`; the plan header and the band both say 1/5', () => {
    for (const [cols, screen] of [[93, 45], [56, 40]] as const) {
      const f = frameOf(returned, cols, hostBudget(screen, 2) + 4, 0); // wave 36: the table under the plan needs the rows the squad rule used to
      const row = f.hud.map(txt).find((r) => /T1 /.test(r))!;
      expect(row, `${cols}`).toMatch(/^[ ▸] ● T1/);
      expect(row, `${cols}`).not.toMatch(/returned|done/);
      expect(f.hud.map(txt)[0]!, `${cols}`).toMatch(/TODO +1\/5/);
      expect(f.rows[0]!, `${cols}`).toMatch(/todo (?:[▰▱]+ )?1\/5/);
    }
  });
  test('the unsettled reading is untouched: a plain hudLines frame still says `returned` (the side panel route tab reads that)', () => {
    const snap = snapshotOf(returned);
    const live = liveWorkers(snap, snap.now);
    const agents = hudAgents(live, snap.squad, queuedMembers(snap));
    const input: HudInput = { todos: ownTodos(snap.todos ?? [], snap.sessionId), agents, root: snap.root, phases: hudPhases(snap, null) };
    const rows = hudLines(input, { cols: 120, maxRows: 40, ui, now: snap.now, tick: 0 }).map((r) => r.map((x) => x.t).join(''));
    expect(rows.find((r) => /T1 /.test(r))!).toMatch(/returned/);
  });
});
