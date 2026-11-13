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

describe('wave 31: the done fade is 231, then 151 held to the end of the window, then the resting tone', () => {
  // Critique 29: the old ramp (231, 193, 151, 146) left 0 fade frames in a capture. The staircase is now 231 for one 200 ms step, 151 held for 600 ms, then rest (114).
  // The weight is held bold while the colour is lifted and falls on the LAST beat (600 ms) - one frame never moves both - so the rest frame changes colour only.
  for (const color of ['256', 'truecolor'] as const) {
    const all = demoFrames(100, MOTION_STEP_MS, color);
    for (const s of ['todo', 'agent']) {
      const strip = (f: string): string => (s === 'todo' ? f : f.trimEnd().split('\n').filter((l) => !plain(l).startsWith('╰')).at(-1)!); // the agent strip's own row, not the plan row above it
      const frames = ramp(all, s).map(strip);
      const rest = strip(all[`${s}-99-done.ans`]!);
      const word = 'wire the gate'; // wave 32: the agent strip's row is the plan row itself (the agent in its own column, no `done` word)
      const fgs = (w: string): string[] => frames.map((f) => runOf(f, w).fg).concat(runOf(rest, w).fg);
      test(`${color}/${s}: 231 for one step, 151 for 600 ms, then the resting tone`, () => {
        expect(MOTION_STEP_MS).toBe(200);
        expect(MOTION_MS).toBe(800);
        expect(frames.length).toBe(4); // t0000, t0200, t0400, t0600
        const disc = fgs('●');
        expect(disc[0]).toBe(xtermHex(231));
        expect(disc.slice(1, 4)).toEqual([xtermHex(151), xtermHex(151), xtermHex(151)]);
        expect(disc[4]).not.toBe(xtermHex(151));
        expect(disc[4]).toBe(xtermHex(114));
      });
      test(`${color}/${s}: the weight falls on the last beat, so the frame that reaches rest changes colour only`, () => {
        expect(frames.map((f) => runOf(f, '●').bold)).toEqual([true, true, true, false]);
        expect(runOf(rest, '●').bold).toBe(false);
      });
      test(`${color}/${s}: the label takes the fade too (${word})`, () => {
        expect(fgs(word).slice(0, 3)).toEqual([xtermHex(231), xtermHex(151), xtermHex(151)]);
      });
    }
  }
});

// Critique 17 C4 (motion-a4fad2f9/agent-strip.ans:2): MODEL (`opus`) and TASK (`T1`) flashed 231 and bold though they never change; only the state mark,
// the state word and what changed (the name, LAST) take the ramp.
// Wave 32: the SUBAGENTS box (MODEL, TASK, the state word) is gone; the row is the plan row with the agent column. The agent column and its clock keep their resting tone at every beat; the mark and the title ramp.
describe('critique 17 C4: the agent strip flashes only what changed', () => {
  for (const color of ['256', 'truecolor'] as const) {
    test(`${color}: the agent column keeps its resting colour and weight at every beat; the mark and the title still ramp`, () => {
      const all = demoFrames(100, MOTION_STEP_MS, color);
      const rest = all['agent-99-done.ans']!;
      const agentRow = (f: string): string => f.trimEnd().split('\n').filter((l) => !plain(l).startsWith('╰')).at(-1)!; // the strip's last line but the closing rule is the agent row; the plan row above it is not part of this ramp
      for (const f of ramp(all, 'agent')) {
        for (const word of ['implementer-ba…']) expect([word, runOf(agentRow(f), word)]).toEqual([word, runOf(agentRow(rest), word)]);
      }
      expect(runOf(agentRow(ramp(all, 'agent')[0]!), '●')).not.toEqual(runOf(agentRow(rest), '●'));
    });
  }
});

describe('critique 16 C5: the TODO strip keeps one third column', () => {
  test('the owner is the third column in every frame of the TODO strip; the outcome lives in the agent strip only', () => {
    const all = demoFrames(100);
    const rows = Object.keys(all).filter((n) => n.startsWith('todo-') && n.endsWith('.ans') && !n.endsWith('strip.ans')).map((n) => plain(all[n]!).trimEnd().split('\n').filter((l) => !l.startsWith('╰')).at(-1)!);
    for (const r of rows) expect([r, r.includes('implementer-band'), r.includes('tests green')]).toEqual([r, true, false]);
  });
});
