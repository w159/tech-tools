// Slice S3 of the mods expert-grade spec: the side panel on a fixed grid. Section headers sit in cell 2, rows in cell 4, the value column in cell 12; the same
// slots are reserved at idle, working and done so a heading never moves; the phase is one stepper row; the gates are one collapsed row; the close chip sits on the pill row.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv } from '../../design/atlas-ui';
import { bodyLines, headerRows, lineText, ribbonRow, tabRows, type PanelLine, type PanelModel } from './panel-layout';
import { panelWorld } from '../../../contracts/panel-world';
import { NOW } from '../../live_fixture';
import type { Health } from '../../data/idle-health';
import type { Pulse } from '../../data/pulse';
import type { ClientElements } from 'claude-code';
import { busySnap } from '../../live_fixture';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './pane/sidebar';
import { activeChipStyle, chipStyle } from '../../input/clickable';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const check = (id: string, over: Record<string, unknown> = {}) => ({ id, ok: true, title: id, lines: 3, pass: 3, ...over });
const HOOKS = { total: 6, byLabel: [{ label: 'tool.call', n: 3 }, { label: 'session.start', n: 3 }], recent: [{ label: 'prompt.submit', ageSecs: 9 }, { label: 'session.start', ageSecs: 10 }, { label: 'tool.call Bash', ageSecs: 190 }, { label: 'session.measure', ageSecs: 200 }], lastEventSecs: 9 };
const PULSE: Pulse = { events: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 4, 2, 1], ctx: [{ tokens: 20_000, pct: 2, at: 1 }, { tokens: 64_000, pct: 6, at: 2 }], runs: [] };
const health = (over: Partial<Health> = {}): Health => ({
  gates: { total: 4, green: 4, checks: [check('completion', { lines: 1, pass: 1, note: 'Last Stop allowed' }), check('tripwire', { lines: 2, pass: 2, note: 'Team mode: off' }), check('routing', { lines: 8, pass: 8 }), check('header', { lines: 0, pass: 0 })] },
  ctxPct: 6, tokens: 64_000, window: 1_000_000, upSecs: 9, branch: 'master', version: '17.24.0', hooks: HOOKS, pulse: PULSE, ...over,
});
type Kind = 'idle' | 'working' | 'done';
const world = (cols: number, kind: Kind, over: Partial<PanelModel> = {}, h: Health = health()): PanelModel =>
  panelWorld('route', cols, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], phases: ['research', 'theory', 'test', 'implement', 'verify'], phase: kind === 'done' ? 'verify' : 'test', ...(kind === 'idle' ? {} : { entered: kind === 'done' ? ['research', 'theory', 'test', 'implement', 'verify'] : ['research', 'theory', 'test'] }), run: { kind, secs: kind === 'idle' ? 0 : 5, startMs: NOW, frame: 1 }, health: h, ...over } as never);
const body = (m: PanelModel): string[] => bodyLines(m).map(lineText);
const edge = (t: string): number => t.length - t.trimStart().length;
const blankRunAbove = (t: string[], i: number): number => { let n = 0; for (let k = i - 1; k >= 0 && t[k]!.trim() === ''; k--) n++; return n; };
const WIDTHS = [54, 47] as const;
const KINDS: Kind[] = ['idle', 'working', 'done'];

const at = (t: string[], head: string): number => t.findIndex((l) => new RegExp(`^ ── ${head}\\b`).test(l)); // Round 3 (E2): every section opens on a ribbon
const FOOT = 'atlas 17.24.0 · master';


describe('c: recent ages sit in a fixed three-cell column', () => {
});

describe('d: the phase is a stepper of five stages, full names at every width', () => {
  const glyphs = (l: string): string[] => [...l].filter((c) => '●◐◓◑◒○▲■'.includes(c));
  const stepper = (t: string[]): string[] => t.slice(at(t, 'PHASE') + 1, at(t, 'ACTIVITY'));
});

describe('d2: one spin index for the stepper and the band', () => {
  const glyph = (m: PanelModel): string => { const t = body(m); return [...t.slice(at(t, 'PHASE') + 1, at(t, 'ACTIVITY')).join(' ')].find((c) => '◐◓◑◒'.includes(c))!; };
  test('the run frame (the band\'s own index) wins, as the phase mark always did', () => {
    expect([0, 1, 2, 3, 4, 7].map((frame) => glyph(world(54, 'working', { now: 123_456, run: { kind: 'working', secs: 5, startMs: NOW, frame } })))).toEqual(['◐', '◓', '◑', '◒', '◐', '◒']);
  });
  test('with no run frame the clock decides (spinFrameOf of the band\'s spinClock reading)', () => {
    const frameAt = (now: number): string => glyph(world(54, 'working', { now, run: { kind: 'working', secs: 5, startMs: NOW } }));
    expect([0, 100, 200, 300, 400].map(frameAt)).toEqual(['◐', '◓', '◑', '◒', '◐']);
  });
});


describe('f: headings never move between idle, working and done', () => {
});

describe('g: no clock in the panel while working or done', () => {
  for (const cols of WIDTHS) for (const kind of ['working', 'done'] as const) test(`${cols} ${kind}: the run time is the band's alone`, () => {
    const all = [...headerRows(world(cols, kind)).map(lineText), ...body(world(cols, kind))].join('\n');
    expect(all.replace(/up \d+:\d\d(:\d\d)?/g, '')).not.toMatch(/\d:\d\d/);
    expect(all).not.toMatch(/\b(working|done) \d/);
  });
});

describe('h: one chip idiom for the tabs', () => {
});

describe('i: the pill row has no close chip of its own (the host draws `✕`)', () => {
});


describe('elements: the pill row Button and the one chip idiom on screen', () => {
  type Node = { kind: string; props: Record<string, any> };
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
  const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
  const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
  const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
  const on: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} };
  const model: SidebarModel = { snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'route' }, columns: 55, rows: 40, look: ui };
  const tree = (h: SidebarHandlers): Node => sidebarTree(els, model, h) as unknown as Node;
  test('the pane draws no close Button of its own', () => {
    expect(all(tree(on)).filter((n) => n.kind === 'Button' && n.props.key === 'panel:close')).toEqual([]);
    expect(all(tree(on)).some((n) => n.kind === 'Text' && n.props.children === '[✕]')).toBe(false);
  });
});
