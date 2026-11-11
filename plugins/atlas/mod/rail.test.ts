// mod/rail.ts: the one phase rail every surface asks.
import { describe, expect, test } from 'claude-code/testing';
import { RAIL_DEFAULT, railIds, railNo, railOf } from './rail';

describe('the phase rail', () => {
  test('validate, blocked and done are not steps; an empty list is the default rail', () => {
    expect(railIds(['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done', 'blocked'])).toEqual(['research', 'theory', 'test', 'implement', 'verify']);
    expect(railIds([])).toEqual([...RAIL_DEFAULT]);
    expect(railIds(undefined)).toEqual([...RAIL_DEFAULT]);
  });
  test('the lit step, its index and its number', () => {
    const ids = railIds();
    expect(railNo(railOf(ids, 'implement'))).toBe('4/5');
    expect(railNo(railOf(ids, 'done'))).toBe('5/5');
    expect(railOf(ids, 'done').index).toBe(5);
    expect(railOf(ids, 'blocked', 'test').phase).toBe('test');
    expect(railOf(ids, 'blocked').phase).toBe('research');
  });
});
