// One frame, every surface: the Claude Code band, HUD TODO tree, HUD Subagents block, Board and the side panel tabs (route, team, channel,
// gates, core) through their real adapters, and the omp mission panel, HUD painter, Board and panel painter, all fed from ONE world
// (contracts/band-world.ts via contracts/world-live.ts). Each surface's text is parsed back to facts (counts, phase rail, gate set, a state
// word per worker and per item) and every fact is compared with what the world says. A surface that counts from another source, lights
// another phase, lists another gate or names another state fails here. The `seeded faults` block proves it: change one surface's source
// and the check reports that surface.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { world } from '../contracts/band-world';
import { worldItems, worldOwnerStates } from '../contracts/board-golden';
import { panelWorld } from '../contracts/panel-world';
import { worldGates, worldOmp, worldSidebar, worldSnapshot, worldTodos } from '../contracts/world-live';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { stateRun, type Ui, type UiState } from './atlas-ui';
import { bandTree, hudPhases } from './band';
import { coreModel } from './data/core';
import { liveWorkers, queuedMembers, workerStates, withOwnerStates } from './data/live';
import { hudAgents, hudLines } from './hud';
import { panelModelOf } from './pane/sidebar-model';
import { panelText, type PanelTab } from './panel-layout';
import { boardTree } from './todo-panel';
import type { LiveSnapshot } from './orchestra-types';

// The omp painters are loaded at run time: omp/ is checked by Bun's own types, not by the mod type program, so a static import would pull it in.
const ompAt = '../omp/';
const ompLoad = (m: string): Promise<any> => import(ompAt + m);
const { hudText: ompHudText } = await ompLoad('hud-paint');
const { paintPanel } = await ompLoad('panel-view');
const { boardLines: ompBoard } = await ompLoad('todo-panel');
const { renderPanel } = await ompLoad('mission-panel');

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const STATES: readonly UiState[] = ['queued', 'running', 'done', 'failed', 'blocked', 'waiting'];
const GLYPH = new Map<string, UiState>([...STATES.map((s): [string, UiState] => [stateRun(s, ui, 0).t, s]), ...['◐', '◓', '◑', '◒'].map((g): [string, UiState] => [g, 'running'])]);
const G = '[◐◓◑◒◇●■▲◉]';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const nodeText = (n: Node): string => (Array.isArray(n.props.children) ? n.props.children.map((k: Node | string) => (typeof k === 'string' ? k : nodeText(k))).join('') : String(n.props.children ?? ''));
const rowsOfTree = (tree: unknown): string[] => ((tree as Node).props.children as Node[]).map((r) => nodeText(r).trimEnd());
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();

/** What one surface says. Absent keys are things the surface does not state. */
type Facts = {
  todo?: [number, number];
  blocked?: number;
  phase?: string;
  rail?: { ids: string[]; lit: number };
  gates?: Record<string, boolean>;
  gatesGreen?: string;
  /** Agent counts by state word, as the surface prints them. */
  agents?: Partial<Record<UiState, number>>;
  /** A state word per worker. */
  workers?: Record<string, UiState>;
  /** A state word per plan item, by label. */
  items?: Record<string, UiState>;
  /** The channel header's people and unread counts. */
  channel?: { people: number; unread: number };
  /** The task ids each worker row lists (`T1,T2`), by worker name. */
  tasks?: Record<string, string>;
};

// ---- parsers --------------------------------------------------------------------------------------------------------

const counts = (text: string): Partial<Record<UiState, number>> => {
  const out: Partial<Record<UiState, number>> = {};
  for (const m of text.matchAll(/(\d+) (queued|running|done|failed|blocked|waiting)\b/g)) out[m[2] as UiState] = Number(m[1]);
  return out;
};
const todoOf = (text: string): [number, number] | undefined => {
  const m = /(\d+)(?: of |\/)(\d+)/.exec(text); // the band reads `4/5`, the HUD and the route tab `4 of 5`
  return m ? [Number(m[1]), Number(m[2])] : undefined;
};
/** `● lint  ■ doctor`: glyph and name pairs for the world's gates; the glyph says ok or not. */
const GATE_NAMES = world.gates.map((g) => g.name).join('|');
const gatePairs = (text: string): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const m of text.matchAll(new RegExp(`([●■]) (${GATE_NAMES})\\b`, 'g'))) out[m[2]!] = m[1] === '●';
  return out;
};
/** Rows `glyph name  word`: the glyph must agree with the word. */
function stateRows(rows: readonly string[], rowRe: RegExp): Record<string, UiState> {
  const out: Record<string, UiState> = {};
  for (const row of rows) {
    const m = rowRe.exec(row);
    if (!m) continue;
    const word = m[3] as UiState | undefined;
    const glyph = GLYPH.get(m[1]!)!;
    if (word) expect(glyph).toBe(word); // the glyph and the word of one row agree
    out[m[2]!.trim()] = word ?? glyph;
  }
  return out;
}
const railOf = (text: string): Facts['rail'] => {
  const ids: string[] = [];
  let lit = -1;
  for (const m of text.matchAll(/([●▸◇]) (\d) (\w+)/g)) {
    if (m[1] === '▸') lit = ids.length;
    ids.push(m[3]!);
  }
  return ids.length ? { ids, lit } : undefined;
};

// ---- the surfaces ---------------------------------------------------------------------------------------------------

type Inputs = { band: LiveSnapshot; hud: LiveSnapshot; board: LiveSnapshot; panel: LiveSnapshot };

function ccBand(s: LiveSnapshot): Facts {
  const rows = rowsOfTree(bandTree(els, { snapshot: s, live: liveWorkers(s, s.now), gates: worldGates(), columns: 120, tick: 0, maxRows: 12, ui }));
  const head = rows[0]!;
  return {
    todo: todoOf(head), blocked: Number(/(\d+) blocked/.exec(head)?.[1] ?? 0), phase: /phase (\d+\/\d+)/.exec(head)?.[1],
    agents: counts(head.slice(head.indexOf('agents'))), gates: gatePairs(rows.find((r) => r.includes('checks')) ?? ''),
    workers: stateRows(rows.slice(1), new RegExp(`^ (${G}) (\\S+)`)),
  };
}
function ompBand(): Facts {
  const rows = renderPanel(worldOmp(120)).map(strip);
  const head = rows[0]!;
  return {
    todo: todoOf(head), blocked: Number(/(\d+) blocked/.exec(head)?.[1] ?? 0), phase: /phase (\d+\/\d+)/.exec(head)?.[1],
    agents: counts(head.slice(head.indexOf('agents'))), gates: gatePairs(rows.find((r: string) => r.includes('checks')) ?? ''),
    workers: stateRows(rows.slice(1), new RegExp(`^ (${G}) (\\S+)`)),
  };
}
function richRail(rows: readonly string[]): Facts { return { rail: railOf(rows.join('\n')) }; }

function hudFacts(s: LiveSnapshot, host: 'cc' | 'omp', rich = false): Facts {
  const live = liveWorkers(s, s.now);
  const input = { todos: s.todos, agents: hudAgents(live, s.squad, queuedMembers(s)), root: s.root, phases: hudPhases(s) };
  const opts = { cols: 120, maxRows: 60, ui, now: s.now, rich };
  const rows = host === 'cc' ? hudLines(input, opts).map((r) => r.map((x) => x.t).join('').trimEnd()) : ompHudText(input, opts);
  const at = rows.findIndex((r: string) => r.includes('SUBAGENTS'));
  const todoRows = rows.slice(0, at);
  return {
    todo: todoOf(rows[0]!), agents: counts(rows[at]!), rail: railOf(todoRows.join('\n')),
    items: stateRows(todoRows, new RegExp(`^[▸ ] (${G}) (.+?)\\s{2,}(queued|running|done|failed|blocked|waiting)\\b`)),
    workers: stateRows(rows.slice(at + 1), new RegExp(`^[▸ ] (${G}) (\\S+)\\s+(queued|running|done|failed|blocked|waiting)\\b`)),
    ...(rich ? {} : { tasks: Object.fromEntries(rows.slice(at + 1).flatMap((r: string) => { const m = new RegExp(`^[▸ ] ${G} (\\S+)\\s+.*?\\s((?:T\\d+,?)+)(?:\\s|$)`).exec(r); return m ? [[m[1]!, m[2]!]] : []; })) }),
  };
}

function boardFacts(s: LiveSnapshot, host: 'cc' | 'omp'): Facts {
  const rows = host === 'cc'
    ? rowsOfTree(boardTree(els, withOwnerStates(s.todos, workerStates(s, liveWorkers(s, s.now))), { cols: 120, rows: 40, tick: 0, now: Math.floor(s.now / 1000), ui }))
    : ompBoard(worldItems() as never, { width: 120, tick: 0, now: Math.floor(s.now / 1000), ui }).map(strip);
  return {
    todo: [rows.filter((r: string) => /\bdone\b/.test(r) && new RegExp(`^[▸ ] ${G}`).test(r)).length, Number(/(\d+) items/.exec(rows[0]!)?.[1])],
    items: stateRows(rows, new RegExp(`^[▸ ] (${G}) (.+?)\\s{2,}(queued|running|done|failed|blocked|waiting)\\b`)),
  };
}

function panelFacts(host: 'cc' | 'omp', tab: PanelTab, s: LiveSnapshot): Facts {
  const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: worldTodos() as never, header: { ok: 3, total: 4 }, openGates: world.gates.filter((g) => g.state !== 'done').length });
  const rows = host === 'cc'
    ? panelText(panelModelOf({ ...worldSidebar(tab, 80, s), core }, ui, 80))
    : paintPanel(panelWorld(tab, 80, ui, { core })).map(strip);
  const text = rows.join('\n');
  const f: Facts = {};
  if (tab === 'route') {
    f.phase = /phase\s+\S+\s+(\d+) of (\d+)/.exec(text)?.slice(1, 3).join('/');
    f.todo = todoOf(/^todo .*$/m.exec(text)?.[0] ?? '');
    f.gates = gatePairs(/^gates .*$/m.exec(text)?.[0] ?? '');
    f.gatesGreen = /(\d+) of (\d+) green\s*$/m.exec(/^gates .*$/m.exec(text)?.[0] ?? '')?.slice(1, 3).join('/');
    f.agents = counts(/^agents .*$/m.exec(text)?.[0] ?? '');
    f.items = stateRows(rows, new RegExp(`^ {2}(${G}) (.+?)\\s{2,}(queued|running|done|failed|blocked|waiting)\\b`));
  }
  if (tab === 'team') f.workers = stateRows(rows.filter((r: string) => !/^ {2}◉ lead\b/.test(r)), new RegExp(`^[▸ ] ?(${G}) (\\S+)\\s+(queued|running|done|failed|blocked|waiting)\\b`));
  if (tab === 'channel') { const m = /^#\S+\s+(\d+) people(?: · (\d+) unread)?/m.exec(text); if (m) f.channel = { people: Number(m[1]), unread: Number(m[2] ?? 0) }; }
  if (tab === 'gates') {
    f.gates = gatePairs(text);
    f.gatesGreen = /(\d+) of (\d+) green/.exec(text)?.slice(1, 3).join('/');
  }
  // the core tab's evidence figure is `n/m` over the plan (critique 10 B4): only its m is the plan total; its n counts evidence, not done rows, so the done count is the world's own
  if (tab === 'core') f.todo = [done, Number(/evidence\s+\d+\/(\d+)/.exec(text)?.[1])];
  return f;
}

// ---- what the world says --------------------------------------------------------------------------------------------

const done = world.todos.filter((t) => t.state === 'done').length;
const failing = world.gates.filter((g) => g.state !== 'done').length;
const expected = {
  todo: [done, world.todos.length] as [number, number],
  blocked: world.todos.filter((t) => t.state === 'blocked').length,
  phase: `${world.phases.findIndex((p) => p.state === 'active') + 1}/${world.phases.length}`,
  rail: { ids: world.phases.map((p) => p.id as string), lit: world.phases.findIndex((p) => p.state === 'active') },
  gates: Object.fromEntries(world.gates.map((g) => [g.name, g.state === 'done'])),
  gatesGreen: `${world.gates.length - failing}/${world.gates.length}`,
  workers: Object.fromEntries(world.workers.map((w) => [w.name, w.state as UiState])),
  items: Object.fromEntries(world.todos.map((t) => [t.label, t.state as UiState])),
  // The channel header, from the world's notes and workers (the rule of mod/pane/sidebar-model.ts: whoever spoke plus every worker not finished; notes after the lead last spoke).
  channel: { people: new Set([...world.notes.map((n) => n.from), ...world.workers.filter((w) => w.state !== 'done').map((w) => w.name)]).size, unread: world.notes.length - 1 - world.notes.map((n) => 'lead' in n).lastIndexOf(true) },
  // Every plan row an owner holds, as `T1,T2` (1-based plan positions).
  tasks: Object.fromEntries(world.workers.flatMap((w) => { const ids = world.todos.flatMap((t, i) => (t.owner === w.name ? [`T${i + 1}`] : [])); return ids.length ? [[w.name, ids.join(',')]] : []; })),
  agentCount: (s: UiState): number => world.workers.filter((w) => w.state === s).length,
};

/** Every comparison one surface's facts owe the world; the strings name what differed. */
function owed(name: string, f: Facts, o: { attention?: boolean } = {}): string[] {
  const bad: string[] = [];
  const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  const same = (what: string, got: unknown, want: unknown): void => { if (canon(got) !== canon(want)) bad.push(`${name}: ${what} ${canon(got)} != ${canon(want)}`); };
  if (f.todo) same('todo', f.todo, expected.todo);
  if (f.blocked !== undefined) same('blocked tasks', f.blocked, expected.blocked);
  if (f.phase !== undefined) same('phase', f.phase, expected.phase);
  if (f.rail) same('rail', f.rail, expected.rail);
  if (f.gates) same('gates', f.gates, expected.gates);
  if (f.gatesGreen) same('gates green', f.gatesGreen, expected.gatesGreen);
  if (f.workers) same('workers', f.workers, expected.workers);
  if (f.items) same('items', f.items, expected.items);
  if (f.channel) same('channel header', f.channel, expected.channel);
  if (f.tasks) same('task ids', f.tasks, expected.tasks);
  if (f.agents) {
    for (const s of STATES) if (f.agents[s] !== undefined || (s !== 'done' && expected.agentCount(s) > 0 && (o.attention || name.includes('panel') || name.includes('hud')))) {
      // the band counts agents that are not finished; the HUD ribbon and the panel count every state
      if (s === 'done' && o.attention) continue;
      same(`agents ${s}`, f.agents[s] ?? 0, s === 'blocked' ? 0 : expected.agentCount(s));
    }
  }
  return bad;
}

/** Render every surface and list every disagreement with the world. `over` swaps one surface's snapshot (the seeded faults). */
function check(over: Partial<Inputs> = {}): string[] {
  const w = worldSnapshot();
  const inp: Inputs = { band: w, hud: w, board: w, panel: w, ...over };
  const bad: string[] = [];
  bad.push(...owed('cc band', ccBand(inp.band), { attention: true }));
  bad.push(...owed('omp band', ompBand(), { attention: true }));
  bad.push(...owed('cc hud', hudFacts(inp.hud, 'cc')));
  bad.push(...owed('omp hud', hudFacts(inp.hud, 'omp')));
  bad.push(...owed('cc hud rich', richRail(hudLines({ todos: inp.hud.todos, agents: hudAgents(liveWorkers(inp.hud, inp.hud.now), inp.hud.squad, queuedMembers(inp.hud)), root: inp.hud.root, phases: hudPhases(inp.hud) }, { cols: 120, maxRows: 60, ui, now: inp.hud.now, rich: true }).map((r) => r.map((x) => x.t).join(''))) ));
  bad.push(...owed('cc board', boardFacts(inp.board, 'cc')));
  bad.push(...owed('omp board', boardFacts(inp.board, 'omp')));
  for (const tab of ['route', 'team', 'channel', 'gates', 'core'] as const) {
    bad.push(...owed(`cc panel ${tab}`, panelFacts('cc', tab, inp.panel)));
    bad.push(...owed(`omp panel ${tab}`, panelFacts('omp', tab, inp.panel)));
  }
  return bad;
}

// ---- tests ----------------------------------------------------------------------------------------------------------

describe('one world, every surface', () => {
  test('the world says what the test expects (3 of 7 done, 1 blocked, phase 2/4, 2 of 3 gates green, five workers)', () => {
    expect(expected.todo).toEqual([3, 7]);
    expect(expected.blocked).toBe(1);
    expect(expected.phase).toBe('2/4');
    expect(expected.gatesGreen).toBe('2/3');
    expect(Object.values(expected.workers).sort()).toEqual(['done', 'done', 'failed', 'queued', 'running']);
  });

  test('the band, HUD TODO, HUD Subagents, Board and every panel tab agree with the world on both hosts: counts, rail, gates, states', () => {
    expect(check()).toEqual([]);
  });

  test('the surfaces state what the check reads: every parser found its facts', () => {
    const w = worldSnapshot();
    expect(ccBand(w)).toMatchObject({ todo: [3, 7], blocked: 1, agents: { running: 1, failed: 1, queued: 1 } });
    expect(ccBand(w).phase).toBeUndefined(); // a plan exists: the band states the plan count, not a second clock
    expect(Object.keys(ccBand(w).gates!).sort()).toEqual(['doctor', 'lint', 'test']);
    expect(Object.keys(ccBand(w).workers!)).toHaveLength(5);
    expect(hudFacts(w, 'cc').agents).toEqual({ queued: 1, running: 1, done: 2, failed: 1 });
    expect(Object.keys(hudFacts(w, 'cc').items!)).toHaveLength(7);
    expect(hudFacts(w, 'cc', true).rail).toEqual(expected.rail);
    expect(Object.keys(boardFacts(w, 'cc').items!)).toHaveLength(7);
    expect(panelFacts('cc', 'route', w)).toMatchObject({ phase: '2/4', todo: [3, 7], gatesGreen: '2/3' });
    expect(Object.keys(panelFacts('cc', 'team', w).workers!)).toHaveLength(5);
    expect(panelFacts('cc', 'gates', w).gatesGreen).toBe('2/3');
    expect(panelFacts('cc', 'core', w).todo).toEqual([3, 7]);
  });

  test('both hosts show the same Board, and an item whose owner failed reads failed on both (the owner is a world worker or a person)', () => {
    const owners = worldOwnerStates();
    expect(owners.get('implementer-live')).toBe('failed');
    const w = worldSnapshot();
    const now = Math.floor(w.now / 1000);
    const cc = rowsOfTree(boardTree(els, withOwnerStates(w.todos, workerStates(w, liveWorkers(w, w.now))), { cols: 120, rows: 40, tick: 0, now, ui }));
    const omp = ompBoard(worldItems() as never, { width: 120, tick: 0, now, ui }).map(strip);
    expect(cc).toEqual(omp.map((r: string) => r.trimEnd()));
    // T5 `Gate tests` is queued; hand it to the failed worker and both hosts show it failed.
    const handed = { ...w, todos: w.todos.map((t) => (t.id === 'T5' ? { ...t, owner: 'implementer-live' } : t)) };
    const ccF = rowsOfTree(boardTree(els, withOwnerStates(handed.todos, workerStates(handed, liveWorkers(handed, handed.now))), { cols: 120, rows: 40, tick: 0, now, ui }));
    const ompF = ompBoard(worldItems().map((t) => (t.id === 'T5' ? { ...t, owner: 'implementer-live', ownerState: 'failed' } : t)) as never, { width: 120, tick: 0, now, ui }).map(strip);
    expect(ccF.find((r) => r.includes('Gate tests'))).toMatch(/■ Gate tests +failed/);
    expect(ompF.map((r: string) => r.trimEnd())).toEqual(ccF);
  });
});

describe('no invented budget: a running item without an estimate reads `elapsed 00:42` on every surface, with no `of` and no gauge', () => {
  const w = worldSnapshot();
  const noEst = { ...w, todos: w.todos.map(({ estimate_s: _e, ...t }) => t) } as LiveSnapshot;
  const now = Math.floor(w.now / 1000);
  const rowOfT4 = (rows: readonly string[]): string => rows.find((r) => r.includes('Subagents block'))!;
  const surfaces = (rich: boolean): Record<string, string> => {
    const input = { todos: noEst.todos, agents: hudAgents(liveWorkers(noEst, noEst.now), noEst.squad, queuedMembers(noEst)), root: noEst.root, phases: hudPhases(noEst) };
    const opts = { cols: 120, maxRows: 60, ui, now: noEst.now, rich };
    return {
      'cc hud': rowOfT4(hudLines(input, opts).map((r) => r.map((x) => x.t).join('').trimEnd())),
      'omp hud': rowOfT4(ompHudText(input, opts)),
      'cc board': rowOfT4(rowsOfTree(boardTree(els, withOwnerStates(noEst.todos, workerStates(noEst, liveWorkers(noEst, noEst.now))), { cols: 120, rows: 40, tick: 0, now, ui, rich }))),
      'omp board': rowOfT4(ompBoard(worldItems().map(({ estimate_s: _e, ...t }: any) => t) as never, { width: 120, tick: 0, now, ui, rich }).map(strip)),
    };
  };
  for (const rich of [false, true]) {
    test(`rich=${rich}`, () => {
      for (const [name, row] of Object.entries(surfaces(rich))) {
        expect([name, row]).toEqual([name, expect.stringContaining('elapsed 00:42')]);
        expect([name, / of /.test(row)]).toEqual([name, false]);
        expect([name, /[█░▏▎▍▌▋▊▉]/.test(row)]).toEqual([name, false]);
      }
    });
  }
  test('with the item\'s own estimate the same row reads `of 05:00`', () => {
    for (const [name, row] of Object.entries({ cc: rowOfT4(rowsOfTree(boardTree(els, withOwnerStates(w.todos, workerStates(w, liveWorkers(w, w.now))), { cols: 120, rows: 40, tick: 0, now, ui }))) })) expect([name, row]).toEqual([name, expect.stringContaining('elapsed 00:42 of 05:00')]);
  });
});

describe('seeded faults: change one surface\'s source and the check names it', () => {
  const w = worldSnapshot();
  const withTodos = (f: (t: LiveSnapshot['todos']) => LiveSnapshot['todos']): LiveSnapshot => ({ ...w, todos: f(w.todos) });

  test('the band counts from a todo list with one more row done', () => {
    const bad = check({ band: withTodos((t) => t.map((x) => (x.id === 'T7' ? { ...x, status: 'completed' } : x))) });
    expect(bad.some((b) => b.startsWith('cc band: todo'))).toBe(true);
    expect(bad.filter((b) => !b.startsWith('cc band'))).toEqual([]);
  });
  test('the HUD counts from a todo list with one row dropped', () => {
    const bad = check({ hud: withTodos((t) => t.slice(0, 6)) });
    expect(bad.some((b) => b.startsWith('cc hud: todo') || b.startsWith('omp hud: todo'))).toBe(true);
  });
  test('the panel reads a snapshot whose phase moved on', () => {
    const bad = check({ panel: { ...w, phase: 'build' as never } });
    expect(bad.some((b) => b.startsWith('cc panel route: phase'))).toBe(true);
  });
  test('the Board reads a todo list where the running item finished', () => {
    const bad = check({ board: withTodos((t) => t.map((x) => (x.id === 'T4' ? { ...x, status: 'completed' } : x))) });
    expect(bad.some((b) => b.startsWith('cc board: items'))).toBe(true);
    expect(bad.filter((b) => !b.startsWith('cc board'))).toEqual([]);
  });
  test('the panel lists a worker the host never listed as running', () => {
    const squad = w.squad.map((a) => (a.name === 'implementer-gates' ? { ...a, state: 'running' as const } : a));
    const bad = check({ panel: { ...w, squad, activity: { ...w.activity, 'implementer-gates': { ...w.activity['implementer-gates']!, mood: 'working' as const } } } });
    expect(bad.some((b) => b.startsWith('cc panel team: workers'))).toBe(true);
  });
});
