// Wave 37 follow-up: the band and the side panel turn ONE spinner (motion.sharedSpinFrame), so both show the same glyph on the same frame.
import { describe, expect, test } from 'claude-code/testing';
import { panelWorld } from '../contracts/panel-world';
import { LEAD_FRAMES, leadSpinnerGlyph, SPINNER_MS, spinFrameOf, spinnerGlyph, type Ui } from './atlas-ui';
import { bandLines, runsText, type MissionModel } from './mission-layout';
import { sharedSpinFrame } from './motion';
import { lineText, bodyLines, type PanelModel } from './panel-layout';
import { rowSpinnerGlyph } from './hud-surface';
import { hudLines } from './hud';
import type { TodoItem } from './contract';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['research', 'plan', 'build', 'verify', 'done'] as const;
const SPIN_MARK = /[◐◓◑◒]/;
const bandModel = (now: number): MissionModel => ({ cols: 150, maxRows: 1, tick: 0, now, project: 'p', phases: PHASES, phase: 'build', done: 3, total: 7, workers: [], checks: null, ui, busy: true, turnSecs: 42 });
const bandGlyph = (now: number): string => runsText(bandLines(bandModel(now))[0]!.runs).match(SPIN_MARK)?.[0] ?? '';
const phaseGlyph = (now: number): string => {
  const m: PanelModel = panelWorld('route', 150, ui, { now, tick: 0, run: { kind: 'working', secs: 42 } });
  const row = bodyLines(m).map(lineText).find((l) => /^\s*phase\b/.test(l)) ?? '';
  return row.match(SPIN_MARK)?.[0] ?? '';
};

describe('wave 37: one spinner for the band and the side panel', () => {
  test('the side-panel phase spinner glyph equals the band spinner glyph for the same now', () => {
    const base = 1_800_000_000_000;
    for (let i = 0; i < 25; i++) {
      const now = base + i * SPINNER_MS + 37;
      const want = LEAD_FRAMES[sharedSpinFrame(now)]!;
      expect(bandGlyph(now)).toBe(want);
      expect(phaseGlyph(now)).toBe(want);
    }
  });
  test('the glyph turns every beat: no beat repeats the one before it, and four beats show the four frames', () => {
    const seq = Array.from({ length: 10 }, (_, i) => phaseGlyph(1_800_000_000_000 + i * SPINNER_MS));
    for (let i = 1; i < seq.length; i++) expect([i, seq[i] === seq[i - 1]]).toEqual([i, false]);
    expect(new Set(seq.slice(0, 4)).size).toBe(4);
  });
});

/** Every spinner mark of either family a surface draws in one frame. */
const ANY_SPIN = /[\u25d0\u25d3\u25d1\u25d2\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f]/g;
const spinsOf = (text: string): string[] => text.match(ANY_SPIN) ?? [];
describe('one spinner glyph set for the HUD rows, the band and the side panel', () => {
  const todos = [{ id: 'T1', content: 'wire the gate', status: 'in_progress', session_id: 's', origin: 'session' }] as TodoItem[];
  const agents = [{ name: 'alpha', role: 'implementer', state: 'running', model: 'sonnet' }];
  test('at one frame every running mark on the HUD, the band and the panel is the same glyph', () => {
    const base = 1_800_000_000_000;
    for (let i = 0; i < 12; i++) {
      const now = base + i * SPINNER_MS + 37;
      const hud = spinsOf(hudLines({ todos, agents }, { cols: 120, maxRows: 30, ui, now, tick: 0 }).map((l) => runsText(l)).join('\n'));
      const band = spinsOf(runsText(bandLines(bandModel(now))[0]!.runs));
      const panel = spinsOf(bodyLines(panelWorld('route', 150, ui, { now, tick: 0, run: { kind: 'working', secs: 42 } })).map(lineText).join('\n'));
      expect([i, hud.length > 1, band.length > 0, panel.length > 0]).toEqual([i, true, true, true]); // the TODO row and a SUBAGENTS mark, the band lead, a panel mark
      expect([i, [...new Set([...hud, ...band, ...panel])].join('')]).toEqual([i, spinnerGlyph(spinFrameOf(now))]);
    }
  });
  test('ASCII mode: the row, the lead and the panel names all turn the one ASCII spinner', () => {
    for (let f = -2; f < 12; f++) {
      expect([f, rowSpinnerGlyph(f, true), leadSpinnerGlyph(f, true)]).toEqual([f, spinnerGlyph(f, true), spinnerGlyph(f, true)]);
      expect('|/-\\').toContain(spinnerGlyph(f, true));
    }
    const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
    const now = 1_800_000_000_000 + 137; // beat 1: `/`
    expect(runsText(bandLines({ ...bandModel(now), ui: ascii })[0]!.runs)).toContain(`${spinnerGlyph(spinFrameOf(now), true)} working`);
    const hud = hudLines({ todos, agents }, { cols: 120, maxRows: 30, ui: ascii, now, tick: 0 }).map((l) => runsText(l));
    expect(hud.some((l) => l.includes(`${spinnerGlyph(spinFrameOf(now), true)} wire the gate`))).toBe(true);
  });
});
