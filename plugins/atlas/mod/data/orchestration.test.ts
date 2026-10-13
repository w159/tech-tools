// Worktree merges: a finished worker whose worktree merged gets one `merge` comms row.
import { describe, expect, test } from 'claude-code/testing';
import type { SquadAgent } from '../contract';
import { deriveOrchestration, EMPTY_ORCH, onComplete, onSpawn, onToolStart, type DeriveInput, type WtRow } from './orchestration';

const NOW = 1_760_000_000_000;

function mergeRows(label: string, persona: string, wt: WtRow[], finished = true): string[] {
  let orch = onSpawn(EMPTY_ORCH, 'a1111111111111111', 'map things', NOW, { name: label, type: `atlas:${persona}` });
  if (finished) orch = onComplete(orch, 'a1111111111111111', { reason: 'answer', answer: 'done', tokens: 1 }, NOW + 1);
  const squad: SquadAgent[] = [{ name: label, persona, state: finished ? 'finished' : 'running', source: 'task' }];
  const input: DeriveInput = {
    orch, names: { a1111111111111111: label }, listed: [{ id: 'a1111111111111111', status: finished ? 'completed' : 'running' }], squad, notes: [], members: [], leadNames: [],
    wt, now: NOW + 2, mergedAt: {},
  };
  return deriveOrchestration(input).comms.filter((c) => c.kind === 'merge').map((c) => c.text);
}

describe('worktree merges', () => {
  const row = (agent: string, merged: boolean): WtRow => ({ agent, branch: `worker/${agent}`, worktree: null, ahead: 0, behind: 0, dirty: false, verified_finding: null, merged });
  test('a finished worker with a merged worktree gets one merge row', () => {
    expect(mergeRows('explore-band-rows', 'explorer', [row('explore-band-rows', true)])).toEqual(['merged worker/explore-band-rows']);
  });
  test('no merge row while the worktree is unmerged, the worker still runs, or only a persona-named branch merged', () => {
    expect(mergeRows('explore-band-rows', 'explorer', [row('explore-band-rows', false)])).toEqual([]);
    expect(mergeRows('explore-band-rows', 'explorer', [row('explore-band-rows', true)], false)).toEqual([]);
    expect(mergeRows('explore-band-rows', 'explorer', [row('explorer', true)])).toEqual([]);
  });
});

describe('finished workers and comms labels', () => {
  const base = (over: Partial<DeriveInput>): DeriveInput => ({
    orch: EMPTY_ORCH, names: {}, listed: [], squad: [], notes: [], members: [], leadNames: [], wt: [], now: NOW + 60_000, mergedAt: {}, ...over,
  });
  const working = (id: string) => onToolStart(onSpawn(EMPTY_ORCH, id, 'map', NOW, { name: 'explore', type: 'atlas:explorer' }), id, 'Grep', NOW + 1_000);

  test('host status completed beats a stale running mood; since freezes at the first-seen finish time, tool clears', () => {
    const memo: Record<string, number> = {};
    const run = (now: number) => deriveOrchestration(base({ orch: working('a1'), names: { a1: 'explore' }, listed: [{ id: 'a1', status: 'completed' }], now, finishedAt: memo })).activity.explore;
    const first = run(NOW + 30_000);
    expect(first).toMatchObject({ mood: 'done', tool: null, since: NOW + 30_000 });
    expect(run(NOW + 50_000)?.since).toBe(NOW + 30_000); // later rebuilds do not move it: the counter cannot tick
  });

  test('a worker the host no longer lists is finished when its own turn.complete arrived or its squad row is finished', () => {
    const done = onComplete(working('a1'), 'a1', { reason: 'answer', answer: 'ok', tokens: 1 }, NOW + 2_000);
    expect(deriveOrchestration(base({ orch: done, names: { a1: 'explore' } })).activity.explore?.mood).toBe('done');
    const squad: SquadAgent[] = [{ name: 'explore', persona: 'explorer', state: 'finished', source: 'task' }];
    expect(deriveOrchestration(base({ orch: working('a1'), names: { a1: 'explore' }, squad })).activity.explore).toMatchObject({ mood: 'done', tool: null });
    // the host still listing it running keeps it live even after an earlier report
    expect(deriveOrchestration(base({ orch: done, names: { a1: 'explore' }, listed: [{ id: 'a1', status: 'running' }] })).activity.explore?.mood).toBe('done'); // reported turn already terminal
    expect(deriveOrchestration(base({ orch: working('a1'), names: { a1: 'explore' }, listed: [{ id: 'a1', status: 'running' }] })).activity.explore?.mood).toBe('working');
  });

  test('two spawns in the same millisecond keep both dispatch and join lines (defect C)', () => {
    const same = (id: string, o = EMPTY_ORCH) => onSpawn(o, id, 'explore the code', NOW); // anonymous: both resolve to `worker`
    const orch = same('a2222222222222222', same('a1111111111111111'));
    const comms = deriveOrchestration(base({ orch })).comms;
    expect(comms.filter((c) => c.kind === 'dispatch')).toHaveLength(2);
    expect(comms.filter((c) => c.kind === 'join')).toHaveLength(2);
    const named = onSpawn(onSpawn(EMPTY_ORCH, 'b1', 'task', NOW, { name: 'band-rows-explorer' }), 'b2', 'task', NOW, { name: 'session-tails-explorer' });
    expect(deriveOrchestration(base({ orch: named })).comms.filter((c) => c.kind === 'dispatch').map((c) => c.to)).toEqual(['band-rows-explorer', 'session-tails-explorer']);
  });

  test('the report line skips a bare STATUS marker and keeps the first informative line (defect D)', () => {
    const report = (answer: string) => {
      const o = onComplete(onSpawn(EMPTY_ORCH, 'a1', 'map', NOW, { name: 'explore' }), 'a1', { reason: 'answer', answer, tokens: 1 }, NOW + 1);
      return [o.comms.find((c) => c.kind === 'report')?.text, o.activity.a1?.lastLine];
    };
    expect(report('STATUS: DONE\n\nTraced band.tsx:230...')).toEqual(['Traced band.tsx:230...', 'Traced band.tsx:230...']);
    expect(report('STATUS: DONE')[0]).toBe('STATUS: DONE'); // nothing better: keep the marker
    expect(report(`ok: fine\n${'x'.repeat(200)}`)[0]).toHaveLength(160);
  });

  test('the report line skips a `STEPS: n/n` bookkeeping line and takes the finding, prose or heading (live run)', () => {
    const line = (answer: string) => onComplete(onSpawn(EMPTY_ORCH, 'a4fddc42b5a4c1df6', 'map', NOW, { name: 'session-tails-explorer' }), 'a4fddc42b5a4c1df6', { reason: 'answer', answer, tokens: 1 }, NOW + 1).comms.find((c) => c.kind === 'report')?.text;
    expect(line('STEPS: 4/4\n\nparseTranscript keeps the last 4 text lines.')).toBe('parseTranscript keeps the last 4 text lines.');
    expect(line('STEP 5/5\nstatus: ok\n# Findings\nbody')).toBe('Findings');
    expect(line('STEPS: 5/5')).toBe('STEPS: 5/5'); // nothing better: keep the marker
  });

  test('the report line skips every ALL-CAPS bookkeeping label (FILES_CHANGED: none) and takes the finding', () => {
    const line = (answer: string) => onComplete(onSpawn(EMPTY_ORCH, 'a1', 'map', NOW, { name: 'x' }), 'a1', { reason: 'answer', answer, tokens: 1 }, NOW + 1).comms.find((c) => c.kind === 'report')?.text;
    expect(line('FILES_CHANGED: none\n\nThe board groups todos by phase (todos.ts:106)')).toBe('The board groups todos by phase (todos.ts:106)');
    expect(line('SUCCESS_CRITERIA: x\nSTATUS: DONE\nfiles changed: none\nReal finding')).toBe('Real finding');
    expect(line('STATUS: DONE\nFILES_CHANGED: none')).toBe('STATUS: DONE');
    expect(line('EVIDENCE:\n- band.tsx:230 caps rows at 3')).toBe('band.tsx:230 caps rows at 3'); // header-only line: take the first content line, bullet stripped
  });

  test('failed and killed hosts read failed', () => {
    for (const status of ['failed', 'killed']) {
      expect(deriveOrchestration(base({ orch: working('a1'), names: { a1: 'explore' }, listed: [{ id: 'a1', status }] })).activity.explore?.mood).toBe('failed');
    }
  });

  test('comms never carry a raw id: names map, then the spawn label, then `worker`', () => {
    const hex = 'aa42eb9f01c2d3e4f';
    const orch = onComplete(onSpawn(EMPTY_ORCH, hex, 'map', NOW, { name: 'explore-auth' }), hex, { reason: 'answer', answer: 'found it', tokens: 1 }, NOW + 1);
    const comms = deriveOrchestration(base({ orch })).comms; // id not in names (dropped from the host list)
    expect(comms.map((c) => `${c.from}>${c.to}`)).toEqual(['lead>explore-auth', 'explore-auth>all', 'explore-auth>lead', 'explore-auth>all']);
    const anon = onSpawn(EMPTY_ORCH, hex, 'map', NOW);
    expect(deriveOrchestration(base({ orch: anon })).comms.flatMap((c) => [c.from, c.to])).not.toContain('aa42eb');
    expect(deriveOrchestration(base({ orch: anon })).comms.some((c) => c.to === 'worker' || c.from === 'worker')).toBe(true);
  });
});
