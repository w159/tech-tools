// Wave 38 follow-ups. A: the side panel's phase row shows the glyph and the clock the band last drew. B: the 110x40 HUD shows every running row.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import type { Ui } from './atlas-ui';
import { forgetBandFrame, noteBandFrame, sharedSpinFrame } from './motion';
import { lineText, panelLines, type PanelModel } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const BRAILLE = /[⠀-⣿]/;

describe('follow-up A: the side panel tick is the band tick', () => {
  const phaseRowOf = (over: Partial<PanelModel>): string => {
    const m = panelWorld('route', 110, ui, { rows: 40, now: 1_000_000, run: { kind: 'working', secs: 41 }, phase: 'implement', ...over });
    return panelLines(m).map(lineText).find((l) => /^\s*phase\b/.test(l))!;
  };
  test('after the band drew frame f at m:ss, the phase row prints that braille glyph and that clock', () => {
    const now = 1_000_000;
    const other = (sharedSpinFrame(now) + 3) % 10; // a frame the shared clock does not give at `now`
    noteBandFrame(other, 42, now);
    const row = phaseRowOf({ now });
    const glyph = row.match(BRAILLE)?.[0];
    forgetBandFrame();
    const fallback = phaseRowOf({ now }).match(BRAILLE)?.[0];
    expect(glyph).toBeDefined();
    expect(glyph).not.toBe(fallback); // the band's frame, not the shared clock's
    expect(row).toContain('0:42');
    expect(row).not.toContain('0:41');
    noteBandFrame(other, 42, now);
    expect(glyph).toBe(phaseRowOf({ now: now + 50 }).match(BRAILLE)?.[0]);
    forgetBandFrame();
  });
  test('before the band ever drew, the panel falls back to the shared clock and its own seconds', () => {
    forgetBandFrame();
    const row = phaseRowOf({ now: 1_000_000 });
    expect(row).toContain('0:41');
  });
});
