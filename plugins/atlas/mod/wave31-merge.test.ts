// Wave 31 merge follow-ups (wave 43: no key hint is printed and no key is bound; the panel strip is click chips) and the panel phase word, which is the band's own `bandKindOf`.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandKindOf } from './band';
import { PANEL_TABS } from './panel-layout';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import { bandKind } from './pane/band-kind';
import { sidebarTree, type SidebarHandlers } from './pane/sidebar';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];

const calls: string[] = [];
const side: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView: (v) => calls.push(`view:${v}`), toggleTodos: () => calls.push('board') };
const pane = (columns: number, rows = 60, view: 'route' | 'team' | 'channel' | 'gates' = 'team'): Node =>
  sidebarTree(els, { snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows }, side) as unknown as Node;

describe('c: no key hint is drawn anywhere in the side panel (wave 43)', () => {
  test('no row reads `r: status  t: team ...` or `ctrl+x tab`, at any width or height', () => {
    for (const [cols, rows] of [[130, 60], [40, 60], [130, 8]] as const) {
      const texts = all(pane(cols, rows)).filter((x) => x.kind === 'Text' && typeof x.props.children === 'string').map((x) => String(x.props.children));
      expect(texts.filter((t) => /\b[a-z]: (status|team|channel|gates|core|board)\b|ctrl\+/.test(t)), `${cols}x${rows}`).toEqual([]);
    }
  });
});

describe('c: every tab is a click chip and pressing it acts (no key is bound)', () => {
  test('the panel strip has six chips without a hotkey and each press reaches its handler', () => {
    const t = pane(130);
    const chips = all(t).filter((x) => x.kind === 'Button' && String(x.props.key).startsWith('tab:'));
    expect(chips).toHaveLength(6);
    expect(chips.map((b) => b.props.hotkey)).toEqual(Array(6).fill(undefined));
    expect(PANEL_TABS.map((p) => p.id)).toEqual(['route', 'team', 'channel', 'gates', 'core']);
    calls.length = 0;
    for (const b of chips) b.props.onPress();
    expect(calls.sort()).toEqual(['board', 'view:channel', 'view:core', 'view:gates', 'view:route', 'view:team']);
  });
  test('the chips stay on a 56-column strip and on a 36-column one, still without a hotkey', () => {
    for (const [cols, count] of [[56, 6], [36, 3 + 1]] as const) { // 36: three tab chips and the `more ›` chip (D14)
      const chips = all(pane(cols)).filter((x) => x.kind === 'Button' && String(x.props.key).startsWith('tab:'));
      expect(chips, `${cols}`).toHaveLength(count);
      expect(chips.every((b) => b.props.hotkey === undefined)).toBe(true);
    }
  });
});

describe('b: the panel phase is the band\'s own bandKindOf', () => {
  test('bandKind returns what band.bandKindOf returns, idle and running', () => {
    const idle = busySnap({ squad: [], activity: {}, comms: [] });
    const run = busySnap();
    for (const [snapshot, live] of [[idle, []], [run, liveWorkers(run, NOW)]] as const) {
      const b = { snapshot, live, gates: [], columns: 150, tick: 0, maxRows: 12 } as never;
      expect(bandKind(b)).toBe(bandKindOf(b));
    }
  });
});
