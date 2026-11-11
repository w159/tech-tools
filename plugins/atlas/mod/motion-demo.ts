// motion-demo.ts: renders the frames of a TODO row and an agent row going running -> done to .ans files, so they can be recorded.
// Deterministic: the clock is injected (no Date.now), the rows are fixed, so two runs write byte-identical files.
//   bun mod/motion-demo.ts --out <dir> [--cols 100] [--step 100]
// Writes, per surface (todo, agent): `<surface>-00-running.ans` (the resting row before the change), `<surface>-01-t0000ms.ans` ...
// one file per frame of the 900 ms window, `<surface>-99-done.ans` (the resting row after), and `<surface>-strip.ans` (all of them,
// one per line, `cat` it in a terminal). Each file is the ribbon and the row in 24-bit ANSI on the rev 4 panel.
// The frames are built by `demoFrames` (pure: file name -> text); only the CLI at the bottom touches the disk, through dynamic imports
// that the mod's tsconfig (which has no node types) never resolves.
import { PALETTES, runHex, sgrColor, type Run, type Ui } from './atlas-ui';
import { agentRows, todoRows, type AgentRow, type SurfaceOpts, type TodoRow } from './hud-surface';
import { Motion, MOTION_MS } from './motion';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const RST = '\x1b[0m';

/** One run in ANSI: bold/strike, the (possibly eased) foreground on the run's fill or the panel. */
function paint(x: Run): string {
  if (x.t === '') return '';
  const sgr = [x.bold ? '1' : '', x.strike ? '9' : '', sgrColor(runHex(x, ui.theme), 38, ui.color), sgrColor(x.bg ? PALETTES[ui.theme][x.bg] : PALETTES[ui.theme].panel, 48, ui.color)].filter(Boolean).join(';');
  return `\x1b[${sgr}m${x.t}${RST}`;
}
const paintRows = (rows: readonly (readonly Run[])[], cols: number): string[] =>
  rows.map((r) => {
    const w = r.reduce((n, x) => n + [...x.t].length, 0);
    return r.map(paint).join('') + (w < cols ? `\x1b[${sgrColor(PALETTES[ui.theme].panel, 48, ui.color)}m${' '.repeat(cols - w)}${RST}` : '');
  });

const TODO = (state: TodoRow['state']): TodoRow => ({ label: 'wire the gate', state, detail: state === 'done' ? 'tests green' : 'elapsed 01:12', focus: state === 'running', key: 'todo:wire the gate' });
const AGENT = (state: AgentRow['state']): AgentRow => ({ name: 'implementer-band', state, model: 'opus', tasks: [4], tool: state === 'done' ? 'finished' : 'read runs.ts:17', ctx: null, focus: state === 'running', key: 'agent:implementer-band' });

type Shown = 'running' | 'done';
type Surface = { name: string; observe: (s: Shown) => { key: string; state: string }[]; draw: (s: Shown, o: SurfaceOpts) => Run[][] };
const surfaces = (): Surface[] => [
  { name: 'todo', observe: (s) => [{ key: TODO(s).key!, state: s }], draw: (s, o) => todoRows([TODO(s)], o, { spacers: false, extras: false }) },
  { name: 'agent', observe: (s) => [{ key: AGENT(s).key!, state: s }], draw: (s, o) => agentRows([AGENT(s)], o, { spacers: false, extras: false }) },
];

/** File name -> text of every frame of both rows. */
export function demoFrames(cols = 100, step = 100): Record<string, string> {
  const files: Record<string, string> = {};
  const put = (name: string, lines: string[]): void => {
    files[name] = `${lines.join('\n')}\n`;
  };
  for (const s of surfaces()) {
    const m = new Motion(true);
    m.observe(s.name, s.observe('running'), 0); // a first sight: at rest
    m.observe(s.name, s.observe('done'), 1000); // the change: the window opens at t=1000
    const base: SurfaceOpts = { cols, ui, tick: 0 };
    const strip: string[] = [];
    const frame = (label: string, file: string, o: SurfaceOpts, state: Shown): void => {
      const lines = paintRows(s.draw(state, o), cols);
      put(file, lines);
      strip.push(`${label.padEnd(8)} ${lines.at(-1)}`);
    };
    frame('running', `${s.name}-00-running.ans`, base, 'running');
    let n = 1;
    for (let dt = 0; dt <= MOTION_MS; dt += step) {
      const ctx = m.ctx(1000 + dt);
      frame(`t=${String(dt).padStart(3, '0')}ms`, `${s.name}-${String(n++).padStart(2, '0')}-t${String(dt).padStart(4, '0')}ms.ans`, { ...base, motion: ctx }, 'done');
    }
    frame('done', `${s.name}-99-done.ans`, base, 'done');
    put(`${s.name}-strip.ans`, strip);
  }
  return files;
}

type Host = { argv: string[]; stdout: { write(s: string): void }; stderr: { write(s: string): void }; exit(code: number): void };
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

/** `--out <dir> [--cols 100] [--step 100]`: write every frame; exit 2 without `--out`. */
export async function demoMain(host: Host, io?: DemoIo): Promise<void> {
  const arg = (k: string): string | undefined => {
    const i = host.argv.indexOf(k);
    return i >= 0 ? host.argv[i + 1] : undefined;
  };
  const out = arg('--out');
  if (!out) {
    host.stderr.write('usage: bun mod/motion-demo.ts --out <dir> [--cols 100] [--step 100]\n');
    host.exit(2);
    return;
  }
  const disk = io ?? (await nodeIo());
  const files = demoFrames(Number(arg('--cols') ?? 100), Number(arg('--step') ?? 100));
  disk.mkdir(out);
  for (const [name, text] of Object.entries(files)) disk.write(out, name, text);
  host.stdout.write(`${Object.keys(files).length} files in ${out}\n`);
}

const host = (globalThis as unknown as { process?: Host }).process;
if (host?.argv[1]?.endsWith('motion-demo.ts')) void demoMain(host); // run as a script, not when a test imports it
