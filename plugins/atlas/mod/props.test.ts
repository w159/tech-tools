// Tests for completeProps: the engine refuses Client props that hold undefined
// ('ui.render refused: Client props holds undefined') — explicit undefined
// values, sparse array holes. These tests guard the strip: undefined gone,
// every other falsy value (null, false, 0, '') preserved, and the operation
// idempotent.
import { describe, expect, test } from 'claude-code/testing';
import { completeProps } from './props';

describe('explicit undefined dropped', () => {
  test('top-level undefined key is absent', () => {
    expect(completeProps({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });

  test('nested undefined key is absent', () => {
    expect(completeProps({ a: { b: { c: undefined, d: 2 } } })).toEqual({ a: { b: { d: 2 } } });
  });

  test('undefined inside arrays is dropped', () => {
    expect(completeProps({ a: [1, undefined, 2] })).toEqual({ a: [1, 2] });
  });
});

describe('array holes dropped', () => {
  test('sparse array hole reads undefined and is removed', () => {
    const sparse: unknown[] = [1, , 3]; // length 3, index 1 is a hole
    expect(1 in sparse).toBe(false); // sanity: it really is a hole
    const out = completeProps({ a: sparse }) as { a: unknown[] };
    expect(out.a).toEqual([1, 3]);
    expect(out.a.length).toBe(2);
  });
});

describe('engine-legal falsy values preserved', () => {
  test('null, false, 0 and empty string survive', () => {
    expect(completeProps({ n: null, f: false, z: 0, s: '' })).toEqual({ n: null, f: false, z: 0, s: '' });
  });
});

describe('ChannelNote shape (channels.parseNote)', () => {
  test('optional keys absent, required fields intact', () => {
    const note = completeProps({
      ts: '2026-10-10T00:00:00Z',
      seq: 42,
      owner: 'mods-props-test',
      to: undefined,
      item: undefined,
      kind: undefined,
      text: 'gate is green',
      channel: 'tech-tools@main/lead-01a124',
    });
    expect(note).toEqual({
      ts: '2026-10-10T00:00:00Z',
      seq: 42,
      owner: 'mods-props-test',
      text: 'gate is green',
      channel: 'tech-tools@main/lead-01a124',
    });
    expect('to' in note).toBe(false);
    expect('item' in note).toBe(false);
    expect('kind' in note).toBe(false);
  });
});

describe('idempotency', () => {
  test('completeProps twice equals once', () => {
    const messy = { a: undefined, b: [1, undefined, { c: undefined, d: null }], e: { f: 'x', g: undefined } };
    expect(completeProps(completeProps(messy))).toEqual(completeProps(messy));
  });
});
