// Live defect (round2 live-110 at e4a8186a, board 0.0): the board view in the 110-column pane drew the bare tab strip (`route team channel ...`)
// under a `▸ BOARD` ribbon, so nothing in the pane named a hotkey or the SIDEPANEL and the capture could not tell the pane from a toast box.
// The board view keeps the keys on screen (`r: route`) at a narrow pane too: the strip wraps onto a second row, as it does where the words do not fit one.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './sidebar';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
// As the host draws it: a Button with a hotkey reads `k: label`, the zero-width key layer of a bare strip paints nothing.
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : (n.kind === 'Button' && n.props.hotkey ? `${String(n.props.hotkey)}: ` : '') + kids(n).map(textOf).join(''));
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui = { theme: 'mocha', ascii: false, color: 'truecolor' } as const;
const todo = (i: number) => ({ id: `t${i}`, content: `T${i} item`, status: 'completed', owner: null });
const rows = (view: SidebarView, columns: number): string[] =>
  kids(sidebarTree(els, {
    snapshot: { ...busySnap(), squad: [], activity: {}, comms: [], phase: 'implement', now: NOW, todos: [1, 2, 3, 4, 5].map(todo) } as never, gates: [],
    ui: { recipient: null, expanded: null, draft: '', view }, columns, rows: 40, look: ui,
  } as SidebarModel, on) as unknown as Node).map(textOf);

describe('the board view in a narrow pane draws the one-row word strip (critique 18)', () => {
  for (const columns of [38, 37, 43]) {
    test(`pane ${columns}: the six words are one row, the ▸ BOARD ribbon names the pane, the rule sits under board, no row is wider than the pane`, () => {
      const r = rows('board', columns).join('\n').split('\n');
      expect(r[0]).toContain('▸ BOARD');
      expect(r[2]!.trim().replace(/ +/g, ' ')).toBe('route team channel gates core board');
      const rule = r.findIndex((l, i) => i > 1 && /^ *━+ *$/.test(l));
      expect(rule).toBe(3); // the strip is not wrapped: the rule follows the one strip row
      expect(r[2]!.indexOf('board')).toBe(r[rule]!.indexOf('━'));
      for (const l of r.slice(0, rule + 1)) expect([...l].length).toBeLessThanOrEqual(columns);
    });
  }
  test('every view draws the same strip row at 38 columns (critique 17 B5: one form on every tab)', () => {
    const first = (v: SidebarView): string => rows(v, 38)[2]!.trimEnd();
    for (const v of ['route', 'team', 'channel', 'gates', 'core', 'board'] as const) expect([v, first(v)]).toEqual([v, ' route team channel gates core board']);
  });
});
