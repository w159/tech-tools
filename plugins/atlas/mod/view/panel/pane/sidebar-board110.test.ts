// Live defect (round2 live-110 at e4a8186a, board 0.0): the board view in the 110-column pane drew the bare tab strip under a `▸ BOARD` ribbon, so nothing in the pane named the SIDEPANEL
// and the capture could not tell the pane from a toast box. Redesign: every view, the board the band opens included, draws the one `◆ ATLAS` header and the one strip row (health status gates channel);
// the board is no tab of the strip, so no chip is lit over it. The pane marker is the `◆ ATLAS` pill.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../../../live_fixture';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './sidebar';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
// As the host draws it: the text of every Text under the node (a Button has no hotkey prefix, the strip binds no key).
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui = { theme: 'mocha', ascii: false, color: 'truecolor' } as const;
const todo = (i: number) => ({ id: `t${i}`, content: `T${i} item`, status: 'completed', owner: null });
const rows = (view: SidebarView, columns: number): string[] =>
  kids(sidebarTree(els, {
    snapshot: { ...busySnap(), squad: [], activity: {}, comms: [], phase: 'implement', now: NOW, todos: [1, 2, 3, 4, 5].map(todo) } as never, gates: [],
    ui: { recipient: null, expanded: null, draft: '', view }, columns, rows: 40, look: ui,
  } as SidebarModel, on) as unknown as Node).map(textOf);

describe('the board view in a narrow pane draws the one-row chip strip (critique 18, D14)', () => {
  for (const columns of [38, 39, 43]) {
    test(`pane ${columns}: the strip is one row of chips, the ◆ ATLAS pill names the pane, no chip is lit over the board, no row is wider than the pane`, () => {
      const r = rows('board', columns).join('\n').split('\n');
      expect(r[0]).toContain('◆ ATLAS');
      expect(r[2]!.trim().replace(/ +/g, ' ')).toMatch(/^health status( more ›| gates( \d+)?( chan(nel)?( \d+)?| more ›)?)?$/); // D14: the trailing tabs fold behind `more ›`; the order never changes, no swap
      expect(r[3]!.includes('━')).toBe(false); // the board is no tab: no accent segment under any chip
      expect(r[4]!.includes('━')).toBe(false); // the strip is not wrapped: the row under the rule is the body
      for (const l of r.slice(0, 4)) expect([...l].length).toBeLessThanOrEqual(columns);
    });
  }
  test('every view draws the same strip row at 38 columns (critique 17 B5: one form on every tab)', () => {
    const first = (v: SidebarView): string => rows(v, 38)[2]!.trimEnd();
    // one form (the chips that fit and `more ›`) whichever tab is lit
    for (const v of ['route', 'team', 'channel', 'gates', 'core', 'board'] as const) expect([v, first(v)]).toEqual([v, first('route')]);
  });
});

// The scorer (round2/tools/live_capture.py parse_frame) recognises the pane by its header: the `◆ ATLAS` pill (it read `▸ SIDEPANEL` before the redesign).
const SCORER_PANE = (text: string): boolean => text.includes('◆ ATLAS');
describe('the 110-column pane carries a pane marker the capture scorer recognises on every view', () => {
  for (const columns of [37, 38, 43, 55]) {
    for (const v of ['route', 'team', 'channel', 'gates', 'core', 'board'] as const) {
      test(`pane ${columns}, ${v}: marker present, strip one row`, () => {
        const text = rows(v, columns).join('\n');
        expect(SCORER_PANE(text)).toBe(true);
        expect(rows(v, columns)[2]!).toMatch(/health/);
      });
    }
  }
});
