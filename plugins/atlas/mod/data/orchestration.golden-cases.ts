// Cases for the orchestration characterization test (frozen output lives in orchestration.golden-fixture.ts).
import type { SquadAgent } from '../contract';
import { deriveOrchestration, onComplete, onHeavy, onSpawn, onStep, onToolEnd, onToolStart, parseWt, EMPTY_ORCH, type DeriveInput, type Orch } from './orchestration';

const NOW = 1_760_000_000_000;
const base = (over: Partial<DeriveInput>): DeriveInput => ({
  orch: EMPTY_ORCH, names: {}, listed: [], squad: [], notes: [], members: [], leadNames: [], findingsText: '[]', wt: [], heavyTotal: 0, now: NOW + 60_000, mergedAt: {}, finishedAt: {}, ...over,
});

function rich(): Record<string, unknown> {
  let o: Orch = EMPTY_ORCH;
  const ids = ['a1111111111111111', 'b2222222222222222', 'c3333333333333333', 'd4444444444444444', 'e5555555555555555'];
  o = onSpawn(o, ids[0]!, 'STATUS: x\nmap the band rows', NOW, { name: 'explore-band', type: 'atlas:explorer' });
  o = onSpawn(o, ids[1]!, 'verify explore-band output', NOW + 1, { name: 'verify-band', type: 'atlas:verifier' });
  o = onSpawn(o, ids[2]!, '', NOW + 2, { name: 'impl-merge', type: 'atlas:implementer' });
  o = onSpawn(o, ids[3]!, 'anon task', NOW + 2);
  o = onSpawn(o, ids[4]!, 'fails', NOW + 3, { name: 'boom-worker' });
  o = onToolStart(o, ids[0]!, 'Grep', NOW + 10);
  o = onToolEnd(o, ids[0]!, 4000, NOW + 11);
  o = onStep(o, ids[0]!, NOW + 12);
  o = onToolStart(o, 'lead', 'Read', NOW + 13);
  o = onHeavy(onToolEnd(o, 'lead', 99, NOW + 14));
  o = onStep(o, ids[1]!, NOW + 15);
  o = onToolStart(o, ids[1]!, 'Bash', NOW + 16);
  o = onStep(o, ids[1]!, NOW + 17);
  o = onComplete(o, ids[0]!, { reason: 'answer', answer: 'STEPS: 3/3\n\n# Heading line', tokens: 500 }, NOW + 20);
  o = onComplete(o, ids[2]!, { reason: 'answer', answer: 'merged ok', tokens: 0 }, NOW + 21);
  o = onComplete(o, ids[4]!, { reason: 'error', answer: '', tokens: 5 }, NOW + 22);
  o = onComplete(o, ids[3]!, { reason: 'aborted', answer: 'x'.repeat(300), tokens: 7 }, NOW + 23);
  o = onComplete(o, 'lead', { reason: 'refusal', answer: 'no', tokens: 3 }, NOW + 24);
  const squad: SquadAgent[] = [
    { name: 'explore-band', persona: 'explorer', state: 'finished', source: 'task', item: 'T1' },
    { name: 'verify-band', persona: 'verifier', state: 'running', source: 'task', task: 'verify explore-band' },
    { name: 'impl-merge', persona: 'implementer', state: 'finished', source: 'task' },
    { name: 'blocked-one', persona: 'explorer', state: 'input', source: 'task', tokens: 42 },
    { name: 'dead-one', persona: 'explorer', state: 'dead', source: 'task' },
    { name: 'run-one', persona: 'explorer', state: 'running', source: 'task' },
    { name: 'idle-one', persona: 'explorer', state: 'idle' as SquadAgent['state'], source: 'task' },
  ];
  const notes = [
    { seq: 1, ts: '2026-10-12T10:00:00Z', owner: 'lead-1', to: 'all', text: 'kickoff', kind: 'say' },
    { seq: 2, ts: 'garbage', owner: 'impl-merge', to: 'lead-1', text: 'y'.repeat(400), kind: 'report' },
    { seq: 3, ts: '2026-10-12T10:00:05Z', owner: 'x', kind: 'exit', text: 'bye' },
    { seq: 4, ts: '2026-10-12T10:00:06Z', owner: 'a1111111111111111', to: 'lead', text: 'dup', kind: 'merge' },
    { seq: 5, ts: '2026-10-12T10:00:07Z', owner: 'x', text: 'join', kind: 'join' },
    { seq: 6, ts: '2026-10-12T10:00:08Z', owner: 'x', text: 'disp', kind: 'dispatch' },
  ] as unknown as DeriveInput['notes'];
  const findings = JSON.stringify({ findings: [
    { id: 'f1', status: 'Verified', title: 'explore-band mapped', evidence: ['ok'] },
    { id: 'f2', status: 'rejected', title: 'boom-worker', worker: 'boom-worker' },
    { id: 'f3', status: 'verifying', evidence: 'blocked-one trace' },
    { id: 'f4', status: 'verified', title: 'tree link' }, 7, null,
  ] });
  const wt = parseWt(JSON.stringify([
    { agent: 'impl-merge', branch: 'worker/impl-merge', worktree: '/wt/x', ahead: 1, behind: 0, dirty: false, verified_finding: 'f4', merged: true },
    { agent: 'run-one', branch: 'worker/run-one', worktree: null, ahead: 0, behind: 0, dirty: true, verified_finding: null, merged: false },
  ]));
  const members = [{ name: 'boss', role: 'lead' }, { name: 'w', role: 'worker' }] as unknown as DeriveInput['members'];
  const input = base({
    orch: o, notes, squad, wt, findingsText: findings, members, leadNames: ['lead-1'], heavyTotal: 9,
    names: { [ids[0]!]: 'explore-band', [ids[1]!]: 'verify-band', [ids[2]!]: 'impl-merge', [ids[4]!]: 'boom-worker' },
    listed: [{ id: ids[1]!, status: 'waiting' }, { id: ids[4]!, status: 'failed' }, { id: ids[2]!, status: 'completed' }, { id: ids[3]!, status: 'running' }],
  });
  const first = deriveOrchestration(input);
  return { first, second: deriveOrchestration({ ...input, now: NOW + 99_000 }), mergedAt: input.mergedAt, finishedAt: input.finishedAt, orch: o };
}

export function serializeGolden(): string {
  return JSON.stringify(cases(), null, 1);
}

function cases(): Record<string, unknown> {
  const spawn = onSpawn(EMPTY_ORCH, 'a1', 'map', NOW, { name: 'explore', type: 'atlas:explorer' });
  const working = onToolStart(spawn, 'a1', 'Grep', NOW + 1_000);
  return {
    rich: rich(),
    emptyDerive: deriveOrchestration(base({})),
    wtBad: [parseWt('nope'), parseWt('{}'), parseWt('[1,{"agent":"a","branch":"b"},{"agent":1}]')],
    badFindings: [deriveOrchestration(base({ findingsText: 'nope' })).lifecycle, deriveOrchestration(base({ findingsText: '{"findings":3}' })).lifecycle],
    working: deriveOrchestration(base({ orch: working, names: { a1: 'explore' }, listed: [{ id: 'a1', status: 'running' }] })),
    stepKeep: onStep(working, 'a1', NOW + 5),
    completes: ['answer', 'error', 'refusal', 'aborted', 'other'].map((reason) => onComplete(working, 'a1', { reason, answer: 'STATUS: DONE\nbody', tokens: 2 }, NOW + 9)),
    leadComplete: onComplete(EMPTY_ORCH, 'lead', { reason: 'answer', answer: '', tokens: 0 }, NOW),
    reportedToolStart: onToolStart(onComplete(working, 'a1', { reason: 'answer', answer: 'x', tokens: 1 }, NOW + 2), 'a1', 'Bash', NOW + 3),
  };
}

