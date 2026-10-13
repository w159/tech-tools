// A plain Agent-tool subagent (no `name` on agent.spawn; the dispatch puts `name: <label>` on the prompt's first
// line, as the live run showed) reaches the snapshot as one working worker under that label, and the channel header counts it.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements, EngineInterface, On } from 'claude-code';
import { liveWorkers } from './data/live';
import type { LiveSnapshot } from './orchestra-types';
import { channelRows } from './pane/sidebar-channel';
import type { SidebarHandlers } from './pane/sidebar-types';
import { promptName } from './routing';
import { register } from './register';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;

async function run(prompt: string, status: string): Promise<LiveSnapshot> {
  const handlers: { event: string; matcher: Record<string, unknown>; hook: AnyHandler }[] = [];
  const on = ((event: string, a: unknown, b?: unknown) => {
    handlers.push({ event, matcher: b === undefined ? {} : (a as Record<string, unknown>), hook: (b ?? a) as AnyHandler });
    return { catch() {} };
  }) as unknown as On;
  const listed: { id: string; type: string; description: string; status: string }[] = [];
  const ticks: (() => void)[] = [];
  let sig = 0;
  const $ = {
    state: memState(),
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => 1_760_000_000_000, every: (_ms: number, fn: () => void) => (ticks.push(fn), { cancel() {} }), after: () => ({ cancel() {} }), sleep: async () => {} },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    session: { id: async () => 'sess-live' },
    fs: { read: async () => { throw new Error('no fs'); }, stat: async () => ({ size: ++sig, mtimeMs: sig }), exists: async (p: string) => p === '/tmp/proj/.atlas', list: async () => [] },
    command: { register: async () => {} },
    ui: { log: () => {}, invalidate: () => {}, open: async () => ({ isPlaced: true }), close: async () => {} },
    agent: { list: async () => listed },
  } as unknown as EngineInterface;
  const fire = (name: string, e: unknown, next: AnyNext = async (i) => i) => {
    const fields = e as Record<string, unknown>;
    return Promise.all(handlers.filter((h) => h.event === name && Object.entries(h.matcher).every(([k, v]) => fields[k] === v)).map((h) => h.hook($, e, next)));
  };
  await register(on, {});
  await fire('session.start', { cwd: '/tmp/proj', surface: 'terminal', isInteractive: true });
  await fire('agent.spawn', { tool_use_id: 't1', prompt, description: 'slow scan', subagentType: 'atlas:explorer', fork: false }, async () => {
    listed.push({ id: 'a1', type: 'atlas:explorer', description: 'slow scan', status });
    return { model: 'm', agentId: 'a1' };
  });
  ticks[0]?.();
  for (let i = 0; i < 400; i++) await Promise.resolve();
  const snap = (await $.state.get({ plugin: 'atlas', key: 'snapshot' } as never)).value as LiveSnapshot | undefined;
  if (snap === undefined) throw new Error('no snapshot');
  return snap;
}

describe('a listed running subagent', () => {
  test('promptName reads the first-line label', () => {
    expect(promptName('name: probe-slow\nTOOLS: Bash')).toBe('probe-slow');
    expect(promptName('TOOLS: Bash\nname: nope')).toBeUndefined();
  });

  test('is one working worker under the dispatch name, counted as a channel nick', async () => {
    const snap = await run('name: probe-slow\nTASK: sleep', 'running');
    const ws = liveWorkers(snap, 1_760_000_000_000);
    expect(ws.map((w) => [w.name, w.state])).toEqual([['probe-slow', 'working']]);

    const mk = (kind: string) => (props: Record<string, unknown>) => ({ kind, props });
    const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
    type Node = { kind: string; props: { children?: unknown } };
    const textOf = (n: Node): string => {
      const c = n.props.children;
      return n.kind === 'Text' ? String(c ?? '') : (Array.isArray(c) ? c : c == null ? [] : [c]).map((x) => textOf(x as Node)).join('');
    };
    const rows = channelRows(els, { snapshot: snap, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'channel' }, columns: 80, rows: 20 }, {} as SidebarHandlers, 78);
    expect(textOf(rows[0] as unknown as Node)).toContain('1 nicks');
  });
});
