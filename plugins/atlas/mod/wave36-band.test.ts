// Wave 36 (band slice, critique 35 scored 6.03/10): state colours and geometry, one TODO state for failed rows, the blocked debounce, and SUBAGENTS as a full-width table in every state.
// The harness renders the whole slot (slot.ts composeSlot) at the live widths (150 and 110 columns with the side pane docked: 93 and 56 cells of body).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { PALETTES, xtermHex, type Ui } from './atlas-ui';
import { BAND_BUTTONS, bandRuns, bandTree, hudPhases, type BandModel } from './band';
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
// Wave 36: the pill is its own darker fill (97), then the state slab: working 141, done 114, idle 240, blocked 203.
const STATES: [string, Shape, string, string, boolean][] = [
  ['working', RUNNING, 'accent', '[⠀-⣿] working 0:42', true],
  ['done', FINISHED, 'ok', '● done 1:12', false],
  ['idle', IDLE, 'muted', '○ idle · 1:12', false],
  ['blocked', STOP, 'bad', '▲ blocked', true],
];
const fill = (token: 'accent' | 'ok' | 'muted' | 'bad'): string => (token === 'muted' ? xtermHex(236) : PALETTES.mocha[token]);


const SUB = (key: string): unknown => (runstate as unknown as Record<string, unknown>)[key];
const warn = PALETTES.mocha.warn;
const ok = PALETTES.mocha.ok;
const bad = PALETTES.mocha.bad;
const sub = xtermHex(245);
const GATES = [{ id: 'g', title: 'Gates', lines: [{ id: 'a', label: 'A', ok: true }, { id: 'b', label: 'B', ok: false }] }];

describe('1. state colours: 179 is the gates chip only', () => {
  test('done and idle never fill the slab amber 179 (28d53608 painted both 179: stateFillToken returned warn)', () => {
    for (const [name, sh] of [['done', FINISHED], ['idle', IDLE]] as const) {
      const fills = bandRuns(frameOf({ ...sh, gates: GATES }, 93, 45).model).map((x) => x.bgHex); // a failing gate on a quiet band is what turned the slab amber
      expect(fills, name).not.toContain(warn);
    }
  });
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: working 141, done 114, idle 240, blocked 203 are the state slab; no state fill is the amber 179`, () => {
      const want: [string, Shape, string][] = [['working', RUNNING, PALETTES.mocha.accent], ['done', FINISHED, ok], ['idle', IDLE, xtermHex(240)], ['blocked', STOP, bad]];
      for (const [name, sh, hex] of want) {
        const runs = bandRuns(frameOf(sh, body, screen).model);
        const fills = [...new Set(runs.map((x) => x.bgHex).filter((h): h is string => h !== undefined))];
        expect(fills, `${name}: no amber fill anywhere on the bar`).not.toContain(warn);
        expect(fills[1], `${name}: the slab after the pill`).toBe(hex);
      }
    });
    test(`${cols} columns: done reads a bold dark \`● done 1:12\` on the 114 slab; idle a 245 \`○ idle · 1:12\` on the 236 slab`, () => {
      const done = bandRuns(frameOf(FINISHED, body, screen).model);
      const word = done.find((x) => x.t.includes('done') && x.bgHex === ok)!;
      expect(word.bold, 'done is bold').toBe(true);
      expect(word.tone, 'done is dark ink').toBe('ink');
      expect(done.filter((x) => x.bgHex === ok).map((x) => x.t).join('')).toMatch(/^ ?● done 1:12 ?$/);
      const idle = bandRuns(frameOf(IDLE, body, screen).model);
      expect(idle.filter((x) => x.bgHex === xtermHex(240)).map((x) => x.t).join('')).toMatch(/^ ?○ idle · 1:12 ?$/);
      expect(idle.find((x) => x.t.includes('idle') && x.bgHex === xtermHex(240))!.tone).toBe('text'); // wave 37: 252 ink on the 240 slab
    });
  }
  test('179 appears as a separate `△ gates` chip in the last segment, on no fill', () => {
    const f = frameOf({ ...FINISHED, gates: GATES }, 93, 45);
    const runs = bandRuns(f.model);
    const amber = runs.filter((x) => x.tone === 'warn');
    expect(amber.length).toBeGreaterThan(0);
    expect(amber.map((x) => x.t).join('')).toMatch(/gates \d\/\d/);
    expect(runs.some((x) => x.bgHex === warn)).toBe(false);
    expect(f.band).toMatch(/△ gates \d\/\d/);
  });
});

describe('2. geometry: a dark pill, block-element tapers, a bar as wide as the body', () => {
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: the pill is the dark 97 fill, every seam is a ▌ taper (fg = left fill, bg = right fill), no private-use glyph, the last fill reaches the last cell`, () => {
      for (const sh of [RUNNING, FINISHED, IDLE, STOP]) {
        const runs = bandRuns(frameOf(sh, body, screen).model);
        const pill = runs.find((x) => x.t.includes('◆'))!;
        expect(pill.bgHex).toBe(xtermHex(97));
        runs.forEach((x, i) => {
          if (x.t !== '▌') return;
          const left = runs.slice(0, i).reverse().find((y) => y.bgHex !== undefined)?.bgHex;
          const right = runs.slice(i + 1).find((y) => y.bgHex !== undefined)?.bgHex;
          expect([x.fg, x.bgHex]).toEqual([left, right]);
        });
        expect(runs.map((x) => x.t).join('')).not.toMatch(PUA);
        expect(runs.reduce((n, x) => n + [...x.t].length, 0)).toBe(body);
        expect(runs.at(-1)!.bgHex).toBeDefined();
      }
    });
  }
});

describe('3. blocked is debounced: only on the host Stop event, or after two consecutive idle renders', () => {
  const step = SUB('stepBlocked') as ((streak: number, computed: boolean, hostActive: boolean, stopEvent: boolean) => { streak: number; allow: boolean }) | undefined;
  test('stepBlocked exists and never allows blocked while the host works', () => {
    expect(typeof step).toBe('function');
    let s = 0;
    for (let i = 0; i < 6; i++) {
      const r = step!(s, true, true, false);
      expect(r.allow, `render ${i}`).toBe(false);
      s = r.streak;
    }
  });
  test('two consecutive host-idle renders that compute blocked allow it; one does not; a clean render resets the count', () => {
    const a = step!(0, true, false, false);
    expect(a.allow).toBe(false);
    expect(step!(a.streak, true, false, false).allow).toBe(true);
    const reset = step!(a.streak, false, false, false);
    expect(reset).toEqual({ streak: 0, allow: false });
    expect(step!(reset.streak, true, false, false).allow).toBe(false);
  });
  test('the host Stop event allows blocked at once, even while the turn is still marked active', () => {
    expect(step!(0, true, true, true).allow).toBe(true);
    expect(step!(0, false, false, true).allow).toBe(false);
  });
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: a band told blockedConfirmed=false does not read blocked; unconfirmed callers still do`, () => {
      const f = frameOf(STOP, body, screen);
      expect(f.band).toMatch(/blocked/);
      const held = rowsOf(bandTree(els, { ...f.model, blockedConfirmed: false } as BandModel, handlers) as unknown as Node)[0]!;
      expect(held).not.toMatch(/blocked/);
    });
  }
});

describe('4. the TODO HUD: one state per failed row, one count, one anchored child', () => {
  const titleSegs = (f: Frame): Segment[] => f.hudSegs[f.hud.findIndex((r) => r.includes('▸ TODO'))]!;
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: the stop run reads \`4/5 · ■1\`; the meter is 114 cells for the done rows plus one 203 cell per failed row`, () => {
      const f = frameOf(STOP, body, screen);
      const title = f.hud.find((r) => r.includes('▸ TODO'))!;
      expect(title).toMatch(/TODO\s+4\/5 · ■1/);
      const cellsOf = titleSegs(f).filter((x) => /^[▰▱]+$/.test(x.t));
      expect(cellsOf.some((x) => x.t.includes('▰') && x.color === ok), 'done cells in 114').toBe(true);
      expect(cellsOf.filter((x) => x.color === bad).map((x) => x.t).join('')).toBe('▰');
    });
    test(`${cols} columns: the band count is the title count, and a failed row is \`■\` in 203, never a green \`●\``, () => {
      const f = frameOf(STOP, body, screen);
      expect(f.band).toMatch(/(todo )?4\/5 ■1/);
      const at = f.hud.findIndex((r) => /^[ ▸] [■●◇◐◓◑◒] T3/.test(r));
      expect(f.hud[at]).toMatch(/^[ ▸] ■ T3/);
      expect(f.hudSegs[at]!.find((x) => x.t === '■')?.color).toBe(bad);
      expect(f.hud.filter((x) => /^[ ▸] ● T3/.test(x)), 'T3 is never a green disc').toHaveLength(0);
      expect(f.hud.filter((x) => /^[ ▸] ● T\d/.test(x)).map((x) => /T(\d)/.exec(x)![1]), 'the green discs are the completed rows').toEqual(['1', '2', '4', '5']);
    });
    test(`${cols} columns: a row the lead owns shows \`lead\` in 245 where an agent's name would be`, () => {
      const lead: Shape = { ...RUNNING, plan: ['in_progress', 'in_progress', 'in_progress', 'in_progress', 'pending'] };
      const f = frameOf(lead, body, screen);
      const at = f.hud.findIndex((r) => /T4 /.test(r));
      expect(f.hud[at]).toMatch(/\blead\b/);
      expect(f.hudSegs[at]!.find((x) => x.t.trim() === 'lead')?.color).toBe(sub);
    });
  }
  const NOW_MS = 1_800_000_000_000;
  const plan = (): TodoItem[] => PLAN.map((c, i) => ({ id: `t${i + 1}`, content: c, status: i < 2 ? 'completed' : 'pending', ...(i < 2 ? { owner: NAMES[i]! } : {}) }) as unknown as TodoItem);
  const ag = (state: string, ui_: string): hud.HudAgent => ({ name: 'explorer-7a37', role: 'explorer', state, ui: ui_ as never, model: 'haiku', since: NOW_MS - 5000, task: 'read delta.py' } as never);
  const rowsFor = (a: hud.HudAgent): string[] => hud.hudLines({ todos: ownTodos(plan()), agents: [a] }, { cols: 93, maxRows: 18, ui, now: NOW_MS }).map((r) => r.map((x) => x.t).join(''));
  test('state 38: no `└ … queued` child row is ever drawn, whether the worker is to come or dead', () => {
    const queued = rowsFor(ag('queued', 'queued'));
    expect(queued.filter((r) => r.includes('└')), 'a queued worker has no child line').toHaveLength(0);
    expect(queued.join('\n')).not.toMatch(/explorer-7a37 queued/);
    const dead = rowsFor(ag('failed', 'failed'));
    expect(dead.filter((r) => r.includes('└')), 'a dead worker has none').toHaveLength(0);
    expect(dead.join('\n')).not.toMatch(/explorer-7a37 queued/);
  });
});

describe('5. SUBAGENTS is a full-width table in every state', () => {
  const nameAt = (n: string, body: number): string => (body < 80 && n.length > 12 ? `${n.slice(0, 11)}…` : n); // state 39: at 110 columns AGENT is 12 cells (LAST keeps 14)
  const tableOf = (f: Frame): string[] => { const at = f.hud.findIndex((r) => r.includes('▸ SUBAGENTS')); return f.hud.slice(at); };
  for (const [cols, screen, body] of SIZES) {
    test(`${cols} columns: running, done and failed all draw a title, bold 245 headers AGENT STATE TIME, one row per agent in dispatch order, a closing rule`, () => {
      for (const sh of [RUNNING, FINISHED, STOP]) {
        const f = frameOf(sh, body, screen);
        const t = tableOf(f);
        expect(t[0]).toMatch(/^╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS /);
        expect(t[1]).toMatch(/^ {2}AGENT\s+STATE\s+TIME\b/);
        expect(t.at(-1)).toMatch(/^╰─+╯$/);
        const h = f.hudSegs[f.hud.indexOf(t[1]!)]!.find((x) => x.t.includes('AGENT'))!;
        expect([h.color, h.bold]).toEqual([sub, true]);
        expect(t.slice(2, -1).map((r) => r.trim().split(/\s+/)[0]!)).toEqual(NAMES.map((n) => nameAt(n, body)));
      }
    });
    test(`${cols} columns: STATE is a 141 spinner and \`running\`, \`● done\` in 114, \`■ failed\` in 203; TIME is a clock; no row is a bare list of times`, () => {
      const run = frameOf(RUNNING, body, screen);
      const rr = run.hud.findIndex((r) => r.startsWith(`  ${nameAt('alpha-explorer', body)}`) && /\s[⠀-⣿] running\s+\d+:\d\d/.test(r));
      expect(rr).toBeGreaterThan(0);
      expect(run.hudSegs[rr]!.find((x) => BRAILLE.test(x.t) && x.t.trim().length === 1)?.color).toBe(PALETTES.mocha.accent);
      const stop = frameOf(STOP, body, screen);
      const ds = stop.hud.findIndex((r) => r.startsWith(`  ${nameAt('alpha-explorer', body)}`) && /\s● done/.test(r));
      expect(stop.hudSegs[ds]!.find((x) => x.t === '●')?.color).toBe(ok);
      const fs = stop.hud.findIndex((r) => r.startsWith(`  ${nameAt('gamma-explorer', body)}`) && /\s■ failed/.test(r));
      expect(stop.hudSegs[fs]!.find((x) => x.t === '■')?.color).toBe(bad);
      for (const f of [run, stop, frameOf(FINISHED, body, screen)]) for (const r of f.hud) expect(r, 'never a bare list of clocks').not.toMatch(/^[\s│]*(?:\d+:\d\d\s+)+\d+:\d\d\s*$/);
    });
  }
  test('TIME is a right-aligned column and the frozen header always carries FN (`-` for an unknown count)', () => {
    const f = frameOf(RUNNING, 93, 45);
    const head = f.hud.find((r) => /^ {2}AGENT\s+STATE\s+TIME/.test(r))!;
    expect(head).toMatch(/AGENT {2,}STATE {2,}TIME {2,}CALLS {2,}FN {2,}LAST/); // wave 37: one header in every state and width
    const rows = f.hud.filter((r) => /^ {2}\S+-explorer\s+[⠀-⣿] running/.test(r));
    expect(rows).toHaveLength(3);
    const ends = rows.map((r) => /\d+:\d\d/.exec(r)!).map((m) => m.index + m[0].length);
    expect(new Set(ends).size, 'the TIME column ends on one cell').toBe(1);
  });
  test('maxRows is respected: a short slot counts what it cannot draw on one summary row (`⠧ N more running`)', () => {
    const ags = ['a', 'b', 'c', 'd', 'e'].map((n, i) => ({ name: `${n}-explorer`, role: 'explorer', state: 'working', ui: 'running', model: 'haiku', startedAt: 5_000_000 - 9000 - i, since: 5_000_000 - 3000, tool: 'Read', target: 'x.py', lastTool: 'Read', calls: i + 1 }) as never);
    for (const maxRows of [9, 10, 12, 16]) {
      const rows = hud.hudLines({ todos: ownTodos(PLAN.map((c, i) => ({ id: `t${i + 1}`, content: c, status: 'pending' }) as unknown as TodoItem)), agents: ags }, { cols: 93, maxRows, ui, now: 5_000_000 }).map((r) => r.map((x) => x.t).join(''));
      expect(rows.length, `${maxRows}`).toBeLessThanOrEqual(maxRows);
      const shown = rows.filter((r) => /^ {2}\S+-explorer\s+[⠀-⣿] running/.test(r)).length;
      const more = Number(rows.map((r) => /^ {2}\S+ (\d+) more running/.exec(r)).find((m) => m)?.[1] ?? 0);
      expect(shown + more, `${maxRows}: every agent is a row or counted`).toBe(5);
    }
  });
});

describe('6. the strip tab reads `status`, the key stays `r`', () => {
  test('the first band button', () => {
    expect(BAND_BUTTONS[0]).toMatchObject({ id: 'route', key: 'r', label: 'status' });
    expect(BAND_BUTTONS.map((b) => b.key).join('')).toBe('rtcgko');
  });
});
