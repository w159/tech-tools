// Critique 11 C5: the Board inside the side panel (live-150-5d6a53ef-1 / live-110-5d6a53ef-1 tab-board.png): a nested `ATLAS > BOARD` ribbon under the
// panel's own `ATLAS > SIDEPANEL`, `5 items` said twice, and the state word glued to the title (110) or to the owner (150).
import { describe, expect, test } from 'claude-code/testing';
import { boardBody, boardLines, boardText, type BoardRow } from './board-model';
import { textWidth } from './theme';
import type { Ui } from './atlas-ui';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const row = (label: string, owner = ''): BoardRow => ({ label, state: 'done', owner, detail: '' });
// The live board: five plan rows, the three explorer dispatches folded into them.
const live = (): BoardRow[] => [row('T1 read alpha.py', 'alpha-explorer'), row('T2 read beta.py', 'beta-explorer'), row('T3 read gamma.py', 'gamma-explorer'), row('T4 combine the three reports'), row('T5 write the final summary')];

describe('the board inside the side panel', () => {
  test('critique 12: without its ribbon the board still has one title row (`BOARD  5 items`), no blank row, and the footer carries only the folds', () => {
    const t = boardText(boardLines(live(), { cols: 44, ui, folded: 3, openFolded: 0, ribbon: false }));
    expect(t[0]).toBe('  ▸ BOARD  5 items'); // critique 14: the same `▸ BOARD` marker the ribbon has
    expect(t.join('\n').match(/BOARD/g)!.length).toBe(1); // one title, never nested
    expect(t[1]).toContain('T1 read alpha.py');
    expect(t.at(-1)).toBe('  3 dispatches folded');
    expect(t.join('\n').match(/5 items/g)!.length).toBe(1);
  });
  test('with its ribbon (the standalone pane) the count is in the ribbon and the footer does not repeat it', () => {
    const t = boardText(boardLines(live(), { cols: 80, ui, folded: 3, openFolded: 0 }));
    expect(t[0]).toContain('BOARD');
    expect(t.join('\n').match(/5 items/g)!.length).toBe(1);
    expect(t.at(-1)).toBe('  3 dispatches folded');
  });
  test('rich form has no count in its ribbon, so the footer keeps it', () => {
    const t = boardText(boardLines(live(), { cols: 120, ui, rich: true, folded: 3, openFolded: 0 }));
    expect(t.join('\n').match(/5 items/g)!.length).toBe(1);
  });
});

describe('the state column is padded', () => {
  const cut = (line: string, word: string): { before: string; after: string } => ({ before: line.slice(0, line.indexOf(word)), after: line.slice(line.indexOf(word) + word.length) });
  test('a title that fills its column keeps two blank cells before the state word (38 columns: `reports done`)', () => {
    const lines = boardBody(live(), { cols: 38, ui }).map((l) => l.runs.map((x) => x.t).join(''));
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(38);
    const rowsOnly = lines.filter((l) => !/^ {4}\S/.test(l)); // the owner stands under its row (critique 15 B5)
    for (const l of rowsOnly) expect(cut(l, 'done').before).toMatch(/ {2}$/);
    expect(rowsOnly[3]).toContain('T4 combine the three reports'); // whole: nothing is cut to make the room
  });
  test('the owner keeps two blank cells after the state word (54 columns: `done alpha-explorer`)', () => {
    const lines = boardBody(live(), { cols: 54, ui }).map((l) => l.runs.map((x) => x.t).join(''));
    for (const l of lines.slice(0, 3)) expect(l).toMatch(/done {2,}\S+-explorer/);
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(54);
  });
});
