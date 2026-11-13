// Wave 39 (critique 38, build 63934f09): the board tab's Gantt agrees with the run total, uses the pane width and names a dispatch row's worker state.
// Each test names the 63934f09 defect it comes from (stoprun-150-3 and stoprun-110-1 tab-board.png).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from './live_fixture';
import { forgetRefusals } from './data/channels';
import { cells, type Ui } from './atlas-ui';
import { forgetPhases } from './pane/sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './pane/sidebar';
import { boardRowsOf, boardText, boardTimeline, toBoardRow } from './board-model';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
const todo = (id: string, content: string, status: string, owner: string | null, c: number, d: number, extra: Record<string, unknown> = {}) => ({ id, content, status, owner, session_id: 's', claimed_at: (NOW - 36000) / 1000 + c, completed_at: status === 'completed' ? (NOW - 36000) / 1000 + d : null, ...extra });

/** The stoprun shape at its end: the run is 0:36, the lead's own tool clock is 0:31, ghost failed, its dispatch row (owned by the host's member id `explorer-f3da`, created as ghost started) is still pending. */
const stop = (): never => ({
  ...busySnap(), phase: 'implement', now: NOW, channel: 'lc-w39', sessionId: 's',
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
    todo('1', 'T1 read alpha.py', 'completed', 'alpha-explorer', 0, 11), todo('2', 'T2 read ghost.py', 'blocked', 'ghost-explorer', 1, 12), todo('3', 'T3 read beta.py', 'completed', 'beta-explorer', 13, 20),
    todo('4', 'T4 combine the reports', 'pending', null, 21, 22), todo('5', 'T5 write the final summary', 'pending', null, 22, 23),
    todo('6', 'Read ghost.py first, then README.md', 'pending', 'explorer-f3da', 24, 24, { origin: 'dispatch', created_at: (NOW - 26000) / 1000 + 0.1 }),
    todo('7', 'Write the closing summary notes', 'pending', 'explorer-zz99', 24, 24, { origin: 'dispatch', created_at: (NOW - 1000) / 1000 }),
  ],
  notes: [],
}) as never;
type Run = NonNullable<SidebarModel['run']>;
const RUN: Run = { kind: 'done', secs: 36, startMs: NOW - 36000 };
const model = (s: never, columns: number, rows: number, run: Run): SidebarModel => ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'board' }, columns, rows, look: ui, run } as SidebarModel);
const render = (columns: number, rows = 45, run: Run = RUN): string[] => { forgetRefusals(); forgetPhases(); return textOf(sidebarTree(els, model(stop(), columns, rows, run), on) as unknown as Node).split('\n'); };
const laneOf = (l: string): string => [...l].slice(13).join('');
const LANE = /^ . \w+\s+[▇▓▒┊ ]*▇/; // the mark (blank for a failed worker the plan row already names), the short name, the lane

describe('step 1: the lead lane ends at the run total and says it (stoprun-150-3: lead 0:23 over a 0:36 footer; stoprun-110-1: 0:36 over 0:48)', () => {
  for (const columns of [57, 38]) {
    test(`${columns === 57 ? 150 : 110} cols: the lead's bar ends at the run total, its figure is the footer's`, () => {
      const t = render(columns);
      const lead = t.findIndex((l) => /^ . lead\s/.test(l) && /▇/.test(l));
      expect(lead).toBeGreaterThanOrEqual(0);
      const foot = t.find((l) => / · (?:total )?\d+:\d\d/.test(l))!;
      const total = / · (?:total )?(\d+:\d\d)/.exec(foot)![1]!;
      expect(total).toBe('0:36');
      expect(t[lead + 1]).toMatch(new RegExp(`^ {13}\\s*${total}\\b`)); // the lead's own clock reads 0:31: the lane says the run's
      expect(t.some((l) => /^ . lead\s.*0:31/.test(l) || /^ {13}\s*0:31\b/.test(l))).toBe(false);
      const axis = t.findIndex((l) => /┬/.test(l));
      const ticks = [...t[axis]!].map((c, i) => (c === '┬' ? i : -1)).filter((i) => i >= 0);
      const plotW = ticks.at(-1)! - ticks[0]!;
      const axisEnd = Number(/^\s*0:00.*?(\d+):(\d\d)\s*$/.exec(t[axis + 1]!)![2]) + 60 * Number(/(\d+):(\d\d)\s*$/.exec(t[axis + 1]!)![1]);
      expect(axisEnd).toBe(36); // state 40: the axis ends on the run total, not the next 10 s
      const filled = [...laneOf(t[lead]!)].filter((c) => c === '▇').length;
      expect(filled).toBe(plotW); // 0:36 of 0:36, not 0:31
    });
  }
  test('the helper: a total lane runs from the first start to runSecs whatever its own clock says', () => {
    const t = boardText(boardTimeline([{ name: 'lead', state: 'done', secs: 23, startMs: 5000, endMs: 28_000, total: true }, { name: 'a-explorer', state: 'done', secs: 20, startMs: 0, endMs: 20_000 }], { cols: 60, ui, runSecs: 36, spark: true }));
    const lead = t.find((l) => /^ . lead\s/.test(l))!;
    const axis = t.findIndex((l) => /┬/.test(l));
    const plotW = t[axis]!.lastIndexOf('┬') - t[axis]!.indexOf('┬');
    expect([...laneOf(lead)].filter((c) => c === '▇')).toHaveLength(plotW);
    expect(t.some((l) => /^ {13}0:36 · /.test(l) || /^ {13}0:36$/.test(l))).toBe(true);
  });
});

describe('step 2: gridlines (the stray `│` ticks in every lane)', () => {
  for (const columns of [57, 38]) {
    test(`${columns === 57 ? 150 : 110} cols: no \`│\` inside a lane, a \`┊\` only at a 10 s axis tick, in a cell the bar leaves empty`, () => {
      const t = render(columns);
      const axis = t.findIndex((l) => /┬/.test(l));
      const tickAt = new Set([...t[axis]!].map((c, i) => (c === '┬' ? i : -1)).filter((i) => i >= 0));
      const lanes = t.filter((l) => LANE.test(l));
      expect(lanes.length).toBe(4);
      let grid = 0;
      for (const l of lanes) {
        expect(laneOf(l)).not.toMatch(/│/);
        [...l].forEach((c, i) => { if (c === '┊') { grid++; expect(tickAt.has(i)).toBe(true); } });
      }
      expect(grid).toBeGreaterThan(0);
      // the bar wins: a tick column under a bar cell holds the bar
      const lead = lanes.find((l) => /lead/.test(l))!;
      expect([...lead].filter((c, i) => tickAt.has(i) && c === '┊').length).toBeLessThan(tickAt.size);
    });
  }
  test('the gridline is the 240 grey and the ASCII form uses a colon', () => {
    const agents = [{ name: 'a-explorer', state: 'done' as const, secs: 31, startMs: 0, endMs: 31_000 }, { name: 'b-explorer', state: 'done' as const, secs: 5, startMs: 0, endMs: 5000 }];
    const lines = boardTimeline(agents, { cols: 60, ui });
    const grid = lines.flatMap((l) => l.runs).filter((x) => /^┊+$/.test(x.t));
    expect(grid.length).toBeGreaterThan(0);
    expect(grid.every((x) => x.tone === 'dim')).toBe(true);
    const plain = boardText(boardTimeline(agents, { cols: 60, ui: { ...ui, ascii: true } })).join('\n');
    expect(plain).toMatch(/:/);
    expect(plain).not.toMatch(/[│┊]/);
  });
});

describe('step 3: the lane takes the pane (stoprun-110-1: a 12-cell lane, 1-3 cell bars, 2 axis labels)', () => {
  test('the label column is at most 14 cells and the lane is every cell right of it, at 38 and at any width', () => {
    for (const cols of [38, 37, 57, 100, 150]) {
      const t = boardTimeline([{ name: 'lead', state: 'done', secs: 36, startMs: 0, total: true }, { name: 'alpha-explorer', state: 'done', secs: 13, startMs: 9000, endMs: 22_000 }, { name: 'beta-explorer', state: 'done', secs: 11, startMs: 22_000, endMs: 33_000 }], { cols, ui, runSecs: 36 });
      const lanes = t.filter((l) => l.runs.some((x) => /▇/.test(x.t)));
      expect(lanes).toHaveLength(3);
      for (const l of lanes) expect([cols, l.runs.reduce((n, x) => n + cells(x.t), 0)]).toEqual([cols, cols]); // the row fills the pane
      for (const l of lanes) { const head = l.runs.findIndex((x) => /▇|┊/.test(x.t)); expect(l.runs.slice(0, head).reduce((n, x) => n + cells(x.t), 0)).toBeLessThanOrEqual(14); } // the label column
    }
  });
  test('110 pane: the lane is at least the pane width less 14 and every agent has a bar longer than 3 cells', () => {
    const t = render(38);
    const lanes = t.filter((l) => LANE.test(l));
    expect(lanes).toHaveLength(4);
    for (const l of lanes) {
      expect(cells(laneOf(l))).toBeGreaterThanOrEqual(38 - 14);
      expect([...laneOf(l)].filter((c) => c === '▇').length).toBeGreaterThan(3);
    }
  });
  test('the axis labels every other 10 s tick when they fit, the end of the axis among them', () => {
    const t = render(38);
    const axis = t.findIndex((l) => /┬/.test(l));
    const ticks = [...t[axis]!].filter((c) => c === '┬').length;
    const labels = t[axis + 1]!.match(/\d+:\d\d/g)!;
    expect(ticks).toBe(5);
    expect(labels.length).toBeGreaterThanOrEqual(Math.ceil(ticks / 2));
    expect(labels[0]).toBe('0:00');
    expect(labels.at(-1)).toBe('0:36');
    expect(cells(t[axis + 1]!)).toBeLessThanOrEqual(38);
  });
  test('the time leaves the lane: at the bar end where no caption row stands, under it with the calls where one does', () => {
    const agents = [{ name: 'alpha-explorer', state: 'done' as const, secs: 13, startMs: 0, endMs: 13_000, calls: [1, 2] }, { name: 'beta-explorer', state: 'done' as const, secs: 26, startMs: 0, endMs: 26_000, calls: [1] }]; // the axis ends on the longest bar, so a shorter one leaves room for its time
    const plain = boardText(boardTimeline(agents, { cols: 38, ui, spark: false }));
    expect(plain[0]).toMatch(/^ ● alpha {5}▇+ 0:13/);
    const caps = boardText(boardTimeline(agents, { cols: 38, ui, spark: true }));
    expect(caps.some((l) => /^ {13}0:13 · 2 calls$/.test(l))).toBe(true);
  });
  test('short names: the role tail goes while the names stay apart', () => {
    const named = (names: string[]): string[] => boardText(boardTimeline(names.map((name, i) => ({ name, state: 'done' as const, secs: 5, startMs: i * 1000, endMs: 5000 + i * 1000 })), { cols: 60, ui })).filter((l) => /▇/.test(l)).map((l) => l.slice(3, 12).trim());
    expect(named(['alpha-explorer', 'ghost-explorer'])).toEqual(['alpha', 'ghost']);
    expect(named(['alpha-explorer', 'alpha-verifier']).every((n) => /^alpha-/.test(n))).toBe(true);
  });
});

describe('step 4: a dispatch row follows its worker (stoprun-110-1: `◇ Read ghost.py first… queued` beside a failed ghost)', () => {
  const dispatchLine = (t: string[], re: RegExp): string => t.find((l) => re.test(l))!;
  for (const columns of [57, 38]) {
    test(`${columns === 57 ? 150 : 110} cols: the dispatch whose worker failed reads \`■ failed\`, one with no worker yet reads queued`, () => {
      const t = render(columns);
      expect(dispatchLine(t, /Read ghost\.py first/)).toMatch(/■ Read ghost\.py first.*\bfailed\b/);
      expect(dispatchLine(t, /Read ghost\.py first/)).not.toMatch(/queued/);
      expect(dispatchLine(t, /Write the closing/)).toMatch(/◇ Write the closing.*\bqueued\b/);
    });
  }
  test('the row word is the worker\'s word: failed, running, done; queued only with no worker', () => {
    const d = (ownerState?: 'failed' | 'running' | 'done' | 'queued') => toBoardRow({ content: 'Read x first', status: 'pending', owner: 'explorer-1', origin: 'dispatch', ...(ownerState ? { ownerState } : {}) });
    expect(d('failed')).toMatchObject({ state: 'failed' });
    expect(d('running')).toMatchObject({ state: 'running' });
    expect(d('done')).toMatchObject({ state: 'done' });
    expect(d('queued')).toMatchObject({ state: 'queued' });
    expect(d()).toMatchObject({ state: 'queued' });
    // a plan row is untouched: an open plan row over a finished worker is not closed by it
    expect(toBoardRow({ content: 'T1 x', status: 'pending', owner: 'a', ownerState: 'done' })).toMatchObject({ state: 'queued' });
    expect(boardRowsOf([{ content: 'Read x first', status: 'pending', owner: 'explorer-1', origin: 'dispatch', ownerState: 'failed' }])[0]).toMatchObject({ state: 'failed', dispatch: true });
  });
  test('a dispatch row is matched to a worker only by the start it follows: no created_at, no worker', () => {
    const s = stop() as unknown as { todos: Record<string, unknown>[] };
    s.todos = s.todos.map((x) => (x.origin === 'dispatch' ? { ...x, created_at: undefined } : x));
    forgetRefusals(); forgetPhases();
    const t = textOf(sidebarTree(els, model(s as never, 57, 45, RUN), on) as unknown as Node).split('\n');
    expect(dispatchLine(t, /Read ghost\.py first/)).toMatch(/queued/);
  });
});
