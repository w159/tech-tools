// C4 (critique 7, reversed by critique 14): the TODO header states its count in one format at every width, `N/M` like the band, the board and the panel, never `N of M done`.
import { describe, expect, test } from 'claude-code/testing';
import { runsString, type Ui } from './atlas-ui';
import { hudLines } from './hud';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
const plan = (n: number, done: number) => Array.from({ length: n }, (_, i) => ({ id: String(i + 1), content: `item ${i + 1}`, status: i < done ? 'completed' : 'pending' }));

describe('TODO header count', () => {
  for (const ui of [mocha, ascii]) {
    for (const rich of [false, true]) {
      test(`${ui.ascii ? 'ASCII' : 'Unicode'}${rich ? ' rich' : ''}: "N/M" at 40, 60, 79, 80, 99, 100, 110, 119, 120, 150 and 200 columns`, () => {
        for (const cols of [40, 60, 79, 80, 99, 100, 110, 119, 120, 150, 200]) {
          for (const [n, d] of [[5, 5], [5, 2], [12, 0]] as const) {
            const head = runsString(hudLines({ todos: plan(n, d) as never, agents: [] }, { cols, maxRows: 20, ui, rich, now: 1_700_000_000_000 })[0]!);
            expect([cols, n, d, head.includes(` ${d}/${n} `), / of \d/.test(head)]).toEqual([cols, n, d, true, false]);
          }
        }
      });
    }
  }
});
