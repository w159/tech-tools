import { expect, test } from 'claude-code/testing';
import { busySnap, NOW } from '../live_fixture';
import { liveWorkers } from './live';
import { ownRows, paneTool, parseMuxStatus, teamsOf } from './mux';
import { deriveOrchestration, EMPTY_ORCH } from './orchestration';

// stdout shape of `atlas_mux.py status --run <id>` (cmd_status), as a stubbed process.run would return it
const STDOUT = JSON.stringify({
  ok: true, run: 'r1', transport: 'tmux', tmux: true,
  workers: [
    { name: 'mux-run', dead: 0, pid: '1' },
    { name: 'mux-wait', dead: 0, pid: '2', state: 'waiting' },
    { name: 'mux-bad', dead: 1, pid: '3' },
    { name: 'mux-ok', dead: 1, pid: '4' },
  ],
  board: [{ name: 'mux-bad', exit: 2 }, { name: 'mux-ok', exit: 0 }, { name: 'mux-run', exit: null }],
});

// A team worker's pane log as atlas_mux.py run-worker writes it: the argv line, the prompt's continuation, then stream-json.
const use = (id: string, name: string, input: unknown) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const answer = (id: string) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const LOG = ["$ claude -p --output-format stream-json --agent atlas:explorer 'You are explorer-4fdc", 'Peers: x', "'", '{"type":"system","subtype":"init"}'];

test('teamsOf: spawn-team records on the lead channel are status runs (live: team workers never reached the band)', () => {
  const records = [
    { name: 'lanes-x.json', text: JSON.stringify({ channel: 'tech-tools@main/lead-ea0b59', transport: 'tmux', members: [{ name: 'explorer-eaa3', role: 'explorer' }] }) },
    { name: 'old-team.json', text: JSON.stringify({ channel: 'tech-tools@main/lead-0000aa' }) },
    { name: 'broken.json', text: '{' },
  ];
  // the board channel can be `tech-tools@main` while the team sits on the lead channel: the bare lead name matches
  expect(teamsOf(records, ['tech-tools@main', 'lead-ea0b59'])).toEqual([{ id: 'lanes-x', members: ['explorer-eaa3'] }]);
  expect(teamsOf(records, ['tech-tools@main/lead-ea0b59']).map((t) => t.id)).toEqual(['lanes-x']);
  expect(teamsOf(records, ['', 'lead-ffffff'])).toEqual([]);
});

test('ownRows keeps this session\'s workers once each; other sessions\' claude-bg agents stay out', () => {
  const rows = [...parseMuxStatus(STDOUT), ...parseMuxStatus(STDOUT)];
  expect(ownRows(rows, new Set(['mux-run', 'mux-ok'])).map((a) => a.name)).toEqual(['mux-run', 'mux-ok']);
});

test('paneTool: last tool_use is in flight until a tool_result answers it; no call => {}', () => {
  expect(paneTool([...LOG, use('t1', 'mcp__lean-ctx__ctx_shell', { command: 'sleep 5' })].join('\n'))).toEqual({ tool: 'mcp__lean-ctx__ctx_shell', target: 'sleep 5' });
  expect(paneTool([...LOG, use('t1', 'Bash', { command: 'sleep 5' }), answer('t1')].join('\n'))).toEqual({ lastTool: 'Bash', target: 'sleep 5' });
  expect(paneTool(LOG.join('\n'))).toEqual({});
  expect(paneTool('')).toEqual({});
});

test('a team worker with no in-process events gets its lane tool and target from the squad row', () => {
  const squad = [{ ...parseMuxStatus(STDOUT)[0]!, startedAt: NOW - 30_000, ...paneTool([...LOG, use('t1', 'Bash', { command: 'sleep 5' })].join('\n')) }];
  const activity = deriveOrchestration({ orch: EMPTY_ORCH, names: {}, listed: [], squad, notes: [], members: [], leadNames: [], wt: [], now: NOW, mergedAt: {} }).activity;
  const s = busySnap();
  s.squad = squad;
  s.activity = activity;
  expect(liveWorkers(s, NOW).map((w) => [w.name, w.tool, w.target, w.startedAt])).toEqual([['mux-run', 'Bash', 'sleep 5', NOW - 30_000]]);
});

test('parseMuxStatus maps rows to tagged squad entries; garbage => []', () => {
  expect(parseMuxStatus(STDOUT).map((a) => [a.name, a.state, a.transport])).toEqual([
    ['mux-run', 'running', 'tmux'], ['mux-wait', 'input', 'tmux'], ['mux-bad', 'failed', 'tmux'], ['mux-ok', 'finished', 'tmux'],
  ]);
  expect(parseMuxStatus('nope')).toEqual([]);
});

test('mux workers reach liveWorkers with working/blocked/failed/done', () => {
  const s = busySnap();
  s.squad = parseMuxStatus(STDOUT).map((a) => ({ ...a, source: 'task' as const }));
  expect(liveWorkers(s, NOW).map((w) => [w.name, w.state])).toEqual([
    ['mux-wait', 'blocked'], ['mux-bad', 'failed'], ['mux-run', 'working'], ['mux-ok', 'done'],
  ]);
});
