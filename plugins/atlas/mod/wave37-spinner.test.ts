// Wave 37 follow-up: the band and the side panel turn ONE braille spinner (motion.sharedSpinFrame), so both show the same glyph on the same frame.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { LEAD_FRAMES, SPINNER_MS, type Ui } from './atlas-ui';
import { bandLines, runsText, type MissionModel } from './mission-layout';
import { sharedSpinFrame } from './motion';
import { lineText, bodyLines, type PanelModel } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['research', 'plan', 'build', 'verify', 'done'] as const;
const BRAILLE = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;
const bandModel = (now: number): MissionModel => ({ cols: 150, maxRows: 1, tick: 0, now, project: 'p', phases: PHASES, phase: 'build', done: 3, total: 7, workers: [], checks: null, ui, busy: true, turnSecs: 42 });
const bandGlyph = (now: number): string => runsText(bandLines(bandModel(now))[0]!.runs).match(BRAILLE)?.[0] ?? '';
const phaseGlyph = (now: number): string => {
  const m: PanelModel = panelWorld('route', 150, ui, { now, tick: 0, run: { kind: 'working', secs: 42 } });
  const row = bodyLines(m).map(lineText).find((l) => /^\s*phase\b/.test(l)) ?? '';
  return row.match(BRAILLE)?.[0] ?? '';
};

describe('wave 37: one braille spinner for the band and the side panel', () => {
  test('the side-panel phase spinner glyph equals the band spinner glyph for the same now', () => {
    const base = 1_800_000_000_000;
    for (let i = 0; i < 25; i++) {
      const now = base + i * SPINNER_MS + 37;
      const want = LEAD_FRAMES[sharedSpinFrame(now)]!;
      expect(bandGlyph(now)).toBe(want);
      expect(phaseGlyph(now)).toBe(want);
    }
  });
  test('the glyph turns every beat: ten different frames across ten beats', () => {
    const seen = new Set(Array.from({ length: 10 }, (_, i) => phaseGlyph(1_800_000_000_000 + i * SPINNER_MS)));
    expect(seen.size).toBe(10);
  });
});
