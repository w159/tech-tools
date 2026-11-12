// Mutation-kill tests for sidebar.tsx boardIn (seed 1105 survivors): the board tab caps its rows at the pane height less four, reads the
// pane's tick (0 when it has none), lists the snapshot's todos and counts a running item's time from the snapshot clock in seconds.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import { spinClock, spinFrameOf, spinnerGlyph } from '../atlas-ui';
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
  test('the row cap is the pane height less four: the column header and the items, then the "more" row (the panel ribbon is the one BOARD title)', () => {
    expect(shown(board(many, { rows: 10 }))).toBe(4); // 6 rows: header, four items, "+N more"
    expect(shown(board(many, { rows: 11 }))).toBe(5);
    expect(shown(board(many, { rows: 40 }))).toBe(12);
  });
  test('critique 15 B5 (L19): the panel ribbon itself reads `▸ BOARD  n items` beside the capsule, and no second BOARD title row follows', () => {
    const rows = board(many);
    expect(rows[0]).toContain('ATLAS');
    expect(rows[0]).toContain('▸ BOARD');
    expect(rows[0]).toContain('12 items');
    expect(rows[0]).toContain('SIDEPANEL ▸ BOARD'); // C1: the strip names no keys, so the ribbon is always the breadcrumb the capture scorer reads as the pane (live_capture.py :546)
    expect(rows.join('\n').match(/BOARD/g)!.length).toBe(1);
    expect(board(many, { ui: { recipient: null, expanded: null, draft: '', view: 'route' } as never }).join('\n')).toContain('SIDEPANEL');
  });
  test('the board lists the snapshot todos, and none reads (no state)', () => {
    expect(shown(board(many))).toBe(12);
    expect(board([]).join('\n')).toContain('(no state)');
  });
  test('a running item turns the shared spinner clock: the snapshot clock moved on by the pane tick', () => {
    const run = [todo(0, { status: 'in_progress', claimed_at: NOW / 1000 - 5 })];
    const glyphRow = (tick?: number) => board(run, tick === undefined ? {} : { tick }).join('\n');
    for (const tick of [undefined, 0, 2]) expect(glyphRow(tick)).toContain(`${spinnerGlyph(spinFrameOf(spinClock(NOW, tick ?? 0), 'item-0'))} item-0`);
    expect(glyphRow(1)).not.toContain(`${spinnerGlyph(spinFrameOf(NOW, 'item-0'))} item-0`); // the tick moves the clock, as in the HUD and the team tab
    expect(spinnerGlyph(0)).not.toBe(spinnerGlyph(1));
  });
  test('a snapshot without a clock falls back to the pane tick for the spinner (0 when the pane has none)', () => {
    // LiveSnapshot.now is required, so a real snapshot always takes the shared clock above; this pins the documented fallback (BoardOpts.nowMs absent: `tick`).
    const run = [todo(0, { status: 'in_progress' })];
    const clockless = (tick?: number) => board(run, { snapshot: { ...busySnap(), squad: [], activity: {}, comms: [], phase: 'implement', now: undefined, todos: run } as never, ...(tick === undefined ? {} : { tick }) }).join('\n');
    expect(clockless(2)).toContain(`${spinnerGlyph(2)} item-0`);
    expect(clockless(1)).toContain(`${spinnerGlyph(1)} item-0`);
    expect(clockless()).toContain(`${spinnerGlyph(0)} item-0`);
    expect(new Set([0, 1, 2].map((f) => spinnerGlyph(f))).size).toBe(3);
  });
  test('a running item counts its time from the snapshot clock in whole seconds', () => {
    const run = [todo(0, { status: 'in_progress', claimed_at: NOW / 1000 - 90 })];
    expect(board(run).join('\n')).toContain('elapsed 01:30');
    const later = [todo(0, { status: 'in_progress', claimed_at: Math.floor(NOW / 1000) - 3725 })];
    expect(board(later).join('\n')).toContain('elapsed 62:05');
  });
});
