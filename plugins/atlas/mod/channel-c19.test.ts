// Critique 19 C5: the channel tab under failure (stoprun-150-232567af-2/tab-channel.png): a worker was killed and Stop refused, and the tab read `no messages yet`.
// A kill, a Stop refusal and a block are channel rows built from state the store already holds (the squad's failed worker, the gates' Stop verdict).
import { describe, expect, test } from 'claude-code/testing';
import { busySnap, NOW } from './live_fixture';
import type { LiveSnapshot } from './orchestra-types';
import type { ChannelNote, SquadAgent } from './contract';
import { bodyLines, lineText } from './panel-layout';
import type { Ui } from './atlas-ui';
import { STOP_LINE } from './data/runstate';
import { panelModelOf } from './pane/sidebar-model';
import type { SidebarModel } from './pane/sidebar';
import { failureNotes, forgetRefusals } from './data/channels';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const sq = (name: string, state: SquadAgent['state']): SquadAgent => ({ name, persona: 'explorer', state, source: 'task' });
const act = (mood: string) => ({ tool: null, since: NOW - 1000, startedAt: NOW - 20_000, toolCount: 1, tokens: null, mood, lastLine: '' });
const mkWorld = (squad: SquadAgent[], notes: ChannelNote[] = []): LiveSnapshot =>
  ({ ...busySnap(), sessionId: 's1', squad, activity: Object.fromEntries(squad.map((a) => [a.name, act(a.state === 'failed' ? 'failed' : a.state === 'finished' ? 'done' : 'working')])), comms: [], members: [], todos: [], notes, now: NOW }) as LiveSnapshot;
const world: typeof mkWorld = (...a) => { forgetRefusals(); return mkWorld(...a); }; // a remembered Stop refusal is per run: each test world starts with none
const refused = [{ id: 'completion', title: 'Completion gate', lines: [{ id: STOP_LINE, label: 'Last Stop blocked', ok: false, detail: 'team gate, todos drained' }] }];
const model = (s: LiveSnapshot, gates: unknown[] = [], cols = 64): SidebarModel =>
  ({ snapshot: s, gates, ui: { recipient: null, expanded: null, draft: '', view: 'channel' }, columns: cols + 1, rows: 40, tick: 0 }) as SidebarModel;
const channel = (s: LiveSnapshot, gates: unknown[] = [], cols = 64): string[] => bodyLines(panelModelOf(model(s, gates, cols), ui, cols)).map((l) => lineText(l).trimEnd());

describe('critique 19 C5: the channel tab under failure', () => {
  test('a killed worker is a channel row, not `no messages yet`', () => {
    for (const cols of [64, 38]) {
      const rows = channel(world([sq('alpha-explorer', 'finished'), sq('ghost-explorer', 'failed')]), [], cols);
      const text = rows.join('\n');
      expect(text).not.toContain('no messages yet');
      expect(text).toContain('ghost-explorer'); // a name is whole on the channel (wave 24); it was cut to the design's 12 cells before
      expect(text).toMatch(/■ ghost-explorer\s+killed/);
        for (const l of rows) expect([...l].length).toBeLessThanOrEqual(cols);
    }
  });
  test('a Stop refusal is a channel row that names what Stop said', () => {
    const text = channel(world([sq('alpha-explorer', 'finished')]), refused).join('\n');
    expect(text).not.toContain('no messages');
    expect(text).toMatch(/Stop refused: team gate, todos drained/);
  });
  test('a worker that finished cleanly and a Stop that passed add no failure row (the empty hint stays honest)', () => {
    const text = channel(world([sq('alpha-explorer', 'finished')]), [{ id: 'completion', title: 'Completion gate', lines: [{ id: STOP_LINE, label: 'Last Stop passed', ok: true }] }]).join('\n');
    expect(text).toContain('no messages'); // wave 32: `○ no messages`
  });
  test('the real notes stay, the failure rows follow them in time order', () => {
    const note: ChannelNote = { ts: '2026-11-12T10:00:00.000Z', seq: 1, owner: 'alpha-explorer', text: 'handed off alpha.py', channel: 'c', kind: 'handoff' };
    const rows = channel(world([sq('alpha-explorer', 'finished'), sq('ghost-explorer', 'failed')], [note]), refused);
    const at = (s: string): number => rows.findIndex((l) => l.includes(s));
    expect(at('handed off alpha.py')).toBeGreaterThan(-1);
    expect(at('ghost-explorer')).toBeGreaterThan(at('handed off alpha.py'));
    expect(at('Stop refused')).toBeGreaterThan(at('ghost-explorer'));
  });
  test('failureNotes: the same worker is one row however often it is built, and a stable time (the kill instant, never the clock)', () => {
    const a = failureNotes({ workers: [{ name: 'ghost-explorer', state: 'failed', endedMs: Date.parse('2026-11-12T10:05:00.000Z') }], stop: null });
    const b = failureNotes({ workers: [{ name: 'ghost-explorer', state: 'failed', endedMs: Date.parse('2026-11-12T10:05:00.000Z') }], stop: null });
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
    expect(a[0]!.ts).toBe('2026-11-12T10:05:00.000Z');
  });
});
