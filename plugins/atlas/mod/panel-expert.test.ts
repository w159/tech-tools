// Slice S3 of the mods expert-grade spec: the side panel on a fixed grid. Section headers sit in cell 2, rows in cell 4, the value column in cell 12; the same
// slots are reserved at idle, working and done so a heading never moves; the phase is one stepper row; the gates are one collapsed row; the close chip sits on the pill row.
import { describe, expect, test } from 'claude-code/testing';
import { uiFromEnv } from './atlas-ui';
import { bodyLines, headerRows, lineText, ribbonRow, tabRows, type PanelLine, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { NOW } from './live_fixture';
import type { Health } from './idle-health';
import type { Pulse } from './pulse';
import type { ClientElements } from 'claude-code';
import { busySnap } from './live_fixture';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './pane/sidebar';
import { activeChipStyle, chipStyle } from './clickable';

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
const ruleAt = (t: string[]): number => t.findIndex((l, i) => i > 3 && /^ {2}─{20,}$/.test(l));
const WIDTHS = [54, 47] as const;
const KINDS: Kind[] = ['idle', 'working', 'done'];

describe('a: the gates are one collapsed row, no `checks` section', () => {
  for (const cols of WIDTHS) for (const kind of KINDS) test(`${cols} ${kind}: no checks heading; the collapsed row has names or dots only`, () => {
    const t = body(world(cols, kind));
    expect(t.join('\n')).not.toMatch(/^\s+checks\s*$/m);
    expect(t.join('\n')).not.toMatch(/\d+\/\d+ pass/);
    const row = t.find((l) => /▸ gates/.test(l))!;
    expect(row).toBeDefined();
    expect(row).not.toMatch(/\d\/\d/);
    if (cols >= 54) for (const n of ['completion', 'tripwire', 'routing']) expect(row).toContain(`● ${n}`);
    if (cols >= 54) expect(row).toContain('○ header'); // a gate that never fired is a grey hollow dot
    else expect(row).toMatch(/● ● ● ○/);
  });
  for (const cols of WIDTHS) test(`${cols}: opened, each gate is one \`● name 8 pass · 0 deny\` row once, its note on its own indented line`, () => {
    const t = body(world(cols, 'idle', { expanded: 'health:gates' }));
    const text = t.join('\n');
    expect(text).toContain('▾ gates');
    for (const [g, n, c] of [['●', 'completion', '1 pass · 0 deny'], ['●', 'tripwire', '2 pass · 0 deny'], ['●', 'routing', '8 pass · 0 deny'], ['○', 'header', 'not fired']] as const) expect(text.match(new RegExp(`${g} ${n}\\s+${c}`, 'g'))?.length, n).toBe(1);
    const note = t.findIndex((l) => l.includes('Last Stop allowed'));
    expect(note).toBeGreaterThan(t.findIndex((l) => /● completion/.test(l)));
    expect(edge(t[note]!)).toBeGreaterThan(4);
    expect(t[note]).not.toMatch(/●/);
  });
});

describe('b: the grid — headers in cell 2, rows in cell 4, one value column', () => {
  for (const cols of WIDTHS) for (const kind of KINDS) test(`${cols} ${kind}: every body row starts in cell 2 or 4; labelled values start in cell 12`, () => {
    const t = body(world(cols, kind)).filter((l) => l.trim() !== '');
    for (const l of t) {
      const age = /^ {4}( \d|\d\d)[smh]  \S/.test(l); // an age cell is fixed three cells wide in cell 4
      expect([2, 4], l).toContain(age ? 4 : edge(l));
    }
    for (const label of ['events', 'context', 'runs', 'gates', 'session']) {
      const l = t.find((x) => new RegExp(`^ {2,4}(▸ |▾ )?${label}\\b`).test(x))!;
      expect(l, label).toBeDefined();
      expect(l.search(/\S/) === 2 || l.search(/\S/) === 4).toBe(true);
      expect(l.slice(12).search(/\S/), `${label} value`).toBe(0);
      expect(l.slice(0, 12).trim().replace(/^[▸▾] /, ''), label).toBe(label);
    }
  });
});

describe('c: recent ages sit in a fixed three-cell column', () => {
  for (const cols of WIDTHS) test(`${cols}: 9s and 10s share the message column, no "ago"`, () => {
    const t = body(world(cols, 'idle'));
    const at = t.findIndex((l) => l.trim() === 'recent');
    const rows = t.slice(at + 1).filter((l) => /^ {4}( \d|\d\d)[smh]/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows[0]!.slice(4, 7)).toBe(' 9s');
    expect(rows[1]!.slice(4, 7)).toBe('10s');
    expect(rows[0]!.search(/[a-z]{3,}/)).toBe(rows[1]!.search(/[a-z]{3,}/));
    expect(rows[2]!.slice(4, 7)).toBe(' 3m');
    expect(t.join('\n')).not.toMatch(/\bago\b/);
  });
});

describe('d: the phase is one stepper row of five stages', () => {
  const glyphs = (l: string): string[] => [...l].filter((c) => '●◐◓◑◒○▲■'.includes(c));
  for (const cols of WIDTHS) {
    test(`${cols}: idle is five ○, no \`phase ○ idle\` row`, () => {
      const t = body(world(cols, 'idle'));
      const at = t.findIndex((l) => l.trim() === 'phase');
      expect(at).toBeGreaterThanOrEqual(0);
      expect(glyphs(t[at + 1]!)).toEqual(['○', '○', '○', '○', '○']);
      expect(t.join('\n')).not.toMatch(/phase +[○●◐]/);
      expect(t.join('\n')).not.toContain(' idle');
    });
    test(`${cols}: working is ● ● ◐ ○ ○ (the spinner is the band's frame), done is five ●`, () => {
      const w = body(world(cols, 'working'));
      const wi = w.findIndex((l) => l.trim() === 'phase');
      expect(glyphs(w[wi + 1]!).map((g, i) => (i === 2 ? ('◐◓◑◒'.includes(g) ? 'spin' : g) : g))).toEqual(['●', '●', 'spin', '○', '○']);
      const d = body(world(cols, 'done'));
      expect(glyphs(d[d.findIndex((l) => l.trim() === 'phase') + 1]!)).toEqual(['●', '●', '●', '●', '●']);
    });
  }
  test('54 names the stages whole, 47 abbreviates them', () => {
    const row = (cols: number): string => { const t = body(world(cols, 'idle')); return t[t.findIndex((l) => l.trim() === 'phase') + 1]!; };
    expect(row(54)).toContain('implement');
    expect(row(47)).toContain('res');
    expect(row(47)).toMatch(/res .*thy .*tst .*imp .*ver/);
    expect(row(47)).not.toContain('implement');
  });
  test('the spinner turns the frame the band turns (the run frame), not a reading of its own', () => {
    const at = (frame: number): string => { const t = body(world(54, 'working', { run: { kind: 'working', secs: 5, startMs: NOW, frame } })); return glyphs(t[t.findIndex((l) => l.trim() === 'phase') + 1]!)[2]!; };
    const frames = [0, 1, 2, 3].map(at);
    expect(new Set(frames).size).toBe(4);
  });
});

describe('d2: one spin index for the stepper and the band', () => {
  const glyph = (m: PanelModel): string => { const t = body(m); return [...t[t.findIndex((l) => l.trim() === 'phase') + 1]!].find((c) => '◐◓◑◒'.includes(c))!; };
  test('the run frame (the band\'s own index) wins, as the phase mark always did', () => {
    expect([0, 1, 2, 3, 4, 7].map((frame) => glyph(world(54, 'working', { now: 123_456, run: { kind: 'working', secs: 5, startMs: NOW, frame } })))).toEqual(['◐', '◓', '◑', '◒', '◐', '◒']);
  });
  test('with no run frame the clock decides (spinFrameOf of the band\'s spinClock reading)', () => {
    const at = (now: number): string => glyph(world(54, 'working', { now, run: { kind: 'working', secs: 5, startMs: NOW } }));
    expect([0, 100, 200, 300, 400].map(at)).toEqual(['◐', '◓', '◑', '◒', '◐']);
  });
});

describe('e: at most three blank rows above the closing rule', () => {
  for (const cols of WIDTHS) for (const kind of KINDS) test(`${cols} ${kind}`, () => {
    const t = body(world(cols, kind));
    const rule = ruleAt(t);
    expect(rule).toBeGreaterThan(0);
    expect(blankRunAbove(t, rule)).toBeLessThanOrEqual(3);
    expect(t[rule + 1]).toBe('  atlas 17.24.0 · hooks loaded');
  });
  test('with no hook events yet the recent slots stay and the gap is still at most three', () => {
    const t = body(world(54, 'idle', {}, health({ hooks: undefined })));
    expect(blankRunAbove(t, ruleAt(t))).toBeLessThanOrEqual(3);
  });
});

describe('f: headings never move between idle, working and done', () => {
  for (const cols of WIDTHS) test(`${cols}: the line index of each heading is equal`, () => {
    const idx = (kind: Kind): number[] => { const t = body(world(cols, kind)); return ['phase', 'pulse', 'health', 'recent'].map((h) => t.findIndex((l) => l.trim() === h)); };
    const a = idx('idle');
    expect(a.every((i) => i >= 0)).toBe(true);
    expect(idx('working')).toEqual(a);
    expect(idx('done')).toEqual(a);
    const rule = (kind: Kind): number => ruleAt(body(world(cols, kind)));
    expect(rule('working')).toBe(rule('idle'));
    expect(rule('done')).toBe(rule('idle'));
  });
});

describe('g: no clock in the panel while working or done', () => {
  for (const cols of WIDTHS) for (const kind of ['working', 'done'] as const) test(`${cols} ${kind}: the run time is the band's alone`, () => {
    const all = [...headerRows(world(cols, kind)).map(lineText), ...body(world(cols, kind))].join('\n');
    expect(all.replace(/up \d+:\d\d(:\d\d)?/g, '')).not.toMatch(/\d:\d\d/);
    expect(all).not.toMatch(/\b(working|done) \d/);
  });
});

describe('h: one chip idiom for the tabs', () => {
  test('the lit tab is the accent fill in bold, the others the raised tile, with one cell between', () => {
    for (const cols of [54, 47]) {
      const [row] = tabRows(world(cols, 'idle'));
      const chips = row!.runs.filter((x) => x.t.trim() !== '');
      const lit = chips.filter((x) => x.bg === 'accent');
      expect(lit.length).toBe(1);
      expect(lit[0]!.bold).toBe(true);
      expect(lit[0]!.t.trim()).toBe('status');
      for (const x of chips.filter((c) => c.bg !== 'accent')) expect(x.bgHex, x.t).toBeDefined();
      const gaps = row!.runs.filter((x) => x.t.trim() === '' && x.t.length > 0 && x !== row!.runs[0] && x !== row!.runs.at(-1));
      expect(gaps.map((x) => x.t.length), 'one cell between chips').toEqual(gaps.map(() => 1));
    }
  });
});

describe('i: the close chip is on the pill row and is a press target', () => {
  test('`[✕]` ends the pill row, one cell in from the edge; no separate row', () => {
    for (const cols of [54, 47]) {
      const m = world(cols, 'idle', { close: true } as never);
      const row = ribbonRow(m);
      const text = lineText(row);
      expect(text.startsWith('◖ ◆ ATLAS ◗ ▸ SIDEPANEL')).toBe(true);
      expect(text.endsWith('[✕] ')).toBe(true);
      expect(text.length).toBe(cols);
      const chip = row.runs.find((x) => x.t === '[✕]')!;
      expect(chip).toMatchObject({ press: 'panel:close', tone: 'accent', bold: true });
      expect(headerRows(m).map(lineText).filter((l) => l.includes('✕')).length).toBe(1);
    }
  });
  test('without a close handler the pill row is as it was', () => {
    expect(lineText(ribbonRow(world(54, 'idle')))).not.toContain('✕');
  });
});

describe('j: the team tab with nobody dispatched shows the same summary', () => {
  for (const cols of WIDTHS) test(`${cols}: one \`no workers yet\` line, then pulse and health, at most three blanks over the rule`, () => {
    const m = panelWorld('team', cols, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], run: { kind: 'idle', secs: 0, startMs: NOW, frame: 0 }, lead: { name: 'lead', role: 'lead', state: 'waiting', detail: '' }, health: health() } as never);
    const t = body(m);
    expect(t.filter((l) => l.includes('no workers yet')).length).toBe(1);
    expect(t.findIndex((l) => l.trim() === 'pulse')).toBeGreaterThan(t.findIndex((l) => l.includes('no workers yet')));
    expect(t.findIndex((l) => l.trim() === 'health')).toBeGreaterThan(0);
    const rule = ruleAt(t);
    expect(rule).toBeGreaterThan(0);
    expect(blankRunAbove(t, rule)).toBeLessThanOrEqual(3);
    const lines: PanelLine[] = bodyLines(m);
    expect(lines.length).toBeLessThan(40);
  });
});

describe('elements: the pill row Button and the one chip idiom on screen', () => {
  type Node = { kind: string; props: Record<string, any> };
  const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
  const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
  const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
  const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
  const calls: string[] = [];
  const on: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {}, close: () => calls.push('close') };
  const model: SidebarModel = { snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', view: 'route' }, columns: 55, rows: 40, look: ui };
  const tree = (h: SidebarHandlers): Node => sidebarTree(els, model, h) as unknown as Node;
  test('the close chip is a dismiss Button on the pill row (the first row of the pane) and presses the close handler', () => {
    const root = tree(on);
    const first = kids(root)[0]!;
    const b = all(first).find((n) => n.kind === 'Button')!;
    expect(b.props).toMatchObject({ key: 'panel:close', role: 'dismiss', plain: true });
    expect(all(b).find((n) => n.kind === 'Text')!.props.children).toBe('[✕]');
    b.props.onPress();
    expect(calls).toEqual(['close']);
    expect(all(tree({ ...on, close: undefined })).filter((n) => n.kind === 'Button' && n.props.key === 'panel:close')).toEqual([]);
  });
  test('the lit tab wears activeChipStyle, the others the raised tile (chipStyle) with a hover style', () => {
    const root = tree(on);
    const tabs = all(root).filter((n) => n.kind === 'Button' && String(n.props.key).startsWith('tab:'));
    const text = (n: Node): Node => all(n).find((x) => x.kind === 'Text')!;
    const lit = text(tabs.find((t) => t.props.key === 'tab:route')!).props;
    expect(lit).toMatchObject({ ...activeChipStyle(ui) });
    expect(lit.inverse).toBeUndefined();
    for (const t of tabs.filter((x) => x.props.key !== 'tab:route')) {
      const p = text(t).props;
      expect(p.backgroundColor, t.props.key).toBe(chipStyle(ui).backgroundColor);
      expect(p.hover, t.props.key).toBeDefined();
    }
  });
});
