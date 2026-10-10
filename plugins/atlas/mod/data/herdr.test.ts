// Tests for the herdr data plane (plugins/atlas/mod/data/herdr.ts): status parsing tolerance and
// one case per AgentState mapping (running/idle/input/stuck/finished/failed/dead + task passthrough).
// Shapes mirror scripts/atlas_herdr.py (status/_agent_row/_unavailable) and
// scripts/atlas_dash_colony.py (_state, STUCK_S) and dashboard_ui/js/glyphs.js (blocked -> input).
import { expect, test } from 'claude-code/testing';
import { mergeSquad, parseHerdrStatus, STUCK_MS } from './herdr';
import { FIXTURE_EPOCH_MS } from '../test_helpers';
import type { ChannelMember, ChannelNote, SquadAgent } from '../contract';

const NOW = FIXTURE_EPOCH_MS; // mod convention: every fixture timestamp derives from the fixed clock
const member = (o: Partial<ChannelMember> & { name: string }): ChannelMember => o as ChannelMember;
const note = (o: Partial<ChannelNote> & { owner: string; ts: string }): ChannelNote =>
  ({ seq: 1, text: 'status update', channel: 'tech-tools@main/lead-01a122', kind: 'note', ...o }) as ChannelNote;
const pane = (id: string, agent?: string, agent_status?: string) => {
  const p: { id: string; name?: string; agent_status?: string } = { id };
  if (agent !== undefined) p.name = agent;
  if (agent_status !== undefined) p.agent_status = agent_status;
  return p;
};
const squad = (o: Partial<SquadAgent> & { name: string }): SquadAgent =>
  ({ persona: 'unknown', state: 'running', source: 'task', ...o }) as SquadAgent;

const seconds = (ageMs: number) => String(Math.round((NOW - ageMs) / 1000)); // registry ts = epoch seconds

test('parseHerdrStatus reads the real status envelope (no agents key)', () => {
  const out = JSON.stringify({
    running: true, healthy: true, state: 'ok', herdr_server: true, url: 'http://127.0.0.1:7317',
    colony_url: 'http://127.0.0.1:7317', pids: [123], installed: true, vendored: true, plugin_root: '/x',
  });
  expect(parseHerdrStatus(out)).toEqual({ panes: [], ok: true });
});

test('parseHerdrStatus maps agent rows (agents() shape) and tolerates missing fields', () => {
  const out = JSON.stringify({
    reachable: true, agents: [
      { pane_id: 'p1', agent: 'impl-auth', status: 'blocked' },
      { pane_id: 'p2', agent: 'tri-old1', status: 'idle' },
      { pane_id: 'p3' },
      { agent: 'no pane id' },
      'garbage',
    ],
  });
  const parsed = parseHerdrStatus(out);
  expect(parsed.ok).toBe(true);
  expect(parsed.panes).toEqual([
    { id: 'p1', name: 'impl-auth', agent_status: 'blocked' },
    { id: 'p2', name: 'tri-old1', agent_status: 'idle' },
    { id: 'p3' },
  ]);
});

test('parseHerdrStatus survives tracebacks, CLI errors and wrapped stdout', () => {
  expect(parseHerdrStatus('Traceback (most recent call last):\n  File "atlas_herdr.py"\nHerdrSockError: connect_failed')).toEqual({ panes: [], ok: false });
  expect(parseHerdrStatus('{"ok": false, "reason": "unavailable", "why": "down"}')).toEqual({ panes: [], ok: false });
  expect(parseHerdrStatus('{"running": false, "healthy": false, "state": "server_down"}')).toEqual({ panes: [], ok: false });
  expect(parseHerdrStatus('warning: legacy mode\n{"agents": [{"pane_id": "p9"}]}\nbye')).toEqual({ panes: [{ id: 'p9' }], ok: true });
  expect(parseHerdrStatus('')).toEqual({ panes: [], ok: false });
});

test('live members with fresh notes run; a working herdr pane runs too', () => {
  const squad1 = mergeSquad(
    [member({ name: 'impl-auth' })], [note({ owner: 'impl-auth', ts: seconds(60_000) })], [], [], NOW);
  expect(squad1[0]?.state).toBe('running');
  const squad2 = mergeSquad(
    [member({ name: 'impl-auth', pane_id: 'p1' })], [note({ owner: 'impl-auth', ts: seconds(60_000) })],
    [pane('p1', 'impl-auth', 'working')], [], NOW);
  expect(squad2[0]?.state).toBe('running');
  // NoteReader (channels.ts) feeds ISO timestamps: same verdict as epoch-seconds ts.
  const iso = mergeSquad(
    [member({ name: 'impl-auth' })], [note({ owner: 'impl-auth', ts: new Date(NOW - 60_000).toISOString() })],
    [], [], NOW);
  expect(iso[0]?.state).toBe('running');
  expect(iso[0]?.lastNoteTs).toBe(new Date(NOW - 60_000).toISOString());
});

test('an idle herdr pane reads idle', () => {
  const out = mergeSquad(
    [member({ name: 'impl-auth', pane_id: 'p1' })], [note({ owner: 'impl-auth', ts: seconds(60_000) })],
    [pane('p1', 'impl-auth', 'idle')], [], NOW);
  expect(out[0]?.state).toBe('idle');
});

test('herdr agent_status blocked -> input, even past the stuck window', () => {
  const fresh = mergeSquad(
    [member({ name: 'impl-auth', pane_id: 'p1' })], [note({ owner: 'impl-auth', ts: seconds(60_000) })],
    [pane('p1', 'impl-auth', 'blocked')], [], NOW);
  expect(fresh[0]?.state).toBe('input');
  const silent = mergeSquad(
    [member({ name: 'impl-auth', pane_id: 'p1' })], [note({ owner: 'impl-auth', ts: seconds(STUCK_MS + 60_000) })],
    [pane('p1', 'impl-auth', 'blocked')], [], NOW);
  expect(silent[0]?.state).toBe('input');
});

test('15 min without a note -> stuck (with or without a herdr pane)', () => {
  const stale = seconds(STUCK_MS + 1000);
  const panned = mergeSquad(
    [member({ name: 'impl-auth', pane_id: 'p1' })], [note({ owner: 'impl-auth', ts: stale })],
    [pane('p1', 'impl-auth', 'working')], [], NOW);
  expect(panned[0]?.state).toBe('stuck');
  const bare = mergeSquad([member({ name: 'impl-auth' })], [note({ owner: 'impl-auth', ts: stale })], [], [], NOW);
  expect(bare[0]?.state).toBe('stuck');
  // at exactly STUCK_MS the member is not yet stuck
  const edge = mergeSquad(
    [member({ name: 'impl-auth' })], [note({ owner: 'impl-auth', ts: seconds(STUCK_MS) })], [], [], NOW);
  expect(edge[0]?.state).toBe('running');
});

test('exit note -> finished (exit 0) / failed (nonzero)', () => {
  const fine = mergeSquad(
    [member({ name: 'impl-auth' })], [note({ owner: 'impl-auth', ts: seconds(5_000), text: 'exit 0', kind: 'exit' })],
    [], [], NOW);
  expect(fine[0]?.state).toBe('finished');
  const boom = mergeSquad(
    [member({ name: 'impl-auth' })], [note({ owner: 'impl-auth', ts: seconds(5_000), text: 'exit 3 [failed: tests]', kind: 'exit' })],
    [], [], NOW);
  expect(boom[0]?.state).toBe('failed');
});

test('registry exit_code settles the state even without a note', () => {
  const fine = mergeSquad([member({ name: 'impl-auth', ended_at: '1800000005', exit_code: 0 })], [], [], [], NOW);
  expect(fine[0]?.state).toBe('finished');
  const boom = mergeSquad([member({ name: 'impl-auth', ended_at: '1800000005', exit_code: 1 })], [], [], [], NOW);
  expect(boom[0]?.state).toBe('failed');
});

test('ended_at without any exit record -> dead', () => {
  const out = mergeSquad([member({ name: 'impl-auth', ended_at: '1800000005' })], [], [], [], NOW);
  expect(out[0]?.state).toBe('dead');
});

test('a live herdr pane outranks a stale exit note (revived worker)', () => {
  // The exit note is the only recent activity: state is stuck, never finished/failed.
  const out = mergeSquad(
    [member({ name: 'impl-auth', pane_id: 'p1' })],
    [note({ owner: 'impl-auth', ts: seconds(3_600_000), text: 'exit 1', kind: 'exit' })],
    [pane('p1', 'impl-auth', 'working')], [], NOW);
  expect(out[0]?.state).toBe('stuck');
  expect(out[0]?.lastNoteTs).toBe(seconds(3_600_000));
  // A note after the revive re-reads as live running.
  const fresh = mergeSquad(
    [member({ name: 'impl-auth', pane_id: 'p1' })],
    [note({ owner: 'impl-auth', ts: seconds(3_600_000), text: 'exit 1', kind: 'exit' }), note({ owner: 'impl-auth', ts: seconds(60_000) })],
    [pane('p1', 'impl-auth', 'working')], [], NOW);
  expect(fresh[0]?.state).toBe('running');
});

test('persona derives from name or role prefix, else unknown', () => {
  const members = [
    member({ name: 'impl-auth' }),
    member({ name: 'verifier-mod-plan' }),
    member({ name: 'explorer-advisor-b1' }),
    member({ name: 'docs-cur' }),
    member({ name: 'runner-changelog-cleanup' }),
    member({ name: 'armada-devops' }),
    member({ name: 'tri-old1' }),
    member({ name: 'tri-old2', role: 'atlas:docs-curator' }),
    member({ name: 'DataHerdr' }),
  ];
  const byPersona = Object.fromEntries(mergeSquad(members, [], [], [], NOW).map((a) => [a.name, a.persona]));
  expect(byPersona['impl-auth']).toBe('implementer');
  expect(byPersona['verifier-mod-plan']).toBe('verifier');
  expect(byPersona['explorer-advisor-b1']).toBe('explorer');
  expect(byPersona['docs-cur']).toBe('docs-curator');
  expect(byPersona['runner-changelog-cleanup']).toBe('runner');
  expect(byPersona['armada-devops']).toBe('armada-devops');
  expect(byPersona['tri-old1']).toBe('unknown');
  expect(byPersona['tri-old2']).toBe('docs-curator'); // role beats name
  expect(byPersona['DataHerdr']).toBe('unknown');
});

test('the lead is not a squad sprite', () => {
  const out = mergeSquad([member({ name: 'lead' }), member({ name: 'lead-01a122' }), member({ name: 'impl-auth' })], [], [], [], NOW);
  expect(out.length).toBe(1);
  expect(out[0]?.name).toBe('impl-auth');
});

test('task agents win same-name clashes and borrow colony pane ids and notes', () => {
  const task = squad({ name: 'impl-auth', persona: 'implementer', state: 'parked', model: 'sonnet', effort: 'low' });
  const other = squad({ name: 'tri-old1', persona: 'unknown', state: 'finished' });
  const out = mergeSquad(
    [member({ name: 'impl-auth', pane_id: 'p1' }), member({ name: 'tri-old9' })],
    [note({ owner: 'impl-auth', ts: seconds(60_000) }), note({ owner: 'tri-old9', ts: seconds(60_000) })],
    [pane('p1', 'impl-auth', 'working')],
    [task, other],
    NOW);
  expect(out.length).toBe(3); // tri-old9 colony-only, the rest deduped by name
  const implAuth = out.find((a) => a.name === 'impl-auth');
  expect(implAuth).toEqual({
    name: 'impl-auth', persona: 'implementer', state: 'parked', source: 'task',
    model: 'sonnet', effort: 'low', paneId: 'p1', lastNoteTs: seconds(60_000),
  });
  const tri = out.find((a) => a.name === 'tri-old9');
  expect(tri?.source).toBe('colony');
  expect(tri?.persona).toBe('unknown');
});

test('unknown personas on task agents get derived, and task states pass through untouched', () => {
  const out = mergeSquad([], [], [], [squad({ name: 'verifier-mod-plan', persona: 'unknown', state: 'spawning' })], NOW);
  expect(out[0]?.persona).toBe('verifier');
  expect(out[0]?.state).toBe('spawning');
  expect(out[0]?.source).toBe('task');
});