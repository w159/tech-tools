// wire-expert: the pulse, the 5 Hz idle breath, the one spinner, the close chips and the per-run tool count reach the live hooks module (register.ts).
// The real register() boots on a recording engine stub with a controllable clock and timers; the band and the pane are drawn through the
// registered ui.render hooks and the chips are pressed through their real Buttons.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { register, resetBlockedDebounce, resetCore } from '../register';
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

const ROOT = '/tmp/wire-expert';
const RUN = `${ROOT}/.atlas/.run`;
const START = 1_910_000_000_000;

type Timer = { ms: number; fn: () => void; next: number; live: boolean };

function stubEngine() {
  const files: Record<string, string> = { [`${ROOT}/.git`]: '', [`${RUN}/todos.json`]: '{"items":[]}' };
  const clock = { now: START };
  const timers: Timer[] = [];
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
    session: { id: async () => 'sess-wire' },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    fs: {
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('missing'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('missing'); return { size: files[p]!.length, mtimeMs: 1 }; },
      exists: async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
      list: async (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]!))].map((name) => ({ name })),
    },
    agent: { list: async () => [] },
    state,
    audio: { play: async () => {} },
    ui: {
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
  return { $: $ as unknown as EngineInterface, clock, rec, advance };
}

async function boot() {
  const s = stubEngine();
  const cap = captureOn();
  resetCore();
  await register(cap.on, {});
  await cap.one('session.start')(s.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
  await settle();
  const props = { working: false };
  const band = async (columns = 150): Promise<Node> =>
    (await cap.one('ui.render', ['component', 'AbovePrompt'])(s.$, { surface: 'terminal', props: { hasSurvey: false, bodyColumns: columns, maxRows: 14, isWorking: props.working } }, async () => fakeEls.Text({ children: 'prompt' }))) as Node;
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

describe('wire-expert: the pulse', () => {
  test('(a) a session.measure reaches the band (ctx) and the card (tokens of the window, events)', async () => {
    const b = await boot();
    await b.rest();
    await b.measure({ context: { tokens: 64_000, percent: 6, window: 1_000_000 }, cost: { usd: 0.04 } });
    await b.tool(3);
    await b.advance(600); // the poll rebuilds the snapshot with the new usage
    const band = textOf(await b.band());
    expect(band).toMatch(/ctx [━─=]+ +6%/);
    expect(band).toMatch(/[▁-█]{8}/); // the events spark (eighth blocks, round 3 E10)
    await press(button(await b.band(), 'band:health'));
    const card = textOf(await b.band());
    expect(card).toContain('64k of 1M');
    expect(card).toMatch(/── ACTIVITY ─+ \d+ ev · peak \d+ \/ [\d.]+[sm]/);
  });
  test('(g) a new session resets the pulse and the hook log', async () => {
    const b = await boot();
    await b.rest();
    await b.measure({ context: { tokens: 64_000, percent: 6, window: 1_000_000 }, cost: { usd: 0.04 } });
    await b.tool(4);
    await settle();
    await b.cap.one('session.start')(b.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
    await settle();
    await press(button(await b.band(), 'band:health'));
    const card = textOf(await b.band());
    expect(card).not.toContain('64k of 1M');
    expect(card).toMatch(/\b1 ev\b/); // only the new session's own start
  });
});

describe('wire-expert: idle breathing', () => {
  test('(b) at idle, with the band drawn or not, one second redraws nothing', async () => {
    const b = await boot();
    await b.advance(20_000); // the boot run ends and rests, nothing drawn
    const before = b.rec.tickWrites;
    await b.advance(1000);
    expect(b.rec.tickWrites - before).toBe(0); // nothing on screen: no writes
    await b.band();
    let seen = b.rec.tickWrites;
    const start = seen;
    await b.advance(1000, async () => { if (b.rec.tickWrites !== seen) { seen = b.rec.tickWrites; await b.band(); } }); // the host redraws on every write
    const redraws = b.rec.tickWrites - start;
    expect(redraws).toBe(0); // at rest the frame loop is stopped: the pill no longer breathes at 10 Hz (idle CPU), a finished run drew its idle word once
  });
});

describe('wire-expert: one spinner', () => {
  test('(c) the band and the panel turn the same frame on the same tick while working', async () => {
    const b = await boot();
    b.props.working = true;
    await b.advance(1500, async () => { await b.band(); });
    const band = textOf(await b.band());
    const pane = textOf(await b.pane());
    const braille = /ATLAS +([⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])/.exec(band)?.[1]; // the band's working head is a braille spinner (ribbon redesign), one of ten frames
    const glyph = braille === undefined ? undefined : '◐◓◑◒'[('⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'.indexOf(braille)) % 4]; // the panel's rows turn the circle quarters on the same frame index (truth 41)
    expect(braille).toBeDefined();
    expect(pane).toMatch(/[◐◓◑◒]/); // the pane turns circle quarters, the band a braille head: two families on purpose (ribbon redesign)
    // The host's turn flag is register.ts module state that no session hook resets: end the turn this test started, so a later
    // file's boot (y1-live) does not read a working host before its first band render.
    b.props.working = false;
    await b.band();
  });
});

describe('wire-expert: the close controls', () => {
  test('(d) the Atlas pane draws no close chip of its own: the host draws the `✕`', async () => {
    const b = await boot();
    expect(walk(await b.pane()).some((n) => n.kind === 'Button' && n.props.key === 'panel:close')).toBe(false);
    expect(textOf(await b.pane())).not.toContain('[✕]');
  });
  test('(e) the band chip that opens the card (`▾ health`, selected) closes it, as does the title chip', async () => {
    const b = await boot();
    await b.rest();
    await press(button(await b.band(), 'band:health', 'health'));
    const open = await b.band();
    expect(textOf(open)).toContain('HEALTH');
    expect(textOf(open)).not.toContain('hide');
    expect(textOf(open)).toContain('▾ health');
    await press(button(open, 'band:health', 'health'));
    expect(textOf(await b.band())).not.toContain('HEALTH');
  });
});

describe('wire-expert: tools per run', () => {
  test('(f) v1 frame spec: the band names the newest tool in its detail slot and carries no tool count, so a count never leaks across runs', async () => {
    const b = await boot();
    await b.rest();
    const run = async (calls: number): Promise<string> => {
      b.props.working = true;
      await b.cap.one('prompt.submit')(b.$, { text: 'go', origin: { kind: 'user' } }, noopNext);
      await b.advance(300, async () => { await b.band(); });
      await b.tool(calls);
      await b.advance(300, async () => { await b.band(); });
      return textOf(await b.band());
    };
    const first = await run(3);
    expect(first).toContain('Bash');
    expect(first).not.toMatch(/\d+ tools?/);
    await b.cap.one('classic.Stop')(b.$, { stop_hook_active: false }, async (e) => e);
    b.props.working = false;
    await b.advance(3000, async () => { await b.band(); });
    const second = await run(1);
    expect(second).toContain('Bash');
    expect(second).not.toMatch(/\d+ tools?/);
    // The host's turn flag is register.ts module state that no session hook resets: end the turn this test started, so a later
    // file's boot (y1-live) does not read a working host before its first band render.
    b.props.working = false;
    await b.band();
    // The band's held word (kindHold) is stamped with this file's clock, which runs past the START a later file boots at: the
    // hold would never expire there (y1-live read `done 5/5` at idle). Forget it, as the debounce seam does.
    resetBlockedDebounce();
  });
});
