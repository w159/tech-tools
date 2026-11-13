// Wave 37 (band slice, critique 36): the band, the TODO HUD and the SUBAGENTS table read the same way in every run and width.
// The harness renders the whole slot (slot.ts composeSlot) at the live widths (150 and 110 columns with the side pane docked: 93 and 56 cells of body).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { LEAD_FRAMES, SPINNER_MS, hostTo256, xtermHex, type Ui } from './atlas-ui';
import { BAND_BUTTONS, bandRuns, bandTree, hudPhases, type BandModel } from './band';
import type { SquadAgent, TodoItem } from './contract';
import * as runstate from './data/runstate';
import { forgetEnded, liveWorkers, noteEnded, notifiedEnds, queuedMembers } from './data/live';
import { ownTodos } from './data/todos';
import * as hud from './hud';
import { hudAgents, isRunning, type HudInput } from './hud';
import { busySnap, NOW } from './live_fixture';
import { BLOCKED_TEXT, runStateOf, type MissionModel } from './mission-layout';
import { sharedSpinFrame } from './motion';
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

type Frame = { cells: Node[]; band: string; hud: string[]; hudSegs: Segment[][]; model: BandModel };
function frameOf(sh: Shape, cols: number, screen: number, color: Ui['color'] = 'truecolor'): Frame {
  const u: Ui = { ...ui, color };
  const snapshot = snapshotOf(sh);
  const live = liveWorkers(snapshot, snapshot.now);
  const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
  const hudIn: HudInput = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, null) };
  const bandIn = (_hud: Segment[][], maxRows: number | undefined): BandModel => ({ snapshot, live, gates: (sh.gates ?? []) as never, working: sh.working, workSecs: 42, ranSecs: sh.working ? undefined : 72, ...(sh.rest !== undefined ? { restSecs: sh.rest } : {}), columns: cols, tick: 3, ui: u, rich: false, maxRows, lastPhase: null, core: null } as BandModel);
  const budget = Math.floor(screen / 2) - 4;
  const plan = composeSlot({ budget, hasSlot: true, hudOn: true, runOn: true, columns: cols, hudIn, hudView: { cols, tick: 3, ui: u, rich: false, now: snapshot.now }, running: agents.some(isRunning), agentsListed: agents.length > 0, orchestrated: true, now: snapshot.now, bandIn, held: 0 });
  const tree = bandTree(els, plan.band, handlers) as unknown as Node;
  const band = rowsOf(tree)[0]!;
  const row0 = (tree.props.children as Node[])[0]!;
  return { cells: row0.props.children as Node[], band, hud: plan.hud.map((r) => r.map((x) => x.t).join('')), hudSegs: plan.hud, model: plan.band };
}

const RUNNING: Shape = { working: true, agents: NAMES.map((name) => ({ name, squad: 'running', mood: 'working', tool: 'Read' })), plan: ['in_progress', 'in_progress', 'in_progress', 'pending', 'pending'] };
const FINISHED: Shape = { working: false, rest: 2, agents: NAMES.map((name) => ({ name, squad: 'finished', mood: 'done' })), plan: ['completed', 'completed', 'completed', 'completed', 'completed'] };
const IDLE: Shape = { ...FINISHED, rest: 60 };
/** The lead closed every plan row and claims done; the third worker died and the Stop gate refused. */
const STOP: Shape = { ...FINISHED, agents: [FINISHED.agents[0]!, FINISHED.agents[1]!, { name: NAMES[2]!, squad: 'failed', mood: 'failed' }], gates: runstate.stopRefusal([], 'Done claimed too early: 1 open dispatch row.') as unknown[] };

const NOPLAN: Shape = { working: false, agents: [], plan: [], rest: 60 };
const ALL: [string, Shape][] = [['working', RUNNING], ['done', FINISHED], ['idle', IDLE], ['blocked', STOP], ['no plan', NOPLAN]];
const WIDTHS = [93, 56, 44, 40, 36];
const bgOf = (c: Node): unknown => c.props.backgroundColor;
const sgrBg256 = (hex: string): string => `\x1b[48;5;${hostTo256(hex)}m`;
const sgrBgTrue = (hex: string): string => `\x1b[48;2;${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}m`;

describe('1. the wordmark pill is xterm 97 as emitted', () => {
  test('256 colours: the pill background and the caps resolve to index 97 (48;5;97), never the nearest stable grey', () => {
    for (const [cols, screen, body] of SIZES) {
      const f = frameOf(RUNNING, body, screen, '256');
      const pill = f.cells.find((c) => c.props.children === ' ◆ ')!;
      expect(sgrBg256(String(bgOf(pill))), `${cols}`).toBe('\x1b[48;5;97m');
      const cap = f.cells.find((c) => String(c.props.children).includes('◖'))!;
      expect(hostTo256(String(cap.props.color)), `${cols} cap`).toBe(97);
    }
  });
  test('truecolor: the pill background is the xterm 97 value (48;2;135;95;175)', () => {
    const f = frameOf(RUNNING, 93, 45, 'truecolor');
    const pill = f.cells.find((c) => c.props.children === ' ◆ ')!;
    expect(bgOf(pill)).toBe(xtermHex(97));
    expect(sgrBgTrue(String(bgOf(pill)))).toBe('\x1b[48;2;135;95;175m');
  });
});

describe('2. the band is always state | plan | workers', () => {
  test('every state at every width draws exactly two seams; each seam is the left fill on the left half and the right fill on the right half', () => {
    for (const [name, sh] of ALL) for (const body of WIDTHS) {
      const f = frameOf(sh, body, 45);
      expect([...f.band].filter((c) => c === '▌'), `${name} ${body}: ${f.band}`).toHaveLength(2);
      f.cells.forEach((c, i) => {
        if (c.props.children !== '▌') return;
        expect(c.props.color, `${name} ${body}: seam fg is the fill to its left`).toBe(bgOf(f.cells[i - 1]!));
        expect(c.props.backgroundColor, `${name} ${body}: seam bg is the fill to its right`).toBe(bgOf(f.cells[i + 1]!));
      });
    }
  });
  test('the plan segment reads `todo n/m` (with `■k` for failures) and `todo -` with no plan, at the docked width', () => {
    expect(frameOf(RUNNING, 93, 45).band).toMatch(/▌ todo 0\/5 ▌/);
    expect(frameOf(FINISHED, 93, 45).band).toMatch(/▌ todo 5\/5 ▌/);
    expect(frameOf(STOP, 93, 45).band).toMatch(/▌ todo 4\/5 ■1 ▌/);
    expect(frameOf(NOPLAN, 93, 45).band).toMatch(/▌ todo - ▌ no agents/);
  });
  test('blocked text comes from one string table: `▲ blocked · <reason>`, two reasons only (state 38)', () => {
    expect(BLOCKED_TEXT.stop).toBe('stop refused');
    expect(BLOCKED_TEXT.failed(1)).toBe('1 failed');
    expect(frameOf(STOP, 93, 45).band).toMatch(/^◖ ◆ ATLAS ◗ ▲ blocked · stop refused(?: \d+:\d\d)? ▌/);
    const table = [BLOCKED_TEXT.stop, BLOCKED_TEXT.failed(1), BLOCKED_TEXT.failed(2), BLOCKED_TEXT.failed(3)];
    for (const [, sh] of ALL) for (const b of [93, 56]) {
      const why = /▲ blocked(?: · ([^▌]*?))? *▌/.exec(frameOf(sh, b, 45).band)?.[1]?.replace(/ \d+:\d\d$/, '');
      if (why !== undefined) expect(table, why).toContain(why);
    }
  });
  test('a dispatch that ended failed or killed is counted as failed (`■1`), never as `1 dispatch open`', () => {
    for (const body of [93, 56]) {
      const f = frameOf(STOP, body, 45);
      expect(f.band, `${body}`).toMatch(/■1/);
      expect(f.band, `${body}`).not.toMatch(/dispatch open/);
    }
  });
});

describe('3. the idle state segment is not the plan segment', () => {
  test('idle is 240 with 252 text, the plan 237: the two fills and the ink differ at both widths', () => {
    for (const [cols, screen, body] of SIZES) {
      const f = frameOf(IDLE, body, screen);
      const fills = [...new Set(f.cells.map(bgOf).filter((x): x is string => typeof x === 'string'))];
      const at = fills.indexOf(xtermHex(97)); // the pill, then the state slab, then the plan
      expect(fills[at + 1], `${cols} idle slab`).toBe(xtermHex(240));
      expect(fills[at + 2], `${cols} plan`).toBe(xtermHex(237));
      const word = f.cells.find((c) => String(c.props.children).includes('idle'))!;
      expect(word.props.color, `${cols} ink`).toBe(xtermHex(252));
    }
  });
  test('working -> blocked never passes through one idle frame: a held blocked verdict reads working', () => {
    const base = { cols: 93, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'research', done: 4, total: 5, openWork: 1, openDispatch: 1, todoBlocked: 0, checks: [], ui, bar: true, workers: [] } as unknown as MissionModel;
    const seq = [
      { ...base, busy: true },
      { ...base, busy: false, blocked: true, holdBlocked: true }, // the host stopped; the debounce has not confirmed the verdict yet
      { ...base, busy: false, stopGates: ['1 todo open'], holdBlocked: true },
      { ...base, busy: false, blocked: true, holdBlocked: false },
    ].map((m) => runStateOf(m).kind);
    expect(seq).toEqual(['working', 'working', 'working', 'blocked']);
    expect(seq).not.toContain('idle');
  });
});

describe('4. the TODO HUD', () => {
  const NOW_MS = 1_800_000_000_000;
  const T = (n: number, status: string, owner?: string): TodoItem => ({ id: `t${n}`, content: `T${n} item`, status, ...(owner ? { owner } : {}) }) as unknown as TodoItem;
  const ag = (name: string, state: string, ui_: string, extra: Record<string, unknown> = {}): hud.HudAgent => ({ name, role: 'explorer', state, ui: ui_ as never, model: 'haiku', since: NOW_MS - 5000, startedAt: NOW_MS - 9000, task: `read ${name}.py`, ...extra } as never);
  const rows = (todos: TodoItem[], agents: hud.HudAgent[], cols = 93, maxRows = 30): string[] => hud.hudLines({ todos: ownTodos(todos), agents }, { cols, maxRows, ui, now: NOW_MS }).map((r) => r.map((x) => x.t).join(''));
  test('a folded title counts once: `1/5 · ■1`, never a second `· N done`', () => {
    const todos = [T(1, 'completed'), T(2, 'completed'), T(3, 'in_progress'), T(4, 'pending'), T(5, 'pending')];
    for (const maxRows of [3, 4, 5, 6, 8]) {
      const title = rows(todos, [], 93, maxRows)[0]!;
      expect(title, `${maxRows}`).not.toMatch(/done/);
      expect(title, `${maxRows}`).toMatch(/\d\/5/);
    }
    const stop = frameOf(STOP, 93, 45).hud.find((r) => r.includes('▸ TODO'))!;
    expect(stop).toMatch(/TODO\s+4\/5 · ■1/);
    expect(stop).not.toMatch(/done/);
  });
  test('no `└ explorer-xxxx queued` child once the turn ended or the parent row is terminal; one while the turn is alive', () => {
    const open = [T(1, 'completed'), T(2, 'in_progress'), T(3, 'pending')];
    const queued = ag('explorer-7a37', 'queued', 'queued');
    expect(rows(open, [queued]).filter((r) => r.includes('└')), 'a queued worker, turn alive').toHaveLength(1);
    expect(rows(open, [queued, ag('alpha-explorer', 'working', 'running')]).some((r) => r.includes('└') && r.includes('explorer-7a37 queued')), 'beside a running worker').toBe(true);
    const ended = [queued, ag('alpha-explorer', 'done', 'done'), ag('beta-explorer', 'failed', 'failed')];
    expect(rows(open, ended).filter((r) => r.includes('└')), 'the turn ended').toHaveLength(0);
    expect(rows(open, ended).join('\n')).not.toMatch(/explorer-7a37 queued/);
    const closed = [T(1, 'completed'), T(2, 'completed'), T(3, 'completed')];
    expect(rows(closed, [queued]).filter((r) => r.includes('└')), 'every parent row is terminal').toHaveLength(0);
  });
  test('at 110 columns every row up to 12 shows, with the full width for the titles', () => {
    const title = (n: number): string => `Step ${n} reads the long file name and writes the matching report for the reviewers`;
    const todos = Array.from({ length: 12 }, (_, i) => ({ id: `t${i + 1}`, content: title(i + 1), status: i < 4 ? 'completed' : 'pending' }) as unknown as TodoItem);
    const out = rows(todos, [], 110, 30);
    for (let n = 1; n <= 12; n++) expect(out.some((r) => r.includes(title(n))), `row ${n} shows whole`).toBe(true);
    expect(out.join('\n')).not.toMatch(/\+\d+ more/);
  });
  test('a done title is 245 (secondary), not the dim 240', () => {
    for (const [, screen, body] of SIZES) {
      const f = frameOf(FINISHED, body, screen);
      const done = f.hudSegs.filter((r) => /^[ ▸] ● T\d/.test(r.map((x) => x.t).join('')));
      expect(done.length).toBe(5);
      for (const r of done) expect(r.find((x) => /^T\d /.test(x.t))!.color).toBe(xtermHex(245));
    }
  });
});

describe('5. SUBAGENTS: one frozen schema', () => {
  const header = (f: Frame): string => f.hud.find((r) => /^ {2}AGENT\s+STATE/.test(r))!;
  test('the header and its column positions are identical in every state, at 150 and 110 columns', () => {
    for (const [cols, screen, body] of SIZES) {
      const heads = [RUNNING, FINISHED, IDLE, STOP].map((sh) => header(frameOf(sh, body, screen)));
      expect(new Set(heads.map((h) => h.trimEnd())).size, `${cols}: ${heads.join('|')}`).toBe(1);
      const h = heads[0]!;
      expect(h).toMatch(/^ {2}AGENT {2,}STATE {2,}TIME {2,}CALLS {2,}FN {2,}LAST/);
    }
  });
  test('TIME and CALLS end on one cell in every row; an unknown count reads `-`', () => {
    for (const [name, sh] of ALL.slice(0, 4)) for (const [, screen, body] of SIZES) {
      const f = frameOf(sh, body, screen);
      const h = header(f);
      const timeEnd = h.indexOf('TIME') + 4, callsEnd = h.indexOf('CALLS') + 5;
      const agents = f.hud.filter((r) => /^ {2}\S+-explorer/.test(r));
      expect(agents.length, name).toBe(3);
      for (const r of agents) {
        expect(r.slice(0, timeEnd).split(/\s+/).pop(), `${name} TIME`).toMatch(/^\d+:\d\d$/);
        expect(r.slice(0, callsEnd).split(/\s+/).pop(), `${name} CALLS`).toMatch(/^(\d+|-)$/);
        expect(r, name).not.toMatch(/undefined|NaN/);
      }
    }
  });
  const NOW_MS = 1_800_000_000_000;
  const ag = (name: string, state: string, ui_: string): hud.HudAgent => ({ name, role: 'explorer', state, ui: ui_ as never, model: 'haiku', since: NOW_MS - 5000, startedAt: NOW_MS - 9000, task: `read ${name}.py` }) as never;
  const rows = (agents: hud.HudAgent[]): { text: string[]; segs: Segment[][] } => {
    const plan = ['T1 read alpha.py', 'T2 read beta.py', 'T3 read gamma.py'].map((c, i) => ({ id: `t${i + 1}`, content: c, status: 'in_progress' }) as unknown as TodoItem);
    const segs = hud.hudLines({ todos: ownTodos(plan), agents }, { cols: 110, maxRows: 30, ui, now: NOW_MS });
    return { text: segs.map((r) => r.map((x) => x.t).join('')), segs };
  };
  const order = (text: string[]): string[] => text.map((r) => /^ {2}(\S+-explorer)\s/.exec(r)?.[1]).filter((x): x is string => x !== undefined);
  test('rows keep dispatch order (AgentRow.seq) across renders, however the input is ordered or the states change', () => {
    hud.resetAgentSeq();
    const a = ag('alpha-explorer', 'working', 'running'), b = ag('beta-explorer', 'working', 'running'), c = ag('gamma-explorer', 'working', 'running');
    expect(order(rows([a, b, c]).text)).toEqual(['alpha-explorer', 'beta-explorer', 'gamma-explorer']);
    expect(order(rows([c, b, a]).text)).toEqual(['alpha-explorer', 'beta-explorer', 'gamma-explorer']);
    expect(order(rows([c, ag('beta-explorer', 'done', 'done'), a]).text)).toEqual(['alpha-explorer', 'beta-explorer', 'gamma-explorer']);
    expect(order(rows([ag('gamma-explorer', 'done', 'done'), ag('beta-explorer', 'failed', 'failed'), ag('alpha-explorer', 'done', 'done')]).text)).toEqual(['alpha-explorer', 'beta-explorer', 'gamma-explorer']);
    hud.resetAgentSeq();
  });
  test('state 38: no SUBAGENTS row wears a 236 background band (it read as a stray highlight)', () => {
    hud.resetAgentSeq();
    const { text, segs } = rows([ag('alpha-explorer', 'working', 'running'), ag('beta-explorer', 'working', 'running'), ag('gamma-explorer', 'working', 'running')]);
    const banded = (name: string): boolean => segs[text.findIndex((r) => r.startsWith(`  ${name}-explorer`))]!.some((x) => (x as { bgHex?: string }).bgHex === xtermHex(236));
    expect([banded('alpha'), banded('beta'), banded('gamma')]).toEqual([false, false, false]);
    hud.resetAgentSeq();
  });
});

describe('6. the card and the HUD row flip on the same completion signal', () => {
  test('the task-notification names the worker; the HUD row and the worker list read it done on that render', () => {
    forgetEnded();
    try {
      expect(notifiedEnds('<task-notification><task-id>gamma-explorer</task-id><status>completed</status></task-notification>')).toEqual([{ id: 'gamma-explorer', outcome: 'done' }]);
      expect(notifiedEnds('<task-id>x</task-id><status>killed</status>')).toEqual([{ id: 'x', outcome: 'failed' }]);
      const before = frameOf(RUNNING, 93, 45);
      expect(before.hud.some((r) => /^ {2}gamma-explorer\s+[⠀-⣿] running/.test(r))).toBe(true);
      noteEnded('gamma-explorer', 'done', NOW);
      const after = frameOf(RUNNING, 93, 45);
      expect(after.hud.some((r) => /^ {2}gamma-explorer\s+● done/.test(r)), after.hud.join('\n')).toBe(true);
      expect(after.band).toMatch(/2 running/);
      const live = liveWorkers(snapshotOf(RUNNING), NOW + 1);
      expect(live.find((w) => w.name === 'gamma-explorer')!.state).toBe('done');
    } finally {
      forgetEnded();
    }
  });
  test('a retry that started after the signal is a new run and is not ended by it', () => {
    forgetEnded();
    try {
      noteEnded('gamma-explorer', 'done', NOW - 60_000);
      expect(liveWorkers(snapshotOf(RUNNING), NOW).find((w) => w.name === 'gamma-explorer')!.state).toBe('working');
    } finally {
      forgetEnded();
    }
  });
});

describe('7. one spinner clock', () => {
  test('sharedSpinFrame(now) is a 100 ms beat over the ten braille frames, wrapping, never negative', () => {
    expect(SPINNER_MS).toBe(100);
    expect(sharedSpinFrame(0)).toBe(0);
    expect(sharedSpinFrame(99)).toBe(0);
    expect(sharedSpinFrame(100)).toBe(1);
    expect(sharedSpinFrame(1000)).toBe(0);
    expect(sharedSpinFrame(1_800_000_000_000 + 350)).toBe(Math.floor((1_800_000_000_000 + 350) / 100) % 10);
    for (let t = -500; t < 2500; t += 37) {
      expect(sharedSpinFrame(t)).toBeGreaterThanOrEqual(0);
      expect(sharedSpinFrame(t)).toBeLessThan(10);
    }
  });
  test('the band lead and its running count turn the same braille frame', () => {
    const glyphs = [...frameOf(RUNNING, 150, 45).band.matchAll(/[⠀-⣿]/g)].map((m) => m[0]);
    expect(glyphs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(glyphs).size).toBe(1);
    expect(LEAD_FRAMES).toContain(glyphs[0]);
  });
});
