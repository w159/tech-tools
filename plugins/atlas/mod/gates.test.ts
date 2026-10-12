// Tests for mod/gates.ts: atlas_gates.py JSON shaping, header group, open-gate count.
import { describe, expect, test } from 'claude-code/testing';
import { gatesError, headerGroup, openGateCount, parseGates } from './gates';

const doc = (groups: unknown) => JSON.stringify({ groups });
const okLine = { id: 'l1', label: 'L', ok: true };

describe('parseGates', () => {
  test('keeps optional detail/fix/error only when strings', () => {
    const out = parseGates(doc([
      { id: 'completion', title: 'C', error: 'e', lines: [{ ...okLine, detail: 'd', fix: 'f' }, { id: 'l2', label: 'M', ok: false, detail: 1 }] },
      { id: 'tripwire', title: 'T', error: 3, lines: [] },
    ]));
    expect(out).toEqual([
      { id: 'completion', title: 'C', error: 'e', lines: [{ id: 'l1', label: 'L', ok: true, detail: 'd', fix: 'f' }, { id: 'l2', label: 'M', ok: false }] },
      { id: 'tripwire', title: 'T', lines: [] },
    ]);
  });
  test('throws on bad shapes', () => {
    expect(() => parseGates('{}')).toThrow('no groups array');
    expect(() => parseGates(doc([{ id: 'nope', title: 'x', lines: [] }]))).toThrow('bad group');
    expect(() => parseGates(doc([{ id: 'routing', title: 1, lines: [] }]))).toThrow('bad group');
    expect(() => parseGates(doc([{ id: 'routing', title: 'x', lines: 1 }]))).toThrow('bad group');
    expect(() => parseGates(doc([null]))).toThrow('bad group');
    expect(() => parseGates(doc([{ id: 'routing', title: 'x', lines: [{ id: 'a', label: 'b', ok: 'yes' }] }]))).toThrow('bad line');
    expect(() => parseGates(doc([{ id: 'routing', title: 'x', lines: [null] }]))).toThrow('bad line');
    expect(() => parseGates('not json')).toThrow();
  });
});

describe('headerGroup / gatesError / openGateCount', () => {
  test('header states', () => {
    expect(headerGroup(null)).toEqual({ id: 'header', title: 'Header contract', lines: [] });
    expect(headerGroup({ matched: true, phase: null }).lines[0]?.detail).toBe('declared phase: unknown');
    expect(headerGroup({ matched: false, phase: 'x' }).lines[0]).toMatchObject({ ok: false, detail: 'first line did not match the ATLAS header pattern' });
  });
  test('error group and count', () => {
    expect(gatesError('boom')).toEqual({ id: 'completion', title: 'Gates', lines: [], error: 'boom' });
    expect(openGateCount([{ id: 'routing', title: 'r', lines: [okLine, { ...okLine, ok: false }] }, gatesError('x')])).toBe(1);
  });
});
