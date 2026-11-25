// One frame, every surface: the Claude Code band, Board and the side panel tabs (route = status, with the plan and the team; channel; core =
// health, with the gates) through their real adapters, and the omp mission panel, TODO tree painter, Board and panel painter, all fed from ONE world
// (contracts/band-world.ts via contracts/world-live.ts). Each surface's text is parsed back to facts (counts, phase rail, gate set, a state
// word per worker and per item) and every fact is compared with what the world says. A surface that counts from another source, lights
// another phase, lists another gate or names another state fails here. The `seeded faults` block proves it: change one surface's source
// and the check reports that surface.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { world } from '../../contracts/band-world';
import { worldItems, worldOwnerStates } from '../../contracts/board-golden';
import { panelWorld } from '../../contracts/panel-world';
import { worldGates, worldOmp, worldSidebar, worldSnapshot, worldTodos } from '../../contracts/world-live';
import { coreFixture, coreMatrix } from '../../contracts/core-fixture';
import { stateRun, type Ui, type UiState } from '../design/atlas-ui';
import { bandTree, hudPhases } from './band/band';
import { coreModel } from '../data/core';
import { liveWorkers, queuedMembers, workerStates, withOwnerStates } from '../data/live';
import { hudAgents } from './hud/hud';
import { panelModelOf } from './panel/pane/sidebar-model';
import { panelText, type PanelTab } from './panel/panel-layout';
import { boardTree } from './board/todo-panel';
import type { LiveSnapshot } from '../orchestra-types';
import { pluginRoot } from '../fixtures/source-tree';

// The omp painters are loaded at run time: omp/ is checked by Bun's own types, not by the mod type program, so a static import would pull it in.
const ompAt = `${pluginRoot()}/omp/`;
const ompLoad = (m: string): Promise<any> => import(ompAt + m);
const { hudText: ompHudText } = await ompLoad('hud-paint');
const { paintPanel } = await ompLoad('panel-view');
const { boardLines: ompBoard } = await ompLoad('todo-panel');
const { renderPanel } = await ompLoad('mission-panel');

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const STATES: readonly UiState[] = ['queued', 'running', 'done', 'failed', 'blocked', 'waiting'];
const GLYPH = new Map<string, UiState>([...STATES.map((s): [string, UiState] => [stateRun(s, ui, 0).t, s]), ...['◐', '◓', '◑', '◒'].map((g): [string, UiState] => [g, 'running'])]);
const G = '[◐◓◑◒○✓✗▲▲◉]';

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
  /** The owner column of each plan row, by item label. */
  owners?: Record<string, string>;
  /** The status tab's `N done` line: the done plan rows and done agents it folds away. */
  folded?: number;
};

// ---- parsers --------------------------------------------------------------------------------------------------------

const counts = (text: string): Partial<Record<UiState, number>> => {
  const out: Partial<Record<UiState, number>> = {};
  for (const m of text.matchAll(/(\d+) (queued|running|done|failed|killed|blocked|waiting)\b/g)) out[(m[2] === 'killed' ? 'failed' : m[2]) as UiState] = Number(m[1]); // wave 30: the side panel says `killed` for the failed state
  return out;
};
const todoOf = (text: string): [number, number] | undefined => {
  const m = /(\d+)(?: of |\/)(\d+)/.exec(text); // the band reads `4/5`, the HUD and the route tab `4 of 5`
  return m ? [Number(m[1]), Number(m[2])] : undefined;
};
/** `✓ lint  ✗ doctor`: glyph and name pairs for the world's gates; the glyph says ok or not. */
const GATE_NAMES = world.gates.map((g) => g.name).join('|');
const gatePairs = (text: string): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const m of text.matchAll(new RegExp(`([✓✗▲△]) (${GATE_NAMES})\\b`, 'g'))) out[m[2]!] = m[1] === '✓'; // a failing check is the warning triangle on the band and the gates tab, the square on the route tab's own row
  return out;
};
/** Rows `glyph name  word`: the glyph must agree with the word. */
function stateRows(rows: readonly string[], rowRe: RegExp): Record<string, UiState> {
  const out: Record<string, UiState> = {};
  for (const row of rows) {
    const m = rowRe.exec(row);
    if (!m) continue;
    const word = (m[3] === 'killed' ? 'failed' : m[3]) as UiState | undefined; // critique 28 and wave 30: the one word for a killed worker is `killed`, the failed state
    const glyph = GLYPH.get(m[1]!)!;
    if (word) expect(glyph === 'blocked' && word === 'failed' ? word : glyph).toBe(word); // the glyph and the word of one row agree (failed and blocked share the red square, the word tells them apart)
    out[m[2]!.trim()] = word ?? (glyph === 'blocked' ? 'failed' : glyph); // a row with no word (the band's worker table): the red square is the failed worker (a worker is never blocked there)
  }
  return out;
}
const railOf = (text: string): Facts['rail'] => {
  const ids: string[] = [];
  let lit = -1;
  for (const m of text.matchAll(/([✓▸○]) (\d) (\w+)/g)) {
    if (m[1] === '▸') lit = ids.length;
    ids.push(m[3]!);
  }
  return ids.length ? { ids, lit } : undefined;
};

// ---- the surfaces ---------------------------------------------------------------------------------------------------

type Inputs = { band: LiveSnapshot; hud: LiveSnapshot; board: LiveSnapshot; panel: LiveSnapshot };

/** The band's agent counts: after the `agents` noun when it is drawn, else the whole row less the todo group's own blocked count (the noun gives way to the state word on a crowded row). */
const bandCounts = (head: string): ReturnType<typeof counts> => {
  const found = counts((head.includes('agents') ? head.slice(head.indexOf('agents')) : head.replace(/▲ \d+ blocked/g, '')).replace(/✓ \d+ done/g, '')); // wave 37: the finished count of the workers segment is not a state count the world is compared on
  const failed = /✗(\d+)/.exec(head); // and the failure rides the plan segment: `todo 3/7 ✗1`
  return failed ? { ...found, failed: Number(failed[1]) } : found;
};

function ccBand(s: LiveSnapshot): Facts {
  const rows = rowsOfTree(bandTree(els, { snapshot: s, live: liveWorkers(s, s.now), gates: worldGates(), columns: 120, tick: 0, maxRows: 12, ui }));
  const head = rows[0]!;
  return {
    todo: todoOf(head), blocked: /(\d+) blocked/.test(head) ? Number(/(\d+) blocked/.exec(head)![1]) : undefined, phase: /phase (\d+\/\d+)/.exec(head)?.[1],
    agents: bandCounts(head), gates: gatePairs(rows.find((r) => r.includes('checks')) ?? ''), // the Claude band lists no workers any more: the status tab's TEAM section does
  };
}
function ompBand(): Facts {
  const rows = renderPanel(worldOmp(120)).map(strip);
  const head = rows[0]!;
  return {
    todo: todoOf(head), blocked: /(\d+) blocked/.test(head) ? Number(/(\d+) blocked/.exec(head)![1]) : undefined, phase: /phase (\d+\/\d+)/.exec(head)?.[1],
    agents: bandCounts(head), gates: gatePairs(rows.find((r: string) => r.includes('checks')) ?? ''), // the band (shared layout) lists no workers on either host
  };
}
function richRail(rows: readonly string[]): Facts { return { rail: railOf(rows.join('\n')) }; }

/** `T1,T2` per owner: the 1-based plan positions of the TODO rows (`glyph item  state  owner`) each owner holds. */
function owned(rows: readonly string[]): Record<string, string> {
  const out: Record<string, string[]> = {};
  let n = 0;
  for (const r of rows) {
    const m = new RegExp(`^[│▌] ${G} .+?\\s{2,}(?:queued|running|done|failed|killed|blocked|waiting)\\s+(\\S+)`).exec(r);
    if (!m) continue;
    n++;
    if (m[1] !== '-' && !/^(you|lead)$/.test(m[1]!) && !/^\d/.test(m[1]!)) (out[m[1]!] ??= []).push(`T${n}`);
  }
  return Object.fromEntries(Object.entries(out).map(([k2, v]) => [k2, v.join(',')]));
}

/** The omp TODO tree and Subagents block (omp/todo-fallback.ts). Claude Code draws neither: its plan and team are the status tab. */
function hudFacts(s: LiveSnapshot, rich = false): Facts {
  const live = liveWorkers(s, s.now);
  const input = { todos: s.todos, agents: hudAgents(live, s.squad, queuedMembers(s)), root: s.root, phases: hudPhases(s) };
  const opts = { cols: 120, maxRows: 60, ui, now: s.now, rich };
  const rows: string[] = ompHudText(input, opts);
  // wave 31: in the one-block shape the agents ride the TODO rows, so the per-worker facts (state, task ids) are read from the two-box shape of the same input
  const two: string[] = ompHudText(input, { ...opts, merge: false });
  const at2 = two.findIndex((r: string) => r.includes('SUBAGENTS'));
  const at = rows.findIndex((r: string) => r.includes('SUBAGENTS'));
  const todoRows = rows.slice(0, at);
  return {
    todo: todoOf(rows[0]!), agents: counts(rows[at]!), rail: railOf(todoRows.join('\n')),
    items: stateRows(two.slice(0, at2), new RegExp(`^[│▌] (${G}) (.+?)\\s{2,}(queued|running|done|failed|killed|blocked|waiting)\\b`)), // wave 32: a done row of the merged block carries no `done` word, so the per-row words are read from the two-box shape of the same input
    workers: stateRows(two.slice(at2 + 1), new RegExp(`^[│▌] (${G}) (\\S+)\\s+(?:\\S+\\s+)?(queued|running|done|failed|killed|blocked|waiting)\\b`)), // the ROLE cell sits between the name and the state word
    // redesign: the SUBAGENTS box has no task column; the plan rows carry their owner, so each worker's task ids are the 1-based positions of the rows it owns
    ...(rich ? {} : { tasks: owned(two.slice(0, at2)) }),
  };
}

function boardFacts(s: LiveSnapshot, host: 'cc' | 'omp'): Facts {
  const rows = host === 'cc'
    ? rowsOfTree(boardTree(els, withOwnerStates(s.todos, workerStates(s, liveWorkers(s, s.now))), { cols: 120, rows: 40, tick: 0, now: Math.floor(s.now / 1000), ui }))
    : ompBoard(worldItems() as never, { width: 120, tick: 0, now: Math.floor(s.now / 1000), ui }).map(strip);
  return {
    todo: [rows.filter((r: string) => /\bdone\b/.test(r) && new RegExp(`^[▸▾ ] ${G}`).test(r)).length, Number(/(\d+) items/.exec(rows[0]!)?.[1])],
    items: stateRows(rows, new RegExp(`^[▸▾ ] (${G}) (.+?)\\s{2,}(queued|running|done|failed|blocked|waiting)\\b`)),
  };
}

/** `gates` is the facts group of the gate rows, which the health tab draws below its health block (the gates tab is gone). */
function panelFacts(host: 'cc' | 'omp', tab: PanelTab | 'gates', s: LiveSnapshot): Facts {
  const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: worldTodos() as never, header: { ok: 3, total: 4 }, openGates: world.gates.filter((g) => g.state !== 'done').length });
  const rows = host === 'cc'
    ? panelText(panelModelOf({ ...worldSidebar(tab === 'gates' ? 'core' : tab, 80, s), core }, ui, 80)) // the gates tab is gone: its rows sit below the health block
    : paintPanel(panelWorld(tab === 'gates' ? 'core' : tab, 80, ui, { core })).map(strip);
  const text = rows.join('\n');
  const f: Facts = {};
  const greenOf = (row: string, gates: Facts['gates']): string | undefined => { const m = /(?:\bok|(\d+) denied)\s*$/.exec(row.trimEnd()); const n = gates ? Object.keys(gates).length : 0; return m && n > 0 ? `${n - Number(m[1] ?? 0)}/${n}` : undefined; };
  if (tab === 'route') {
    // redesign: the status tab draws `PLAN n of m`, one row per item (the glyph is its state; a failed or blocked row adds its word on a second line) and a `TEAM` tally with one row per agent.
    // It carries no gates line and no phase word of its own (the phase is the stepper, the gates are the gates tab), so those facts are read from the tabs that draw them.
    const railAt = rows.findIndex((r: string) => /^ [●◉○✓◐▲]─/.test(r));
    const lit = railAt < 0 ? -1 : [...rows[railAt]!.matchAll(/[●◉○✓◐▲]/g)].findIndex((m) => m[0] === '◉');
    const word = lit < 0 ? undefined : (rows[railAt + 1] ?? '').trim().split(/\s+/)[lit]; // the stepper: the lit node and the name under it
    f.phase = word !== undefined && expected.rail.ids.includes(word) ? `${expected.rail.ids.indexOf(word) + 1}/${expected.rail.ids.length}` : undefined;
    f.todo = todoOf(/^ PLAN .*$/m.exec(text)?.[0] ?? '');
    f.agents = counts(/^ TEAM .*$/m.exec(text)?.[0] ?? '');
    const at = rows.findIndex((r: string) => /^ TEAM /.test(r));
    const ownerRow = new RegExp(`^[▸▾ ] (${G}) (.+?)\\s{2,}\\S`);
    const stateOf = (g: string): UiState => GLYPH.get(g)!;
    f.items = Object.fromEntries(rows.slice(0, at).flatMap((r: string) => { const m = ownerRow.exec(r); return m ? [[m[2]!.trim(), stateOf(m[1]!)]] : []; }));
    f.owners = Object.fromEntries(rows.slice(0, at).flatMap((r: string) => { const m = new RegExp(`^[▸▾ ] ${G} (.+?)\\s{2,}(\\S+)\\s+(?:\\d+:\\d\\d|-)\\s*$`).exec(r); return m ? [[m[1]!.trim(), m[2]!]] : []; }));
    const fold = /^\s+(\d+) done\s*$/m.exec(text);
    f.folded = fold ? Number(fold[1]) : undefined;
    f.workers = Object.fromEntries(rows.slice(at + 1).flatMap((r: string) => { const m = new RegExp(`^[▸▾ ] (${G}) (\\S+)\\s+\\S+\\s`).exec(r); return m ? [[m[2]!, stateOf(m[1]!)]] : []; })); // the glyph is the state (no word column)
  }
  if (tab === 'team') { /* the team view lives in the status tab now */ }
  if (tab === 'channel') { const m = /^ #\S+\s+(\d+) people(?: · (\d+) unread)?/m.exec(text); if (m) f.channel = { people: Number(m[1]), unread: Number(m[2] ?? 0) }; }
  if (tab === 'gates') {
    f.gates = gatePairs(text);
    const tally = /^ GATES .*?✓ (\d+)(?:\s+✗ (\d+))?\s*$/m.exec(text); // the ribbon's figure is the passed and the failed count: `✓ 2   ✗ 1`
    f.gatesGreen = tally ? `${tally[1]}/${Number(tally[1]) + Number(tally[2] ?? 0)}` : undefined;
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
  // The channel header, from the world's notes and workers (the rule of mod/view/panel/pane/sidebar-model.ts: whoever spoke plus every worker not finished; notes after the lead last spoke).
  channel: { people: new Set([...world.notes.map((n) => n.from), ...world.workers.filter((w) => w.state !== 'done').map((w) => w.name)]).size, unread: world.notes.length - 1 - world.notes.map((n) => 'lead' in n).lastIndexOf(true) },
  // Every plan row an owner holds, as `T1,T2` (1-based plan positions).
  tasks: Object.fromEntries(world.workers.flatMap((w) => { const ids = world.todos.flatMap((t, i) => (t.owner === w.name ? [`T${i + 1}`] : [])); return ids.length ? [[w.name, ids.join(',')]] : []; })),
  /** The status tab's open plan rows by owner, and what it folds into `N done`. */
  openOwners: Object.fromEntries(world.todos.filter((t) => t.state !== 'done').map((t) => [t.label, t.owner])),
  folded: done + world.workers.filter((w) => w.state === 'done').length,
  agentCount: (s: UiState): number => world.workers.filter((w) => w.state === s).length,
};

/** Every comparison one surface's facts owe the world; the strings name what differed. */
function owed(name: string, f: Facts, o: { attention?: boolean; openOnly?: boolean } = {}): string[] {
  const bad: string[] = [];
  const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  const same = (what: string, got: unknown, want: unknown): void => { if (canon(got) !== canon(want)) bad.push(`${name}: ${what} ${canon(got)} != ${canon(want)}`); };
  // The status tab hides done rows (one `N done` line stands for them): its plan header still counts the whole plan, its item and team rows are the world's open ones.
  const openOf = (m: Record<string, UiState>): Record<string, UiState> => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 'done'));
  if (f.todo) same('todo', f.todo, expected.todo);
  if (f.blocked !== undefined) same('blocked tasks', f.blocked, expected.blocked);
  if (f.phase !== undefined) same('phase', f.phase, expected.phase);
  if (f.rail) same('rail', f.rail, expected.rail);
  if (f.gates) same('gates', f.gates, expected.gates);
  if (f.gatesGreen) same('gates green', f.gatesGreen, expected.gatesGreen);
  if (f.workers) same('workers', f.workers, o.openOnly ? openOf(expected.workers) : expected.workers);
  if (f.items) same('items', f.items, o.openOnly ? openOf(expected.items) : expected.items);
  if (f.channel) same('channel header', f.channel, expected.channel);
  if (f.tasks) same('task ids', f.tasks, expected.tasks);
  if (f.owners) same('item owners', f.owners, expected.openOwners);
  if (f.folded !== undefined) same('folded done', f.folded, expected.folded);
  if (f.agents) {
    for (const s of STATES) if (!(s === 'queued' && name.includes('hud')) && (f.agents[s] !== undefined || (s !== 'done' && expected.agentCount(s) > 0 && !(o.attention && (s === 'queued' || s === 'blocked')) && (o.attention || name.includes('panel') || name.includes('hud')))) ) { // wave 34: the SUBAGENTS rule counts agents only (a queued dispatch is a child line of the plan); wave 31: the band states at most running and one failure word, so it owes no queued or blocked count
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
  bad.push(...owed('omp hud', hudFacts(inp.hud)));
  bad.push(...owed('cc board', boardFacts(inp.board, 'cc')));
  bad.push(...owed('omp board', boardFacts(inp.board, 'omp')));
  for (const tab of ['route', 'channel', 'gates', 'core'] as const) { // the team view is the status tab's TEAM section
    bad.push(...owed(`cc panel ${tab}`, panelFacts('cc', tab, inp.panel), { openOnly: tab === 'route' }));
    bad.push(...owed(`omp panel ${tab}`, panelFacts('omp', tab, inp.panel), { openOnly: tab === 'route' }));
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

  test('the band, Board, every panel tab and the omp TODO tree agree with the world on both hosts: counts, rail, gates, states', () => {
    expect(check()).toEqual([]);
  });

  test('the surfaces state what the check reads: every parser found its facts', () => {
    const w = worldSnapshot();
    expect(ccBand(w)).toMatchObject({ todo: [3, 7], agents: { running: 1, failed: 1 } }); // wave 31: the band states todo n/m, running and one failure word
    expect(ccBand(w).phase).toBeUndefined(); // a plan exists: the band states the plan count, not a second clock
    expect(Object.keys(ccBand(w).gates!).sort()).toEqual(['doctor', 'lint', 'test']);
    expect(ccBand(w).workers).toBeUndefined(); // the band lists no worker rows on either host
    expect(hudFacts(w).agents).toEqual({ running: 1, done: 2, failed: 1 }); // wave 34: the rule counts agents only, never the queued dispatch
    expect(Object.keys(hudFacts(w).items!)).toHaveLength(7);
    expect(hudFacts(w, true).rail).toEqual(expected.rail);
    expect(Object.keys(boardFacts(w, 'cc').items!)).toHaveLength(7);
    expect(panelFacts('cc', 'route', w)).toMatchObject({ phase: '2/4', todo: [3, 7], agents: { running: 1, queued: 1, failed: 1 }, folded: 5 }); // the status tab has no gates line, the health tab and the band carry the gate facts
    expect(Object.keys(panelFacts('cc', 'route', w).items!)).toHaveLength(4); // the 4 open plan rows
    expect(Object.keys(panelFacts('cc', 'route', w).owners!)).toHaveLength(4);
    expect(Object.keys(panelFacts('cc', 'route', w).workers!)).toHaveLength(3); // the TEAM rows of the status tab: the 2 done agents fold into `N done`
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
    // T5 `Gate tests` is queued (the store holds it pending); hand it to the failed worker and the board reads failed, as the TODO HUD does (wave 35).
    const handed = { ...w, todos: w.todos.map((t) => (t.id === 'T5' ? { ...t, owner: 'implementer-live' } : t)) };
    const ccF = rowsOfTree(boardTree(els, withOwnerStates(handed.todos, workerStates(handed, liveWorkers(handed, handed.now))), { cols: 120, rows: 40, tick: 0, now, ui }));
    const ompF = ompBoard(worldItems().map((t) => (t.id === 'T5' ? { ...t, owner: 'implementer-live', ownerState: 'failed' } : t)) as never, { width: 120, tick: 0, now, ui }).map(strip);
    expect(ccF.find((r) => r.includes('Gate tests'))).toMatch(/✗ Gate tests +failed +implementer-live/);
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
      'cc status': rowOfT4(panelText(panelModelOf(worldSidebar('route', 80, noEst), ui, 80))),
      'omp hud': rowOfT4(ompHudText(input, { ...opts, merge: false })),
      'cc board': rowOfT4(rowsOfTree(boardTree(els, withOwnerStates(noEst.todos, workerStates(noEst, liveWorkers(noEst, noEst.now))), { cols: 120, rows: 40, tick: 0, now, ui, rich }))),
      'omp board': rowOfT4(ompBoard(worldItems().map(({ estimate_s: _e, ...t }: any) => t) as never, { width: 120, tick: 0, now, ui, rich }).map(strip)),
    };
  };
  for (const rich of [false, true]) {
    test(`rich=${rich}`, () => {
      for (const [name, row] of Object.entries(surfaces(rich))) {
        expect([name, row]).toEqual([name, expect.stringContaining(name === 'cc status' || (!rich && name.endsWith('hud')) ? ' 0:42' : 'elapsed 00:42')]); // the TIME cell of the status tab and the HUD is the elapsed time
        expect([name, / of /.test(row)]).toEqual([name, false]);
        expect([name, (!rich && name.endsWith('hud') ? /[█░▏▎▍▋▊▉]/ : /[█░▏▎▍▌▋▊▉]/).test(row)]).toEqual([name, false]); // (the HUD's focus bar is the `▌` at the row start)
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
  test('the omp TODO tree counts from a todo list with one row dropped', () => {
    const bad = check({ hud: withTodos((t) => t.slice(0, 6)) });
    expect(bad.some((b) => b.startsWith('omp hud: todo'))).toBe(true);
    expect(bad.filter((b) => !b.startsWith('omp hud'))).toEqual([]);
  });
  test('the status tab counts from a todo list with one row dropped and one owner changed', () => {
    const bad = check({ panel: withTodos((t) => t.slice(0, 6).map((x) => (x.id === 'T4' ? { ...x, owner: 'runner-land' } : x))) });
    expect(bad.some((b) => b.startsWith('cc panel route: todo'))).toBe(true);
    expect(bad.some((b) => b.startsWith('cc panel route: item owners'))).toBe(true);
    expect(bad.filter((b) => !b.startsWith('cc panel'))).toEqual([]);
  });
  test('the status tab reads a todo list where the running item finished', () => {
    const bad = check({ panel: withTodos((t) => t.map((x) => (x.id === 'T4' ? { ...x, status: 'completed' } : x))) });
    for (const what of ['todo', 'items', 'folded done']) expect([what, bad.some((b) => b.startsWith(`cc panel route: ${what}`))]).toEqual([what, true]);
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
    expect(bad.some((b) => b.startsWith('cc panel route: workers'))).toBe(true);
  });
});
