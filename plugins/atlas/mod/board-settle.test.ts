// S1 through the real snapshot build: the explorers finish, their dispatch rows stay pending in todos.json, and every
// surface (band count, board, side panel) must read them as ended (not done) or failed, so the screen and the store agree. The fix is at the one place the todos enter the snapshot.
import { describe, expect, test } from 'claude-code/testing';
import type { SquadAgent } from './contract';
import { planCounts } from './data/todos';
import { SnapshotBuilder } from './snapshot';
import { FIXTURE_CONTRACT, FIXTURE_EPOCH_MS, memFs } from './test_helpers';

const ROOT = '/r';
const PLUGIN = '/plugin';
const SESSION = 'abc12345';
const row = (id: string, owner: string, extra: Record<string, unknown> = {}) => ({ id, content: `explore ${owner}`, status: 'pending', origin: 'dispatch', owner, session_id: SESSION, ...extra });

async function build(taskAgents: SquadAgent[], items: unknown[]) {
  const fs = memFs({
    [`${PLUGIN}/contracts/operating-contract.json`]: JSON.stringify(FIXTURE_CONTRACT),
    [`${ROOT}/.atlas`]: '',
    [`${ROOT}/.atlas/.run/todos.json`]: JSON.stringify({ version: 1, items }),
  });
  const b = new SnapshotBuilder(fs, PLUGIN);
  await b.init(ROOT, {}, SESSION, 'tech-tools', 'main');
  return b.build({ headerPhase: null, taskAgents, herdrStdout: undefined, usage: { contextPct: 12 }, now: FIXTURE_EPOCH_MS });
}
const agent = (name: string, state: SquadAgent['state']): SquadAgent => ({ name, persona: 'explorer', state, source: 'task' });

describe('dispatch rows follow their workers in the snapshot', () => {
  test('three explorers finish while the store still holds their rows open: the rows read ended (never done) and the count stays 0 of 3', async () => {
    const snap = await build(
      ['alpha', 'beta', 'gamma'].map((n) => agent(`${n}-explorer`, 'finished')),
      ['alpha', 'beta', 'gamma'].map((n, i) => row(`d${i}`, `${n}-explorer`)),
    );
    expect(snap.todos.map((t) => t.status)).toEqual(['ended', 'ended', 'ended']);
    expect(planCounts(snap.todos, SESSION)).toEqual({ done: 0, total: 3 });
    expect(snap.counts.done).toBe(0);
  });
  test('a row the store completed stays done', async () => {
    const snap = await build([agent('a', 'finished')], [row('d1', 'a', { status: 'completed' })]);
    expect(snap.todos.map((t) => t.status)).toEqual(['completed']);
  });
  test('a failed worker leaves a failed row; a running one leaves its row as written', async () => {
    const snap = await build([agent('a', 'failed'), agent('b', 'running')], [row('d1', 'a'), row('d2', 'b', { status: 'in_progress' })]);
    expect(snap.todos.map((t) => t.status)).toEqual(['failed', 'in_progress']);
  });
});
