// Critique 19, slice B: the HUD agent row and the side panel's worker row fade on one phase (stoprun-150-232567af-1/f0093.ans:11 vs :34: beta `◍`/193 in the
// panel, `◌`/231 in the HUD, one frame), and the 256-colour ramp drops its weight on the frame its colour lands (motion-232567af/todo-strip.ans:4-5).
import { describe, expect, test } from 'claude-code/testing';
import { Motion, MOTION_MS } from './motion';

describe('B3: one agent, one fade phase on every surface', () => {
  const seen = (hudAt: number, panelAt: number): Motion => {
    const m = new Motion(true);
    m.observe('hud-agents', [{ key: 'agent:beta-explorer', state: 'running' }], 0);
    m.observe('panel', [{ key: 'worker:beta-explorer', state: 'running' }], 0);
    m.observe('hud-agents', [{ key: 'agent:beta-explorer', state: 'running' }], 500); // an unchanged row keeps its entry
    for (const [surface, key, at] of [['panel', 'worker:beta-explorer', panelAt], ['hud-agents', 'agent:beta-explorer', hudAt]] as const) {
      m.observe(surface, [{ key, state: 'done' }], at);
    }
    return m;
  };
  test('the panel saw done 250 ms before the HUD: both rows read the earlier change', () => {
    const m = seen(1250, 1000);
    const c = m.ctx(1300)!;
    expect(c.entry('agent:beta-explorer')!.changed).toBe(1000);
    expect(c.entry('worker:beta-explorer')!.changed).toBe(1000);
  });
  test('the HUD saw done first: the panel row reads the HUD change', () => {
    const c = seen(1000, 1250).ctx(1300)!;
    expect([c.entry('agent:beta-explorer')!.changed, c.entry('worker:beta-explorer')!.changed]).toEqual([1000, 1000]);
  });
  test('rows in different states keep their own entries (no borrowing across a state change)', () => {
    const m = new Motion(true);
    m.observe('hud-agents', [{ key: 'agent:a', state: 'running' }], 0);
    m.observe('panel', [{ key: 'worker:a', state: 'running' }], 0);
    m.observe('panel', [{ key: 'worker:a', state: 'done' }], 1000);
    const c = m.ctx(1100)!;
    expect(c.entry('agent:a')!.state).toBe('running');
    expect(c.entry('worker:a')!.state).toBe('done');
  });
  test('a different agent never shares a phase, and a row with no twin is untouched', () => {
    const m = seen(1250, 1000);
    m.observe('hud-agents', [{ key: 'agent:beta-explorer', state: 'done' }, { key: 'agent:gamma', state: 'running' }], 1250);
    m.observe('hud-agents', [{ key: 'agent:beta-explorer', state: 'done' }, { key: 'agent:gamma', state: 'done' }], 1260);
    const c = m.ctx(1300)!;
    expect(c.entry('agent:gamma')!.changed).toBe(1260);
    expect(c.entry('agent:beta-explorer')!.changed).toBe(1000);
    expect(MOTION_MS).toBeGreaterThan(300);
  });
});
