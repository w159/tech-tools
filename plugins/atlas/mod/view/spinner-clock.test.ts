// C3 (critique 7, f0057): one spinner clock. The HUD and the side panel draw the same spinner frame for the same agent in the same snapshot:
// both turn spinFrameOf(spinClock(snapshot.now, tick), the agent's squad name). The HUD used the snapshot clock without the tick (so it froze
// between polls) and the agent's display name (so its phase differed from the panel's).
import { describe, expect, test } from 'claude-code/testing';
import { worldSidebar, worldSnapshot } from '../../contracts/world-live';
import { liveWorkers } from '../data/live';
import { SPINNER_MS, runsString, spinClock, spinFrameOf, leadSpinnerGlyph, type Ui } from '../design/atlas-ui';
import { hudAgents, hudLines } from './hud/hud';
import { rowSpinnerGlyph } from './hud/hud-surface';
import { panelModelOf } from './panel/pane/sidebar-model';
import { bodyLines, lineText } from './panel/panel-layout';
import { panelWorld } from '../../contracts/panel-world';
import { LEAD_FRAMES, spinnerGlyph } from '../design/atlas-ui';
import { bandLines, runsText, type MissionModel } from './band/mission-layout';
import { sharedSpinFrame } from '../motion/motion';
import { type PanelModel } from './panel/panel-layout';
import type { TodoItem } from '../contract';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const glyphOf = (rows: readonly string[], name: string): string | undefined => rows.find((l) => l.includes(name))?.trimStart().replace(/^[▸│▌]\s*/, '')[0];

describe('spinClock', () => {
  test('the snapshot clock moves with the ticker: one SPINNER_MS per tick', () => {
    expect(spinClock(1_000, 0)).toBe(1_000);
    expect(spinClock(1_000, 3)).toBe(1_000 + 3 * SPINNER_MS);
    expect(spinClock(1_000)).toBe(1_000);
    expect(spinFrameOf(spinClock(1_000, 1), 'a')).toBe(spinFrameOf(1_000, 'a') + 1);
  });
});

describe('the HUD and the side panel turn one frame per agent', () => {
  const snap = worldSnapshot();
  const live = liveWorkers(snap, snap.now);
  const agents = hudAgents(live, snap.squad);
  const running = agents.filter((a) => a.state === 'working');

  for (const tick of [0, 1, 2, 3, 7]) {
    test(`tick ${tick}: every running agent shows the same glyph in the HUD and in the team tab`, () => {
      const hud = hudLines({ todos: [], agents }, { cols: 120, maxRows: 40, ui, tick, now: snap.now }).map((r) => runsString(r));
      const panel = bodyLines(panelModelOf({ ...worldSidebar('team', 100, snap), tick }, ui, 100)).map(lineText);
      expect(running.length).toBeGreaterThan(0);
      for (const a of running) {
        const id = a.key ?? a.name; // the squad name the panel rows carry
        expect([a.name, glyphOf(hud, a.name)]).toEqual([a.name, rowSpinnerGlyph(spinFrameOf(spinClock(snap.now, tick), ''))]); // rev 5: one phase for every HUD row
        expect([id, glyphOf(panel, id)]).toEqual([id, leadSpinnerGlyph(spinFrameOf(spinClock(snap.now, tick), id))]);
      }
    });
  }

  test('rev 5: every running HUD row of one frame turns the same glyph, whatever the agent is called (one phase, no per-row offsets)', () => {
    const NOW = 1_700_000_000_000;
    const names = ['alpha', 'beta', 'gamma', 'delta', 'omega'];
    const agents = names.map((n, i) => ({ name: n, key: `${n}-explorer-${i}`, role: 'explorer', state: 'working' as const, ui: 'running' as const }));
    const rows = hudLines({ todos: [], agents }, { cols: 120, maxRows: 40, ui, tick: 1, now: NOW }).map((r) => runsString(r));
    const glyphs = agents.map((a) => glyphOf(rows, a.name));
    expect(new Set(glyphs).size).toBe(1);
    expect(glyphs[0]).toBe(rowSpinnerGlyph(spinFrameOf(spinClock(NOW, 1), '')));
  });

  test('the HUD frame turns between data polls: the same snapshot at the next tick shows the next frame', () => {
    const at = (tick: number): string => hudLines({ todos: [], agents }, { cols: 120, maxRows: 40, ui, tick, now: snap.now }).map((r) => runsString(r)).find((l) => l.includes(running[0]!.name))!.trimStart().replace(/^[▸│▌]\s*/, '')[0]!;
    expect(at(1)).not.toBe(at(0));
  });
});

describe('wave37-spinner', () => {
// Wave 37 follow-up: the band and the side panel turn ONE spinner (motion.sharedSpinFrame), so both show the same glyph on the same frame.

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['research', 'plan', 'build', 'verify', 'done'] as const;
const SPIN_MARK = /[◐◓◑◒]/;
const bandModel = (now: number): MissionModel => ({ cols: 150, maxRows: 1, tick: 0, now, project: 'p', phases: PHASES, phase: 'build', done: 3, total: 7, workers: [], checks: null, ui, busy: true, turnSecs: 42 });
const bandGlyph = (now: number): string => runsText(bandLines(bandModel(now))[0]!.runs).match(SPIN_MARK)?.[0] ?? '';
const phaseGlyph = (now: number): string => {
  const m: PanelModel = panelWorld('route', 150, ui, { now, tick: 0, run: { kind: 'working', secs: 42 } });
  const t = bodyLines(m).map(lineText);
  const row = t[t.findIndex((l) => l.trim() === 'PHASE') + 1] ?? ''; // slice S3: the stepper row
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
      const panel = spinsOf(bodyLines(panelWorld('route', 150, ui, { now, tick: 0, run: { kind: 'working', secs: 42 } })).map(lineText).filter((l) => !/^ TEAM /.test(l)).join('\n')); // the TEAM tally's ◐ is the static running glyph, not a turning mark
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
});
