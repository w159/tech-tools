// Worktree merges: a finished worker whose worktree merged gets one `merge` comms row.
import { describe, expect, test } from 'claude-code/testing';
import type { SquadAgent } from '../contract';
import { deriveOrchestration, detailOf, EMPTY_ORCH, onComplete, onSpawn, onStep, onToolEnd, onToolStart, parseWt, type DeriveInput, type WtRow } from './orchestration';

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

describe('activity truth', () => {
  test('startedAt is set once at first sight and survives tool start/end; since tracks the current tool', () => {
    let o = onSpawn(EMPTY_ORCH, 'a1', 'map', NOW);
    o = onToolStart(o, 'a1', 'Grep', NOW + 1_000);
    o = onToolEnd(o, 'a1', NOW + 2_000);
    o = onToolStart(o, 'a1', 'Read', NOW + 3_000);
    expect(o.activity.a1?.startedAt).toBe(NOW);
    expect(o.activity.a1?.since).toBe(NOW + 3_000);
    expect(onToolStart(EMPTY_ORCH, 'b2', 'Grep', NOW + 9).activity.b2?.startedAt).toBe(NOW + 9);
  });

  test('tool end keeps the answered tool as lastTool and its target', () => {
    let o = onSpawn(EMPTY_ORCH, 'a1', 'map', NOW);
    o = onToolStart(o, 'a1', 'mcp__lean-ctx__ctx_shell', NOW + 1_000, { command: 'sleep 5' });
    o = onToolEnd(o, 'a1', NOW + 2_000);
    expect([o.activity.a1?.tool, o.activity.a1?.lastTool, o.activity.a1?.target]).toEqual([null, 'mcp__lean-ctx__ctx_shell', 'sleep 5']);
  });

  test('tool start records a target: file basename, else the first 40 chars of a command', () => {
    const o = onSpawn(EMPTY_ORCH, 'a1', 'map', NOW);
    expect(onToolStart(o, 'a1', 'Edit', NOW, { file_path: '/repo/src/deep/foo.ts' }).activity.a1?.target).toBe('foo.ts');
    const cmd = onToolStart(o, 'a1', 'Bash', NOW, { command: 'npm run build --workspaces --if-present && echo done\nsecond' });
    expect(cmd.activity.a1?.target).toBe('npm run build --workspaces --if-present ');
    expect(onToolStart(o, 'a1', 'Grep', NOW).activity.a1?.target).toBeUndefined();
  });

  test('MCP tools take path, pattern and query as the target', () => {
    const o = onSpawn(EMPTY_ORCH, 'a1', 'map', NOW);
    const target = (input: unknown) => onToolStart(o, 'a1', 'mcp__x__ctx', NOW, input).activity.a1?.target;
    expect([target({ path: '/repo/band.tsx' }), target({ pattern: 'foo\nbar' }), target({ query: 'meaning' })]).toEqual(['band.tsx', 'foo', 'meaning']);
  });
});

describe('reducer edges', () => {
  const base = (over: Partial<DeriveInput>): DeriveInput => ({
    orch: EMPTY_ORCH, names: {}, listed: [], squad: [], notes: [], members: [], leadNames: [], wt: [], now: NOW + 60_000, mergedAt: {}, ...over,
  });

  test('onToolStart counts calls by exactly one, keeps the lead out of stage, and never un-reports a worker', () => {
    let o = onToolStart(EMPTY_ORCH, 'lead', 'Read', NOW);
    o = onToolStart(o, 'lead', 'Grep', NOW + 1);
    expect(o.activity.lead?.toolCount).toBe(2);
    expect(o.stage).toEqual({});
    const w = onToolStart(onSpawn(EMPTY_ORCH, 'w1', 'x', NOW), 'w1', 'Read', NOW + 1);
    expect(w.stage.w1).toBe('working');
    const reported = onComplete(w, 'w1', { reason: 'answer', answer: 'ok', tokens: 1 }, NOW + 2);
    expect(onToolStart(reported, 'w1', 'Read', NOW + 3).stage.w1).toBe('reported');
  });

  test('detailOf Read ranges: offset and limit combine, alone, and at the value 1', () => {
    expect(detailOf('Read', { file_path: '/a/b.ts', offset: 5, limit: 10 })).toBe('Read /a/b.ts:5-14');
    expect(detailOf('Read', { file_path: '/a/b.ts', offset: 1, limit: 1 })).toBe('Read /a/b.ts:1-1');
    expect(detailOf('Read', { file_path: '/a/b.ts', offset: 1 })).toBe('Read /a/b.ts:1');
    expect(detailOf('Read', { file_path: '/a/b.ts', limit: 1 })).toBe('Read /a/b.ts:1-1');
    expect(detailOf('Read', { file_path: '/a/b.ts', limit: 30 })).toBe('Read /a/b.ts:1-30');
    expect(detailOf('Read', { file_path: '/a/b.ts', offset: 0, limit: 0 })).toBe('Read /a/b.ts');
    expect(detailOf('Read', { offset: 3 })).toBeUndefined();
  });

  test('onStep: thinking when idle, untouched while a tool is in flight, since only moves on the change', () => {
    const inFlight = onToolStart(EMPTY_ORCH, 'lead', 'Read', NOW);
    expect(onStep(inFlight, 'lead', NOW + 5)).toBe(inFlight);
    const idle = onStep(EMPTY_ORCH, 'lead', NOW);
    expect(idle.activity.lead).toMatchObject({ mood: 'thinking', since: NOW });
    expect(onStep(idle, 'lead', NOW + 9).activity.lead?.since).toBe(NOW);
    const between = onToolEnd(inFlight, 'lead', NOW + 3);
    expect(onStep(between, 'lead', NOW + 9).activity.lead?.since).toBe(NOW + 3);
    const done = onComplete(idle, 'lead', { reason: 'answer', answer: 'a', tokens: 0 }, NOW + 4);
    expect(onStep(done, 'lead', NOW + 20).activity.lead).toMatchObject({ mood: 'thinking', since: NOW + 20 });
  });

  test('onComplete adds tokens only when positive; an empty report reads failed or reported', () => {
    const a = onComplete(EMPTY_ORCH, 'lead', { reason: 'answer', answer: 'x', tokens: 0 }, NOW);
    expect(a.activity.lead?.tokens).toBeNull();
    const b = onComplete(a, 'lead', { reason: 'answer', answer: 'x', tokens: 7 }, NOW + 1);
    const c = onComplete(b, 'lead', { reason: 'answer', answer: 'x', tokens: 0 }, NOW + 2);
    expect([b.activity.lead?.tokens, c.activity.lead?.tokens]).toEqual([7, 7]);
    const d = onComplete(c, 'lead', { reason: 'answer', answer: 'x', tokens: 5 }, NOW + 3);
    expect(d.activity.lead?.tokens).toBe(12);
    const spawned = onSpawn(EMPTY_ORCH, 'w1', 'x', NOW);
    const reports = (reason: string) => onComplete(spawned, 'w1', { reason, answer: '', tokens: 0 }, NOW + 1).comms.filter((m) => m.kind === 'report').map((m) => m.text);
    expect(reports('answer')).toEqual(['reported']);
    expect(reports('error')).toEqual(['failed']);
    expect(reports('aborted')).toEqual([]);
  });

  test('parseWt keeps only objects with string agent and branch', () => {
    const good = { agent: 'a', branch: 'worker/a', worktree: null, ahead: 0, behind: 0, dirty: false, verified_finding: null, merged: false };
    expect(parseWt(JSON.stringify([good, 'str', 5, null, { agent: 'x' }, { agent: 1, branch: 'b' }, { branch: 'b' }, true]))).toEqual([good]);
    expect(parseWt('not json')).toEqual([]);
    expect(parseWt('{"agent":"a","branch":"b"}')).toEqual([]);
  });

  test('a squad-only worker (a team pane) gets its tool, tokens, mood and pane-log fields; undefined ones are omitted', () => {
    const squad = [
      { name: 'pane-a', persona: 'implementer', state: 'running', source: 'team', tool: 'Edit', lastTool: 'Read', target: 'x.ts', startedAt: NOW - 500, calls: [NOW - 9], tokens: 321 },
      { name: 'pane-b', persona: 'implementer', state: 'parked', source: 'team' },
      { name: 'pane-c', persona: 'implementer', state: 'input', source: 'team' },
    ] as unknown as DeriveInput['squad'];
    const act = deriveOrchestration(base({ squad })).activity;
    expect(act['pane-a']).toEqual({ tool: 'Edit', lastTool: 'Read', target: 'x.ts', startedAt: NOW - 500, calls: [NOW - 9], since: NOW + 60_000, toolCount: 0, tokens: 321, mood: 'working', lastLine: '' });
    expect(act['pane-b']).toEqual({ tool: null, since: NOW + 60_000, toolCount: 0, tokens: null, mood: 'idle', lastLine: '' });
    expect(act['pane-c']?.mood).toBe('blocked');
  });

  test('a board note longer than 300 chars is clipped to 300 with an ellipsis', () => {
    const notes = [{ seq: 1, ts: new Date(NOW).toISOString(), owner: 'lead', to: 'all', kind: 'say', text: 'x'.repeat(400) }] as unknown as DeriveInput['notes'];
    const text = deriveOrchestration(base({ notes })).comms[0]!.text;
    expect(text.length).toBe(300);
    expect(text.endsWith('…')).toBe(true);
    const short = [{ ...notes[0]!, text: 'y'.repeat(300) }] as unknown as DeriveInput['notes'];
    expect(deriveOrchestration(base({ notes: short })).comms[0]!.text).toBe('y'.repeat(300));
  });

  test('a worker whose own turn reported (live stage) but has no finished squad row still gets its merge row', () => {
    const id = 'a1111111111111111';
    const o = onComplete(onSpawn(EMPTY_ORCH, id, 'map', NOW, { name: 'explore-band-rows', type: 'atlas:explorer' }), id, { reason: 'answer', answer: 'ok', tokens: 1 }, NOW + 1);
    const wt: WtRow[] = [{ agent: 'explore-band-rows', branch: 'worker/explore-band-rows', worktree: null, ahead: 0, behind: 0, dirty: false, verified_finding: null, merged: true }];
    const squad: SquadAgent[] = [{ name: 'explore-band-rows', persona: 'explorer', state: 'running', source: 'task' }];
    const rows = deriveOrchestration(base({ orch: o, names: { [id]: 'explore-band-rows' }, squad, wt })).comms.filter((c) => c.kind === 'merge');
    expect(rows.map((r) => r.text)).toEqual(['merged worker/explore-band-rows']);
  });
});
