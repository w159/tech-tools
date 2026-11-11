// The Board (design rev 4): goldens at 120 plain, 120 rich and 80 in both themes, WCAG on every run, one chip per row, the
// board's counts equal the band's on the same world, the data mapping, and S1 (a dispatch row follows its worker).
import { describe, expect, test } from 'claude-code/testing';
import { world, worldModel } from '../contracts/band-world';
import { board_120, board_120_rich, board_80, worldBoardRows } from '../contracts/board-golden';
import { band_120 } from '../contracts/band-world-golden';
import { cells, chipCount, contrast, NEED, PALETTES, runKind, toneHex, type Ui } from './atlas-ui';
import { bandLines, runsWidth } from './mission-layout';
import type { UiState } from './atlas-ui';
import { blockedCount, boardBody, boardCounts, boardLines, boardRowsOf, boardText, mmss, stateOfStatus, toBoardRow } from './board-model';
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
  test('the 60-cell pane gives the label the room left: five full labels survive, none cut to 18', () => {
    const labels = ['T1 read alpha.py (alpha-explorer)', 'T4 combine the three reports', 'List the function names', 'T2 read beta.py (beta-explorer)', 'Subagents block'];
    const rows = labels.map((label) => ({ label, state: 'done' as const, owner: '', detail: '' }));
    const text = boardText(boardBody(rows, { cols: 60, ui: ui('mocha') }));
    for (const label of labels) expect(text.some((t) => t.includes(label))).toBe(true);
  });
  test('at 30 cells no board row exceeds 30 cells', () => {
    const rows = ['T1 read alpha.py (alpha-explorer)', 'T4 combine the three reports'].map((label) => ({ label, state: 'running' as const, owner: 'alpha-explorer', detail: 'x' }));
    for (const l of boardLines(rows, { cols: 30, ui: ui('mocha') })) expect(runsWidth(l.runs)).toBeLessThanOrEqual(30);
  });
  test('narrow widths keep marker, glyph and label, and never overflow', () => {
    for (const cols of [40, 59, 60, 79, 99, 100]) {
      for (const l of boardLines(worldBoardRows(), { cols, ui: ui('mocha') })) expect([cols, runsWidth(l.runs) <= cols]).toEqual([cols, true]);
    }
    expect(boardText(boardLines(worldBoardRows(), { cols: 40, ui: ui('mocha') })).slice(2)[3]).toMatch(/^▸ ◐ Subagents block +running +\S/);
  });
  test('A3: from 30 cells up every row keeps a state column, and an owner column wherever the label keeps its room; below 30 the label alone', () => {
    // two plan rows with a title owner, one folded dispatch row (alpha), one dispatch row with no plan row (beta): three rows
    const rows = boardRowsOf([
      { content: 'T1 read alpha.py (alpha-explorer)', status: 'completed' },
      { content: 'T2 read gamma.py', status: 'pending', owner: 'gamma-explorer' },
      { content: 'List the function names defined in alpha.py.', status: 'pending', origin: 'dispatch', owner: 'alpha-explorer' },
      { content: 'Read beta.py and list its classes.', status: 'pending', origin: 'dispatch', owner: 'beta-explorer' },
    ]);
    expect(rows.length).toBe(3);
    for (const cols of [38, 59, 60, 80, 99, 110, 150]) {
      const lines = boardText(boardBody(rows, { cols, ui: ui('mocha') })).filter((l) => /^[▸ ] [●◇▲◐] /.test(l));
      expect(lines.length).toBe(3);
      for (const l of lines) {
        expect([cols, /\b(done|queued)\b/.test(l)]).toEqual([cols, true]);
        // B2: the owner column drops before a title is cut; it shows from 59 up here, where the 34-cell title fits beside it or the cut titles would share a head
        if (cols >= 59) expect([cols, /(alpha|beta|gamma)(-|\.\.\.)/.test(l)]).toEqual([cols, true]); // the owner, the T row's included
        expect([cols, l.includes('-explorer)')]).toEqual([cols, false]); // not left in the title
      }
    }
    // narrow: no owner cell, and no title cut shorter than it has to be
    const narrow = boardText(boardBody(rows, { cols: 38, ui: ui('mocha') })).filter((l) => /^[▸ ] [●◇▲◐] /.test(l));
    expect(narrow.some((l) => /(alpha|beta|gamma)(-|\.\.\.)/.test(l))).toBe(false);
    expect(boardText(boardBody(rows, { cols: 28, ui: ui('mocha') })).every((l) => !/\b(done|queued)\b/.test(l))).toBe(true);
  });
  test('A3: a dispatch row whose owner owns a plan row folds into it: a 5-item plan with 3 owned dispatches is 5 rows', () => {
    const plan = ['a', 'b', 'c', 'd', 'e'].map((n, i) => ({ content: `T${i + 1} read ${n}.py${i < 3 ? ` (w-${n})` : ''}`, status: 'pending' }));
    const disp = (n: string, status: string) => ({ content: `Read ${n}.py and list its names.`, status, origin: 'dispatch', owner: `w-${n}` });
    const rows = boardRowsOf([...plan, disp('a', 'in_progress'), disp('b', 'failed'), disp('c', 'completed')]);
    expect(rows.length).toBe(5);
    expect(rows.map((x) => x.label)).toEqual(['T1 read a.py', 'T2 read b.py', 'T3 read c.py', 'T4 read d.py', 'T5 read e.py']);
    // the dispatch row's state is folded into the plan row: running, failed, and a finished worker leaves the open row `ended`
    expect(rows.map((x) => x.state)).toEqual(['running', 'failed', 'blocked', 'queued', 'queued']);
    expect(rows[2]!.word).toBe('ended');
    expect(rows.map((x) => x.owner)).toEqual(['w-a', 'w-b', 'w-c', '', '']);
    // a plan row already done stays done, whatever its worker's row says
    expect(boardRowsOf([{ content: 'T1 x (w-a)', status: 'completed' }, disp('a', 'in_progress')]).map((x) => x.state)).toEqual(['done']);
    // a dispatch row with no plan row stays, labelled by its own task text
    const lone = boardRowsOf([...plan.slice(0, 1), disp('z', 'pending'), disp('y', 'pending')]);
    expect(lone.map((x) => x.label)).toEqual(['T1 read a.py (w-a)', 'Read z.py and list its names.', 'Read y.py and list its names.']);
  });
  test('A3: below 60 cells the owner column goes before a title is cut under 16 cells', () => {
    const rows = boardRowsOf([{ content: 'A long plan title that needs room to read', status: 'pending', owner: 'alpha-explorer' }]);
    for (let cols = 30; cols < 60; cols++) {
      const l = boardText(boardBody(rows, { cols, ui: ui('mocha') }))[0]!;
      const label = /^[▸ ] [●◇▲◐] (.+?) +(queued|running|done)\b/.exec(l)?.[1] ?? '';
      expect([cols, cells(label) >= 16]).toEqual([cols, true]);
    }
  });
  test('A3: labels are cut at the end, never at the front, even when rows share a long head', () => {
    const rows = ['alpha', 'beta', 'gamma'].map((n) => ({ content: `List the function names defined in /mnt/project-files/${n}.py`, status: 'pending', origin: 'dispatch', owner: `${n}-explorer` }));
    for (const cols of [38, 60, 80, 110]) {
      for (const l of boardText(boardBody(boardRowsOf(rows), { cols, ui: ui('mocha') }))) {
        if (l.startsWith('ITEM')) continue;
        expect([cols, l.includes('...') ? /^[▸ ] [^ ] List the/.test(l) : true]).toEqual([cols, true]);
        expect([cols, /^[▸ ] [^ ] \.\.\./.test(l)]).toEqual([cols, false]);
      }
    }
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
  test('done shows `ran mm:ss` from its stamps; running carries elapsed, and `of` only from its own estimate', () => {
    expect(toBoardRow({ content: '[build] wire it', status: 'completed', owner: 'a', claimed_at: 100, completed_at: 290 })).toMatchObject({ label: 'wire it', detail: 'ran 03:10' });
    expect(toBoardRow({ content: 'x', status: 'in_progress', claimed_at: 100 }, 142)).toMatchObject({ elapsed: { secs: 42 } });
    expect(toBoardRow({ content: 'x', status: 'in_progress', claimed_at: 100 }, 142).elapsed).toEqual({ secs: 42 });
    expect(toBoardRow({ content: 'x', status: 'in_progress', claimed_at: 100, estimate_s: 300 }, 142).elapsed).toEqual({ secs: 42, of: 300 });
    // No estimate: the row reads `elapsed 00:42`, no `of`, no gauge (rich or not).
    const noEst = boardText(boardLines([toBoardRow({ content: 'x', status: 'in_progress', claimed_at: 100, owner: 'a' }, 142)], { cols: 120, ui: ui('mocha'), rich: true })).join('\n');
    expect(noEst).toContain('elapsed 00:42');
    expect(noEst).not.toContain(' of ');
    expect(noEst).not.toMatch(/[█░▏▎▍▌▋▊▉]/);
    // A failed owner fails its item; a waiting owner blocks it and is named.
    expect(toBoardRow({ content: 'x', status: 'pending', owner: 'a', ownerState: 'failed' })).toMatchObject({ state: 'failed', detail: '' });
    expect(toBoardRow({ content: 'x', status: 'pending', owner: 'a', ownerState: 'waiting' })).toMatchObject({ state: 'blocked', detail: 'owner waiting' });
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
  test('a pending or in_progress dispatch row reads ended when its worker finished (the store holds it open), failed when it died', () => {
    expect(settleDispatch([dispatch({})], { 'impl-a': 'done' })[0]!.status).toBe('ended');
    expect(settleDispatch([dispatch({ status: 'in_progress' })], { 'impl-a': 'done' })[0]!.status).toBe('ended');
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
  test('the board then draws the row ended (attention, never done) or failed, and the counts follow', () => {
    const settled = settleDispatch([dispatch({ id: '1' }), dispatch({ id: '2', owner: 'impl-b' })], { 'impl-a': 'done', 'impl-b': 'failed' });
    expect(boardRowsOf(settled).map((r) => r.state)).toEqual(['blocked', 'failed']);
    expect(boardRowsOf(settled).map((r) => r.word)).toEqual(['ended', undefined]);
  });
  test('A2: no open store status ever draws as done: the glyph is not the done glyph and the word is not `done`', () => {
    for (const status of ['pending', 'in_progress', 'ended', 'blocked']) {
      const rows = boardRowsOf([{ content: 'x', status, origin: 'dispatch', owner: 'w' }]);
      for (const cols of [38, 80, 110]) {
        const line = boardText(boardBody(rows, { cols, ui: ui('mocha') }))[cols >= 100 ? 1 : 0]!;
        expect([status, cols, line.includes('●'), /\bdone\b/.test(line)]).toEqual([status, cols, false, false]);
      }
    }
  });
  test('an ended row names itself in the state column (plain and rich) and says why in the detail', () => {
    const rows = boardRowsOf([{ content: 'x', status: 'ended', origin: 'dispatch', owner: 'w' }]);
    expect(boardText(boardBody(rows, { cols: 110, ui: ui('mocha') }))[1]).toMatch(/^ {2}▲ x +ended +w +agent ended, row still open$/);
    const rich = boardBody(rows, { cols: 110, ui: ui('mocha'), rich: true })[1]!.runs.find((x) => x.chip)!;
    expect(rich.t).toBe(' ENDED     ');
    expect(rich.bg).toBe('warn');
  });
});

describe('mutation kills (round 2): blockedCount, boardCounts, the elapsed gauge room', () => {
  const row = (state: UiState) => ({ label: 'x', state, owner: '', detail: '' });
  test('blockedCount counts only items whose state word is blocked (a waiting owner blocks, a finished item stays done)', () => {
    const owners = new Map<string, UiState>([['a', 'waiting'], ['b', 'running'], ['c', 'blocked']]);
    const items = [
      { status: 'in_progress', owner: 'a' }, // waiting owner: blocked
      { status: 'pending', owner: 'b' }, // running owner: queued
      { status: 'completed', owner: 'a' }, // finished: done
      { status: 'blocked' }, // own status
      { status: 'pending', owner: 'c' }, // blocked owner: blocked
      { status: 'in_progress' }, // running
    ];
    expect(blockedCount(items, owners)).toBe(3);
    expect(blockedCount([], owners)).toBe(0);
  });
  test('boardCounts starts every state at zero and counts each row once', () => {
    expect(boardCounts([])).toEqual({ queued: 0, running: 0, done: 0, failed: 0, blocked: 0, waiting: 0, total: 0 });
    expect(boardCounts([row('done'), row('done'), row('failed'), row('blocked')])).toEqual({ queued: 0, running: 0, done: 2, failed: 1, blocked: 1, waiting: 0, total: 4 });
  });
  test('the rich elapsed gauge needs 19 cells plus the tail: drawn at exactly that room, text one cell short', () => {
    // 100 columns leave 37 cells for the detail; `1000:00 of 1000:00` is 18, so the gauge row (8 + 10 + 1 + 18) fits to the cell.
    const running = (secs: number, of: number) => ({ label: 'x', state: 'running' as const, owner: '', detail: '', elapsed: { secs, of } });
    const detail = (r: ReturnType<typeof running>, cols: number) => boardText(boardLines([r], { cols, ui: ui('mocha'), rich: true })).at(-1)!.slice(62).trimEnd();
    expect(detail(running(60_000, 60_000), 100)).toBe('elapsed ██████████ 1000:00 of 1000:00');
    // The gauge fill is the true fraction: a task at a quarter of its estimate fills a quarter.
    expect(detail(running(15, 60), 120)).toBe('elapsed ██▌░░░░░░░ 00:15 of 01:00');
    // An estimate of one second still divides by one, not by a larger floor.
    expect(detail(running(1, 1), 120)).toBe('elapsed ██████████ 00:01 of 00:01');
  });
});
