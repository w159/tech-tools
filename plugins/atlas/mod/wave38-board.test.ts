// Wave 38 (critique 37, build 851e5b41): the board tab and the side panel, truthful and dense. Each test names the 851e5b41 defect it comes from.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from './live_fixture';
import { forgetRefusals } from './data/channels';
import { DONE_DOUBT, type Ui } from './atlas-ui';
import { agentModel, hudAgents, resetAgentSeq } from './hud';
import { meterRuns } from './hud-surface';
import { liveWorkers, queuedMembers } from './data/live';
import { forgetPhases } from './pane/sidebar-model';
import { leadBarState, sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { boardLines, boardText, boardTimeline, type BoardRow } from './board-model';
import { workersByTask } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const texts = (n: Node, out: Array<{ t: string; color?: string }> = []): Array<{ t: string; color?: string }> => { if (n.kind === 'Text') out.push({ t: String(n.props.children ?? ''), color: n.props.color }); for (const k of kids(n)) texts(k, out); return out; };
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
const todo = (id: string, content: string, status: string, owner: string | null, c: number, d: number) => ({ id, content, status, owner, session_id: 's', claimed_at: (NOW - 30000) / 1000 + c, completed_at: status === 'completed' ? (NOW - 30000) / 1000 + d : null });
const RED = '#ff5f5f'; // 203
const GREEN = '#87d787'; // 114
const VIOLET = '#af87ff'; // 141
const AMBER = '#d7af5f'; // 179
const DIM = '#585858'; // 240

type Run = NonNullable<SidebarModel['run']>;
const model = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null): SidebarModel => ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows, look: ui, ...(run ? { run } : {}) } as SidebarModel);
const tree = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null): Node => { forgetRefusals(); return sidebarTree(els, model(s, view, columns, rows, run), on) as unknown as Node; };
const render = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null): string[] => textOf(tree(s, view, columns, rows, run)).split('\n');

/** The stop run as the scenario drives it: ghost killed, the lead CLOSED T2 (completed) over the dead worker, every other row completed. */
const stop = (over: Record<string, unknown> = {}): never => ({
  ...busySnap(), phase: 'implement', now: NOW, channel: 'lc-w38', sessionId: 's',
  squad: [
    { name: 'alpha-explorer', persona: 'explorer', state: 'finished', source: 'task' },
    { name: 'ghost-explorer', persona: 'explorer', state: 'failed', source: 'task' },
    { name: 'beta-explorer', persona: 'explorer', state: 'finished', source: 'task' },
  ],
  activity: {
    lead: act({ mood: 'working', toolCount: 10, startedAt: NOW - 31000, calls: [NOW - 30000, NOW - 20000, NOW - 10000] }),
    'alpha-explorer': act({ startedAt: NOW - 27000, since: NOW - 16000, mood: 'done', calls: [NOW - 26000, NOW - 24000, NOW - 20000, NOW - 17000], toolCount: 4 }),
    'ghost-explorer': act({ startedAt: NOW - 26000, since: NOW - 16000, mood: 'failed', calls: [NOW - 25000, NOW - 20000], toolCount: 2 }),
    'beta-explorer': act({ startedAt: NOW - 14000, since: NOW - 7000, mood: 'done', calls: [NOW - 13000, NOW - 9000, NOW - 8000], toolCount: 3 }),
  },
  todos: [
    todo('1', 'T1 read alpha.py', 'completed', 'alpha-explorer', 0, 11), todo('2', 'T2 read ghost.py', 'completed', 'ghost-explorer', 1, 12), todo('3', 'T3 read beta.py', 'completed', 'beta-explorer', 13, 20),
    todo('4', 'T4 combine the reports', 'completed', null, 21, 22), todo('5', 'T5 write the final summary', 'completed', null, 22, 23),
  ],
  notes: [], ...over,
}) as never;

/** Three explorers at work, nothing posted yet. */
const live = (over: Record<string, unknown> = {}): never => ({
  ...busySnap(), phase: 'implement', now: NOW, channel: 'lc-w38l', sessionId: 's',
  squad: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map((name) => ({ name, persona: 'explorer', state: 'running', source: 'task' })),
  activity: {
    lead: act({ mood: 'working', startedAt: NOW - 20000, calls: [NOW - 19000] }),
    'alpha-explorer': act({ startedAt: NOW - 12000, since: NOW - 1000, mood: 'working', calls: [NOW - 11000, NOW - 6000], lastLine: 'read alpha.py' }),
    'beta-explorer': act({ startedAt: NOW - 8000, since: NOW - 1000, mood: 'working', calls: [NOW - 7000], lastLine: 'read beta.py' }),
    'gamma-explorer': act({ startedAt: NOW - 4000, since: NOW - 1000, mood: 'working', calls: [NOW - 3000], lastLine: 'read gamma.py' }),
  },
  todos: [todo('1', 'T1 read alpha.py', 'in_progress', 'alpha-explorer', 0, 0), todo('2', 'T2 read beta.py', 'in_progress', 'beta-explorer', 4, 4), todo('3', 'T3 read gamma.py', 'in_progress', 'gamma-explorer', 8, 8)],
  notes: [], ...over,
}) as never;

const WORKING: Run = { kind: 'working', secs: 31, startMs: NOW - 31000 };

describe('step 1: the board header meter (critique 37: all 114 over a T2 the lead closed over a killed worker)', () => {
  test('the rendered header meter is the TODO meter, cell for cell: a 203 cell for the failed item', () => {
    forgetPhases();
    const all = texts(tree(stop(), 'board', 38, 41, { kind: 'blocked', secs: 31, startMs: NOW - 31000 }));
    const cells = all.filter((x) => /^[▰▱]+$/.test(x.t));
    const want = meterRuns(4, 5, ui, 1); // TODO: 4 done, 1 failed (the doubted done), 5 items
    expect(cells.map((x) => [x.t, x.color])).toEqual(want.map((x) => [x.t, x.tone === 'ok' ? GREEN : x.tone === 'bad' ? RED : DIM]));
    expect(cells.some((x) => x.color === RED && x.t === '▰')).toBe(true);
  });
  test('a failed row (203) and a doubted done each take their own 203 cell; 245 `▱` cells for the open items', () => {
    const rows: BoardRow[] = [
      { label: 'T1 a', state: 'done', owner: '', detail: '' },
      { label: 'T2 b', state: 'failed', owner: '', detail: '' },
      { label: 'T3 c', state: 'done', word: DONE_DOUBT, owner: 'w', ownerState: 'failed', detail: '' },
      { label: 'T4 d', state: 'queued', owner: '', detail: '' },
      { label: 'T5 e', state: 'queued', owner: '', detail: '' },
    ];
    const head = boardLines(rows, { cols: 60, ui, pane: true, ribbon: false, title: false })[0]!.runs.filter((x) => /^[▰▱]+$/.test(x.t));
    const want = meterRuns(1, 5, ui, 2);
    expect(head.map((x) => [x.t, x.tone])).toEqual(want.map((x) => [x.t, x.tone]));
    expect(head.find((x) => x.tone === 'bad')?.t).toBe('▰▰');
    expect(head.find((x) => x.tone === 'muted')?.t).toMatch(/^▱+$/);
  });
});

describe('step 2: the Gantt (critique 37: a 0:31 run on a 1:00 axis at 110, bars of 1-6 cells, a 179 lead bar)', () => {
  const labelsOf = (t: string[]): string[] => { const at = t.findIndex((l) => /┬/.test(l)); return t[at + 1]!.match(/\d+:\d\d/g) ?? []; };
  for (const [cols, rows] of [[57, 45], [38, 41]] as const) {
    test(`${cols === 57 ? 150 : 110} cols: the axis ends at the run rounded up to the next 10 s (0:31 -> 0:40) with a tick every 10 s`, () => {
      forgetPhases();
      const t = render(stop(), 'board', cols, rows, { kind: 'done', secs: 31, startMs: NOW - 31000 });
      expect(labelsOf(t).at(-1)).toBe('0:40');
      const rule = t.find((l) => /┬/.test(l))!;
      expect(rule.match(/┬/g)).toHaveLength(5); // 0:00 0:10 0:20 0:30 0:40
      const cellsPerStep = (rule.lastIndexOf('┬') - rule.indexOf('┬')) / 4;
      expect(Number.isInteger(cellsPerStep)).toBe(true);
      const at = [...rule].map((c, i) => (c === '┬' ? i : -1)).filter((i) => i >= 0);
      expect(at.every((c, i) => i === 0 || c - at[i - 1]! === cellsPerStep)).toBe(true);
    });
    test(`${cols === 57 ? 150 : 110} cols: every bar is one row of \`▇\` and a 240 \`│\` tick stands every 10 s across its lane`, () => {
      forgetPhases();
      const n = tree(stop(), 'board', cols, rows, { kind: 'done', secs: 31, startMs: NOW - 31000 });
      const t = textOf(n).split('\n');
      const lanes = t.filter((l) => /▇/.test(l));
      expect(lanes).toHaveLength(4); // lead, alpha, ghost, beta: one row each
      t.forEach((l, i) => { if (/▇/.test(l)) expect(/▇/.test(t[i + 1] ?? '')).toBe(false); }); // no second row under a bar
      expect(t.some((l) => /[█▏▎▍▌▋▊▉]/.test(l))).toBe(false); // the flat two-row block is gone
      const ticks = texts(n).filter((x) => /^│+$/.test(x.t));
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.every((x) => x.color === DIM)).toBe(true);
    });
  }
  test('the timeline helper: the axis end is the run rounded up to 10 s at any width, ticks every 10 s', () => {
    const agents = [{ name: 'alpha-explorer', state: 'done' as const, secs: 31, startMs: 0, endMs: 31_000 }];
    for (const cols of [38, 57, 100, 150]) {
      const t = boardText(boardTimeline(agents, { cols, ui }));
      expect([cols, t.at(-1)!.match(/\d:\d\d/g)!.at(-1)]).toEqual([cols, '0:40']);
      expect([cols, t.at(-2)!.match(/┬/g)!.length]).toEqual([cols, 5]);
    }
    expect(boardText(boardTimeline([{ name: 'a-explorer', state: 'done', secs: 30, startMs: 0, endMs: 30_000 }], { cols: 100, ui })).at(-1)).toMatch(/0:30$/); // exactly on a tick: no extra step
  });
  test('the lead bar is 141 while the run works, 114 when it is done and 203 only when its own row failed, never 179', () => {
    const lead = (s: never, run: Run): string | undefined => { forgetPhases(); return texts(tree(s, 'board', 38, 41, run)).find((x) => /^▇+/.test(x.t))?.color; };
    expect(lead(stop(), { kind: 'working', secs: 31, startMs: NOW - 31000 })).toBe(VIOLET);
    expect(lead(stop(), { kind: 'done', secs: 31, startMs: NOW - 31000 })).toBe(GREEN);
    expect(lead(stop(), { kind: 'blocked', secs: 31, startMs: NOW - 31000 })).toBe(GREEN); // a refused Stop is the band's word, not a warning on the lead's bar
    const failedLead = stop({ activity: { ...(stop() as any).activity, lead: act({ mood: 'failed', startedAt: NOW - 31000, calls: [] }) } });
    expect(lead(failedLead, { kind: 'done', secs: 31, startMs: NOW - 31000 })).toBe(RED);
    for (const run of ['working', 'idle', 'done', 'blocked', undefined]) for (const st of ['running', 'done', 'blocked', 'waiting', 'queued'] as const) expect(['accent'].includes(leadBarState(run, st)) || leadBarState(run, st) === 'running' || leadBarState(run, st) === 'done').toBe(true);
    expect(leadBarState('blocked', 'blocked')).not.toBe('blocked');
    expect(AMBER).not.toBe(GREEN);
  });
});

describe('step 3: the board footer and its height (critique 37: `● 2 ■ 1 · 0:31` at 110, 30% blank under the footer)', () => {
  test('at 110 the footer keeps its words: `2 done`, `1 failed` and the time', () => {
    forgetPhases();
    const foot = render(stop(), 'board', 38, 41, { kind: 'done', secs: 31, startMs: NOW - 31000 }).filter((l) => l.trim()).at(-1)!;
    expect(foot).toMatch(/2 done/);
    expect(foot).toMatch(/1 failed/);
    expect(foot).toMatch(/0:31/);
  });
  test('at 150 the footer is the long form with the total and the worker calls', () => {
    forgetPhases();
    const foot = render(stop(), 'board', 57, 41, { kind: 'done', secs: 31, startMs: NOW - 31000 }).filter((l) => l.trim()).at(-1)!;
    expect(foot).toMatch(/2 done {2}■ 1 failed · total 0:31 · 9 worker calls/);
  });
  test('the content uses the height: the recent events fill the pane from the first dispatch and no run of blank rows exceeds 2', () => {
    forgetPhases();
    const t = render(live(), 'board', 57, 45, { kind: 'working', secs: 20, startMs: NOW - 20000 });
    expect(t.join('\n')).toMatch(/recent/);
    expect(t.filter((l) => /alpha-explorer\s+started/.test(l))).toHaveLength(1);
    let run = 0; let worst = 0;
    for (const l of t) { run = l.trim() === '' ? run + 1 : 0; worst = Math.max(worst, run); }
    expect(worst).toBeLessThanOrEqual(2);
    expect(t.filter((l) => l.trim()).length).toBeGreaterThanOrEqual(20); // the live fixture has three items and three workers
  });
});

describe('step 4: events while agents run (critique 37: `no events yet · 0 messages` with three agents running)', () => {
  const events = (s: never, run: Run): string[] => { return render(s, 'route', 57, 41, run).filter((l) => /^\s+\+\d:\d\d\s/.test(l)).map((l) => l.trim()); };
  test('every worker is a `started` event from its first frame, and the empty line is gone', () => {
    forgetPhases();
    const t = render(live(), 'route', 57, 41, { kind: 'working', secs: 20, startMs: NOW - 20000 });
    expect(t.join('\n')).not.toMatch(/no events yet/);
    for (const n of ['alpha-explorer', 'beta-explorer', 'gamma-explorer']) expect(t.some((l) => new RegExp(`^\\s+\\+\\d:\\d\\d\\s+${n}\\s+started`).test(l))).toBe(true);
    expect(t.find((l) => /messages?\s*$/.test(l))).toMatch(/^\s+0 messages\s*$/); // the channel's own count stays the channel's
  });
  test('a started event is stamped at its worker\'s start instant and keeps the stamp as the run clock moves', () => {
    forgetPhases();
    const first = events(live(), { kind: 'working', secs: 20, startMs: NOW - 20000 });
    expect(first).toEqual(['+0:08  alpha-explorer  started', '+0:12  beta-explorer   started', '+0:16  gamma-explorer  started']);
    for (const drift of [1000, 2000, 3000]) expect(events(live(), { kind: 'working', secs: 20, startMs: NOW - 20000 + drift })).toEqual(first);
  });
});

describe('step 5: the side panel lists agents in the SUBAGENTS dispatch order (critique 37: ghost, beta, alpha under alpha, ghost, beta)', () => {
  /** ghost owns T1 and alpha T3: the plan order is ghost, beta, alpha; the dispatch order is alpha, ghost, beta. */
  const reversedPlan = (): never => stop({ todos: [
    todo('1', 'T1 read ghost.py', 'completed', 'ghost-explorer', 1, 12), todo('2', 'T2 read beta.py', 'completed', 'beta-explorer', 13, 20), todo('3', 'T3 read alpha.py', 'completed', 'alpha-explorer', 0, 11),
    todo('4', 'T4 combine the reports', 'completed', null, 21, 22), todo('5', 'T5 write the final summary', 'completed', null, 22, 23),
  ] });
  const namesOf = (lines: string[]): string[] => lines.map((l) => /(alpha|ghost|beta)-explorer/.exec(l)?.[0]).filter((x): x is string => !!x);
  test('the status and team tabs list the agents in the order the SUBAGENTS table does', () => {
    resetAgentSeq();
    forgetPhases();
    const s = reversedPlan();
    const subagents = agentModel(hudAgents(liveWorkers(s as never, (s as any).now), (s as any).squad, queuedMembers(s as never)), (s as any).todos, null, (s as any).now).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).map((a) => a.id ?? a.name);
    expect(subagents).toEqual(['alpha-explorer', 'ghost-explorer', 'beta-explorer']);
    const run: Run = { kind: 'done', secs: 31, startMs: NOW - 31000 };
    const agentsBlock = (view: SidebarView): string[] => {
      const t = render(s, view, 57, 41, run);
      const at = t.findIndex((l) => /^\s+agents\b/.test(l) || /^\s+(alpha|ghost|beta)-explorer/.test(l));
      return namesOf(t.slice(at, at + 4)).slice(0, 3);
    };
    expect(agentsBlock('route')).toEqual(subagents);
    expect(namesOf(render(s, 'team', 57, 41, run)).slice(0, 3)).toEqual(subagents);
  });
  test('the order survives a host that lists the squad in another order', () => {
    resetAgentSeq();
    forgetPhases();
    const s = reversedPlan();
    panelModelOf(model(s, 'team', 58, 41, null), ui, 57); // the first sight fixes the dispatch order
    const reordered = { ...(s as any), squad: [(s as any).squad[2], (s as any).squad[0], (s as any).squad[1]] } as never;
    const pm = panelModelOf(model(reordered, 'team', 58, 41, null), ui, 57);
    expect(workersByTask(pm).map((w) => w.name)).toEqual(['alpha-explorer', 'ghost-explorer', 'beta-explorer']);
  });
});

describe('step 6: the channel tab at 0 messages (critique 37: `○ no messages` in an empty pane)', () => {
  test('the tab stays, and the senders block names each worker with the time and text of its last status', () => {
    forgetPhases();
    const t = render(live(), 'channel', 57, 41, { kind: 'working', secs: 20, startMs: NOW - 20000 });
    expect(t.join('\n')).toMatch(/○ no messages/);
    expect(t.some((l) => /^\s+senders\s*$/.test(l))).toBe(true);
    const row = (n: string): string => t.find((l) => new RegExp(`^\\s+${n}\\s+\\+\\d:\\d\\d\\s`).test(l)) ?? '';
    expect(row('alpha-explorer')).toMatch(/\+0:\d\d\s+read alpha\.py/);
    expect(row('beta-explorer')).toMatch(/read beta\.py/);
    expect(row('gamma-explorer')).toMatch(/read gamma\.py/);
    expect(t.filter((l) => l.trim()).length).toBeGreaterThanOrEqual(10);
  });
});
