// Critique 14 B3 wiring: the rebuild that moves a worker's HUD row to done also places its transcript card, in the same call and the same
// injected clock reading, so the card cannot trail the HUD row (live: 5.07 s against 1.03 s when the host's own notification row was the card).
import { expect, test } from 'claude-code/testing';
import type { AgentInfo, EngineInterface, On } from 'claude-code';
import { rebuild, register, resetCore } from './register';
import { forgetPlaced } from './transcript/placed';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
const noopNext: AnyNext = async (input) => input;
const settle = async (): Promise<void> => { for (let i = 0; i < 2000; i++) await Promise.resolve(); };

const ROOT = '/tmp/proj-card';
const NOW = 1_910_000_000_000;

function stub(rows: () => AgentInfo[], placed: { id: string; at: number }[], clock: { now: number }) {
  const files: Record<string, string> = { [`${ROOT}/.git`]: '', [`${ROOT}/.atlas/.run/todos.json`]: '{"items":[]}' };
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => clock.now, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }), sleep: async () => {} },
    session: { id: async () => 'sess-card' },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    fs: {
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('missing'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('missing'); return { size: files[p]!.length, mtimeMs: 0 }; },
      exists: async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
      list: async (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]!))].map((name) => ({ name })),
    },
    agent: { list: async () => rows() },
    state: memState(),
    audio: { play: async () => {} },
    ui: {
      log: () => {}, invalidate: () => {}, open: async () => ({ isPlaced: true as const }), toast: () => {}, resolve: () => ({}), status: () => {},
      place: async ({ id }: { id: string }) => { placed.push({ id, at: clock.now }); return { isPlaced: true as const, requestId: id }; },
    },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  return $ as unknown as EngineInterface;
}

test('the rebuild that shows a worker done places its finish card at that same clock reading, once', async () => {
  forgetPlaced();
  resetCore();
  let status = 'running';
  const rows = (): AgentInfo[] => [{ id: 'a1', type: 'atlas:explorer', description: 'alpha-explorer', status, name: 'alpha-explorer' } as AgentInfo];
  const placed: { id: string; at: number }[] = [];
  const clock = { now: NOW };
  const $ = stub(rows, placed, clock);
  const handlers: { event: string; hook: AnyHandler }[] = [];
  const on = ((event: string, a: unknown, b?: unknown) => { handlers.push({ event, hook: (b ?? a) as AnyHandler }); return { catch() {} }; }) as unknown as On;
  await register(on, {});
  await handlers.find((h) => h.event === 'session.start')!.hook($, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
  await settle();
  // what agent.spawn records for the worker: its activity, stage and label under the host id
  const spawned = { activity: { a1: { tool: null, since: NOW, startedAt: NOW, toolCount: 0, tokens: null, mood: 'working', lastLine: '' } }, comms: [], stage: { a1: 'working' }, meta: { a1: { name: 'alpha-explorer', type: 'atlas:explorer', at: NOW } } };
  await ($.state.set as unknown as (k: unknown, v: unknown) => Promise<unknown>)({ plugin: 'atlas', key: 'orch' }, spawned);
  await rebuild($);
  expect(placed).toEqual([]); // running: no card
  status = 'completed';
  clock.now = NOW + 1000; // the poll tick one second later
  await rebuild($);
  await settle();
  expect(placed.map((p) => p.id)).toHaveLength(1);
  expect(placed[0]!.id).toMatch(/^done-.*-1$/);
  expect(placed[0]!.at).toBe(NOW + 1000); // stamped in the build that carries the finish, not when the lead takes the notification up
  await rebuild($); // a further build with nothing new places nothing
  await settle();
  expect(placed).toHaveLength(1);
  forgetPlaced();
});
