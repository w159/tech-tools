// Design rev 5, slice C1: the tab strip is names only (`route  team  channel  gates  core  board`), the same at 110 and 150 columns. The lit tab is bold accent with a
// one-row accent underline the width of its name, the rest dim neutral, two spaces between names. The keys stay bound (zero-width layer in mod/pane/sidebar.tsx) and are
// named once in a dim line at the pane foot where the pane has room.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { cells, uiFromEnv } from './atlas-ui';
import { KEY_HINT, fillRows, headerRows, lineText, stripLayout, tabRows, type PanelTab } from './panel-layout';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const TABS: PanelTab[] = ['route', 'team', 'channel', 'gates', 'core'];
const NAMES = 'route  team  channel  gates  core  board';

describe('C1: the strip is names only at every width', () => {
  for (const cols of [38, 44, 52, 80, 120, 150]) {
    for (const tab of TABS) {
      test(`${cols} cells, ${tab} lit: names with two spaces, no key letters, one rule row`, () => {
        const rows = tabRows(panelWorld(tab, cols, ui));
        const text = rows.map(lineText);
        expect(rows).toHaveLength(2);
        expect(text[0]!.trim()).toBe(cols >= 40 ? NAMES : NAMES.replace(/ {2}/g, ' ')); // 38: one-cell gap, still one row
        expect(text[0]).not.toMatch(/\b[rtcgko]:/);
        for (const t of text) expect(cells(t)).toBeLessThanOrEqual(cols);
        const lit = rows[0]!.runs.find((x) => x.t === tab)!;
        expect([lit.bold, lit.tone]).toEqual([true, 'accent']);
        expect(rows[0]!.runs.filter((x) => x.t.trim() && x.t !== tab).every((x) => !x.bold && x.tone === 'muted')).toBe(true);
        expect(rows[1]!.runs.find((x) => /^[━-]+$/.test(x.t))).toMatchObject({ tone: 'accent' });
        expect(text[1]!.indexOf('━')).toBe(text[0]!.indexOf(tab));
        expect(text[1]!.trim()).toBe('━'.repeat(tab.length));
      });
    }
  }
  test('the layout is always the bare one row form (the keys are never drawn in the strip)', () => {
    for (const cols of [36, 40, 60, 150]) expect([cols, stripLayout(cols).bare, stripLayout(cols).rows.length]).toEqual([cols, true, 1]);
  });
  test('the strip rows are identical at 110 (38 cells) and 150 (49 cells) but for the gap', () => {
    const at = (cols: number): string => lineText(tabRows(panelWorld('team', cols, ui))[0]!).trim().replace(/ +/g, ' ');
    expect(at(38)).toBe(at(49));
  });
});

describe('C1: the key hint is one dim line at the pane foot, only where there is room', () => {
  test('a tall team pane ends its fill with the dim hint', () => {
    const m = panelWorld('team', 49, ui);
    const fill = fillRows({ ...m, rows: 40 }, 6);
    { const t = lineText(fill[fill.length - 1]!).trim(); expect(KEY_HINT.startsWith(t.replace(/\u2026$/, ''))).toBe(true); expect([...t].length).toBeLessThanOrEqual(48); } // the hint is cut to the pane
    expect(fill[fill.length - 1]!.runs.every((x) => x.tone === 'dim' || !x.t.trim())).toBe(true);
    expect(fill.filter((l) => lineText(l).includes('r: route'))).toHaveLength(1);
  });
  test('a pane with no spare row draws no hint', () => {
    const m = panelWorld('team', 49, ui);
    expect(fillRows({ ...m, rows: headerRows(m).length + 6 + 1 }, 6)).toHaveLength(0);
  });
});
