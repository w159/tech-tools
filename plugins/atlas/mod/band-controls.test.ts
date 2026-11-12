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
  test('route team channel gates core board are Buttons with distinct single-letter hotkeys', () => {
    const t = band();
    expect(['route', 'team', 'channel', 'gates', 'board'].map((k) => byKey(t, `band:${k}`).props.hotkey)).toEqual(['r', 't', 'c', 'g', 'o']);
    expect(new Set(hotkeys(t)).size).toBe(hotkeys(t).length);
  });
  test('pressing a button opens that pane view, or toggles the board', () => {
    const t = band();
    for (const k of ['route', 'team', 'channel', 'gates', 'core']) byKey(t, `band:${k}`).props.onPress();
    byKey(t, 'band:board').props.onPress();
    expect(calls).toEqual(['open:route', 'open:team', 'open:channel', 'open:gates', 'open:core', 'board']);
  });
  test('the buttons are the side panel strip: route, team, channel, gates, core, board (change 9: the same set and order on both hosts)', () => {
    expect(buttons(band()).map((b) => b.props.label)).toEqual(['route', 'team', 'channel', 'gates', 'core', 'board']);
  });
  test('keys show only while idle at 80+ columns: they survive 80, drop at 79 and with no handlers', () => {
    expect(buttons(band(80)).length).toBe(6);
    expect(buttons(band(90)).length).toBe(6);
    expect(buttons(band(79)).length).toBe(0);
    expect(buttons(band(160, null)).length).toBe(0);
  });
  test('a running band carries no buttons and no hint (omp has none)', () => {
    const t = band(160, handlers, true);
    expect(buttons(t).length).toBe(0);
    expect(textOf(t)).not.toMatch(/ctrl\+x/);
  });
  test('C3: the checks and the key buttons are two rows, each exactly the width, the keys flush right', () => {
    const gates = [{ id: 'tripwire', title: 'tripwire', lines: [{ ok: false, label: 'x' }] }] as any;
    const snapshot = busySnap({ squad: [], activity: {}, comms: [] });
    for (const columns of [80, 120, 160]) { // the checks have the whole row now, so they show at 80 too
      const t = bandTree(els, { snapshot, live: [], gates, columns, tick: 0, maxRows: 12 }, handlers) as unknown as Node;
      const [checksRow, keysRow] = kids(t).slice(-2) as [Node, Node];
      expect(textOf(checksRow)).toContain('checks  △ tripwire');
      expect(buttons(checksRow)).toHaveLength(0);
      expect(textOf(keysRow)).not.toContain('checks');
      expect(buttons(keysRow)).toHaveLength(6);
      const width = (row: Node): number => kids(row).reduce((n, k) => n + (k.kind === 'Button' ? 3 + String(k.props.label).length : [...String(k.props.children ?? '')].length), 0);
      expect([columns, width(checksRow)]).toEqual([columns, columns]);
      expect([columns, width(keysRow)]).toEqual([columns, columns]);
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
    expect(hint(140)).toBe(true);
    expect(hint(80)).toBe(true); // the checks gave way to the six keys, so the hint has the room they left
    expect(textOf(band())).not.toMatch(/click or/);
  });
  test('the hint sits two cells after the last key, the same gap as between keys', () => {
    const t = bandTree(els, { snapshot: busySnap({ squad: [], activity: {}, comms: [] }), live: [], gates: [], columns: 160, tick: 0, maxRows: 12 }, handlers) as unknown as Node;
    const tail = textOf(kids(t).at(-1)!);
    expect(tail.endsWith('board  ctrl+x tab ')).toBe(true);
  });
  test('every key the band advertises exists as a hotkey, unique', () => {
    const t = band();
    expect(hotkeys(t).sort()).toEqual(['c', 'g', 'k', 'o', 'r', 't']);
    expect(new Set(hotkeys(t)).size).toBe(6);
  });
});

describe('sidebar hotkeys', () => {
  const side: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} };
  const tree = (view: 'route' | 'team' | 'channel' | 'gates'): Node =>
    sidebarTree(els, { snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: 130, rows: 40 }, side) as unknown as Node;
  test('no view repeats a hotkey', () => {
    for (const v of ['route', 'team', 'channel', 'gates'] as const) expect(new Set(hotkeys(tree(v))).size).toBe(hotkeys(tree(v)).length);
  });
  test('six buttons fit a docked 56-column pane on one strip row (L21)', () => {
    const t = sidebarTree(els, { snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'route' }, columns: 56, rows: 40 }, side) as unknown as Node;
    expect(buttons(t).filter((b) => b.props.hotkey).map((b) => b.props.hotkey)).toEqual(['r', 't', 'c', 'g', 'k', 'o']);
    const rows = (t.props.children as Node[]).filter((n) => n.kind === 'Box' && String(n.props.key ?? '').startsWith('tabs'));
    expect(rows).toHaveLength(1); // `chan` for `channel` makes the whole strip 55 cells: no wrapped second row
    for (const row of rows) {
      const kidsOf = row.props.children as Node[];
      const w = kidsOf.reduce((n, c) => n + (c.kind === 'Button' ? (c.props.hotkey ? 3 : 0) + [...String(c.props.label)].length : c.kind === 'Box' ? 0 : String(c.props.children).length), 0); // the names plus the gaps (the key layer is a zero-width Box)
      expect(w).toBeLessThanOrEqual(55);
    }
  });
  test('the labelled strip is the only hint: every hotkey is drawn as a tab label', () => {
    const t = tree('route');
    expect(hotkeys(t).sort()).toEqual(['c', 'g', 'k', 'o', 'r', 't']);
    for (const b of buttons(t).filter((x) => x.props.hotkey)) expect(String(b.props.label).length).toBeGreaterThan(0);
  });
});

describe('mutation kills (round 2): idle means no worker is still going; a given ui wins over the environment', () => {
  const only = (state: 'failed' | 'running') => {
    const snapshot = busySnap({
      squad: [{ name: 'runner-1', persona: 'runner', state, source: 'task', task: 't' }],
      activity: { lead: { tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '' }, 'runner-1': { tool: state === 'running' ? 'Grep' : null, since: NOW - 1000, toolCount: 1, tokens: 1, mood: state === 'running' ? 'working' : 'failed', lastLine: '' } },
      comms: [],
    });
    return bandTree(els, { snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns: 160, tick: 0, maxRows: 12 }, handlers) as unknown as Node;
  };
  test('a band whose only worker has failed is idle: the key buttons show; with a worker running they do not', () => {
    expect(buttons(only('failed'))).toHaveLength(6);
    expect(buttons(only('running'))).toHaveLength(0);
  });
  test('missionTree paints in the model\'s own theme, not the environment\'s', async () => {
    const { missionTree } = await import('./band');
    const { worldModel } = await import('../contracts/band-world');
    const { PALETTES } = await import('./atlas-ui');
    const tree = missionTree(els, worldModel(120, { theme: 'latte', ascii: false, color: 'truecolor' })) as unknown as Node;
    expect(tree.props.backgroundColor).toBe(PALETTES.latte.panel);
    expect(tree.props.backgroundColor).not.toBe(PALETTES.mocha.panel);
  });
});
