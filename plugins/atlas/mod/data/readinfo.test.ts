import { describe, expect, test } from 'claude-code/testing';
import { gatesReadOf, GATES_REFRESH_SECS, noteGatesRead, noteRoutesRead, readInfoOf, resetReads, routesReadOf } from './readinfo';

describe('readinfo: reader results', () => {
  test('gates fail only when a group carries an error', () => {
    expect(gatesReadOf([{}, { error: 'exit 2' }], 5)).toEqual({ at: 5, failed: true });
    expect(gatesReadOf([{}], 5).failed).toBe(false);
  });
  test('routes: null file and torn JSON fail, empty text does not', () => {
    expect(routesReadOf({ matrix: null, teams: [] }, 1).failed).toBe(true);
    expect(routesReadOf({ matrix: '{}', teams: [{ text: '{' }] }, 1).failed).toBe(true);
    expect(routesReadOf({ matrix: '{}', teams: [{ text: '' }] }, 1).failed).toBe(false);
  });
  test('readInfoOf: age in whole seconds against the gates interval, failures by reader, undefined before any read', () => {
    resetReads();
    expect(readInfoOf(10_000)).toBeUndefined();
    noteGatesRead([{}], 1_000);
    expect(readInfoOf(41_999)).toEqual({ ageSecs: 40, refreshSecs: GATES_REFRESH_SECS });
    expect(readInfoOf()).toEqual({}); // no clock given: no age is made up
    noteRoutesRead({ matrix: null, teams: [] }, 1_000);
    expect(readInfoOf(1_000)).toEqual({ ageSecs: 0, refreshSecs: GATES_REFRESH_SECS, failed: { routes: true } });
    resetReads();
  });
});
