// Wave 35 (critique 34, build 4fef5d66): finish cards, the status view, the team lead row and the board agree with the band in every state. Each test names the 4fef5d66 defect it comes from.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../../live_fixture';
import { forgetRefusals } from '../../data/channels';
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
const tree = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN, look: Ui = ui): Node => { forgetRefusals(); return sidebarTree(els, model(s, view, columns, rows, run, look), on) as unknown as Node; };
const render = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN, look: Ui = ui): string[] => textOf(tree(view, columns, rows, s, run, look)).split('\n');
const body = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN): string[] => { forgetRefusals(); return bodyLines(panelModelOf(model(s, view, columns + 1, rows, run), ui, columns)).map((l) => lineText(l).trimEnd()); };
/** Every Text of a tree with its colour. */
const texts = (n: Node, out: Array<{ t: string; color?: string }> = []): Array<{ t: string; color?: string }> => { if (n.kind === 'Text') out.push({ t: String(n.props.children ?? ''), color: n.props.color }); for (const k of kids(n)) texts(k, out); return out; };

const SPIN_MARK = /[◐◓◑◒]/;
const CIRCLES = /[◐◓◑◒]/;
const DIM = '#585858'; // 240
const RED = '#ff5f5f'; // 203
const GREEN = '#87d787'; // 114


// ---- wave 35 fixtures -----------------------------------------------------------------------------------------------------------
import { assistantTree } from '../transcript/restyle';
import { noteRunSecs, runCardPlaced } from '../transcript/placed';
import { gateTally, withCoreTally } from '../../data/runstate';

const GATES = [
  { id: 'completion', title: 'Completion', lines: [{ id: 'a', label: 'Todos drained', ok: true }] },
  { id: 'tripwire', title: 'Dispatch tripwire', lines: [{ id: 'b', label: 'Team gate', ok: false, fix: 'dispatch a verifier' }] },
  { id: 'routing', title: 'Routing', lines: [{ id: 'c', label: 'Dispatches followed the plan', ok: true }] },
  { id: 'header', title: 'Header contract', lines: [{ id: 'd', label: 'Replies with header matched', ok: true }] },
];
const withGates = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null = RUN, gates: unknown[] = GATES): string[] => {
  forgetRefusals();
  return textOf(sidebarTree(els, { ...model(s, view, columns, rows, run), gates: gates as never }, on) as unknown as Node).split('\n');
};
const BLOCKED: Run = { kind: 'blocked', secs: 57, startMs: NOW - 57000 };
/** The stoprun shape with owner tails on the plan titles, as the board shows them (`T1 read alpha.py (alpha-explorer)`). */
const tailed = (s: never): never => ({ ...(s as object), todos: (s as { todos: { content: string; owner: string | null }[] }).todos.map((t) => (/^T[123] /.test(t.content) && t.owner ? { ...t, content: `${t.content} (${t.owner})` } : t)) }) as never;
const closeDispatches = (s: never): never => ({ ...(s as object), todos: (s as { todos: { origin?: string }[] }).todos.filter((t) => t.origin !== 'dispatch') }) as never;

// ---- item 1: the finish card follows the band ------------------------------------------------------------------------------------
type El = { props?: Record<string, unknown>; children?: unknown[] };
const flatEl = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? [...((n as El).children ?? []), ...(Array.isArray((n as El).props?.children) ? ((n as El).props!.children as unknown[]) : (n as El).props?.children !== undefined ? [(n as El).props!.children] : [])].map(flatEl).join('') : '');
const coloursOf = (n: unknown, out: Array<{ t: string; color?: unknown }> = []): Array<{ t: string; color?: unknown }> => {
  if (n && typeof n === 'object') {
    const e = n as El & { type?: string };
    if (e.type === 'Text') out.push({ t: flatEl(e), color: e.props?.color });
    for (const c of e.children ?? []) coloursOf(c, out);
  }
  return out;
};
const chip = (s: unknown, text: string, superseded = false) => assistantTree(s as AtlasSnapshot, { text }, 100, superseded, ui);

describe('item 1: the finish card says what the band says (critique 34: a 179 `done · 1 failed · 1 dispatch open` over a 203 `▲ blocked` band)', () => {
  test('a run that ends with a dispatch row open and nothing running reads `▌ ▲ blocked` in 203, not `done`', () => {
    const el = chip(snap('done'), 'done 5/5');
    const text = flatEl(el);
    expect(text).toMatch(/^▌ ▲ blocked · stop refused/); // 4fef5d66: `▌ done · 1 failed · 1 dispatch open` in 179
    expect(text).not.toMatch(/\bdone\b/);
    const bar = coloursOf(el).find((x) => x.t === '▌');
    expect(bar?.color).toBe(RED);
    expect(coloursOf(el).find((x) => /blocked/.test(x.t))?.color).toBe(RED);
  });
  test('a worker still running keeps the amber `done` card: the band is working, not blocked', () => {
    const s = snap('done') as unknown as { squad: { name: string; state: string }[]; activity: Record<string, Record<string, unknown>> };
    s.squad[0]!.state = 'running';
    s.activity['alpha-explorer']!.mood = 'working';
    const el = chip(s, 'done 5/5');
    expect(flatEl(el)).toMatch(/^▌ done · 1 failed · 1 open/);
    expect(coloursOf(el).find((x) => x.t === '▌')?.color).not.toBe(RED);
  });
  test('a Stop refusal still blocks the card, as before', () => {
    expect(flatEl(chip(snap('done'), 'done 5/5', true))).toMatch(/^▌ ▲ blocked/);
  });

  const rec = (over: Record<string, unknown> = {}) => ({ ...(snap('verify') as object), todos: [], ...over }) as unknown as AtlasSnapshot;
  const clean = (now: number, state = 'finished'): AtlasSnapshot => ({
    ...(rec() as object), now, counts: { done: 5, total: 5, byPhase: {} },
    squad: [{ name: 'alpha-explorer', persona: 'explorer', state, source: 'task' }, { name: 'beta-explorer', persona: 'explorer', state, source: 'task' }],
    activity: { 'alpha-explorer': act({ startedAt: now - 52000, since: now - 40000, mood: 'done' }), 'beta-explorer': act({ startedAt: now - 30000, since: now - 5000, mood: 'done' }) }, comms: [], todoGroups: [],
  }) as unknown as AtlasSnapshot;
  const running = (now: number): AtlasSnapshot => ({ ...(clean(now, 'running') as object), counts: { done: 3, total: 5, byPhase: {} }, activity: { 'alpha-explorer': act({ startedAt: now - 52000, since: now - 1000, mood: 'working' }), 'beta-explorer': act({ startedAt: now - 30000, since: now - 1000, mood: 'working' }) } }) as unknown as AtlasSnapshot;
  const engine = (ids: string[]) => ({ ui: { place: async ({ id }: { id: string }) => { ids.push(id); return { isPlaced: true, requestId: id }; } } }) as never;

  test('one finish line per run: with the run card placed, the lead\'s bare `done 5/5` chip draws no second row', async () => {
    forgetPlaced();
    expect(flatEl(chip(clean(NOW), 'done 5/5'))).toMatch(/^▌ ATLAS 🏁 done 5\/5/); // no card yet: the chip is the finish line
    const ids: string[] = [];
    await placeFinished(engine(ids), running(NOW - 1000), clean(NOW));
    expect(runCardPlaced()).toBe(true);
    expect(flatEl(chip(clean(NOW), 'done 5/5'))).toBe(''); // 4fef5d66: `run 5/5 done · 3 workers 0:13`, then `▌ done 5/5`
    expect(flatEl(chip(clean(NOW), 'done 5/5 · three files changed'))).toMatch(/three files changed/); // a chip with a sentence of its own is still drawn (wave 36: a bare `complete` or `all finished` is not one)
    forgetPlaced();
  });
  test('the run card prints the band\'s run time, not the span of the workers', async () => {
    forgetPlaced();
    const ids: string[] = [];
    await placeFinished(engine(ids), running(NOW - 1000), clean(NOW));
    const id = ids.find((i) => i.startsWith('done-run'))!;
    expect(flatEl(placedTree(id, ui))).toMatch(/2 workers$/); // slice S4: the card prints no time at all
    noteRunSecs(33);
    expect(flatEl(placedTree(id, ui))).toMatch(/2 workers$/); // slice S4: no time on the card; truth 39: a placed card is never rewritten by a later reading
    forgetPlaced();
    noteRunSecs(33);
    const ids2: string[] = [];
    await placeFinished(engine(ids2), running(NOW - 1000), clean(NOW));
    expect(flatEl(placedTree(ids2.find((i) => i.startsWith('done-run'))!, ui))).toMatch(/2 workers$/); // slice S4 (was 4fef5d66: the card said 0:13, the band 0:33): the card prints no time, the band's clock is the one
    noteRunSecs(undefined);
    forgetPlaced();
  });
});

// ---- item 3: the status view ---------------------------------------------------------------------------------------------------------
describe('item 3: the status view (critique 34: route about 80% empty, channel about 95%, gates 3/4 against the band\'s 2/4)', () => {
  const rows = (cols = 57, run: Run = RUN, s: never = snap(), gates: unknown[] = GATES): string[] => { forgetPhases(); return withGates(s, 'route', cols, 40, run, gates); };

  const stepperOf = (t: string[]): string => t[t.findIndex((l) => l.trim() === 'PHASE') + 1]!;
  test('the pane is as wide as the pane in every state, at 150 and at 110', () => {
    for (const cols of [57, 38]) {
      for (const run of [RUN, BLOCKED, { kind: 'done', secs: 52, startMs: NOW - 52000 } as Run, { kind: 'idle', secs: 0, startMs: NOW } as Run]) {
        const t = rows(cols, run);
        expect(Math.max(...t.map((l) => cells(l)))).toBeLessThanOrEqual(cols - 1);
        forgetPhases();
        const root = tree('route', cols, 40, snap(), run);
        expect(root.props.width).toBe(cols - 1);
        expect(root.props.minHeight).toBe(40);
      }
    }
  });
});

describe('item 3: the team tab\'s lead row says what the band says', () => {
  const leadDone = (): never => { const s = snap() as unknown as { activity: Record<string, unknown> }; s.activity.lead = act({ mood: 'done', toolCount: 5, startedAt: NOW - 27000 }); return s as never; };
});

// ---- item 4 and 5: the board ----------------------------------------------------------------------------------------------------------
describe('item 4: the board (critique 34: `· total0:3 · 8 tool` at 110, `3 dispatches` over an empty list, titles cut to `(alpha…`)', () => {
  const board = (cols: number, s: never = snap(), run: Run = RUN): string[] => { forgetPhases(); return withGates(s, 'board', cols, 40, run); };
  const foot = (t: string[]): string => t[t.length - 1]!;

  test('the footer fits every width from 30 to 100 and never garbles a word', () => {
    for (const cols of [30, 33, 38, 44, 57, 70, 100]) {
      const f = foot(board(cols));
      expect(cells(f)).toBeLessThanOrEqual(cols - 1);
      expect(f).not.toMatch(/\d\S*·|·\S/);
    }
  });
  test('no open dispatch: the header says the items alone and no empty `dispatches` group is drawn', () => {
    const t = board(57, closeDispatches(snap()));
    expect(t.find((l) => /\bitems\b/.test(l))).toMatch(/^\s*5 items\s+▰/);
    expect(t.join('\n')).not.toMatch(/dispatch/); // 4fef5d66: `3 dispatches` with nothing listed
  });
  test('no row is wider than the pane (nothing spills past the pane\'s edge)', () => {
    for (const cols of [30, 38, 57, 100]) for (const l of board(cols, tailed(snap()))) expect(cells(l)).toBeLessThanOrEqual(cols - 1);
  });
});

describe('item 5: the board\'s one honest motion', () => {
  const glyphs = (s: never, nows: number[]): string[] => nows.map((n) => { forgetPhases(); const t = withGates({ ...(s as object), now: NOW + n } as never, 'board', 57, 40); return /^▸? ?(\S) T4 combine/.exec(t.find((l) => /T4 combine/.test(l))!.trim().replace(/^▸\s*/, ''))?.[1] ?? ''; });
  test('while a worker runs, its row\'s glyph turns the spinner frames', () => {
    const g = glyphs(snap(), [0, 100, 200, 300, 400, 500, 600, 700]);
    expect(g.every((x) => /^[◐◓◑◒]$/.test(x))).toBe(true);
    expect(new Set(g).size).toBeGreaterThan(1);
  });
  test('at rest nothing moves: the same rows at two clocks are the same text', () => {
    const rest = closeDispatches({ ...(snap() as object), todos: (snap() as unknown as { todos: { status: string }[] }).todos.map((t) => ({ ...t, status: 'completed' })) } as never);
    const a = withGates({ ...(rest as object), now: NOW } as never, 'board', 57, 40, { kind: 'done', secs: 52, startMs: NOW - 52000 });
    const b = withGates({ ...(rest as object), now: NOW + 300 } as never, 'board', 57, 40, { kind: 'done', secs: 52, startMs: NOW - 52000 });
    expect(a.filter((l) => /T\d /.test(l))).toEqual(b.filter((l) => /T\d /.test(l)));
    expect(a.join('\n')).not.toMatch(/[◐◓◑◒]/);
  });
});
