// B2 and B5 through the claude-code/testing kit. The kit has no process, so the old hostEnv() read is empty there: a surface that
// honoured NO_COLOR or ATLAS_ASCII only through a process global would ignore mock.env. Every surface below must follow the one
// `$.env` read (mod/look.ts). B5: the HUD and the board count elapsed from the snapshot clock, not Date.now().
import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

const CONTRACT = JSON.stringify({
  phases: ['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done', 'blocked'].map((id) => ({ id, glyph: '.' })),
  todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'],
  headerFirstLinePattern: '^ATLAS',
  itemPhasePrefix: '[<phase>] ',
});
const AGENT = { id: 'aaaaaaaaaaaaaaaaa', teammateId: 'impl-a@s', type: 'atlas:implementer', description: 'edit pane', status: 'running' };

const T0 = 1_800_000_000_000; // the mocked clock's start, in ms
/** Boot the real module on a fake board; `todos` gets the mocked clock's epoch seconds. */
async function boot(on: On, env: Record<string, string>, todos: (nowSecs: number) => unknown[] = () => []) {
  const clock = mock.clock(on, { now: T0 });
  mock.env(on, { ATLAS_PROJECT_ROOT: '/repo', ...env });
  const board = JSON.stringify({ version: 1, items: todos(T0 / 1000) });
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
  on('agent.list', async () => ({ value: [AGENT] }) as never);
  on('command.register', async (_$, e) => ({ value: { command: (e as { name: string }).name } }) as never);
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never);
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never);
  on('ui.toast', async () => ({ value: undefined }) as never);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
  return clock;
}

/** Every node with its props and text, as one string. */
const drawn = async (ui: { findAll(q: object): Promise<unknown[]> }): Promise<string> => JSON.stringify(await ui.findAll({}));
const pane = async ($: Engine, requestId: string, title: string, tab?: string): Promise<string> => {
  const ui = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId, props: { title, isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never });
  if (tab) await ui.press({ key: `tab:${tab}` });
  const text = await drawn(ui);
  await ui.unmount();
  return text;
};
const hud = async ($: Engine): Promise<string> => {
  const ui = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { bodyColumns: 160, hasSurvey: false, maxRows: 30 } as never });
  const text = await drawn(ui);
  await ui.unmount();
  return text;
};
const colours = (s: string): number => (s.match(/#[0-9a-f]{6}/gi) ?? []).length;

test('B2 the side panel has colour and the worker row when NO_COLOR is unset (the NO_COLOR checks below are not vacuous)', async ($, on) => {
  await boot(on, {});
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const sideColour = await pane($, 'atlas', 'Atlas', 'team');
  expect(colours(sideColour)).toBeGreaterThan(0);
  expect(sideColour).toContain('impl-a');
});

test('B2 NO_COLOR keeps the words and removes the colour on the side panel', async ($, on) => {
  await boot(on, { NO_COLOR: '1' });
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const side = await pane($, 'atlas', 'Atlas', 'team');
  expect(side).toContain('impl-a');
  expect(side).toContain('running');
  expect(colours(side)).toBe(0);
});

test('B2 NO_COLOR removes the colour from the board', async ($, on) => {
  await boot(on, { NO_COLOR: '1' }, () => [{ id: 'a', content: 'Wire it', status: 'pending', owner: 'x', session_id: '', origin: 'session' }]);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const board = await pane($, 'atlas-board', 'Board');
  expect(board).toContain('Wire it');
  expect(colours(board)).toBe(0);
});

test('B2 the board has colour when NO_COLOR is unset (the check above is not vacuous)', async ($, on) => {
  await boot(on, {}, () => [{ id: 'a', content: 'Wire it', status: 'pending', owner: 'x', session_id: '', origin: 'session' }]);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  expect(colours(await pane($, 'atlas-board', 'Board'))).toBeGreaterThan(0);
});

test('B2 ATLAS_ASCII from $.env draws the side panel and the board in plain ASCII', async ($, on) => {
  await boot(on, { ATLAS_ASCII: '1' }, () => [{ id: 'a', content: 'Wire it', status: 'completed', owner: 'x', session_id: '', origin: 'session' }]);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const side = await pane($, 'atlas', 'Atlas', 'team');
  const board = await pane($, 'atlas-board', 'Board');
  for (const [name, text] of [['side', side], ['board', board]] as const) {
    expect([name, /[◖◗◆●◐◓◑◒■▲◇━]/u.test(text)]).toEqual([name, false]);
  }
});

test('B2 without ATLAS_ASCII the same surfaces draw the unicode marks', async ($, on) => {
  await boot(on, {}, () => [{ id: 'a', content: 'Wire it', status: 'completed', owner: 'x', session_id: '', origin: 'session' }]);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  expect(await pane($, 'atlas', 'Atlas', 'team')).toContain('◆');
  expect(await pane($, 'atlas-board', 'Board')).toContain('●');
});

test('B5 the HUD and the board both read elapsed from the snapshot clock (claimed 42 s ago reads 00:42)', async ($, on) => {
  await boot(on, {}, (now) => [{ id: 'a', content: 'Wire it', status: 'in_progress', owner: 'impl-a', session_id: '', claimed_at: now - 42, origin: 'session' }]);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  expect(await hud($)).toContain('elapsed 00:42');
  expect(await pane($, 'atlas-board', 'Board')).toContain('elapsed 00:42');
});
