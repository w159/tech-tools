// Slice A1/A2: one always-visible working signal. The band's spinner turns whenever the host turn runs (a lead-only turn lists no worker),
// the tick stops when nothing works, and the band's own words (`N running`) never appear without a spinner glyph beside them.
import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';
import { isWorkingNow } from './register';
import type { LiveSnapshot } from './orchestra-types';

const CONTRACT = JSON.stringify({
  phases: ['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done', 'blocked'].map((id) => ({ id, glyph: '.' })),
  todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'],
  headerFirstLinePattern: '^ATLAS',
  itemPhasePrefix: '[<phase>] ',
});
const T0 = 1_800_000_000_000;
const SPIN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u;

/** Boot the real module with an empty board and NO listed worker: the lead is the only thing that can be working. */
function boot(on: On, agents: unknown[] = []) {
  const clock = mock.clock(on, { now: T0 });
  mock.env(on, { ATLAS_PROJECT_ROOT: '/repo' });
  const board = JSON.stringify({ version: 1, items: [] });
  on('session.id', async () => ({ value: 'abcdef-0000' }) as never);
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on('ui.log', async () => ({ value: undefined }) as never);
  on('fs.exists', async (_$, e) => ({ value: String((e as { path: string }).path).endsWith('/.atlas') }) as never);
  on('fs.read', async (_$, e) => {
    const path = String((e as { path: string }).path);
    if (path.endsWith('/contracts/operating-contract.json')) return { value: CONTRACT } as never;
    if (path.endsWith('/.atlas/.run/todos.json')) return { value: board } as never;
    throw new Error('no such file');
  });
  on('fs.stat', async (_$, e) => {
    if (String((e as { path: string }).path).endsWith('/.atlas/.run/todos.json')) return { value: { size: board.length, mtimeMs: 1 } } as never;
    throw new Error('no such file');
  });
  on('fs.list', async () => ({ value: [] }) as never);
  on('agent.list', async () => ({ value: agents }) as never);
  on('command.register', async (_$, e) => ({ value: { command: (e as { name: string }).name } }) as never);
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never);
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never);
  on('ui.toast', async () => ({ value: undefined }) as never);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  return clock;
}

type Mounted = Awaited<ReturnType<Engine['ui']['mount']>>;
const mountBand = ($: Engine, isWorking: boolean, cols = 150): Promise<Mounted> =>
  $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { bodyColumns: cols, hasSurvey: false, isWorking, maxRows: 3 } as never }) as unknown as Promise<Mounted>;
const text = async (ui: Mounted): Promise<string> => {
  const nodes = (await ui.findAll({})) as { props?: { children?: unknown } }[];
  return nodes.map((n) => (typeof n.props?.children === 'string' ? n.props.children : '')).join('');
};
const spinOf = (s: string): string => s.match(SPIN)?.[0] ?? '';

test('A1 a lead-only working turn turns the band spinner over three ticks', async ($, on) => {
  const clock = boot(on);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const ui = await mountBand($, true);
  const first = await text(ui);
  expect(first).toContain('working');
  const seen = new Set<string>([spinOf(first)]);
  for (let i = 0; i < 3; i++) {
    await clock.advance(100);
    seen.add(spinOf(await text(ui)));
  }
  expect(seen.has('')).toBe(false);
  expect(seen.size).toBeGreaterThanOrEqual(3); // three ticks, three different frames
  await ui.unmount();
});

test('A1 an idle snapshot has no tick: the band does not change and does not claim to work', async ($, on) => {
  const clock = boot(on);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const ui = await mountBand($, false);
  const first = await text(ui);
  await clock.advance(1000);
  expect(await text(ui)).toBe(first);
  expect(first).not.toMatch(SPIN);
  expect(first).not.toContain('working');
  await ui.unmount();
});

// The pure rule the tick and the band share (these run without the kit's engine).
const snap = (over: Record<string, unknown> = {}): LiveSnapshot => ({ now: T0, todos: [], squad: [], members: [], activity: {}, ...over }) as never;

test('A1 the tick rule: a host turn alone is working, even with no listed worker and no plan', () => {
  expect(isWorkingNow(snap(), true)).toBe(true);
});
test('A1 the tick rule: a lead mid-turn is working without the host flag', () => {
  expect(isWorkingNow(snap({ activity: { lead: { mood: 'working' } } }), false)).toBe(true);
  expect(isWorkingNow(snap({ activity: { lead: { mood: 'thinking' } } }), false)).toBe(true);
});
test('A1 the tick rule: an idle snapshot is not working, so the tick stops and nothing redraws', () => {
  expect(isWorkingNow(snap(), false)).toBe(false);
  expect(isWorkingNow(snap({ activity: { lead: { mood: 'idle' } } }), false)).toBe(false);
});
