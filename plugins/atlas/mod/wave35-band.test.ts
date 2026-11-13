// Wave 35 (band slice): the band is three fill segments (state | plan | workers) in block elements only, and the band, the TODO HUD and the SUBAGENTS surface show one clock, one count
// and one state per item. The harness renders the whole slot (slot.ts composeSlot) at the live widths (150 and 110 columns with the side pane docked: 93 and 56 cells of body).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { PALETTES, xtermHex, type Ui } from './atlas-ui';
import { bandRuns, bandTree, hudPhases, type BandModel } from './band';
import type { SquadAgent, TodoItem } from './contract';
import * as runstate from './data/runstate';
import { liveWorkers, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import * as hud from './hud';
import { hudAgents, isRunning, type HudInput } from './hud';
import { busySnap, NOW } from './live_fixture';
import { bandLines } from './mission-layout';
import type { LiveSnapshot } from './orchestra-types';
import type { Segment } from './runs';
import { composeSlot } from './slot';

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
const PLAN = ['T1 read alpha.py', 'T2 read beta.py', 'T3 read gamma.py', 'T4 combine the reports', 'T5 write the summary'];
const BRAILLE = /[⠀-⣿]/;
const PUA = /[\uE000-\uF8FF]/;
const SIZES = [[150, 45, 93], [110, 40, 56]] as const;

type Agent = { name: string; squad: SquadAgent['state']; mood: string; tool?: string | null };
type Shape = { agents: Agent[]; plan: ('completed' | 'in_progress' | 'pending')[]; working: boolean; rest?: number; gates?: unknown[]; calls?: number; /** The host's own tally when it lags the rows (critique 34: `todo 0/5` beside `TODO 1/5`). */ countsDone?: number };

function snapshotOf(sh: Shape): LiveSnapshot {
  const squad: SquadAgent[] = sh.agents.map((a) => ({ name: a.name, persona: 'explorer', state: a.squad, source: 'task', task: `${a.name}: read ${a.name.split('-')[0]}.py` }) as SquadAgent);
  const act = Object.fromEntries(sh.agents.map((a, i) => [a.name, { tool: a.tool ?? null, since: NOW - 4_000, startedAt: NOW - 14_000 - i * 1000, toolCount: 1, tokens: 100, mood: a.mood, lastLine: '' }]));
  const plan: TodoItem[] = PLAN.slice(0, sh.plan.length).map((c, i) => ({ id: `t${i + 1}`, content: c, status: sh.plan[i] ?? 'pending', ...(sh.agents[i] ? { owner: sh.agents[i]!.name } : {}) }) as TodoItem);
  const done = sh.plan.filter((s) => s === 'completed').length;
  return busySnap({
    sessionId: 's', phase: (sh.working ? 'research' : 'done') as never, phaseSource: 'header', contextPct: 7, squad, comms: [],
    activity: { lead: { tool: null, since: NOW, toolCount: 1, tokens: null, mood: sh.working ? 'working' : 'idle', lastLine: '' }, ...act } as never,
    todos: plan, counts: { done: sh.countsDone ?? done, total: 5, byPhase: {} }, todoGroups: [],
  });
}

type Frame = { band: string; hud: string[]; hudSegs: Segment[][]; model: BandModel };
function frameOf(sh: Shape, cols: number, screen: number, color: Ui['color'] = 'truecolor'): Frame {
  const u: Ui = { ...ui, color };
  const snapshot = snapshotOf(sh);
  const live = liveWorkers(snapshot, snapshot.now);
  const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
  const hudIn: HudInput = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, null) };
  const bandIn = (_hud: Segment[][], maxRows: number | undefined): BandModel => ({ snapshot, live, gates: (sh.gates ?? []) as never, working: sh.working, workSecs: 42, ranSecs: sh.working ? undefined : 72, ...(sh.rest !== undefined ? { restSecs: sh.rest } : {}), columns: cols, tick: 3, ui: u, rich: false, maxRows, lastPhase: null, core: null } as BandModel);
  const budget = Math.floor(screen / 2) - 4;
  const plan = composeSlot({ budget, hasSlot: true, hudOn: true, runOn: true, columns: cols, hudIn, hudView: { cols, tick: 3, ui: u, rich: false, now: snapshot.now }, running: agents.some(isRunning), agentsListed: agents.length > 0, orchestrated: true, now: snapshot.now, bandIn, held: 0 });
  const band = rowsOf(bandTree(els, plan.band, handlers) as unknown as Node)[0]!;
  return { band, hud: plan.hud.map((r) => r.map((x) => x.t).join('')), hudSegs: plan.hud, model: plan.band };
}

const RUNNING: Shape = { working: true, agents: NAMES.map((name) => ({ name, squad: 'running', mood: 'working', tool: 'Read' })), plan: ['in_progress', 'in_progress', 'in_progress', 'pending', 'pending'] };
const FINISHED: Shape = { working: false, rest: 2, agents: NAMES.map((name) => ({ name, squad: 'finished', mood: 'done' })), plan: ['completed', 'completed', 'completed', 'completed', 'completed'] };
const IDLE: Shape = { ...FINISHED, rest: 60 };
/** The lead closed every plan row and claims done; the third worker died and the Stop gate refused. */
const STOP: Shape = { ...FINISHED, agents: [FINISHED.agents[0]!, FINISHED.agents[1]!, { name: NAMES[2]!, squad: 'failed', mood: 'failed' }], gates: runstate.stopRefusal([], 'Done claimed too early: 1 open dispatch row.') as unknown[] };
const STATES: [string, Shape, string, string, boolean][] = [
  ['working', RUNNING, 'accent', '[⠀-⣿] working 0:42', true],
  ['done', FINISHED, 'ok', '● done · 1:12', false],
  ['idle', IDLE, 'muted', '○ idle', false],
  ['blocked', STOP, 'bad', '▲ blocked', true],
];
const fill = (token: 'accent' | 'ok' | 'muted' | 'bad'): string => PALETTES.mocha[token];

describe('1. the band is three segments: state | plan | workers, in block elements', () => {
  for (const [cols, screen, body] of SIZES) {
    for (const [name, sh, token, lead, workers] of STATES) {
      test(`${cols} columns, ${name}: the state fill is ${token}, the plan 237 and the workers 235; the lead text keeps the marker`, () => {
        const f = frameOf(sh, body, screen);
        expect(f.band).toMatch(new RegExp(`^◖ ◆ ATLAS ◗ ${lead}`));
        expect(f.band).toMatch(/▌ (?:todo )?\d\/5/);
        expect(f.band).not.toMatch(PUA);
        const runs = bandRuns(f.model);
        const fills = runs.map((x) => x.bgHex).filter((h): h is string => h !== undefined);
        const order = [...new Set(fills)];
        expect(order[0], `${name} state fill`).toBe(fill(token as 'accent'));
        expect(order[1], `${name} plan fill`).toBe(xtermHex(237));
        if (workers) expect(order[2], `${name} workers fill`).toBe(xtermHex(235));
        else expect(order, `${name}: no workers listed, no workers segment`).toHaveLength(2);
        const word = runs.find((x) => x.t === name || x.t === ' blocked')!;
        expect([word.tone, word.bgHex], name).toEqual(['ink', fill(token as 'accent')]); // dark or white ink on the state fill (231 / 234)
        expect(runs.reduce((n, x) => n + [...x.t].length, 0), 'the bar is exactly the body wide').toBe(body);
        expect(runs.at(-1)!.bgHex, 'the last segment fill runs to the last cell').toBeDefined();
      });
    }
  }
  test('the working band reads the worker counts in the workers segment, after the plan', () => {
    const f = frameOf(RUNNING, 93, 45);
    expect(f.band).toMatch(/▌ todo \d\/5 ▌ [⠀-⣿] 3 running/);
  });
  test('256 colours keep the seams; NO_COLOR/dumb and ASCII degrade to the dot-joined text with no seams; ASCII has no block glyph', () => {
    const base = { maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'research', done: 2, total: 5, openWork: 3, openDispatch: 0, todoBlocked: 0, checks: [], bar: true, workers: [], busy: true, turnSecs: 42, cols: 93 } as const;
    const text = (u: Ui): string => bandLines({ ...base, ui: u } as never)[0]!.runs.map((x) => x.t).join('');
    expect(text({ theme: 'mocha', ascii: false, color: 'none' })).toMatch(/^◖ ◆ ATLAS ◗ [⠀-⣿] working 0:42 · todo 2\/5/);
    expect(text({ theme: 'mocha', ascii: true, color: 'truecolor' })).toMatch(/^\[ATLAS\] \| working 0:42 · todo 2\/5/);
    expect(text({ theme: 'mocha', ascii: false, color: '256' })).toMatch(/^◖ ◆ ATLAS ◗ [⠀-⣿] working 0:42 ▌ todo 2\/5/);
    for (const color of ['256', 'none'] as const) expect(text({ theme: 'mocha', ascii: false, color })).not.toMatch(PUA);
  });
  test('256 colours keep the stable palette fills (141 / 237 / 235), never an RGB approximation', () => {
    const f = frameOf(RUNNING, 93, 45, '256');
    const fills = [...new Set(bandRuns(f.model).map((x) => x.bgHex).filter((h): h is string => h !== undefined))];
    expect(fills.slice(0, 3)).toEqual([PALETTES.mocha.accent, xtermHex(237), xtermHex(235)]);
  });
  test('a narrow bar drops the workers segment first, then the plan detail, and never the state word or the clock', () => {
    const seen: string[] = [];
    for (let body = 93; body >= 34; body--) {
      const f = frameOf(RUNNING, body, 45);
      expect(f.band, `${body}`).toMatch(/^◖ ◆ ATLAS ◗ [⠀-⣿] working 0:42/);
      const workers = /running/.test(f.band);
      const plan = /todo|\d\/5/.test(f.band);
      if (workers) expect(plan, `${body}: the workers never outlive the plan`).toBe(true);
      seen.push(`${workers ? 'W' : '-'}${plan ? 'P' : '-'}`);
    }
    expect(seen[0]).toBe('WP');
    expect(seen.at(-1)).not.toBe('WP');
    const firstNoWorkers = seen.indexOf('-P');
    expect(firstNoWorkers).toBeGreaterThan(0);
    expect(seen.slice(firstNoWorkers)).not.toContain('WP');
  });
});

describe('3. one clock: the band always shows the elapsed time while working, read from runElapsed', () => {
  test('a working bar with no worker age and no turn clock still carries `0:00` (the clock never drops out mid-turn)', () => {
    const base = { maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'research', done: 2, total: 5, openWork: 3, openDispatch: 0, todoBlocked: 0, checks: [], bar: true, workers: [], busy: true, ui } as const;
    for (const cols of [93, 56, 40]) {
      const text = bandLines({ ...base, cols } as never)[0]!.runs.map((x) => x.t).join('');
      expect(text, `${cols}`).toMatch(/working 0:00/);
    }
  });
  test('runElapsed is the one reading: open clock, and a clock the run closed early keeps counting from the same start', () => {
    const fn = (runstate as unknown as Record<string, unknown>).runElapsed as ((c: unknown, now: number) => number | undefined) | undefined;
    expect(typeof fn).toBe('function');
    expect(fn!({ startMs: 1_000 }, 31_999)).toBe(30);
    expect(fn!({ startMs: null, ranMs: 30_000, endedMs: 40_000 }, 100_000)).toBe(90);
    expect(fn!({ startMs: null }, 100_000)).toBeUndefined();
  });
});

describe('4. one count: the band `todo n/m` is the TODO HUD title figure', () => {
  const figures = (f: Frame): [string, string] => [/(?:todo )?(\d)\/5/.exec(f.band)?.[1] ?? '?', /▸ TODO\s+(\d)\/5/.exec(f.hud.join('\n'))?.[1] ?? '?'];
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: the stop run (a worker died under a plan row marked completed) reads the same figure in the band and the HUD title`, () => {
      const [band, hud] = figures(frameOf(STOP, body, screen));
      expect(band).not.toBe('?');
      expect(band).toBe(hud);
    });
    test(`${cols} columns: a stale host tally never decides the band's figure (critique 34: \`todo 0/5\` beside \`TODO 1/5\`)`, () => {
      const lagging: Shape = { ...RUNNING, agents: [{ name: NAMES[0]!, squad: 'finished', mood: 'done' }, RUNNING.agents[1]!, RUNNING.agents[2]!], plan: ['completed', 'in_progress', 'in_progress', 'pending', 'pending'], countsDone: 0 };
      const [band, hud] = figures(frameOf(lagging, body, screen));
      expect(hud).toBe('1');
      expect(band).toBe('1');
    });
    test(`${cols} columns: every shape agrees, working, done and idle`, () => {
      for (const sh of [RUNNING, FINISHED, IDLE]) {
        const [band, hud] = figures(frameOf(sh, body, screen));
        expect(band).toBe(hud);
      }
    });
  }
});

describe('5. one state per item: a row whose worker died is `■ failed` from the first frame', () => {
  const dead: Shape = { working: true, agents: [{ name: NAMES[0]!, squad: 'running', mood: 'working', tool: 'Read' }, { name: NAMES[1]!, squad: 'failed', mood: 'failed' }, { name: NAMES[2]!, squad: 'running', mood: 'working', tool: 'Read' }], plan: ['in_progress', 'in_progress', 'in_progress', 'pending', 'pending'] };
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: T2 (its worker failed) reads \`■ ... failed\` in 203, not running, queued or done`, () => {
      const f = frameOf(dead, body, screen);
      const at = f.hud.findIndex((r) => /T2 /.test(r));
      expect(f.hud[at]).toMatch(/■ T2 .*failed/);
      const glyph = f.hudSegs[at]!.find((x) => x.t === '■');
      expect(glyph?.color).toBe(PALETTES.mocha.bad);
    });
    test(`${cols} columns: a pending row with no worker is queued, never a green disc`, () => {
      const f = frameOf(RUNNING, body, screen);
      const row = f.hud.find((r) => /T4 /.test(r))!;
      expect(row).toMatch(/◇ T4/);
      expect(row).not.toMatch(/● T4/);
    });
  }
});

describe('6. SUBAGENTS: one rule while they run, a k9s-style table once they have stopped', () => {
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: while agents run there is one rule and no header row`, () => {
      const f = frameOf(RUNNING, body, screen);
      const marks = f.hud.filter((r) => r.includes('◖ ◆ ATLAS ◗ ▸ SUBAGENTS'));
      expect(marks).toHaveLength(1);
      expect(marks[0]).toMatch(/^╰.*[⠀-⣿] 3 running/);
      expect(f.hud.some((r) => /^\s+AGENT\s+TIME/.test(r))).toBe(false);
    });
    test(`${cols} columns: at done the table is AGENT TIME, one row per agent with the disc, the name and the clock`, () => {
      const f = frameOf(FINISHED, body, screen);
      const head = f.hud.findIndex((r) => /^\s+AGENT\s+TIME/.test(r));
      expect(head).toBeGreaterThan(0);
      expect(f.hud[head - 1]).toMatch(/^╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS ● 3 done/);
      const header = f.hudSegs[head]!.find((x) => x.t.includes('AGENT'))!;
      expect(header.color).toBe(xtermHex(245));
      NAMES.forEach((n, i) => {
        const row = f.hud[head + 1 + i]!;
        expect(row, n).toMatch(new RegExp(`^ ● ${n}\\s+\\d+:\\d\\d`));
      });
    });
    test(`${cols} columns: a failed agent's row is \`■\` in 203`, () => {
      const f = frameOf(STOP, body, screen);
      const at = f.hud.findIndex((r) => /^ ■ gamma-explorer/.test(r));
      expect(at).toBeGreaterThan(0);
      const segs = f.hudSegs[at]!;
      expect(segs.find((x) => x.t === '■')?.color).toBe(PALETTES.mocha.bad);
      expect(segs.find((x) => x.t.includes('gamma-explorer'))?.color).toBe(PALETTES.mocha.bad);
    });
  }
  test('at 110 columns the narrow table keeps the names and the times', () => {
    const f = frameOf(FINISHED, 56, 40);
    for (const n of NAMES) expect(f.hud.join('\n')).toMatch(new RegExp(`${n}\\s+\\d+:\\d\\d`));
  });
  test('the TODO HUD rows for the same input are unchanged by the table (the table is a separate box under the closed plan box)', () => {
    const f = frameOf(FINISHED, 93, 45);
    expect(f.hud[0]).toMatch(/^╭─ ◖ ◆ ATLAS ◗ ▸ TODO /);
    expect(f.hud.filter((r) => /^╰/.test(r))).toHaveLength(2);
  });
});

describe('4b. one count: the band takes its figure from hud.ts planProgress, the reading the TODO title is built on', () => {
  test('planProgress equals the TODO title figure for the stop run (the dead worker included)', () => {
    const f = frameOf(STOP, 93, 45);
    const snapshot = snapshotOf(STOP);
    const live = liveWorkers(snapshot, snapshot.now);
    const p = hud.planProgress(ownTodos(snapshot.todos ?? [], snapshot.sessionId), live, snapshot.squad, queuedMembers(snapshot), snapshot.now);
    expect(`${p.done}`).toBe(/▸ TODO\s+(\d)\/5/.exec(f.hud.join('\n'))?.[1]);
  });
});
