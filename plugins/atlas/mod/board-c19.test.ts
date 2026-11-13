// Critique 19 C1: the board tab's owners (stoprun-150-232567af-1 and live-110-232567af-2 tab-board.png). At 150 the pane is 64 cells: the owner was cut to
// `alpha-exp...` with ~15 blank cells before it; at 110 (36 cells) the owners were a detached list under all rows. An owner is drawn whole beside its row
// or on a sub-line directly under that row, together with the row's reason and age.
import { describe, expect, test } from 'claude-code/testing';
import { boardFolded, boardLines, boardRowsOf, boardText, type BoardSource } from './board-model';
import { cells } from './atlas-ui';
import type { Ui } from './atlas-ui';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const done = (content: string, owner?: string, ownerState?: 'failed'): BoardSource => ({ content, status: 'completed', ...(owner ? { owner } : {}), ...(ownerState ? { ownerState } : {}) });
// stoprun-150-232567af-1: T2's worker was killed, the lead closed the row (done, amber); the three dispatch rows are folded.
const plan = (): BoardSource[] => [
  done('T1 read alpha.py (alpha-explorer)', 'alpha-explorer'),
  done('T2 read ghost.py (ghost-explorer)', 'ghost-explorer', 'failed'),
  done('T3 read beta.py (beta-explorer)', 'beta-explorer'),
  done('T4 combine the reports'),
  done('T5 write the final summary'),
  ...['alpha-explorer', 'ghost-explorer', 'beta-explorer'].map((o): BoardSource => ({ content: `read ${o}`, status: 'completed', owner: o, origin: 'dispatch' })),
];
const draw = (cols: number, items = plan()): string[] => boardText(boardLines(boardRowsOf(items, 1000), { cols, ui, folded: boardFolded(items), openFolded: 0, ribbon: false }));

describe('critique 19 C1: board owners', () => {
  test('150 (64-cell pane): every owner is whole, none is cut with an ellipsis, and no row has a 10-cell gap before its owner', () => {
    const t = draw(64);
    const all = t.join('\n');
    for (const n of ['alpha-explorer', 'ghost-explorer', 'beta-explorer']) expect(all).toContain(n);
    expect(all).not.toContain('...');
    expect(all).not.toContain('…');
    for (const l of t.filter((x) => x.includes('explorer'))) expect(l).not.toMatch(/\S {10,}[a-z]+-explorer\s*$/); // the gap the test guards is the one before the owner (wave 30: a title column padded to its widest title is not one)
    for (const l of t) expect(cells(l)).toBeLessThanOrEqual(64);
  });
  test('110 (36-cell pane): each owner is the line directly under its own row, not a list under all rows', () => {
    const t = draw(36);
    const at = (s: string): number => t.findIndex((l) => l.includes(s));
    for (const [row, owner] of [['T1 read alpha.py', 'alpha-explorer'], ['T2 read ghost.py', 'ghost-explorer'], ['T3 read beta.py', 'beta-explorer']] as const) {
      expect(t[at(row) + 1]).toContain(owner);
    }
    expect(t.join('\n').match(/alpha-explorer/g)!.length).toBe(1); // said once, under its row
    for (const l of t) expect(cells(l)).toBeLessThanOrEqual(36);
  });
  test('the owner sub-line carries the row\'s reason (`worker failed` for the doubted done), so the pane\'s room says something', () => {
    for (const cols of [36, 64]) {
      const t = draw(cols);
      const i = t.findIndex((l) => l.includes('T2 read ghost.py'));
      expect(`${t[i]}\n${t[i + 1]}`).toMatch(/failed/);
    }
  });
  test('an open row with an age says how long it has been open, on its own sub-line', () => {
    const items: BoardSource[] = [{ content: 'T1 read alpha.py (alpha-explorer)', status: 'in_progress', owner: 'alpha-explorer', claimed_at: 900 }, done('T2 write the summary')];
    const t = draw(36, items);
    const i = t.findIndex((l) => l.includes('T1 read alpha.py'));
    expect(t[i + 1]).toContain('alpha-explorer');
    expect(t[i + 1]).toMatch(/open 01:40/);
  });
  test('a roomy pane keeps the owner beside its row, whole', () => {
    const t = draw(80, [done('T1 read alpha.py', 'alpha-explorer'), done('T2 write it')]);
    expect(t.find((l) => l.includes('T1 read alpha.py'))).toContain('alpha-explorer');
    expect(t.join('\n').match(/alpha-explorer/g)!.length).toBe(1);
  });
});
