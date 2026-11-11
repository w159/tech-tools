// Roster rules of the Team tab (restored from the f4e6c29c sidebar-team tests; the rows themselves are drawn by panel-layout now).
import { describe, expect, test } from 'claude-code/testing';
import { busySnap, NOW } from '../live_fixture';
import type { LiveSnapshot } from '../orchestra-types';
import type { SquadAgent } from '../contract';
import { leadMood, mates, teamSummary } from './sidebar-roster';

const sq = (name: string, state: SquadAgent['state'], over: Partial<SquadAgent> = {}): SquadAgent => ({ name, persona: 'runner', state, source: 'task', ...over });
const act = (over: Record<string, unknown> = {}) => ({ tool: null, since: NOW - 1000, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...over });
const world = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ ...busySnap(), squad: [], activity: {}, comms: [], members: [], now: NOW, ...over }) as LiveSnapshot;
const byName = (snap: LiveSnapshot) => Object.fromEntries(mates(snap).map((m) => [m.name, m]));

describe('roster (mates)', () => {
  test("the lead is always first and other sessions' leads are never teammates", () => {
    const s = world({ squad: [sq('lead', 'running'), sq('lead-01a118', 'running'), sq('w1', 'running')], members: [{ name: 'lead-zz' }, { name: 'selffix', role: 'lead' }, { name: 'leader' }] });
    expect(mates(s).map((m) => m.name)).toEqual(['lead', 'w1', 'leader']);
    expect(mates(s)[1]!.persona).toBe('runner');
    expect(mates(s)[2]!.persona).toBe('unknown');
    expect(mates(s)[2]!.state).toBe('idle');
  });
  test('ended members, members already in the squad and duplicate names are left out', () => {
    const s = world({ squad: [sq('w1', 'running')], members: [{ name: 'w1' }, { name: 'gone', ended_at: '2026-01-01T00:00:00Z' }, { name: 'kept', ended_at: null }, { name: 'kept' }] });
    expect(mates(s).map((m) => m.name)).toEqual(['lead', 'w1', 'kept']);
  });
  test('a stale resting member drops off; recent, running and note-less ones stay', () => {
    const old = new Date(NOW - 2 * 3600_000 - 1000).toISOString();
    const recent = new Date(NOW - 3600_000).toISOString();
    const s = world({
      squad: [sq('old-parked', 'parked', { lastNoteTs: old }), sq('old-idle', 'idle', { lastNoteTs: old }), sq('old-finished', 'finished', { lastNoteTs: old }),
        sq('old-dead', 'dead', { lastNoteTs: old }), sq('old-running', 'running', { lastNoteTs: old }), sq('recent-parked', 'parked', { lastNoteTs: recent }),
        sq('no-note', 'parked'), sq('bad-note', 'parked', { lastNoteTs: 'not a date' })],
      members: [{ name: 'old-parked' }],
    });
    expect(mates(s).map((m) => m.name)).toEqual(['lead', 'old-running', 'recent-parked', 'no-note', 'bad-note']);
  });
  test('the cut-off is strictly over two hours', () => {
    const at = (ms: number) => world({ squad: [sq('p', 'parked', { lastNoteTs: new Date(NOW - ms).toISOString() })] });
    expect(mates(at(2 * 3600_000)).map((m) => m.name)).toContain('p');
    expect(mates(at(2 * 3600_000 + 1)).map((m) => m.name)).not.toContain('p');
  });
  test('lead row: running when anyone works or it holds a tool, else idle; text is the tool', () => {
    const idle = mates(world())[0]!;
    expect([idle.name, idle.persona, idle.state, idle.text]).toEqual(['lead', 'lead', 'idle', 'idle']);
    const w = mates(world({ squad: [sq('w1', 'spawning')] }))[0]!;
    expect([w.state, w.text]).toEqual(['running', 'idle']);
    const t = mates(world({ activity: { lead: act({ tool: 'Agent', since: NOW - 5 }) } as never }))[0]!;
    expect([t.state, t.text, t.since]).toEqual(['running', 'Agent', NOW - 5]);
    expect(mates(world({ squad: [sq('p', 'parked')] }))[0]!.state).toBe('idle');
  });
  test('worker text: own entry text, else tool, else working (running) or the state', () => {
    const m = byName(world({ squad: [sq('a', 'running'), sq('b', 'parked'), sq('c', 'running'), sq('d', 'input')], activity: { c: act({ tool: 'Edit', mood: 'working' }) } as never }));
    expect([m.a!.text, m.b!.text, m.c!.text, m.d!.text]).toEqual(['working', 'parked', 'Edit', 'input']);
  });
  test('mood: the activity mood wins, else the state maps, else idle; since only while a tool runs', () => {
    const m = byName(world({
      squad: [sq('r', 'running'), sq('f', 'failed'), sq('fin', 'finished'), sq('in', 'input'), sq('st', 'stuck'), sq('sp', 'spawning'), sq('pk', 'parked'), sq('act', 'running')],
      activity: { act: act({ mood: 'done', tool: 'Bash', since: 77 }) } as never,
    }));
    expect(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.mood]))).toEqual({
      lead: 'working', r: 'working', f: 'failed', fin: 'done', in: 'blocked', st: 'blocked', sp: 'working', pk: 'idle', act: 'done',
    });
    expect(m.act!.since).toBe(77);
    expect(m.r!.since).toBeNull();
  });
  test("leadMood is the lead row's mood, not the next teammate's", () => {
    const s = world({ squad: [sq('f', 'failed')], activity: { lead: act({ mood: 'blocked' }), f: act({ mood: 'failed' }) } as never });
    expect(leadMood(s)).toBe('blocked');
    expect(leadMood(world())).toBe('idle');
  });
  test("line: lastLine, else the member's own latest comm, else its state; scrubbed, one line, 160 cells", () => {
    const comms = [
      { seq: 1, ts: NOW - 3, from: 'a', to: 'lead', text: 'first words', kind: 'say' },
      { seq: 2, ts: NOW - 2, from: 'b', to: 'lead', text: 'b talking', kind: 'say' },
      { seq: 3, ts: NOW - 1, from: 'a', to: 'lead', text: 'latest\nwords  here', kind: 'say' },
      { seq: 4, ts: NOW, from: 'lead', to: 'all', text: 'lead traffic', kind: 'say' },
    ] as never;
    const m = byName(world({ squad: [sq('a', 'running'), sq('b', 'parked'), sq('c', 'parked'), sq('d', 'running')], comms, activity: { d: act({ lastLine: `id 0123456789abcdef0 ${'x'.repeat(200)}` }), b: act({ lastLine: '' }) } as never }));
    expect(m.a!.line).toBe('latest words here');
    expect(m.b!.line).toBe('b talking');
    expect(m.c!.line).toBe('parked');
    expect(m.d!.line.startsWith('id 012345 xxx')).toBe(true);
    expect(m.d!.line.length).toBe(160);
    expect(m.lead!.line).toBe('running');
  });
  test("a lead-named member never speaks with the lead's channel traffic", () => {
    const s = world({ comms: [{ seq: 1, ts: NOW, from: 'lead-9', to: 'all', text: 'not mine', kind: 'say' }] as never });
    expect(mates(s)[0]!.line).toBe('idle');
  });
});

describe('team summary', () => {
  test('counts only running or spawning teammates, not the lead', () => {
    expect(teamSummary(world())).toBe('lead is idle');
    expect(teamSummary(world({ squad: [sq('p', 'parked'), sq('f', 'failed')] }))).toBe('lead is idle');
    expect(teamSummary(world({ squad: [sq('a', 'running'), sq('b', 'spawning'), sq('c', 'input')] }))).toBe('lead is conducting 2');
    expect(teamSummary(world({ activity: { lead: act({ tool: 'Agent' }) } as never }))).toBe('lead is idle');
  });
});
