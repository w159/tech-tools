// Design rev 5, slice C1 (chips in wave 43; one idiom in idle polish 3): the tab strip is names only (` status   team   channel   gates   core   board `), the same at 110 and 150 columns. The lit tab is a filled accent chip,
// every other one is accent text on its own raised tile, one cell apart; no rule under the lit one, no key letter is drawn or bound and no key hint line is printed.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { cells, uiFromEnv } from './atlas-ui';
import { fillRows, headerRows, lineText, stripLayout, tabRows, type PanelTab } from './panel-layout';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const TABS: PanelTab[] = ['route', 'team', 'channel', 'gates', 'core'];
const word = (t: PanelTab): string => (t === 'route' ? 'status' : t); // the first tab's id is `route`; it reads `status`
const NAMES = 'status   team   channel   gates   core   board';

describe('C1: the strip is names only at every width', () => {
  for (const cols of [38, 44, 52, 80, 120, 150]) {
    for (const tab of TABS) {
      test(`${cols} cells, ${tab} lit: chips (one space between where the pane is narrow), no key letters, one rule row`, () => {
        const rows = tabRows(panelWorld(tab, cols, ui));
        const text = rows.map(lineText);
        expect(rows).toHaveLength(1);
        expect(text[0]!.trim()).toBe(cols >= 48 ? NAMES : NAMES.replace(/ {3}/g, ' ')); // below 48: one-cell gap and no chip padding, still one row
        expect(text[0]).not.toMatch(/\b[rtcgko]:/);
        for (const t of text) expect(cells(t)).toBeLessThanOrEqual(cols);
        const lit = rows[0]!.runs.find((x) => x.t.trim() === word(tab))!;
        expect([lit.bold, lit.bg]).toEqual([true, 'accent']); // the lit chip is filled
        const rest = rows[0]!.runs.filter((x) => x.t.trim() && x.t.trim() !== word(tab));
        expect(rest.every((x) => !x.bold && x.tone === 'accent' && !!x.bgHex)).toBe(true); // the others are raised tiles
        expect(text.join('')).not.toMatch(/[━]/);
      });
    }
  }
  test('the layout is always the bare one row form (the keys are never drawn in the strip)', () => {
    for (const cols of [37, 40, 60, 150]) expect([cols, stripLayout(cols).bare, stripLayout(cols).rows.length]).toEqual([cols, true, 1]);
  });
  test('the strip rows are identical at 110 (38 cells) and 150 (49 cells) but for the gap and padding', () => {
    const at = (cols: number): string => lineText(tabRows(panelWorld('team', cols, ui))[0]!).trim().replace(/ +/g, ' ');
    expect(at(38)).toBe(at(52));
  });
});

describe('C1: no key hint line at the pane foot (wave 43)', () => {
  test('a tall team pane ends its fill blank: no key hint', () => {
    const m = panelWorld('team', 49, ui);
    const fill = fillRows({ ...m, rows: 40 }, 6);
    expect(fill.length).toBeGreaterThan(2);
    expect(fill.every((l) => lineText(l).trim() === '')).toBe(true);
  });
  test('a pane with no spare row draws no fill', () => {
    const m = panelWorld('team', 49, ui);
    expect(fillRows({ ...m, rows: headerRows(m).length + 6 + 1 }, 6)).toHaveLength(0);
  });
});
