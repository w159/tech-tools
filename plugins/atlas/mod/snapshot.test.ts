// Tests for mod/snapshot.ts under the claude-code testing kit.
// Covers: root/lead-channel resolution, session filter + counts, phase
// precedence (header > todo > default), instance-held mtime cache, notes/
// roster/squad/unread merge, live pass-throughs, and the no-root idle snapshot.
import { describe, expect, test } from 'claude-code/testing';
import type { SquadAgent, TodoItem } from './contract';
import { FIXTURE_CONTRACT, FIXTURE_EPOCH_MS, memFs, makeSnapshot } from './test_helpers';
import { SnapshotBuilder } from './snapshot';

const ROOT = '/r';
const CWD = '/r/sub';
const PLUGIN = '/plugin';
const SESSION = 'abc12345';
const LEAD = 'lead-abc123';
const BOARD = `${ROOT}/.atlas/.run/board/1.jsonl`;
const TODOS = `${ROOT}/.atlas/.run/todos.json`;

const IMPL_MD = '---\nname: implementer\nmodel: sonnet\neffort: medium\ncolor: green\ndescription: Implements one bounded change.\n---\nbody';
const VERI_MD = '---\nname: verifier\nmodel: haiku\neffort: low\ncolor: red\ndescription: Verifies claims against evidence.\n---\nbody';

const line = (o: Record<string, unknown>): string => JSON.stringify({ channel: LEAD, ...o });

/** Full in-memory workspace: plugin assets + an .atlas tree under /r (cwd /r/sub resolves it via the ancestor walk). */
function seed() {
  return memFs({
    [`${PLUGIN}/contracts/operating-contract.json`]: JSON.stringify(FIXTURE_CONTRACT),
    [`${PLUGIN}/agents/implementer.md`]: IMPL_MD,
    [`${PLUGIN}/agents/verifier.md`]: VERI_MD,
    [`${ROOT}/.atlas`]: '',
    [`${ROOT}/.atlas/.run/channels.json`]: JSON.stringify({
      channels: {
        [LEAD]: {
          members: [
            { name: 'impl-auth', role: 'atlas:implementer', pane_id: 'pane-1' },
            { name: 'veri-auth', role: 'atlas:verifier', pane_id: 'pane-2' },
            { name: LEAD, role: 'lead', pane_id: 'pane-0' },
          ],
        },
      },
    }),
    [BOARD]: [
      line({ seq: 1, ts: FIXTURE_EPOCH_MS, owner: LEAD, to: 'all', text: 'kick off mod build' }),
      line({ seq: 2, ts: FIXTURE_EPOCH_MS + 1000, owner: 'impl-auth', to: LEAD, text: 'guard ready' }),
      line({ seq: 3, ts: FIXTURE_EPOCH_MS + 2000, owner: 'impl-auth', to: 'impl-auth', text: 'self note' }),
      line({ channel: 'other', seq: 4, ts: FIXTURE_EPOCH_MS + 3000, owner: 'x', to: 'all', text: 'other channel' }),
      '',
    ].join('\n'),
    [TODOS]: JSON.stringify({
      version: 1,
      items: [
        { id: 't1', content: '[research] map mod surface', status: 'pending', session_id: SESSION },
        { id: 't2', content: '[theory] pick channel model', status: 'in_progress', phase: 'theory', session_id: SESSION, owner: 'x' },
        { id: 't3', content: 'write guard', status: 'in_progress', session_id: 'other-session', owner: 'impl-auth' },
        { id: 't4', content: 'elsewhere', status: 'pending', session_id: 'other-session', owner: 'impl-auth' },
        { id: 't5', content: '[verify] done thing', status: 'completed', session_id: SESSION, archived: true },
      ] satisfies TodoItem[],
    }),
  });
}

async function newBuilder() {
  const fs = seed();
  const b = new SnapshotBuilder(fs, PLUGIN);
  await b.init(CWD, {}, SESSION, 'tech-tools', 'main');
  return { fs, b };
}

function live(over: Partial<Parameters<SnapshotBuilder['build']>[0]> = {}) {
  return {
    headerPhase: null,
    headerMisses: 0,
    taskAgents: [] as SquadAgent[],
    herdrStdout: undefined as string | undefined,
    usage: { tokens: 15000, costUsd: 0.05, contextPct: 12 } as { tokens: number | null; costUsd: number | null; contextPct: number | null },
    lastSeenSeq: 0,
    now: FIXTURE_EPOCH_MS,
    ...over,
  };
}

describe('SnapshotBuilder', () => {
  test('init resolves root via ancestor walk and pins the lead channel', async () => {
    const { fs, b } = await newBuilder();
    const snap = await b.build(live());
    expect(snap.root).toBe(ROOT);
    expect(snap.channel).toBe(LEAD);
    expect(snap.sessionId).toBe(SESSION);
    expect(snap.contract).toEqual(FIXTURE_CONTRACT);
    expect(snap.personas.map((p) => p.name)).toEqual(['implementer', 'verifier']);
    expect(snap.members.map((m) => m.name)).toEqual(['impl-auth', 'veri-auth', LEAD]);
    // ATLAS_PROJECT_ROOT override wins when it holds .atlas
    const fs2 = seed();
    fs2.write('/over/.atlas', '');
    const b2 = new SnapshotBuilder(fs2, PLUGIN);
    await b2.init('/over/sub', { ATLAS_PROJECT_ROOT: '/over' }, SESSION, 'tech-tools', 'main');
    expect((await b2.build(live())).root).toBe('/over');
  });

  test('session filter: own session plus member in_progress, never archived', async () => {
    const { b } = await newBuilder();
    const snap = await b.build(live());
    expect(snap.todos.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
    expect(snap.todos.every((t) => !t.archived)).toBe(true);
    expect(snap.todos.find((t) => t.id === 't3')?.phase).toBe('research'); // stamped from prefix default
  });

  test('counts: done/total and per-phase buckets over the session slice', async () => {
    const { b } = await newBuilder();
    const snap = await b.build(live());
    expect(snap.counts).toEqual({
      done: 0,
      total: 3,
      byPhase: {
        research: { done: 0, total: 2 },
        theory: { done: 0, total: 1 },
        test: { done: 0, total: 0 },
        validate: { done: 0, total: 0 },
        implement: { done: 0, total: 0 },
        verify: { done: 0, total: 0 },
      },
    });
  });

  test('phase precedence: header beats todo; no signal falls back to default', async () => {
    const { fs, b } = await newBuilder();
    const withHeader = await b.build(live({ headerPhase: 'test' }));
    expect(withHeader.phase).toBe('test');
    expect(withHeader.phaseSource).toBe('header');

    const fromTodo = await b.build(live({ headerPhase: null }));
    expect(fromTodo.phase).toBe('theory'); // first in_progress of the slice
    expect(fromTodo.phaseSource).toBe('todo');

    // Empty the in_progress set: cache must invalidate via mtime bump (fs.write bumps).
    fs.write(TODOS, JSON.stringify({
      version: 1,
      items: [{ id: 't1', content: '[research] map mod surface', status: 'pending', session_id: SESSION }],
    }));
    const fallback = await b.build(live({ headerPhase: null }));
    expect(fallback.phase).toBe('research');
    expect(fallback.phaseSource).toBe('default');
    expect(fallback.counts.total).toBe(1);
  });

  test('todo mtime cache lives on the instance: unchanged mtime reuses the parsed array', async () => {
    const { fs, b } = await newBuilder();
    const first = await b.build(live());
    const second = await b.build(live());
    expect(second.todos).toBe(first.todos); // same reference => no re-read/re-filter
    fs.bump(TODOS);
    const third = await b.build(live());
    expect(third.todos).not.toBe(first.todos);
    expect(third.todos.map((t) => t.id)).toEqual(first.todos.map((t) => t.id));
  });

  test('notes, squad and unread merge from board, roster, herdr and task agents', async () => {
    const { b } = await newBuilder();
    const taskAgents: SquadAgent[] = [
      { name: 'impl-auth', persona: 'implementer', state: 'running', source: 'task', item: 't2' },
    ];
    const herdrStdout = JSON.stringify({
      ok: true,
      agents: [
        { pane_id: 'pane-1', agent: 'impl-auth', status: 'working' },
        { pane_id: 'pane-2', agent: 'veri-auth', status: 'idle' },
      ],
    });
    const snap = await b.build(live({ lastSeenSeq: 1, taskAgents, herdrStdout, now: FIXTURE_EPOCH_MS + 5000 }));
    // notes: other-channel lines dropped, sorted by seq, ts normalised
    expect(snap.notes.map((n) => n.seq)).toEqual([1, 2, 3]);
    expect(snap.notes[1]!.channel).toBe(LEAD);
    expect(snap.notes[1]!.ts).toBe(new Date(FIXTURE_EPOCH_MS + 1000).toISOString());
    // unread: seq>1, not the lead's own, to all or to the lead
    expect(snap.unread).toBe(1);
    // squad: task agent wins the name clash and borrows colony info; lead excluded
    const impl = snap.squad.find((s) => s.name === 'impl-auth');
    expect(impl?.source).toBe('task');
    expect(impl?.state).toBe('running');
    expect(impl?.lastNoteTs).toBeDefined();
    const veri = snap.squad.find((s) => s.name === 'veri-auth');
    expect(veri?.source).toBe('colony');
    expect(veri?.state).toBe('idle');
    expect(veri?.persona).toBe('verifier');
    expect(snap.squad.find((s) => s.name === LEAD)).toBeUndefined();
  });

  test('live pass-throughs land on every snapshot field', async () => {
    const { b } = await newBuilder();
    const snap = await b.build(live({ headerMisses: 2, now: FIXTURE_EPOCH_MS + 5000 }));
    expect(snap.tokens).toBe(15000);
    expect(snap.costUsd).toBe(0.05);
    expect(snap.contextPct).toBe(12);
    expect(snap.headerMisses).toBe(2);
    expect(snap.now).toBe(FIXTURE_EPOCH_MS + 5000);
  });

  test('no .atlas root: idle snapshot, never throws', async () => {
    const fs = memFs({
      [`${PLUGIN}/contracts/operating-contract.json`]: JSON.stringify(FIXTURE_CONTRACT),
      [`${PLUGIN}/agents/implementer.md`]: IMPL_MD,
    });
    const b = new SnapshotBuilder(fs, PLUGIN);
    await b.init('/nowhere/deep', {}, 'def45678', 'tech-tools', 'main');
    const snap = await b.build(live({ headerPhase: 'implement', headerMisses: 2, now: FIXTURE_EPOCH_MS + 5000 }));
    expect(snap).toEqual(makeSnapshot({
      root: null,
      sessionId: 'def45678',
      channel: null,
      personas: [{ name: 'implementer', model: 'sonnet', effort: 'medium', color: 'green', description: 'Implements one bounded change.' }],
      todos: [],
      counts: {
        done: 0,
        total: 0,
        byPhase: Object.fromEntries(FIXTURE_CONTRACT.todoPhases.map((p) => [p, { done: 0, total: 0 }])),
      },
      phase: 'research', // header phase is ignored with no root
      phaseSource: 'default',
      notes: [],
      members: [],
      squad: [],
      unread: 0,
      tokens: 15000,
      costUsd: 0.05,
      contextPct: 12,
      headerMisses: 2,
      now: FIXTURE_EPOCH_MS + 5000,
    }));
  });
});