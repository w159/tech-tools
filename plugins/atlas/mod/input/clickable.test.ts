// clickable.ts (S1): the one chip idiom. Active chip = accent fill + the readable ink, bold; inactive chip = raised tile; hover = accent-tinted fill + underline; chevrons unchanged.
import { describe, expect, test } from 'claude-code/testing';
import { PALETTES, inkFor, type Ui } from '../atlas-ui';
import { activeChipStyle, chevron, chipStyle, hoverStyle } from './clickable';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const latte: Ui = { theme: 'latte', ascii: false, color: 'truecolor' };
const mono: Ui = { theme: 'mocha', ascii: false, color: 'none' };

describe('chip idiom', () => {
  for (const ui of [mocha, latte]) {
    test(`${ui.theme}: the active chip is the accent fill with the readable ink, bold, and differs from the inactive tile`, () => {
      const on = activeChipStyle(ui);
      const off = chipStyle(ui);
      expect(on.backgroundColor).toBe(PALETTES[ui.theme].accent);
      expect(on.bold).toBe(true);
      expect(on.color).toBe(PALETTES[ui.theme][inkFor('accent', ui.theme)]);
      expect(on.backgroundColor).not.toBe(off.backgroundColor);
    });
    test(`${ui.theme}: the hover fill differs from the active fill and the inactive tile, and underlines`, () => {
      const h = hoverStyle(ui, 'band:health');
      expect(h.backgroundColor).toBeDefined();
      expect(h.backgroundColor).not.toBe(activeChipStyle(ui).backgroundColor);
      expect(h.backgroundColor).not.toBe(chipStyle(ui).backgroundColor);
      expect(h.underline).toBe(true);
      expect(h.scope).toBe('band:health');
    });
  }
  test('with no colour the active chip is inverse and the inactive chip underlined', () => {
    expect(activeChipStyle(mono)).toEqual({ inverse: true, bold: true });
    expect(chipStyle(mono)).toEqual({ underline: true });
    expect(hoverStyle(mono, 'k').backgroundColor).toBeUndefined();
  });
  test('the chevron helper is unchanged', () => {
    expect(chevron(false, { ascii: false })).toBe('▸');
    expect(chevron(true, { ascii: false })).toBe('▾');
    expect(chevron(false, { ascii: true })).toBe('>');
    expect(chevron(true, { ascii: true })).toBe('v');
  });
});
