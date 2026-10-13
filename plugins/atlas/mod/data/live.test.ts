import { expect, test } from 'claude-code/testing';
import { busySnap, NOW } from '../live_fixture';
import { activeCount, liveWorkers } from './live';

test('liveWorkers orders blocked, failed, working, done and drops the lead', () => {
  const s = busySnap();
  s.squad.push({ name: 'done-1', persona: 'runner', state: 'finished', source: 'task' });
  const ws = liveWorkers(s, NOW);
  expect(ws.map((w) => w.state)).toEqual(['blocked', 'failed', 'working', 'done']);
  expect(ws.map((w) => w.name)).toEqual(['impl-auth', 'runner-1', 'explorer-1', 'done-1']);
  expect(ws.some((w) => w.name === 'lead')).toBe(false);
  expect(ws[2]?.tool).toBe('Grep');
  expect(activeCount(ws)).toBe(2);
});

test('host-finished worker is done even when its activity mood is blocked', () => {
  const s = busySnap();
  s.squad.push({ name: 'probe-park', persona: 'explorer', state: 'finished', source: 'task' });
  s.activity['probe-park'] = { mood: 'blocked', tool: null, since: NOW, lastLine: 'awaits lead reply' } as (typeof s.activity)[string];
  expect(liveWorkers(s, NOW).find((w) => w.name === 'probe-park')?.state).toBe('done');
});

test('liveWorkers carries startedAt, target, and a distinct parked state outside the working count', () => {
  const s = busySnap();
  s.activity['explorer-1'] = { ...s.activity['explorer-1']!, since: NOW - 3_000, startedAt: NOW - 300_000, target: 'auth.ts' };
  s.squad.push({ name: 'sleeper', persona: 'explorer', state: 'parked', source: 'task' });
  const ws = liveWorkers(s, NOW);
  const ex = ws.find((w) => w.name === 'explorer-1')!;
  expect([ex.startedAt, ex.since, ex.target]).toEqual([NOW - 300_000, NOW - 3_000, 'auth.ts']);
  expect(ws.find((w) => w.name === 'sleeper')?.state).toBe('parked');
  expect(activeCount(ws)).toBe(2);
});
