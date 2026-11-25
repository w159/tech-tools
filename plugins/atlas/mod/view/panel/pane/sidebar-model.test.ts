// panelModelOf: the live adapter between the snapshot and the shared layout (the TEAM rows of the status tab, state words, the chat, gate text), and the
// message input of the shell (the channel tab's bordered field). Expectations are literal text.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../../../live_fixture';
import type { LiveSnapshot } from '../../../orchestra-types';
import type { SquadAgent } from '../../../contract';
import { bodyLines, lineText, panelText } from '../panel-layout';
import type { Ui } from '../../../design/atlas-ui';
import { forgetRefusals } from '../../../data/channels';
import { panelModelOf } from './sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './sidebar';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const sq = (name: string, state: SquadAgent['state'], over: Partial<SquadAgent> = {}): SquadAgent => ({ name, persona: 'runner', state, source: 'task', ...over });
const act = (over: Record<string, unknown> = {}) => ({ tool: null, since: NOW - 1000, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...over });
const world = (over: Partial<LiveSnapshot> = {}): LiveSnapshot => (forgetRefusals(), { ...busySnap(), squad: [], activity: {}, comms: [], members: [], todos: [], now: NOW, ...over }) as LiveSnapshot;
const model = (snapshot: LiveSnapshot, over: Partial<SidebarModel> = {}, view: SidebarModel['ui']['view'] = 'team'): SidebarModel =>
  ({ snapshot, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: 80, rows: 40, tick: 0, ...over }) as SidebarModel;
const team = (s: LiveSnapshot, cols = 80, over: Partial<SidebarModel> = {}): string[] => bodyLines(panelModelOf(model(s, { columns: cols + 1, ...over }), ui, cols)).map((l) => lineText(l).trimEnd());
/** The TEAM section of the status tab: its head and the agent rows under it. */
const teamSection = (out: string[]): string[] => out.slice(out.findIndex((l) => l.includes('TEAM')));

describe('team rows from the live snapshot', () => {
  test('the workers follow the tally with their state mark and the tally closes the head', () => {
    const s = world({ squad: [sq('a', 'running'), sq('b', 'finished')], activity: { a: act({ mood: 'working', tool: 'Grep', toolCount: 2 }) } as never });
    const out = teamSection(team(s, 80));
    expect(out[0]).toMatch(/^ TEAM +◐ 1 running$/);
    expect(out.some((l) => /^▸ [◐◓◑◒] a +runner +/.test(l))).toBe(true);
    expect(out.some((l) => /^▸ ✓ b /.test(l))).toBe(false); // the finished worker is not a row
    expect(out.some((l) => /^ +\d+ done$/.test(l))).toBe(true); // it is counted on the `N done` line
  });
  test('a roster member the squad does not know reads queued', () => {
    const out = teamSection(team(world({ members: [{ name: 'leader' }] }), 80));
    expect(out[0]).toMatch(/○ 1 queued/);
    expect(out.find((l) => l.includes(' leader '))).toMatch(/^▸ ○ leader +/);
  });
  test('L13: a state word comes from evidence, never a clock: a host-listed worker is running at any age, a dispatched member the host does not list is queued', () => {
    const at = (ms: number) => world({ squad: [sq('a', 'running')], activity: { a: act({ mood: 'working', startedAt: NOW - ms }) } as never });
    for (const ms of [0, 90_000, 90_001, 3_600_000]) expect(teamSection(team(at(ms), 80)).find((l) => l.includes(' a '))).toMatch(/^▸ [◐◓◑◒] a /);
    const dispatched = world({ squad: [], members: [{ name: 'runner-9' }] as never });
    expect(teamSection(team(dispatched, 80)).find((l) => l.includes(' runner-9 '))).toMatch(/^▸ ○ runner-9 /);
  });
  test('a parked worker draws a queued row without throwing', () => {
    const out = teamSection(team(world({ squad: [sq('pk', 'parked')], activity: { pk: act() } as never }), 80));
    expect(out.find((l) => l.includes(' pk '))).toMatch(/^▸ ○ pk +runner +parked +-$/); // a queued agent has no elapsed time
  });
  test('a stale resting member and another session lead are not on the roster', () => {
    const old = new Date(NOW - 2 * 3600_000 - 1000).toISOString();
    const out = teamSection(team(world({ squad: [sq('old', 'parked', { lastNoteTs: old }), sq('lead-0a1', 'running'), sq('w', 'running')] }), 80)).join('\n');
    expect(out).not.toContain(' old ');
    expect(out).not.toContain('lead-0a1');
    expect(out).toContain(' w ');
  });
});

describe('channel tab from the live snapshot', () => {
  const note = (seq: number, owner: string, over: Record<string, unknown> = {}) => ({ seq, ts: new Date(2026, 10, 11, 10, 2).toISOString(), owner, text: `note ${seq}`, ...over });
  const pm = (s: LiveSnapshot) => panelModelOf(model(s, {}, 'channel'), ui, 100);
  const chan = (s: LiveSnapshot): string[] => bodyLines(pm(s)).map((l) => lineText(l).trimEnd());
  test('unread counts the notes after the lead last spoke, and every note when it never spoke; the header counts who is online', () => {
    const at = (notes: unknown[]) => pm(world({ channel: 'chat', notes: notes as never }));
    expect([at([note(1, 'a'), note(2, 'lead'), note(3, 'a'), note(4, 'b')]).unread, at([note(1, 'a'), note(2, 'lead'), note(3, 'a'), note(4, 'b')]).people]).toEqual([2, 3]);
    expect(at([note(1, 'a'), note(2, 'b')]).unread).toBe(2);
    expect(at([note(1, 'a'), note(2, 'lead')]).unread).toBe(0);
    expect(at([note(1, 'a'), note(2, 'lead-9f2')]).unread).toBe(0);
    expect(chan(world({ channel: 'chat', notes: [note(1, 'a'), note(2, 'lead'), note(3, 'a'), note(4, 'b')] as never }))[0]).toMatch(/^ #chat +● 3 online$/);
    expect(chan(world({ channel: 'chat', notes: [note(1, 'a'), note(2, 'lead')] as never }))[0]).toMatch(/^ #chat +● 2 online$/);
  });
  test('a missing channel name reads #channel; a note with a bad timestamp reads --:--:--; a good one reads hh:mm:ss', () => {
    const out = chan(world({ channel: undefined as never, notes: [note(1, 'a', { ts: 'not a time' }), note(2, 'b')] as never }));
    expect(out[0]).toMatch(/^ #channel /);
    const a = out.findIndex((l) => /^ ◆ a /.test(l));
    expect(out[a]).toMatch(/^ ◆ a +--:--:--$/); // the time is the right-aligned value column
    expect(out[a + 1]).toBe('   note 1');
    const b = out.findIndex((l) => /^ ◆ b /.test(l));
    expect(out[b]).toMatch(/^ ◆ b +10:02:\d\d$/);
    expect(out[b + 1]).toBe('   note 2');
  });
});

describe('gate text', () => {
  test('a 17-hex agent id in a gate label, detail, fix or error shows its first 6 characters', () => {
    const id = '0123456789abcdef0';
    const text = (g: unknown): string => panelText(panelModelOf(model(world(), { gates: [g] as never, ui: { recipient: null, expanded: 'gate:l', draft: '', view: 'core' } as never }, 'core'), ui, 120)).join('\n');
    const lines = text({ id: 'g', title: `Gate ${id}`, lines: [{ id: 'l', label: `lbl ${id}`, ok: false, detail: `det ${id}`, fix: `fix ${id}` }] });
    const err = text({ id: 'g', title: `Gate ${id}`, error: `broke ${id}`, lines: [] });
    expect(lines + err).not.toContain(id);
    for (const w of ['lbl 012345', 'det 012345', 'fix 012345']) expect(lines).toContain(w);
    expect(err).toContain('Gate 012345'); // a group with no lines is named by its title
    expect(err).toContain('broke 012345');
  });
  test('a 16-hex or 18-hex run is left alone', () => {
    const gates = [{ id: 'g', title: 'g', lines: [{ id: 'l', label: 'G 0123456789abcdef', ok: true }] }, { id: 'h', title: 'h', lines: [{ id: 'm', label: 'H 0123456789abcdef01', ok: true }] }]; // short names: the grid cuts a long one at its end
    const text = panelText(panelModelOf(model(world(), { gates: gates as never }, 'core'), ui, 120)).join('\n');
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
  const on = { selectRecipient: (n: string) => calls.push(`to:${n}`), toggle() {}, draftChange: (v: string) => calls.push(`draft:${v}`), send: (v: string) => calls.push(`send:${v}`), copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
  const tree = (recipient: string | null): Node => sidebarTree(els, model(world({ squad: [sq('runner-1', 'running')] }), { ui: { recipient, expanded: null, draft: 'hi', view: 'channel' } as never }), on) as unknown as Node;
  const input = (recipient: string | null): Node => all(tree(recipient)).find((n) => n.kind === 'Input')!;
  test('the field is round-bordered and its placeholder names the recipient, and defaults to the lead', () => {
    expect(input('runner-1').props.placeholder).toBe('Message runner-1');
    expect(input(null).props.placeholder).toBe('Message the lead, or @name an agent');
    expect(input(null).props.label).toBe('›');
    expect(all(tree(null)).some((n) => n.kind === 'Box' && n.props.borderStyle === 'round')).toBe(true);
  });
  test('typing calls draftChange and Enter calls send with the text', () => {
    calls.length = 0;
    const i = input('runner-1');
    i.props.onInput('abc');
    i.props.onSubmit('abc');
    expect(calls).toEqual(['draft:abc', 'send:abc']);
    expect(i.props.value).toBe('hi');
  });
  test('a @name chip is a Button that sets the recipient', () => {
    calls.length = 0;
    const chip = all(tree(null)).find((n) => n.kind === 'Button' && n.props.key === 'to:runner-1')!;
    expect(chip).toBeTruthy();
    chip.props.onPress();
    expect(calls).toEqual(['to:runner-1']);
  });
});
