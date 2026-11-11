// Mutation-kill tests for hud.ts (seed 1105 survivors): the tick and rich defaults of surfaces(), and the bold and strike flags
// of segmentOf.
//
// Equivalent mutants, not tested:
//  - hud-surface.ts:33 maxLen reduce seed `0` -> `1`: it differs only when every string is empty, and both callers floor the result
//    (line 91: max(26|30, maxLen + 5); line 133: max(20, min(maxLen + 1, 29))), so 0 and 1 give the same column.
//  - data/crew.ts:26 parse `return undefined` -> `return undefined`: the mutator (atlas_mutate.py:227) swaps the expression for the
//    identifier `undefined`, which is already what the line returns, so the mutant text equals the original.
import { describe, expect, test } from 'claude-code/testing';
import { worldHudAgents, worldPhases, worldPlan } from '../contracts/hud-world';
import { hudRows, reclaimBlanks, segmentOf, todoModel, type HudInput } from './hud';
import { hostEnv, type Ui } from './atlas-ui';
import type { Segment } from './runs';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const input = (): HudInput => ({ todos: worldPlan(), agents: worldHudAgents(), phases: worldPhases() });
const text = (rows: Segment[][]): string[] => rows.map((r) => r.map((s) => s.t).join(''));

describe('hud surfaces: defaults', () => {
  test('the tick moves the running spinner, and no tick reads as tick 0', () => {
    const at = (tick?: number) => text(hudRows(input(), { cols: 120, maxRows: 60, ui, now: 0, ...(tick === undefined ? {} : { tick }) }));
    expect(at(0)).toEqual(at());
    expect(at(3)).not.toEqual(at(0));
  });
  test('rich unset follows ATLAS_BAND_RICH, an explicit rich wins over it', () => {
    const draw = (rich?: boolean) => text(hudRows(input(), { cols: 120, maxRows: 60, ui, now: 0, ...(rich === undefined ? {} : { rich }) }));
    const env = hostEnv() as Record<string, string | undefined>; // the live process.env, mutable for this test
    const saved = env.ATLAS_BAND_RICH;
    try {
      delete env.ATLAS_BAND_RICH;
      const plain = draw();
      const rich = draw(true);
      expect(rich).not.toEqual(plain);
      env.ATLAS_BAND_RICH = '1';
      // Under claude plugin test the env write is not visible to hostEnv(), so this check runs only where it is.
      if (hostEnv().ATLAS_BAND_RICH === '1') expect(draw()).toEqual(rich);
      expect(draw(false)).toEqual(plain);
      expect(draw(true)).toEqual(rich);
    } finally {
      if (saved === undefined) delete env.ATLAS_BAND_RICH;
      else env.ATLAS_BAND_RICH = saved;
    }
  });
});

describe('todoModel: the elapsed detail', () => {
  const detail = (over: Record<string, unknown>, now = 190_000): string =>
    todoModel([{ id: 'a', content: 'wire it', status: 'in_progress', owner: 'bob', ...over } as never], now)[0]!.detail;
  test('a running item with a claim time at or before the clock reads elapsed, with its estimate when it has one', () => {
    expect(detail({ claimed_at: 100 })).toBe('elapsed 01:30');
    expect(detail({ claimed_at: 100, estimate_s: 300 })).toBe('elapsed 01:30 of 05:00');
    expect(detail({ claimed_at: 190 })).toBe('elapsed 00:00');
  });
  test('without a claim, with a claim ahead of the clock, or when not running, the owner reads instead', () => {
    expect(detail({})).toBe('bob');
    expect(detail({ claimed_at: 200 })).toBe('bob');
    expect(detail({ status: 'pending', claimed_at: 100 })).toBe('bob');
    expect(detail({ status: 'completed', claimed_at: 100 })).toBe('bob');
  });
  test('evidence outranks both', () => {
    expect(detail({ claimed_at: 100, evidence: 'tests green' })).toBe('tests green');
  });
});

describe('reclaimBlanks', () => {
  const draw = (calls: number[]) => (n: number): string[] => { calls.push(n); return Array.from({ length: n }, (_, i) => `r${i}`); };
  test('no spare rows: the HUD stays as drawn and is not redrawn', () => {
    const calls: number[] = [];
    const hud = ['a', 'b'];
    expect(reclaimBlanks(hud, 2, 10, () => 0, draw(calls))).toBe(hud);
    expect(calls).toEqual([]);
  });
  test('spare rows: the HUD is redrawn at the cap plus the spare, never past the slot, and kept only when it grew', () => {
    const calls: number[] = [];
    const hud = ['a', 'b'];
    expect(reclaimBlanks(hud, 2, 10, () => 3, draw(calls))).toHaveLength(5);
    expect(reclaimBlanks(hud, 2, 4, () => 3, draw(calls))).toHaveLength(4);
    expect(calls).toEqual([5, 4]);
    expect(reclaimBlanks(hud, 2, 10, () => 3, () => ['x'])).toBe(hud);
  });
  test('an empty HUD stays empty', () => {
    const hud: string[] = [];
    expect(reclaimBlanks(hud, 0, 10, () => 3, () => ['x'])).toBe(hud);
  });
});

describe('segmentOf', () => {
  test('bold and strike carry through with colour', () => {
    expect(segmentOf({ t: 'x', tone: 'text', bold: true }, ui)).toMatchObject({ t: 'x', bold: true });
    expect(segmentOf({ t: 'x', tone: 'text', strike: true }, ui)).toMatchObject({ t: 'x', strike: true });
    expect(segmentOf({ t: 'x', tone: 'text' }, ui)).not.toHaveProperty('bold');
    expect(segmentOf({ t: 'x', tone: 'text' }, ui)).not.toHaveProperty('strike');
  });
  test('with NO_COLOR only bold and strike remain', () => {
    const none: Ui = { ...ui, color: 'none' };
    expect(segmentOf({ t: 'x', tone: 'accent', bold: true, strike: true }, none)).toEqual({ t: 'x', bold: true, strike: true });
  });
});
