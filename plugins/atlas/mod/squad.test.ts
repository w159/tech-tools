// Tests for squad.tsx header usage honesty (unknown vs measured zero): each
// figure renders `--` when unmeasured (null = no session.measure value yet);
// a measured 0 still renders 0; measured nonzero renders its value. Mirrors
// the band.tsx UsageUnknown semantics.
import { describe, expect, test } from 'claude-code/testing';
import { usageFigures } from './pane/squad';

describe('squad header usage honesty', () => {
  test('unmeasured figures render as dashes, never as zeros', () => {
    const figs = usageFigures({ tokens: null, costUsd: null, contextPct: null });
    expect(figs.tok).toBe('--');
    expect(figs.cost).toBe('$--');
  });

  test('a measured zero still renders as zero', () => {
    const figs = usageFigures({ tokens: 0, costUsd: 0, contextPct: 0 });
    expect(figs.tok).toBe('0');
    expect(figs.cost).toBe('$0.00');
  });

  test('measured nonzero figures render their values', () => {
    const figs = usageFigures({ tokens: 15000, costUsd: 0.42, contextPct: 37 });
    expect(figs.tok).toBe('15k');
    expect(figs.cost).toBe('$0.42');
  });
});
