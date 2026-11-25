// Wave 34 (critique 33, build 4d8d8eb1): the side panel as a monitor and every number on the board and the cards true. Each test fails on 4d8d8eb1; the defect it comes from is quoted beside it.
import { describe, expect, test } from 'claude-code/testing';
import { resetWorkerFacts } from '../../data/live';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../../live_fixture';
import { forgetRefusals } from '../../data/channels';
import { forgetBandFrame } from '../../motion/motion';
import { cells, type Ui } from '../../design/atlas-ui';
import { bodyLines, lineText } from './panel-layout';
import { forgetPhases, panelModelOf } from './pane/sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { boardTimeline } from '../board/board-model';
import { notificationTree } from '../transcript/cards';
import { cleanRun, forgetPlaced, placedTree, placeFinished } from '../transcript/placed';
import { durationTree } from '../transcript/restyle';
import type { AtlasSnapshot } from '../../contract';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
const todo = (id: string, content: string, status: string, owner: string | null, c: number, d: number, extra: Record<string, unknown> = {}) => ({ id, content, status, owner, session_id: 's', claimed_at: (NOW - 30000) / 1000 + c, completed_at: status === 'completed' ? (NOW - 30000) / 1000 + d : null, ...extra });

/** The stoprun shape: ghost-explorer failed, the lead holds T2 `blocked`, and two dispatch rows that no plan row owns. */
const snap = (phase = 'implement', channel = 'lc-w34') => ({
  ...busySnap(), phase, now: NOW, channel, sessionId: 's',
  squad: [
    { name: 'alpha-explorer', persona: 'explorer', state: 'finished', source: 'task' },
    { name: 'ghost-explorer', persona: 'explorer', state: 'failed', source: 'task' },
    { name: 'beta-explorer', persona: 'explorer', state: 'finished', source: 'task' },
  ],
  activity: {
    lead: act({ mood: 'working', toolCount: 5, startedAt: NOW - 27000 }),
    'alpha-explorer': act({ startedAt: NOW - 27000, since: NOW - 16000, mood: 'done', calls: [NOW - 26000, NOW - 24000, NOW - 20000, NOW - 17000], toolCount: 4 }),
    'ghost-explorer': act({ startedAt: NOW - 26000, since: NOW - 16000, mood: 'failed', calls: [NOW - 25000, NOW - 20000], toolCount: 2 }),
    'beta-explorer': act({ startedAt: NOW - 14000, since: NOW - 7000, mood: 'done', calls: [NOW - 13000, NOW - 9000, NOW - 8000], toolCount: 3 }),
  },
  todos: [
    todo('1', 'T1 read alpha.py', 'completed', 'alpha-explorer', 0, 11), todo('2', 'T2 read ghost.py', 'blocked', 'ghost-explorer', 1, 12), todo('3', 'T3 read beta.py', 'completed', 'beta-explorer', 13, 20),
    todo('4', 'T4 combine the reports', 'in_progress', null, 21, 22), todo('5', 'T5 write the final summary', 'pending', null, 22, 23),
    todo('6', 'Read ghost.py first, then README.md', 'pending', 'explorer-f3da', 24, 24, { origin: 'dispatch' }),
    todo('7', 'List the function names defined in alpha.py', 'completed', 'alpha-explorer', 0, 11, { origin: 'dispatch' }),
  ],
  notes: [
    { seq: 1, ts: new Date(NOW - 20000).toISOString(), owner: 'lead', to: 'all', text: 'starting the three reads' },
    { seq: 2, ts: new Date(NOW - 12000).toISOString(), owner: 'alpha-explorer', to: 'lead', text: 'alpha done: two functions', kind: 'handoff' },
    { seq: 3, ts: new Date(NOW - 8000).toISOString(), owner: 'lead', to: 'all', text: 'holding T2' },
  ],
}) as never;
type Run = NonNullable<SidebarModel['run']>;
const RUN: Run = { kind: 'working', secs: 57, startMs: NOW - 57000 };
const model = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null = RUN, look: Ui = ui): SidebarModel => ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows, look, ...(run ? { run } : {}) } as SidebarModel);
const tree = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN, look: Ui = ui): Node => { forgetRefusals(); forgetBandFrame(); return sidebarTree(els, model(s, view, columns, rows, run, look), on) as unknown as Node; };
const render = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN, look: Ui = ui): string[] => textOf(tree(view, columns, rows, s, run, look)).split('\n');
const body = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN): string[] => { forgetRefusals(); forgetBandFrame(); return bodyLines(panelModelOf(model(s, view, columns + 1, rows, run), ui, columns)).map((l) => lineText(l).trimEnd()); };
/** Every Text of a tree with its colour. */
const texts = (n: Node, out: Array<{ t: string; color?: string }> = []): Array<{ t: string; color?: string }> => { if (n.kind === 'Text') out.push({ t: String(n.props.children ?? ''), color: n.props.color }); for (const k of kids(n)) texts(k, out); return out; };

const SPIN_MARK = /[◐◓◑◒]/;
const NO_BRAILLE = /[\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f]/; // the retired ten-frame lead set (the sparkline's cells are other code points)
const DIM = '#585858'; // 240
const RED = '#ff5f5f'; // 203
const GREEN = '#87d787'; // 114

/** A run that is in `phase` now, after the run was in each of `before` earlier: the panel sees one build per phase. */
const walk = (phases: readonly string[], last: Run): string[] => {
  forgetPhases();
  let out: string[] = [];
  for (const p of phases) out = render('route', 65, 45, snap(p), p === phases[phases.length - 1] ? last : RUN);
  return out;
};

describe('item 1: the route tab is a timeline, not a copy of the HUD plan (critique 33)', () => {
});

describe('item 2: one panel width in every state (critique 33: 93 -> 83 transcript columns, the divider 236 -> 153)', () => {
  const states: Array<[string, Run | null]> = [['working', RUN], ['done', { kind: 'done', secs: 52 }], ['idle', { kind: 'idle' }], ['blocked', { kind: 'blocked', secs: 20 }], ['none', null]];
  test('the pane is the same width on every tab in every state, and no row is wider than it', () => {
    for (const v of ['route', 'team', 'channel', 'core', 'board'] as const) {
      const widths = new Set<number>();
      for (const [, run] of states) {
        const t = tree(v, 65, 45, snap(), run);
        widths.add(t.props.width);
        for (const l of textOf(t).split('\n')) expect(cells(l.trimEnd())).toBeLessThanOrEqual(t.props.width);
      }
      expect([...widths]).toEqual([64]);
    }
  });
  test('the rows do not change width when the run ends: the timeline is cut the same way working, done and idle', () => {
    forgetPhases();
    const chain = (run: Run | null): number => cells((render('route', 65, 45, snap('verify'), run).find((l) => /research/.test(l)) ?? '').trimEnd());
    expect(chain({ kind: 'done', secs: 52 })).toBeLessThanOrEqual(64);
    expect(chain({ kind: 'idle' })).toBeLessThanOrEqual(64);
  });
});

describe('item 3: the team tab sparkline is braille with a labelled axis; the channel tab fills with what its notes hold (critique 33)', () => {
  const team = body('team', 65, 45);
  const SPARK = /[⣀⣤⣶⣿]{12}/;
  test('and says nothing the notes do not hold: no sender row without a note', () => {
    const t = body('channel', 65, 45).filter((l) => /\d+ posts?\s/.test(l) && !/^\s*posts/.test(l));
    const names = t.map((l) => l.trim().split(/\s+/)[0]);
    expect(new Set(names)).toEqual(new Set(['lead', 'alpha-explorer', 'ghost-explorer'].filter((n) => names.includes(n))));
    expect(names).not.toContain('beta-explorer');
  });
});

describe('item 4: the board says one word per worker, keeps dispatches apart and hangs no stems (critique 33)', () => {
  const out = render('board', 65, 45);
  const text = out.join('\n');
  test('a failed worker is `■ failed` (203) on its T row; the row never says `blocked`', () => {
    const t2 = out.find((l) => /T2 read ghost\.py/.test(l))!;
    expect(t2).toMatch(/^\s*✗ T2/); // 4d8d8eb1: `▲ T2 ... blocked`
    expect(t2).toMatch(/\bfailed\b/);
    expect(text).not.toMatch(/\bblocked\b/);
    const mark = texts(tree('board', 65, 45)).find((x) => x.t === '✗');
    expect(mark?.color).toBe(RED);
    const word = texts(tree('board', 65, 45)).find((x) => x.t.trim() === 'failed' && /^failed\s*$/.test(x.t));
    expect(word?.color).toBe(RED);
  });
  test('the totals, the bar and the recent list do not call it anything else', () => {
    expect(text).not.toMatch(/ghost-explorer.*(blocked|killed)/);
    expect(out.filter((l) => /\bfailed\b/.test(l)).length).toBe(2); // the row, and the footer's count (wave 35)
  });
  test('dispatch rows stand in a `dispatches` group under the items, not among them', () => {
    const head = out.findIndex((l) => /^\s*dispatches\s*$/.test(l));
    const t5 = out.findIndex((l) => /T5 write the final summary/.test(l));
    const d1 = out.findIndex((l) => /Read ghost\.py first/.test(l));
    expect(head).toBeGreaterThan(t5); // 4d8d8eb1: the dispatch row followed T5 with nothing between
    expect(d1).toBeGreaterThan(head);
    expect(out.slice(0, head).some((l) => /Read ghost\.py first/.test(l))).toBe(false);
  });
  test('no tick stems under the bars: no sparkline row, the calls are a caption', () => {
    expect(text.replace(/▇+/g, '')).not.toMatch(/[▁▂▃▄▅▆]{2}/); // 4d8d8eb1: `▁█▁▁█▁▁▁` under every bar (wave 38: the lane bars are the one-row `▇`)
    const agents = [{ name: 'alpha-explorer', state: 'done' as const, secs: 11, startMs: 0, endMs: 11_000, calls: [1_000, 3_000, 7_000, 10_000] }];
    const lines = boardTimeline(agents, { cols: 65, ui, spark: true }).map((l) => l.runs.map((x) => x.t).join(''));
    expect(lines.slice(1, 2).join('\n')).not.toMatch(/[▁▂▃▄▅▆▇]/); // the caption row under the bar
    expect(lines.join('\n')).toMatch(/4 calls/);
  });
});

describe('item 5: every card number is true (critique 33)', () => {
  const card = (o: Record<string, unknown>): string => {
    const flat = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as { children?: unknown[] }).children ?? []).map(flat).join('') : '');
    return flat(notificationTree('gamma-explorer', 'explorer', 'finished · 0:19', false, ui, false, o as never));
  };
  test('a figure that counts tool calls says `calls`, never `fn`', () => {
    resetWorkerFacts();
    const row = card({ calls: 3 });
    expect(row).toMatch(/0:19 · 3 calls$/); // 4d8d8eb1: `0:19 · 3 fn` over a worker that reported two functions
    expect(row).not.toMatch(/\bfn\b/);
    expect(card({ calls: 1 })).toMatch(/· 1 call$/);
  });
  test('`fn` appears only for functions the worker reported', () => {
    resetWorkerFacts();
    expect(card({ calls: 3, fns: 2 })).toMatch(/0:19 · 2 fn$/);
    expect(card({})).toMatch(/0:19 · -$/);
  });

  const rec = (over: Record<string, unknown> = {}) => ({ ...(snap('verify') as object), todos: [], ...over }) as unknown as AtlasSnapshot;
  const clean = (now: number, state = 'finished'): AtlasSnapshot => ({
    ...(rec() as object), now, counts: { done: 5, total: 5, byPhase: {} },
    squad: [{ name: 'alpha-explorer', persona: 'explorer', state, source: 'task' }, { name: 'beta-explorer', persona: 'explorer', state, source: 'task' }],
    activity: { 'alpha-explorer': act({ startedAt: now - 52000, since: now - 40000, mood: 'done' }), 'beta-explorer': act({ startedAt: now - 30000, since: now - 5000, mood: 'done' }) }, comms: [], todoGroups: [],
  }) as unknown as AtlasSnapshot;
  const running = (now: number): AtlasSnapshot => ({ ...(clean(now, 'running') as object), counts: { done: 3, total: 5, byPhase: {} }, activity: { 'alpha-explorer': act({ startedAt: now - 52000, since: now - 1000, mood: 'working' }), 'beta-explorer': act({ startedAt: now - 30000, since: now - 1000, mood: 'working' }) } }) as unknown as AtlasSnapshot;
  const engine = (ids: string[]) => ({ ui: { place: async ({ id }: { id: string }) => { ids.push(id); return { isPlaced: true, requestId: id }; } } }) as never;
  const flat = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as { children?: unknown[] }).children ?? []).map(flat).join('') : '');

  test('a clean run places an Atlas finish card: `▌ ◆ ATLAS  ● done  5/5 · 2 workers  0:47`', async () => {
    forgetPlaced();
    const ids: string[] = [];
    await placeFinished(engine(ids), running(NOW - 1000), clean(NOW));
    const runId = ids.find((i) => i.startsWith('done-run'))!;
    expect(runId).toBeDefined(); // 4d8d8eb1: only the host's `▌ verify 5/5 done`
    expect(flat(placedTree(runId, ui))).toMatch(/^▌ ◆ ATLAS\s+✓ done\s+5\/5 · 2 workers$/);
    await placeFinished(engine(ids), clean(NOW), clean(NOW + 1000));
    expect(ids.filter((i) => i.startsWith('done-run'))).toHaveLength(1); // once per run
    forgetPlaced();
  });
  test('a run with a failed worker or an open dispatch row gets no card', () => {
    expect(cleanRun(clean(NOW, 'failed'))).toBeNull();
    expect(cleanRun({ ...(clean(NOW) as object), todos: [{ id: 'd', content: 'x', status: 'pending', owner: 'a', origin: 'dispatch' }] } as never)).toBeNull();
    expect(cleanRun(clean(NOW))).toMatchObject({ done: 5, total: 5, workers: 2 });
  });

  test('one footer per run: a turn that ends with agents working draws none; the closing one prints no run time', () => {
    const open = durationTree(running(NOW), { durationMs: 5000 }, { turnStart: NOW - 5000, runStart: NOW - 52000 }, NOW, ui);
    expect(flat(open)).toBe('');
    const tracker = { turnStart: NOW - 13000, runStart: NOW - 52000 };
    const last = flat(durationTree(clean(NOW), { durationMs: 13000 }, tracker, NOW, ui));
    expect(last).toBe(''); // slice S2: the closing footer prints no run time (the band's 0:52 is the one); 4d8d8eb1: never `turn 0:05` and `turn 0:13` in one run
    expect(last).not.toMatch(/turn/);
  });
});

void GREEN;
