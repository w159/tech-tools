// Idle cost guard: the poll fingerprint costs what is live, not what is on disk, and the timers stretch while nothing moves.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface } from 'claude-code';
import { memState } from '../test_helpers';
import { dataFingerprint, IDLE_AFTER_MS, IDLE_POLL_MS, idleSkip, resetPollIdle } from './poll';
import { noteHook, resetHookLog } from './hook-log';

const ROOT = '/r';

/** A fs stub that counts stat calls over a run dir with `boards` board files and `crews` finished crews. */
function stubEngine(boards: number, crews: number) {
  const stats = { n: 0 };
  const clock = { now: 1_900_000_000_000 };
  const state = memState();
  const $ = {
    state,
    agent: { list: async () => [] },
    clock: { now: async () => clock.now },
    fs: {
      stat: async (p: string) => {
        stats.n++;
        if (p.includes('/crew/') && !p.endsWith('summary.json') && !p.endsWith('run.json')) throw new Error('ENOENT');
        return { size: 1, mtimeMs: clock.now };
      },
      list: async (dir: string) => {
        if (dir.endsWith('/board')) return Array.from({ length: boards }, (_, i) => ({ name: `owner${i}.jsonl` }));
        if (dir.endsWith('/crew')) return Array.from({ length: crews }, (_, i) => ({ name: `run${i}` }));
        return [];
      },
      read: async () => undefined,
      exists: async () => true,
    },
  } as unknown as EngineInterface;
  return { $, stats, clock, state };
}

describe('dataFingerprint cost', () => {
  test('2,000 board files and 100 finished crews cost at most 20 stats once the crews are learned', async () => {
    resetPollIdle();
    const s = stubEngine(2000, 100);
    await s.state.set({ plugin: 'atlas', key: 'snapshot' }, { root: ROOT, members: [{ name: 'owner1' }], squad: [], notes: [], todos: [] });
    await dataFingerprint(s.$); // learns which crews are over (one pass of stats)
    s.stats.n = 0;
    await dataFingerprint(s.$);
    expect(s.stats.n).toBeLessThanOrEqual(20);
  });
});

describe('idle backoff', () => {
  test('the poll stretches after IDLE_AFTER_MS of quiet and snaps back on a hook event', async () => {
    resetPollIdle();
    resetHookLog();
    const s = stubEngine(0, 0);
    noteHook('prompt.submit', s.clock.now);
    expect(await idleSkip(s.$, 'poll', IDLE_POLL_MS)).toBe(false); // awake: never skips
    s.clock.now += 1000;
    expect(await idleSkip(s.$, 'poll', IDLE_POLL_MS)).toBe(false); // still inside IDLE_AFTER_MS of the start
    s.clock.now += IDLE_AFTER_MS;
    expect(await idleSkip(s.$, 'poll', IDLE_POLL_MS)).toBe(false); // idle now, but the first tick after the quiet runs
    s.clock.now += 500;
    expect(await idleSkip(s.$, 'poll', IDLE_POLL_MS)).toBe(true); // 500 ms later: stretched
    s.clock.now += IDLE_POLL_MS;
    expect(await idleSkip(s.$, 'poll', IDLE_POLL_MS)).toBe(false); // the stretched interval elapsed
    s.clock.now += 500;
    noteHook('tool.call Bash', s.clock.now); // a hook event
    expect(await idleSkip(s.$, 'poll', IDLE_POLL_MS)).toBe(false); // snapped back: runs on the very next tick
    s.clock.now += 500;
    expect(await idleSkip(s.$, 'poll', IDLE_POLL_MS)).toBe(false); // and keeps polling at the base rate
  });
});
