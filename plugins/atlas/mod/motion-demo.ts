// motion-demo.ts: renders the frames of a TODO row and an agent row going running -> done to .ans files, so they can be recorded.
// Deterministic: the clock is injected (no Date.now), the rows are fixed, so two runs write byte-identical files.
//   bun mod/motion-demo.ts --out <dir> [--cols 100] [--step 200] [--color truecolor|256]   (default: the terminal's depth, see colorMode)
// Writes, per surface (todo, agent): `<surface>-00-running.ans` (the resting row before the change), `<surface>-01-t0000ms.ans` ...
// one file per frame of the 800 ms window, `<surface>-99-done.ans` (the resting row after), and `<surface>-strip.ans` (all of them,
// one per line, `cat` it in a terminal). Each file is the ribbon and the row exactly as the live HUD draws them (24-bit ANSI, or xterm-256 with --color 256).
// The frames are built by `demoFrames` (pure: file name -> text); only the CLI at the bottom touches the disk, through dynamic imports
// that the mod's tsconfig (which has no node types) never resolves.
import { colorMode, paintAnsi, uiFromEnv, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { hudLines, hudMotionItems, type HudAgent, type HudInput } from './hud';
import { Motion, MOTION_MS, MOTION_STEP_MS } from './motion';

/** The demo draws through the live HUD (hudLines) and paints with the live ANSI painter (paintAnsi): same builder, same options, same
 * strike on done titles, so a recorded frame is what the terminal shows. `forced` is the colour depth the CLI asks for. */
const uiOf = (color: Ui['color']): Ui => ({ ...uiFromEnv({}), color });

/** The demo agent's name (the spinner phase and the row key derive from it). */
export const DEMO_AGENT = 'implementer-band';
const NAME = DEMO_AGENT;
/** The TODO strip's third column is the owner in every frame (critique 16: `implementer-band` then `tests green` read as two columns); only the agent strip carries the outcome, in its LAST column. */
const TODO = (state: 'running' | 'done', now: number, outcome = false): TodoItem => ({
  id: 't1', content: 'wire the gate', status: state === 'done' ? 'completed' : 'in_progress', owner: NAME, ...(state === 'done' ? { ...(outcome ? { evidence: 'tests green' } : {}), completed_at: now / 1000 } : { claimed_at: now / 1000 - 72 }),
} as TodoItem);
const AGENT = (state: 'running' | 'done', now: number): HudAgent => ({ name: NAME, role: 'implementer', state: state === 'done' ? 'done' : 'working', model: 'opus', ...(state === 'running' ? { tool: 'read', target: 'runs.ts:17' } : { since: now, lastLine: 'read runs.ts:17' }) }); // a finished agent's LAST column turns to the outcome of the plan row it owns (critique 14)

type Shown = 'running' | 'done';
/** The row a strip line shows: the last line that is the row itself, not the box's bottom border, a blank gap or a bare header (round 3: the HUD closes its blocks with a `└───┘` border, and a strip of `lines.at(-1)` held that border six times). */
const bare = (l: string): string => l.replace(/\x1b\[[0-9;]*m/g, '');
const rowOf = (lines: readonly string[]): string => [...lines].reverse().find((l) => bare(l).trim() !== '' && !/^[└┌]/.test(bare(l))) ?? lines.at(-1) ?? '';
/** The HUD input of a surface: `todo` shows the plan row, `agent` the Subagents row. */
export const demoInput = (surface: 'todo' | 'agent', state: Shown, now: number): HudInput => (surface === 'todo' ? { todos: [TODO(state, now)], agents: [] } : { todos: [TODO(state, now, true)], agents: [AGENT(state, now)] }); // the agent owns the plan row: its done LAST column is the outcome that row carries
const FEED = { 'todo': 'hud-todo', 'agent': 'hud-agents' } as const;

/** File name -> text of every frame of both rows, for colour depth `color` (default truecolor). */
export function demoFrames(cols = 100, step = MOTION_STEP_MS, color: Ui['color'] = 'truecolor'): Record<string, string> {
  const ui = uiOf(color);
  const files: Record<string, string> = {};
  const put = (name: string, lines: string[]): void => {
    files[name] = `${lines.join('\n')}\n`;
  };
  for (const surface of ['todo', 'agent'] as const) {
    const m = new Motion(true);
    const seen = (state: Shown, now: number): void => m.observe(FEED[surface], hudMotionItems(demoInput(surface, state, now), { now })[surface === 'todo' ? 'todos' : 'agents'], now);
    seen('running', 0); // a first sight: at rest
    seen('done', 1000); // the change: the window opens at t=1000
    const strip: string[] = [];
    const frame = (label: string, file: string, state: Shown, now: number, motion: ReturnType<Motion['ctx']>): void => {
      const lines = hudLines(demoInput(surface, state, now), { cols, maxRows: 20, ui, tick: 0, now, ...(motion ? { motion } : {}) }).map((r) => r.map((x) => paintAnsi(x, ui)).join(''));
      put(file, lines);
      strip.push(`${label.padEnd(8)} ${rowOf(lines)}`);
    };
    frame('running', `${surface}-00-running.ans`, 'running', 0, undefined);
    let n = 1;
    for (let dt = 0; dt < MOTION_MS; dt += step) frame(`t=${String(dt).padStart(3, '0')}ms`, `${surface}-${String(n++).padStart(2, '0')}-t${String(dt).padStart(4, '0')}ms.ans`, 'done', 1000 + dt, m.ctx(1000 + dt));
    frame('done', `${surface}-99-done.ans`, 'done', 1000 + MOTION_MS, undefined);
    put(`${surface}-strip.ans`, strip);
  }
  return files;
}

type Host = { argv: string[]; env?: Record<string, string | undefined>; stdout: { write(s: string): void }; stderr: { write(s: string): void }; exit(code: number): void };
/** The disk, injected: the CLI loads node:fs lazily; tests pass a fake. */
export type DemoIo = { mkdir(dir: string): void; write(dir: string, name: string, text: string): void };
type Dyn = Record<string, (...a: never[]) => unknown>;
const dyn = (m: string): Promise<Dyn> => import(m);
const nodeIo = async (): Promise<DemoIo> => {
  const [fs, path] = await Promise.all([dyn('node:fs'), dyn('node:path')]);
  return {
    mkdir: (dir) => void fs.mkdirSync!(dir as never, { recursive: true } as never),
    write: (dir, name, text) => void fs.writeFileSync!((path.join as (...a: string[]) => string)(dir, name) as never, text as never),
  };
};

/** `--out <dir> [--cols 100] [--step 200]`: write every frame; exit 2 without `--out`. */
export async function demoMain(host: Host, io?: DemoIo): Promise<void> {
  const arg = (k: string): string | undefined => {
    const i = host.argv.indexOf(k);
    return i >= 0 ? host.argv[i + 1] : undefined;
  };
  const out = arg('--out');
  if (!out) {
    host.stderr.write('usage: bun mod/motion-demo.ts --out <dir> [--cols 100] [--step 200] [--color truecolor|256]\n');
    host.exit(2);
    return;
  }
  const disk = io ?? (await nodeIo());
  // --color wins; else the terminal's own depth (colorMode: TERM=*256color with no COLORTERM is 256 colours, as the live host reads it).
  const flag = arg('--color');
  const color: Ui['color'] = flag === '256' || flag === 'truecolor' ? flag : colorMode(host.env ?? {}) === '256' ? '256' : 'truecolor';
  const files = demoFrames(Number(arg('--cols') ?? 100), Number(arg('--step') ?? MOTION_STEP_MS), color);
  disk.mkdir(out);
  for (const [name, text] of Object.entries(files)) disk.write(out, name, text);
  host.stdout.write(`${Object.keys(files).length} files in ${out}\n`);
}

const host = (globalThis as unknown as { process?: Host }).process;
if (host?.argv[1]?.endsWith('motion-demo.ts')) void demoMain(host); // run as a script, not when a test imports it
