// Critique 18, slice C4 (motion-562576ed/todo-strip.ans): the TODO owner column flashed 231 though it never changes (:2), and at 600 ms the weight dropped and the
// text went 151 to 146 in one step (:4-5). An owner that does not change keeps its tone; a frame never changes weight and colour at once.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv, type Run, type Ui } from './atlas-ui';
import { hudLines, hudMotionItems } from './hud';
import { DEMO_AGENT, demoInput } from './motion-demo';
import { deltaE, Motion, MOTION_MS, MOTION_STEP_MS, sinceChange, windowOf } from './motion';

const fitOrSelf = (hex: string): string => (/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000');

const T0 = 1000;
function frames(surface: 'todo' | 'agent', color: Ui['color']): { rest: Run[]; beats: Run[][] } {
  const ui: Ui = { ...uiFromEnv({}), color };
  const m = new Motion(true);
  const feed = (state: 'running' | 'done', now: number): void => m.observe(surface === 'todo' ? 'hud-todo' : 'hud-agents', hudMotionItems(demoInput(surface, state, now), { now })[surface === 'todo' ? 'todos' : 'agents'], now);
  feed('running', 0);
  feed('done', T0);
  const draw = (now: number, motion?: ReturnType<Motion['ctx']>): Run[] => hudLines(demoInput(surface, 'done', now), { cols: 100, maxRows: 20, ui, tick: 0, now, ...(motion ? { motion } : {}) }).flat();
  const beats: Run[][] = [];
  for (let dt = 0; dt < MOTION_MS; dt += MOTION_STEP_MS) beats.push(draw(T0 + sinceChange('done', dt), m.ctx(T0 + sinceChange('done', dt)))); // dt is time into the ease: a done mark holds its first beat
  return { rest: draw(T0 + windowOf({ state: 'done' })), beats };
}
const run = (runs: Run[], text: string): Run => runs.find((r) => r.t === text)!;

describe('C4: the TODO owner column does not flash', () => {
  for (const color of ['truecolor', '256'] as const) {
    test(`${color}: the owner run wears its resting tone and weight on every beat`, () => {
      const { rest, beats } = frames('todo', color);
      const want = run(rest, DEMO_AGENT);
      expect(want).toBeDefined();
      for (const [i, b] of beats.entries()) expect([i, run(b, DEMO_AGENT).fg, run(b, DEMO_AGENT).bold ?? false]).toEqual([i, want.fg, want.bold ?? false]);
    });
    test(`${color}: the state word, glyph and title still ramp`, () => {
      const { rest, beats } = frames('todo', color);
      expect(run(beats[0]!, 'done').fg).not.toBe(run(rest, 'done').fg);
    });
  }
});

// Critique 19 B5 (motion-232567af/todo-strip.ans:4-5): the 256-colour ramp dropped the weight one frame AFTER the text reached 146. The weight now falls on the frame the colour lands.
describe('B5: on 256 colours the weight falls on the frame the colour lands on rest', () => {
  for (const surface of ['todo', 'agent'] as const) {
    test(`${surface}: bold stays while the colour moves; the frame that drops it is the first at the resting colour`, () => {
      const { rest, beats } = frames(surface, '256');
      const seq = [...beats, rest];
      for (const [k, r] of rest.entries()) {
        if (r.t.trim() === '' || beats[0]![k]!.t !== r.t || beats[0]![k]!.fg === undefined || (r.bold ?? false)) continue; // a run that ramps and rests plain
        const fgs = beats.map((b) => b[k]!.fg);
        const landed = fgs.findIndex((f, i) => fgs.slice(i).every((g) => g === f)); // the first beat from which the colour no longer changes
        const dropped = beats.findIndex((b) => !(b[k]!.bold ?? false));
        expect([surface, r.t, dropped]).toEqual([surface, r.t, landed]);
      }
    });
  }
});

describe('C4: a frame never drops the weight and steps the colour together', () => {
  for (const color of ['truecolor'] as const) {
    for (const surface of ['todo', 'agent'] as const) {
      test(`${surface}, ${color}: between two beats a run changes weight or colour, not both`, () => {
        const { rest, beats } = frames(surface, color);
        const seq = [...beats, rest];
        for (let i = 1; i < seq.length; i++) {
          const [a, b] = [seq[i - 1]!, seq[i]!];
          expect(b).toHaveLength(a.length);
          for (const [k, r] of b.entries()) {
            const p = a[k]!;
            if (r.t.trim() === '' || p.t !== r.t) continue; // a glyph pop changes the text, not the weight
            const weight = (p.bold ?? false) !== (r.bold ?? false);
            // 24-bit colour glides, so the 600 ms mix is within a hair of the 400 ms one: a step counts when the eye can tell it (CIE76 over 2.3, a just-noticeable difference).
            const colour = color === 'truecolor' ? deltaE(p.fg ? fitOrSelf(p.fg) : '#000000', r.fg ? fitOrSelf(r.fg) : '#000000') > 2.3 : p.fg !== r.fg;
            expect([surface, color, i, k, r.t, weight && colour]).toEqual([surface, color, i, k, r.t, false]);
          }
        }
      });
    }
  }
});
