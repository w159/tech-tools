// y1-live: the pulse, the 5 Hz idle breath, the one spinner, the close chips and the per-run tool count reach the live hooks module (register.ts).
// The real register() boots on a recording engine stub with a controllable clock and timers; the band and the pane are drawn through the
// registered ui.render hooks and the chips are pressed through their real Buttons.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { register, resetCore } from '../register';
import { memState } from '../test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
const noopNext: AnyNext = async (input) => input;

function captureOn() {
  const handlers: { event: string; matcher: Record<string, unknown> | undefined; hook: AnyHandler }[] = [];
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const matcher = maybeHook === undefined ? undefined : (hookOrMatcher as Record<string, unknown>);
    handlers.push({ event, matcher, hook: (maybeHook ?? hookOrMatcher) as AnyHandler });
    return { catch() {} };
  }) as unknown as On;
  const one = (event: string, key?: [string, unknown]): AnyHandler => {
    const found = handlers.find((h) => h.event === event && (key === undefined || h.matcher?.[key[0]] === key[1]));
    if (!found) throw new Error(`no ${event} handler`);
    return found.hook;
  };
  const all = (event: string): AnyHandler[] => handlers.filter((h) => h.event === event).map((h) => h.hook);
  return { on, one, all };
}

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const fakeEls = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') };
const kidsOf = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const walk = (n: Node): Node[] => [n, ...kidsOf(n).flatMap(walk)];
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kidsOf(n).map(textOf).join(''));
const settle = async (): Promise<void> => { for (let i = 0; i < 2000; i++) await Promise.resolve(); };

const ROOT = '/tmp/y1-live';
const RUN = `${ROOT}/.atlas/.run`;
const START = 1_910_000_000_000;

let bootNo = 0;
type Timer = { ms: number; fn: () => void; next: number; live: boolean };

function stubEngine() {
  const files: Record<string, string> = { [`${ROOT}/.git`]: '', [`${RUN}/todos.json`]: '{"items":[]}' };
  const clock = { now: START + bootNo++ * 7_200_000 }; // each boot a new session two hours on: the run clock lives in the module
  const timers: Timer[] = [];
  const panes: { id: string; isPlaced: boolean; isShown: boolean }[] = [];
  const rec = { closes: [] as { id: string }[], tickWrites: 0, toasts: [] as string[] };
  const state = memState();
  const rawSet = state.set.bind(state);
  (state as { set: unknown }).set = async (ref: { key: string }, ...rest: unknown[]) => {
    if (ref.key === 'spinnerTick') rec.tickWrites++;
    return (rawSet as (...a: unknown[]) => Promise<unknown>)(ref, ...rest);
  };
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: {
      now: async () => clock.now,
      every: (ms: number, fn: () => void) => { const t: Timer = { ms, fn, next: clock.now + ms, live: true }; timers.push(t); return { cancel() { t.live = false; } }; },
      after: () => ({ cancel() {} }),
      sleep: async () => {},
    },
    session: { id: async () => 'sess-y1' },
    process: { run: async (argv: string[]) => {
      if (argv[0] === 'mv') { files[argv[3]!] = files[argv[2]!]!; delete files[argv[2]!]; }
      return { exitCode: 0, stdout: 'main', stderr: '' };
    } },
    fs: {
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('missing'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('missing'); return { size: files[p]!.length, mtimeMs: 1 }; },
      exists: async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
      write: async (p: string, t: string) => { files[p] = t; },
      list: async (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]!))].map((name) => ({ name })),
    },
    agent: { list: async () => [] },
    state,
    audio: { play: async () => {} },
    ui: {
      panes: () => panes,
      log: () => {}, invalidate: () => {}, status: () => {}, resolve: () => fakeEls,
      open: async () => ({ isPlaced: true as const }),
      close: async (a: { id: string }) => { rec.closes.push(a); },
      toast: (t: string) => { rec.toasts.push(t); },
    },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  /** Advance the clock 50 ms at a time, firing every due `every` timer (settled) in order; `after` runs behind each step (the host's redraw). */
  const advance = async (ms: number, after?: () => Promise<void>): Promise<void> => {
    for (let t = 0; t < ms; t += 50) {
      clock.now += 50;
      for (const timer of timers) {
        if (!timer.live || timer.next > clock.now) continue;
        timer.next += timer.ms;
        timer.fn();
        await settle();
      }
      if (after) await after();
    }
  };
  return { $: $ as unknown as EngineInterface, clock, rec, advance, files, panes };
}

async function boot(files?: Record<string, string>) {
  const s = stubEngine();
  if (files) Object.assign(s.files, files);
  const cap = captureOn();
  resetCore();
  await register(cap.on, {});
  // The run clock, its hold and the armed prompt live in register.ts module scope and only session.end resets them: an earlier file
  // (wire-expert) leaves a run open at a later clock, so end that session first, as the host does before a new one.
  await cap.one('session.end')(s.$, { reason: 'other' }, noopNext);
  await cap.one('session.start')(s.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
  await settle();
  const props = { working: false };
  const band = async (columns = 150, fullscreen = false, maxRows = 14): Promise<Node> =>
    (await cap.one('ui.render', ['component', 'AbovePrompt'])(s.$, { surface: 'terminal', viewport: { isFullscreen: fullscreen, columns }, props: { hasSurvey: false, bodyColumns: columns, maxRows, isWorking: props.working } }, async () => fakeEls.Text({ children: 'prompt' }))) as Node;
  const pane = async (columns = 56): Promise<Node> =>
    (await cap.one('ui.render', ['component', 'Pane'])(s.$, { surface: 'terminal', requestId: 'atlas', props: { bodyColumns: columns, scroll: { bodyRows: 40 } } }, noopNext)) as Node;
  const measure = (e: unknown) => cap.one('session.measure')(s.$, e, noopNext);
  const tool = async (n = 1) => { for (let i = 0; i < n; i++) for (const h of cap.all('tool.call')) await h(s.$, { tool: 'Bash' }, noopNext); };
  /** Let the boot run finish and rest until the band reads idle. */
  const rest = async (): Promise<void> => { await s.advance(20_000, async () => { await band(); }); };
  return { ...s, cap, props, band, pane, measure, tool, rest };
}
const press = async (n: Node): Promise<void> => { n.props.onPress(); await settle(); };
const button = (tree: Node, key: string, text?: string): Node => {
  const found = walk(tree).find((n) => n.kind === 'Button' && n.props.key === key && (text === undefined || textOf(n).includes(text)));
  if (!found) throw new Error(`no Button ${key}${text ? ` with ${text}` : ''}`);
  return found;
};

const HIST = `${RUN}/history.json`;
const hasStrip = (t: string): boolean => /◌ idle · /.test(t) && t.includes('▸ details');

describe('y1-live: the narrow idle strip (Y1d)', () => {
  test('at 110 columns, idle, with the pane undrawn, the strip stands two rows above the band', async () => {
    const b = await boot();
    await b.rest();
    const tree = await b.band(110);
    const t = textOf(tree);
    expect(hasStrip(t)).toBe(true);
    expect(t.indexOf('▸ details')).toBeLessThan(t.indexOf('ATLAS')); // above the band
    expect(t).toMatch(/gates [^·]+ · hooks/);
  });

  test('absent at 150 columns, with a placed pane, while working and with the card open', async () => {
    const b = await boot();
    await b.rest();
    expect(hasStrip(textOf(await b.band(150)))).toBe(false);
    await b.band(110, true); // a fullscreen terminal asks the engine for the pane at rest (the engine then places it or keeps it undrawn)
    await b.advance(3000, async () => { await b.band(110); });
    expect(hasStrip(textOf(await b.band(110)))).toBe(true); // opened but undrawn: the strip still stands in for it
    b.panes.push({ id: 'atlas', isPlaced: true, isShown: true });
    await b.advance(3000, async () => { await b.band(110); });
    expect(hasStrip(textOf(await b.band(110)))).toBe(false); // the pane is drawn: it says all of it
    b.panes.length = 0;
    await b.advance(3000, async () => { await b.band(110); });
    expect(hasStrip(textOf(await b.band(110)))).toBe(true);
    b.props.working = true;
    expect(hasStrip(textOf(await b.band(110)))).toBe(false);
    b.props.working = false;
  });
});

describe('y1-live: the history file (Y1a)', () => {
  test('a run end writes history.json under .atlas/.run (temp then mv) and a second boot shows it as prev', async () => {
    const b = await boot();
    await b.rest();
    b.props.working = true;
    await b.cap.one('prompt.submit')(b.$, { text: 'go', origin: { kind: 'user' } }, noopNext);
    await b.advance(400, async () => { await b.band(); });
    await b.tool(2);
    await b.cap.one('classic.Stop')(b.$, { stop_hook_active: false }, async (e) => e);
    b.props.working = false;
    await b.advance(4000, async () => { await b.band(); });
    const text = b.files[HIST];
    expect(text).toBeDefined();
    expect(Object.keys(b.files)).not.toContain(`${HIST}.tmp`);
    const doc = JSON.parse(text!) as { v: number; runs: { secs: number; ok: boolean }[] };
    expect(doc.v).toBe(1);
    expect(doc.runs.length).toBeGreaterThanOrEqual(1);
    // the next session starts from that file
    const c = await boot({ [HIST]: text! });
    await c.rest();
    const idle = textOf(await c.band(110));
    expect(idle).toMatch(/prev run \d+:\d\d (ok|failed)/);
    await press(button(await c.band(110), 'band:gates#0')); // the band no longer draws the card: the side panel's health tab holds RUNS
    await press(button(await c.pane(110), 'tab:core'));
    const card = textOf(await c.pane(110));
    expect(card).toMatch(/RUNS\s+1 run/); // the previous session's run, read from history.json
  });

  test('a corrupt history file reads as an empty history: the strip says `no runs yet`', async () => {
    const corrupt = await boot({ [HIST]: '{"runs": [' });
    await corrupt.rest();
    const t = textOf(await corrupt.band(110));
    expect(hasStrip(t)).toBe(true);
    expect(t).toContain('no runs yet');
  });
});
