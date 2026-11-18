// Critique 18, slice C5: at 110 columns the side pane is about 38 cells wide and the six-tab strip wrapped onto two lines on every tab
// (stoprun-110-562576ed-1/tab-route.png: `r: route  t: team  c: channel` / `g: gates  k: core  o: board`; live-110-562576ed-2/tab-board.png). The strip stays on one line
// whenever the six whole words fit; the keys stay bound (the zero-width layer of mod/view/panel/pane/sidebar.tsx) and the band footer names them.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { uiFromEnv } from './atlas-ui';
import { cells } from './atlas-ui';
import { headerRows, lineText, stripLayout, tabRows, type PanelTab } from './view/panel/panel-layout';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const TABS: PanelTab[] = ['route', 'team', 'channel', 'gates', 'core'];

describe('C5 (D14, AA5): the tab strip is one row of chips in one fixed order; a pane too narrow even for the short labels folds its trailing tabs into `more ›`', () => {
  for (const cols of [37, 38, 40, 44]) {
    for (const tab of TABS) {
      test(`${cols} cells, ${tab} lit: one strip row, the same leading tabs whichever is lit, the rest behind \`more ›\``, () => {
        const rows = tabRows(panelWorld(tab, cols, ui)).map(lineText);
        expect(rows).toHaveLength(1); // the strip alone: no rule under the lit tab, no wrapped second strip
        // AA5: no tab swapping; the lit tab may be folded, the header names it
        const want = cols >= 39 ? ['status', 'team', 'chan', 'gates'] : ['status', 'team', 'chan'];
        expect(rows[0]!.trim()).toMatch(new RegExp(`^${want.join(' {1,3}')} {1,3}more ›$`));
        for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(cols);
      });
    }
  }
  test('the same form on every tab at a width: the chip shape and the tab set never change with the lit tab (AA5)', () => {
    for (const cols of [37, 38, 44, 52, 60]) {
      const forms = (['route', 'team', 'channel', 'gates', 'core', 'board'] as const).map((t) => { const f = stripLayout(cols, t); return JSON.stringify({ ...f, rows: f.rows.map((r) => r.map((x) => x.label)), folded: f.folded.map((x) => x.label) }); });
      expect([cols, new Set(forms).size]).toEqual([cols, 1]);
    }
  });
  test('AA5: the lit tab is never swapped in: `more ›` stays last and the order stays', () => {
    for (const cols of [30, 37, 38, 40, 44]) {
      const base = stripLayout(cols, 'route').rows[0]!.map((t) => t.id);
      for (const tab of ['route', 'team', 'channel', 'gates', 'core', 'board'] as const) {
        const f = stripLayout(cols, tab);
        expect([cols, tab, f.rows[0]!.map((t) => t.id)]).toEqual([cols, tab, base]);
        expect(f.more).toBe(true);
      }
    }
  });
  test('the keys are never drawn in the strip: 48 cells and up show all six whole words, 45 to 47 the short `chan`', () => {
    expect(headerRows(panelWorld('route', 120, ui)).slice(2, 3).map(lineText)[0]!.trim()).toBe('status   team   channel   gates   core   board');
    expect(lineText(tabRows(panelWorld('team', 54, ui))[0]!).trim()).toBe('status   team   channel   gates   core   board');
    expect(lineText(tabRows(panelWorld('team', 47, ui))[0]!).trim()).toBe('status   team   chan   gates   core   board');
  });
  test('all six tabs on one row down to 45 cells (the short labels); below that the trailing tabs fold into `more ›` (never a second strip row while closed)', () => {
    expect(stripLayout(48, 'route').rows).toHaveLength(1);
    expect(stripLayout(48, 'route').more).toBe(false);
    expect(stripLayout(47, 'route').more).toBe(false);
    expect(stripLayout(45, 'route').more).toBe(false);
    expect(stripLayout(44, 'route').more).toBe(true);
    expect(stripLayout(30, 'route').rows).toHaveLength(1);
    expect(stripLayout(30, 'route').folded.length).toBeGreaterThan(0);
    expect(stripLayout(37, 'route').bare).toBe(true);
  });
});
