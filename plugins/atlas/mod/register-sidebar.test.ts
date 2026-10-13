// Sidebar through the claude-code/testing kit: the real hooks module boots on a fake board
// (one channel member), draws the Pane on 'terminal', and the test presses the member row,
// types into the msg Input and submits. The note argv must name that member and the draft clear.
import type { On } from 'claude-code';
import { expect, mock, test } from 'claude-code/testing';
import type { Engine } from 'claude-code/testing';

const CHANNELS = JSON.stringify({ channels: { 'lead-abcdef': { members: [{ name: 'impl-a', role: 'implementer' }] } } });

test('press a member, type, submit: the note goes to that member and the draft clears', async ($, on) => {
  const runs: string[][] = [];
  const toasts: string[] = [];
  mock.clock(on);
  mock.env(on, { ATLAS_PROJECT_ROOT: '/repo' });
  on('session.id', async () => ({ value: 'abcdef-0000' }) as never);
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on('ui.log', async () => ({ value: undefined }) as never);
  on('fs.exists', async (_$, e) => ({ value: String((e as { path: string }).path).endsWith('/.atlas') }) as never);
  on('fs.read', async (_$, e) => {
    const path = String((e as { path: string }).path);
    if (path.endsWith('/.atlas/.run/channels.json')) return { value: CHANNELS } as never;
    throw new Error('no such file');
  });
  on('fs.stat', async () => { throw new Error('no such file'); });
  on('fs.list', async () => ({ value: [] }) as never);
  on('agent.list', async () => ({ value: [{ id: 'aaaaaaaaaaaaaaaaa', teammateId: 'impl-a@s', type: 'atlas:implementer', status: 'running' }] }) as never);
  on('command.register', async (_$, e) => ({ value: { command: (e as { name: string }).name } }) as never);
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never);
  on('process.run', async (_$, e) => {
    runs.push([...(e as { argv: string[] }).argv]);
    return { value: { exitCode: 0, stdout: 'main', stderr: '' } } as never;
  });
  on('ui.toast', async (_$, e) => {
    toasts.push(String((e as { text?: string }).text ?? ''));
    return { value: undefined } as never;
  });
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const ui = await $.ui.mount({
    plugin: 'atlas',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'atlas',
    props: { title: 'Atlas', isFocused: true, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
  });
  await ui.press({ key: 'tab:team' }); // the pane opens on route
  await ui.press({ key: 'worker:impl-a' });
  await ui.input({ key: 'msg', text: 'ping', kind: 'change' });
  await ui.input({ key: 'msg', text: 'ping' });
  const note = runs.find((argv) => argv.includes('note'));
  expect(note).toBeDefined();
  expect(note?.slice(note.indexOf('--to'), note.indexOf('--to') + 2)).toEqual(['--to', 'impl-a']);
  expect(note?.at(-1)).toBe('ping');
  expect(toasts).toContain('Sent to impl-a');
  expect((await ui.find({ key: 'msg' }))?.text ?? '').toBe('');
});

/** Boot the real module on a fake board whose host agent list is `agents`. */
async function boot(on: On, agents: unknown[]) {
  const clock = mock.clock(on);
  mock.env(on, { ATLAS_PROJECT_ROOT: '/repo' });
  on('session.id', async () => ({ value: 'abcdef-0000' }) as never);
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on('ui.log', async () => ({ value: undefined }) as never);
  on('fs.exists', async (_$, e) => ({ value: String((e as { path: string }).path).endsWith('/.atlas') }) as never);
  on('fs.read', async () => { throw new Error('no such file'); });
  on('fs.stat', async () => { throw new Error('no such file'); });
  on('fs.list', async () => ({ value: [] }) as never);
  on('agent.list', async () => ({ value: agents }) as never);
  on('command.register', async (_$, e) => ({ value: { command: (e as { name: string }).name } }) as never);
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never);
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never);
  on('ui.toast', async () => ({ value: undefined }) as never);
  return clock;
}

const AGENT = { id: 'aaaaaaaaaaaaaaaaa', teammateId: 'impl-a@s', type: 'atlas:implementer', description: 'edit pane', status: 'running' };

test('hotkey tab c sets the view to channel', async ($, on) => {
  await boot(on, []);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const ui = await $.ui.mount({
    plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas',
    props: { title: 'Atlas', isFocused: true, bodyColumns: 56, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
  });
  expect((await ui.find({ key: 'tab:route' }))?.props.dimColor).toBe(false); // route is the default tab
  expect((await ui.find({ key: 'tab:channel' }))?.props.hotkey).toBe('c');
  await ui.press({ key: 'tab:channel' });
  expect((await ui.find({ key: 'tab:channel' }))?.props.dimColor).toBe(false);
  expect((await ui.find({ key: 'tab:route' }))?.props.dimColor).toBe(true);
});

/** The team view's worker row as drawn after `ms` more mocked time (a working row carries the spinner frame). */
async function workerRowAfter($: Engine, clock: { advance(ms: number): Promise<unknown> }, ms: number): Promise<string> {
  await clock.advance(ms);
  const ui = await $.ui.mount({
    plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas',
    props: { title: 'Atlas', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
  });
  await ui.press({ key: 'tab:team' });
  const text = (await ui.find({ key: 'worker:impl-a' }))?.text ?? '';
  await ui.unmount();
  return text;
}

test('the spinner tick stays still when no worker is live', async ($, on) => {
  const clock = await boot(on, [{ ...AGENT, status: 'completed' }]);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const before = await workerRowAfter($, clock, 0);
  expect(before).not.toBe('');
  expect(await workerRowAfter($, clock, 2000)).toBe(before);
});

test('the spinner tick advances with a live worker', async ($, on) => {
  const clock = await boot(on, [AGENT]);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const before = await workerRowAfter($, clock, 0);
  expect(before).not.toBe('');
  expect(await workerRowAfter($, clock, 250)).not.toBe(before);
});
