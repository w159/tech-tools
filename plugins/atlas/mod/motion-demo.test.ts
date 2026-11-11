// mod/motion-demo.ts: deterministic frames of a TODO row and an agent row going running -> done.
import { describe, expect, test } from 'claude-code/testing';
import { demoFrames, demoMain, type DemoIo } from './motion-demo';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('motion-demo frames', () => {
  const files = demoFrames(100, 100);
  test('two runs are byte identical', () => {
    expect(demoFrames(100, 100)).toEqual(files);
  });
  test('each surface writes the resting rows, a frame per 100 ms of the 900 ms window and a strip', () => {
    for (const s of ['todo', 'agent']) {
      const names = Object.keys(files).filter((n) => n.startsWith(`${s}-`));
      expect(names).toContain(`${s}-00-running.ans`);
      expect(names).toContain(`${s}-99-done.ans`);
      expect(names).toContain(`${s}-strip.ans`);
      expect(names.filter((n) => /-t\d{4}ms\.ans$/.test(n))).toHaveLength(10);
    }
  });
  test('the window moves: at least 5 distinct frames, the glyph pops, and the last frame is the resting done row byte for byte', () => {
    for (const s of ['todo', 'agent']) {
      const frames = Object.keys(files).filter((n) => n.startsWith(`${s}-`) && /-t\d{4}ms\.ans$/.test(n)).sort().map((n) => files[n]!);
      expect(new Set(frames).size).toBeGreaterThanOrEqual(5);
      expect(plain(frames[0]!)).toContain('◇');
      expect(plain(frames[5]!)).toContain('◆');
      expect(frames.at(-1)).toBe(files[`${s}-99-done.ans`]);
      expect(plain(files[`${s}-99-done.ans`]!)).toContain('●');
      expect(plain(files[`${s}-00-running.ans`]!)).toContain('◐');
    }
  });
  test('every row is exactly the width', () => {
    for (const [n, t] of Object.entries(files)) if (!n.endsWith('strip.ans')) for (const l of t.trimEnd().split('\n')) expect([...plain(l)].length).toBe(100);
  });
});

describe('demoMain', () => {
  const host = (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const exits: number[] = [];
    return { h: { argv, stdout: { write: (s: string) => void out.push(s) }, stderr: { write: (s: string) => void err.push(s) }, exit: (c: number) => void exits.push(c) }, out, err, exits };
  };
  test('writes every frame into --out', async () => {
    const wrote: Record<string, string> = {};
    const dirs: string[] = [];
    const io: DemoIo = { mkdir: (d) => void dirs.push(d), write: (d, n, t) => void (wrote[`${d}/${n}`] = t) };
    const { h, out } = host(['bun', 'motion-demo.ts', '--out', '/tmp/frames', '--cols', '80']);
    await demoMain(h, io);
    expect(dirs).toEqual(['/tmp/frames']);
    expect(Object.keys(wrote)).toHaveLength(Object.keys(demoFrames(80)).length);
    expect(out.join('')).toContain('files in /tmp/frames');
  });
  test('without --out it prints usage and exits 2', async () => {
    const { h, err, exits } = host(['bun', 'motion-demo.ts']);
    await demoMain(h, { mkdir: () => {}, write: () => {} });
    expect(exits).toEqual([2]);
    expect(err.join('')).toContain('usage');
  });
});
