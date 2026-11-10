// channelRows contract: header counts, log windowing, per-note segments (time, nick, mark, recipient, text) and the input.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap } from '../live_fixture';
import type { ChannelNote } from '../contract';
import type { LiveSnapshot } from '../orchestra-types';
import { TONE_HEX as T } from '../mission-layout';
import { textWidth } from '../theme';
import { channelRows } from './sidebar-channel';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));

const log: string[] = [];
const on = { draftChange: (t: string) => log.push(`d:${t}`), send: (t: string) => log.push(`s:${t}`) } as unknown as SidebarHandlers;
const TS = new Date(2026, 9, 13, 5, 7).toISOString(); // local 05:07
const note = (seq: number, owner: string, to: string | undefined, text: string, kind?: string, ts = TS): ChannelNote =>
  ({ seq, ts, owner, to, text, channel: 'c', kind }) as ChannelNote;

const rowsFor = (notes: ChannelNote[], over: Partial<LiveSnapshot> = {}, inner = 80, ui: Partial<SidebarModel['ui']> = {}, rows = 40): Node[] =>
  channelRows(els, {
    snapshot: busySnap({ notes, ...over }), gates: [], rows, columns: inner + 1,
    ui: { recipient: null, expanded: null, draft: '', view: 'channel', ...ui },
  }, on, inner) as unknown as Node[];
const header = (r: Node[]): string => textOf(r[0]!);
const noteTexts = (r: Node[]): Node[][] => r.slice(1, -1).map(kids);

describe('header', () => {
  test('channel name, people count and unread count', () => {
    const r = rowsFor([note(1, 'lead', 'impl', 'go'), note(2, 'impl', 'lead', 'ok'), note(3, 'impl', 'lead', 'done')]);
    // lead + impl wrote; the busy fixture's 3 live workers count as people too
    expect(header(r)).toBe('#lead-1  5 people · 2 unread');
    expect(kids(r[0]!)[0]!.props.bold).toBe(true);
    expect(kids(r[0]!)[1]!.props.color).toBe(T.muted);
  });
  test('no unread part when the lead spoke last; no lead notes means everything is unread', () => {
    expect(header(rowsFor([note(1, 'impl', 'lead', 'x'), note(2, 'lead-9', undefined, 'y')]))).toBe('#lead-1  5 people');
    expect(header(rowsFor([note(1, 'impl', 'lead', 'x'), note(2, 'impl', 'lead', 'y')]))).toBe('#lead-1  4 people · 2 unread');
    expect(header(rowsFor([]))).toBe('#lead-1  3 people');
  });
  test('one person reads "1 person"', () => {
    const only = [{ name: 'lead' }] as unknown as LiveSnapshot['members'];
    expect(header(rowsFor([note(1, 'lead', 'all', 'a')], { squad: [], members: only }))).toBe('#lead-1  1 person');
  });
  test('channel falls back to #channel', () => {
    expect(header(rowsFor([], { channel: null as unknown as string }))).toBe('#channel  3 people');
  });
  test('people = distinct note owners + open members + live (non-done) workers', () => {
    const squad = (state: string) => [{ name: 'w1', persona: 'explorer', state, source: 'task', task: 't' }] as LiveSnapshot['squad'];
    const members = [{ name: 'm1' }, { name: 'm2', ended_at: 5 }, { name: 'impl' }] as unknown as LiveSnapshot['members'];
    // owners: lead, impl -> 2; members add m1 (m2 ended, impl dup) -> 3; live worker w1 -> 4
    expect(header(rowsFor([note(1, 'lead', 'all', 'a'), note(2, 'impl', 'all', 'b')], { squad: squad('running'), members }))).toContain('4 people');
    expect(header(rowsFor([note(1, 'lead', 'all', 'a'), note(2, 'impl', 'all', 'b')], { squad: squad('finished'), members }))).toContain('3 people');
    expect(header(rowsFor([note(1, 'lead', 'all', 'a')], { squad: squad('failed'), members: [] }))).toContain('2 people');
  });
});

describe('log window', () => {
  const many = Array.from({ length: 12 }, (_, i) => note(i + 1, 'impl', 'lead', `msg${i + 1}`));
  test('shows the last rows-4 notes, at least one', () => {
    expect(noteTexts(rowsFor(many, {}, 80, {}, 10)).map((p) => p.map(textOf).join(''))).toHaveLength(6);
    expect(textOf(rowsFor(many, {}, 80, {}, 10)[1]!)).toContain('msg7');
    expect(textOf(rowsFor(many, {}, 80, {}, 10).at(-2)!)).toContain('msg12');
    expect(noteTexts(rowsFor(many, {}, 80, {}, 5))).toHaveLength(1);
    expect(noteTexts(rowsFor(many, {}, 80, {}, 1))).toHaveLength(1);
    expect(noteTexts(rowsFor(many, {}, 80, {}, 0))).toHaveLength(1);
    expect(noteTexts(rowsFor(many, {}, 80, {}, 100))).toHaveLength(12);
  });
});

describe('note segments', () => {
  test('time column only from inner width 50; invalid timestamps read --:--', () => {
    const at = (inner: number, ts = TS) => noteTexts(rowsFor([note(1, 'impl', 'lead', 'x', undefined, ts)], {}, inner))[0]!;
    expect(textOf(at(50)[0]!)).toBe('05:07 ');
    expect(at(50)[0]!.props.color).toBe(T.muted);
    expect(at(49)).toHaveLength(4); // nick, mark, recipient, text: no time
    expect(textOf(at(49)[0]!).trim()).toBe('impl');
    expect(textOf(at(50, 'garbage')[0]!)).toBe('--:-- ');
    expect(textOf(at(50, new Date(2026, 0, 2, 13, 45).toISOString())[0]!)).toBe('13:45 ');
    expect(textOf(at(50, new Date(2026, 0, 2, 0, 0).toISOString())[0]!)).toBe('00:00 ');
  });

  test('nick column is bold, padded to the widest owner (4..10), cut with an ellipsis, plain text colour for everyone', () => {
    const squad = [{ name: 'explorer-1', persona: 'explorer', state: 'running', source: 'task', task: 't' }] as LiveSnapshot['squad'];
    const nick = (owner: string, over: Partial<LiveSnapshot> = {}) => noteTexts(rowsFor([note(1, owner, 'lead', 'x')], { squad, ...over }, 40))[0]![0]!;
    expect(nick('ab').props.children).toBe('ab   '); // min width 4 + 1 space
    expect(nick('ab').props.bold).toBe(true);
    expect(nick('abcde').props.children).toBe('abcde ');
    expect(nick('abcdefghij').props.children).toBe('abcdefghij ');
    expect(nick('abcdefghijklmno').props.children).toBe('abcdefghi… '); // max width 10
    for (const owner of ['explorer-1', 'lead-1', 'lead', 'ghost']) expect(nick(owner).props.color).toBe(T.text);
  });

  test('nick width follows the widest owner of the visible window only', () => {
    const notes = [note(1, 'a-very-long-owner', 'lead', 'old'), note(2, 'ab', 'lead', 'new')];
    const out = noteTexts(rowsFor(notes, {}, 40, {}, 5)); // window of one: only "ab"
    expect(out[0]![0]!.props.children).toBe('ab   ');
  });

  test('marks: blocked ⚠ blocked, handoff/done ✓ with the word, lead-owned ─▶, to all/none/lead ▶, to a peer ↔; colours follow', () => {
    const mark = (n: ChannelNote) => noteTexts(rowsFor([n], {}, 60))[0]!.find((p) => /^(⚠ blocked|✓ handoff|✓ done|─▶|▶|↔) $/.test(String(p.props.children)))!.props;
    expect(mark(note(1, 'impl', 'lead', 'x', 'blocked'))).toMatchObject({ children: '⚠ blocked ', color: T.warn });
    expect(mark(note(1, 'lead', 'impl', 'x', 'blocked'))).toMatchObject({ children: '⚠ blocked ', color: T.warn });
    expect(mark(note(1, 'impl', 'lead', 'x', 'handoff'))).toMatchObject({ children: '✓ handoff ', color: T.ok });
    expect(mark(note(1, 'impl', 'lead', 'x', 'done'))).toMatchObject({ children: '✓ done ', color: T.ok });
    expect(mark(note(1, 'lead', 'impl', 'x'))).toMatchObject({ children: '─▶ ', color: T.muted });
    expect(mark(note(1, 'lead-3', 'impl', 'x', 'handoff'))).toMatchObject({ children: '✓ handoff ', color: T.ok });
    expect(mark(note(1, 'impl', undefined, 'x'))).toMatchObject({ children: '▶ ', color: T.muted });
    expect(mark(note(1, 'impl', 'all', 'x'))).toMatchObject({ children: '▶ ', color: T.muted });
    expect(mark(note(1, 'impl', 'lead', 'x'))).toMatchObject({ children: '▶ ', color: T.muted });
    expect(mark(note(1, 'impl', 'lead-2', 'x'))).toMatchObject({ children: '▶ ', color: T.muted });
    expect(mark(note(1, 'impl', 'review', 'x'))).toMatchObject({ children: '↔ ', color: T.muted });
    expect(mark(note(1, 'impl', 'leader', 'x'))).toMatchObject({ children: '↔ ', color: T.muted }); // not a lead id
    expect(mark(note(1, 'leadership', 'review', 'x'))).toMatchObject({ children: '↔ ', color: T.muted });
    expect(mark(note(1, 'impl', 'review', 'x', 'say'))).toMatchObject({ children: '↔ ' });
  });

  test('recipient segment appears for a named target, muted, and not for all/none', () => {
    const parts = (to: string | undefined) => noteTexts(rowsFor([note(1, 'impl', to, 'hello')], {}, 40))[0]!.map((p) => p.props.children);
    expect(parts('review')).toEqual(['impl ', '↔ ', 'review ', 'hello']);
    expect(noteTexts(rowsFor([note(1, 'impl', 'review', 'hello')], {}, 40))[0]![2]!.props.color).toBe(T.muted);
    expect(noteTexts(rowsFor([note(1, 'impl', 'review', 'hello')], {}, 40))[0]![3]!.props.color).toBe(T.text);
    expect(parts('all')).toEqual(['impl ', '▶ ', 'hello']);
    expect(parts(undefined)).toEqual(['impl ', '▶ ', 'hello']);
    expect(parts('lead')).toEqual(['impl ', '▶ ', 'lead ', 'hello']);
  });

  test('note text has whitespace collapsed to single spaces', () => {
    const p = noteTexts(rowsFor([note(1, 'impl', 'all', 'a\n\n  b\t\tc')], {}, 40))[0]!;
    expect(p.at(-1)!.props.children).toBe('a b c');
  });

  test('every row fits the inner width', () => {
    const r = rowsFor([note(1, 'a-very-long-owner', 'some-long-target', 'x'.repeat(200))], {}, 44);
    for (const row of r.slice(0, -1)) expect(textWidth(textOf(row))).toBeLessThanOrEqual(44);
  });
});

describe('input', () => {
  test('label names the recipient (default lead), carries the draft and wires the handlers', () => {
    const r = rowsFor([], {}, 80, { draft: 'half typed', recipient: 'impl-auth' });
    const input = r.at(-1)!;
    expect(input.kind).toBe('Input');
    expect(input.props).toMatchObject({ key: 'msg', label: '▸ to impl-auth', placeholder: 'message · Enter sends', value: 'half typed' });
    expect(rowsFor([]).at(-1)!.props.label).toBe('▸ to lead');
    log.length = 0;
    input.props.onInput('abc');
    input.props.onSubmit('go');
    expect(log).toEqual(['d:abc', 's:go']);
  });
});
