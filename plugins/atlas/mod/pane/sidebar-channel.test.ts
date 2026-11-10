import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap } from '../live_fixture';
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

const sent: string[] = [];
const on = { draftChange: (t: string) => sent.push(`d:${t}`), send: (t: string) => sent.push(`s:${t}`) } as unknown as SidebarHandlers;
const note = (seq: number, owner: string, to: string | undefined, text: string, kind?: string) =>
  ({ seq, ts: new Date(2026, 9, 13, 10, seq).toISOString(), owner, to, text, channel: 'c', kind });
const model = (inner: number): SidebarModel => ({
  snapshot: busySnap({
    channel: 'tech-tools@main/lead-1',
    notes: [
      note(1, 'lead', 'impl', 'build the thing'),
      note(2, 'impl', 'lead', 'on it'),
      note(3, 'impl', 'review', 'check my diff'),
      note(4, 'review', 'lead', 'stuck on tests', 'blocked'),
      note(5, 'impl', 'lead', 'all merged', 'handoff'),
      note(6, 'impl', 'lead', 'last word'),
    ],
  }),
  gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'channel' }, columns: inner + 2, rows: 20,
});

describe('channelRows', () => {
  for (const inner of [44, 80]) {
    test(`rows fit and marks are right at ${inner}`, () => {
      const rows = channelRows(els, model(inner), on, inner) as unknown as Node[];
      const text = rows.slice(0, -1).map(textOf);
      for (const t of text) expect(textWidth(t)).toBeLessThanOrEqual(inner);
      expect(text[0]).toContain('#tech-tools@main/lead-1');
      expect(text[0]).toContain('6 people · 5 unread');
      const log = text.slice(1);
      expect(log).toHaveLength(6);
      expect(log[0]).toContain('─▶');
      expect(log[1]).toContain('▶');
      expect(log[2]).toContain('↔');
      expect(log[3]).toContain('⚠ blocked');
      expect(log[4]).toContain('✓ handoff');
      expect(log[5]).toContain('last word');
      expect(/\d\d:\d\d/.test(log[0]!)).toBe(inner >= 50);
      const input = rows[rows.length - 1]!;
      expect(input.kind).toBe('Input');
      expect(input.props.label).toBe('▸ to lead');
      input.props.onSubmit('hi');
      expect(sent).toContain('s:hi');
    });
  }
});

describe('channelRows colour', () => {
  const log = (inner = 80) => (channelRows(els, model(inner), on, inner) as unknown as Node[]).slice(1, -1);
  const part = (row: Node, i: number) => kids(row)[i]!.props;
  test('names and text are plain tones, never a per-persona hue', () => {
    for (const row of log()) {
      expect(part(row, 1)).toMatchObject({ color: T.text, bold: true });
      expect(kids(row).at(-1)!.props.color).toBe(T.text);
    }
  });
  test('direction arrows are muted; blocked is amber and handoff green, each beside its word', () => {
    const rows = log();
    expect(part(rows[0]!, 2)).toMatchObject({ children: '─▶ ', color: T.muted });
    expect(part(rows[2]!, 2)).toMatchObject({ children: '↔ ', color: T.muted });
    expect(part(rows[3]!, 2)).toMatchObject({ children: '⚠ blocked ', color: T.warn });
    expect(part(rows[4]!, 2)).toMatchObject({ children: '✓ handoff ', color: T.ok });
  });
  test('the header reads people and unread in words, muted', () => {
    const head = (channelRows(els, model(80), on, 80) as unknown as Node[])[0]!;
    expect(textOf(head)).toBe('#tech-tools@main/lead-1  6 people · 5 unread');
    expect(part(head, 1).color).toBe(T.muted);
  });
});
