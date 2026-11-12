// Critique 18, slice C5: at 110 columns the side pane is about 38 cells wide and the six-tab strip wrapped onto two lines on every tab
// (stoprun-110-562576ed-1/tab-route.png: `r: route  t: team  c: channel` / `g: gates  k: core  o: board`; live-110-562576ed-2/tab-board.png). The strip stays on one line
// whenever the six whole words fit; the keys stay bound (the zero-width layer of mod/pane/sidebar.tsx) and the band footer names them.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { uiFromEnv } from './atlas-ui';
import { cells } from './atlas-ui';
import { headerRows, lineText, stripLayout, tabRows, type PanelTab } from './panel-layout';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const TABS: PanelTab[] = ['route', 'team', 'channel', 'gates', 'core'];

describe('C5: the tab strip stays on one line at the 110 column pane', () => {
  for (const cols of [36, 37, 38, 40, 44]) {
    for (const tab of TABS) {
      test(`${cols} cells, ${tab} lit: one strip row, the whole words, one rule under the lit tab`, () => {
        const rows = tabRows(panelWorld(tab, cols, ui)).map(lineText);
        expect(rows).toHaveLength(2); // the strip and the rule under the lit tab: no wrapped second strip
        expect(rows[0]!.trim()).toMatch(/^route {1,2}team {1,2}channel {1,2}gates {1,2}core {1,2}board$/);
        for (const r of rows) expect(cells(r)).toBeLessThanOrEqual(cols);
      });
    }
  }
  test('the same form on every tab at a width (no tab drops its keys to fit while another wraps)', () => {
    for (const cols of [36, 38, 44, 52, 60]) {
      const forms = (['route', 'team', 'channel', 'gates', 'core', 'board'] as const).map((t) => JSON.stringify(stripLayout(cols, t)));
      expect([cols, new Set(forms).size]).toEqual([cols, 1]);
    }
  });
  test('design rev 5 C1: the keys are never drawn in the strip, at any width (53 cells and up too)', () => {
    expect(headerRows(panelWorld('route', 120, ui)).slice(2, 3).map(lineText)[0]!.trim()).toBe('route  team  channel  gates  core  board');
    expect(lineText(tabRows(panelWorld('team', 54, ui))[0]!).trim()).toBe('route  team  channel  gates  core  board');
  });
  test('words alone on one row down to 35 cells, then the full words wrap (never a shortened word)', () => {
    expect(stripLayout(36, 'route').rows).toHaveLength(1);
    expect(stripLayout(36, 'route').bare).toBe(true);
    expect(stripLayout(30, 'route').rows.length).toBeGreaterThan(1);
  });
});
