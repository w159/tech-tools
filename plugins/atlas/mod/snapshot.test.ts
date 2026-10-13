// Tests for mod/snapshot.ts under the claude-code testing kit.
// Covers: root/lead-channel resolution, session filter + counts, phase
// precedence (header > todo > default), instance-held mtime cache, notes/
// roster/squad merge, live pass-throughs, and the no-root idle snapshot.
import { describe, expect, test } from 'claude-code/testing';
import type { SquadAgent, TodoItem } from './contract';
import { FIXTURE_CONTRACT, FIXTURE_EPOCH_MS, memFs, makeSnapshot } from './test_helpers';
import { SnapshotBuilder } from './snapshot';
import { EMPTY_ORCH, onComplete, onSpawn, onToolEnd, onToolStart, type WtRow } from './data/orchestration';

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
    taskAgents: [] as SquadAgent[],
    herdrStdout: undefined as string | undefined,
    usage: { contextPct: 12 } as { contextPct: number | null },
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

  test('filter: own session plus the open backlog of any session, never archived', async () => {
    const { b } = await newBuilder();
    const snap = await b.build(live());
    expect(snap.todos.map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(snap.todos.every((t) => !t.archived)).toBe(true);
    expect(snap.todos.find((t) => t.id === 't3')?.phase).toBeUndefined(); // unphased stays unphased
  });

  test('counts: done/total and per-phase buckets over the session slice', async () => {
    const { b } = await newBuilder();
    const snap = await b.build(live());
    expect(snap.counts).toEqual({
      done: 0,
      total: 4,
      byPhase: {
        research: { done: 0, total: 1 }, // t3/t4 are unphased: totals only, no phase bucket
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

  test('notes and squad merge from board, roster, herdr and task agents', async () => {
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
    const snap = await b.build(live({ taskAgents, herdrStdout, now: FIXTURE_EPOCH_MS + 5000 }));
    // notes: other-channel lines dropped, sorted by seq, ts normalised
    expect(snap.notes.map((n) => n.seq)).toEqual([1, 2, 3]);
    expect(snap.notes[1]!.channel).toBe(LEAD);
    expect(snap.notes[1]!.ts).toBe(new Date(FIXTURE_EPOCH_MS + 1000).toISOString());
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

  test('roster is re-read on every build: a new member appears, a read error keeps the last roster', async () => {
    const { fs, b } = await newBuilder();
    expect((await b.build(live())).members.map((m) => m.name)).not.toContain('late-joiner');
    const channels = `${ROOT}/.atlas/.run/channels.json`;
    fs.write(channels, JSON.stringify({ channels: { [LEAD]: { members: [{ name: 'late-joiner', role: 'atlas:implementer' }, { name: LEAD, role: 'lead' }] } } }));
    expect((await b.build(live())).members.map((m) => m.name)).toEqual(['late-joiner', LEAD]);
    const broken = { ...fs, read: async (p: string) => { if (p === channels) throw new Error('boom'); return fs.read(p); } };
    const keep = new SnapshotBuilder(broken, PLUGIN);
    await keep.init(CWD, {}, SESSION, 'tech-tools', 'main');
    expect((await keep.build(live())).members.length).toBe(0); // never throws
  });

  test('live pass-throughs land on every snapshot field', async () => {
    const { b } = await newBuilder();
    const snap = await b.build(live({ now: FIXTURE_EPOCH_MS + 5000 }));
    expect(snap.contextPct).toBe(12);
    expect(snap.now).toBe(FIXTURE_EPOCH_MS + 5000);
  });

  test('no .atlas root: idle snapshot, never throws', async () => {
    const fs = memFs({
      [`${PLUGIN}/contracts/operating-contract.json`]: JSON.stringify(FIXTURE_CONTRACT),
      [`${PLUGIN}/agents/implementer.md`]: IMPL_MD,
    });
    const b = new SnapshotBuilder(fs, PLUGIN);
    await b.init('/nowhere/deep', {}, 'def45678', 'tech-tools', 'main');
    const snap = await b.build(live({ headerPhase: 'implement', now: FIXTURE_EPOCH_MS + 5000 }));
    expect({ ...snap }).toEqual({
      ...makeSnapshot({
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
      contextPct: 12,
      now: FIXTURE_EPOCH_MS + 5000,
    }),
    activity: { lead: { tool: null, since: FIXTURE_EPOCH_MS + 5000, toolCount: 0, tokens: null, mood: 'idle', lastLine: '' } },
    comms: [],
    todoGroups: [],
    });
  });

  test('orchestration: orch events and wt rows feed activity and comms', async () => {
    const { b } = await newBuilder();
    let orch = onSpawn(EMPTY_ORCH, 'a1', 'edit auth', FIXTURE_EPOCH_MS);
    orch = onToolStart(orch, 'a1', 'Edit', FIXTURE_EPOCH_MS + 1000);
    orch = onToolEnd(orch, 'a1', FIXTURE_EPOCH_MS + 2000);
    orch = onComplete(orch, 'a1', { reason: 'answer', answer: 'done editing', tokens: 900 }, FIXTURE_EPOCH_MS + 3000);
    const wt: WtRow[] = [{ agent: 'impl-auth', branch: 'worker/impl-auth', worktree: null, ahead: 0, behind: 0, dirty: false, verified_finding: 'f1', merged: true }];
    const squad: SquadAgent[] = [{ name: 'impl-auth', persona: 'implementer', state: 'finished', source: 'task' }];
    const snap = await b.build(live({ orch, names: { a1: 'impl-auth' }, listed: [{ id: 'a1', status: 'completed' }], taskAgents: squad, wt, now: FIXTURE_EPOCH_MS + 4000 }));
    expect(snap.activity['impl-auth']).toMatchObject({ toolCount: 1, tokens: 900, mood: 'done', lastLine: 'done editing' });
    expect(snap.comms.map((c) => c.kind)).toEqual(expect.arrayContaining(['dispatch', 'report', 'merge']));
  });

  test('todoGroups: unsorted holds only session-origin unphased items; other-session backlog without a phase and advisor notes stay out', async () => {
    const { fs, b } = await newBuilder();
    await fs.write(TODOS, JSON.stringify({
      version: 1,
      items: [
        { id: 't1', content: '[research] map mod surface', status: 'pending', session_id: SESSION },
        { id: 't3', content: 'write guard', status: 'in_progress', session_id: 'other-session', owner: 'impl-auth', origin: 'manual' },
        { id: 't4', content: 'unphased mine', status: 'pending', session_id: SESSION, origin: 'session' },
        { id: 'a1', content: 'advisor[concern]: watch the pids', status: 'pending', session_id: SESSION, origin: 'advisor' },
        { id: 't5', content: '[verify] done thing', status: 'completed', session_id: SESSION, archived: true },
      ],
    }));
    const snap = await b.build(live());
    expect(snap.todoGroups.map((g) => g.phase)).toEqual(['research', 'unsorted', 'advisor']);
    expect(snap.todoGroups.find((g) => g.phase === 'unsorted')?.items.map((i) => i.id)).toEqual(['t4']);
    expect(snap.todoGroups.find((g) => g.phase === 'advisor')).toMatchObject({ dept: 'ADVISOR NOTES', total: 1 });
    expect(snap.todoGroups.find((g) => g.phase === 'research')).toMatchObject({ dept: 'ARCHIVE', total: 1 });
    expect(snap.todoGroups.flatMap((g) => g.items.map((i) => i.id))).not.toContain('t5');
  });

  test('raw agent ids in notes/comms/activity resolve to labels', async () => {
    const { fs, b } = await newBuilder();
    await fs.write(BOARD, [
      line({ seq: 1, ts: FIXTURE_EPOCH_MS, owner: 'a529730494759bac3', to: 'a1b2c3d4e5f60718a', text: 'ping peer' }),
      line({ seq: 2, ts: FIXTURE_EPOCH_MS + 1, owner: LEAD, to: 'a529730494759bac3', text: 'go ahead' }),
      '',
    ].join('\n'));
    const snap = await b.build(live({ names: { a529730494759bac3: 'explorer' } }));
    const peer = snap.comms.find((c) => c.text === 'ping peer');
    expect(peer).toMatchObject({ from: 'explorer', to: 'worker' }); // unmapped raw id: never hex, the label `worker`
    expect(snap.comms.find((c) => c.text === 'go ahead')).toMatchObject({ from: 'lead', to: 'explorer' });
    expect(JSON.stringify([snap.comms, snap.activity])).not.toMatch(/a[0-9a-f]{16}/);
  });
});