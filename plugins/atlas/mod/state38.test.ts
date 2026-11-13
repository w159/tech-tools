// State 38: every count, time and state word that the Atlas band, the TODO HUD, the SUBAGENTS table and the transcript cards print comes from one source, so two surfaces never disagree on one frame.
// One test group per step of the slice. The harness renders the whole slot (slot.ts composeSlot) the way wave37-band.test.ts does.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { xtermHex, type Ui } from './atlas-ui';
import { bandTree, hudPhases, type BandModel } from './band';
import type { AtlasSnapshot, SquadAgent, TodoItem } from './contract';
import * as runstate from './data/runstate';
import { liveWorkers, queuedMembers, resetWorkerFacts, workerFacts } from './data/live';
import { clipEvidence, ownTodos } from './data/todos';
import { hudAgents, hudLines, isRunning, outcomeOf, type HudAgent, type HudInput } from './hud';
import { busySnap, NOW } from './live_fixture';
import { blockedText, STOP_REFUSED } from './data/runstate';
import { bandFrame, forgetBandFrame, noteBandFrame } from './motion';
import { KIND_HOLD_MS, newKindHold, stepKind, type KindHold, type KindWord } from './band-motion';
import type { LiveSnapshot } from './orchestra-types';
import { composeSlot } from './slot';
import { notificationTree } from './transcript/cards';
import { verdictOf } from './transcript/leadheader';
import { forgetPlaced, noteRunFinal, placeFinished, placedTree } from './transcript/placed';
import { planWindow } from './hud-surface';
import { runsString } from './atlas-ui';

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

type Agent = { name: string; squad: SquadAgent['state']; mood: string; tool?: string | null; noCalls?: boolean };
type Shape = { agents: Agent[]; plan: ('completed' | 'in_progress' | 'pending')[]; working: boolean; rest?: number; gates?: unknown[]; /** Dispatch rows whose owner is not a worker the host lists. */ dispatch?: { owner: string; status: 'completed' | 'in_progress' | 'pending' }[] };

function snapshotOf(sh: Shape): LiveSnapshot {
  const squad: SquadAgent[] = sh.agents.map((a) => ({ name: a.name, persona: 'explorer', state: a.squad, source: 'task', task: `${a.name}: read ${a.name.split('-')[0]}.py` }) as SquadAgent);
  const act = Object.fromEntries(sh.agents.map((a, i) => [a.name, { tool: a.tool ?? null, since: NOW - 4_000, startedAt: NOW - 14_000 - i * 1000, toolCount: 1, tokens: 100, mood: a.mood, lastLine: '', ...(a.noCalls ? {} : { calls: [NOW - 9_000, NOW - 8_000, NOW - 7_000] }) }]));
  const plan: TodoItem[] = PLAN.slice(0, sh.plan.length).map((c, i) => ({ id: `t${i + 1}`, content: c, status: sh.plan[i] ?? 'pending', ...(sh.agents[i] ? { owner: sh.agents[i]!.name } : {}) }) as TodoItem);
  const dispatch = (sh.dispatch ?? []).map((d, i) => ({ id: `d${i}`, content: `Read ${d.owner}`, status: d.status, owner: d.owner, origin: 'dispatch' }) as unknown as TodoItem);
  const done = sh.plan.filter((s) => s === 'completed').length;
  return busySnap({
    sessionId: 's', phase: (sh.working ? 'research' : 'done') as never, phaseSource: 'header', contextPct: 7, squad, comms: [],
    activity: { lead: { tool: null, since: NOW, toolCount: 1, tokens: null, mood: sh.working ? 'working' : 'idle', lastLine: '' }, ...act } as never,
    todos: [...plan, ...dispatch], counts: { done, total: 5, byPhase: {} }, todoGroups: [],
  });
}

type Frame = { band: string; hud: string[]; hudSegs: { t: string; bgHex?: string }[][]; model: BandModel };
function frameOf(sh: Shape, cols: number, screen: number, extra: Partial<BandModel> = {}): Frame {
  const snapshot = snapshotOf(sh);
  const live = liveWorkers(snapshot, snapshot.now);
  const agents = hudAgents(live, snapshot.squad, queuedMembers(snapshot));
  const hudIn: HudInput = { todos: ownTodos(snapshot.todos ?? [], snapshot.sessionId), agents, root: snapshot.root, phases: hudPhases(snapshot, null) };
  const bandIn = (_hud: unknown, maxRows: number | undefined): BandModel => ({ snapshot, live, gates: (sh.gates ?? []) as never, working: sh.working, workSecs: 42, ranSecs: sh.working ? undefined : 72, ...(sh.rest !== undefined ? { restSecs: sh.rest } : {}), columns: cols, tick: 3, ui, rich: false, workersInHud: true, maxRows, ...extra }) as BandModel;
  const budget = Math.floor(screen / 2) - 4;
  const plan = composeSlot({ budget, hasSlot: true, hudOn: true, runOn: true, columns: cols, hudIn, hudView: { cols, tick: 3, ui, rich: false, now: snapshot.now }, running: agents.some(isRunning), agentsListed: agents.length > 0, orchestrated: true, now: snapshot.now, bandIn: bandIn as never, held: 0 } as never);
  const band = rowsOf(bandTree(els, plan.band, handlers) as unknown as Node)[0]!;
  return { band, hud: plan.hud.map((r) => r.map((x) => x.t).join('')), hudSegs: plan.hud as never, model: plan.band };
}

const RUNNING: Shape = { working: true, agents: NAMES.map((name) => ({ name, squad: 'running', mood: 'working', tool: 'Read' })), plan: ['in_progress', 'in_progress', 'in_progress', 'pending', 'pending'] };
const FINISHED: Shape = { working: false, rest: 2, agents: NAMES.map((name) => ({ name, squad: 'finished', mood: 'done' })), plan: ['completed', 'completed', 'completed', 'completed', 'completed'] };
const STOP: Shape = { ...FINISHED, agents: [FINISHED.agents[0]!, FINISHED.agents[1]!, { name: NAMES[2]!, squad: 'failed', mood: 'failed' }], gates: runstate.stopRefusal([], 'Done claimed too early: 1 open dispatch row.') as unknown as unknown[] };
const titleOf = (hud: readonly string[]): string => hud.find((r) => r.includes('▸ SUBAGENTS')) ?? '';
const countsOf = (s: string): string => [...s.matchAll(/(\d+) (running|blocked|failed|waiting|queued|done)/g)].map((m) => `${m[1]} ${m[2]}`).join(' · ');

describe('step 1: the band worker segment counts workers, from the same function as the SUBAGENTS title', () => {
  test('three running workers and two dispatch rows nobody lists: the band says 3 running, as the SUBAGENTS title does (it read 5)', () => {
    const sh: Shape = { ...RUNNING, dispatch: [{ owner: 'explorer-aaaa', status: 'in_progress' }, { owner: 'explorer-bbbb', status: 'in_progress' }] };
    for (const [cols, screen] of [[93, 45], [56, 40]] as const) {
      const f = frameOf(sh, cols, screen);
      expect(countsOf(titleOf(f.hud)), titleOf(f.hud)).toBe('3 running');
      expect(f.band, f.band).toMatch(/3 running/);
      expect(f.band).not.toMatch(/5 running/);
    }
  });
  test('three finished workers: `3 done` on both, whatever the dispatch rows hold', () => {
    const f = frameOf({ ...FINISHED, dispatch: [{ owner: 'explorer-aaaa', status: 'completed' }] }, 93, 45);
    expect(countsOf(titleOf(f.hud))).toBe('3 done');
    expect(f.band).toMatch(/3 done/);
  });
  test('a killed worker is `1 failed` on the title and `■1` or `1 failed` on the band', () => {
    const f = frameOf(STOP, 93, 45);
    expect(countsOf(titleOf(f.hud))).toBe('1 failed · 2 done');
    expect(f.band).toMatch(/2 done/);
    expect(f.band).toMatch(/■1|1 failed/);
  });
});

describe('step 2: one blocked wording, `stop refused` or `N failed`, on the band and the blocked card', () => {
  test('blockedText is the only builder: two reasons, the clock after it', () => {
    expect(blockedText({ refused: true, failed: 2, secs: 37 })).toBe(`${STOP_REFUSED} 0:37`);
    expect(blockedText({ refused: false, failed: 2, secs: 37 })).toBe('2 failed 0:37');
    expect(blockedText({ refused: false, failed: 0 })).toBe('');
  });
  test('the blocked band reads `▲ blocked · stop refused <clock>` and never `needs you` or `dispatch open`', () => {
    const f = frameOf(STOP, 150, 45);
    expect(f.band).toContain('▲ blocked');
    expect(f.band).toMatch(/stop refused \d+:\d\d/);
    expect(f.band).not.toMatch(/needs you|dispatch(es)? open|retry/);
  });
  test('the transcript blocked card prints the identical string the band does', () => {
    const f = frameOf(STOP, 150, 45);
    const secs = 72;
    const card = verdictOf(1, 1, true, secs)!;
    expect(card.phase).toBe('blocked');
    expect(card.text).toBe(blockedText({ refused: true, failed: 1, secs }));
    expect(f.band).toContain(card.text);
  });
  test('a run that closed with a failure and no refusal reads `N failed` on the card, never `dispatch open`', () => {
    const v = verdictOf(2, 3, false)!;
    expect(v.text).toBe('2 failed · 3 open');
    expect(v.text).not.toMatch(/dispatch/);
  });
  test('a dead dispatch counts as failed mid-run: the band and the title agree on `1 failed`', () => {
    const sh: Shape = { ...RUNNING, agents: [RUNNING.agents[0]!, RUNNING.agents[1]!, { name: NAMES[2]!, squad: 'failed', mood: 'failed' }] };
    const f = frameOf(sh, 93, 45);
    expect(countsOf(titleOf(f.hud))).toContain('1 failed');
    expect(f.band).toMatch(/■1|1 failed/);
  });
});

describe('step 3: no idle flash', () => {
  const run = (seq: [KindWord, number][]): KindWord[] => { let h: KindHold = newKindHold(); return seq.map(([k, t]) => { const r = stepKind(h, k, t); h = r.hold; return r.shown; }); };
  test('working -> idle -> blocked inside the hold never shows idle', () => {
    expect(run([['working', 0], ['working', 100], ['idle', 200], ['idle', 300], ['blocked', 400]])).toEqual(['working', 'working', 'working', 'working', 'blocked']);
  });
  test('idle is shown only once the previous non-idle word is a full second old', () => {
    const shown = run([['working', 0], ['idle', 500], ['idle', KIND_HOLD_MS - 1], ['idle', KIND_HOLD_MS], ['idle', KIND_HOLD_MS + 500]]);
    expect(shown).toEqual(['working', 'working', 'working', 'idle', 'idle']);
  });
  test('done holds the same way, and a band that was idle stays idle', () => {
    expect(run([['done', 0], ['idle', 400]])).toEqual(['done', 'done']);
    expect(run([['idle', 0], ['idle', 100]])).toEqual(['idle', 'idle']);
  });
  test('the band model reads the held word: a computed idle with heldKind working renders `working`', () => {
    const f = frameOf({ ...FINISHED, rest: 60 }, 150, 45, { heldKind: 'working' });
    expect(f.band).toMatch(/working/);
    expect(f.band).not.toMatch(/idle/);
  });
});

const doneSnap = (now: number, state: SquadAgent['state'] = 'finished'): AtlasSnapshot => {
  const squad: SquadAgent[] = [{ name: 'alpha-explorer', persona: 'explorer', state, source: 'task' } as SquadAgent];
  const todos = [{ id: 't1', content: 'T1 read alpha.py', status: 'completed', owner: 'alpha-explorer' }];
  return { root: null, sessionId: 's1', channel: 'c', todos, notes: [], members: [], squad, contextPct: 0, now, contract: { phases: [], todoPhases: [], headerFirstLinePattern: '^ATLAS', itemPhasePrefix: '' }, personas: [], counts: { done: 1, total: 1, byPhase: {} }, phase: 'done', phaseSource: 'default', activity: { 'alpha-explorer': { tool: null, since: now - 2000, startedAt: now - 15_000, toolCount: 3, tokens: null, mood: state === 'finished' ? 'done' : 'working', lastLine: '', calls: [1, 2, 3] } }, comms: [], todoGroups: [] } as unknown as AtlasSnapshot;
};
const engine = (placed: string[]) => ({ ui: { place: async ({ id }: { id: string }) => { placed.push(id); return { isPlaced: true, requestId: id }; }, invalidate: () => undefined } }) as never;
const flat = (tree: unknown): string => { const out: string[] = []; const walk = (n: unknown): void => { if (typeof n === 'string') out.push(n); else if (n && typeof n === 'object') for (const k of (n as { children?: unknown[] }).children ?? []) walk(k); }; walk(tree); return out.join(''); };

describe('step 4: the run card flips with the band and prints the band\'s final clock once', () => {
  test('while the band\'s run is open the run card waits; when the band closes on 0:39 the card is placed on 0:39 and never rewritten', async () => {
    forgetPlaced();
    const ids: string[] = [];
    try {
      noteRunFinal(null); // the band works (its clock is open)
      await placeFinished(engine(ids), doneSnap(NOW - 5000, 'running'), doneSnap(NOW));
      expect(ids.filter((i) => i.startsWith('done-run'))).toEqual([]);
      noteRunFinal(39); // the band flips to done on 0:39
      await placeFinished(engine(ids), doneSnap(NOW), doneSnap(NOW));
      const run = ids.filter((i) => i.startsWith('done-run'));
      expect(run).toHaveLength(1);
      const first = flat(placedTree(run[0]!, ui));
      expect(first).toContain('0:39');
      noteRunFinal(41); // a later figure never rewrites the card
      expect(flat(placedTree(run[0]!, ui))).toBe(first);
      await placeFinished(engine(ids), doneSnap(NOW), doneSnap(NOW));
      expect(ids.filter((i) => i.startsWith('done-run'))).toHaveLength(1);
    } finally { forgetPlaced(); }
  });
});

describe('step 5: workerFacts drives both the SUBAGENTS row and the worker card', () => {
  const rowOf = (f: Frame, name: string): string => f.hud.find((r) => new RegExp(`^ {2}${name}\\s`).test(r)) ?? '';
  test('the table notes its TIME and CALLS cells; the card prints exactly those', () => {
    resetWorkerFacts();
    const f = frameOf(FINISHED, 93, 45);
    const row = rowOf(f, 'alpha-explorer');
    const m = /alpha-explorer\s+● done\s+(\d+:\d\d)\s+(\d+|-)\s/.exec(row);
    expect(m, f.hud.join('\n')).not.toBeNull();
    expect(workerFacts('alpha-explorer')).toEqual({ time: m![1]!, calls: m![2]! });
    const card = flat(notificationTree('alpha-explorer', 'explorer', 'finished · 9:59', false, ui, false, { cols: 70, calls: 9 }));
    expect(card).toContain(`${m![1]!} · ${m![2]!} calls`); // the card's own 9:59 and 9 calls give way to the row's cells
    expect(card).not.toContain('9:59');
  });
  test('a worker whose row cell is `-` has `-` on its card, and only then', () => {
    resetWorkerFacts();
    const sh: Shape = { ...FINISHED, agents: FINISHED.agents.map((a, i) => (i === 1 ? { ...a, noCalls: true } : a)) };
    const f = frameOf(sh, 93, 45);
    expect(rowOf(f, 'beta-explorer')).toMatch(/beta-explorer\s+● done\s+\d+:\d\d\s+-\s/);
    expect(workerFacts('beta-explorer')!.calls).toBe('-');
    expect(flat(notificationTree('beta-explorer', 'explorer', 'finished · 0:15', false, ui, false, { cols: 70, calls: 4 }))).toMatch(/\d:\d\d · -/);
    expect(workerFacts('alpha-explorer')!.calls).toBe('3');
  });
  test('no table has drawn the worker: the card keeps its own figures', () => {
    resetWorkerFacts();
    const card = flat(notificationTree('gamma-explorer', 'explorer', 'finished · 0:15', false, ui, false, { cols: 70, calls: 4 }));
    expect(card).toContain('0:15 · 4 calls');
  });
});

describe('step 6: SUBAGENTS FN and LAST', () => {
  test('a tool echo cut at 200 cells keeps its function count, so FN is not lost', () => {
    const body = Array.from({ length: 12 }, (_, i) => `${i + 1} def function_number_${i}(argument_${i}):`).join(' ');
    const echo = `Read \`/p/alpha.py\` -> first 12 lines: ${body}`;
    expect(echo.length).toBeGreaterThan(200);
    const kept = clipEvidence(echo);
    expect(kept.length).toBeLessThanOrEqual(200);
    expect(outcomeOf(kept)).toBe('12 functions');
    expect(outcomeOf(clipEvidence('Read `/p/a.py` -> first 3 lines: 1 def a():'))).toBe('1 function');
  });
  test('a finished row with a count: FN is the count and LAST is the last tool action, not the count again', () => {
    const f = frameOf({ ...FINISHED, agents: FINISHED.agents.map((a) => ({ ...a, tool: null })), dispatch: [] }, 150, 45);
    const rows = f.hud.filter((r) => /^ {2}\w+-explorer\s+● done/.test(r));
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).not.toMatch(/(\d+) functions?\s*$|\s(\d+) (\d+) functions?/);
  });
  test('at 110 columns LAST has the width that is left: AGENT gives up two cells first', () => {
    const f = frameOf(FINISHED, 56, 40);
    const head = f.hud.find((l) => /AGENT\s+STATE/.test(l))!;
    expect(head, f.hud.join('\n')).toBeDefined();
    expect(head.indexOf('LAST')).toBe(2 + 12 + 2 + 9 + 1 + 6 + 1 + 6 + 1 + 4 + 2); // state 39: AGENT is 12 here, so LAST keeps 14 cells
  });
  test('no SUBAGENTS row wears a 236 background band', () => {
    const f = frameOf(RUNNING, 93, 45);
    const at = f.hud.findIndex((r) => r.includes('▸ SUBAGENTS'));
    expect(at).toBeGreaterThan(0);
    for (const segs of f.hudSegs.slice(at)) expect(segs.some((x) => x.bgHex === xtermHex(236))).toBe(false);
  });
});

describe('step 7: the HUD never hides a running row', () => {
  type R = { state: 'running' | 'queued' | 'done' | 'failed'; doneAt?: number };
  test('done rows go first, then queued, behind one summary row; every running row stays', () => {
    const rows: R[] = [{ state: 'done' }, { state: 'running' }, { state: 'running' }, { state: 'queued' }, { state: 'queued' }, { state: 'done' }];
    const w = planWindow(rows, 3, NOW, false, ui);
    expect(w.shown.filter((r) => r.state === 'running')).toHaveLength(2);
    expect(w.summary).toBe('● 2 done  ◇ 2 queued');
    expect(w.hiddenOpen).toBe(0);
  });
  test('the summary is one row and nothing else counts the rest: `● 3 done  ◇ 1 queued`', () => {
    const plan: TodoItem[] = ['completed', 'completed', 'completed', 'in_progress', 'pending', 'pending'].map((st, i) => ({ id: `t${i}`, content: `T${i + 1} step ${i}`, status: st }) as TodoItem);
    const lines = hudLines({ todos: ownTodos(plan), agents: [] }, { cols: 93, maxRows: 5, ui, now: NOW, merge: false }).map(runsString);
    expect(lines.some((l) => /^ {2}● 3 done {2}◇ 1 queued$/.test(l.trimEnd())), lines.join('\n')).toBe(true);
    expect(lines.some((l) => /T4 step 3/.test(l))).toBe(true); // the running row
  });
  test('no `└ explorer-xxxx queued` child row, in any state', () => {
    const todos = ownTodos(PLAN.map((c, i) => ({ id: `t${i}`, content: c, status: i === 0 ? 'in_progress' : 'pending' }) as TodoItem));
    const queued = { name: 'explorer-7a37', role: 'explorer', state: 'queued', ui: 'queued' } as HudAgent;
    const lines = hudLines({ todos, agents: [queued] }, { cols: 93, maxRows: 20, ui, now: NOW, merge: true }).map(runsString);
    expect(lines.some((l) => l.includes('└'))).toBe(false);
  });
  test('a queued plan row has an owner cell, `-` when it has none', () => {
    const todos = ownTodos([{ id: 't1', content: 'T1 read alpha.py', status: 'in_progress', owner: 'alpha-explorer' }, { id: 't2', content: 'T2 combine', status: 'pending' }] as unknown as TodoItem[]);
    const agents = [{ name: 'alpha-explorer', role: 'explorer', state: 'working', ui: 'running', since: NOW - 2000, startedAt: NOW - 5000 } as HudAgent];
    const lines = hudLines({ todos, agents }, { cols: 93, maxRows: 20, ui, now: NOW, merge: true }).map(runsString);
    const q = lines.find((l) => /T2 combine/.test(l))!;
    expect(q.trimEnd(), lines.join('\n')).toMatch(/queued\s+-\s+-$/); // state 39: the fixed grid, owner `-` then time `-`
  });
  test('the finished row that vanished with no `+N` (live-150-1 f0045) is now a summary row', () => {
    const plan: TodoItem[] = [
      { id: 't1', content: 'T1 read alpha.py', status: 'in_progress', owner: 'alpha-explorer' }, { id: 't2', content: 'T2 read beta.py', status: 'completed', owner: 'beta-explorer' },
      { id: 't3', content: 'T3 read gamma.py', status: 'in_progress', owner: 'gamma-explorer' }, { id: 't4', content: 'T4 combine', status: 'pending' }, { id: 't5', content: 'T5 summary', status: 'pending' },
    ] as unknown as TodoItem[];
    const agents = ['alpha', 'beta', 'gamma'].map((n, i) => ({ name: `${n}-explorer`, role: 'explorer', state: n === 'beta' ? 'finished' : 'working', ui: n === 'beta' ? 'done' : 'running', since: NOW - 2000, startedAt: NOW - 8000 - i * 1000 }) as HudAgent);
    const lines = hudLines({ todos: ownTodos(plan), agents }, { cols: 93, maxRows: 11, ui, now: NOW, merge: true }).map(runsString);
    const rowsDrawn = lines.filter((l) => /\bT[1-5] /.test(l)).length;
    const summary = lines.find((l) => /^ {2}● \d+ done/.test(l));
    expect(rowsDrawn === 5 || summary !== undefined, lines.join('\n')).toBe(true);
    expect(lines.filter((l) => /T[13] read (alpha|gamma)\.py/.test(l))).toHaveLength(2); // both running rows stay
  });
});

describe('step 8: the band frame round trip', () => {
  test('noteBandFrame stores the frame and the whole seconds; bandFrame returns them', () => {
    forgetBandFrame();
    expect(bandFrame()).toBeNull();
    noteBandFrame(4, 37.9);
    expect(bandFrame()).toEqual({ frame: 4, secs: 37 });
    noteBandFrame(7, null);
    expect(bandFrame()).toEqual({ frame: 7, secs: null });
  });
  test('rendering the band notes the spinner frame and the clock it drew', () => {
    forgetBandFrame();
    const f = frameOf(RUNNING, 150, 45);
    const noted = bandFrame();
    expect(noted).not.toBeNull();
    expect(noted!.secs).toBe(42);
    expect(Number.isInteger(noted!.frame)).toBe(true);
    expect(f.band).toContain('0:42');
  });
});

describe('follow-up B: the 110-column HUD keeps every running plan row', () => {
  // live-110-851e5b41-1 f0030-f0045: `0/5 · +4 more` over ONE drawn row for 7 s, three agents running, beside a full SUBAGENTS table (the slot's budget there was 10, the HUD's 9 rows).
  for (const screen of [26, 28]) {
    test(`110x${screen}: five plan rows, three running: all three running rows render and SUBAGENTS folds to its title`, () => {
      const f = frameOf(RUNNING, 110, screen);
      const hud = f.hud.map((l) => l.trimEnd());
      expect(hud.filter((l) => /T[123] read (alpha|beta|gamma)\.py/.test(l)), hud.join('\n')).toHaveLength(3);
      expect(hud.some((l) => /\+\d+ more/.test(l) && /TODO/.test(l)), hud.join('\n')).toBe(false);
      expect(hud.some((l) => /SUBAGENTS/.test(l) && /3 running/.test(l)), hud.join('\n')).toBe(true);
      expect(hud.some((l) => /^\s+alpha-explorer\s+\S+ running/.test(l)), hud.join('\n')).toBe(false); // the table gave way, not a running plan row
    });
  }
  test('with room for both, SUBAGENTS keeps its table (screen 40)', () => {
    const hud = frameOf(RUNNING, 110, 40).hud.map((l) => l.trimEnd());
    expect(hud.filter((l) => /^\s+\w+-explorer\s+\S+ running/.test(l))).toHaveLength(3);
  });
});
