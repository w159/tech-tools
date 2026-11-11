// Mutation-kill tests for sidebar.tsx boardIn (seed 1105 survivors): the board tab caps its rows at the pane height less four, reads the
// pane's tick (0 when it has none), lists the snapshot's todos and counts a running item's time from the snapshot clock in seconds.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import { spinFrameOf, spinnerGlyph } from '../atlas-ui';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './sidebar';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui = { theme: 'mocha', ascii: false, color: 'truecolor' } as const;

const todo = (i: number, over: Record<string, unknown> = {}) => ({ id: `t${i}`, content: `item-${i}`, status: 'pending', owner: null, ...over });
const board = (todos: unknown[] | undefined, over: Partial<SidebarModel> = {}): string[] =>
  kids(sidebarTree(els, {
    snapshot: { ...busySnap(), squad: [], activity: {}, comms: [], phase: 'implement', now: NOW, todos } as never, gates: [],
    ui: { recipient: null, expanded: null, draft: '', view: 'board' }, columns: 121, rows: 40, look: ui, ...over,
  } as SidebarModel, on) as unknown as Node).map(textOf);
const shown = (rows: string[]): number => (rows.join('\n').match(/item-\d+/g) ?? []).length;

describe('sidebar board tab', () => {
  const many = Array.from({ length: 12 }, (_, i) => todo(i));
  test('the row cap is the pane height less four: ribbon, blank, header and the items, then the "more" row', () => {
    expect(shown(board(many, { rows: 10 }))).toBe(2); // 6 rows: ribbon, blank, header, two items, "+N more"
    expect(shown(board(many, { rows: 11 }))).toBe(3);
    expect(shown(board(many, { rows: 40 }))).toBe(12);
  });
  test('the board lists the snapshot todos, and none reads (no state)', () => {
    expect(shown(board(many))).toBe(12);
    expect(board([]).join('\n')).toContain('(no state)');
  });
  test('a running item turns the snapshot clock\'s spinner frame, whatever the pane tick says', () => {
    const run = [todo(0, { status: 'in_progress', claimed_at: NOW / 1000 - 5 })];
    const glyphRow = (tick?: number) => board(run, tick === undefined ? {} : { tick }).join('\n');
    const want = spinnerGlyph(spinFrameOf(NOW, 'item-0'));
    for (const tick of [undefined, 0, 2]) expect(glyphRow(tick)).toContain(`${want} item-0`);
    expect(spinnerGlyph(0)).not.toBe(spinnerGlyph(1));
  });
  test('a running item counts its time from the snapshot clock in whole seconds', () => {
    const run = [todo(0, { status: 'in_progress', claimed_at: NOW / 1000 - 90 })];
    expect(board(run).join('\n')).toContain('elapsed 01:30');
    const later = [todo(0, { status: 'in_progress', claimed_at: Math.floor(NOW / 1000) - 3725 })];
    expect(board(later).join('\n')).toContain('elapsed 62:05');
  });
});
