// Critique 17, slice A (build a4fad2f9): row truth, the blocked glyph, the board's open dispatch row, the band's blocked text, the route phase, plain words.
// Shapes: stoprun-150-a4fad2f9-2 (T2 ghost fades to done while ghost failed), stoprun-150-a4fad2f9-3 (band `todo 4/5 · ■1` with 13 blank columns, f0091 to f0097),
// live-150-a4fad2f9-1 (tab-core.png, tab-gates.png).
import { describe, expect, test } from 'claude-code/testing';
import type { TodoItem } from './contract';
import { DONE_DOUBT, DONE_KILLED, markOf, motionState, rowWordTone, stateGlyph, stateRun, STATE_ASCII, STATE_GLYPHS, STATE_TOKEN, WORKER_FAILED, cells, type Ui } from './atlas-ui';
import { boardBody, boardLines, boardMotionItems, boardOpenFolded, boardRowsOf, boardText, toBoardRow, type BoardSource } from './board-model';
import { openRowName, ownPlan, todoState } from './data/todos';
import { plannedText } from './data/core';
import { hudLines, type HudAgent } from './hud';
import { bandLines, runsText, type MissionModel } from './mission-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
const plain = (runs: readonly { t: string }[]): string => runs.map((x) => x.t).join('');

describe('A1: a completed row whose worker failed is never the plain green done', () => {
  test('todoState: completed + failed owner reads done with the doubt word; a sound owner stays plain', () => {
    expect(todoState('completed', 'failed')).toEqual({ state: 'done', word: DONE_DOUBT });
    expect(todoState('completed', 'done')).toEqual({ state: 'done' });
    expect(todoState('completed')).toEqual({ state: 'done' });
    // the T3 case (stoprun-150-562576ed-2, critique 18 B3): the store holds `pending`, the worker was killed: the row stays queued and the owner is named failed beside it
    expect(todoState('pending', 'failed')).toEqual({ state: 'queued', word: 'worker failed' }); // critique 19 A3
    expect(todoState('in_progress', 'failed')).toEqual({ state: 'failed' });
  });
  test('the mark is amber warn, the word is amber, and it is its own motion entry (no fade-to-done pop)', () => {
    expect(markOf('done', DONE_DOUBT)).toBe('doubt');
    expect(markOf('done')).toBe('done');
    expect(rowWordTone('done', DONE_DOUBT)).toBe('warn');
    expect(rowWordTone('done')).toBe('sub');
    expect(stateRun(markOf('done', DONE_DOUBT), ui).tone).toBe('warn');
    expect(stateRun('done', ui).tone).toBe('ok');
    expect(stateGlyph('doubt', ui)).toBe(STATE_GLYPHS.done);
    expect(motionState('done', DONE_DOUBT)).toBe('doubt');
    expect(motionState('done')).toBe('done');
  });
  // stoprun-150-a4fad2f9-2 f0084 / tab-board.png: `T2 read ghost.py (ghost-explorer)` completed while SUBAGENTS says ghost failed.
  const plan: TodoItem[] = [
    { id: 't1', content: 'T1 read alpha.py (alpha-explorer)', status: 'completed', owner: 'alpha-explorer' },
    { id: 't2', content: 'T2 read ghost.py (ghost-explorer)', status: 'completed', owner: 'ghost-explorer' },
  ] as TodoItem[];
  const agents: HudAgent[] = [{ name: 'alpha-explorer', role: 'explorer', state: 'done' }, { name: 'ghost-explorer', role: 'explorer', state: 'failed' }];
  test('HUD: T2 reads `done` in the warn tone with `done · worker killed`, not struck through; T1 stays the quiet struck done', () => {
    const rows = hudLines({ todos: plan, agents }, { cols: 150, maxRows: 60, ui, now: 0 });
    const t2 = rows.find((r) => plain(r).includes('T2 read ghost.py'))!;
    const t1 = rows.find((r) => plain(r).includes('T1 read alpha.py'))!;
    expect(plain(t2)).toContain('done · worker killed');
    expect(t2.find((x) => x.t.trim() === DONE_KILLED)?.tone).toBe('warn');
    expect(t2.find((x) => x.t.includes('T2 read ghost.py'))?.strike).toBeFalsy();
    expect(t2.find((x) => x.t.trim() === STATE_GLYPHS.done)?.tone).toBe('warn');
    expect(t1.find((x) => x.t.includes('T1 read alpha.py'))?.strike).toBe(true);
    expect(t1.find((x) => x.t.trim() === STATE_GLYPHS.done)?.tone).toBe('ok');
  });
  test('Board: the same row reads `done`, `worker killed`, amber; the dispatch row beside it does not make it green', () => {
    const items: BoardSource[] = [
      { content: 'T2 read ghost.py (ghost-explorer)', status: 'completed' },
      { content: 'Read ghost.py first', status: 'completed', owner: 'ghost-explorer', origin: 'dispatch', ownerState: 'failed' }, // stoprun-150-a4fad2f9-2: the lead closed the dispatch row after the Stop refusal
    ];
    const rows = boardRowsOf(items);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'done', word: DONE_DOUBT, detail: WORKER_FAILED, owner: 'ghost-explorer' });
    const body = boardBody(rows, { cols: 120, ui });
    const row = body.find((l) => plain(l.runs).includes('T2 read ghost.py'))!;
    expect(plain(row.runs)).toMatch(/done\s+ghost-explorer\s+worker killed/);
    expect(row.runs.find((x) => x.t.trim() === 'done')?.tone).toBe('warn');
    expect(row.runs.find((x) => x.t.includes('T2 read ghost.py'))?.strike).toBeFalsy();
    expect(boardMotionItems(rows)[0]!.state).toBe('doubt');
  });
  test('Board: an open dispatch row stays its own row and the plan row it belongs to still reads the doubt', () => {
    const rows = boardRowsOf([
      { content: 'T2 read ghost.py (ghost-explorer)', status: 'completed' },
      { content: 'Read ghost.py first', status: 'failed', owner: 'ghost-explorer', origin: 'dispatch', ownerState: 'failed' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ state: 'done', word: DONE_DOUBT, detail: WORKER_FAILED });
    expect(rows[1]).toMatchObject({ state: 'failed' });
  });
  test('Board: a row done by its own owner keeps `ran mm:ss` and the quiet struck done', () => {
    const row = toBoardRow({ content: 'T1 read alpha.py', status: 'completed', owner: 'alpha-explorer', claimed_at: 100, completed_at: 160, ownerState: 'done' });
    expect(row).toMatchObject({ state: 'done', detail: 'ran 01:00' });
    expect(row.word).toBeUndefined();
  });
});

describe('A2: blocked has its own glyph, distinct from failed', () => {
  test('▣ for blocked, ■ for failed; ASCII # for blocked, x for failed; blocked has its own tone (critique 18 B3), failed stays bad', () => {
    expect([STATE_GLYPHS.blocked, STATE_GLYPHS.failed]).toEqual(['▣', '■']);
    expect([STATE_ASCII.blocked, STATE_ASCII.failed]).toEqual(['#', 'x']);
    expect([STATE_TOKEN.blocked, STATE_TOKEN.failed]).toEqual(['block', 'bad']);
    expect(stateRun('blocked', ui)).toEqual({ t: '▣', tone: 'block' });
    expect(stateRun('failed', ui)).toEqual({ t: '■', tone: 'bad' });
    expect(stateRun('blocked', ascii).t).not.toBe(stateRun('failed', ascii).t);
    expect(new Set(Object.values(STATE_GLYPHS)).size).toBe(Object.keys(STATE_GLYPHS).length);
  });
  test('one cell wide each', () => {
    expect([cells('▣'), cells('■')]).toEqual([1, 1]);
  });
});

describe('A3: the board unfolds and names the open dispatch row', () => {
  // stoprun-150-a4fad2f9-3/tab-board.png: the footer read only an amber `1 dispatch open`.
  const items: BoardSource[] = [
    { content: 'T1 read alpha.py (alpha-explorer)', status: 'completed' },
    { content: 'T2 read ghost.py (ghost-explorer)', status: 'blocked' },
    { content: 'List the function names defined in alpha.py.', status: 'completed', owner: 'alpha-explorer', origin: 'dispatch' },
    { content: 'Read ghost.py first (it does not exist), then, one Read call at a time, README.md and only then report.', status: 'pending', owner: 'ghost-explorer', origin: 'dispatch' },
  ];
  test('the footer lists the open row by the plan title and its worker', () => {
    expect(boardOpenFolded(items)).toBe(1);
    const text = boardText(boardLines(boardRowsOf(items), { cols: 100, ui, openFolded: 1, folded: 2 }));
    expect(text).toContain('  1 dispatch open');
    expect(text.at(-1)).toBe('    open: T2 read ghost.py · ghost-explorer');
    expect(text.join('\n')).not.toContain('Read ghost.py first'); // the dispatch prompt is never the name
  });
  test('no open row, no unfolded line', () => {
    const done = items.map((i) => (i.origin === 'dispatch' ? { ...i, status: 'completed' } : i));
    expect(boardText(boardLines(boardRowsOf(done), { cols: 100, ui, openFolded: 0, folded: 2 })).join('\n')).not.toContain('open:');
  });
  test('the line fits the pane at 60 columns', () => {
    for (const l of boardText(boardLines(boardRowsOf(items), { cols: 60, ui, openFolded: 1, folded: 2 }))) expect(cells(l)).toBeLessThanOrEqual(60);
  });
});

describe('A4: the band names the open row by its plan title and never leaves columns empty beside a clipped count', () => {
  const plan = ownPlan([
    { id: 'a', content: 'T1 read alpha.py (alpha-explorer)', status: 'completed', origin: 'session', session_id: '' },
    { id: 'b', content: 'T2 read ghost.py (ghost-explorer)', status: 'blocked', origin: 'session', session_id: '' },
    { id: 'c', content: 'T3 read beta.py (beta-explorer)', status: 'completed', origin: 'session', session_id: '' },
    { id: 'da', content: 'List the function names defined in alpha.py.', status: 'completed', origin: 'dispatch', owner: 'alpha-explorer', session_id: 's' },
    { id: 'dg', content: 'Attempt to read ghost.py, then the other files one at a time', status: 'pending', origin: 'dispatch', owner: 'ghost-explorer', session_id: 's' },
  ]);
  test('openRowName: the plan row (T-id and title, worker parenthesis left off), else the agent, never the prompt', () => {
    const open = { content: 'Attempt to read ghost.py, then the other files', owner: 'ghost-explorer', origin: 'dispatch' };
    expect(openRowName(plan, open)).toBe('T2 read ghost.py');
    expect(openRowName(plan, { ...open, owner: 'gamma-explorer' })).toBe('gamma-explorer');
    expect(openRowName(plan, { content: 'Attempt to read ghost.py', origin: 'dispatch' })).toBe('Attempt to read ghost.py');
    expect(openRowName(plan, undefined)).toBeUndefined();
  });
  // stoprun-150-a4fad2f9-3 f0091..f0097 at the docked 93 columns: `◖ ◆ ATLAS ◗ ■ blocked: dispatch Read ghost.py first... open · todo 4/5 · ■1` and 13 blank columns.
  const m = (cols: number, over: Partial<MissionModel> = {}): MissionModel => ({
    cols, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'implement', 'verify'], phase: 'implement', done: 4, total: 5, ui,
    blocked: true, stopGates: ['1 todo open'], openWork: 1, openDispatch: 1, openDispatchTitle: 'T2 read ghost.py', todoBlocked: 1,
    workers: [{ name: 'ghost-explorer', state: 'failed', secs: 9 }], checks: null, ...over,
  });
  const row = (mm: MissionModel): string => runsText(bandLines(mm)[0]!.runs);
  test('93 columns: the named open row, the todo figure and the failed count with its word', () => {
    const t = row(m(93));
    expect(t).toContain('▣ blocked: dispatch T2 read ghost.py open');
    expect(t).toContain('todo 4/5');
    expect(t).toMatch(/▣ 1 blocked/);
    expect(t).toMatch(/■ 1 failed/);
    expect(t).not.toMatch(/\.\.\.|…/);
    expect(t).not.toContain('Attempt');
  });
  test('the failed word survives from 80 columns up, and no width leaves its spare columns beside a clipped bare count', () => {
    for (const cols of [150, 120, 110, 100, 93, 90, 85, 80]) {
      const t = row(m(cols));
      expect([cols, /■ 1 failed/.test(t)]).toEqual([cols, true]);
    }
    // once the words fit they stay for every wider row, and no row is wider than the terminal: a bare count (`■1`) never sits beside spare columns a word form would fill
    let seen = false;
    for (let cols = 40; cols <= 150; cols++) {
      const t = row(m(cols));
      expect([cols, cells(t.trimEnd()) <= cols]).toEqual([cols, true]);
      const words = /■ 1 failed/.test(t);
      if (seen) expect([cols, words]).toEqual([cols, true]);
      seen = seen || words;
    }
    expect(seen).toBe(true);
  });
  test('the todo figure and a named open row are separated by the middle dot: `1 dispatch open · ▣ 1 blocked`', () => {
    const t = row(m(93, { blocked: false, stopGates: [], openDispatchTitle: undefined, workers: [], openWork: 2, openDispatch: 2 }));
    expect(t).toContain('todo 4/5 · 1 dispatch open · ▣ 1 blocked');
    expect(t).not.toContain('open ▣');
  });
});

describe('A6: plain words on the core and gates rows', () => {
  test('plannedText says what ran and what the plan said, in short words', () => {
    const seat = (over: Record<string, unknown>) => ({ role: 'explorer', model: 'haiku', effort: 'low', count: 1, ran: ['haiku'], ...over });
    const rt = (seats: unknown[]) => ({ cls: 'audit', effort: 'low', seats } as never);
    expect(plannedText(rt([seat({ ran: ['haiku', 'haiku', 'haiku'] })]))).toBe('3 explorers ran, the plan said 1');
    expect(plannedText(rt([seat({ ran: ['opus'] })]))).toBe('1 explorer ran on a model the plan did not name');
    expect(plannedText(rt([seat({ ran: [] })]))).toBe('the planned audit team did not run');
    expect(plannedText(rt([seat({ ran: ['haiku', 'haiku'] }), seat({ role: 'verifier', count: 1, ran: ['haiku'] })]))).toBe('2 explorers ran, the plan said 1');
  });
});
