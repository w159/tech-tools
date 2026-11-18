// Band controls (wave 43): every tab is a clickable chip Button without a hotkey (no key is bound or printed), pressing one calls the
// right handler, and the chips show only while idle at 80+ columns.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree, type BandHandlers } from './band';
import { liveWorkers } from '../../data/live';
import { busySnap, NOW } from '../../live_fixture';
import { sidebarTree, type SidebarHandlers } from '../../pane/sidebar';

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
/** A chip's drawn width: its Text (the label with a space each side). */
const chipW = (b: Node): number => [...String(kids(b)[0]!.props.children)].length;

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
  test('route team channel gates core board are chip Buttons with no hotkey', () => {
    const t = band();
    expect(['route', 'team', 'channel', 'gates', 'board'].map((k) => byKey(t, `band:${k}`).props.hotkey)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(hotkeys(t)).toEqual([]);
    expect(kids(byKey(t, 'band:route'))[0]!.props.children).toBe(' status ');
  });
  test('pressing a button opens that pane view, or toggles the board', () => {
    const t = band();
    for (const k of ['route', 'team', 'channel', 'gates', 'core']) byKey(t, `band:${k}`).props.onPress();
    byKey(t, 'band:board').props.onPress();
    expect(calls).toEqual(['open:route', 'open:team', 'open:channel', 'open:gates', 'open:core', 'board']);
  });
  test('the buttons are the side panel strip: route, team, channel, gates, core, board (change 9: the same set and order on both hosts)', () => {
    expect(buttons(band()).map((b) => b.props.label)).toEqual(['status', 'team', 'channel', 'gates', 'core', 'board']); // wave 36: the first tab reads status; its key and view stay r / route
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
      const width = (row: Node): number => kids(row).reduce((n, k) => n + (k.kind === 'Button' ? chipW(k) : [...String(k.props.children ?? '')].length), 0);
      expect([columns, width(checksRow)]).toEqual([columns, columns]);
      expect([columns, width(keysRow)]).toEqual([columns, columns]);
    }
  });
  test('no hint follows the chips at any width: the band prints no key and no `ctrl+x tab`', () => {
    const groups = ['completion', 'tripwire', 'routing', 'verdict'].map((id, i) => ({ id, title: id, lines: [{ ok: i !== 1, label: id }] })) as any;
    const snapshot = busySnap({ squad: [], activity: {}, comms: [] });
    for (const columns of [160, 140, 80]) {
      const t = bandTree(els, { snapshot, live: [], gates: groups, columns, tick: 0, maxRows: 12 }, handlers) as unknown as Node;
      expect(textOf(kids(t).at(-1)!), `${columns}`).not.toMatch(/ctrl\+|tab\s*$/);
    }
    expect(textOf(band())).not.toMatch(/click or/);
  });
  test('the chips sit one cell apart (each its own tile) and end one cell before the edge', () => {
    const t = bandTree(els, { snapshot: busySnap({ squad: [], activity: {}, comms: [] }), live: [], gates: [], columns: 160, tick: 0, maxRows: 12 }, handlers) as unknown as Node;
    const row = kids(kids(t).at(-1)!);
    expect(textOf(kids(t).at(-1)!).endsWith(' status   team   channel   gates   core   board  ')).toBe(true);
    expect(row.at(-1)!.props.children).toBe(' ');
  });
  test('no hotkey is bound on any band button', () => {
    expect(hotkeys(band())).toEqual([]);
  });
});

describe('sidebar chips (no hotkeys)', () => {
  const side: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} };
  const tree = (view: 'route' | 'team' | 'channel' | 'gates'): Node =>
    sidebarTree(els, { snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: 130, rows: 40 }, side) as unknown as Node;
  test('no view binds a hotkey', () => {
    for (const v of ['route', 'team', 'channel', 'gates'] as const) expect(hotkeys(tree(v))).toEqual([]);
  });
  test('six buttons fit a docked 56-column pane on one strip row (L21)', () => {
    const t = sidebarTree(els, { snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'route' }, columns: 56, rows: 40 }, side) as unknown as Node;
    expect(hotkeys(t)).toEqual([]);
    const rows = (t.props.children as Node[]).filter((n) => n.kind === 'Box' && String(n.props.key ?? '').startsWith('tabs'));
    expect(rows).toHaveLength(1); // `chan` for `channel` makes the whole strip 55 cells: no wrapped second row
    for (const row of rows) {
      const kidsOf = row.props.children as Node[];
      const w = kidsOf.reduce((n, c) => n + (c.kind === 'Button' ? chipW(c) : c.kind === 'Box' ? 0 : String(c.props.children).length), 0); // the chips plus any gaps
      expect(w).toBeLessThanOrEqual(56);
    }
  });
  test('the strip is click chips: every tab is a Button with a label and no hotkey', () => {
    const t = tree('route');
    expect(hotkeys(t)).toEqual([]);
    for (const b of buttons(t).filter((x) => String(x.props.key).startsWith('tab:'))) expect(String(b.props.label).length).toBeGreaterThan(0);
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
    const { worldModel } = await import('../../../contracts/band-world');
    const { PALETTES } = await import('../../atlas-ui');
    const tree = missionTree(els, worldModel(120, { theme: 'latte', ascii: false, color: 'truecolor' })) as unknown as Node;
    expect(tree.props.backgroundColor).toBe(PALETTES.latte.panel);
    expect(tree.props.backgroundColor).not.toBe(PALETTES.mocha.panel);
  });
});
