// panelModelOf: the live adapter between the snapshot and the shared layout (lead row, roster, state words, gate text), and the
// message input row of the shell. Expectations are literal text.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import type { LiveSnapshot } from '../orchestra-types';
import type { SquadAgent } from '../contract';
import { bodyLines, lineText, panelText } from '../panel-layout';
import type { Ui } from '../atlas-ui';
import { panelModelOf } from './sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './sidebar';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const sq = (name: string, state: SquadAgent['state'], over: Partial<SquadAgent> = {}): SquadAgent => ({ name, persona: 'runner', state, source: 'task', ...over });
const act = (over: Record<string, unknown> = {}) => ({ tool: null, since: NOW - 1000, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...over });
const world = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ ...busySnap(), squad: [], activity: {}, comms: [], members: [], todos: [], now: NOW, ...over }) as LiveSnapshot;
const model = (snapshot: LiveSnapshot, over: Partial<SidebarModel> = {}, view: SidebarModel['ui']['view'] = 'team'): SidebarModel =>
  ({ snapshot, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: 80, rows: 40, tick: 0, ...over }) as SidebarModel;
const team = (s: LiveSnapshot, cols = 80, over: Partial<SidebarModel> = {}): string[] => bodyLines(panelModelOf(model(s, { columns: cols + 1, ...over }), ui, cols)).map((l) => lineText(l).trimEnd());

describe('team rows from the live snapshot', () => {
  test('the lead row comes first, the workers follow, the lead tally closes', () => {
    const s = world({ squad: [sq('a', 'running'), sq('b', 'finished')], activity: { a: act({ mood: 'working', tool: 'Grep', toolCount: 2 }) } as never });
    const out = team(s, 80);
    expect(out[0]).toMatch(/^ {2}[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] lead +running/);
    expect(out.at(-1)).toBe('    workers  1 running · 1 done');
    expect(out.some((l) => /^ ?[▸ ] ?[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] a +(runner +)?running/.test(l))).toBe(true);
    expect(out.some((l) => /● b +(runner +)?done/.test(l))).toBe(true);
  });
  test('an idle lead reads waiting and a roster member the squad does not know reads queued', () => {
    const out = team(world({ members: [{ name: 'leader' }] }), 80);
    expect(out[0]).toBe('  ◉ lead    waiting');
    expect(out).toContain('  ◇ leader  queued');
  });
  test('L13: a state word comes from evidence, never a clock: a host-listed worker is running at any age, a dispatched member the host does not list is queued', () => {
    const at = (ms: number) => world({ squad: [sq('a', 'running')], activity: { a: act({ mood: 'working', startedAt: NOW - ms }) } as never });
    for (const ms of [0, 90_000, 90_001, 3_600_000]) expect(team(at(ms), 80).find((l) => l.includes(' a '))).toContain('running');
    const dispatched = world({ squad: [], members: [{ name: 'runner-9' }] as never });
    expect(team(dispatched, 80).find((l) => l.includes(' runner-9 '))).toContain('queued');
  });
  test('a parked worker draws a queued row without throwing', () => {
    const out = team(world({ squad: [sq('pk', 'parked')], activity: { pk: act() } as never }), 80);
    expect(out.find((l) => l.includes(' pk '))).toMatch(/^ {2}◇ pk +runner +queued$/) // a queued agent has no elapsed time;
  });
  test('a stale resting member and another session lead are not on the roster', () => {
    const old = new Date(NOW - 2 * 3600_000 - 1000).toISOString();
    const out = team(world({ squad: [sq('old', 'parked', { lastNoteTs: old }), sq('lead-0a1', 'running'), sq('w', 'running')] }), 80).join('\n');
    expect(out).not.toContain(' old ');
    expect(out).not.toContain('lead-0a1');
    expect(out).toContain(' w ');
  });
});

describe('channel tab from the live snapshot', () => {
  const note = (seq: number, owner: string, over: Record<string, unknown> = {}) => ({ seq, ts: new Date(2026, 10, 11, 10, 2).toISOString(), owner, text: `note ${seq}`, ...over });
  const chan = (s: LiveSnapshot): string[] => bodyLines(panelModelOf(model(s, {}, 'channel'), ui, 100)).map((l) => lineText(l).trimEnd());
  test('unread counts the notes after the lead last spoke, and every note when it never spoke', () => {
    expect(chan(world({ channel: 'chat', notes: [note(1, 'a'), note(2, 'lead'), note(3, 'a'), note(4, 'b')] as never }))[0]).toBe('    #chat  3 people · 2 unread');
    expect(chan(world({ channel: 'chat', notes: [note(1, 'a'), note(2, 'b')] as never }))[0]).toBe('    #chat  2 people · 2 unread');
    expect(chan(world({ channel: 'chat', notes: [note(1, 'a'), note(2, 'lead')] as never }))[0]).toBe('    #chat  2 people');
    expect(chan(world({ channel: 'chat', notes: [note(1, 'a'), note(2, 'lead-9f2')] as never }))[0]).toBe('    #chat  2 people');
  });
  test('a missing channel name reads #channel; a note with a bad timestamp reads --:--; a good one reads hh:mm', () => {
    const out = chan(world({ channel: undefined as never, notes: [note(1, 'a', { ts: 'not a time' }), note(2, 'b')] as never }));
    expect(out[0]).toMatch(/^ {4}#channel /);
    expect(out[1]).toMatch(/^ {4}a note 1 +--:--$/); // the time is the right-aligned value column
    expect(out[2]).toMatch(/^ {4}b note 2 +10:02$/);
  });
});

describe('gate text', () => {
  test('a 17-hex agent id in a gate title, label, detail, fix or error shows its first 6 characters', () => {
    const id = '0123456789abcdef0';
    const text = (g: unknown): string => panelText(panelModelOf(model(world(), { gates: [g] as never, ui: { recipient: null, expanded: 'gate:l', draft: '', view: 'gates' } as never }, 'gates'), ui, 120)).join('\n');
    const lines = text({ id: 'g', title: `Gate ${id}`, lines: [{ id: 'l', label: `lbl ${id}`, ok: false, detail: `det ${id}`, fix: `fix ${id}` }] });
    const err = text({ id: 'g', title: 'Gate', error: `broke ${id}`, lines: [] });
    expect(lines + err).not.toContain(id);
    for (const w of ['Gate 012345', 'lbl 012345', 'det 012345', 'fix 012345']) expect(lines).toContain(w);
    expect(err).toContain('broke 012345');
  });
  test('a 16-hex or 18-hex run is left alone', () => {
    const one = [{ id: 'l', label: 'x', ok: true }];
    const gates = [{ id: 'g', title: 'G 0123456789abcdef', lines: one }, { id: 'h', title: 'H 0123456789abcdef01', lines: one }]; // short titles: the name column cuts a long one in the middle
    const text = panelText(panelModelOf(model(world(), { gates: gates as never }, 'gates'), ui, 120)).join('\n');
    expect(text).toContain('G 0123456789abcdef');
    expect(text).toContain('H 0123456789abcdef01');
  });
});

describe('message input row', () => {
  type Node = { kind: string; props: Record<string, any> };
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
  const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
  const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
  const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
  const calls: string[] = [];
  const on = { selectRecipient() {}, toggle() {}, draftChange: (v: string) => calls.push(`draft:${v}`), send: (v: string) => calls.push(`send:${v}`), copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
  const input = (recipient: string | null): Node => all(sidebarTree(els, model(world({ squad: [sq('runner-1', 'failed')] }), { ui: { recipient, expanded: null, draft: 'hi', view: 'team' } as never }), on) as unknown as Node).find((n) => n.kind === 'Input')!;
  test('the label names the recipient, and defaults to the lead', () => {
    expect(input('runner-1').props.label).toBe('▸ to runner-1');
    expect(input(null).props.label).toBe('▸ to lead');
  });
  test('typing calls draftChange and Enter calls send with the text', () => {
    calls.length = 0;
    const i = input('runner-1');
    i.props.onInput('abc');
    i.props.onSubmit('abc');
    expect(calls).toEqual(['draft:abc', 'send:abc']);
    expect(i.props.value).toBe('hi');
  });
});
