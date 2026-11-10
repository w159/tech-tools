// Band controls: every advertised key is a clickable Button with a unique hotkey, pressing one calls the
// right handler, keys show only while idle at 80+ columns, and the sidebar's hint names only keys that exist.
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
/** The idle band (no live worker): the only state that carries the control buttons, as omp draws none while running. */
const band = (columns = 160, on: BandHandlers | null = handlers, running = false): Node => {
  const snapshot = running ? busySnap() : busySnap({ squad: [], activity: {}, comms: [] });
  return bandTree(els, { snapshot, live: running ? liveWorkers(snapshot, NOW) : [], gates: [], columns, tick: 0, maxRows: 12 }, on ?? undefined) as unknown as Node;
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
  test('the buttons are labelled route, team, channel, gates, board (the gates button is `gates`, not `core`)', () => {
    expect(buttons(band()).map((b) => b.props.label)).toEqual(['route', 'team', 'channel', 'gates', 'board']);
    expect(textOf(band())).not.toContain('core');
  });
  test('keys show only while idle at 80+ columns: they survive 80, drop at 79 and with no handlers', () => {
    expect(buttons(band(80)).length).toBe(5);
    expect(buttons(band(90)).length).toBe(5);
    expect(buttons(band(79)).length).toBe(0);
    expect(buttons(band(160, null)).length).toBe(0);
  });
  test('a running band carries no buttons and no hint (omp has none)', () => {
    const t = band(160, handlers, true);
    expect(buttons(t).length).toBe(0);
    expect(textOf(t)).not.toMatch(/ctrl\+x/);
  });
  test('the footer keeps its checks on the left and the keys flush right, the row exactly the width', () => {
    const gates = [{ id: 'tripwire', title: 'tripwire', lines: [{ ok: false, label: 'x' }] }] as any;
    const snapshot = busySnap({ squad: [], activity: {}, comms: [] });
    for (const columns of [80, 120, 160]) {
      const t = bandTree(els, { snapshot, live: [], gates, columns, tick: 0, maxRows: 12 }, handlers) as unknown as Node;
      const foot = kids(t).at(-1)!;
      expect(textOf(foot)).toContain('checks  ✗ tripwire');
      const width = kids(foot).reduce((n, k) => n + (k.kind === 'Button' ? 3 + String(k.props.label).length : [...String(k.props.children ?? '')].length), 0);
      expect(width).toBe(columns);
    }
  });
  test('the hint is `ctrl+x tab`, shown after the keys only when it fits', () => {
    const groups = ['completion', 'tripwire', 'routing', 'verdict'].map((id, i) => ({ id, title: id, lines: [{ ok: i !== 1, label: id }] })) as any;
    const snapshot = busySnap({ squad: [], activity: {}, comms: [] });
    const hint = (columns: number) => {
      const t = bandTree(els, { snapshot, live: [], gates: groups, columns, tick: 0, maxRows: 12 }, handlers) as unknown as Node;
      return textOf(kids(t).at(-1)!).includes('ctrl+x tab');
    };
    expect(hint(160)).toBe(true);
    expect(hint(120)).toBe(true);
    expect(hint(80)).toBe(false);
    expect(textOf(band())).not.toMatch(/click or/);
  });
  test('the hint sits two cells after the last key, the same gap as between keys', () => {
    const t = bandTree(els, { snapshot: busySnap({ squad: [], activity: {}, comms: [] }), live: [], gates: [], columns: 160, tick: 0, maxRows: 12 }, handlers) as unknown as Node;
    const tail = textOf(kids(t).at(-1)!);
    expect(tail.endsWith('board  ctrl+x tab ')).toBe(true);
  });
  test('every key the band advertises exists as a hotkey, unique', () => {
    const t = band();
    expect(hotkeys(t).sort()).toEqual(['c', 'g', 'o', 'r', 't']);
    expect(new Set(hotkeys(t)).size).toBe(5);
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
