// fix1728 panel: every completion-group condition is decided by Stop alone, so while no Stop has been refused a failing
// completion line reads pending (never deny, never red); a refused Stop makes the failing lines red again. The band's
// denied chip never counts a pending line.
import { describe, expect, test } from 'claude-code/testing';
import { gateTally, withPending, STOP_LINE } from './runstate';
import { deniedCalls } from '../vocab';
import type { GateGroup } from '../view/panel/pane/sidebar-types';

type L = { id: string; label: string; ok: boolean; detail?: string; pending?: boolean };
const completion = (extra: L[] = []): GateGroup =>
  ({
    id: 'completion',
    title: 'Completion gate',
    lines: [
      { id: 'a', label: 'Evidence captured', ok: false },
      { id: 'b', label: 'Verified finding recorded', ok: false },
      { id: 'c', label: 'CHANGELOG present', ok: false },
      { id: 'o', label: 'Required phases marked', ok: false },
      { id: 'k', label: 'Plan written', ok: true },
      ...extra,
    ],
  }) as unknown as GateGroup;
const refused: L = { id: STOP_LINE, label: 'Last Stop blocked', ok: true, detail: 'Evidence captured' };
const allowed: L = { id: STOP_LINE, label: 'Last Stop allowed', ok: true };
const lineOf = (gs: readonly GateGroup[], id: string) => (gs[0]!.lines as unknown as L[]).find((l) => l.id === id)!;

describe('completion lines are pending until a Stop is refused', () => {
  for (const stop of [[], [allowed]] as L[][]) {
    test(`a, b, o and a docs letter are pending (stop line: ${stop.length ? 'allowed' : 'none'})`, () => {
      const gs = withPending([completion(stop)]);
      for (const id of ['a', 'b', 'o', 'c']) expect(lineOf(gs, id)).toMatchObject({ ok: true, pending: true });
      expect(lineOf(gs, 'k').pending).toBeUndefined();
      const t = gateTally([completion(stop)]);
      expect(t.failing).toEqual([]);
      expect(t.checks[0]).toMatchObject({ id: 'completion', ok: true, pending: true });
      expect(deniedCalls([completion(stop)] as never)).toBe(0);
      expect(deniedCalls(gs as never)).toBe(0);
    });
  }
  test('a refused Stop makes the failing lines red', () => {
    const gs = withPending([completion([refused])]);
    for (const id of ['a', 'b', 'o', 'c']) expect(lineOf(gs, id)).toMatchObject({ ok: false });
    expect(lineOf(gs, 'a').pending).toBeUndefined();
    expect(gateTally([completion([refused])]).failing).toEqual(['completion']);
    expect(deniedCalls([completion([refused])] as never)).toBe(4);
  });
  test('other groups are untouched: a tripwire denial is red with no Stop', () => {
    const trip = { id: 'tripwire', title: 'Dispatch tripwire', lines: [{ id: 'deny0', label: 'Denied: toolkit', ok: false }] } as unknown as GateGroup;
    const gs = withPending([completion(), trip]);
    expect((gs[1]!.lines[0] as unknown as L).ok).toBe(false);
    expect(deniedCalls([completion(), trip] as never)).toBe(1);
  });
  test('deniedCalls skips a line marked pending', () => {
    expect(deniedCalls([{ lines: [{ id: 'x', ok: false, pending: true } as never, { id: 'y', ok: false }] }])).toBe(1);
  });
});
