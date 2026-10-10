// Tests for plugins/atlas/mod/data/collab.ts — pure claim/conflict/event logic over in-memory notes.
import { expect, test } from 'claude-code/testing';
import type { ChannelNote, SquadAgent } from '../contract';
import { activeClaims, collabEvents, collabSummary, findConflicts } from './collab';

let seq = 0;
function note(overrides: Partial<ChannelNote> & { owner: string; text?: string }): ChannelNote {
  seq += 1;
  return { ts: `t${seq}`, seq, channel: 'ch', kind: 'note', text: '', ...overrides };
}
function claim(owner: string, paths: string[], overrides: Partial<ChannelNote> = {}): ChannelNote {
  return note({ kind: 'claim', text: 'claim', owner, ...overrides, paths } as ChannelNote);
}
function agent(name: string, state: SquadAgent['state']): SquadAgent {
  return { name, persona: 'p', state, source: 'task' };
}
const notes = (...ns: ChannelNote[]) => ns;

test('activeClaims keeps latest claim per owner', () => {
  const ns = notes(
    claim('a', ['src/old.ts'], { ts: 't1' }),
    claim('a', ['src/new.ts'], { ts: 't2' }),
    claim('b', ['docs/x.md']),
  );
  expect(activeClaims(ns, [])).toEqual([
    { owner: 'a', paths: ['src/new.ts'], ts: 't2' },
    { owner: 'b', paths: ['docs/x.md'], ts: 't3' },
  ]);
});

test('activeClaims drops owner with exit note', () => {
  const ns = notes(claim('a', ['src/a.ts']), note({ owner: 'a', kind: 'exit', text: 'done' }), claim('b', ['src/b.ts']));
  expect(activeClaims(ns, []).map(c => c.owner)).toEqual(['b']);
});

test('activeClaims drops finished and dead squad agents', () => {
  const ns = notes(claim('a', ['x']), claim('b', ['y']), claim('c', ['z']));
  const squad = [agent('a', 'finished'), agent('b', 'dead'), agent('c', 'running')];
  expect(activeClaims(ns, squad).map(c => c.owner)).toEqual(['c']);
});

test('activeClaims reads paths defensively when absent', () => {
  const ns = notes(note({ owner: 'a', kind: 'claim', text: 'claim' }));
  expect(activeClaims(ns, []).map(c => [c.owner, c.paths])).toEqual([['a', []]]);
});

test('findConflicts detects exact and prefix overlap', () => {
  const claims = [
    { owner: 'a', paths: ['src/x.ts'], ts: 't1' },
    { owner: 'b', paths: ['src/x.ts', 'src/x/y.ts'], ts: 't2' },
    { owner: 'c', paths: ['src'], ts: 't3' },
  ];
  expect(findConflicts(claims)).toEqual([
    { a: 'a', b: 'b', path: 'src/x.ts' },
    { a: 'a', b: 'c', path: 'src' },
    { a: 'b', b: 'c', path: 'src' },
  ]);
});

test('findConflicts ignores non-overlap and same-owner pairs', () => {
  const claims = [
    { owner: 'a', paths: ['src/bc.ts', 'docs'], ts: 't1' },
    { owner: 'b', paths: ['src/b', 'data'], ts: 't2' },
  ];
  expect(findConflicts(claims)).toEqual([]);
  expect(findConflicts([
    { owner: 'a', paths: ['src'], ts: 't1' },
    { owner: 'a', paths: ['src/a.ts'], ts: 't2' },
  ])).toEqual([]);
});

test('collabEvents maps notes past sinceSeq and synthesizes conflicts', () => {
  const ns = notes(
    claim('a', ['src/x.ts'], { seq: 1, ts: 't1' }),
    claim('b', ['src/x.ts/y.ts'], { seq: 2, ts: 't2' }),
    note({ owner: 'a', kind: 'handoff', to: 'b', text: 'over to you', seq: 3, ts: 't3' }),
    note({ owner: 'b', kind: 'blocked', text: 'waiting on api', seq: 4, ts: 't4' }),
    note({ owner: 'c', kind: 'note', text: 'chatter', seq: 5, ts: 't5' }),
  );
  expect(collabEvents(ns, 0)).toEqual([
    { kind: 'claim', from: 'a', to: undefined, text: 'claim', seq: 1 },
    { kind: 'claim', from: 'b', to: undefined, text: 'claim', seq: 2 },
    { kind: 'conflict', from: 'a', to: 'b', text: 'src/x.ts', seq: 2 },
    { kind: 'handoff', from: 'a', to: 'b', text: 'over to you', seq: 3 },
    { kind: 'blocked', from: 'b', to: undefined, text: 'waiting on api', seq: 4 },
  ]);
  expect(collabEvents(ns, 2).map(e => e.seq)).toEqual([3, 4]);
});

test('collabEvents suppresses conflicts from claims at or before sinceSeq', () => {
  const ns = notes(
    claim('a', ['p'], { seq: 1, ts: 't1' }),
    claim('b', ['p'], { seq: 2, ts: 't2' }),
  );
  expect(collabEvents(ns, 1)).toEqual([
    { kind: 'claim', from: 'b', to: undefined, text: 'claim', seq: 2 },
    { kind: 'conflict', from: 'a', to: 'b', text: 'p', seq: 2 },
  ]);
  expect(collabEvents(ns, 0).filter(e => e.kind === 'conflict').length).toBe(1);
});

test('collabSummary counts claims, conflicts, blocked, handoffs, idleWithWork', () => {
  const ns = notes(
    claim('a', ['src/x.ts']),
    claim('b', ['src/x.ts']),
    claim('c', ['docs']),
    note({ owner: 'c', kind: 'exit', text: 'bye' }),
    note({ owner: 'a', kind: 'handoff', text: 'h' }),
    note({ owner: 'a', kind: 'handoff', text: 'h2' }),
    note({ owner: 'b', kind: 'blocked', text: 'b' }),
    note({ owner: 'b', kind: 'blocked', text: 'b2' }),
  );
  const squad = [agent('a', 'idle'), agent('b', 'running'), agent('c', 'idle')];
  expect(collabSummary(ns, squad)).toEqual({
    claims: 2,
    conflicts: 1,
    blocked: 2,
    handoffs: 2,
    idleWithWork: ['a'],
  });
});

test('malformed and unknown-kind notes are ignored everywhere', () => {
  const ns = notes(
    note({ owner: 'a', kind: 'weird', text: '?' }),
    claim('a', []),
    note({ owner: 'b', kind: 'claim', text: 'claim' }), // missing paths field handled via cast below
    note({ owner: 'a', kind: 'exit', text: 'x' }),
    claim('a', ['src/a.ts']),
  );
  const withMissingPaths = [
    ...ns.slice(0, 2),
    { ts: 't3', seq: 3, owner: 'b', text: 'claim', channel: 'ch', kind: 'claim' } as ChannelNote,
    ...ns.slice(3),
  ];
  // 'a' is cleared by its exit note even with a later claim; 'b' claims with no paths field.
  expect(activeClaims(withMissingPaths, []).map(c => c.owner + ':' + c.paths.join('|')))
    .toEqual(['b:']);
  expect(collabEvents(withMissingPaths, 0).filter(e => e.kind === 'conflict')).toEqual([]);
  expect(collabSummary(withMissingPaths, []).claims).toBe(1);
});
