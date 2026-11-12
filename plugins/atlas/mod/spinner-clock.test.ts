// C3 (critique 7, f0057): one spinner clock. The HUD and the side panel draw the same spinner frame for the same agent in the same snapshot:
// both turn spinFrameOf(spinClock(snapshot.now, tick), the agent's squad name). The HUD used the snapshot clock without the tick (so it froze
// between polls) and the agent's display name (so its phase differed from the panel's).
import { describe, expect, test } from 'claude-code/testing';
import { worldSidebar, worldSnapshot } from '../contracts/world-live';
import { liveWorkers } from './data/live';
import { SPINNER_MS, runsString, spinClock, spinFrameOf, spinnerGlyph, type Ui } from './atlas-ui';
import { hudAgents, hudLines } from './hud';
import { panelModelOf } from './pane/sidebar-model';
import { bodyLines, lineText } from './panel-layout';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const glyphOf = (rows: readonly string[], name: string): string | undefined => rows.find((l) => l.includes(name))?.trimStart().replace(/^▸\s*/, '')[0];

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
        const want = spinnerGlyph(spinFrameOf(spinClock(snap.now, tick), id));
        expect([a.name, glyphOf(hud, a.name)]).toEqual([a.name, want]);
        expect([id, glyphOf(panel, id)]).toEqual([id, want]);
      }
    });
  }

  test('an agent shown under a display name turns the phase of its squad name, the panel row id', () => {
    const NOW = 1_700_000_000_000;
    const names = ['alpha', 'beta', 'gamma', 'delta', 'omega'];
    const agents = names.map((n, i) => ({ name: n, key: `${n}-explorer-${i}`, role: 'explorer', state: 'working' as const, ui: 'running' as const }));
    const rows = hudLines({ todos: [], agents }, { cols: 120, maxRows: 40, ui, tick: 1, now: NOW }).map((r) => runsString(r));
    for (const a of agents) expect([a.name, glyphOf(rows, a.name)]).toEqual([a.name, spinnerGlyph(spinFrameOf(spinClock(NOW, 1), a.key))]);
    expect(new Set(agents.map((a) => spinFrameOf(NOW, a.key))).size).toBe(1); // one shared phase
  });

  test('the HUD frame turns between data polls: the same snapshot at the next tick shows the next frame', () => {
    const at = (tick: number): string => hudLines({ todos: [], agents }, { cols: 120, maxRows: 40, ui, tick, now: snap.now }).map((r) => runsString(r)).find((l) => l.includes(running[0]!.name))!.trimStart().replace(/^▸\s*/, '')[0]!;
    expect(at(1)).not.toBe(at(0));
  });
});
