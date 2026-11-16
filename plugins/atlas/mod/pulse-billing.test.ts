// The pulse reports the host's cost only for a login billed per token (`billing: api` from the status line): a plan login or an unknown billing shows no dollar figure.
import { describe, expect, test } from 'bun:test';
import { resetHookLog } from './hook-log';
import { noteBilling, noteMeasure, pulseOf, resetPulse } from './pulse';

const fresh = (): void => { resetHookLog(); resetPulse(); };
const measure = (): void => noteMeasure({ context: { tokens: 20, percent: 2, window: 100 }, cost: { usd: 0.04 } }, 1);

describe('cost needs a validated per-token bill', () => {
  test('api: the measured cost is reported', () => {
    fresh();
    noteBilling('api');
    measure();
    expect(pulseOf(2).cost).toEqual({ usd: 0.04 });
  });
  test('plan: no cost key', () => {
    fresh();
    noteBilling('plan');
    measure();
    expect('cost' in pulseOf(2)).toBe(false);
  });
  test('unknown (never set, or a value that is neither): no cost key', () => {
    fresh();
    measure();
    expect('cost' in pulseOf(2)).toBe(false);
    noteBilling('api');
    noteBilling(undefined);
    expect('cost' in pulseOf(3)).toBe(false);
    noteBilling('free');
    expect('cost' in pulseOf(4)).toBe(false);
  });
  test('resetPulse forgets the billing', () => {
    fresh();
    noteBilling('api');
    resetPulse();
    measure();
    expect('cost' in pulseOf(2)).toBe(false);
  });
});
