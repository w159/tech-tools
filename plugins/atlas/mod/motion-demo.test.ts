// mod/motion-demo.ts: deterministic frames of a TODO row and an agent row going running -> done.
import { describe, expect, test } from 'claude-code/testing';
import { paintHud } from '../omp/hud-paint';
import { fitHex, PALETTES, uiFromEnv, type Ui } from './atlas-ui';
import { hudLines, hudMotionItems, type HudInput } from './hud';
import { demoFrames, demoInput, demoMain, type DemoIo } from './motion-demo';
import { Motion, MOTION_MS, MOTION_STEP_MS } from './motion';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips SGR
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
/** The row a frame draws: its last line that is not the block's closing `╰───╯` rule (critique 21). */
const lastRow = (f: string): string => plain(f).trimEnd().split('\n').filter((l) => !l.startsWith('╰')).at(-1)!;

describe('motion-demo frames', () => {
  const files = demoFrames(100);
  test('two runs are byte identical', () => {
    expect(demoFrames(100)).toEqual(files);
  });
  test('each surface writes the resting rows, a frame per held step of the window and a strip', () => {
    for (const s of ['todo', 'agent']) {
      const names = Object.keys(files).filter((n) => n.startsWith(`${s}-`));
      expect(names).toContain(`${s}-00-running.ans`);
      expect(names).toContain(`${s}-99-done.ans`);
      expect(names).toContain(`${s}-strip.ans`);
      expect(names.filter((n) => /-t\d{4}ms\.ans$/.test(n))).toHaveLength(MOTION_MS / MOTION_STEP_MS); // the frame at MOTION_MS is the rest: it is the `99-done` file, never repeated as a ramp frame
    }
  });
  test('the window moves: at least 3 distinct frames, the glyph stays the green disc (no ring pop), and the last ramp frame is not the resting done row (no repeat)', () => {
    for (const s of ['todo', 'agent']) {
      const frames = Object.keys(files).filter((n) => n.startsWith(`${s}-`) && /-t\d{4}ms\.ans$/.test(n)).sort().map((n) => files[n]!);
      expect(new Set(frames).size).toBeGreaterThanOrEqual(2);
      const row = lastRow;
      expect(row(frames[0]!)).toContain('●'); // critique 21: the flash is the disc itself stepping from bright to ok
      for (const f of frames) expect(/[◌◍]/.test(row(f))).toBe(false); // never a dotted ring: it reads empty
      for (const f of frames) expect(['◇', '◆'].some((g) => row(f).includes(g))).toBe(false); // queued and the capsule keep their glyphs
      expect(frames.at(-1)).not.toBe(files[`${s}-99-done.ans`]);
      expect(plain(files[`${s}-99-done.ans`]!)).toContain('●');
      expect(plain(files[`${s}-00-running.ans`]!)).toMatch(/[◐◐]/);
    }
  });
  test('wave 31: the fade is a staircase - 231 for one step, 151 held for 600 ms (two identical beats by design), none equal to the rest, in 24-bit and 256 colours', () => {
    for (const color of ['truecolor', '256'] as const) {
      const all = demoFrames(100, MOTION_STEP_MS, color);
      for (const s of ['todo', 'agent']) {
        const steps = Object.keys(all).filter((n) => n.startsWith(`${s}-`) && /-t\d{4}ms\.ans$/.test(n)).sort().map((n) => all[n]!);
        const rest = all[`${s}-99-done.ans`]!;
        expect(steps).toHaveLength(MOTION_MS / MOTION_STEP_MS);
        expect([color, s, steps[1] === steps[0]]).toEqual([color, s, false]); // 231 then 151
        expect([color, s, steps[2] === steps[1]]).toEqual([color, s, true]); // 151 is held (the 400 ms capture sees it)
        expect([color, s, steps[3] === steps[2]]).toEqual([color, s, false]); // the last beat drops the weight, the colour stays
        expect([color, s, steps.includes(rest)]).toEqual([color, s, false]);
      }
    }
  });
  test('critique 27: `returned` is the neutral `◉` and the 245 word, at every frame, a row mid-transition included; the unreadable `◃` is gone and the word is never the plain body tone (live f0063: 183 beside a plain 189)', () => {
    const ui256: Ui = { ...uiFromEnv({}), color: '256' };
    const item = (id: string, owner: string) => ({ id, content: `${id.toUpperCase()} read ${owner}.py (${owner})`, status: 'in_progress', owner }) as never;
    const at = (gamma: 'working' | 'done'): HudInput => ({
      todos: [item('t2', 'beta'), item('t3', 'gamma')],
      agents: [{ name: 'beta', role: 'explorer', state: 'done', model: 'sonnet', since: 1, lastLine: 'x' }, { name: 'gamma', role: 'explorer', state: gamma, model: 'sonnet', ...(gamma === 'working' ? { tool: 'read', target: 'g.py' } : { since: 1, lastLine: 'x' }) }] as never,
    });
    const m = new Motion(true);
    m.observe('hud-todo', hudMotionItems(at('working'), { now: 0 }).todos, 0);
    m.observe('hud-todo', hudMotionItems(at('done'), { now: 1000 }).todos, 1000);
    for (const dt of [0, 200, 400, 600]) {
      const rows = hudLines(at('done'), { cols: 100, maxRows: 20, ui: ui256, tick: 0, now: 1000 + dt, motion: m.ctx(1000 + dt)! }).filter((r) => r.some((x) => x.t === 'returned'));
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect([dt, r.some((x) => x.t === '◃')]).toEqual([dt, false]); // the scorer counts `◃` as unknown
        expect([dt, r.some((x) => x.t === '●')]).toEqual([dt, false]); // never the green done disc (critique 27)
        expect([dt, r.some((x) => x.t === '◉')]).toEqual([dt, true]); // the neutral hand-back mark the scorer reads
        const w = r.find((x) => x.t === 'returned')!;
        expect([dt, w.fg === fitHex(PALETTES[ui256.theme].text, ui256.theme)]).toEqual([dt, false]); // and the word is never the plain body tone
      }
    }
  });
  test('critique 7/14 (wave 31): the agent row keeps its name through done (it never goes blank at the change)', () => {
    const agentRow = (n: string): string => lastRow(files[n]!);
    // wave 31: the running agent rides its TODO row (name and clock right-aligned); the tool echo is not drawn anywhere, and the row never goes blank at the change
    // wave 32: the agent column is 15 cells, so `implementer-band` ends in `…`
    expect(agentRow('agent-00-running.ans')).toContain('implementer-ba…');
    expect(agentRow('agent-00-running.ans')).not.toContain('runs.ts:17');
    for (const n of Object.keys(files).filter((k) => k.startsWith('agent-') && k.endsWith('.ans') && !k.endsWith('strip.ans') && !k.includes('running'))) expect([n, agentRow(n).includes('implementer-ba…'), agentRow(n).includes('runs.ts:17')]).toEqual([n, true, false]);
  });
  test('every row is exactly the width', () => {
    for (const [n, t] of Object.entries(files)) if (!n.endsWith('strip.ans')) for (const l of t.trimEnd().split('\n')) expect([...plain(l)].length).toBe(100);
  });
});

describe('the demo draws what the live HUD draws', () => {
  const files = demoFrames(100);
  const mocha: Ui = { ...uiFromEnv({}), color: 'truecolor' };
  // wave 35: the demo shows the plan row; the SUBAGENTS table that closes a finished run is cut off
  const live = (surface: 'todo' | 'agent', now: number): string => {
    const rows = paintHud(demoInput(surface, 'done', now), { cols: 100, maxRows: 20, ui: mocha, tick: 0, now });
    // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR
    const at = rows.findIndex((l) => /^╭.*▸ SUBAGENTS/.test(l.replace(/\x1b\[[0-9;]*m/g, '')));
    return `${(at > 0 ? rows.slice(0, at) : rows).join('\n')}\n`;
  };
  test('the resting done frame is the live builder output byte for byte, strike included', () => {
    for (const s of ['todo', 'agent'] as const) expect(files[`${s}-99-done.ans`]).toBe(live(s, 1000 + MOTION_MS));
  });
  test('done TODO titles are plain 247 text, never struck (critique 21): the builder marks no strike and no frame carries SGR 9', () => {
    const row = hudLines(demoInput('todo', 'done', 1000 + MOTION_MS), { cols: 100, maxRows: 20, ui: mocha, now: 1000 + MOTION_MS }).flat().find((r) => r.t === 'wire the gate');
    expect(row?.strike).toBeUndefined();
    // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR
    expect(files['todo-99-done.ans']).toMatch(/\x1b\[38;2;\d+;\d+;\d+;48;2;[\d;]+mwire the gate/);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR
    for (const f of Object.keys(files)) expect(files[f]).not.toMatch(/\x1b\[(1;)?9[;m]/);
  });
  test('256-colour frames: palette indices only, the neutral panel (never navy 17), still a white beat and the rest', () => {
    const f256 = demoFrames(100, MOTION_STEP_MS, '256');
    const all = Object.values(f256).join('');
    expect(all).not.toMatch(/[34]8;2;/);
    expect(all).toContain('48;5;234');
    expect(all).not.toContain('48;5;17;');
    for (const s of ['todo', 'agent']) {
      const frames = Object.keys(f256).filter((n) => n.startsWith(`${s}-`) && /-t\d{4}ms\.ans$/.test(n)).sort().map((n) => f256[n]!);
      expect(new Set(frames).size).toBeGreaterThanOrEqual(2);
      // critique 10: no step of the ramp repeats the one before it, until the row is at rest (the resting frame is the last file)
      const rest = f256[`${s}-99-done.ans`]!;
      expect(frames.at(-1)).not.toBe(rest); // wave 31: the last beat still holds 151 (the weight falls on it); the resting 114 is its own file
      expect(frames[0]).not.toBe(rest); // a white beat first
    }
    expect(f256['todo-99-done.ans']).not.toMatch(/\x1b\[(1;)?9[;m]/); // no strikethrough on a done row
  });
});

describe('critique 14: the 600 ms frame is still the ramp', () => {
  test('the window outlasts 600 ms, and the frame sampled at 600 ms is neither the 400 ms frame nor the final frame, in truecolor and 256 colours', () => {
    expect(MOTION_MS).toBeGreaterThan(600);
    for (const color of ['truecolor', '256'] as const) {
      const all = demoFrames(100, MOTION_STEP_MS, color);
      for (const s of ['todo', 'agent']) {
        const at = (ms: number): string => all[`${s}-${String(ms / MOTION_STEP_MS + 1).padStart(2, '0')}-t${String(ms).padStart(4, '0')}ms.ans`]!;
        expect([color, s, at(600) === all[`${s}-99-done.ans`]]).toEqual([color, s, false]); // wave 31: 151 is held to 800 ms, so a 0.6 s capture still sees the fade
        expect([color, s, at(600) === at(400)]).toEqual([color, s, false]); // the weight falls on the last beat
        expect([color, s, at(400) === at(200)]).toEqual([color, s, true]); // 151 is held
      }
    }
  });
});

describe('critique 11 C1: the ramp is held long enough to be seen', () => {
  test('three steps of at least 200 ms: the whole ramp spans at least 600 ms', () => {
    expect(MOTION_STEP_MS).toBeGreaterThanOrEqual(200);
    expect(MOTION_MS).toBeGreaterThanOrEqual(600);
    expect(MOTION_MS / MOTION_STEP_MS).toBeGreaterThanOrEqual(3);
  });
  test('the default demo (one frame per held step) is 231, a held 151 and the weightless last beat, none at rest, in truecolor and 256 colours', () => {
    for (const color of ['truecolor', '256'] as const) {
      const f = demoFrames(100, undefined, color);
      for (const s of ['todo', 'agent']) {
        const frames = Object.keys(f).filter((n) => n.startsWith(`${s}-`) && /-t\d{4}ms\.ans$/.test(n)).sort().map((n) => f[n]!);
        const rest = f[`${s}-99-done.ans`]!;
        expect([color, s, frames.includes(rest)]).toEqual([color, s, false]);
        expect([color, s, new Set(frames).size]).toEqual([color, s, 3]);
      }
    }
  });
  test('a frame sampled 400 ms into the window is still not at rest (a 0.5 s capture sees the ramp)', () => {
    const f = demoFrames(100, 200);
    expect(f['todo-03-t0400ms.ans']).not.toBe(f['todo-99-done.ans']);
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
