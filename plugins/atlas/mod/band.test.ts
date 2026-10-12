// Native band: one line led by the lead badge and phase glyph, `<phase> n of m`, working count, gates.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree } from './band';
import { busySnap } from './live_fixture';
import { chartRoom, textWidth } from './theme';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const inner = (n: Node): Node => (n.props.borderStyle ? (n.props.children as Node[])[0]! : n);
const texts = (n: Node): Node[] => (inner(n).props.children as Node[]).filter((c) => c.kind === 'Text');
const line = (n: Node): string => texts(n).map((t) => t.props.children).join('');
const HEX = /^#[0-9a-f]{6}$/i;

describe('bandTree', () => {
  const snapshot = busySnap();
  test('shows phase, progress, working agents and gates', () => {
    const tree = bandTree(els, { snapshot, openGates: 2, columns: 120 }) as unknown as Node;
    expect(line(tree)).toMatch(/\S+ \d+ of \d+ +\S+ \d+ working +2 gates open$/);
    expect(texts(tree).at(-1)?.props.color).toBe(chartRoom.fail);
  });
  test('a lead badge chip with its own fg and bg leads the line', () => {
    const first = texts(bandTree(els, { snapshot, openGates: 0, columns: 120 }) as unknown as Node)[0]!;
    expect(first.props.color).toMatch(HEX);
    expect(first.props.backgroundColor).toMatch(HEX);
  });
  test('the lead chip reads "Lead agent", never a two-letter code', () => {
    const text = line(bandTree(els, { snapshot, openGates: 0, columns: 120 }) as unknown as Node);
    expect(text).toContain('Lead agent');
    expect(text).not.toMatch(/\bLE\b/);
  });
  test('the lead dot follows the lead mood the Team row shows (blocked, not just working or idle)', () => {
    const dotColor = (activity: any) => {
      const tree = bandTree(els, { snapshot: { ...snapshot, squad: [], activity }, openGates: 0, columns: 120 }) as unknown as Node;
      return texts(tree).find((t) => t.props.children === '●')!.props.color;
    };
    const idle = dotColor({});
    expect(dotColor({ lead: { mood: 'blocked', tool: null, since: 0, lastLine: '' } })).not.toBe(idle);
  });
  test('no hex colour without a background, no dim stacked on colour', () => {
    const tree = bandTree(els, { snapshot, openGates: 1, columns: 120 }) as unknown as Node;
    for (const t of texts(tree)) {
      if (HEX.test(t.props.color ?? '')) expect(t.props.backgroundColor).toBeDefined();
      expect(t.props.dimColor).toBeUndefined();
    }
  });
  test('count matches the route tasks and skips advisor notes', () => {
    const g = (phase: string, st: string[]) => ({ phase, dept: '', glyph: '', done: 0, total: st.length, items: st.map((status, i) => ({ id: `${phase}${i}`, content: 'x', status, owner: null, evidence: null, live: true })) });
    const snap = { ...snapshot, counts: { done: 0, total: 35, byPhase: {} }, todoGroups: [g('research', ['completed', 'pending']), g('advisor', ['pending', 'pending'])] } as any;
    expect(line(bandTree(els, { snapshot: snap, openGates: 0, columns: 120 }) as unknown as Node)).toContain('1 of 2');
  });
  test('no open gates reads all clear in success, one is singular', () => {
    const quiet = bandTree(els, { snapshot, openGates: 0, columns: 120 }) as unknown as Node;
    expect(texts(quiet).at(-1)?.props.color).toBe(chartRoom.ok);
    expect(line(quiet)).toContain('all clear');
    expect(line(bandTree(els, { snapshot, openGates: 1, columns: 120 }) as unknown as Node)).toContain('1 gate open');
  });
  test('never wider than the band', () => {
    for (const columns of [10, 24, 30, 40, 50, 80]) {
      expect(textWidth(line(bandTree(els, { snapshot, openGates: 3, columns }) as unknown as Node))).toBeLessThanOrEqual(columns);
    }
  });
  test('bordered round in promptBorder at 80 columns, three rows allowed', () => {
    const tree = bandTree(els, { snapshot, openGates: 0, columns: 80, maxRows: 5 }) as unknown as Node;
    expect(tree.props.borderStyle).toBe('round');
    expect(tree.props.borderColor).toBe(chartRoom.border);
    expect(tree.props.borderColor).toBe('promptBorder');
    expect(textWidth(line(tree))).toBeLessThanOrEqual(78);
  });
  test('narrow or short host drops the border to one line', () => {
    expect((bandTree(els, { snapshot, openGates: 0, columns: 39 }) as unknown as Node).props.borderStyle).toBeUndefined();
    expect((bandTree(els, { snapshot, openGates: 0, columns: 80, maxRows: 2 }) as unknown as Node).props.borderStyle).toBeUndefined();
  });
});
