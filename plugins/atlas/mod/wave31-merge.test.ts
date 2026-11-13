// Wave 31 merge follow-ups: the key hint lives once at the side panel's foot, the keys are bound by the panel's own strip (not the HUD's removed Button), and the
// panel's phase word is the band's own `bandKindOf`.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandKindOf } from './band';
import { KEY_HINT, PANEL_TABS } from './panel-layout';
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
const hintNodes = (t: Node): Node[] => all(t).filter((x) => x.kind === 'Text' && typeof x.props.children === 'string' && /^r: status/.test(x.props.children.trim()));

describe('c: the key hint is drawn once, at the foot of the side panel', () => {
  test('one dim 240 row of `r: status  t: team ...`, no longer than the pane', () => {
    const t = pane(130);
    const rows = hintNodes(t);
    expect(rows).toHaveLength(1);
    const text = String(rows[0]!.props.children).trim();
    expect(KEY_HINT.startsWith(text)).toBe(true);
    expect(KEY_HINT.startsWith('r: status  t: team  c: channel  g: gates  k: core  o: board  ctrl+x tab')).toBe(true);
    expect(rows[0]!.props.color).toBe('#585858');
    expect([...String(rows[0]!.props.children)].length).toBeLessThanOrEqual(129);
  });
  test('a narrow pane cuts the hint to its width instead of wrapping it', () => {
    const t = pane(40);
    const row = hintNodes(t)[0]!;
    expect([...String(row.props.children)].length).toBeLessThanOrEqual(39);
    expect(String(row.props.children).trim().endsWith('…')).toBe(true);
  });
  test('a pane with no spare row draws no hint (the keys then live only on the strip)', () => {
    expect(hintNodes(pane(130, 8))).toHaveLength(0);
  });
});

describe('c: every advertised key is still bound and pressing it acts (none depended on the HUD Button)', () => {
  test('the panel strip binds r t c g k o and each press reaches its handler', () => {
    const t = pane(130);
    const keyed = all(t).filter((x) => x.kind === 'Button' && x.props.hotkey);
    expect(keyed.map((b) => b.props.hotkey).sort()).toEqual(['c', 'g', 'k', 'o', 'r', 't']);
    expect(PANEL_TABS.map((p) => p.key).sort()).toEqual(['c', 'g', 'k', 'r', 't']);
    calls.length = 0;
    for (const b of keyed) b.props.onPress();
    expect(calls.sort()).toEqual(['board', 'view:channel', 'view:core', 'view:gates', 'view:route', 'view:team']);
  });
  test('the keys stay bound on a bare 56-column strip and on a 36-column one', () => {
    for (const cols of [56, 36]) expect(all(pane(cols)).filter((x) => x.kind === 'Button' && x.props.hotkey).map((b) => b.props.hotkey).sort(), `${cols}`).toEqual(['c', 'g', 'k', 'o', 'r', 't']);
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
