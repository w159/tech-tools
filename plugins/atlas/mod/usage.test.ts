// usage.ts: the local counters behind the anonymous weekly telemetry. Counting, the file shape and path, the opt-outs,
// failure isolation, the session-id guard, the throttle, and one real register path (opening the dock).
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { dockTick, register } from './register';
import { memState } from './test_helpers';
import { noteUsage, resetUsageForTest, USAGE_KEYS } from './usage';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
const noopNext: AnyNext = async (input) => input;

interface Opts { env?: Record<string, string>; sid?: string; failWrite?: boolean; files?: Record<string, string> }

/** Every stub starts from a clean module state (the shim has no beforeEach). */
function stub(o: Opts = {}) {
  resetUsageForTest();
  const writes: Array<{ path: string; text: string }> = [];
  const runs: string[][] = [];
  const timers: Array<{ ms: number; fn: () => void; cancelled: boolean }> = [];
  const clock = { t: 1_000_000 };
  const fail = { on: o.failWrite === true };
  const opens: unknown[] = [];
  const $ = {
    state: memState(),
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async (name: string) => o.env?.[name] },
    clock: {
      now: async () => clock.t,
      every: () => ({ cancel() {} }),
      after: (ms: number, fn: () => void) => { const t = { ms, fn, cancelled: false }; timers.push(t); return { cancel() { t.cancelled = true; } }; },
      sleep: async () => {},
    },
    process: { run: async (argv: string[]) => { runs.push(argv); return { exitCode: 0, stdout: 'main', stderr: '' }; } },
    session: { id: async () => o.sid ?? 'sess-1' },
    fs: {
      read: async (path: string) => { const t = o.files?.[path]; if (t === undefined) throw new Error('no such file'); return t; },
      stat: async () => { throw new Error('no such file'); },
      exists: async () => false,
      list: async () => [],
      write: async (path: string, text: string) => { if (fail.on) throw new Error('disk full'); writes.push({ path, text }); },
    },
    ui: { log: () => {}, toast: () => {}, invalidate: () => {}, open: async (a: unknown) => { opens.push(a); return { isPlaced: true as const }; } },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  const last = () => writes[writes.length - 1];
  return { $: $ as unknown as EngineInterface, writes, runs, timers, clock, opens, last, fail };
}

const parsed = (s: { last(): { text: string } | undefined }) => JSON.parse(s.last()!.text);
const DELTA = /^\/[^ ]+\/analytics\/mod\/([A-Za-z0-9_-]+)-(\d+)-([a-z0-9]{6})\.json\.tmp$/;
const sum = (ws: Array<{ text: string }>) => {
  const t: Record<string, number> = {};
  for (const w of ws) for (const [k, n] of Object.entries(JSON.parse(w.text).counts as Record<string, number>)) t[k] = (t[k] ?? 0) + n;
  return t;
};

describe('usage counters', () => {
  test('USAGE_KEYS is exactly the eleven keys of the schema', () => {
    expect([...USAGE_KEYS]).toEqual([
      'mod.open.dock', 'mod.open.ondemand', 'mod.open.board',
      'mod.command.atlas-cc', 'mod.command.atlas-say', 'mod.command.atlas-core', 'mod.command.atlas-todo',
      'mod.error.boot', 'mod.error.rebuild', 'mod.error.fault', 'mod.error.other',
    ]);
  });

  test('each flush writes a delta file that is exactly {v:2,counts}', async () => {
    const s = stub({ env: { ATLAS_HOME: '/h' } });
    await noteUsage(s.$, 'mod.open.dock');
    expect(parsed(s)).toEqual({ v: 2, counts: { 'mod.open.dock': 1 } });
    s.clock.t += 6000; // past the throttle window
    await noteUsage(s.$, 'mod.open.dock');
    await noteUsage(s.$, 'mod.error.boot'); // inside the new window: only counted, written by the trailing beat
    expect(s.writes).toHaveLength(2);
    s.clock.t += 6000;
    s.timers.filter((t) => !t.cancelled).forEach((t) => t.fn());
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await new Promise((r) => setTimeout(r, 0));
    expect(Object.keys(parsed(s)).sort()).toEqual(['counts', 'v']);
    expect(parsed(s)).toEqual({ v: 2, counts: { 'mod.error.boot': 1 } });
  });

  test('path: $ATLAS_HOME/analytics/mod/<sid>-<seq>-<rand>.json, else $HOME/.atlas/...; temp file then mv', async () => {
    const a = stub({ env: { ATLAS_HOME: '/atlas-home', HOME: '/home/u' }, sid: 'abc_1-2' });
    await noteUsage(a.$, 'mod.command.atlas-cc');
    const tmp = a.last()!.path;
    expect(tmp).toMatch(/^\/atlas-home\/analytics\/mod\/abc_1-2-0-[a-z0-9]{6}\.json\.tmp$/);
    expect(a.runs).toContainEqual(['mkdir', '-p', '/atlas-home/analytics/mod']);
    expect(a.runs).toContainEqual(['mv', '-f', tmp, tmp.replace(/\.tmp$/, '')]);
    resetUsageForTest();
    const b = stub({ env: { HOME: '/home/u' } });
    await noteUsage(b.$, 'mod.command.atlas-cc');
    expect(b.last()!.path).toMatch(/^\/home\/u\/\.atlas\/analytics\/mod\/sess-1-0-[a-z0-9]{6}\.json\.tmp$/);
  });

  test('DO_NOT_TRACK=1 writes nothing; DO_NOT_TRACK=0 does not opt out', async () => {
    const s = stub({ env: { ATLAS_HOME: '/h', DO_NOT_TRACK: '1' } });
    await noteUsage(s.$, 'mod.open.dock');
    expect(s.writes).toHaveLength(0);
    expect(s.runs).toHaveLength(0);
    resetUsageForTest();
    const z = stub({ env: { ATLAS_HOME: '/h', DO_NOT_TRACK: '0' } });
    await noteUsage(z.$, 'mod.open.dock');
    expect(z.writes).toHaveLength(1);
  });

  test('ATLAS_ANALYTICS off-words write nothing (any case); other values count', async () => {
    for (const v of ['off', 'OFF', '0', 'false', 'No', 'disabled', 'disable']) {
      resetUsageForTest();
      const s = stub({ env: { ATLAS_HOME: '/h', ATLAS_ANALYTICS: v } });
      await noteUsage(s.$, 'mod.open.dock');
      expect(s.writes).toHaveLength(0);
    }
    resetUsageForTest();
    const on = stub({ env: { ATLAS_HOME: '/h', ATLAS_ANALYTICS: 'on' } });
    await noteUsage(on.$, 'mod.open.dock');
    expect(on.writes).toHaveLength(1);
  });

  test('the opt-out is read once per process and cached', async () => {
    const env: Record<string, string> = { ATLAS_HOME: '/h' };
    const s = stub({ env });
    await noteUsage(s.$, 'mod.open.dock');
    env.DO_NOT_TRACK = '1';
    s.clock.t += 6000;
    await noteUsage(s.$, 'mod.open.dock');
    expect(s.writes).toHaveLength(2);
  });

  test('a throwing fs.write never throws out of noteUsage', async () => {
    const s = stub({ env: { ATLAS_HOME: '/h' }, failWrite: true });
    await expect(noteUsage(s.$, 'mod.error.other')).resolves.toBeUndefined();
  });

  test('an unsafe session id writes nothing', async () => {
    for (const sid of ['../evil', 'a/b', '', 'x'.repeat(65), 'sp ace']) {
      resetUsageForTest();
      const s = stub({ env: { ATLAS_HOME: '/h' }, sid });
      await noteUsage(s.$, 'mod.open.dock');
      expect(s.writes).toHaveLength(0);
      expect(s.runs.filter((r) => r[0] === 'mv')).toHaveLength(0);
    }
  });

  test('throttle: one write per 5 s, one trailing write for the counts inside the window', async () => {
    const s = stub({ env: { ATLAS_HOME: '/h' } });
    await noteUsage(s.$, 'mod.open.dock');
    s.clock.t += 1000;
    await noteUsage(s.$, 'mod.open.dock');
    await noteUsage(s.$, 'mod.open.dock');
    expect(s.writes).toHaveLength(1);
    expect(s.timers.filter((t) => !t.cancelled)).toHaveLength(1);
  });

  test('opening the dock through the real register path records mod.open.dock', async () => {
    const handlers = new Map<string, AnyHandler>();
    const on = ((event: string, m: unknown, h?: unknown) => {
      handlers.set(h === undefined ? event : `${event}|${String((m as Record<string, unknown>).command ?? (m as Record<string, unknown>).component ?? '')}`, (h ?? m) as AnyHandler);
      return { catch() {} };
    }) as unknown as On;
    const s = stub({ env: { ATLAS_HOME: '/h' }, sid: 'real-path' });
    await register(on, {});
    const pick = (k: string) => handlers.get(k)!;
    await pick('session.start')(s.$, { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true }, noopNext);
    const e = { surface: 'terminal', viewport: { columns: 110, rows: 40, isFullscreen: true }, props: { hasSurvey: false, bodyColumns: 110 } };
    await pick('ui.render|AbovePrompt')(s.$, e, noopNext).catch(() => undefined);
    await dockTick(s.$);
    await pick('prompt.submit')(s.$, { text: 'go' }, noopNext);
    expect(s.opens).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0)); // noteUsage is fire-and-forget on this path
    const usage = s.writes.filter((w) => /\/real-path-\d+-[a-z0-9]{6}\.json\.tmp$/.test(w.path));
    expect(usage.length).toBeGreaterThan(0);
    expect(sum(usage)).toEqual({ 'mod.open.dock': 1 });
  });
});

describe('usage opt-out parity with atlas_analytics.py', () => {
  const settings = (env: Record<string, unknown>) => JSON.stringify({ env });
  test('consent.json {enabled:false} writes nothing; {enabled:true} counts even in CI', async () => {
    const off = stub({ env: { ATLAS_HOME: '/h' }, files: { '/h/analytics/consent.json': JSON.stringify({ enabled: false }) } });
    await noteUsage(off.$, 'mod.open.dock');
    expect(off.writes).toHaveLength(0);
    const on = stub({ env: { ATLAS_HOME: '/h', CI: 'true' }, files: { '/h/analytics/consent.json': JSON.stringify({ enabled: true }) } });
    await noteUsage(on.$, 'mod.open.dock');
    expect(on.writes).toHaveLength(1);
  });

  test('ATLAS_ANALYTICS=off in settings.json env writes nothing; the env var wins over it', async () => {
    const files = { '/h/settings.json': settings({ ATLAS_ANALYTICS: 'off' }) };
    const off = stub({ env: { ATLAS_HOME: '/h' }, files });
    await noteUsage(off.$, 'mod.open.dock');
    expect(off.writes).toHaveLength(0);
    const win = stub({ env: { ATLAS_HOME: '/h', ATLAS_ANALYTICS: 'on' }, files });
    await noteUsage(win.$, 'mod.open.dock');
    expect(win.writes).toHaveLength(1);
  });

  test('settings.json is found under $HOME/.atlas when ATLAS_HOME is unset', async () => {
    const s = stub({ env: { HOME: '/u' }, files: { '/u/.atlas/settings.json': settings({ ATLAS_ANALYTICS: 'disable' }) } });
    await noteUsage(s.$, 'mod.open.dock');
    expect(s.writes).toHaveLength(0);
  });

  test('the knob outranks consent.json', async () => {
    const s = stub({ env: { ATLAS_HOME: '/h', ATLAS_ANALYTICS: 'on' }, files: { '/h/analytics/consent.json': JSON.stringify({ enabled: false }) } });
    await noteUsage(s.$, 'mod.open.dock');
    expect(s.writes).toHaveLength(1);
  });

  test('CI=true without ATLAS_ANALYTICS=on writes nothing; with it, writes', async () => {
    const off = stub({ env: { ATLAS_HOME: '/h', CI: 'true' } });
    await noteUsage(off.$, 'mod.open.dock');
    expect(off.writes).toHaveLength(0);
    const on = stub({ env: { ATLAS_HOME: '/h', CI: 'true', ATLAS_ANALYTICS: 'on' } });
    await noteUsage(on.$, 'mod.open.dock');
    expect(on.writes).toHaveLength(1);
  });

  test('DO_NOT_TRACK beats ATLAS_ANALYTICS=on; false/no do not opt out', async () => {
    const s = stub({ env: { ATLAS_HOME: '/h', DO_NOT_TRACK: '1', ATLAS_ANALYTICS: 'on' } });
    await noteUsage(s.$, 'mod.open.dock');
    expect(s.writes).toHaveLength(0);
    const f = stub({ env: { ATLAS_HOME: '/h', DO_NOT_TRACK: 'false' } });
    await noteUsage(f.$, 'mod.open.dock');
    expect(f.writes).toHaveLength(1);
  });
});

describe('usage delta files', () => {
  test('two flushes write two files whose counts sum to the total and never repeat', async () => {
    const s = stub({ env: { ATLAS_HOME: '/h' }, sid: 'dl' });
    await noteUsage(s.$, 'mod.open.dock');
    s.clock.t += 6000;
    await noteUsage(s.$, 'mod.open.dock');
    await noteUsage(s.$, 'mod.error.boot');
    s.clock.t += 6000;
    s.timers.filter((t) => !t.cancelled).forEach((t) => t.fn());
    await new Promise((r) => setTimeout(r, 0));
    expect(s.writes).toHaveLength(3);
    expect(s.writes.map((w) => JSON.parse(w.text).counts)).toEqual([{ 'mod.open.dock': 1 }, { 'mod.open.dock': 1 }, { 'mod.error.boot': 1 }]);
    expect(sum(s.writes)).toEqual({ 'mod.open.dock': 2, 'mod.error.boot': 1 });
    expect(new Set(s.writes.map((w) => w.path)).size).toBe(3);
    expect(s.writes.map((w) => Number(DELTA.exec(w.path)![2]))).toEqual([0, 1, 2]);
  });

  test('a failed write keeps its counts for the next file', async () => {
    const s = stub({ env: { ATLAS_HOME: '/h' }, failWrite: true });
    await noteUsage(s.$, 'mod.open.dock'); // write fails
    expect(s.writes).toHaveLength(0);
    s.fail.on = false;
    s.clock.t += 6000;
    await noteUsage(s.$, 'mod.error.other');
    expect(s.writes).toHaveLength(1);
    expect(parsed(s)).toEqual({ v: 2, counts: { 'mod.open.dock': 1, 'mod.error.other': 1 } });
  });

  test('two processes with one session id never collide on a file name', async () => {
    const names = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const s = stub({ env: { ATLAS_HOME: '/h' }, sid: 'same' });
      await noteUsage(s.$, 'mod.open.dock');
      names.add(s.last()!.path);
    }
    expect(names.size).toBe(20);
  });
});
