// The Board (design rev 4): goldens at 120 plain, 120 rich and 80 in both themes, WCAG on every run, one chip per row, the
// board's counts equal the band's on the same world, the data mapping, and S1 (a dispatch row follows its worker).
import { describe, expect, test } from 'claude-code/testing';
import { world, worldModel } from '../contracts/band-world';
import { board_120, board_120_rich, board_80, worldBoardRows } from '../contracts/board-golden';
import { band_120 } from '../contracts/band-world-golden';
import { chipCount, contrast, NEED, PALETTES, runKind, toneHex, type Ui } from './atlas-ui';
import { bandLines, runsWidth } from './mission-layout';
import { boardBody, boardCounts, boardLines, boardRowsOf, boardText, mmss, stateOfStatus, toBoardRow } from './board-model';
import { endedOf, settleDispatch } from './data/todos';
import type { SquadAgent } from './contract';

const ui = (theme: 'mocha' | 'latte'): Ui => ({ theme, ascii: false, color: 'truecolor' });
const tiers = [
  [120, false, board_120],
  [120, true, board_120_rich],
  [80, false, board_80],
] as const;

describe('board goldens', () => {
  for (const theme of ['mocha', 'latte'] as const) {
    for (const [cols, rich, golden] of tiers) {
      test(`${theme} ${cols}${rich ? ' rich' : ''} equals the design golden; the ribbon fills exactly ${cols} cells`, () => {
        const lines = boardLines(worldBoardRows(), { cols, ui: ui(theme), rich });
        expect(boardText(lines)).toEqual([...golden]);
        expect(runsWidth(lines[0]!.runs)).toBe(cols);
        for (const l of lines) expect(runsWidth(l.runs)).toBeLessThanOrEqual(cols);
      });
    }
  }
  test('the design files are the exact-fill ribbon with its trailing blanks trimmed (118 and 119 characters, not 120)', () => {
    expect([...board_120[0]!].length).toBe(118);
    expect([...board_120_rich[0]!].length).toBe(119);
    expect(runsWidth(boardLines(worldBoardRows(), { cols: 120, ui: ui('mocha') })[0]!.runs)).toBe(120);
  });
  test('ASCII mode draws the ASCII brand, marks and a bracket chip', () => {
    const a: Ui = { theme: 'mocha', ascii: true, color: 'truecolor' };
    const text = boardText(boardLines(worldBoardRows(), { cols: 120, ui: a, rich: true }));
    expect(text[0]).toStartWith('[ATLAS] > BOARD ---');
    expect(text.join('\n')).not.toMatch(/[^\x20-\x7e\n]/);
    expect(text[6]).toStartWith('> | Subagents block');
    expect(text[6]).toContain('[ RUNNING ]');
  });
  test('narrow widths keep marker, glyph and label, and never overflow', () => {
    for (const cols of [40, 59, 60, 79, 99, 100]) {
      for (const l of boardLines(worldBoardRows(), { cols, ui: ui('mocha') })) expect([cols, runsWidth(l.runs) <= cols]).toEqual([cols, true]);
    }
    expect(boardText(boardLines(worldBoardRows(), { cols: 40, ui: ui('mocha') })).slice(2)[3]).toBe('▸ ◐ Subagents block');
  });
  test('the running row is the focus: marker, bold label; done labels are struck', () => {
    const rows = boardLines(worldBoardRows(), { cols: 120, ui: ui('mocha') });
    const running = rows[6]!.runs;
    expect(running[0]).toMatchObject({ t: '▸', tone: 'accent', bold: true });
    expect(running.find((x) => x.t === 'Subagents block')).toMatchObject({ tone: 'text', bold: true });
    expect(rows[3]!.runs.find((x) => x.t === 'Wire band to host')).toMatchObject({ tone: 'sub', strike: true });
  });
  test('a long owner is cut to 18 cells and a long label to its column, so no cell runs into the next', () => {
    const lines = boardLines([{ label: 'L'.repeat(60), state: 'queued', owner: 'o'.repeat(40), detail: 'd' }], { cols: 120, ui: ui('mocha') });
    const row = boardText(lines)[3]!;
    expect(row.indexOf('...')).toBeGreaterThan(0);
    expect(row.slice(30, 42)).toBe('queued      ');
    expect(row.slice(42, 62)).toBe(`${'o'.repeat(15)}...  `);
    expect(row.slice(62)).toBe('d');
  });
});

describe('chips and contrast', () => {
  test('at most one chip per row, none in the plain form, 11 cells wide in the rich', () => {
    for (const rich of [false, true]) {
      for (const l of boardLines(worldBoardRows(), { cols: 120, ui: ui('mocha'), rich })) expect(chipCount(l.runs)).toBeLessThanOrEqual(1);
    }
    const rows = boardLines(worldBoardRows(), { cols: 120, ui: ui('mocha'), rich: true }).slice(3);
    expect(rows.map((l) => chipCount(l.runs))).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(rows.map((l) => l.runs.find((x) => x.chip)!.t.length)).toEqual(Array(7).fill(11));
    expect(boardLines(worldBoardRows(), { cols: 120, ui: ui('mocha') }).flatMap((l) => l.runs).some((x) => x.chip && !x.t.includes('ATLAS'))).toBe(false);
  });
  for (const theme of ['mocha', 'latte'] as const) {
    test(`${theme}: each run meets 4.5:1 as text or 3:1 as a glyph on its background`, () => {
      const p = PALETTES[theme];
      let checked = 0;
      for (const [cols, rich] of [[120, false], [120, true], [80, false]] as const) {
        for (const r of boardLines(worldBoardRows(), { cols, ui: ui(theme), rich }).flatMap((l) => l.runs)) {
          if (!r.t.trim()) continue;
          const ratio = contrast(toneHex(r.tone, theme), r.bg ? toneHex(r.bg, theme) : p.panel);
          expect([theme, cols, r.t, ratio >= (r.chip ? NEED.text : NEED[runKind(r.t)])]).toEqual([theme, cols, r.t, true]);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(80);
    });
  }
});

describe('counts equal the band on the same world', () => {
  const model = worldModel(120, ui('mocha'));
  test('done and total: the board states what the band states (3 of 7)', () => {
    const c = boardCounts(worldBoardRows());
    expect([c.done, c.total]).toEqual([model.done, model.total]);
    expect(band_120[0]).toContain(`${model.done} of ${model.total}`);
    expect(boardText(boardLines(worldBoardRows(), { cols: 120, ui: ui('mocha') }))[0]).toContain(`${c.total} items`);
  });
  test('running, failed and queued: the same counts as the band words', () => {
    const c = boardCounts(worldBoardRows());
    const band = bandLines(model).map((l) => l.runs.map((x) => x.t).join('')).join('\n');
    for (const s of ['running', 'failed', 'queued'] as const) expect(band).toContain(`${c[s]} ${s}`);
    expect([c.running, c.failed, c.queued, c.blocked]).toEqual([1, 1, 1, 1]);
  });
  test('the rows the board draws are the world, one for one, in the world order', () => {
    const body = boardBody(worldBoardRows(), { cols: 120, ui: ui('mocha') }).slice(1);
    expect(body).toHaveLength(world.todos.length);
    world.todos.forEach((t, i) => {
      const text = body[i]!.runs.map((x) => x.t).join('');
      expect(text).toContain(t.label);
      expect(text).toContain(t.state);
    });
  });
});

describe('data to rows', () => {
  test('statuses map onto the six-word vocabulary; an unknown one reads queued', () => {
    expect(['completed', 'in_progress', 'blocked', 'failed', 'waiting', 'pending', 'weird'].map(stateOfStatus)).toEqual(['done', 'running', 'blocked', 'failed', 'waiting', 'queued', 'queued']);
  });
  test('done shows `ran mm:ss` from its stamps; running carries elapsed against the five minute budget', () => {
    expect(toBoardRow({ content: '[build] wire it', status: 'completed', owner: 'a', claimed_at: 100, completed_at: 290 })).toMatchObject({ label: 'wire it', detail: 'ran 03:10' });
    expect(toBoardRow({ content: 'x', status: 'in_progress', claimed_at: 100 }, 142)).toMatchObject({ elapsed: { secs: 42, of: 300 } });
    expect(toBoardRow({ content: 'x', status: 'in_progress', claimed_at: 100 }, 1000).elapsed).toEqual({ secs: 900, of: 900 });
    expect(toBoardRow({ content: 'x', status: 'blocked', evidence: '2) needs   review' }).detail).toBe('needs review');
    expect(mmss(125)).toBe('02:05');
  });
  test('plan rows come before the per-subagent dispatch rows', () => {
    const rows = boardRowsOf([{ content: 'd1', status: 'pending', origin: 'dispatch' }, { content: 'p1', status: 'pending' }]);
    expect(rows.map((r) => r.label)).toEqual(['p1', 'd1']);
  });
});

describe('S1: a dispatch row follows its worker', () => {
  const dispatch = (over: Record<string, unknown>) => ({ id: 'd', content: 'do it', status: 'pending', origin: 'dispatch', owner: 'impl-a', ...over });
  test('a pending or in_progress dispatch row becomes completed when its worker finished, failed when it died', () => {
    expect(settleDispatch([dispatch({})], { 'impl-a': 'done' })[0]!.status).toBe('completed');
    expect(settleDispatch([dispatch({ status: 'in_progress' })], { 'impl-a': 'done' })[0]!.status).toBe('completed');
    expect(settleDispatch([dispatch({})], { 'impl-a': 'failed' })[0]!.status).toBe('failed');
  });
  test('plan rows, rows of other workers and rows already final are left alone', () => {
    const items = [dispatch({ origin: 'session' }), dispatch({ owner: 'other' }), dispatch({ status: 'blocked' }), dispatch({ status: 'completed' })];
    expect(settleDispatch(items, { 'impl-a': 'done' }).map((i) => i.status)).toEqual(['pending', 'pending', 'blocked', 'completed']);
    expect(settleDispatch(items, {})).toEqual(items);
  });
  test('the squad says who ended: finished is done, failed and dead are failed, running is not ended', () => {
    const squad = [
      { name: 'a', state: 'finished' }, { name: 'b', state: 'failed' }, { name: 'c', state: 'dead' }, { name: 'd', state: 'running' }, { name: 'lead', state: 'finished' },
    ] as SquadAgent[];
    expect(endedOf(squad)).toEqual({ a: 'done', b: 'failed', c: 'failed' });
  });
  test('the board then draws the row done or failed, and the counts follow', () => {
    const settled = settleDispatch([dispatch({ id: '1' }), dispatch({ id: '2', owner: 'impl-b' })], { 'impl-a': 'done', 'impl-b': 'failed' });
    expect(boardRowsOf(settled).map((r) => r.state)).toEqual(['done', 'failed']);
  });
});
