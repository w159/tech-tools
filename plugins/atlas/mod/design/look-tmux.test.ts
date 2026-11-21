// Inside tmux the host downsamples every hex to the 256 cube with hostTo256, which turns the Mocha panel navy (xterm 17). The mod must
// learn it is inside tmux through the same `$.env` read as every other name (look.ts), then every surface it paints lands on the grey ramp.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface } from 'claude-code';
import { clearLook, lookOf } from './look';
import { indicesOf, surfaces } from '../surface_indices';

const hostWith = (vars: Record<string, string>): EngineInterface =>
  ({ env: { get: async (name: string) => vars[name] } }) as unknown as EngineInterface;
const blueIndices = (s: ReturnType<typeof surfaces>[number]): string[] =>
  [...indicesOf(s.tree)].filter(([i]) => i >= 17 && i <= 21).map(([i, path]) => `${i} via ${path}`);
const TMUX_HOST = { TMUX: '/tmp/tmux-501/default,123,0', COLORTERM: 'truecolor', TERM: 'tmux-256color' };

describe('inside tmux (TMUX readable through $.env, COLORTERM=truecolor)', () => {
  test('the session look is 256 colours', async () => {
    clearLook();
    expect((await lookOf(hostWith(TMUX_HOST))).ui.color).toBe('256');
  });

  test('no panel (every tab), HUD or band background lands on a blue-only cube index 17-21', async () => {
    clearLook();
    const { ui } = await lookOf(hostWith(TMUX_HOST));
    const painted = surfaces(ui).filter((s) => /^(panel|hud|band)/.test(s.name));
    const bad = painted.flatMap((s) => blueIndices(s).map((hit) => `${s.name}: ${hit}`));
    expect(bad).toEqual([]);
  });
});

test('outside tmux with COLORTERM=truecolor the look stays truecolor', async () => {
  clearLook();
  expect((await lookOf(hostWith({ COLORTERM: 'truecolor', TERM: 'xterm-256color' }))).ui.color).toBe('truecolor');
});
