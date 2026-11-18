// Design rev 5, slice C1 (chips in wave 43; one idiom in idle polish 3): the tab strip is names only (` status   team   channel   gates   core   board `), the same at 110 and 150 columns. The lit tab is a filled accent chip,
// every other one is accent text on its own raised tile, one cell apart; no rule under the lit one, no key letter is drawn or bound and no key hint line is printed.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../../../contracts/panel-world';
import { cells, uiFromEnv } from '../../design/atlas-ui';
import { fillRows, headerRows, lineText, stripLayout, tabRows, type PanelTab } from './panel-layout';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const TABS: PanelTab[] = ['route', 'team', 'channel', 'gates', 'core'];
const word = (t: PanelTab): string => (t === 'route' ? 'status' : t); // the first tab's id is `route`; it reads `status`
const NAMES = 'status   team   channel   gates   core   board';

describe('C1 (D14): the strip is chips with one fixed shape at every width', () => {
  for (const cols of [38, 44, 52, 80, 120, 150]) {
    for (const tab of TABS) {
      test(`${cols} cells, ${tab} lit: chips with a 1-cell pad and gap, no key letters, one row; below 48 the trailing tabs fold into \`more ›\``, () => {
        const rows = tabRows(panelWorld(tab, cols, ui));
        const text = rows.map(lineText);
        expect(rows).toHaveLength(1);
        const f = stripLayout(cols, tab); // Z5: the lit tab is always on the strip
        const names = f.rows[0]!.map((t) => t.label).join('   ') + (f.more ? '   more ›' : '');
        expect(text[0]!.trim()).toBe(names); // the same chip shape at every width: pad 1, gap 1 around the chip, so the text reads three apart
        expect(text[0]).not.toMatch(/\b[rtcgko]:/);
        for (const t of text) expect(cells(t)).toBeLessThanOrEqual(cols);
        const lit = rows[0]!.runs.find((x) => x.t.trim() === word(tab));
        if (lit) expect([lit.bold, lit.bg]).toEqual([true, 'accent']); // the lit chip is filled (a lit tab behind `more ›` fills that chip instead)
        const rest = rows[0]!.runs.filter((x) => x.t.trim() && x.t.trim() !== word(tab));
        expect(rest.every((x) => x.tone === 'accent' && !!x.bgHex || x.bg === 'accent')).toBe(true); // the others are raised tiles
        expect(text.join('')).not.toMatch(/[━]/);
      });
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

describe('panel-strip-c18', () => {
// Critique 18, slice C5: at 110 columns the side pane is about 38 cells wide and the six-tab strip wrapped onto two lines on every tab
// (stoprun-110-562576ed-1/tab-route.png: `r: route  t: team  c: channel` / `g: gates  k: core  o: board`; live-110-562576ed-2/tab-board.png). The strip stays on one line
// whenever the six whole words fit; the keys stay bound (the zero-width layer of mod/view/panel/pane/sidebar.tsx) and the band footer names them.

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
});
