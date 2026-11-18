// Wave 43: the mod prints no keyboard key hint (the host's hotkeys do not work for the owner) and every Button wears the one clickable look (mod/input/clickable.ts):
// a leading chevron in the accent with a hover style, or, for a tab, an accent chip (the lit tab filled) with a hover style.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree, type BandHandlers, type BandModel } from '../view/band/band';
import { liveWorkers } from '../data/live';
import { busySnap, NOW } from '../live_fixture';
import { uiFromEnv } from '../atlas-ui';
import { fillRows, headerRows, lineText, panelLines } from '../panel-layout';
import * as panelLayout from '../panel-layout';
import { sidebarTree, type GateGroup, type SidebarHandlers } from '../pane/sidebar';
import { panelWorld } from '../../contracts/panel-world';
import { activeChipStyle } from './clickable';
import { bandKindOf } from '../view/band/band';
import { PANEL_TABS } from '../panel-layout';
import { bandKind } from '../pane/band-kind';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
/** Every string the tree prints: Text children, an Input's label and placeholder. */
const printed = (n: Node): string[] => all(n).flatMap((x) => (x.kind === 'Text' && typeof x.props.children === 'string' ? [x.props.children] : x.kind === 'Input' ? [x.props.label, x.props.placeholder].filter((s): s is string => typeof s === 'string') : []));
const buttons = (n: Node): Node[] => all(n).filter((x) => x.kind === 'Button');

const HINTS: RegExp[] = [/\b[a-z]: (status|team|channel|gates|core|board)\b/, /ctrl\+/i, /Enter sends/, /⌃/, /\bshift\+/i];
const noHints = (rows: string[], where: string): void => { for (const row of rows) for (const re of HINTS) expect(re.test(row), `${where}: ${row}`).toBe(false); };

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const bandOn: BandHandlers = { openView() {}, toggleTodos() {}, toggleHealth() {} };
const idleSnap = busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 18 } as never);
const HEALTH = { upSecs: 724, version: '17.21.1', branch: 'main', tokens: 42_000, open: false };
const bandOf = (columns: number, working: boolean): Node => {
  const snapshot = working ? busySnap() : idleSnap;
  const m: BandModel = { snapshot, live: working ? liveWorkers(snapshot, NOW) : [], gates: [], columns, tick: 0, maxRows: 12, ui, health: working ? undefined : HEALTH };
  return bandTree(els, m, bandOn) as unknown as Node;
};

const side: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, toggleTodos() {} };
const open: GateGroup[] = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'verify', label: 'verification coverage', ok: false, fix: 'run it' } as never] }];
const VIEWS = ['route', 'team', 'channel', 'gates', 'core', 'board'] as const;
const pane = (columns: number, view: (typeof VIEWS)[number], working: boolean, expanded: string | null = null): Node =>
  sidebarTree(els, { snapshot: { ...(working ? busySnap() : idleSnap), now: NOW }, gates: open, ui: { recipient: null, expanded, draft: '', view }, columns, rows: 45 }, side) as unknown as Node;

describe('no printed key hints', () => {
  for (const cols of [150, 110]) {
    for (const working of [false, true]) {
      test(`band at ${cols} (${working ? 'working' : 'idle'}) prints no key hint`, () => noHints(printed(bandOf(cols, working)), `band ${cols}`));
      for (const view of VIEWS) {
        test(`side panel ${view} at ${cols} (${working ? 'working' : 'idle'}) prints no key hint`, () => noHints(printed(pane(cols, view, working)), `${view} ${cols}`));
      }
    }
  }
  test('the shared layout has no KEY_HINT and its spare rows name no key', () => {
    expect('KEY_HINT' in panelLayout).toBe(false);
    for (const tab of ['route', 'team', 'channel', 'gates', 'core'] as const) {
      const m = panelWorld(tab, 130, ui, { rows: 60 } as never);
      noHints([...fillRows(m, 3), ...headerRows(m), ...panelLines(m)].map(lineText), `layout ${tab}`);
    }
  });
  test('the message field placeholder is `message`', () => {
    const input = all(pane(150, 'team', true)).find((x) => x.kind === 'Input')!;
    expect(input.props.placeholder).toBe('message');
  });
  test('no Button binds a hotkey', () => {
    for (const t of [bandOf(150, false), pane(150, 'team', true), pane(110, 'route', false), pane(60, 'gates', true)]) for (const b of buttons(t)) expect(b.props.hotkey, String(b.props.key)).toBeUndefined();
  });
});

describe('every Button looks clickable', () => {
  const CHEVRON = /^[▸▾▹▿>v+]( |$)/;
  const looks = (b: Node): void => {
    const texts = all(b).filter((x) => x.kind === 'Text');
    expect(texts.length, String(b.props.key)).toBeGreaterThan(0);
    for (const t of texts) expect(t.props.hover, `${b.props.key} hover`).toBeDefined();
    const first = texts[0]!.props;
    const chip = /^(band|tab):/.test(String(b.props.key)); // round 3 (E8): the `▸ health` button is a chip too, the band's only one
    const later = /#[1-9]\d*$/.test(String(b.props.key)); // a multi-piece chip (`band:gates#0..2`): only its first piece opens with the chip's leading cell
    if (chip && later) expect(first.bold === true, `${b.props.key} bold`).toBe(true);
    else if (chip) { expect(String(first.children), String(b.props.key)).toMatch(/^ \S.* $/); expect(first.bold === true || first.inverse === true, `${b.props.key} bold`).toBe(true); }
    else expect(String(first.children), String(b.props.key)).toMatch(CHEVRON);
  };
  for (const cols of [150, 110]) {
    test(`band buttons at ${cols}`, () => { const bs = buttons(bandOf(cols, false)); expect(bs.map((b) => String(b.props.key).split('#')[0]).filter((k, i, a) => a.indexOf(k) === i)).toEqual(['band:gates','band:health']); bs.forEach(looks); }); // round 2 D9: the tab chips live only in the panel
    for (const view of VIEWS) {
      test(`side panel ${view} buttons at ${cols}`, () => { const bs = buttons(pane(cols, view, true)); expect(bs.length).toBeGreaterThan(0); bs.forEach(looks); });
    }
    test(`the idle status view buttons at ${cols}`, () => buttons(pane(cols, 'route', false)).forEach(looks));
  }
  test('the lit tab is a filled chip, the others are not', () => {
    const strip = buttons(pane(150, 'gates', true)).filter((b) => String(b.props.key).startsWith('tab:'));
    expect(strip.length).toBe(6);
    const litStyle = activeChipStyle(uiFromEnv()); // slice S3: the lit chip is the one activeChipStyle (the accent fill; inverse with no colour)
    const lit = strip.filter((b) => all(b).some((x) => x.kind === 'Text' && x.props.inverse === litStyle.inverse && x.props.backgroundColor === litStyle.backgroundColor));
    expect(lit.map((b) => b.props.key)).toEqual(['tab:gates']);
  });
});

describe('wave31-merge', () => {
// Wave 31 merge follow-ups (wave 43: no key hint is printed and no key is bound; the panel strip is click chips) and the panel phase word, which is the band's own `bandKindOf`.

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
});
