// L19 under bun: the board key's real path without the host engine. register()'s own AbovePrompt hook draws the band, the
// test presses the band's real `o` Button, and the recorded engine must see `ui.open` for the Board pane; the Pane hook then draws
// the board from todos.json. (mod/board-key.test.ts runs the same path through the host kit under `claude plugin test`.)
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { register, resetCore } from './register';
import { memState } from './test_helpers';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
const noopNext: AnyNext = async (input) => input;

function captureOn() {
  const handlers: { event: string; matcher: Record<string, unknown> | undefined; hook: AnyHandler }[] = [];
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const matcher = maybeHook === undefined ? undefined : (hookOrMatcher as Record<string, unknown>);
    handlers.push({ event, matcher, hook: (maybeHook ?? hookOrMatcher) as AnyHandler });
    return { catch() {} };
  }) as unknown as On;
  const one = (event: string, key?: [string, unknown]): AnyHandler => {
    const found = handlers.find((h) => h.event === event && (key === undefined || h.matcher?.[key[0]] === key[1]));
    if (!found) throw new Error(`no ${event} handler`);
    return found.hook;
  };
  return { on, one };
}

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const fakeEls = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') };
const kidsOf = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const walk = (n: Node): Node[] => [n, ...kidsOf(n).flatMap(walk)];
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kidsOf(n).map(textOf).join(''));
const settle = async (): Promise<void> => { for (let i = 0; i < 2000; i++) await Promise.resolve(); };

const ROOT = '/tmp/board-proj';
const RUN = `${ROOT}/.atlas/.run`;
const TODOS = JSON.stringify({
  version: 1,
  items: [
    { id: 'a', content: 'Wire band to host', status: 'completed', owner: 'implementer-layout', session_id: '', claimed_at: 100, completed_at: 290, origin: 'session' },
    { id: 'b', content: 'Subagents block', status: 'in_progress', owner: 'implementer-band', session_id: '', origin: 'session' },
    { id: 'c', content: 'Ship board mod', status: 'blocked', owner: 'you', session_id: '', origin: 'session' },
  ],
});

function stubEngine() {
  const files: Record<string, string> = { [`${ROOT}/.git`]: '', [`${RUN}/todos.json`]: TODOS };
  const rec = { opens: [] as { id: string; title?: string; focus?: boolean; closeOnEscape?: boolean }[], toasts: [] as string[] };
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => 1_900_000_000_000, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }), sleep: async () => {} },
    session: { id: async () => 'sess-abc123def456' },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    fs: {
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('missing'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('missing'); return { size: files[p]!.length, mtimeMs: 1 }; },
      exists: async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
      list: async (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]!))].map((name) => ({ name })),
    },
    agent: { list: async () => [] },
    state: memState(),
    audio: { play: async () => {} },
    ui: {
      log: () => {}, invalidate: () => {}, status: () => {}, resolve: () => fakeEls,
      open: async (args: { id: string }) => { rec.opens.push(args); return { isPlaced: true as const }; },
      toast: (t: string) => { rec.toasts.push(t); },
    },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  return { $: $ as unknown as EngineInterface, rec };
}

async function boot() {
  const s = stubEngine();
  const cap = captureOn();
  resetCore();
  await register(cap.on, {});
  await cap.one('session.start')(s.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
  await settle();
  return { ...s, cap };
}
const band = async (b: Awaited<ReturnType<typeof boot>>, columns = 160): Promise<Node> =>
  (await b.cap.one('ui.render', ['component', 'AbovePrompt'])(b.$, { surface: 'terminal', props: { hasSurvey: false, bodyColumns: columns, maxRows: 12 } }, async () => fakeEls.Text({ children: 'prompt' }))) as Node;
const pane = async (b: Awaited<ReturnType<typeof boot>>, requestId: string, columns = 120): Promise<Node> =>
  (await b.cap.one('ui.render', ['component', 'Pane'])(b.$, { surface: 'terminal', requestId, props: { bodyColumns: columns, scroll: { bodyRows: 30 } } }, noopNext)) as Node;

describe('L19: the board key opens the Board pane', () => {
  test('the band `o` Button calls ui.open for atlas-board with focus and Esc-to-close', async () => {
    const b = await boot();
    const tree = await band(b);
    const key = walk(tree).find((n) => n.kind === 'Button' && n.props.key === 'band:board');
    expect(key?.props.hotkey).toBe('o');
    key!.props.onPress();
    await settle();
    expect(b.rec.opens.filter((o) => o.id === 'atlas-board')).toEqual([{ id: 'atlas-board', title: 'Board', rows: 14, closeOnEscape: true, focus: true }]);
    expect(b.rec.opens.some((o) => o.id === 'atlas')).toBe(false); // the Atlas pane is not what the key opens
  });
  test('the Pane hook for atlas-board draws the ribbon, the header and one row per todo', async () => {
    const b = await boot();
    const text = textOf(await pane(b, 'atlas-board'));
    for (const want of ['BOARD', '3 items', 'ITEM', 'STATE', 'OWNER', 'DETAIL', 'Wire band to host', 'done', 'ran 03:10', 'Subagents block', 'implementer-band', 'Ship board mod', 'blocked']) expect(text).toContain(want);
  });
  test('the Atlas pane (requestId atlas) is still the sidebar, not the board', async () => {
    const b = await boot();
    const text = textOf(await pane(b, 'atlas', 56));
    expect(text).not.toContain('BOARD');
  });
  test('an empty board draws the ribbon and `(no state)`', async () => {
    const b = await boot();
    const snap = (await b.$.state.get({ plugin: 'atlas', key: 'snapshot' } as never)) as { value: { todos: unknown[] } };
    await b.$.state.set({ plugin: 'atlas', key: 'snapshot' } as never, { ...snap.value, todos: [] } as never);
    const text = textOf(await pane(b, 'atlas-board'));
    expect(text).toContain('BOARD');
    expect(text).toContain('(no state)');
  });
});
