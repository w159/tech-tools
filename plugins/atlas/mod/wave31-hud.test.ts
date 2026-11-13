// Wave 31 (critique 29, build 0ed6e55b): the band and the HUD are one fixed block. These tests render the whole slot (slot.ts composeSlot) at the live widths (150 and 110 columns with the side pane docked: 93 and 56
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

type Stage = { name: string; running: number; returned: number; blocked?: boolean; rest?: number; working?: boolean };
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
  const todos: TodoItem[] = PLAN.map((c, i) => ({ id: `t${i + 1}`, content: c, status: finished || i < st.returned ? 'completed' : i < n ? 'in_progress' : 'pending', ...(i < n ? { owner: NAMES[i] } : {}) }) as TodoItem);
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

describe('1. one block, no hidden rows, no spacers', () => {
  for (const [, screen, cols] of SIZES) {
    test(`${cols} cells: no \`+N more\` and no blank slab row while the rows fit`, () => {
      for (const { st, f } of scenario(screen, cols)) {
        expect(f.rows.join('\n'), st.name).not.toMatch(/\+\d+ more/);
        expect(f.plan.gap, st.name).toBe(0);
        for (const r of f.hud) expect(r.map((x) => x.t).join('').trim(), `${st.name}: a slab row`).not.toBe('');
      }
    });
    test(`${cols} cells: the TODO box top sits on the row under the band in every state`, () => {
      for (const { st, f } of scenario(screen, cols)) {
        const at = f.rows.findIndex((r) => r.includes('▸ TODO'));
        expect(at - bandIndex(f), st.name).toBe(1);
      }
    });
    test(`${cols} cells: the key hint row is not in the block`, () => {
      for (const { st, f } of scenario(screen, cols)) expect(f.rows.join('\n'), st.name).not.toMatch(/r: route|ctrl\+x tab/);
    });
    test(`${cols} cells: the SUBAGENTS marker is on screen in every state`, () => {
      for (const { st, f } of scenario(screen, cols)) expect(f.rows.join('\n'), st.name).toContain(MARKER);
    });
  }
});

// Wave 32 (hud32): the SUBAGENTS box and its AGENT STATE TASK LAST RESULT header are gone in every state; the lower rule of the one block carries the title (`⠹ 3 running` while they work,
// `● 3 done · times · N fn` once they have stopped). The old at-rest box tests are replaced by the closing-rule form below.
describe('2. agents ride their TODO rows in every state; SUBAGENTS is the lower rule of the block', () => {
  for (const [, screen, cols] of SIZES) {
    test(`${cols} cells: agent and clock are right-aligned on the row, and there is no SUBAGENTS box in any state`, () => {
      for (const { st, f } of scenario(screen, cols)) {
        expect(f.rows.some((r) => /^╭.*▸ SUBAGENTS/.test(r)), `${st.name}: no SUBAGENTS box`).toBe(false);
        if (st.running + st.returned === 0) continue;
        expect(f.rows.some((r) => /^╰.*▸ SUBAGENTS.*╯\s*$/.test(r)), `${st.name}: the lower rule carries the title`).toBe(true);
      }
      for (const { st, f } of scenario(screen, cols)) {
        for (let i = st.returned; i < st.returned + st.running; i++) {
          const row = f.rows.find((r) => r.includes(`T${i + 1} `))!;
          expect(row, `${st.name} T${i + 1}`).toMatch(/^[ ▸] [◐◓◑◒] T\d/);
          expect(row.trimEnd(), `${st.name} T${i + 1}`).toMatch(new RegExp(`${(NAMES[i]!.length > 15 ? `${NAMES[i]!.slice(0, 14)}…` : NAMES[i])}\\s+\\d+:\\d\\d$`));
        }
      }
    });
    test(`${cols} cells: at rest the lower rule reads \`● N done\` with the times, and carries no column header`, () => {
      for (const { st, f } of scenario(screen, cols)) {
        if (st.running !== 0 || st.returned === 0) continue;
        const rule = f.rows.find((r) => /^╰.*▸ SUBAGENTS/.test(r));
        expect(rule, st.name).toBeDefined();
        expect(rule!, st.name).toMatch(/● \d+ done/);
        expect(f.rows.some((r) => /AGENT\s+STATE\s+TASK/.test(r)), st.name).toBe(false);
      }
    });
  }
  test('the SUBAGENTS rule is the same shape at 150 and 110 (docked and not)', () => {
    const rule = (cols: number, screen: number): string => scenario(screen, cols).find((x) => x.st.name === 'idle')!.f.rows.find((r) => /^╰.*▸ SUBAGENTS/.test(r))!;
    for (const [c, sc] of [[93, 45], [56, 40]] as const) expect(rule(c, sc)).toMatch(/^╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS ● 3 done.*╯\s*$/);
  });
});

describe('3. a queued TODO row whose agent runs shows running', () => {
  test('T1 names (alpha-explorer) with no owner stamped: it reads running, not queued', () => {
    const todos: TodoItem[] = [{ id: 't1', content: 'T1 read alpha.py (alpha-explorer)', status: 'pending' } as TodoItem];
    const agent = { name: 'alpha-explorer', role: 'explorer', state: 'working', ui: 'running', tool: 'Read', startedAt: NOW - 5000 } as never;
    const rows = hudLines({ todos: ownTodos(todos), agents: [agent] }, { cols: 93, maxRows: 10, ui, now: NOW }).map((r) => r.map((x) => x.t).join(''));
    const t1 = rows.find((r) => r.includes('T1 read alpha.py'))!;
    expect(t1).toMatch(/^[ ▸] [◐◓◑◒] T1/);
    expect(t1).not.toMatch(/queued|◇/);
  });
});

describe('4. accent motion and the done fade', () => {
  test('every running ◐◓◑◒ in the HUD is the accent', () => {
    const f = frameOf({ name: '3 running', running: 3, returned: 0 }, 93, hostBudget(45, 3), 0);
    const glyphs = f.hud.flat().filter((s) => /^[◐◓◑◒]$/.test(s.t));
    expect(glyphs.length).toBeGreaterThanOrEqual(3);
    for (const g of glyphs) expect(g.color).toBe(PALETTES.mocha.accent);
  });
  test('the SUBAGENTS rows at rest-with-running (a returned wave inside a running run) keep the accent too', () => {
    const f = frameOf({ name: 'one returned', running: 2, returned: 1 }, 93, hostBudget(45, 2), 0);
    for (const g of f.hud.flat().filter((s) => /^[◐◓◑◒]$/.test(s.t))) expect(g.color).toBe(PALETTES.mocha.accent);
  });
  const doneIn = (since: number): number[] => {
    const todos: TodoItem[] = [{ id: 't1', content: 'T1 read alpha.py', status: 'completed', owner: 'alpha-explorer' } as TodoItem];
    const ctx: MotionCtx = { now: 10_000 + since, entry: () => ({ state: 'done', changed: 10_000, born: 0 }) };
    const rows = hudRows({ todos: ownTodos(todos), agents: [] }, { cols: 93, maxRows: 10, ui: ui256, now: NOW, motion: ctx });
    return rows.flat().filter((s) => s.t === '●' || s.t.includes('●')).map((s) => hostTo256(s.color!));
  };
  test('the done mark steps 231, 151 (held to 800 ms), then 114, so a 0.5 s capture sees 151', () => {
    expect(MOTION_STEP_MS).toBe(200);
    expect(doneIn(0)[0]).toBe(231);
    expect(doneIn(199)[0]).toBe(231);
    for (const t of [200, 300, 500, 799]) expect(doneIn(t)[0], `${t} ms`).toBe(151);
    expect(doneIn(800)[0]).toBe(114);
    expect(DONE_FADE.map(hostTo256)).toEqual([231, 151]);
  });
  test('the band done word fades the same way', () => {
    const m = { cols: 100, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'done', done: 5, total: 5, workers: [], checks: null, busy: false, ranSecs: 58, restSecs: 3, ui: ui256 };
    const word = (since: number): string | undefined => {
      const motion: MotionCtx = { now: 5_000 + since, entry: (k) => (k === 'band:lead' ? { state: 'done', changed: 5_000, born: 0 } : undefined) };
      const runs = bandLines({ ...m, motion } as never)[0]!.runs;
      const hex = runs.find((x) => x.t.trim() === 'done')?.fg;
      return hex === undefined ? undefined : String(hostTo256(hex));
    };
    expect([word(0), word(300), word(900)]).toEqual(['231', '151', undefined]);
  });
});

describe('5. band segments, one failure word, one warning colour', () => {
  const base = { cols: 150, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'research', done: 5, total: 5, openWork: 6, openDispatch: 1, todoBlocked: 1, checks: [{ id: 'g', ok: false }, { id: 'h', ok: false }], ui } as const;
  const worker = (state: string) => ({ name: 'w', state, secs: 5 });
  test('a crowded working band keeps four segments at most', () => {
    const rows = [150, 93, 56].map((cols) => bandLines({ ...base, cols, busy: true, turnSecs: 28, workers: [worker('running'), worker('failed')] } as never)[0]!.runs.map((x) => x.t).join('').trim());
    for (const r of rows) expect(r.split(' · ').length, r).toBeLessThanOrEqual(4);
  });
  test('the failure word is `■ N failed` in the error colour, in working, blocked, done and idle', () => {
    for (const extra of [{ busy: true }, { busy: true, stopGates: ['stop refused'] }, { busy: false, phase: 'done', restSecs: 3, ranSecs: 58 }, { busy: false, restSecs: 60, ranSecs: 58, lastRun: { workers: 1, failed: 1, secs: 58 } }]) {
      const runs = bandLines({ ...base, cols: 150, workers: [worker('failed')], ...extra } as never)[0]!.runs;
      const text = runs.map((x) => x.t).join('');
      expect(text, JSON.stringify(extra)).toContain('■ 1 failed');
      expect(runs.find((x) => x.t === '1 failed')?.tone, JSON.stringify(extra)).toBe('bad');
    }
  });
  test('`△ N gates to check` has one tone (179) in done and idle, where it shows', () => {
    const tones = [{ busy: false, phase: 'done', restSecs: 3, ranSecs: 58 }, { busy: false, restSecs: 60, ranSecs: 58 }].map((extra) => {
      const runs = bandLines({ ...base, cols: 150, todoBlocked: 0, openWork: 5, openDispatch: 0, workers: [], ...extra } as never)[0]!.runs;
      const w = runs.find((x) => /gates to check/.test(x.t));
      expect(w, JSON.stringify(extra)).toBeDefined();
      return `${w!.tone}`;
    });
    expect([...new Set(tones)]).toEqual(['warn']);
  });
});

describe('6. idle dims the block', () => {
  test('idle draws 240 rules and 245 text; done keeps its colours', () => {
    const run = scenario(45, 93);
    const idle = run.find((x) => x.st.name === 'idle')!.f;
    const done = run.find((x) => x.st.name === 'done')!.f;
    const colours = (f: Frame): Set<string> => new Set(f.hud.flat().map((s) => s.color!).filter(Boolean));
    expect([...colours(idle)].sort()).toEqual([PALETTE5.dim, PALETTE5.secondary].sort());
    expect(colours(done).has(PALETTES.mocha.ok)).toBe(true);
    expect(bandKindOf({ snapshot: snapshotOf(STAGES[7]!), live: [], gates: [], columns: 93, tick: 0, working: false, restSecs: 60, ranSecs: 58, ui } as never)).toBe('idle');
  });
});

describe('7. blocked on the update that carries the Stop error (the host event order)', () => {
  type AnyNext = (input: unknown) => Promise<unknown>;
  type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
  test('the Stop hook writes the refusal, lets one redraw frame pass, and only then returns the result the host prints its error from', async () => {
    // The host: (1) runs the Stop hook chain; (2) the module's `next(e)` resolves to the folded settings-hook result, `{ block }` for exit code 2; (3) the module writes $.state, which redraws the band at the
    // redraw rate (index.d.ts, `ui.render`: ten a second at most); (4) the hook returns and the host prints `Stop hook error`. The error must not be printed before the band's next frame.
    let now = 1_800_000_000_000;
    const writes: number[] = [];
    const state = memState();
    const $ = {
      plugin: { name: 'atlas', root: '/plugins/atlas' },
      env: { get: async () => undefined },
      clock: { now: async () => now, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }), sleep: async (ms: number) => { now += ms; } },
      session: { id: async () => 'sess-w31' },
      process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
      fs: { read: async () => { throw new Error('missing'); }, stat: async () => { throw new Error('missing'); }, exists: async () => false, list: async () => [] },
      agent: { list: async () => [] },
      state: { get: state.get, set: async (...a: Parameters<typeof state.set>) => { writes.push(now); return state.set(...a); } },
      audio: { play: async () => {} },
      ui: { log: () => {}, invalidate: () => {}, open: async () => ({ isPlaced: true as const }), toast: () => {}, resolve: () => ({}), status: () => {} },
      command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
    } as unknown as EngineInterface;
    const handlers: { event: string; hook: AnyHandler }[] = [];
    const on = ((event: string, a: unknown, b?: unknown) => { handlers.push({ event, hook: (b ?? a) as AnyHandler }); return { catch() {} }; }) as unknown as On;
    resetCore();
    await register(on, {});
    await handlers.find((h) => h.event === 'session.start')!.hook($, { cwd: '/tmp/w31', surface: 'terminal', isInteractive: true }, async (x) => x);
    for (let i = 0; i < 500; i++) await Promise.resolve();
    writes.length = 0;
    const stop = handlers.find((h) => h.event === 'classic.Stop')!.hook;
    const verdict = { block: 'Done claimed too early: the reply header says `done` but there are 1 open dispatch row.' };
    const result = await stop($, { hook_event_name: 'Stop' }, async () => verdict);
    const errorPrintedAt = now; // the host prints its error when the hook has returned
    expect(result).toEqual(verdict);
    expect(writes.length, 'the refusal is written into the state the band reads').toBeGreaterThan(0);
    const lastWrite = Math.max(...writes);
    expect(errorPrintedAt - lastWrite, 'one redraw frame between the write and the error').toBeGreaterThanOrEqual(FRAME_MS);
    expect(STOP_SETTLE_MS).toBeGreaterThanOrEqual(FRAME_MS);
  });
  test('the band reads blocked from the hook result alone (no file poll)', () => {
    const groups = stopRefusal([], 'Done claimed too early: 1 open dispatch row.');
    expect(gateTally(groups as never).stop?.blocked).toBe(true);
    const f = frameOf({ name: 'blocked', running: 0, returned: 3, blocked: true }, 93, hostBudget(45, 0), 0);
    expect(f.rows[bandIndex(f)]!).toMatch(/▲ blocked/);
  });
});
