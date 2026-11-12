// Critique 16 C5, from motion-e4a8186a/todo-strip.ans:1-7 (256 colours): the glyph ran 231, 193, bold 193, bold 151, 151 (bold arrived at 400-600 ms,
// a brightness pop), the 800 ms frame repeated the final one, and the TODO strip's third column read `implementer-band` then `tests green`.
import { describe, expect, test } from 'claude-code/testing';
import { luminance, xtermHex } from './atlas-ui';
import { demoFrames } from './motion-demo';
import { MOTION_MS, MOTION_STEP_MS } from './motion';

// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
/** Bold and foreground of the run that starts with `word`, from a painted frame. */
function runOf(frame: string, word: string): { bold: boolean; fg: string } {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR
  const m = new RegExp(`\\x1b\\[([0-9;]*)m${word}`).exec(frame);
  if (!m) return { bold: false, fg: '' };
  const p = m[1]!;
  const fg = /38;5;(\d+)/.exec(p)?.[1];
  const rgb = /38;2;(\d+);(\d+);(\d+)/.exec(p);
  return { bold: /(^|;)1(;|$)/.test(p), fg: fg ? xtermHex(Number(fg)) : rgb ? `#${rgb.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : '' };
}
/** What is wrong with a ramp of painted frames ending at `rest`: a repeated neighbour, bold that comes back on, a foreground that turns back. */
function rampFaults(frames: readonly string[], rest: string, words: readonly string[]): string[] {
  const faults: string[] = [];
  const all = [...frames, rest];
  for (let i = 1; i < all.length; i++) if (all[i] === all[i - 1]) faults.push(`frame ${i} repeats frame ${i - 1}`);
  for (const word of words) {
    const seq = all.map((f) => runOf(f, word));
    for (let i = 1; i < seq.length; i++) if (!seq[i - 1]!.bold && seq[i]!.bold) faults.push(`${word}: bold arrives at frame ${i}`);
    const lum = seq.map((r) => luminance(r.fg));
    const d = Math.sign(lum.at(-1)! - lum[0]!);
    for (let i = 1; i < lum.length; i++) if (lum[i] !== lum[i - 1] && Math.sign(lum[i]! - lum[i - 1]!) !== d) faults.push(`${word}: foreground turns back at frame ${i}`);
  }
  return faults;
}
const ramp = (all: Record<string, string>, s: string): string[] => Object.keys(all).filter((n) => n.startsWith(`${s}-`) && /-t\d{4}ms\.ans$/.test(n)).sort().map((n) => all[n]!);

describe('critique 16 C5: the checker sees the defect in the cited golden', () => {
  // motion-e4a8186a/todo-strip.ans:2-7, the title and the state word only
  const e = '\x1b[';
  const row = (tp: string, wp: string): string => `${e}${tp}mwire the gate${e}0m ${e}${wp}mdone${e}0m`;
  const cited = [row('9;38;5;193', '38;5;193'), row('9;38;5;151', '38;5;151'), row('1;9;38;5;151', '1;38;5;151'), row('1;9;38;5;146', '1;38;5;146')];
  const citedRest = row('9;38;5;146', '38;5;146');
  test('bold at 400 ms and 600 ms, and a 800 ms frame equal to the rest, are faults', () => {
    const f = rampFaults([...cited, citedRest], citedRest, ['wire the gate', 'done']);
    expect(f).toContain('wire the gate: bold arrives at frame 2');
    expect(f).toContain('frame 5 repeats frame 4');
  });
});

describe('critique 16 C5: the ramp falls and never pops', () => {
  for (const color of ['256', 'truecolor'] as const) {
    const all = demoFrames(100, MOTION_STEP_MS, color);
    for (const s of ['todo', 'agent']) {
      const frames = ramp(all, s);
      const rest = all[`${s}-99-done.ans`]!;
      test(`${color}/${s}: spans at least 600 ms, no frame repeats its neighbour or the rest, the 600 ms frame is not the final one`, () => {
        expect(frames.length * MOTION_STEP_MS).toBeGreaterThanOrEqual(600);
        expect(MOTION_MS).toBeGreaterThan(600);
        expect(frames[600 / MOTION_STEP_MS]).not.toBe(rest);
        expect(rampFaults(frames, rest, [])).toEqual([]);
      });
      test(`${color}/${s}: bold only ever falls and the foreground only ever moves toward rest (no bold pop at 400-600 ms)`, () => {
        expect(rampFaults(frames, rest, ['wire the gate', 'done'])).toEqual([]);
      });
    }
  }
});

describe('critique 16 C5: the TODO strip keeps one third column', () => {
  test('the owner is the third column in every frame of the TODO strip; the outcome lives in the agent strip only', () => {
    const all = demoFrames(100);
    const rows = Object.keys(all).filter((n) => n.startsWith('todo-') && n.endsWith('.ans') && !n.endsWith('strip.ans')).map((n) => plain(all[n]!).trimEnd().split('\n').at(-1)!);
    for (const r of rows) expect([r, r.includes('implementer-band'), r.includes('tests green')]).toEqual([r, true, false]);
  });
});
