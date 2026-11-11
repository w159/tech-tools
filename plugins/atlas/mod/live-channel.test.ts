// Live defect: the channel tab read `#channel` / `0 people` on a registry the real script wrote (round2/after/live-150 truth.json,
// folder renamed to `repo`): the main channel is keyed by the bare folder (no readable branch) and the host's session id is not the
// lead's `lead-104043`. Through the kit the real hooks module boots on that registry and draws the channel tab.
import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const REGISTRY = JSON.stringify(REGISTRY_JSON());
function REGISTRY_JSON(): unknown {
  const member = (name: string, role: string, parent: string | null) => ({ name, role, parent, joined: 1794367264.63 });
  return {
    version: 1,
    channels: {
      repo: { name: 'repo', kind: 'main', parent: null, lead: null, members: [member('lead-104043', 'lead', null)], project_root: '/repo', branch: null, created: 1794367264.63, last_activity: 1794367264.63 },
      'repo/lead-104043': {
        name: 'repo/lead-104043', kind: 'lead', parent: 'repo', lead: 'lead-104043',
        members: [member('lead-104043', 'lead', null), member('alpha-explorer', 'subagent', 'lead-104043'), member('beta-explorer', 'subagent', 'lead-104043'), member('gamma-explorer', 'subagent', 'lead-104043')],
        project_root: '/repo', branch: null, created: 1794367264.63, last_activity: 1794367264.7,
      },
    },
  };
}
const CONTRACT = JSON.stringify({
  phases: ['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done', 'blocked'].map((id) => ({ id, glyph: '.' })),
  todoPhases: ['research', 'theory', 'test', 'validate', 'implement', 'verify'],
  headerFirstLinePattern: '^ATLAS',
  itemPhasePrefix: '[<phase>] ',
});
const FILES: Record<string, string> = { '/repo/.atlas/.run/channels.json': REGISTRY };

function boot(on: On): void {
  mock.clock(on);
  mock.env(on, { ATLAS_PROJECT_ROOT: '/repo' });
  on('session.id', async () => ({ value: 'ffffff-live-session' }) as never);
  on('session.start', async (_$, e) => ({ cwd: (e as { cwd: string }).cwd }) as never);
  on('ui.log', async () => ({ value: undefined }) as never);
  on('fs.exists', async (_$, e) => ({ value: String((e as { path: string }).path).endsWith('/.atlas') }) as never);
  on('fs.read', async (_$, e) => {
    const path = String((e as { path: string }).path);
    if (path.endsWith('/contracts/operating-contract.json')) return { value: CONTRACT } as never;
    if (path in FILES) return { value: FILES[path] } as never;
    throw new Error('no such file');
  });
  on('fs.stat', async (_$, e) => {
    const path = String((e as { path: string }).path);
    if (path in FILES) return { value: { size: FILES[path]!.length, mtimeMs: 1 } } as never;
    throw new Error('no such file');
  });
  on('fs.list', async () => ({ value: [] }) as never);
  on('agent.list', async () => ({ value: [] }) as never);
  on('command.register', async (_$, e) => ({ value: { command: (e as { name: string }).name } }) as never);
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never);
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never);
  on('ui.toast', async () => ({ value: undefined }) as never);
  on('ui.render', async ($, e) => $.ui.resolve(e).Text({ children: 'prompt' }) as never);
}

test('the channel tab names the repo folder channel and its one member from the registry the script wrote', async ($, on) => {
  boot(on);
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never);
  const side = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { title: 'Atlas', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never });
  await side.press({ key: 'tab:channel' });
  for (let i = 0; i < 200; i++) await Promise.resolve();
  await side.unmount();
  const pane = await $.ui.mount({ plugin: 'atlas', surface: 'terminal', component: 'Pane', requestId: 'atlas', props: { title: 'Atlas', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never });
  const text = JSON.stringify([pane.drawn, (await pane.findAll({})).map((n) => n.text)]);
  expect(text).toContain('#repo');
  expect(text).toContain('1 person');
  expect(text).not.toContain('#channel');
  expect(text).not.toContain('0 people');
});
