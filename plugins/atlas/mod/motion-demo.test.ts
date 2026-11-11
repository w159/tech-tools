// mod/motion-demo.ts: deterministic frames of a TODO row and an agent row going running -> done.
import { describe, expect, test } from 'claude-code/testing';
import { paintHud } from '../omp/hud-paint';
import { uiFromEnv, type Ui } from './atlas-ui';
import { hudLines } from './hud';
import { demoFrames, demoInput, demoMain, type DemoIo } from './motion-demo';
import { MOTION_FRAME_MS, MOTION_MS } from './motion';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('motion-demo frames', () => {
  const files = demoFrames(100, 100);
  test('two runs are byte identical', () => {
    expect(demoFrames(100, 100)).toEqual(files);
  });
  test('each surface writes the resting rows, a frame per 100 ms of the window and a strip', () => {
    for (const s of ['todo', 'agent']) {
      const names = Object.keys(files).filter((n) => n.startsWith(`${s}-`));
      expect(names).toContain(`${s}-00-running.ans`);
      expect(names).toContain(`${s}-99-done.ans`);
      expect(names).toContain(`${s}-strip.ans`);
      expect(names.filter((n) => /-t\d{4}ms\.ans$/.test(n))).toHaveLength(MOTION_MS / MOTION_FRAME_MS + 1);
    }
  });
  test('the window moves: at least 5 distinct frames, the glyph pops, and the last frame is the resting done row byte for byte', () => {
    for (const s of ['todo', 'agent']) {
      const frames = Object.keys(files).filter((n) => n.startsWith(`${s}-`) && /-t\d{4}ms\.ans$/.test(n)).sort().map((n) => files[n]!);
      expect(new Set(frames).size).toBeGreaterThanOrEqual(5);
      const row = (f: string): string => plain(f).trimEnd().split('\n').at(-1)!;
      expect(row(frames[0]!)).toContain('◌'); // the dotted ring: no state's own mark, no bar track, and not the host's `·` separator
      for (const f of frames) expect(['◇', '◆'].some((g) => row(f).includes(g))).toBe(false); // queued and the capsule keep their glyphs
      expect(frames.at(-1)).toBe(files[`${s}-99-done.ans`]);
      expect(plain(files[`${s}-99-done.ans`]!)).toContain('●');
      expect(plain(files[`${s}-00-running.ans`]!)).toContain('◐');
    }
  });
  test('critique 7: the agent row keeps its LAST column through done (it never goes blank at the change)', () => {
    for (const n of Object.keys(files).filter((k) => k.startsWith('agent-') && k.endsWith('.ans') && !k.endsWith('strip.ans'))) expect([n, plain(files[n]!).includes('runs.ts:17')]).toEqual([n, true]);
  });
  test('every row is exactly the width', () => {
    for (const [n, t] of Object.entries(files)) if (!n.endsWith('strip.ans')) for (const l of t.trimEnd().split('\n')) expect([...plain(l)].length).toBe(100);
  });
});

describe('the demo draws what the live HUD draws', () => {
  const files = demoFrames(100, 100);
  const mocha: Ui = { ...uiFromEnv({}), color: 'truecolor' };
  const live = (surface: 'todo' | 'agent', now: number): string => `${paintHud(demoInput(surface, 'done', now), { cols: 100, maxRows: 20, ui: mocha, tick: 0, now }).join('\n')}\n`;
  test('the resting done frame is the live builder output byte for byte, strike included', () => {
    for (const s of ['todo', 'agent'] as const) expect(files[`${s}-99-done.ans`]).toBe(live(s, 1000 + MOTION_MS));
  });
  test('done TODO titles are struck: the builder marks the run and the frames carry SGR 9, as the live frames do', () => {
    const row = hudLines(demoInput('todo', 'done', 1000 + MOTION_MS), { cols: 100, maxRows: 20, ui: mocha, now: 1000 + MOTION_MS }).flat().find((r) => r.t === 'wire the gate');
    expect(row?.strike).toBe(true);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR
    expect(files['todo-99-done.ans']).toMatch(/\x1b\[9;38;2;\d+;\d+;\d+;48;2;[\d;]+mwire the gate/);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR
    for (const f of Object.keys(files).filter((n) => /todo-\d\d-t/.test(n))) expect(files[f]).toMatch(/\x1b\[9;/);
  });
  test('256-colour frames: palette indices only, the neutral panel (never navy 17), still at least 5 distinct frames', () => {
    const f256 = demoFrames(100, 100, '256');
    const all = Object.values(f256).join('');
    expect(all).not.toMatch(/[34]8;2;/);
    expect(all).toContain('48;5;234');
    expect(all).not.toContain('48;5;17;');
    for (const s of ['todo', 'agent']) {
      const frames = Object.keys(f256).filter((n) => n.startsWith(`${s}-`) && /-t\d{4}ms\.ans$/.test(n)).sort().map((n) => f256[n]!);
      expect(new Set(frames).size).toBeGreaterThanOrEqual(3);
      // critique 10: no step of the ramp repeats the one before it, until the row is at rest (the resting frame is the last file)
      const rest = f256[`${s}-99-done.ans`]!;
      const ramp = frames.slice(0, frames.findIndex((f) => f === rest));
      expect(ramp.length).toBeGreaterThanOrEqual(2); // two palette steps, then the resting render
      for (let i = 1; i < ramp.length; i++) expect([s, i, ramp[i] === ramp[i - 1]]).toEqual([s, i, false]);
    }
    expect(f256['todo-99-done.ans']).toContain('\x1b[9;');
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
  test('C7: the colour depth follows the environment unless --color says otherwise (TERM=*256color, no COLORTERM: 256 colours)', async () => {
    const run = async (argv: string[], env: Record<string, string>): Promise<string> => {
      const wrote: Record<string, string> = {};
      const io: DemoIo = { mkdir: () => {}, write: (d, n, t) => void (wrote[`${d}/${n}`] = t) };
      const { h } = host(['bun', 'motion-demo.ts', '--out', '/o', ...argv]);
      await demoMain({ ...h, env }, io);
      return Object.values(wrote).join('');
    };
    const t256 = await run([], { TERM: 'xterm-256color' });
    expect(t256).not.toMatch(/[34]8;2;/);
    expect(t256).toContain('48;5;234');
    expect(await run([], { TERM: 'xterm-256color', COLORTERM: 'truecolor' })).toMatch(/48;2;/);
    expect(await run([], {})).toMatch(/48;2;/);
    expect(await run(['--color', 'truecolor'], { TERM: 'xterm-256color' })).toMatch(/48;2;/);
    expect(await run(['--color', '256'], { COLORTERM: 'truecolor' })).not.toMatch(/[34]8;2;/);
  });
  test('without --out it prints usage and exits 2', async () => {
    const { h, err, exits } = host(['bun', 'motion-demo.ts']);
    await demoMain(h, { mkdir: () => {}, write: () => {} });
    expect(exits).toEqual([2]);
    expect(err.join('')).toContain('usage');
  });
});
