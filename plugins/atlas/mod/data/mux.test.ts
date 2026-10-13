import { expect, test } from 'claude-code/testing';
import { busySnap, NOW } from '../live_fixture';
import { liveWorkers } from './live';
import { parseMuxStatus } from './mux';

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
