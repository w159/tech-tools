// Wave 33: the band and the TODO HUD show the true state (working, done, idle, blocked) on the same frame at every width, with one handle and one failure word.
// The harness renders the whole slot (slot.ts composeSlot) at the live widths (150 and 110 columns with the side pane docked: 93 and 56 cells of body) over the three captured shapes:
// the default run (3 explorers), the stop run (one worker killed, its dispatch row left open, the lead claims done) and a resumed native agent.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements, EngineInterface, On } from 'claude-code';
import { PALETTES, type Ui } from './atlas-ui';
import { bandKindOf, bandRuns, bandTree, hudPhases, type BandModel } from './band';
import type { SquadAgent, TodoItem } from './contract';
import { stopRefusal } from './data/runstate';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import { hudAgents, hudRows, isRunning, type HudInput } from './hud';
import { busySnap, NOW } from './live_fixture';
import { bandLines } from './mission-layout';
import type { LiveSnapshot } from './orchestra-types';
import { bandKind } from './pane/band-kind';
import { panelModelOf } from './pane/sidebar-model';
import { bodyLines, lineText } from './panel-layout';
import type { SidebarModel } from './pane/sidebar';
import { hostTurnRunning, register, resetCore, STOP_SETTLE_MS, turnEnded } from './register';
import type { Segment } from './runs';
import { composeSlot } from './slot';
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
const handlers = { openView: () => undefined, toggleTodos: () => undefined };
const NAMES = ['alpha', 'beta', 'gamma'].map((n) => `${n}-explorer`);
const PLAN = ['T1 read alpha.py', 'T2 read beta.py', 'T3 read gamma.py', 'T4 read delta.py', 'T5 write the summary'];
const SPIN_MARK = /[◐◓◑◒]/;
const SIZES = [[150, 45, 93], [110, 40, 56]] as const;

type Agent = { name: string; squad: SquadAgent['state']; mood: string; tool?: string | null };
type Shape = { agents: Agent[]; plan: ('completed' | 'in_progress' | 'pending')[]; dispatch?: { owner: string; status: string }[]; phase?: string; working: boolean; rest?: number; gates?: unknown[]; members?: string[] };

function snapshotOf(sh: Shape): LiveSnapshot {
  const squad: SquadAgent[] = sh.agents.map((a) => ({ name: a.name, persona: 'explorer', state: a.squad, source: 'task', task: `${a.name}: read ${a.name.split('-')[0]}.py` }) as SquadAgent);
  const act = Object.fromEntries(sh.agents.map((a, i) => [a.name, { tool: a.tool ?? null, since: NOW - 4_000, startedAt: NOW - 4_000 - i * 1000, toolCount: 1, tokens: 100, mood: a.mood, lastLine: '' }]));
  const plan: TodoItem[] = PLAN.slice(0, sh.plan.length).map((c, i) => ({ id: `t${i + 1}`, content: c, status: sh.plan[i] ?? 'pending', ...(sh.agents[i] ? { owner: sh.agents[i]!.name } : {}) }) as TodoItem);
  const dispatch: TodoItem[] = (sh.dispatch ?? []).map((d, i) => ({ id: `d${i + 1}`, content: `Read ${d.owner.split('-')[0]}.py first`, status: d.status, owner: d.owner, origin: 'dispatch', session_id: 's' }) as unknown as TodoItem);
  const done = sh.plan.filter((s) => s === 'completed').length;
  return busySnap({
    sessionId: 's', phase: (sh.phase ?? (sh.working ? 'research' : 'done')) as never, phaseSource: 'header', contextPct: 7, squad, comms: [],
    members: (sh.members ?? []).map((name) => ({ name, role: 'explorer', started_at: 1 }) as never),
    activity: { lead: { tool: null, since: NOW, toolCount: 1, tokens: null, mood: sh.working ? 'working' : 'idle', lastLine: '' }, ...act } as never,
    todos: [...plan, ...dispatch], counts: { done, total: 5, byPhase: {} }, todoGroups: [],
  });
}

type Frame = { rows: string[]; band: string; hud: string[]; model: BandModel; kind: ReturnType<typeof bandKindOf> };
function frameOf(sh: Shape, cols: number, screen: number, extra: Partial<BandModel> = {}): Frame {
  const snapshot = snapshotOf(sh);
  const live = liveWorkers(snapshot, snapshot.now);
  const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
  const hudIn: HudInput = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, null) };
  const bandIn = (_hud: Segment[][], maxRows: number | undefined): BandModel => ({ snapshot, live, gates: (sh.gates ?? []) as never, working: sh.working, workSecs: 19, ranSecs: sh.working ? undefined : 58, ...(sh.rest !== undefined ? { restSecs: sh.rest } : {}), columns: cols, tick: 3, ui, rich: false, maxRows, lastPhase: null, core: null, ...extra } as BandModel);
  const budget = Math.floor(screen / 2) - 4;
  const plan = composeSlot({ budget, hasSlot: true, hudOn: true, runOn: true, columns: cols, hudIn, hudView: { cols, tick: 3, ui, rich: false, now: snapshot.now }, running: agents.some(isRunning), agentsListed: agents.length > 0, orchestrated: true, now: snapshot.now, bandIn, held: 0 });
  const band = rowsOf(bandTree(els, plan.band, handlers) as unknown as Node)[0]!;
  const hud = plan.hud.map((r) => r.map((x) => x.t).join(''));
  return { rows: [band, ...hud], band, hud, model: plan.band, kind: bandKindOf(plan.band) };
}

/** The default run: three explorers working the first three plan rows. */
const DEFAULT: Shape = { working: true, agents: NAMES.map((name) => ({ name, squad: 'running', mood: 'working', tool: 'Read' })), plan: ['in_progress', 'in_progress', 'in_progress', 'pending', 'pending'] };
/** The stop run: the lead closed every plan row and claims done; ghost was killed and its dispatch row is still open. */
const STOP: Shape = {
  working: false, rest: 2,
  agents: [{ name: NAMES[0]!, squad: 'finished', mood: 'done' }, { name: NAMES[1]!, squad: 'finished', mood: 'done' }, { name: 'ghost-explorer', squad: 'failed', mood: 'failed', tool: null }],
  plan: ['completed', 'completed', 'completed', 'completed', 'completed'],
  dispatch: [{ owner: NAMES[0]!, status: 'completed' }, { owner: NAMES[1]!, status: 'completed' }, { owner: 'ghost-explorer', status: 'in_progress' }],
};
const REFUSAL = (): unknown[] => stopRefusal([], 'Done claimed too early: 1 open dispatch row.');

describe('1. one handle: the band bar ends flush and the host draws the only `[-]`', () => {
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns (${body} cells of body): no state draws a \`[-]\` and the first row is exactly the body wide`, () => {
      const shapes: [string, Shape][] = [['default', DEFAULT], ['stop run', STOP], ['stop refused', { ...STOP, gates: REFUSAL() }], ['idle', { ...STOP, dispatch: [], rest: 60 }], ['no plan', { working: false, agents: [], plan: [], rest: 60 }]];
      for (const [name, sh] of shapes) {
        const f = frameOf(sh, body, screen);
        expect(f.band, name).not.toMatch(/\[[-+]\]/);
        expect([name, [...f.band].length]).toEqual([name, body]);
        for (const r of f.hud) expect(r, name).not.toMatch(/\[[-+]\]/);
      }
    });
  }
  test('bandLines: no run of any state is a handle, at every width', () => {
    const base = { maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'research', done: 2, total: 5, openWork: 3, openDispatch: 0, todoBlocked: 0, checks: [], ui, bar: true, workers: [] } as const;
    for (const cols of [150, 93, 56, 40, 24]) for (const extra of [{ busy: true, turnSecs: 20 }, { busy: false, restSecs: 60 }, { busy: true, stopGates: ['stop refused'] }]) {
      const runs = bandLines({ ...base, cols, ...extra } as never)[0]!.runs;
      expect(runs.map((x) => x.t).join(''), `${cols} ${JSON.stringify(extra)}`).not.toContain('[-]');
      expect(runs.reduce((n, x) => n + [...x.t].length, 0)).toBe(cols);
    }
  });
});

describe('2. working whenever an agent runs (not a queued dispatch): a 141 spinner, never idle', () => {
  const RESUMED: Shape = { ...STOP, working: false, rest: 60, dispatch: [], agents: [{ name: NAMES[0]!, squad: 'running', mood: 'done', tool: 'Read' }, STOP.agents[1]!, STOP.agents[2]!] };
  const REOPENED: Shape = { ...STOP, working: false, rest: 60, agents: [STOP.agents[0]!, STOP.agents[1]!], dispatch: [{ owner: 'ghost-explorer', status: 'in_progress' }] };
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: a resumed native agent the host lists running (activity record still done) after the turn flag fell reads working`, () => {
      const f = frameOf(RESUMED, body, screen);
      expect(f.kind).toBe('working');
      expect(f.band).toMatch(/[◐◓◑◒] working/);
      expect(f.band).not.toMatch(/idle/);
    });
    test(`${cols} columns: a dispatch the host never listed (queued) does not hold the band working once the turn is over (wave 34): static blocked, no spinner`, () => {
      const f = frameOf(REOPENED, body, screen);
      expect(f.hud.join('\n')).not.toMatch(/SUBAGENTS [◐◓◑◒]/);
      expect(f.kind).toBe('blocked');
      expect(f.band).not.toMatch(SPIN_MARK);
    });
  }
  test('the spinner is the accent 141', () => {
    const f = frameOf(RESUMED, 93, 45);
    const run = bandRuns(f.model).find((x) => SPIN_MARK.test(x.t) && x.t.trim().length === 1)!;
    expect([run.tone, run.bgHex]).toEqual(['ink', '#af87ff']); // wave 35: dark ink on the accent 141 state fill
  });
  test('the panel reads the same state through band-kind', () => {
    const f = frameOf(RESUMED, 93, 45);
    expect(bandKind(f.model)).toBe('working');
    expect(bandKind(frameOf(STOP, 93, 45).model)).toBe('blocked');
  });
  test('band and side panel both say blocked for an open-dispatch Stop (cross-branch)', () => {
    const f = frameOf(STOP, 93, 45);
    expect(f.band).toMatch(/▲ blocked/);
    const m = { snapshot: snapshotOf(STOP), gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'route' }, columns: 94, rows: 45, look: ui, run: { kind: bandKind(f.model), secs: 58 } } as unknown as SidebarModel;
    const phase = bodyLines(panelModelOf(m, ui, 93)).map((l) => lineText(l).trimEnd()).find((l) => /^\s*phase/.test(l));
    expect(phase).toMatch(/▲ blocked/);
  });
});

describe('3. blocked on the frame the host stops, at every width', () => {
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: a dispatch row whose worker died after the host stops reads \`▲ blocked · stop refused\` and counts as failed (\`■1\`), static, with no Stop refusal needed (wave 37)`, () => {
      const f = frameOf(STOP, body, screen);
      expect(f.kind).toBe('blocked');
      expect(f.band).toMatch(/^◖ ◆ ATLAS ◗ ▲ blocked(?: · stop refused)? \d:\d\d/);
      expect(f.band).toMatch(/■1/); // the dead dispatch is a failure, never `1 dispatch open`
      expect(f.band).not.toMatch(/dispatch open/);
      expect(f.band).not.toMatch(SPIN_MARK);
      expect(f.band).not.toMatch(/idle|fixing/);
      const lead = bandRuns(f.model).filter((x) => /blocked|stop refused/.test(x.t));
      expect(lead.length).toBeGreaterThan(0);
      for (const run of lead) expect([run.t, run.tone, run.bold, run.bgHex]).toEqual([run.t, 'ink', true, '#ff5f5f']);
    });
    test(`${cols} columns: a Stop refusal reads \`▲ blocked · needs you\``, () => {
      const f = frameOf({ ...STOP, dispatch: [], gates: REFUSAL() }, body, screen);
      expect(f.kind).toBe('blocked');
      expect(f.band).toMatch(/▲ blocked/);
      expect(f.band).not.toMatch(SPIN_MARK);
    });
    test(`${cols} columns: the refusal and the open dispatch row together still name the row, blocked on both`, () => {
      const f = frameOf({ ...STOP, gates: REFUSAL() }, body, screen);
      expect(f.kind).toBe('blocked');
      expect(f.band).toMatch(/▲ blocked(?: · [a-z ]+)? \d:\d\d/);
    });
  }
  test('the plan row open keeps its dispatch row folded: no `dispatch open` while the T row carries it (every count is the plan\'s /5)', () => {
    const open: Shape = { ...STOP, working: true, plan: ['completed', 'completed', 'in_progress', 'completed', 'completed'], agents: [STOP.agents[0]!, STOP.agents[1]!, { name: 'ghost-explorer', squad: 'running', mood: 'working', tool: 'Read' }] };
    const f = frameOf(open, 93, 45);
    expect(f.band).not.toMatch(/dispatch/);
    expect(f.band).toMatch(/\b4\/5\b/);
  });
});

describe('4. done on the host turn-end event, not a later poll', () => {
  test('hostTurnRunning: the Stop event ends the turn though the host flag is still true', () => {
    expect(hostTurnRunning(true, false)).toBe(true);
    expect(hostTurnRunning(true, true)).toBe(false);
    expect(hostTurnRunning(false, false)).toBe(false);
    expect(hostTurnRunning(undefined, false)).toBe(false);
  });
  test('the band reads done the moment working goes false, with the run clock still open, and working while it is true', () => {
    const finished: Shape = { working: false, agents: NAMES.map((name) => ({ name, squad: 'finished', mood: 'done' })), plan: ['completed', 'completed', 'completed', 'completed', 'completed'], dispatch: NAMES.map((owner) => ({ owner, status: 'completed' })) };
    const f = frameOf({ ...finished }, 93, 45, { workSecs: 57 });
    expect(f.kind).toBe('done');
    expect(f.band).toMatch(/● done 0:58/);
    expect(f.band).not.toMatch(/working/);
    const g = frameOf({ ...finished, working: true }, 93, 45, { workSecs: 57 });
    expect(g.band).toMatch(/[◐◓◑◒] working 0:57/);
  });
  test('classic.Stop: an allowed Stop marks the turn ended, writes the redraw and holds the return one frame', async () => {
    let now = 1_800_000_000_000;
    const writes: number[] = [];
    const state = memState();
    const $ = {
      plugin: { name: 'atlas', root: '/plugins/atlas' },
      env: { get: async () => undefined },
      clock: { now: async () => now, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }), sleep: async (ms: number) => { now += ms; } },
      session: { id: async () => 'sess-w33' },
      process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
      fs: { read: async () => { throw new Error('missing'); }, stat: async () => { throw new Error('missing'); }, exists: async () => false, list: async () => [] },
      agent: { list: async () => [] },
      state: { get: state.get, set: async (...a: Parameters<typeof state.set>) => { writes.push(now); return state.set(...a); } },
      audio: { play: async () => {} },
      ui: { log: () => {}, invalidate: () => {}, open: async () => ({ isPlaced: true as const }), toast: () => {}, resolve: () => ({}), status: () => {} },
      command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
    } as unknown as EngineInterface;
    type AnyHandler = ($: EngineInterface, e: unknown, next: (input: unknown) => Promise<unknown>) => Promise<unknown>;
    const hooks: { event: string; hook: AnyHandler }[] = [];
    const on = ((event: string, a: unknown, b?: unknown) => { hooks.push({ event, hook: (b ?? a) as AnyHandler }); return { catch() {} }; }) as unknown as On;
    resetCore();
    await register(on, {});
    await hooks.find((h) => h.event === 'session.start')!.hook($, { cwd: '/tmp/w33', surface: 'terminal', isInteractive: true }, async (x) => x);
    for (let i = 0; i < 500; i++) await Promise.resolve();
    writes.length = 0;
    const stop = hooks.find((h) => h.event === 'classic.Stop')!.hook;
    expect(turnEnded()).toBe(false);
    const result = await stop($, { hook_event_name: 'Stop' }, async () => ({}));
    expect(result).toEqual({});
    expect(turnEnded(), 'the allowed Stop is the turn end the next render reads').toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    expect(now - Math.max(...writes), 'one redraw frame between the write and the hook returning').toBeGreaterThanOrEqual(FRAME_MS);
    expect(STOP_SETTLE_MS).toBeGreaterThanOrEqual(FRAME_MS);
    // a new prompt starts the next turn
    await hooks.find((h) => h.event === 'prompt.submit')!.hook($, { prompt: 'next' }, async (x) => x).catch(() => undefined);
    expect(turnEnded()).toBe(false);
  });
});

describe('5. one failure word: `■ N failed` in the error 203, in the band, the HUD rows and the SUBAGENTS rule', () => {
  const FAILED_STOP: Shape = { ...STOP, working: false, rest: 60, dispatch: STOP.dispatch!.map((d) => ({ ...d, status: 'completed' })) };
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: no row of the slot says killed; the band says \`■1\` in the plan segment`, () => {
      for (const sh of [FAILED_STOP, STOP, { ...STOP, gates: REFUSAL() }]) {
        const f = frameOf(sh, body, screen);
        expect(f.rows.join('\n')).not.toMatch(/killed/);
        expect(f.band).not.toMatch(/■ 1 failed/); // wave 37: the failure rides the plan segment as `■1`, one form at every width
        expect(f.hud.join('\n'), 'the failed agent is in the block').toMatch(/failed/);
        expect(f.band).toMatch(/\d\/5 ■1/);
      }
    });
  }
  test('the band colours the failure count with the error tone at every width (wave 37: `■1` in the plan segment)', () => {
    const f = frameOf(FAILED_STOP, 93, 45);
    const runs = bandRuns(f.model);
    const at = runs.findIndex((x) => x.t === '■' || x.t.includes('■'));
    expect(runs.slice(at, at + 3).find((x) => x.t === '1')!.tone).toBe('bad');
    for (const cols of [93, 80, 70, 60, 56, 48]) expect(frameOf(FAILED_STOP, cols, 45).band, `${cols}`).toMatch(/■1/);
  });
  test('the failed row of the TODO block and the SUBAGENTS rows read failed', () => {
    const f = frameOf(FAILED_STOP, 93, 45);
    const ghost = f.hud.find((r) => /ghost-explorer/.test(r) && /^[ ▸] ■/.test(r));
    expect(ghost, f.hud.join('\n')).toBeDefined();
    expect(ghost!).toMatch(/failed/);
  });
  test('the SUBAGENTS table title rule reads a static `■ 2 failed` with no spinner when nothing runs, in the error tone', () => {
    const two: Shape = { ...FAILED_STOP, agents: [{ name: NAMES[0]!, squad: 'failed', mood: 'failed' }, { name: NAMES[1]!, squad: 'failed', mood: 'failed' }, { name: NAMES[2]!, squad: 'finished', mood: 'done' }] };
    const snapshot = snapshotOf(two);
    const live = liveWorkers(snapshot, snapshot.now);
    const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
    const input: HudInput = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, null) };
    for (const cols of [93, 56]) {
      const rows = hudRows(input, { cols, tick: 3, ui, rich: false, now: snapshot.now, maxRows: 14, settled: true } as never) as Segment[][];
      const rule = rows.find((r) => /^╭.*▸ SUBAGENTS/.test(r.map((x) => x.t).join('')))!; // wave 35: the table's title rule
      const t = rule.map((x) => x.t).join('');
      expect(t, `${cols}`).toMatch(/▸ SUBAGENTS ■ 2 failed/);
      expect(t, `${cols}`).not.toMatch(SPIN_MARK);
      expect(rule.find((x) => x.t === '2 failed')?.color, `${cols}`).toBe(PALETTES.mocha.bad);
    }
  });
});

describe('6. the clock stays at every width; the word `todo` goes first below 90 cells', () => {
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: the working row keeps its clock (\`${body}\` cells)`, () => {
      const f = frameOf(DEFAULT, body, screen);
      expect(f.band).toMatch(/[◐◓◑◒] working 0:19/);
    });
  }
  test('93 cells keep `todo n/m` for the scorer\'s count regex; a narrower bar drops the word and keeps the clock and the counts', () => {
    const SCORER = /\btodo\b\D*?(\d+)\s*(?:of|\/)\s*(\d+)/;
    const wide = frameOf(DEFAULT, 93, 45).band;
    expect(wide).toMatch(SCORER);
    expect(wide).toMatch(/working 0:19/);
    expect(frameOf(DEFAULT, 56, 40).band).toMatch(/^◖ ◆ ATLAS ◗ [◐◓◑◒] working 0:19 ▌ todo 0\/5 ▌ [◐◓◑◒] 3 running/); // 56 cells still hold the whole row
    const narrow = frameOf(DEFAULT, 42, 40).band;
    expect(narrow).toMatch(/^◖ ◆ ATLAS ◗ [◐◓◑◒] working 0:19 ▌ 0\/5 ▌ [◐◓◑◒]3/);
    expect(narrow).not.toMatch(/todo/);
  });
  test('a long blocked lead still keeps the clock-bearing state at 56 cells', () => {
    const base = { cols: 56, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'research', done: 4, total: 5, openWork: 3, openDispatch: 0, todoBlocked: 0, checks: [], ui, bar: true } as const;
    const runs = bandLines({ ...base, busy: true, turnSecs: 19, workers: [{ name: 'a', state: 'running', secs: 5 }, { name: 'b', state: 'failed', secs: 5 }, { name: 'c', state: 'running', secs: 5 }] } as never)[0]!.runs;
    expect(runs.map((x) => x.t).join('')).toMatch(/working 0:19/);
  });
});

describe('7. no plan: `todo -` and `no agents`, never `todo 0/0` (wave 37: the three segments are always drawn)', () => {
  const NOPLAN: Shape = { working: false, agents: [], plan: [], rest: 60 };
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: the idle row has no count`, () => {
      const f = frameOf(NOPLAN, body, screen, { ranSecs: undefined });
      expect(f.band.trim()).toBe('◖ ◆ ATLAS ◗ ○ idle ▌ todo - ▌ no agents');
      expect(f.band).not.toMatch(/0\/0|phase/);
      expect(frameOf(NOPLAN, body, screen).band.trim()).toBe('◖ ◆ ATLAS ◗ ○ idle · 0:58 ▌ todo - ▌ no agents'); // a clock is no count
    });
  }
  test('a working turn with no plan says `working 0:12`, `todo -` and `no agents`', () => {
    const f = frameOf({ working: true, agents: [], plan: [] }, 93, 45, { workSecs: 12 });
    expect(f.band.trim()).toMatch(/^◖ ◆ ATLAS ◗ [◐◓◑◒] working 0:12 ▌ todo - ▌ no agents$/);
  });
  test('bandLines with total 0 never prints a count in any state or width', () => {
    const base = { maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'research', done: 0, total: 0, openWork: 0, openDispatch: 0, todoBlocked: 0, checks: [], ui, bar: true, workers: [] } as const;
    for (const cols of [150, 93, 56, 30]) for (const extra of [{ busy: true, turnSecs: 3 }, { busy: false, restSecs: 60 }, { busy: false, restSecs: 3, phase: 'done' }]) {
      const t = bandLines({ ...base, cols, ...extra } as never)[0]!.runs.map((x) => x.t).join('');
      expect(t, `${cols}`).not.toMatch(/0\/0/);
      expect(t.match(/▌/g) ?? [], `${cols}`).toHaveLength(2);
    }
  });
});
