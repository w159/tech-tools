// Wave 37 (critique 36, build 9a2e6575): truthful, uniform cards, board and side panel. Each test names the 9a2e6575 defect it comes from.
import { describe, expect, test } from 'claude-code/testing';
import { resetWorkerFacts } from './data/live';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from './live_fixture';
import { forgetRefusals } from './data/channels';
import { type Ui } from './atlas-ui';
import { forgetPhases } from './pane/sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { boardLines, type BoardRow } from './board-model';
import { notificationTree } from './transcript/cards';
import { assistantTree, durationTree } from './restyle';
import { forgetPlaced, noteRunSecs, placedTree, placeFinished, runCardPlaced } from './transcript/placed';
import type { AtlasSnapshot } from './contract';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const texts = (n: Node, out: Array<{ t: string; color?: string }> = []): Array<{ t: string; color?: string }> => { if (n.kind === 'Text') out.push({ t: String(n.props.children ?? ''), color: n.props.color }); for (const k of kids(n)) texts(k, out); return out; };
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
const todo = (id: string, content: string, status: string, owner: string | null, c: number, d: number, extra: Record<string, unknown> = {}) => ({ id, content, status, owner, session_id: 's', claimed_at: (NOW - 30000) / 1000 + c, completed_at: status === 'completed' ? (NOW - 30000) / 1000 + d : null, ...extra });
const RED = '#ff5f5f'; // 203
const GREEN = '#87d787'; // 114

/** The stoprun shape: ghost-explorer failed, the lead holds T2 `blocked`, an open dispatch row no plan row owns and a finished one. */
const snap = (): never => ({
  ...busySnap(), phase: 'implement', now: NOW, channel: 'lc-w37', sessionId: 's',
  squad: [
    { name: 'alpha-explorer', persona: 'explorer', state: 'finished', source: 'task' },
    { name: 'ghost-explorer', persona: 'explorer', state: 'failed', source: 'task' },
    { name: 'beta-explorer', persona: 'explorer', state: 'finished', source: 'task' },
  ],
  activity: {
    lead: act({ mood: 'working', toolCount: 10, startedAt: NOW - 27000, calls: [NOW - 26000, NOW - 20000, NOW - 10000] }),
    'alpha-explorer': act({ startedAt: NOW - 27000, since: NOW - 16000, mood: 'done', calls: [NOW - 26000, NOW - 24000, NOW - 20000, NOW - 17000], toolCount: 4 }),
    'ghost-explorer': act({ startedAt: NOW - 26000, since: NOW - 16000, mood: 'failed', calls: [NOW - 25000, NOW - 20000], toolCount: 2 }),
    'beta-explorer': act({ startedAt: NOW - 14000, since: NOW - 7000, mood: 'done', calls: [NOW - 13000, NOW - 9000, NOW - 8000], toolCount: 3 }),
  },
  todos: [
    todo('1', 'T1 read alpha.py', 'completed', 'alpha-explorer', 0, 11), todo('2', 'T2 read ghost.py', 'blocked', 'ghost-explorer', 1, 12), todo('3', 'T3 read beta.py', 'completed', 'beta-explorer', 13, 20),
    todo('4', 'T4 combine the reports', 'in_progress', null, 21, 22), todo('5', 'T5 write the final summary (lead)', 'pending', null, 22, 23),
    todo('6', 'Read ghost.py first, then README.md', 'pending', 'explorer-f3da', 24, 24, { origin: 'dispatch' }),
    todo('7', 'List the function names defined in alpha.py', 'completed', 'alpha-explorer', 0, 11, { origin: 'dispatch' }),
  ],
  notes: [],
}) as never;
type Run = NonNullable<SidebarModel['run']>;
const RUN: Run = { kind: 'working', secs: 57, startMs: NOW - 57000 };
const model = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null = RUN): SidebarModel => ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows, look: ui, ...(run ? { run } : {}) } as SidebarModel);
const tree = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN): Node => { forgetRefusals(); return sidebarTree(els, model(s, view, columns, rows, run), on) as unknown as Node; };
const render = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN): string[] => textOf(tree(view, columns, rows, s, run)).split('\n');

type El = { children?: unknown[]; props?: Record<string, unknown> };
const flat = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as El).children ?? []).map(flat).join('') : '');
const rec = (over: Record<string, unknown> = {}) => ({ ...(snap() as object), todos: [], ...over }) as unknown as AtlasSnapshot;
const cleanAt = (now: number, names: string[], calls: Record<string, number[]> = {}): AtlasSnapshot => ({
  ...(rec() as object), now, counts: { done: 5, total: 5, byPhase: {} },
  squad: names.map((name) => ({ name, persona: 'explorer', state: 'finished', source: 'task' })),
  activity: Object.fromEntries(names.map((name, i) => [name, act({ startedAt: now - 42000 + i * 1000, since: now - 5000, mood: 'done', calls: calls[name] ?? [] })])), comms: [], todoGroups: [],
}) as unknown as AtlasSnapshot;
const runningAt = (now: number, names: string[]): AtlasSnapshot => ({ ...(cleanAt(now, names) as object), counts: { done: 3, total: 5, byPhase: {} }, squad: names.map((name) => ({ name, persona: 'explorer', state: 'running', source: 'task' })), activity: Object.fromEntries(names.map((name, i) => [name, act({ startedAt: now - 42000 + i * 1000, since: now - 1000, mood: 'working' })])) }) as unknown as AtlasSnapshot;
const engine = (ids: string[], invalidated: string[] = []) => ({ ui: { place: async ({ id }: { id: string }) => { ids.push(id); return { isPlaced: true, requestId: id }; }, invalidate: (k: string) => { invalidated.push(k); } } }) as never;
const NAMES = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'];

describe('step 1: one done line (critique 36: `◆ ATLAS ● done 5/5 · 3 workers 0:42` and then `▌ done 5/5`)', () => {
  const chip = (text: string): string => flat(assistantTree(cleanAt(NOW, NAMES), { text }, 100, false, ui));
  test('the bare count and its restatements draw no second line once the run card is placed', async () => {
    forgetPlaced();
    const ids: string[] = [];
    await placeFinished(engine(ids), runningAt(NOW - 1000, NAMES), cleanAt(NOW, NAMES));
    expect(runCardPlaced()).toBe(true);
    for (const t of ['done 5/5', 'done 5/5 · complete', 'done 5/5 · 5/5', 'done 5/5 · run complete', 'done 5/5 · all done']) expect([t, chip(t)]).toEqual([t, '']);
    expect(chip('done 5/5 · two files changed')).toMatch(/two files changed/); // a sentence that adds something stays
    forgetPlaced();
  });
  test('the chip drawn before the card existed is asked to draw again when the card lands', async () => {
    forgetPlaced();
    const ids: string[] = [];
    const redraw: string[] = [];
    expect(chip('done 5/5')).toMatch(/done/); // no card yet: the chip is the finish line
    await placeFinished(engine(ids, redraw), runningAt(NOW - 1000, NAMES), cleanAt(NOW, NAMES));
    expect(redraw).toContain('ui.render');
    forgetPlaced();
  });
});

describe('step 2: uniform cards (critique 36: beta without a count beside gamma with `3 calls`)', () => {
  test('every worker card ends in the calls column: the count, or a dash when it is unknown', async () => {
    resetWorkerFacts();
    forgetPlaced();
    const ids: string[] = [];
    await placeFinished(engine(ids), runningAt(NOW - 3000, NAMES), cleanAt(NOW - 1000, NAMES, { 'gamma-explorer': [1, 2, 3], 'alpha-explorer': [1] }));
    const cards = ids.filter((i) => !i.startsWith('done-run')).map((i) => flat(placedTree(i, ui, false, { cols: 80 })));
    expect(cards).toHaveLength(3);
    for (const c of cards) expect(c).toMatch(/(\d+ calls?|-)$/);
    expect(cards.map((c) => /(\d+ calls?|-)$/.exec(c)![1])).toEqual(['1 call', '-', '3 calls']);
    const right = cards.map((c) => c.length);
    expect(new Set(right).size).toBeLessThanOrEqual(2); // every card is one row of the same width but for the count's own width
    forgetPlaced();
  });
  test('a failed card has the column too', () => {
    resetWorkerFacts();
    const card = flat(notificationTree('ghost-explorer', 'explorer', 'killed · 6s', true, ui, false, { cols: 80 }));
    expect(card).toMatch(/■ failed {2}ghost-explorer\s+0:06 · -$/);
    expect(flat(notificationTree('ghost-explorer', 'explorer', 'killed · 6s', true, ui, false, { cols: 80, calls: 2 }))).toMatch(/0:06 · 2 calls$/);
  });
});

describe('step 3: the run card clock (critique 36: card 0:42, band 0:43)', () => {
  test('the card prints the band\'s run seconds, as the closing footer does', async () => {
    forgetPlaced();
    noteRunSecs(43);
    const ids: string[] = [];
    await placeFinished(engine(ids), runningAt(NOW - 1000, NAMES), cleanAt(NOW, NAMES)); // the workers' own span is 0:42
    const card = flat(placedTree(ids.find((i) => i.startsWith('done-run'))!, ui));
    const footer = flat(durationTree(rec({ counts: { done: 5, total: 5, byPhase: {} }, squad: [], activity: {} }), { durationMs: 8000 }, {}, NOW, ui, 43));
    expect(card).toMatch(/0:43$/);
    expect(footer).toMatch(/run 0:43\b/);
    noteRunSecs(44); // the band moved on: the card follows it on the same render
    expect(flat(placedTree(ids.find((i) => i.startsWith('done-run'))!, ui))).toMatch(/0:44$/);
    forgetPlaced();
  });
});

describe('step 4: events (critique 36: `no events yet · 0 messages` after three agents finished)', () => {
  test('a worker that finished is an event, and the empty line is gone', () => {
    forgetPhases();
    const t = render('route', 57, 41);
    expect(t.join('\n')).not.toMatch(/no events yet/);
    const ev = t.filter((l) => /^\s+\+\d:\d\d\s/.test(l));
    expect(ev.some((l) => /alpha-explorer\s+done/.test(l))).toBe(true);
    expect(ev.some((l) => /beta-explorer\s+done/.test(l))).toBe(true);
    expect(ev.some((l) => /ghost-explorer\s+failed/.test(l))).toBe(true);
    expect(t.find((l) => /^\s+\d+ messages?\s*$/.test(l))).toMatch(/^\s+1 message\s*$/); // the channel's own count stays the channel's: the one failure post, not the finishes
  });
  test('an event keeps the stamp it was first drawn with (critique 36: +0:20, +0:19, +0:18 across frames)', () => {
    forgetPhases();
    const stamps = (run: Run): string[] => render('route', 57, 41, snap(), run).filter((l) => /^\s+\+\d:\d\d\s/.test(l)).map((l) => l.trim());
    const first = stamps({ kind: 'working', secs: 57, startMs: NOW - 57000 });
    expect(first.length).toBeGreaterThan(0);
    // The band's run start is the snapshot clock less the elapsed time: once the run stops counting it moves on with every frame.
    for (const drift of [1000, 2000, 3000]) expect(stamps({ kind: 'working', secs: 57, startMs: NOW - 57000 + drift })).toEqual(first);
  });
});

describe('step 5: the board meter and header (critique 36: all green over a failed T2, `2 dispatches` over one row)', () => {
  test('the meter is 114 for the items done and one 203 cell per failed item', () => {
    forgetPhases();
    const all = texts(tree('board', 38, 41));
    const meter = all.filter((x) => /^[▰▱]+$/.test(x.t));
    const bad = meter.filter((x) => x.color === RED).map((x) => x.t).join('');
    const ok = meter.filter((x) => x.color === GREEN).map((x) => x.t).join('');
    expect(bad).toBe('▰'); // T2 is the one failed item
    expect(ok).toBe('▰▰▰'); // T1 and T3 are done: 2 of 5 of 8 cells
    expect(meter.map((x) => x.t).join('')).toHaveLength(8);
  });
  test('a board with nothing failed keeps the all-green meter', () => {
    const rows: BoardRow[] = ['T1 a', 'T2 b'].map((label) => ({ label, state: 'done', owner: '', detail: '' }));
    const l = boardLines(rows, { cols: 60, ui, pane: true, ribbon: false, title: false });
    const runs = l[0]!.runs.filter((x) => /^▰+$/.test(x.t));
    expect(runs.map((x) => x.tone)).toEqual(['ok']);
  });
  test('the header counts the dispatch rows the pane lists', () => {
    forgetPhases();
    const t = render('board', 38, 41);
    const head = t.find((l) => /\bitems?\b/.test(l) && /dispatch/.test(l)) ?? '';
    const n = Number(/(\d+) dispatch/.exec(head)?.[1] ?? '0');
    const at = t.findIndex((l) => /^\s*dispatches\s*$/.test(l));
    expect(at).toBeGreaterThan(0);
    let listed = 0;
    for (let i = at + 1; i < t.length && t[i]!.trim() !== ''; i++) listed++;
    expect(listed).toBe(1); // the finished dispatch row is folded away
    expect(n).toBe(listed);
  });
});

describe('step 6: the 110 board (critique 36: beta\'s bar missing, axis 0:30 under a 0:36 total, `(agent)` titles, `3 tool calls` beside `lead 10 calls`)', () => {
  const run36: Run = { kind: 'working', secs: 36, startMs: NOW - 36000 };
  const board = (cols: number, rows: number, run: Run = run36): string[] => { forgetPhases(); return render('board', cols, rows, snap(), run); };
  test('every agent has a bar', () => {
    for (const rows of [41, 30, 24]) {
      const t = board(38, rows);
      for (const name of ['lead', 'alpha', 'ghost', 'beta']) expect([rows, name, t.some((l) => new RegExp(`\\b${name}\\s.*▇`).test(l))]).toEqual([rows, name, true]);
    }
  });
  test('the axis ends one tick past the run total', () => {
    const t = board(38, 41);
    const axis = t.findIndex((l) => /┬/.test(l));
    const secs = [...t[axis + 1]!.matchAll(/(\d+):(\d\d)/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
    expect(Math.max(...secs)).toBeGreaterThan(36);
  });
  test('no title carries its agent in parentheses', () => {
    const t = board(38, 41).join('\n');
    expect(t).not.toMatch(/\((lead|\w+-explorer)\)/);
    expect(t).toMatch(/T5 write the final/); // the pane's room still cuts a 26-cell title (`…`), but never on the suffix
  });
  test('the footer and the team total both say worker calls, and agree', () => {
    const foot = board(57, 41).at(-1)!;
    const n = /(\d+) worker calls/.exec(foot)?.[1];
    expect(n).toBeDefined();
    forgetPhases();
    const team = render('team', 57, 41, snap(), run36).find((l) => /^\s+total\s/.test(l)) ?? '';
    expect(/(\d+) worker calls/.exec(team)?.[1]).toBe(n);
    expect(n).toBe('9'); // 4 + 2 + 3: the lead's own ten are not in it, and the label says so
  });
});

describe('step 7: the live board leaves no blank band above the footer (critique 36: ~25%)', () => {
  test('the footer row follows the content: no run of blank rows longer than 2', () => {
    forgetPhases();
    const t = render('board', 38, 60);
    let run = 0; let worst = 0;
    for (const l of t) { run = l.trim() === '' ? run + 1 : 0; worst = Math.max(worst, run); }
    expect(worst).toBeLessThanOrEqual(2);
    const foot = t.findLastIndex((l) => /\d+ done/.test(l));
    expect(foot).toBeGreaterThan(0);
    expect(t.slice(foot + 1).every((l) => l.trim() === '')).toBe(true);
  });
});
