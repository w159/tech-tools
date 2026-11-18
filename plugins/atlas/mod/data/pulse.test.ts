// Pulse (S1): the observed-only data the band, panel and card draw shapes from. Nothing here is invented: an empty session is all zeros and empty rings.
import { describe, expect, test } from 'claude-code/testing';
import { noteHook, resetHookLog } from '../hook-log';
import { BUCKETS, BUCKET_MS, CTX_KEEP, RUNS_KEEP, noteBilling, noteMeasure, noteRunEnd, pulseOf, resetPulse } from './pulse';

const fresh = (): void => { resetHookLog(); resetPulse(); };

describe('records only observed samples', () => {
  test('events at t=0, 3 s, 25 s land in wall-clock 15 s buckets, 28 buckets, oldest first', () => {
    fresh();
    noteHook('tool.call Bash', 0);
    noteHook('tool.call Read', 3000);
    noteHook('turn.complete', 25000);
    const p = pulseOf(25000);
    expect(BUCKETS).toBe(28);
    expect(BUCKET_MS).toBe(15000);
    expect(p.events.length).toBe(28);
    expect(p.events.reduce((a, b) => a + b, 0)).toBe(3);
    expect(p.events[27]).toBe(1); // 25 s: the window 15-30 s holds `now`
    expect(p.events[26]).toBe(2); // 0 s and 3 s: the window 0-15 s, the bucket before
    expect(p.events.slice(0, 26).every((n) => n === 0)).toBe(true);
  });
  test('an event older than the 28 buckets (7 minutes) leaves the series', () => {
    fresh();
    noteHook('tool.call', 0);
    expect(pulseOf(419_000).events.reduce((a, b) => a + b, 0)).toBe(1);
    expect(pulseOf(421_000).events.reduce((a, b) => a + b, 0)).toBe(0);
  });
  test('before any event: events all zero, ctx and runs empty, no cost key', () => {
    fresh();
    const p = pulseOf(1000);
    expect(p.events).toEqual(new Array(28).fill(0));
    expect(p.ctx).toEqual([]);
    expect(p.runs).toEqual([]);
    expect('cost' in p).toBe(false);
  });
  test('the ctx ring keeps the newest 24, the runs ring the newest 12', () => {
    fresh();
    for (let i = 0; i < 30; i++) noteMeasure({ context: { tokens: i * 1000, percent: i, window: 1_000_000 } }, i);
    for (let i = 0; i < 15; i++) noteRunEnd(i, true, i);
    const p = pulseOf(100);
    expect(CTX_KEEP).toBe(24);
    expect(RUNS_KEEP).toBe(12);
    expect(p.ctx.length).toBe(24);
    expect(p.ctx[0]).toEqual({ tokens: 6000, pct: 6, at: 6 });
    expect(p.ctx[23]!.tokens).toBe(29000);
    expect(p.runs.length).toBe(12);
    expect(p.runs[0]!.secs).toBe(3);
    expect(p.window).toBe(1_000_000);
  });
  test('a measure with no tokens records no sample', () => {
    fresh();
    noteMeasure({ context: { window: 1_000_000 } }, 1);
    expect(pulseOf(2).ctx).toEqual([]);
  });
  test('with no cost in the measure the result has no cost key; with one it carries usd', () => {
    fresh();
    noteBilling('api'); // the cost is reported only for a per-token login
    noteMeasure({ context: { tokens: 10, percent: 1, window: 100 } }, 1);
    expect('cost' in pulseOf(2)).toBe(false);
    noteMeasure({ context: { tokens: 20, percent: 2, window: 100 }, cost: { usd: 0.04 } }, 2);
    expect(pulseOf(3).cost).toEqual({ usd: 0.04 });
    noteMeasure({ context: { tokens: 30, percent: 3, window: 100 } }, 3); // a later measure with no ledger keeps the last observed cost
    expect(pulseOf(4).cost).toEqual({ usd: 0.04 });
  });
  test('a run end appends {secs, ok, at}', () => {
    fresh();
    noteRunEnd(5, true, 1000);
    noteRunEnd(7, false, 2000);
    expect(pulseOf(3000).runs).toEqual([{ secs: 5, ok: true, at: 1000 }, { secs: 7, ok: false, at: 2000 }]);
  });
  test('resetPulse empties every ring and the cost', () => {
    fresh();
    noteMeasure({ context: { tokens: 1, percent: 1 }, cost: { usd: 1 } }, 1);
    noteRunEnd(1, true, 1);
    resetPulse();
    const p = pulseOf(2);
    expect(p.ctx).toEqual([]);
    expect(p.runs).toEqual([]);
    expect('cost' in p).toBe(false);
  });
});
