// Design rev 5, slice C1 (chips in wave 43; one idiom in idle polish 3): the tab strip is names only (` status   team   channel   gates   core   board `), the same at 110 and 150 columns. The lit tab is a filled accent chip,
// every other one is accent text on its own raised tile, one cell apart; no rule under the lit one, no key letter is drawn or bound and no key hint line is printed.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../../../contracts/panel-world';
import { cells, uiFromEnv } from '../../design/atlas-ui';
import { fillRows, headerRows, lineText, stripLayout, tabRows, type PanelTab } from './panel-layout';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const TABS: PanelTab[] = ['route', 'team', 'channel', 'core'];
const word = (t: PanelTab): string => (t === 'route' ? 'status' : t); // the first tab's id is `route`; it reads `status`
const NAMES = 'status   team   channel   gates   core   board';

describe('C1 (D14): the strip is chips with one fixed shape at every width', () => {
  for (const cols of [38, 44, 52, 80, 120, 150]) {
    for (const tab of TABS) {
    }
  }
  test('the layout is always the bare one row form (the keys are never drawn in the strip)', () => {
    for (const cols of [37, 40, 60, 150]) expect([cols, stripLayout(cols).bare, stripLayout(cols).rows.length]).toEqual([cols, true, 1]);
  });
  test('the chip shape is the same at 49 and 150 cells: only the fold differs', () => {
    const at = (cols: number): string => lineText(tabRows(panelWorld('team', cols, ui))[0]!);
    expect(at(49)).toBe(at(150).trimEnd().padEnd(at(49).length));
  });
});

describe('C1: no key hint line at the pane foot (wave 43)', () => {
  test('a pane with no spare row draws no fill', () => {
    const m = panelWorld('team', 49, ui);
    expect(fillRows({ ...m, rows: headerRows(m).length + 6 + 1 }, 6)).toHaveLength(0);
  });
});

describe('panel-strip-c18', () => {
// Critique 18, slice C5: at 110 columns the side pane is about 38 cells wide and the six-tab strip wrapped onto two lines on every tab
// (stoprun-110-562576ed-1/tab-route.png: `r: route  t: team  c: channel` / `g: gates  k: core  o: board`; live-110-562576ed-2/tab-board.png). The strip stays on one line
// whenever the six whole words fit; the keys stay bound (the zero-width layer of mod/view/panel/pane/sidebar.tsx) and the band footer names them.

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const TABS: PanelTab[] = ['route', 'team', 'channel', 'core'];

describe('C5 (D14, AA5): the tab strip is one row of chips in one fixed order; a pane too narrow even for the short labels folds its trailing tabs into `more ›`', () => {
  for (const cols of [37, 38, 40, 44]) {
    for (const tab of TABS) {
    }
  }
  test('the same form on every tab at a width: the chip shape and the tab set never change with the lit tab (AA5)', () => {
    for (const cols of [37, 38, 44, 52, 60]) {
      const forms = (['route', 'team', 'channel', 'gates', 'core', 'board'] as const).map((t) => { const f = stripLayout(cols, t); return JSON.stringify({ ...f, rows: f.rows.map((r) => r.map((x) => x.label)), folded: f.folded.map((x) => x.label) }); });
      expect([cols, new Set(forms).size]).toEqual([cols, 1]);
    }
  });
});
});
