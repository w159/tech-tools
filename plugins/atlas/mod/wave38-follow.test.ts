// Wave 38 follow-ups. A: the side panel's phase row shows the glyph and the clock the band last drew. B: the 110x40 HUD shows every running row.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { leadSpinnerGlyph, type Ui } from './atlas-ui';
import { forgetBandFrame, sharedSpinFrame } from './motion';
import { lineText, panelLines, type PanelModel } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const SPIN_MARK = /[◐◓◑◒]/;

describe('follow-up A: the side panel tick is the band tick', () => {
  const phaseRowOf = (over: Partial<PanelModel>): string => {
    const m = panelWorld('route', 110, ui, { rows: 40, now: 1_000_000, run: { kind: 'working', secs: 41 }, phase: 'implement', ...over });
    return panelLines(m).map(lineText).find((l) => /^\s*phase\b/.test(l))!;
  };
  test('a run that carries frame f and 0:42 prints that spinner glyph and that clock, whatever now is (truth 41: no copy of the band\'s last note)', () => {
    const now = 1_000_000;
    const other = (sharedSpinFrame(now) + 3) % 10; // a frame the shared clock does not give at `now`
    const row = phaseRowOf({ now, run: { kind: 'working', secs: 42, frame: other } });
    expect(row.match(SPIN_MARK)?.[0]).toBe(leadSpinnerGlyph(other));
    expect(row).toContain('0:42');
    expect(row).not.toContain('0:41');
    expect(phaseRowOf({ now: now + 50, run: { kind: 'working', secs: 42, frame: other } }).match(SPIN_MARK)?.[0]).toBe(leadSpinnerGlyph(other));
  });
  test('before the band ever drew, the panel falls back to the shared clock and its own seconds', () => {
    forgetBandFrame();
    const row = phaseRowOf({ now: 1_000_000 });
    expect(row).toContain('0:41');
  });
});
