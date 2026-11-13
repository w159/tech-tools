// Wave 36 (critique 35, build 28d53608): one state per item at every width, one clock, one done line and a status view with real events. Each test names the 28d53608 defect it comes from.
import { describe, expect, test } from 'claude-code/testing';
import { resetWorkerFacts } from './data/live';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from './live_fixture';
import { forgetRefusals } from './data/channels';
import { forgetBandFrame } from './motion';
import { cells, type Ui } from './atlas-ui';
import { bodyLines, lineText } from './panel-layout';
import { forgetPhases, panelModelOf } from './pane/sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { boardTimeline, boardText } from './board-model';
import { notificationTree } from './transcript/cards';
import { durationTree } from './restyle';
import { forgetPlaced, placedTree, placeFinished } from './transcript/placed';
import type { AtlasSnapshot } from './contract';

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

const BRAILLE_SPIN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const CIRCLES = /[◐◓◑◒]/;
const DIM = '#585858'; // 240
const RED = '#ff5f5f'; // 203
const GREEN = '#87d787'; // 114



import { assistantTree } from './restyle';
import { noteRunSecs, runCardPlaced } from './transcript/placed';

const GATES: never[] = [];
const withGates = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null = RUN, gates: unknown[] = GATES): string[] => {
  forgetRefusals();
  return textOf(sidebarTree(els, { ...model(s, view, columns, rows, run), gates: gates as never }, on) as unknown as Node).split('\n');
};
/** The stoprun shape of 28d53608: the plan rows name their worker only in the title, and no dispatch row carries that worker's name (the Agent tool had no `name`). */
const tailed = (s: never): never => ({ ...(s as object), todos: (s as { todos: { content: string; owner: string | null; origin?: string }[] }).todos.map((t) => (/^T[123] /.test(t.content) && t.owner ? { ...t, content: `${t.content} (${t.owner})`, owner: null } : t)) }) as never;
const withStatus = (s: never, id: string, status: string): never => ({ ...(s as object), todos: (s as { todos: { id: string }[] }).todos.map((t) => (t.id === id ? { ...t, status, completed_at: status === 'completed' ? (NOW - 30000) / 1000 + 12 : null } : t)) }) as never;
const board = (cols: number, s: never): string[] => { forgetPhases(); return withGates(s, 'board', cols, 41); };
const rowOf = (t: string[], re: RegExp): string => t.find((l) => re.test(l)) ?? '';
const glyphWord = (l: string): string => `${/[●■▲◇⠋-⠿]/.exec(l)?.[0] ?? ''} ${/\b(done|failed|blocked|killed|queued|running)\b/.exec(l)?.[1] ?? ''}`;

describe('step 1: one state per item at every width (critique 35: T2 `● done` at 150 and `▲ blocked` at 110 over a failed worker)', () => {
  test('a blocked row whose worker failed is `■ failed` at 150 and at 110', () => {
    for (const cols of [57, 38]) {
      const t2 = rowOf(board(cols, tailed(snap())), /T2 read ghost/);
      expect([cols, glyphWord(t2)]).toEqual([cols, '■ failed']); // 28d53608 at 110: `▲ blocked`
    }
  });
  test('the error colour: the glyph and the word of that row are 203', () => {
    for (const cols of [57, 38]) {
      forgetPhases();
      const all = texts(tree('board', cols, 41, tailed(snap())));
      expect(all.find((x) => x.t.includes('■') && x.color === RED)).toBeDefined();
      expect(all.find((x) => /^failed\s*$/.test(x.t) && x.color === RED)).toBeDefined();
    }
  });
  test('a row the lead closed over the dead worker reads the same at both widths, never the green `done`', () => {
    const closed = withStatus(tailed(snap()), '2', 'completed');
    const [a, b] = [57, 38].map((cols) => rowOf(board(cols, closed), /T2 read ghost/));
    expect(glyphWord(a!)).toBe(glyphWord(b!));
    expect(a).toMatch(/^\s*■ /); // 28d53608 at 150: `● done` in 114
  });
  test('an item the lead holds says `lead` in the secondary grey 245 in the owner column', () => {
    const short = ({ ...(snap() as object), todos: (snap() as unknown as { todos: { content: string }[] }).todos.map((t, i) => ({ ...t, content: /^T\d/.test(t.content) ? t.content.replace(/^(T\d) .*/, '$1 go') : 'dispatch row' })) }) as never;
    const t = board(57, short);
    expect(rowOf(t, /T4 go/)).toMatch(/running\s+lead\b/);
    expect(rowOf(t, /T5 go/)).toMatch(/queued\s+lead\b/);
    forgetPhases();
    expect(texts(tree('board', 57, 41, short)).find((x) => /^lead\s*$/.test(x.t))?.color).toBe('#8a8a8a');
  });
});

describe('step 2: the 110 board (critique 35: titles cut to `(alpha…`, an axis that stopped at 0:15 under a 0:26 bar)', () => {
  test('no title is cut at 110 and the `(agent)` suffix is gone', () => {
    const t = board(38, tailed(snap()));
    expect(t.join('\n')).not.toMatch(/\(alpha|\(beta|\(ghost|…\)/);
    expect(rowOf(t, /T1 read alpha/)).toMatch(/● T1 read alpha\.py\s+done/);
  });
  test('the axis runs one tick past the longest bar and its labels cover the whole span', () => {
    const agents = [{ name: 'alpha-explorer', state: 'done' as const, secs: 26, startMs: 0, endMs: 26_000 }, { name: 'ghost-explorer', state: 'failed' as const, secs: 10, startMs: 1_000, endMs: 11_000 }];
    for (const cols of [38, 57, 100]) {
      const t = boardText(boardTimeline(agents, { cols, ui }));
      const labels = [...t.at(-1)!.matchAll(/\d:\d\d/g)].map((m) => m[0]);
      const secs = labels.map((l) => Number(l.split(':')[0]) * 60 + Number(l.split(':')[1]));
      expect([cols, Math.max(...secs) >= 26]).toEqual([cols, true]); // 28d53608 at 110: `0:00  0:15`
      expect(cells(t.at(-1)!)).toBeLessThanOrEqual(cols); // wave 39: the lane runs to the pane's last cell
    }
  });
  test('the live board holds no run of more than 4 blank rows at a 41-row pane', () => {
    const t = board(57, snap());
    let run = 0; let worst = 0;
    for (const l of t) { run = l.trim() === '' ? run + 1 : 0; worst = Math.max(worst, run); }
    expect(worst).toBeLessThanOrEqual(4);
  });
});

type El = { children?: unknown[]; props?: Record<string, unknown> };
const flat = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as El).children ?? []).map(flat).join('') : '');

describe('step 3: one clock (critique 35: board 0:31, team axis 0:34, footers 0:08 and 0:31, band 0:39)', () => {
  const BAND: Run = { kind: 'working', secs: 39, startMs: NOW - 39000 };
  const withBand = (view: SidebarView): string[] => { forgetPhases(); return withGates(snap(), view, 57, 41, BAND); };
  test('the board total, the team axis end and the phase clock all print the band\'s seconds', () => {
    expect(withBand('board').at(-1)).toMatch(/total 0:39\b/);
    expect(withBand('team').find((l) => /^\s+0:00\s+0:\d\d\s*$/.test(l))).toMatch(/0:00\s+0:39\s*$/); // 28d53608: 0:34
    expect(withBand('route').find((l) => /^\s*phase\b/.test(l))).toMatch(/0:39$/);
  });
  test('the `▸ run` footer prints the band\'s clock and no partial `+N done`', () => {
    const s = { ...(snap('done') as object), counts: { done: 5, total: 5, byPhase: {} }, squad: [], activity: {} } as never;
    const own = flat(durationTree(s, { durationMs: 8000 }, { turnStart: NOW - 8000, runStart: NOW - 8000, done: 1 }, NOW, ui));
    expect(own).toMatch(/run 0:08 · \+4 done/); // no band clock known: the run's own
    const banded = flat(durationTree(s, { durationMs: 8000 }, { turnStart: NOW - 8000, runStart: NOW - 8000, done: 1 }, NOW, ui, 39));
    expect(banded).toMatch(/^▸ run 0:39\b/); // 28d53608: `▸ run 0:08 · +4 done`
    expect(banded).not.toMatch(/\+\d+ done/);
  });
});

const rec = (over: Record<string, unknown> = {}) => ({ ...(snap('verify') as object), todos: [], ...over }) as unknown as AtlasSnapshot;
const cleanAt = (now: number, calls: Record<string, number[]> = {}): AtlasSnapshot => ({
  ...(rec() as object), now, counts: { done: 5, total: 5, byPhase: {} },
  squad: [{ name: 'alpha-explorer', persona: 'explorer', state: 'finished', source: 'task' }, { name: 'beta-explorer', persona: 'explorer', state: 'finished', source: 'task' }],
  activity: { 'alpha-explorer': act({ startedAt: now - 52000, since: now - 40000, mood: 'done', calls: calls['alpha-explorer'] ?? [] }), 'beta-explorer': act({ startedAt: now - 30000, since: now - 5000, mood: 'done', calls: calls['beta-explorer'] ?? [] }) }, comms: [], todoGroups: [],
}) as unknown as AtlasSnapshot;
const runningAt = (now: number): AtlasSnapshot => ({ ...(cleanAt(now) as object), counts: { done: 3, total: 5, byPhase: {} }, squad: [{ name: 'alpha-explorer', persona: 'explorer', state: 'running', source: 'task' }, { name: 'beta-explorer', persona: 'explorer', state: 'running', source: 'task' }], activity: { 'alpha-explorer': act({ startedAt: now - 52000, since: now - 1000, mood: 'working' }), 'beta-explorer': act({ startedAt: now - 30000, since: now - 1000, mood: 'working' }) } }) as unknown as AtlasSnapshot;
const engine = (ids: string[]) => ({ ui: { place: async ({ id }: { id: string }) => { ids.push(id); return { isPlaced: true, requestId: id }; } } }) as never;

describe('step 4: one done line (critique 35: `▌ done complete` under the run card, `done … done`, alpha without calls)', () => {
  test('the run card reads `▌ ◆ ATLAS ● done 5/5 · 2 workers 0:47`: done once', async () => {
    forgetPlaced();
    const ids: string[] = [];
    await placeFinished(engine(ids), runningAt(NOW - 1000), cleanAt(NOW));
    const card = flat(placedTree(ids.find((i) => i.startsWith('done-run'))!, ui));
    expect(card).toMatch(/^▌ ◆ ATLAS\s+● done\s+5\/5 · 2 workers\s+0:47$/);
    expect(card.match(/done/g)).toHaveLength(1); // 28d53608: `done  run  5/5 done · 3 workers`
    forgetPlaced();
  });
  test('the lead\'s `done 5/5 · complete` chip draws no second line once the run card is placed', async () => {
    forgetPlaced();
    const ids: string[] = [];
    const chip = (text: string) => flat(assistantTree(cleanAt(NOW), { text }, 100, false, ui));
    expect(chip('done 5/5 · complete')).toMatch(/done/); // no card yet: the chip is the finish line
    await placeFinished(engine(ids), runningAt(NOW - 1000), cleanAt(NOW));
    expect(runCardPlaced()).toBe(true);
    expect(chip('done 5/5 · complete')).toBe(''); // 28d53608: `▌ done complete`
    expect(chip('done 5/5 · all finished')).toBe('');
    expect(chip('done 5/5 · two files changed')).toMatch(/two files changed/);
    forgetPlaced();
  });
  test('every worker finish card prints its calls, the late count included', async () => {
    resetWorkerFacts();
    forgetPlaced();
    const ids: string[] = [];
    await placeFinished(engine(ids), runningAt(NOW - 3000), cleanAt(NOW - 2000)); // the cards are placed before the calls are on the board
    const cards = (): string[] => ids.filter((i) => !i.startsWith('done-run')).map((i) => flat(placedTree(i, ui)));
    expect(cards()).toHaveLength(2);
    const before = cards();
    await placeFinished(engine(ids), cleanAt(NOW - 2000), cleanAt(NOW - 1000, { 'alpha-explorer': [1, 2, 3], 'beta-explorer': [1, 2, 3, 4] }));
    expect(cards()).toEqual(before); // truth 39: a count that arrives later never rewrites a placed card
    forgetPlaced();
    resetWorkerFacts();
    const ids2: string[] = [];
    const known = { 'alpha-explorer': [1, 2, 3], 'beta-explorer': [1, 2, 3, 4] };
    await placeFinished(engine(ids2), runningAt(NOW - 3000), cleanAt(NOW - 2000, known));
    const [alpha, beta] = ids2.filter((i) => !i.startsWith('done-run')).map((i) => flat(placedTree(i, ui)));
    expect(alpha).toMatch(/alpha-explorer.*0:\d\d · 3 calls$/); // 28d53608: alpha without `· 3 calls`, beta with `· 4 calls`: every card carries the count known when it was placed
    expect(beta).toMatch(/beta-explorer.*0:\d\d · 4 calls$/);
    forgetPlaced();
  });
  test('a count nobody knows reads `-` on its card, in the same column as the others', async () => {
    resetWorkerFacts();
    forgetPlaced();
    const ids: string[] = [];
    await placeFinished(engine(ids), runningAt(NOW - 3000), cleanAt(NOW - 1000, { 'beta-explorer': [1, 2, 3, 4] }));
    const cards = ids.filter((i) => !i.startsWith('done-run')).map((i) => flat(placedTree(i, ui)));
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatch(/alpha-explorer.*0:\d\d · -$/); // wave 37: alpha has no count; beta's own four stand
    expect(cards[1]).toMatch(/beta-explorer.*0:\d\d · 4 calls$/);
    forgetPlaced();
  });
});

describe('step 5: the status view (critique 35: `events · no events yet` over a board that listed `+0:19 ghost-explorer failed`)', () => {
  const rows = (s: never = snap(), run: Run = RUN, gates: unknown[] = GATES): string[] => { forgetPhases(); return withGates(s, 'route', 57, 41, run, gates); };
  const noPosts = (): never => ({ ...(snap() as object), notes: [] }) as never;
  test('events are the board\'s recent list, the failure row included, stamped on the run clock', () => {
    const t = rows(noPosts());
    const ev = t.slice(t.findIndex((l) => /^\s*events\s*$/.test(l)) + 1).filter((l) => /^\s+\+\d:\d\d\s/.test(l));
    expect(ev.length).toBeGreaterThan(0);
    expect(ev.join('\n')).toMatch(/\+0:\d\d\s+ghost-explorer\s+failed/);
    expect(t.join('\n')).not.toMatch(/no events yet/); // 28d53608
  });
  test('the last five events, never more', () => {
    const many = { ...(snap() as object), notes: Array.from({ length: 9 }, (_, i) => ({ seq: i + 1, ts: new Date(NOW - 50000 + i * 4000).toISOString(), owner: 'lead', to: 'all', text: `post number ${i + 1}` })) } as never;
    const t = rows(many);
    expect(t.slice(t.findIndex((l) => /^\s*events\s*$/.test(l)) + 1).filter((l) => /^\s+\+\d:\d\d\s/.test(l))).toHaveLength(5);
  });
  test('a gate that fails never reads as a passing sentence beside `warning`', () => {
    const gates = [{ id: 'routing', title: 'Tool routing', lines: [{ id: 'c', label: 'Dispatches followed the plan', ok: false }] }, { id: 'completion', title: 'Completion', lines: [{ id: 'a', label: 'Todos drained', ok: true }] }];
    const row = rows(snap(), RUN, gates).find((l) => /Tool routing/.test(l))!;
    expect(row).toMatch(/warning/);
    expect(row).not.toMatch(/warning\s+Dispatches followed the plan/); // 28d53608
    expect(row).toMatch(/not met: Dispatches/);
    const fixed = [{ id: 'routing', title: 'Tool routing', lines: [{ id: 'c', label: 'Dispatches followed the plan', ok: false, fix: 'dispatch through the planned team' }] }];
    expect(rows(snap(), RUN, fixed).find((l) => /Tool routing/.test(l))).toMatch(/warning\s+dispatch through/);
  });
  test('an empty channel is one dim line, and the status view says `0 messages`', () => {
    const none = { ...(snap() as object), squad: [], todos: [], notes: [], activity: {}, comms: [], members: [] } as never;
    expect(rows(none, { kind: 'idle', secs: 0, startMs: NOW }).filter((l) => /^\s*0 messages\s*$/.test(l))).toHaveLength(1);
    forgetPhases();
    const ch = withGates(none, 'channel', 57, 41, RUN);
    expect(ch.filter((l) => /no messages/.test(l))).toHaveLength(1);
    forgetPhases();
    expect(texts(tree('channel', 57, 41, none)).find((x) => /no messages/.test(x.t))?.color).toBe(DIM);
  });
  test('the pane keeps one width in every state and its rules are the 236 grey', () => {
    for (const run of [RUN, { kind: 'blocked', secs: 20, startMs: NOW - 20000 } as Run, { kind: 'done', secs: 52, startMs: NOW - 52000 } as Run, { kind: 'idle', secs: 0, startMs: NOW } as Run]) {
      forgetPhases();
      const root = tree('route', 57, 41, snap(), run);
      expect(root.props.width).toBe(56);
      for (const x of texts(root).filter((y) => /^─{3,}$/.test(y.t))) expect(x.color).toBe('#303030');
    }
  });
});
noteRunSecs(undefined);
