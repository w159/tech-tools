// Band controls: every advertised key is a clickable Button with a unique hotkey, pressing one calls the
// right handler, and the hint text names only keys that exist in that site.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree, type BandHandlers } from './band';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import { sidebarTree, type SidebarHandlers } from './pane/sidebar';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;

const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
const textOf = (n: Node): string => (n.kind === 'Text' || typeof n.props.children === 'string' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const buttons = (n: Node): Node[] => all(n).filter((x) => x.kind === 'Button');
const hotkeys = (n: Node): string[] => buttons(n).map((b) => b.props.hotkey).filter(Boolean);

const calls: string[] = [];
const handlers: BandHandlers = { openView: (v) => calls.push(`open:${v}`), toggleTodos: () => calls.push('board') };
const band = (columns = 160, on: BandHandlers | null = handlers): Node => {
  const snapshot = busySnap();
  return bandTree(els, { snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns, tick: 0, maxRows: 12 }, on ?? undefined) as unknown as Node;
};
const byKey = (root: Node, key: string): Node => {
  const b = buttons(root).find((x) => x.props.key === key);
  if (!b) throw new Error(`no button ${key}`);
  return b;
};

describe('band footer buttons', () => {
  test('route team channel gates board are Buttons with distinct single-letter hotkeys', () => {
    const t = band();
    expect(['route', 'team', 'channel', 'gates', 'board'].map((k) => byKey(t, `band:${k}`).props.hotkey)).toEqual(['r', 't', 'c', 'g', 'o']);
    expect(new Set(hotkeys(t)).size).toBe(hotkeys(t).length);
  });
  test('pressing a button opens that pane view, or toggles the board', () => {
    const t = band();
    for (const k of ['route', 'team', 'channel', 'gates']) byKey(t, `band:${k}`).props.onPress();
    byKey(t, 'band:board').props.onPress();
    expect(calls).toEqual(['open:route', 'open:team', 'open:channel', 'open:gates', 'board']);
  });
  test('the buttons survive the 80-column tier and drop with no handlers', () => {
    expect(buttons(band(90)).length).toBe(5);
    expect(buttons(band(160, null)).length).toBe(0);
  });
  test('the hint states the gesture and every key it lists exists as a hotkey', () => {
    const t = band();
    const hint = textOf(t).match(/click or ctrl\+x Tab, then ((?:[a-z] ?)+)/);
    expect(hint).not.toBeNull();
    expect(hint![1]!.trim().split(' ').sort()).toEqual(hotkeys(t).sort());
  });
});

describe('sidebar hotkeys', () => {
  const side: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} };
  const tree = (view: 'route' | 'team' | 'channel' | 'gates'): Node =>
    sidebarTree(els, { snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: 130, rows: 40 }, side) as unknown as Node;
  test('no view repeats a hotkey', () => {
    for (const v of ['route', 'team', 'channel', 'gates'] as const) expect(new Set(hotkeys(tree(v))).size).toBe(hotkeys(tree(v)).length);
  });
  test('five buttons fit a docked 56-column pane (glyphs drop, keys stay)', () => {
    const t = sidebarTree(els, { snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'route' }, columns: 56, rows: 40 }, side) as unknown as Node;
    const bs = buttons(t).filter((b) => b.props.hotkey);
    expect(bs.map((b) => b.props.hotkey)).toEqual(['r', 't', 'c', 'g', 'o']);
    const strip = bs.reduce((n, b) => n + 3 + [...String(b.props.label)].length, 0) + 3 * (bs.length - 1); // `k: label` plus ' | ' between
    expect(strip).toBeLessThanOrEqual(55);
  });
  test('the hint lists exactly the hotkeys that exist', () => {
    const t = tree('route');
    const hint = textOf(t).match(/press ((?:[a-z] ?)+)/);
    expect(hint).not.toBeNull();
    expect(hint![1]!.trim().split(' ').sort()).toEqual(hotkeys(t).sort());
  });
});
