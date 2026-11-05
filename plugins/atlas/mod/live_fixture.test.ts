// The shared LiveSnapshot fixture is the input of every band/colony/channel layout test: pin what it promises.
import { describe, expect, test } from 'claude-code/testing';
import { busySnap, NOW } from './live_fixture';
import { FIXTURE_CONTRACT, FIXTURE_EPOCH_MS } from './test_helpers';

describe('busySnap', () => {
  const s = busySnap();

  test('NOW is the fixture epoch', () => {
    expect(NOW).toBe(FIXTURE_EPOCH_MS);
    expect(s.now).toBe(FIXTURE_EPOCH_MS);
  });

  test('session scaffolding comes from the idle base', () => {
    expect(s.root).toBe('/r');
    expect(s.sessionId).toBe('s');
    expect(s.channel).toBe('lead-1');
    expect(s.contract).toBe(FIXTURE_CONTRACT);
    expect(s.phaseSource).toBe('default');
    expect(s.contextPct).toBe(12);
    expect([s.personas, s.todos, s.notes, s.members]).toEqual([[], [], [], []]);
  });

  test('phase and counts', () => {
    expect(s.phase).toBe('implement');
    expect(s.counts).toEqual({ done: 2, total: 5, byPhase: {} });
  });

  test('squad: a running explorer, an input-blocked implementer, a failed runner, all task-sourced', () => {
    expect(s.squad).toEqual([
      { name: 'explorer-1', persona: 'explorer', state: 'running', source: 'task', task: 'map the auth flow' },
      { name: 'impl-auth', persona: 'implementer', state: 'input', source: 'task', task: 'edit auth middleware' },
      { name: 'runner-1', persona: 'runner', state: 'failed', source: 'task', task: 'run the test suite' },
    ]);
  });

  test('activity: per-agent tool, mood, counters and a 42s-old start', () => {
    const line = 'found 3 call sites';
    const since = NOW - 42_000;
    expect(s.activity).toEqual({
      lead: { tool: 'Agent', since, toolCount: 4, tokens: 4800, mood: 'working', lastLine: line },
      'explorer-1': { tool: 'Grep', since, toolCount: 9, tokens: 10_800, mood: 'working', lastLine: line },
      'impl-auth': { tool: null, since, toolCount: 3, tokens: 3600, mood: 'blocked', lastLine: line },
      'runner-1': { tool: null, since, toolCount: 2, tokens: 2400, mood: 'failed', lastLine: line },
    });
  });

  test('comms are ordered oldest to newest with their kinds', () => {
    expect(s.comms).toEqual([
      { seq: 1, ts: NOW - 60_000, from: 'lead', to: 'explorer-1', text: 'map the auth flow', kind: 'dispatch' },
      { seq: 2, ts: NOW - 30_000, from: 'explorer-1', to: 'lead', text: 'found 3 call sites in auth/', kind: 'report' },
      { seq: 3, ts: NOW - 5_000, from: 'impl-auth', to: 'lead', text: 'need a decision on the token ttl', kind: 'say' },
    ]);
    expect(s.comms.every((c) => c.ts < NOW)).toBe(true);
  });

  test('todo groups: an implement group with a finished non-live item and an unsorted group', () => {
    expect(s.todoGroups).toEqual([
      { phase: 'implement', dept: 'FORGE', glyph: '🔧', done: 1, total: 3, items: [
        { id: 't1', content: 'edit auth middleware', status: 'in_progress', owner: 'impl-auth', evidence: null, live: true },
        { id: 't2', content: 'add ttl config', status: 'pending', owner: null, evidence: null, live: true },
        { id: 't3', content: 'old refactor', status: 'completed', owner: 'impl-auth', evidence: 'tests green', live: false },
      ] },
      { phase: 'unsorted', dept: 'UNSORTED', glyph: '·', done: 0, total: 1, items: [
        { id: 't4', content: 'triage inbox', status: 'pending', owner: null, evidence: null, live: true },
      ] },
    ]);
  });

  test('overrides win, everything else is kept; calls do not share state', () => {
    const o = busySnap({ phase: 'verify', channel: 'x', comms: [] });
    expect(o.phase).toBe('verify');
    expect(o.channel).toBe('x');
    expect(o.comms).toEqual([]);
    expect(o.squad).toHaveLength(3);
    expect(busySnap().phase).toBe('implement');
    expect(busySnap()).toEqual(s);
  });
});
