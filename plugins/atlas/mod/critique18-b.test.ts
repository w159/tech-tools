// Critique 18, slice B: TODO rows never vanish, failure reads in words, blocked has its own colour, the board uses its pane.
// Live shapes: stoprun-150-562576ed-2/frames/f0086.ans:24-33 (T1 gone under `1/5 · 1 done`), f0097.ans:26-27 (blocked and failed both 217, T3 failed over a pending store row),
// stoprun-150-562576ed-1/frames/f0103.ans:26 (`done` for a killed worker), live-110-562576ed-2/tab-board.png (owner wraps, pane empty under 5 rows).
import { describe, expect, test } from 'claude-code/testing';
import { boardLines, boardRowsOf, boardText, type BoardSource } from './board-model';
import { PALETTES, STATE_TOKEN, cells, contrast, rowWordTone, runsString, stateRun, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { hudLines, type HudAgent, type HudInput } from './hud';
import { todoState } from './data/todos';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const NOW = 5_000_000;
const names = ['alpha-explorer', 'ghost-explorer', 'beta-explorer'];
const item = (i: number, status: string, content: string, owner?: string): TodoItem => ({ id: `t${i}`, content, status, ...(owner ? { owner } : {}) }) as unknown as TodoItem;
/** stoprun-150-562576ed-2 at t=46.71: T1 completed, T2 blocked, T3 pending (store), alpha done, ghost and beta killed. */
const plan = (): TodoItem[] => [
  item(1, 'completed', 'T1 read alpha.py (alpha-explorer)', names[0]),
  item(2, 'blocked', 'T2 read ghost.py (ghost-explorer)', names[1]),
  item(3, 'pending', 'T3 read beta.py (beta-explorer)', names[2]),
  item(4, 'pending', 'T4 combine the reports'),
  item(5, 'pending', 'T5 write the final summary'),
];
const agent = (name: string, state: string, ui_: string): HudAgent => ({ name, role: 'explorer', state, ui: ui_ as never, model: 'haiku', since: NOW - 20_000, lastTool: 'Read', target: 'x.py' });
const agents = [agent(names[0]!, 'done', 'done'), agent(names[1]!, 'failed', 'failed'), agent(names[2]!, 'failed', 'failed')];
const hud = (cols: number, maxRows: number, input: HudInput = { todos: plan(), agents }): string[] => hudLines(input, { cols, maxRows, ui, now: NOW }).map(runsString);

describe('B1: a completed row never leaves the TODO block while the rows fit', () => {
  test('93 cells, 10 rows (f0086): all five rows are drawn, T1 included, with no `done` fold on the ribbon', () => {
    const rows = hud(93, 10);
    expect(rows.filter((r) => /\bT[1-5] /.test(r) && !/haiku/.test(r))).toHaveLength(5);
    expect(rows.find((r) => r.includes('T1 read alpha.py'))).toMatch(/done/);
    expect(rows[0]).toContain('1/5');
    expect(rows[0]).not.toMatch(/· \d+ done/);
    expect(rows.filter((r) => /haiku/.test(r))).toHaveLength(3);
  });
  test('when the rows truly do not fit, open rows keep their place and the ribbon says how many were left out', () => {
    const rows = hud(93, 9);
    expect(rows.filter((r) => /\bT[2-5] /.test(r) && !/haiku/.test(r))).toHaveLength(4);
    expect(rows[0]).toMatch(/1 more todo not shown/);
  });
});

describe('B3: a row the store holds as pending never reads failed', () => {
  test('todoState: pending + failed owner stays queued (the owner is named beside it); in_progress still fails', () => {
    expect(todoState('pending', 'failed')).toEqual({ state: 'queued' });
    expect(todoState('in_progress', 'failed')).toEqual({ state: 'failed' });
    expect(todoState('blocked', 'failed')).toEqual({ state: 'blocked' });
  });
  test('HUD T3 (f0097.ans:27) reads queued with `owner failed`, never failed', () => {
    const t3 = hud(150, 12).find((r) => r.includes('T3 read beta.py'))!;
    expect(t3).toMatch(/queued/);
    expect(t3).not.toContain('■');
    expect(t3).toContain('owner failed');
  });
  test('board row for the same plan (dispatch rows folded) reads queued as well', () => {
    const src: BoardSource[] = [
      { content: 'T3 read beta.py (beta-explorer)', status: 'pending', owner: 'beta-explorer', ownerState: 'failed' },
      { content: 'Read beta.py', status: 'failed', owner: 'beta-explorer', origin: 'dispatch', ownerState: 'failed' },
    ];
    const rows = boardRowsOf(src);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'queued', ownerState: 'failed' });
  });
});

describe('B3: blocked has its own colour, distinct from failed', () => {
  test('the state token, the glyph, the word and the HUD row all differ from failed in every theme', () => {
    expect(STATE_TOKEN.blocked).not.toBe(STATE_TOKEN.failed);
    expect(rowWordTone('blocked')).not.toBe(rowWordTone('failed'));
    for (const theme of ['mocha', 'latte'] as const) {
      const u: Ui = { theme, ascii: false, color: 'truecolor' };
      expect(PALETTES[theme][STATE_TOKEN.blocked]).not.toBe(PALETTES[theme][STATE_TOKEN.failed]);
      expect(stateRun('blocked', u).tone).not.toBe(stateRun('failed', u).tone);
      expect(contrast(PALETTES[theme][STATE_TOKEN.blocked], PALETTES[theme].panel)).toBeGreaterThanOrEqual(3);
    }
    const rows = hudLines({ todos: plan(), agents }, { cols: 150, maxRows: 12, ui, now: NOW });
    const toneOf = (needle: string, word: string) => rows.find((r) => runsString(r).includes(needle))!.find((x) => x.t.trim() === word)!.tone;
    const glyphOf = (needle: string) => rows.find((r) => runsString(r).includes(needle))![2]!.tone;
    expect(toneOf('T2 read ghost.py', 'blocked')).toBe('block');
    expect(glyphOf('T2 read ghost.py')).not.toBe(glyphOf('T3 read beta.py'));
    expect(rows.some((r) => runsString(r).includes('T3 read beta.py'))).toBe(true);
  });
});

describe('B2: a killed worker reads in words, not only in colour', () => {
  const done = [item(1, 'completed', 'T1 read alpha.py (alpha-explorer)', names[0]), item(2, 'completed', 'T2 read ghost.py (ghost-explorer)', names[1])];
  test('HUD row at 93 cells (stoprun-150-562576ed-1 f0103.ans:26): `done · worker killed`', () => {
    const t2 = hud(93, 12, { todos: done, agents }).find((r) => r.includes('T2 read ghost.py'))!;
    expect(t2).toContain('done · worker killed');
    expect(hud(93, 12, { todos: done, agents }).find((r) => r.includes('T1 read alpha.py'))).not.toContain('worker killed');
  });
  test('HUD row in the 61-cell strip keeps the words and fits', () => {
    const t2 = hud(61, 12, { todos: done, agents }).find((r) => r.includes('T2 read'))!;
    expect(t2).toContain('worker killed');
    expect(cells(t2)).toBeLessThanOrEqual(61);
  });
  test('board row: 120 cells says `worker killed` in the detail column, 60 cells spells `done · worker killed` in the state cell', () => {
    const src: BoardSource[] = [{ content: 'T2 read ghost.py (ghost-explorer)', status: 'completed', owner: 'ghost-explorer', ownerState: 'failed' }];
    const at = (cols: number): string => boardText(boardLines(boardRowsOf(src), { cols, ui, ribbon: false, title: false })).join('\n');
    expect(at(120)).toMatch(/done\s+ghost-explorer\s+worker killed/);
    expect(at(60)).toContain('done · worker killed');
  });
  test('board row at 37 cells keeps `done` in the state cell and says `worker killed` on the sub-line under the row', () => {
    const src: BoardSource[] = [{ content: 'T2 read ghost.py (ghost-explorer)', status: 'completed', owner: 'ghost-explorer', ownerState: 'failed' }];
    const text = boardText(boardLines(boardRowsOf(src), { cols: 37, ui, ribbon: false, title: false }));
    expect(text.join('\n')).toMatch(/T2 read ghost\.py[^\n]*\n\s+ghost-explorer\s+worker killed/); // critique 19 C1: on the sub-line under its own row
    for (const r of text) expect(cells(r)).toBeLessThanOrEqual(37);
  });
});

describe('B5 / critique 19 C1: the 110 board keeps the owner with its row and says something under it', () => {
  const src: BoardSource[] = [
    { content: 'T1 read alpha.py', status: 'completed', owner: 'alpha-explorer', ownerState: 'done' },
    { content: 'T2 read ghost.py', status: 'blocked', owner: 'ghost-explorer', ownerState: 'failed', claimed_at: 100 },
    { content: 'T3 combine the reports', status: 'pending' },
  ];
  test('37 cells (critique 19 C1): each owner is the sub-line under its own row, with the row\'s reason and age; no detached list', () => {
    const text = boardText(boardLines(boardRowsOf(src, 400), { cols: 37, ui, ribbon: false, title: false }));
    const rows = text.filter((r) => /^\s*[●◇▣■◐] T\d/.test(r));
    expect(rows).toHaveLength(3);
    const under = (title: string): string => text[text.findIndex((r) => r.includes(title)) + 1]!;
    expect(under('T1 read alpha.py')).toMatch(/^\s+alpha-explorer$/);
    expect(under('T2 read ghost.py')).toMatch(/^\s+ghost-explorer$/);
    expect(text[text.findIndex((r) => r.includes('T2 read ghost.py')) + 2]).toMatch(/^\s+owner failed · open 05:00$/); // too long for the owner's line: the reason and age go on the next
    expect(text.findIndex((r) => r.includes('T3 combine'))).toBeGreaterThan(text.findIndex((r) => r.includes('ghost-explorer'))); // no list after the last row
    for (const r of text) expect(cells(r)).toBeLessThanOrEqual(37);
  });
  test('120 cells: the owner column carries the owner, no notes block', () => {
    const text = boardText(boardLines(boardRowsOf(src, 400), { cols: 120, ui, ribbon: false, title: false }));
    expect(text.filter((r) => r.trim() === '')).toHaveLength(0);
  });
});
