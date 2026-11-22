// One agent, two names: the host row carries the lead's name (`readme-explorer`), the registry member the hook's (`explorer-9f3c`),
// joined by the host agent id. The channel tab and the TEAM list must label the agent the same.
import { describe, expect, test } from 'claude-code/testing';
import { busySnap, NOW } from '../../live_fixture';
import type { LiveSnapshot } from '../../orchestra-types';
import type { Ui } from '../../design/atlas-ui';
import { panelModelOf } from './pane/sidebar-model';
import type { SidebarModel } from './pane/sidebar-types';
import { chatRows } from './channel-chat';
import { nameOf } from './panel-shared';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const snap = {
  ...busySnap(), activity: {}, comms: [], todos: [], todoGroups: [], now: NOW,
  squad: [{ name: 'readme-explorer', id: 'a1', persona: 'explorer', state: 'running', source: 'task' }],
  members: [{ name: 'explorer-9f3c', role: 'explorer', agent_id: 'a1' }],
  notes: [{ ts: new Date(NOW - 5000).toISOString(), seq: 1, owner: 'explorer-9f3c', to: 'lead', text: 'found the readme', channel: 'c' }],
} as unknown as LiveSnapshot;
const model = { snapshot: snap, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'channel' }, columns: 80, rows: 40, tick: 0 } as unknown as SidebarModel;

describe('channel tab and TEAM list share one name', () => {
  test('a post from the registry name is labelled as the TEAM list labels that agent', () => {
    const m = panelModelOf(model, ui, 80);
    const teamLabel = nameOf(m.workers.find((w) => w.name === 'readme-explorer')!);
    const chat = chatRows(m, 40).map((l) => l.runs.map((x) => x.t).join('')).join('\n');
    expect(chat).toContain(teamLabel);
    expect(chat).not.toContain('explorer-9f3c');
  });
});
