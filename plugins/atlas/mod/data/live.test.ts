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
