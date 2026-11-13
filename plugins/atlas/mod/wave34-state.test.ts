// Wave 34: the band, the TODO HUD and the SUBAGENTS rule never claim work that is not happening, and dispatch rows fold into their plan rows.
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
import { animateRow, DONE_FADE } from './motion';
import { motionFeed } from './motion-feed';

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
const BRAILLE = /[⠀-⣿]/;
const SIZES = [[150, 45, 93], [110, 40, 56]] as const;

type Agent = { name: string; squad: SquadAgent['state']; mood: string; tool?: string | null };
type Shape = { agents: Agent[]; plan: ('completed' | 'in_progress' | 'pending')[]; dispatch?: { owner: string; status: string; content?: string }[]; phase?: string; working: boolean; rest?: number; gates?: unknown[]; members?: string[]; /** Plan titles, and (noOwner) rows that carry no owner field: the live store names the worker only in the title's `(alpha-explorer)` suffix. */ titles?: string[]; noOwner?: boolean };

function snapshotOf(sh: Shape): LiveSnapshot {
  const squad: SquadAgent[] = sh.agents.map((a) => ({ name: a.name, persona: 'explorer', state: a.squad, source: 'task', task: `${a.name}: read ${a.name.split('-')[0]}.py` }) as SquadAgent);
  const act = Object.fromEntries(sh.agents.map((a, i) => [a.name, { tool: a.tool ?? null, since: NOW - 4_000, startedAt: NOW - 4_000 - i * 1000, toolCount: 1, tokens: 100, mood: a.mood, lastLine: '' }]));
  const plan: TodoItem[] = PLAN.slice(0, sh.plan.length).map((c, i) => ({ id: `t${i + 1}`, content: sh.titles?.[i] ?? c, status: sh.plan[i] ?? 'pending', ...(sh.agents[i] && !sh.noOwner ? { owner: sh.agents[i]!.name } : {}) }) as TodoItem);
  const dispatch: TodoItem[] = (sh.dispatch ?? []).map((d, i) => ({ id: `d${i + 1}`, content: d.content ?? `Read ${d.owner.split('-')[0]}.py first`, status: d.status, owner: d.owner, origin: 'dispatch', session_id: 's' }) as unknown as TodoItem);
  const done = sh.plan.filter((s) => s === 'completed').length;
  return busySnap({
    sessionId: 's', phase: (sh.phase ?? (sh.working ? 'research' : 'done')) as never, phaseSource: 'header', contextPct: 7, squad, comms: [],
    members: (sh.members ?? []).map((name) => ({ name, role: 'explorer', started_at: 1 }) as never),
    activity: { lead: { tool: null, since: NOW, toolCount: 1, tokens: null, mood: sh.working ? 'working' : 'idle', lastLine: '' }, ...act } as never,
    todos: [...plan, ...dispatch], counts: { done, total: 5, byPhase: {} }, todoGroups: [],
  });
}

type Frame = { rows: string[]; band: string; hud: string[]; segs: Segment[][]; model: BandModel; kind: ReturnType<typeof bandKindOf> };
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
  return { rows: [band, ...hud], band, hud, segs: plan.hud as Segment[][], model: plan.band, kind: bandKindOf(plan.band) };
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

/** The frozen-working capture (stoprun-150-4d8d8eb1-1 f0073): the host turn is over, every plan row is closed, ghost-explorer failed, and a retry dispatch (`explorer-4e2d`) the host never listed is still open. */
const FROZEN: Shape = {
  working: false, rest: 2,
  agents: STOP.agents,
  plan: STOP.plan,
  dispatch: [{ owner: NAMES[0]!, status: 'completed' }, { owner: NAMES[1]!, status: 'completed' }, { owner: 'ghost-explorer', status: 'completed' }, { owner: 'explorer-4e2d', status: 'in_progress' }],
  members: ['explorer-4e2d'],
};

describe('1. frozen working: an open dispatch with no live worker is blocked, never a braille `working`', () => {
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: the host turn is over, a dispatch is open and its worker never started: a static \`▲ blocked · stop refused\``, () => {
      const f = frameOf(FROZEN, body, screen);
      expect(f.kind).toBe('blocked');
      expect(f.band).toMatch(/^◖ ◆ ATLAS ◗ ▲ blocked(?: · stop refused)? \d:\d\d/);
      expect(f.band).not.toMatch(BRAILLE);
      expect(f.band).not.toMatch(/working|fixing/);
      for (const run of bandRuns(f.model).filter((x) => /blocked|dispatch open/.test(x.t))) expect([run.t, run.tone, run.bgHex]).toEqual([run.t, 'ink', '#ff5f5f']); // wave 35: dark ink on the error 203 state fill
    });
    test(`${cols} columns: with no dispatch open the same turn end reads \`● done\` in the ok green`, () => {
      const f = frameOf({ ...FROZEN, dispatch: FROZEN.dispatch!.slice(0, 3), members: [] }, body, screen, { workSecs: 57 });
      expect(f.kind).toBe('done');
      expect(f.band).toMatch(/^◖ ◆ ATLAS ◗ ● done/);
      expect(f.band).not.toMatch(BRAILLE);
      const done = bandRuns(f.model).find((x) => x.t === 'done')!;
      expect([done.tone, done.bgHex]).toEqual(['ink', '#87d787']); // wave 35: dark ink on the ok 114 state fill
    });
  }
  test('a live worker still holds the band working after the turn flag fell', () => {
    const live: Shape = { ...FROZEN, agents: [...FROZEN.agents.slice(0, 2), { name: 'ghost-explorer', squad: 'running', mood: 'working', tool: 'Read' }] };
    const f = frameOf(live, 93, 45);
    expect(f.kind).toBe('working');
    expect(f.band).toMatch(/[⠀-⣿] working/);
  });
  test('blocked never reads `fixing`, whatever runs', () => {
    for (const sh of [FROZEN, { ...FROZEN, gates: REFUSAL() }, { ...STOP, working: true, gates: REFUSAL() }]) expect(frameOf(sh, 93, 45).band).not.toMatch(/fixing/);
  });
});

/** The live capture: three explorers run T1..T3; the dispatch hook also wrote three rows named by hash whose prompts speak of the same files. */
const HASHED: Shape = {
  ...DEFAULT,
  dispatch: ['alpha', 'beta', 'gamma'].map((n, i) => ({ owner: `explorer-${i}${i}af`, status: 'in_progress', content: `List the function names defined in ${n}.py.` })),
  members: [0, 1, 2].map((i) => `explorer-${i}${i}af`),
};
/** The stop capture: the store names the worker only in a `(name)` title suffix, ghost failed, T3 closed over it, a retry dispatch is still open. */
const SUFFIXED: Shape = {
  ...FROZEN,
  titles: ['T1 read alpha.py (alpha-explorer)', 'T2 read beta.py (beta-explorer)', 'T3 read gamma.py (ghost-explorer)', 'T4 read delta.py', 'T5 write the summary'],
  noOwner: true,
  dispatch: [{ owner: 'explorer-aa11', status: 'completed' }, { owner: 'explorer-bb22', status: 'completed' }, { owner: 'explorer-cc33', status: 'completed' }, { owner: 'explorer-4e2d', status: 'in_progress', content: 'Read zeta.txt first' }],
};
const ruleOf = (f: Frame): string => f.hud.find((r) => /SUBAGENTS/.test(r)) ?? '';
const todoRowsOf = (f: Frame): string[] => f.hud.filter((r) => /T\d /.test(r));
const titleOf = (f: Frame): string => f.hud.find((r) => /TODO/.test(r)) ?? '';
const segOf = (f: Frame, re: RegExp): Segment[] => f.segs.find((r) => re.test(r.map((x) => x.t).join('')))!;

describe('2. the SUBAGENTS rule counts agents only; no spinner unless one runs', () => {
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: three agents and three queued dispatches read \`3 running\`, never \`queued\``, () => {
      const f = frameOf(HASHED, body, screen);
      expect(ruleOf(f)).toMatch(/SUBAGENTS\s+[⠀-⣿] 3 running/);
      expect(ruleOf(f)).not.toMatch(/queued/);
    });
    test(`${cols} columns: nothing runs: a static \`■ 1 failed · 2 done\`, no braille`, () => {
      const f = frameOf(SUFFIXED, body, screen);
      expect(ruleOf(f)).toMatch(/SUBAGENTS\s+■ 1 failed · 2 done/);
      expect(ruleOf(f)).not.toMatch(BRAILLE);
    });
  }
  test('the failed count is drawn in the error colour', () => {
    const f = frameOf(SUFFIXED, 93, 45);
    const failed = segOf(f, /SUBAGENTS/).find((x) => /failed/.test(x.t))!;
    const err = segOf(f, /T3 read/).find((x) => x.t.includes('■'))!;
    expect(failed.color).toBeDefined();
    expect(failed.color).toBe(err.color);
  });
});

describe('3. dispatches fold into the plan: one row per plan item', () => {
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: five plan items draw five rows and \`/5\` in the title and the band, three hash-named dispatches open`, () => {
      const f = frameOf(HASHED, body, screen);
      expect(todoRowsOf(f)).toHaveLength(5);
      expect(titleOf(f)).toMatch(/0\/5/);
      expect(f.band).toMatch(/todo 0\/5/);
      expect(f.hud.join('\n')).not.toMatch(/explorer-\d\daf|List the function/);
    });
    test(`${cols} columns: a closed plan keeps five rows and the band's denominator`, () => {
      const f = frameOf(SUFFIXED, body, screen);
      expect(todoRowsOf(f)).toHaveLength(5);
      expect(titleOf(f)).toMatch(/4\/5 · ■1/); // wave 36: one failed row is counted apart from the done rows
      expect(f.band).toMatch(/(todo )?4\/5 ■1/); // wave 37: the failed row rides the plan segment; the word `todo` goes first at 56 cells // wave 36: the failed row is not a done row
    });
  }
  test('done rows keep their agent and time columns', () => {
    const f = frameOf(SUFFIXED, 93, 45);
    for (const name of ['alpha-explorer', 'beta-explorer']) expect(todoRowsOf(f).find((r) => r.includes(name)), name).toMatch(/\d:\d\d/);
  });
  test('an open dispatch no plan row owns hangs as one dim child line `└ explorer-4e2d queued 0:00` only while the turn is alive, never once it ended (wave 37)', () => {
    const f = frameOf(SUFFIXED, 93, 45); // the host turn is over and the earlier workers ended: no phantom `queued` child
    expect(f.hud.filter((r) => /└/.test(r))).toHaveLength(0);
    expect(f.hud.join('\n')).not.toMatch(/explorer-4e2d/);
    const closed = frameOf({ ...SUFFIXED, dispatch: SUFFIXED.dispatch!.map((d) => ({ ...d, status: 'completed' })), members: [] }, 93, 45);
    expect(closed.hud.join('\n')).not.toMatch(/└|explorer-4e2d/);
  });
  test('a T row whose worker failed reads `■ failed` in the same colour as the error mark, never a `●`', () => {
    const f = frameOf(SUFFIXED, 93, 45);
    const row = todoRowsOf(f).find((r) => r.includes('T3'))!;
    expect(row).toMatch(/■ T3/);
    expect(row).toMatch(/failed/);
    const segs = segOf(f, /T3 read/);
    expect(segs.some((x) => x.t.includes('●'))).toBe(false);
    expect(segs.find((x) => /failed/.test(x.t))!.color).toBe(segs.find((x) => x.t.includes('■'))!.color);
  });
  test('a T row is never `running` once its agent finished; its neighbour still runs', () => {
    const done: Shape = { ...HASHED, agents: [{ name: NAMES[0]!, squad: 'finished', mood: 'done' }, HASHED.agents[1]!, HASHED.agents[2]!] };
    const f = frameOf(done, 93, 45);
    expect(todoRowsOf(f).find((r) => r.includes('T1'))).not.toMatch(/running/);
    expect(todoRowsOf(f).find((r) => r.includes('T2'))).toMatch(/running/);
  });
});

describe('4. geometry: the band keeps its row, the title takes the free cells', () => {
  test('110 columns: a title that does not fit the fixed grid ends in `…` on the cell (state 39: owner 12, then the title, shrink before a column drops)', () => {
    const titles = ['T1 read alpha.py (alpha-explorer)', 'T2 read beta.py (beta-explorer)', 'T3 read gamma.py (gamma-explorer)', 'T4 combine the three reports', 'T5 write the summary'];
    const f = frameOf({ ...DEFAULT, titles, noOwner: true }, 56, 40);
    expect(todoRowsOf(f).find((r) => r.includes('T4'))).toContain('T4 combine the three r…');
    for (const r of f.hud) expect([...r].length).toBeLessThanOrEqual(56);
  });
  test('the band is the first row of the slot in every state, within the width', () => {
    for (const sh of [HASHED, SUFFIXED, FROZEN, DEFAULT]) {
      const f = frameOf(sh, 93, 45);
      expect(f.rows[0]).toBe(f.band);
      expect(f.band).toMatch(/^◖ ◆ ATLAS ◗ /);
      expect([...f.band].length).toBeLessThanOrEqual(93);
    }
  });
});

describe('5. the done fade steps 231, 151, 114 once and holds', () => {
  const runs = [{ t: '● done', tone: 'ok' as const }];
  const at = (changed: number, now: number) => animateRow(runs as never, 'band:lead', 'done', { now, entry: () => ({ state: 'done', changed, born: changed - 5000 }) }, ui) as { fg?: string; t: string }[];
  test('231 first, then 151 held, then the resting row, never back', () => {
    const t0 = 10_000;
    const seq = [0, 100, 199, 200, 400, 790, 800, 1500].map((d) => at(t0, t0 + d));
    const fg = seq.map((r) => (r === (runs as unknown) ? 'rest' : r[0]!.fg));
    expect(fg[0]).toBe(DONE_FADE[0]);
    expect(fg[2]).toBe(DONE_FADE[0]);
    expect(fg[3]).toBe(DONE_FADE[1]);
    expect(fg[5]).toBe(DONE_FADE[1]);
    expect(fg[7]).toBe('rest');
    const rank = (c: string | undefined): number => (c === DONE_FADE[0] ? 0 : c === DONE_FADE[1] ? 1 : 2);
    for (let i = 1; i < fg.length; i++) expect(rank(fg[i])).toBeGreaterThanOrEqual(rank(fg[i - 1]));
  });
  test('the feed reads the band the render draws: after the turn end both say done, a working turn says working', () => {
    const shape: Shape = { ...FROZEN, dispatch: FROZEN.dispatch!.slice(0, 3), members: [] };
    const snapshot = snapshotOf(shape);
    const done = motionFeed(snapshot, [], null, ui, { working: false, restSecs: 2 }).band.find((i) => i.key === 'band:lead')!;
    expect(done.state).toBe('done');
    const busy = motionFeed(snapshotOf({ ...shape, working: true }), [], null, ui, { working: true }).band.find((i) => i.key === 'band:lead')!;
    expect(busy.state).toBe('working');
  });
});
