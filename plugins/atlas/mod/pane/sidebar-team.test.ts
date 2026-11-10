// Team table tests over a fake element table (same pattern as sidebar.test.ts).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import { TONE_HEX as T } from '../mission-layout';
import { spin, textWidth } from '../theme';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';
import type { LiveSnapshot } from '../orchestra-types';
import type { SquadAgent } from '../contract';
import { leadMood, mates, teamRows, teamSummary } from './sidebar-team';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));

const calls: string[] = [];
const on: SidebarHandlers = {
  selectRecipient: (n: string) => calls.push(`select:${n}`), toggle: (k: string) => calls.push(`toggle:${k}`), draftChange: () => {}, send: () => {},
  copy: () => {}, focus: () => {}, expand: () => {}, setView: () => {},
} as unknown as SidebarHandlers;
const model = (over: Partial<SidebarModel['ui']> = {}): SidebarModel => ({
  snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', ...over }, columns: 80, rows: 40, tick: 3,
} as SidebarModel);
const rows = (inner: number, over?: Partial<SidebarModel['ui']>) => teamRows(els, model(over), on, inner) as unknown as Node[];

describe('team table', () => {
  for (const inner of [44, 80, 120]) {
    test(`rows fit ${inner} cells, blocked then failed then working, lead row last`, () => {
      const r = rows(inner);
      const t = r.filter((n) => n.kind !== 'Input').map(textOf);
      for (const line of t) expect(textWidth(line)).toBeLessThanOrEqual(inner);
      const at = (s: string) => t.findIndex((l) => l.includes(s));
      expect(at('impl-auth')).toBeLessThan(at('runner-1'));
      expect(at('runner-1')).toBeLessThan(at('explorer-1'));
      expect(t[at('runner-1')]).toContain('✗');
      expect(t.at(-1)).toBe('lead  1 running · 1 blocked · 1 failed');
      expect(t.join('\n')).not.toContain('more');
    });
  }
  test('no header row; the role column appears from 50 cells', () => {
    for (const inner of [44, 60, 80]) expect(textOf(rows(inner)[0]!)).not.toMatch(/agent|last line|tools/);
    expect(textOf(rows(80)[0]!)).toContain('implementer');
    expect(textOf(rows(60)[0]!)).toContain('implementer');
    expect(textOf(rows(44)[0]!)).not.toContain('implementer');
  });
  test('state is a mark plus a word, coloured by state only', () => {
    const byKey = (k: string) => kids(rows(80).find((n) => n.props.key === k)!);
    const blocked = byKey('worker:impl-auth');
    expect(blocked[0]!.props).toMatchObject({ children: '⏸', color: T.warn });
    expect(blocked.map((n) => n.props.children).join('')).toContain('waiting for lead reply');
    expect(byKey('worker:runner-1')[0]!.props).toMatchObject({ children: '✗', color: T.bad });
    expect(byKey('worker:explorer-1')[0]!.props).toMatchObject({ children: spin(3), color: T.accent });
  });
  test('Enter toggles a 2-line detail and selects the worker', () => {
    const base = rows(80).length;
    expect(rows(80, { expanded: 'worker:runner-1' }).length).toBe(base + 2);
    const b = rows(80).find((n) => n.props.key === 'worker:runner-1')!;
    b.props.onPress();
    expect(calls).toEqual(['select:runner-1', 'toggle:worker:runner-1']);
  });
  test('message input keeps the recipient', () => {
    const i = rows(80, { recipient: 'runner-1' }).find((n) => n.kind === 'Input')!;
    expect(i.props.label).toBe('▸ to runner-1');
  });
});

// ---- roster, text and column behavior (mutation-driven) ----
const sq = (name: string, state: SquadAgent['state'], over: Partial<SquadAgent> = {}): SquadAgent =>
  ({ name, persona: 'runner', state, source: 'task', ...over });
const act = (over: Record<string, unknown> = {}) => ({ tool: null, since: NOW - 1000, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...over });
/** busySnap with a replaced roster; activity and comms start empty unless given. */
const world = (over: Partial<LiveSnapshot> = {}): LiveSnapshot =>
  ({ ...busySnap(), squad: [], activity: {}, comms: [], members: [], now: NOW, ...over }) as LiveSnapshot;
const rowTexts = (snap: LiveSnapshot, inner: number, tick = 3): string[] =>
  (teamRows(els, { ...model(), snapshot: snap, tick }, on, inner) as unknown as Node[]).filter((n) => n.kind !== 'Input').map(textOf);
const byName = (snap: LiveSnapshot) => Object.fromEntries(mates(snap).map((m) => [m.name, m]));

describe('roster (mates)', () => {
  test('the lead is always first and other sessions\' leads are never teammates', () => {
    const s = world({
      squad: [sq('lead', 'running'), sq('lead-01a118', 'running'), sq('w1', 'running')],
      members: [{ name: 'lead-zz' }, { name: 'selffix', role: 'lead' }, { name: 'leader' }],
    });
    expect(mates(s).map((m) => m.name)).toEqual(['lead', 'w1', 'leader']);
    expect(mates(s)[1]!.persona).toBe('runner');
    expect(mates(s)[2]!.persona).toBe('unknown');
    expect(mates(s)[2]!.state).toBe('idle');
  });
  test('ended members, members already in the squad and duplicate names are left out', () => {
    const s = world({
      squad: [sq('w1', 'running')],
      members: [{ name: 'w1' }, { name: 'gone', ended_at: '2026-01-01T00:00:00Z' }, { name: 'kept', ended_at: null }, { name: 'kept' }],
    });
    expect(mates(s).map((m) => m.name)).toEqual(['lead', 'w1', 'kept']);
  });
  test('a stale resting member drops off; recent, running and note-less ones stay', () => {
    const old = new Date(NOW - 2 * 3600_000 - 1000).toISOString();
    const recent = new Date(NOW - 3600_000).toISOString();
    const s = world({
      squad: [
        sq('old-parked', 'parked', { lastNoteTs: old }), sq('old-idle', 'idle', { lastNoteTs: old }),
        sq('old-finished', 'finished', { lastNoteTs: old }), sq('old-dead', 'dead', { lastNoteTs: old }),
        sq('old-running', 'running', { lastNoteTs: old }), sq('recent-parked', 'parked', { lastNoteTs: recent }),
        sq('no-note', 'parked'), sq('bad-note', 'parked', { lastNoteTs: 'not a date' }),
      ],
      // a stale squad entry is not re-added as an unknown teammate
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
    const t = mates(world({ activity: { lead: act({ tool: 'Agent', since: NOW - 5 }) } as any }))[0]!;
    expect([t.state, t.text, t.since]).toEqual(['running', 'Agent', NOW - 5]);
    expect(mates(world({ squad: [sq('p', 'parked')] }))[0]!.state).toBe('idle');
  });
  test('worker text: own entry text, else tool, else working (running) or the state', () => {
    const m = byName(world({
      squad: [sq('a', 'running'), sq('b', 'parked'), sq('c', 'running'), sq('d', 'input')],
      activity: { c: act({ tool: 'Edit', mood: 'working' }) } as any,
    }));
    expect(m.a!.text).toBe('working');
    expect(m.b!.text).toBe('parked');
    expect(m.c!.text).toBe('Edit');
    expect(m.d!.text).toBe('input');
  });
  test('mood: the activity mood wins, else the state maps, else idle; since only while a tool runs', () => {
    const m = byName(world({
      squad: [sq('r', 'running'), sq('f', 'failed'), sq('fin', 'finished'), sq('in', 'input'), sq('st', 'stuck'), sq('sp', 'spawning'), sq('pk', 'parked'), sq('act', 'running')],
      activity: { act: act({ mood: 'done', tool: 'Bash', since: 77 }) } as any,
    }));
    expect(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.mood]))).toEqual({
      lead: 'working', r: 'working', f: 'failed', fin: 'done', in: 'blocked', st: 'blocked', sp: 'working', pk: 'idle', act: 'done',
    });
    expect(m.act!.since).toBe(77);
    expect(m.r!.since).toBeNull();
  });
  test('leadMood is the lead row\'s mood, not the next teammate\'s', () => {
    const s = world({ squad: [sq('f', 'failed')], activity: { lead: act({ mood: 'blocked' }), f: act({ mood: 'failed' }) } as any });
    expect(leadMood(s)).toBe('blocked');
    expect(leadMood(world())).toBe('idle');
  });
  test('line: lastLine, else the member\'s own latest comm, else its state; scrubbed, one line, 160 cells', () => {
    const comms = [
      { seq: 1, ts: NOW - 3, from: 'a', to: 'lead', text: 'first words', kind: 'say' },
      { seq: 2, ts: NOW - 2, from: 'b', to: 'lead', text: 'b talking', kind: 'say' },
      { seq: 3, ts: NOW - 1, from: 'a', to: 'lead', text: 'latest\nwords  here', kind: 'say' },
      { seq: 4, ts: NOW, from: 'lead', to: 'all', text: 'lead traffic', kind: 'say' },
    ] as any;
    const m = byName(world({
      squad: [sq('a', 'running'), sq('b', 'parked'), sq('c', 'parked'), sq('d', 'running')],
      comms,
      activity: { d: act({ lastLine: `id 0123456789abcdef0 ${'x'.repeat(200)}` }), b: act({ lastLine: '' }) } as any,
    }));
    expect(m.a!.line).toBe('latest words here');
    expect(m.b!.line).toBe('b talking');
    expect(m.c!.line).toBe('parked');
    expect(m.d!.line.startsWith('id 012345 xxx')).toBe(true);
    expect(m.d!.line.length).toBe(160);
    expect(m.lead!.line).toBe('running');
  });
  test('a lead-named member never speaks with the lead\'s channel traffic', () => {
    const s = world({
      members: [], squad: [], activity: {},
      comms: [{ seq: 1, ts: NOW, from: 'lead-9', to: 'all', text: 'not mine', kind: 'say' }] as any,
    });
    expect(mates(s)[0]!.line).toBe('idle');
  });
  test('a parked worker renders a row with the muted dot instead of throwing', () => {
    const s = world({ squad: [sq('pk', 'parked')], activity: { pk: act() } as any });
    const t = rowTexts(s, 80);
    expect(t[0]).toMatch(/^· pk +runner +parked +\d+[smh]$/);
    const b = (teamRows(els, { ...model(), snapshot: s }, on, 80) as unknown as Node[])[0]!;
    expect(kids(b)[0]!.props).toMatchObject({ children: '·', color: T.muted });
  });
});

describe('team summary and lead row', () => {
  test('counts only running or spawning teammates, not the lead', () => {
    expect(teamSummary(world())).toBe('lead is idle');
    expect(teamSummary(world({ squad: [sq('p', 'parked'), sq('f', 'failed')] }))).toBe('lead is idle');
    expect(teamSummary(world({ squad: [sq('a', 'running'), sq('b', 'spawning'), sq('c', 'input')] }))).toBe('lead is conducting 2');
    expect(teamSummary(world({ activity: { lead: act({ tool: 'Agent' }) } as any }))).toBe('lead is idle');
  });
  test('lead row counts running, done and blocked workers', () => {
    const s = world({
      squad: [sq('a', 'running'), sq('b', 'finished'), sq('c', 'finished'), sq('d', 'input'), sq('e', 'stuck')],
      activity: { a: act({ mood: 'working' }) } as any,
    });
    expect(rowTexts(s, 80).at(-1)).toBe('lead  1 running · 2 finished · 2 blocked');
  });
  test('no workers shows the hint and a plain lead summary', () => {
    const r = teamRows(els, model(), on, 80);
    expect(r.length).toBeGreaterThan(0);
    const t = rowTexts(world(), 80);
    expect(t).toEqual(['nobody dispatched yet, ask the lead to start a worker', 'lead  0 running']);
    const lead = kids(teamRows(els, { ...model(), snapshot: world() }, on, 80).at(-2) as unknown as Node);
    expect(lead.map((n) => n.props.color)).toEqual([T.text, T.muted]);
    expect(kids(teamRows(els, model(), on, 80).at(-2) as unknown as Node)[2]!.props.color).toBe(T.warn); // one blocked worker turns its count amber
  });
});

describe('team table cells', () => {
  const full = (): LiveSnapshot => world({
    squad: [
      sq('explorer-1', 'running', { persona: 'explorer' }), sq('impl-auth', 'input', { persona: 'implementer' }), sq('runner-1', 'failed'),
      sq('fin', 'finished'), sq('pk', 'parked'), sq('th', 'running'), sq('st', 'running'),
    ],
    activity: {
      'explorer-1': act({ tool: 'Grep', target: 'src/auth', mood: 'working', toolCount: 9, startedAt: NOW - 42_000, lastLine: 'found 3 call sites' }),
      'impl-auth': act({ mood: 'blocked', toolCount: 3, startedAt: NOW - 59_000 }),
      'runner-1': act({ mood: 'failed', toolCount: 12, startedAt: NOW - 125_000 }),
      fin: act({ mood: 'done', toolCount: 1, startedAt: NOW - 3599_000 }),
      pk: act({ toolCount: 0, startedAt: NOW - 3600_000 }),
      th: act({ mood: 'working', lastTool: 'Edit', startedAt: NOW - 70_000 }),
      st: act({ mood: 'working', startedAt: NOW - 3_000 }),
    } as any,
    comms: [{ seq: 1, ts: NOW - 3000, from: 'lead', to: 'st', text: 'go', kind: 'dispatch' }] as any,
  });
  test('exact rows at 80 cells: mark, name, role, activity in words, age', () => {
    expect(rowTexts(full(), 80)).toEqual([
      '⏸ impl-auth   implementer  waiting for lead reply   59s',
      '✗ runner-1    runner       failed                    2m',
      '⠸ explorer-1  explorer     Grep src/auth            42s',
      '⠸ th          runner       thinking, last Edit       1m',
      '◌ st          runner       starting                  3s',
      '· pk          runner       parked                    1h',
      '✓ fin         runner       finished                 59m',
      'lead  3 running · 1 finished · 1 blocked · 1 failed',
    ]);
  });
  test('below 50 cells the role column is dropped and the activity is cut with an ellipsis', () => {
    expect(rowTexts(full(), 44).slice(0, 3)).toEqual([
      '⏸ impl-auth   waiting for lead reply   59s',
      '✗ runner-1    failed                    2m',
      '⠸ explorer-1  Grep src/auth            42s',
    ]);
    expect(rowTexts(full(), 30)[0]).toBe('⏸ impl-auth   waiting f…   59s');
  });
  test('only a worker with a tool in flight or thinking spins; every other state is a static mark', () => {
    const marks = (tick: number) => rowTexts(world({ ...full() }), 80, tick).map((r) => r[0]);
    expect(marks(0)).toEqual(['⏸', '✗', spin(0), spin(0), '◌', '·', '✓', 'l']);
    expect(marks(3)).toEqual(['⏸', '✗', spin(3), spin(3), '◌', '·', '✓', 'l']);
  });
  test('thinking is muted, a running tool is accent, starting is muted ◌', () => {
    const b = (k: string) => kids((teamRows(els, { ...model(), snapshot: full() }, on, 80) as unknown as Node[]).find((n) => n.props.key === `worker:${k}`)!);
    expect(b('th')[0]!.props.color).toBe(T.muted);
    expect(b('explorer-1')[0]!.props.color).toBe(T.accent);
    expect(b('st')[0]!.props).toMatchObject({ children: '◌', color: T.muted });
  });
  test('the activity word takes the state tone; the name is bold text, the role and age muted', () => {
    const b = kids((teamRows(els, { ...model(), snapshot: full() }, on, 80) as unknown as Node[]).find((n) => n.props.key === 'worker:impl-auth')!);
    expect(b[2]!.props).toMatchObject({ bold: true, color: T.text });
    expect(b[3]!.props).toMatchObject({ color: T.muted });
    expect(b[4]!.props).toMatchObject({ color: T.warn });
    expect(b[5]!.props).toMatchObject({ color: T.muted });
    expect(b[2]!.props.bold).toBe(true);
    expect(b[3]!.props.bold).toBeFalsy();
  });
  test('the worker row never exceeds the pane, however long the activity is', () => {
    const s = world({ squad: [sq('a', 'running')], activity: { a: act({ tool: 'Grep', target: 'y'.repeat(300), startedAt: NOW - 1000 }) } as any });
    for (const inner of [44, 60, 80, 100]) expect(textWidth(rowTexts(s, inner)[0]!)).toBeLessThanOrEqual(inner);
    expect(rowTexts(s, 44)[0]).toBe(`⠸ a     Grep ${'y'.repeat(24)}…    1s`);
  });
  test('starting lasts 90 seconds after the dispatch, and only before the worker has used a tool', () => {
    const at = (ms: number, over: Record<string, unknown> = {}) => world({
      squad: [sq('a', 'running')], activity: { a: act({ mood: 'working', ...over }) } as any,
      comms: [{ seq: 1, ts: NOW - ms, from: 'lead', to: 'a', text: 'go', kind: 'dispatch' }] as any,
    });
    expect(rowTexts(at(90_000), 80)[0]).toContain('◌ a');
    expect(rowTexts(at(90_000), 80)[0]).toContain('starting');
    expect(rowTexts(at(90_001), 80)[0]).toContain('thinking');
    expect(rowTexts(at(90_001), 80)[0]!.startsWith('⠸')).toBe(true);
    expect(rowTexts(at(1, { lastTool: 'Edit' }), 80)[0]).toContain('thinking, last Edit');
  });
  test('a dispatch to another worker or a plain message does not mark this worker starting', () => {
    const s = world({
      squad: [sq('a', 'running')], activity: { a: act({ mood: 'working' }) } as any,
      comms: [
        { seq: 1, ts: NOW - 1, from: 'lead', to: 'other', text: 'go', kind: 'dispatch' },
        { seq: 2, ts: NOW - 1, from: 'lead', to: 'a', text: 'hi', kind: 'say' },
      ] as any,
    });
    expect(rowTexts(s, 80)[0]).not.toContain('starting');
  });
  test('column caps: name 14, role 12; the age keeps a right-aligned 4-cell column', () => {
    const s = world({
      squad: [sq('n'.repeat(30), 'running', { persona: 'r'.repeat(30) })],
      activity: { ['n'.repeat(30)]: act({ tool: 'T', toolCount: 123456, lastLine: 'z' }) } as any,
    });
    const row = rowTexts(s, 120)[0]!;
    expect(row).toBe(`⠸ ${'n'.repeat(13)}…  ${'r'.repeat(11)}…  T    1s`);
  });
  test('narrow panes cut the name to four cells at most', () => {
    const s = world({
      squad: [sq('n'.repeat(30), 'running', { persona: 'r'.repeat(30) })],
      activity: { ['n'.repeat(30)]: act({ tool: 'T'.repeat(40) }) } as any,
    });
    const row = rowTexts(s, 72)[0]!;
    expect(textWidth(row)).toBeLessThanOrEqual(72);
    expect(rowTexts(s, 20)[0]).toBe('⠸ nnn…  TTTTT…    1s');
  });
});

describe('lead summary row', () => {
  const lead = (squad: SquadAgent[], activity: Record<string, unknown> = {}) => {
    const m = { ...model(), snapshot: { ...busySnap({ squad, activity: activity as any }), now: NOW } } as SidebarModel;
    return textOf((teamRows(els, m, on, 80) as unknown as Node[]).filter((n) => n.kind !== 'Input').at(-1)!);
  };
  test('failed is counted and zero counts drop, except running', () => {
    expect(lead([sq('a', 'failed')])).toBe('lead  0 running · 1 failed');
    expect(lead([sq('a', 'finished'), sq('b', 'finished')])).toBe('lead  0 running · 2 finished');
    expect(lead([sq('a', 'running'), sq('b', 'input')])).toBe('lead  1 running · 1 blocked');
    expect(lead([])).toBe('lead  0 running');
  });
  test('a worker line is never a presence event', () => {
    const comms = [
      { seq: 1, ts: NOW - 3, from: 'a', to: 'lead', text: 'real words', kind: 'say' },
      { seq: 2, ts: NOW - 1, from: 'a', to: 'all', text: 'joined', kind: 'join' },
    ] as any;
    const m = mates({ ...busySnap({ squad: [sq('a', 'parked')], activity: {}, comms }), now: NOW });
    expect(m.find((x) => x.name === 'a')!.line).toBe('real words');
  });
});
