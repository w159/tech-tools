import { expect, test } from 'claude-code/testing';
import { busySnap, NOW } from '../live_fixture';
import { activeCount, callBuckets, liveWorkers } from './live';

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

test('liveWorkers ranks every state strictly: blocked, failed, working, parked, done (no ties)', () => {
  const s = busySnap({ squad: [], activity: {} });
  const mk = (name: string, state: 'running' | 'input' | 'failed' | 'parked' | 'finished') => ({ name, persona: 'runner', state, source: 'task' as const });
  // Input order is the reverse of the expected order so a tie in ORDER would keep the wrong order.
  s.squad.push(mk('d', 'finished'), mk('p', 'parked'), mk('w', 'running'), mk('f', 'failed'), mk('b', 'input'));
  expect(liveWorkers(s, NOW).map((w) => w.name)).toEqual(['b', 'f', 'w', 'p', 'd']);
  // And the forward order too, so a reversed comparator cannot pass.
  s.squad.reverse();
  expect(liveWorkers(s, NOW).map((w) => w.name)).toEqual(['b', 'f', 'w', 'p', 'd']);
});

test('liveWorkers maps host and mood states', () => {
  const s = busySnap({ squad: [], activity: {} });
  const mk = (name: string, state: 'running' | 'dead' | 'stuck' | 'failed' | 'parked' | 'finished') => ({ name, persona: 'runner', state, source: 'task' as const });
  s.squad.push(mk('dead', 'dead'), mk('stuck', 'stuck'), mk('plain', 'running'), mk('moodfail', 'running'), mk('mooddone', 'running'), mk('moodblock', 'running'), mk('parkblock', 'parked'), mk('failblock', 'failed'));
  const act = (mood: string) => ({ mood, tool: null, since: NOW, toolCount: 0, tokens: null, lastLine: '' }) as unknown as (typeof s.activity)[string];
  s.activity['moodfail'] = act('failed');
  s.activity['mooddone'] = act('done');
  s.activity['moodblock'] = act('blocked');
  s.activity['parkblock'] = act('blocked');
  s.activity['failblock'] = act('blocked');
  const st = Object.fromEntries(liveWorkers(s, NOW).map((w) => [w.name, w.state]));
  expect(st).toEqual({ dead: 'failed', stuck: 'blocked', plain: 'working', moodfail: 'failed', mooddone: 'done', moodblock: 'blocked', parkblock: 'parked', failblock: 'failed' });
});

test('liveWorkers copies every activity field and falls back to since / now / null otherwise', () => {
  const s = busySnap({ squad: [], activity: {} });
  s.squad.push({ name: 'full', persona: 'explorer', state: 'running', source: 'task' }, { name: 'bare', persona: 'runner', state: 'running', source: 'task' }, { name: 'nostart', persona: 'runner', state: 'running', source: 'task' });
  s.activity['full'] = { mood: 'working', tool: 'Read', lastTool: 'Grep', since: NOW - 10, startedAt: NOW - 99, target: 'a.ts', detail: 'reading', lastLine: 'hello', calls: [NOW - 1, NOW - 2], scope: 'audit/medium', toolCount: 1, tokens: 5 } as (typeof s.activity)[string];
  s.activity['nostart'] = { mood: 'working', tool: null, since: NOW - 7, toolCount: 0, tokens: null, lastLine: '' } as (typeof s.activity)[string];
  const by = Object.fromEntries(liveWorkers(s, NOW + 500).map((w) => [w.name, w]));
  expect(by['full']).toEqual({ name: 'full', role: 'explorer', state: 'working', tool: 'Read', lastTool: 'Grep', since: NOW - 10, startedAt: NOW - 99, target: 'a.ts', detail: 'reading', lastLine: 'hello', calls: [NOW - 1, NOW - 2], scope: 'audit/medium' });
  expect(by['bare']).toEqual({ name: 'bare', role: 'runner', state: 'working', tool: null, lastTool: null, since: NOW + 500, startedAt: NOW + 500, target: null, detail: null, lastLine: '', calls: [], scope: null });
  expect(by['nostart']?.startedAt).toBe(NOW - 7);
});

test('callBuckets: 12 slots of 5s by default, oldest first, edges and out-of-range', () => {
  const now = 1_000_000;
  const out = callBuckets([now, now - 4_999, now - 5_000, now - 59_999, now - 60_000, now + 1], now);
  expect(out.length).toBe(12);
  // newest slot holds now and now-4999 (0 <= age < 5000); now+1 has a negative age and lands past the end (dropped)
  expect(out).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  expect(callBuckets([], now)).toEqual(new Array(12).fill(0));
  expect(callBuckets([now - 10, now - 2_500], now, 4, 1_000)).toEqual([0, 1, 0, 1]);
  expect(callBuckets([now - 3_999, now - 4_000], now, 4, 1_000)).toEqual([1, 0, 0, 0]);
});
