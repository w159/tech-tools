// L19: the board key `o` opened nothing. Through the claude-code/testing kit the real hooks module boots on a fake board,
// the band and the sidebar are drawn by the real render hooks, the key is pressed on the real Button, and the engine must
// receive `ui.open` for the board pane, which then draws the board from the board's own todos.
import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';

const CONTRACT = JSON.stringify({
  phases: ['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done', 'blocked'].map((id) => ({ id, glyph: '.' })),
  todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'],
  headerFirstLinePattern: '^ATLAS',
  itemPhasePrefix: '[<phase>] ',
});
const TODOS = JSON.stringify({
  version: 1,
  items: [
    { id: 'a', content: 'Wire band to host', status: 'completed', owner: 'implementer-layout', session_id: '', claimed_at: 100, completed_at: 290, origin: 'session' },
    { id: 'b', content: 'Subagents block', status: 'in_progress', owner: 'implementer-band', session_id: '', origin: 'session' },
    { id: 'c', content: 'Gate tests', status: 'pending', owner: 'runner-land', session_id: '', origin: 'session' },
    { id: 'd', content: 'Ship board mod', status: 'blocked', owner: 'you', session_id: '', origin: 'session' },
  ],
});

type Opened = { id: string; title?: string; focus?: boolean; closeOnEscape?: boolean };

async function boot(on: On, opens: Opened[]) {
  mock.clock(on);
  mock.env(on, { ATLAS_PROJECT_ROOT: '/repo' });
  on('session.id', async () => ({ value: 'abcdef-0000' }) as never);
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on('ui.log', async () => ({ value: undefined }) as never);
  on('fs.exists', async (_$, e) => ({ value: String((e as { path: string }).path).endsWith('/.atlas') }) as never);
  on('fs.read', async (_$, e) => {
    const path = String((e as { path: string }).path);
    if (path.endsWith('/contracts/operating-contract.json')) return { value: CONTRACT } as never;
    if (path.endsWith('/.atlas/.run/todos.json')) return { value: TODOS } as never;
    throw new Error('no such file');
  });
  on('fs.stat', async (_$, e) => {
    if (String((e as { path: string }).path).endsWith('/.atlas/.run/todos.json')) return { value: { size: TODOS.length, mtimeMs: 1 } } as never;
    throw new Error('no such file');
  });
  on('fs.list', async () => ({ value: [] }) as never);
  on('agent.list', async () => ({ value: [] }) as never);
  on('command.register', async (_$, e) => ({ value: { command: (e as { name: string }).name } }) as never);
  on('ui.open', async (_$, e) => { opens.push(e as Opened); return { value: { isPlaced: true } } as never; });
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never);
  on('ui.toast', async () => ({ value: undefined }) as never);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never); // the host's own AbovePrompt
}

const drawn = async (ui: { drawn: unknown; findAll(q: object): Promise<{ text?: string }[]> }): Promise<string> => JSON.stringify([ui.drawn, (await ui.findAll({})).map((n) => n.text)]);
const settle = async (): Promise<void> => { for (let i = 0; i < 200; i++) await Promise.resolve(); };

test('the band board key opens the board pane, and the pane draws the board', async ($, on) => {
  const opens: Opened[] = [];
  await boot(on, opens);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const band = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { bodyColumns: 160, hasSurvey: false, maxRows: 12 } as never });
  const key = await band.find({ key: 'band:board' });
  expect(key?.props.hotkey).toBe('o');
  opens.length = 0;
  await band.press({ key: 'band:board' });
  await settle();
  const board = opens.filter((o) => o.id === 'atlas-board');
  expect(board).toHaveLength(1);
  expect(board[0]).toMatchObject({ title: 'Board', focus: true, closeOnEscape: true });
  const pane = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas-board', props: { title: 'Board', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never });
  const text = await drawn(pane);
  for (const want of ['BOARD', '4 items', 'ITEM', 'STATE', 'OWNER', 'DETAIL', 'Wire band to host', 'ran 03:10', 'Subagents block', 'implementer-band', 'Gate tests', 'queued', 'Ship board mod', 'blocked']) expect(text).toContain(want);
});

test('the sidebar board key opens the same pane', async ($, on) => {
  const opens: Opened[] = [];
  await boot(on, opens);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const side = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { title: 'Atlas', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never });
  expect((await side.find({ key: 'tab:todos' }))?.props.hotkey).toBe('o');
  opens.length = 0;
  await side.press({ key: 'tab:todos' });
  await settle();
  expect(opens.map((o) => o.id)).toEqual(['atlas-board']);
});

test('pressing the key again keeps one board pane (one per id) and the Atlas pane is left alone', async ($, on) => {
  const opens: Opened[] = [];
  await boot(on, opens);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const band = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: { bodyColumns: 160, hasSurvey: false, maxRows: 12 } as never });
  opens.length = 0;
  await band.press({ key: 'band:board' });
  await band.press({ key: 'band:board' });
  await settle();
  expect(opens.map((o) => o.id)).toEqual(['atlas-board', 'atlas-board']);
});
