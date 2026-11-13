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
const hud = (cols: number, maxRows: number, input: HudInput = { todos: plan(), agents }): string[] => hudLines(input, { cols, maxRows, ui, now: NOW, merge: false }).map(runsString); // wave 32: the at-rest rows these tests pin are the two-box shape (merge: false); the default is the one merged block

/** A plan row: its glyph starts the line (agent rows start with theirs too, but name a worker, not `T<n> <title>`). */
const PLAN_ROW = /^[▸ ] [◐◓◑◒◇●■▲◉] T[1-5] [a-z]/;

describe('B1: a completed row never leaves the TODO block while the rows fit', () => {
  test('93 cells, 14 rows (f0086; the column names, both closing rules and the blank take four): all five rows are drawn, T1 included, with no `done` fold on the ribbon', () => {
    const rows = hud(93, 14);
    expect(rows.filter((r) => PLAN_ROW.test(r))).toHaveLength(5);
    expect(rows.find((r) => r.includes('T1 read alpha.py'))).toMatch(/done/);
    expect(rows[0]).toContain('1/5');
    expect(rows[0]).not.toMatch(/· \d+ done/);
    expect(rows.filter((r) => /^[▸ ] [◐◓◑◒◇●■▲◉] [a-z]+-explorer /.test(r))).toHaveLength(3);
  });
  test('when the rows truly do not fit (critique 28): the blank goes, then the column names, then the finished row folds into the count, then open plan rows; every agent keeps its row and every box stays closed', () => {
    const open = (n: number): string[] => hud(93, n).filter((r) => PLAN_ROW.test(r) && !/T1 /.test(r));
    const agentRows = (n: number): number => hud(93, n).filter((r) => /^[▸ ] [◐◓◑◒◇●■▲◉] [a-z]+-explorer /.test(r)).length;
    const closes = (n: number): number => hud(93, n).filter((r) => /^╰─+╯$/.test(r)).length;
    const names = (n: number): boolean => hud(93, n).some((r) => /AGENT\s+STATE/.test(r));
    expect([names(14), names(13), names(12)]).toEqual([true, true, false]); // the column names go before a plan row does
    expect(hud(93, 12)[0]).not.toMatch(/done/);
    expect(hud(93, 12).filter((r) => PLAN_ROW.test(r))).toHaveLength(5);
    expect(hud(93, 11)[0]).toMatch(/1\/5 · 1 done/); // then the finished row folds into the title
    expect(open(11)).toHaveLength(4);
    expect(open(10)).toHaveLength(3);
    expect(hud(93, 10)[0]).toMatch(/\+2 more/);
    expect(open(9)).toHaveLength(2);
    expect(open(8)).toHaveLength(1); // then open plan rows are counted on the title, one wording at every width
    for (const n of [14, 12, 11, 10, 9, 8]) {
      expect([n, agentRows(n)]).toEqual([n, 3]); // a running or listed agent keeps its row while a plan row can give way
      expect([n, closes(n)]).toEqual([n, 2]); // no box is left open at the bottom
    }
    expect(hud(93, 7).some((r) => r.includes('▸ TODO'))).toBe(false); // only then the plan box goes, whole
    expect([agentRows(7), closes(7)]).toEqual([3, 1]);
    expect(hud(93, 4).filter((r) => PLAN_ROW.test(r))).toHaveLength(0);
    expect(hud(93, 4)[0]).toMatch(/\+1 more/); // the agent window is the last to fold and the title counts what it hides
  });
});

describe('B3: a row the store holds as pending never reads failed', () => {
  test('todoState: pending + failed owner stays queued (the owner is named beside it); in_progress still fails', () => {
    expect(todoState('pending', 'failed')).toEqual({ state: 'queued', word: 'worker failed' }); // critique 19 A3: the glyph stays the store's, the word says why
    expect(todoState('in_progress', 'failed')).toEqual({ state: 'failed' });
    expect(todoState('blocked', 'failed')).toEqual({ state: 'blocked' });
  });
  test('HUD T3 (f0097.ans:27) keeps the queued glyph and reads `worker failed` (critique 19 A3) with `owner failed`, never the failed mark', () => {
    const t3 = hud(150, 12).find((r) => r.includes('T3 read beta.py'))!;
    expect(t3).toContain('◇');
    expect(t3).toMatch(/worker failed/);
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

describe('B3 (round 3): blocked and failed share the one error colour; the glyph and the word tell them apart', () => {
  test('the state token resolves to one error hex, the word tone is shared, the glyph differs, in every theme', () => {
    expect(rowWordTone('blocked')).toBe(rowWordTone('failed'));
    for (const theme of ['mocha', 'latte'] as const) {
      const u: Ui = { theme, ascii: false, color: 'truecolor' };
      expect(PALETTES[theme][STATE_TOKEN.blocked]).toBe(PALETTES[theme][STATE_TOKEN.failed]);
      expect(stateRun('blocked', u).t).not.toBe(stateRun('failed', u).t);
      expect(contrast(PALETTES[theme][STATE_TOKEN.blocked], PALETTES[theme].panel)).toBeGreaterThanOrEqual(3);
    }
    expect(PALETTES.mocha.bad).toBe('#ff5f5f'); // error 203
    const rows = hudLines({ todos: plan(), agents }, { cols: 150, maxRows: 12, ui, now: NOW });
    const toneOf = (needle: string, word: string) => rows.find((r) => runsString(r).includes(needle))!.find((x) => x.t.trim() === word)!.tone;
    const glyphOf = (needle: string) => rows.find((r) => runsString(r).includes(needle))![2]!.tone;
    expect(toneOf('T2 read ghost.py', 'blocked')).toBe(rowWordTone('blocked')); // the HUD word takes the shared table's blocked tone
    expect(glyphOf('T2 read ghost.py')).not.toBe(glyphOf('T3 read beta.py'));
    expect(rows.some((r) => runsString(r).includes('T3 read beta.py'))).toBe(true);
  });
});

describe('B2: a killed worker reads in words, not only in colour', () => {
  const done = [item(1, 'completed', 'T1 read alpha.py (alpha-explorer)', names[0]), item(2, 'completed', 'T2 read ghost.py (ghost-explorer)', names[1])];
  test('HUD row at 93 cells (stoprun-150-562576ed-1 f0103.ans:26): `closed · worker killed`', () => {
    const t2 = hud(93, 12, { todos: done, agents }).find((r) => r.includes('T2 read ghost.py'))!;
    expect(t2).toContain('■ T2'); expect(t2).toContain('killed'); expect(t2).not.toContain('worker killed'); // critique 28: one glyph and one word for a failed worker (the HUD is the band implementer's: it keeps `killed` until that wave lands)
    expect(hud(93, 12, { todos: done, agents }).find((r) => r.includes('T1 read alpha.py'))).not.toContain('worker killed');
  });
  test('HUD row in the 61-cell strip keeps the words and fits', () => {
    const t2 = hud(61, 12, { todos: done, agents }).find((r) => r.includes('T2 read'))!;
    expect(t2).toContain('killed');
    expect(cells(t2)).toBeLessThanOrEqual(61);
  });
  test('board row (wave 30, one word): a killed worker row reads `killed` once, at 120 and at 60 cells, with no `closed` and no `worker killed`', () => {
    const src: BoardSource[] = [{ content: 'T2 read ghost.py (ghost-explorer)', status: 'completed', owner: 'ghost-explorer', ownerState: 'failed' }];
    const at = (cols: number): string => boardText(boardLines(boardRowsOf(src), { cols, ui, ribbon: false, title: false })).join('\n');
    expect(at(120)).toMatch(/failed\s+ghost-explorer\s*$/m);
    expect(at(120)).not.toMatch(/closed|worker killed/);
    expect(at(60)).toContain('failed');
    expect(at(60)).not.toMatch(/closed|worker killed/);
  });
  test('board row at 37 cells keeps `killed` in the state cell and the owner on the sub-line under the row', () => {
    const src: BoardSource[] = [{ content: 'T2 read ghost.py (ghost-explorer)', status: 'completed', owner: 'ghost-explorer', ownerState: 'failed' }];
    const text = boardText(boardLines(boardRowsOf(src), { cols: 37, ui, ribbon: false, title: false }));
    expect(text.join('\n')).toMatch(/T2 read ghost\.py[^\n]* failed\n\s+ghost-explorer\s*$/m); // critique 19 C1: on the sub-line under its own row
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
    const rows = text.filter((r) => /^\s*[●◇▲■◐] T\d/.test(r));
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
