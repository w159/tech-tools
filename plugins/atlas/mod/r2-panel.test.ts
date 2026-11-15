// Round 2 panel and card rules (spec-r2 D1, D8, D11, D12, D13, D14 and the band slack ticker): the side panel fills its height with a pinned footer, one chip idiom, inert uppercase headers,
// phases and gates without cryptic forms at any width, each tab owns its body, and the health card shows only while the panel is closed.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements, EngineInterface, On } from 'claude-code';
import { uiFromEnv, type Run, type Ui } from './atlas-ui';
import { chipStyle } from './clickable';
import { healthCardRows } from './hud-surface';
import { bodyLines, headerRows, lineText, panelLines, ribbonRow, tabRows, type PanelLine, type PanelModel, type PanelTab } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { goldenModel } from './pane/sidebar.golden-cases';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './pane/sidebar';
import { bandTree, type BandHandlers, type BandModel } from './band';
import { busySnap, NOW } from './live_fixture';
import { register, resetCore } from './register';
import { memState } from './test_helpers';
import { textWidth } from './theme';
import type { Health } from './idle-health';
import type { Pulse } from './pulse';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const green = (id: string, lines = 8) => ({ id, ok: true, lines, pass: lines });
const PHASES = ['research', 'theory', 'test', 'implement', 'verify'];
const RECENT = [
  { label: 'turn.complete', ageSecs: 3 }, { label: 'tool.call Bash', ageSecs: 5 }, { label: 'session.measure', ageSecs: 9 }, { label: 'tool.call Read', ageSecs: 12 }, { label: 'tool.call Edit', ageSecs: 15 },
  { label: 'prompt.submit', ageSecs: 21 }, { label: 'tool.call Bash', ageSecs: 34 }, { label: 'classic.Stop blocked', ageSecs: 40 }, { label: 'tool.call Grep', ageSecs: 55 }, { label: 'tool.call Glob', ageSecs: 70 },
  { label: 'tool.call Bash', ageSecs: 95 }, { label: 'tool.call Read', ageSecs: 130 }, { label: 'tool.call Read', ageSecs: 190 }, { label: 'tool.call Bash', ageSecs: 250 }, { label: 'session.start', ageSecs: 400 },
  { label: 'tool.call Bash', ageSecs: 500 }, { label: 'tool.call Bash', ageSecs: 600 }, { label: 'tool.call Bash', ageSecs: 700 }, { label: 'tool.call Bash', ageSecs: 800 }, { label: 'tool.call Bash', ageSecs: 900 },
  ...Array.from({ length: 20 }, (_, i) => ({ label: 'tool.call Bash', ageSecs: 1000 + i * 60 })),
];
const health = (over: Partial<Health> = {}): Health => ({
  gates: { total: 4, green: 3, checks: [green('completion'), green('tripwire'), green('routing'), { id: 'header', ok: true, lines: 0, pass: 0 }] },
  ctxPct: 6, tokens: 64_000, window: 1_000_000, upSecs: 36, branch: 'master', version: '17.24.0',
  hooks: { total: 20, byLabel: [], recent: RECENT, lastEventSecs: 3 },
  pulse: { events: [0, 0, 1, 2, 5, 3, 0, 0, 1], ctx: [], runs: [{ secs: 5, ok: true, at: 1 }, { secs: 7, ok: false, at: 2 }] },
  ...over,
});
type Kind = 'idle' | 'working' | 'done';
const world = (cols: number, rows: number, kind: Kind = 'working', over: Partial<PanelModel> = {}): PanelModel =>
  panelWorld('route', cols, ui, { rows, phases: PHASES, phase: 'theory', entered: ['research', 'theory'], todos: [], workers: [], gates: [], notes: [], run: { kind, secs: 5, startMs: NOW, frame: 0 }, health: health(), ...over } as never);
const text = (m: PanelModel): string[] => panelLines(m).map((l) => lineText(l).trimEnd());
const FOOT = 'atlas 17.24.0 · hooks loaded';

describe('D11: the panel fills its height, the footer is the last row', () => {
  for (const cols of [54, 47, 37]) for (const rows of [24, 30, 40, 48]) for (const kind of ['idle', 'working', 'done'] as Kind[]) {
    test(`${cols}x${rows} ${kind}: exactly ${rows} rows and the footer on the last`, () => {
      const t = text(world(cols, rows, kind));
      expect(t).toHaveLength(rows);
      expect(t[rows - 1]!.trim()).toBe(FOOT);
    });
  }
  test('the footer is the last row and no rule is drawn above it (round 3: the ribbons are the only rules)', () => {
    const t = text(world(54, 40));
    expect(t[39]!.trim()).toBe(FOOT);
    expect(t.slice(-3, -1).some((l) => /^─{10,}$/.test(l.trim()))).toBe(false);
  });
  test('RECENT grows into the free rows, newest first, one row per second of events, no large void', () => {
    const t = text(world(54, 48));
    const at = t.findIndex((l) => /^ ── RECENT/.test(l));
    expect(at).toBeGreaterThan(0);
    const rows = t.slice(at + 1).filter((l) => /^ {4}[ \d]\d[smh] +\S/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(12);
    const ages = rows.map((l) => /(\d+)([smh])/.exec(l)!).map((m) => Number(m[1]) * (m[2] === 'h' ? 3600 : m[2] === 'm' ? 60 : 1));
    expect(ages).toEqual([...ages].sort((a, b) => a - b)); // newest first
    let run = 0;
    let worst = 0;
    for (const l of t) { run = l.trim() === '' ? run + 1 : 0; worst = Math.max(worst, run); }
    expect(worst).toBeLessThanOrEqual(2);
  });
  test('a recent row is `age  glyph text` with the text in the value column (cell 14), the glyph in cell 12, the age in a 3-cell right-aligned column at cell 4', () => {
    const t = text(world(54, 40));
    const row = t.find((l) => l.includes('turn finished'))!;
    expect(row.slice(0, 14)).toMatch(/^ {4}[ \d]\d[smh] {5}[·●✗] $/);
    expect(row.slice(14)).toMatch(/^turn finished/);
  });
  test('severity glyphs: `·` info (dim), `●` ok (green), `✗` deny or failure (red)', () => {
    const m = world(54, 48);
    const rows = panelLines(m).filter((l) => /^ {4}[ \d]\d[smh] /.test(lineText(l)));
    const glyph = (needle: string): Run => rows.find((l) => lineText(l).includes(needle))!.runs.find((x) => /^[·●✗]$/.test(x.t))!;
    expect(glyph('tool call Bash')).toMatchObject({ t: '·', tone: 'dim' });
    expect(glyph('turn finished')).toMatchObject({ t: '●', tone: 'ok' });
    expect(glyph('classic Stop blocked')).toMatchObject({ t: '✗', tone: 'bad' });
  });
  test('every section opens on its ribbon, with at most two blank rows between sections', () => {
    const t = text(world(54, 40));
    for (const head of ['ACTIVITY', 'CONTEXT', 'RUNS', 'GATES', 'RECENT']) {
      const i = t.findIndex((l) => new RegExp(`^ ── ${head}\\b`).test(l));
      expect(i).toBeGreaterThan(1);
      expect([head, t[i - 1]!.trim() === '' && t[i - 2]!.trim() === '' && t[i - 3]!.trim() === ''].join('|')).toBe(`${head}|false`);
    }
  });
  test('a short pane keeps the footer and gives up recent rows, then the rule, before it gives up a section', () => {
    const t = text(world(54, 24));
    expect(t.at(-1)!.trim()).toBe(FOOT);
    for (const head of ['PHASE', 'ACTIVITY', 'CONTEXT']) expect(t.some((l) => new RegExp(`^ ── ${head}\\b`).test(l))).toBe(true);
  });
});

describe('D8: one chip idiom, inert uppercase headers', () => {
  test('section headers are uppercase labels, never lowercase, never pressable', () => {
    const m = world(54, 40);
    const lines = panelLines(m);
    for (const head of ['PHASE', 'ACTIVITY', 'CONTEXT', 'RUNS', 'GATES', 'RECENT']) {
      const l = lines.find((x) => new RegExp(`^ ── ${head}\\b`).test(lineText(x)));
      expect(l).toBeDefined();
      expect(l!.press).toBeUndefined();
      expect(l!.runs.some((x) => x.press !== undefined)).toBe(false);
    }
    const t = text(m).map((l) => l.trim());
    for (const low of ['phase', 'activity', 'context', 'runs', 'gates', 'recent']) expect(t).not.toContain(low);
  });
  test('no header is a Button in the drawn pane', () => {
    const tree = sidebarTree(els, { ...goldenModel('route'), columns: 55, rows: 40, run: { kind: 'working', secs: 5, startMs: NOW, frame: 0 }, health: health() }, on);
    for (const b of all(tree).filter((n) => n.kind === 'Button')) expect(textOf(b)).not.toMatch(/\b(PHASE|ACTIVITY|CONTEXT|RUNS|GATES|RECENT)\b/);
  });
  test('the pill row has no `[✕]` chip and the pane draws no `panel:close` Button (the host draws its own close mark)', () => {
    const m = world(54, 40);
    expect(lineText(ribbonRow(m))).not.toContain('✕');
    expect(text({ ...m, close: true } as PanelModel).join('\n')).not.toContain('[✕]');
    const tree = sidebarTree(els, { ...goldenModel('route'), columns: 55, rows: 40 }, { ...on, close() {} } as SidebarHandlers);
    expect(all(tree).filter((n) => n.kind === 'Button' && n.props.key === 'panel:close')).toEqual([]);
    expect(textOf(tree)).not.toContain('[✕]');
  });
  test('the card has one collapse control: the ribbon title chip `▾ HEALTH` (key band:health); no `▾ hide` chip', () => {
    const rows = healthCardRows(health(), { cols: 100, ui });
    const flat = rows.map((r) => r.map((x) => x.t).join(''));
    expect(flat.join('\n')).not.toContain('hide');
    const pressed = rows.flat().filter((x) => x.press !== undefined);
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatchObject({ press: 'band:health', hover: true });
    expect(pressed[0]!.t).toBe(' ▾ HEALTH '); // 1-cell padding each side, the glyph inside
    expect(pressed[0]!.bgHex).toBeDefined(); // a raised fill
    expect(flat[0]!.trimEnd()).toMatch(/^── ▾ HEALTH ─+$/);
  });
  test('the card keeps every health row when the panel is closed', () => {
    const flat = healthCardRows(health(), { cols: 100, ui }).map((r) => r.map((x) => x.t).join('')).join('\n');
    for (const word of ['completion', 'tripwire', 'routing', 'header', 'ACTIVITY', 'CONTEXT', 'RUNS', 'session', '64k of 1M', 'master']) expect(flat).toContain(word);
  });
  test('a panel chip is raised: 1-cell padding each side, the glyph inside, a fill, a hover key', () => {
    const lines = panelLines(world(54, 20, 'working', { health: health() })); // the chip appears only where the height needs it
    const chip = lines.flatMap((l) => l.runs).find((x) => x.press === 'health:gates')!;
    expect(chip.t).toBe(' ▸ gates ');
    expect(chip.bgHex).toBeDefined();
    expect(chip.hover).toBe(true);
  });
  test('the drawn chip carries the raised fill (fillHex) and an accent-tinted hover', () => {
    const tree = sidebarTree(els, { ...goldenModel('route'), columns: 55, rows: 20, run: { kind: 'working', secs: 5, startMs: NOW, frame: 0 }, health: health() }, on);
    const b = all(tree).find((n) => n.kind === 'Button' && n.props.key === 'health:gates')!;
    const t = all(b).find((n) => n.kind === 'Text' && String(n.props.children).includes('▸ gates'))!;
    expect(t.props.children).toBe(' ▸ gates ');
    expect(t.props.backgroundColor).toBe(chipStyle(ui).backgroundColor);
    expect(t.props.backgroundColor).not.toBe(sidebarPanelBg());
    expect(t.props.hover).toMatchObject({ underline: true });
    expect(t.props.hover.backgroundColor).toBeDefined();
  });
});

describe('D12: the phase stepper', () => {
  const stepper = (m: PanelModel): PanelLine => panelLines(m).find((l) => /research/.test(lineText(l)) || /● ◐|[●◐◓◑◒–○] [●◐◓◑◒–○]/.test(lineText(l)))!;
  test('passed stages are green `●`, the current one is the violet spinner, pending are `○` at higher contrast than dim', () => {
    const l = stepper(world(54, 40, 'working'));
    expect(lineText(l).trim()).toMatch(/^● research [◐◓◑◒] theory ○ test ○ implement ○ verify$/);
    const g = (c: string) => l.runs.find((x) => x.t.trim() === c || x.t === `${c} `)!;
    expect(g('●')).toMatchObject({ tone: 'ok' });
    expect(l.runs.find((x) => /^[◐◓◑◒]/.test(x.t))).toMatchObject({ tone: 'accent' });
    const pend = l.runs.find((x) => x.t.startsWith('○'))!;
    expect(pend.fg).toBeDefined();
    expect(contrast(pend.fg!, '#181825')).toBeGreaterThanOrEqual(3.5);
    const word = l.runs.find((x) => x.t === 'test')!;
    expect(word.fg ?? '#585858').not.toBe('#585858');
  });
  test('a stage the run passed over is `–`', () => {
    const l = stepper(world(54, 40, 'working', { phase: 'implement', entered: ['research', 'test', 'implement'] }));
    expect(lineText(l).trim()).toMatch(/^● research – theory ● test [◐◓◑◒] implement ○ verify$/);
  });
  test('done: every stage the run passed is filled', () => {
    const l = stepper(world(54, 40, 'done', { phase: 'done', entered: PHASES }));
    expect(lineText(l).trim()).toBe('● research ● theory ● test ● implement ● verify');
  });
  for (const cols of [47, 40, 37]) {
    test(`${cols} columns: every stage spelled out whole, wrapping to a second row, never an abbreviation`, () => {
      const t = text(world(cols, 30, 'working'));
      const from = t.findIndex((l) => /^ ── PHASE/.test(l));
      const rows = t.slice(from + 1, t.findIndex((l) => /^ ── ACTIVITY/.test(l)));
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const n of PHASES) expect(rows.join(' ')).toContain(n);
      expect([...rows.join('')].filter((c) => '●◐◓◑◒○–'.includes(c))).toHaveLength(5);
      expect(t.join('\n')).not.toMatch(/res thy|tst|imp ver|\bthy\b/);
    });
  }
  test('at rest the stages the run entered stay `●`, spelled in full; a fresh idle pane is five `○`', () => {
    const stage = (m: PanelModel): string => { const t = text(m); return t.slice(t.findIndex((l) => /^ ── PHASE/.test(l)) + 1, t.findIndex((l) => /^ ── ACTIVITY/.test(l))).join(' ').replace(/\s+/g, ' ').trim(); };
    expect(stage(world(37, 30, 'done', { phase: 'done', entered: PHASES }))).toBe('● research ● theory ● test ● implement ● verify');
    expect(stage(world(37, 30, 'idle', { entered: [] }))).toBe('○ research ○ theory ○ test ○ implement ○ verify');
    expect(stage(world(37, 30, 'idle', { entered: ['research', 'theory'] }))).toBe('● research ● theory ○ test ○ implement ○ verify');
  });
});

describe('D13: narrow gates are named', () => {
  for (const cols of [47, 37]) {
    test(`${cols} columns: one row per gate with its name and its counts, never bare dots`, () => {
      const t = text(world(cols, 40, 'working'));
      for (const id of ['completion', 'tripwire', 'routing']) expect(t.some((l) => l.includes(id) && l.includes('8 pass · 0 deny'))).toBe(true);
      expect(t.some((l) => l.includes('header') && l.includes('not fired'))).toBe(true);
      expect(t.some((l) => /^\s*(▸ |▾ )?gates?\s+(●|○)( (●|○))+\s*$/.test(l) || /^\s+(●|○) (●|○) (●|○)/.test(l))).toBe(false);
    });
  }
  test('a short pane collapses the gates to the chip and a summary in words, not dots', () => {
    const t = text(world(54, 20, 'working'));
    const row = t.find((l) => l.includes('▸ gates'))!;
    expect(row).toMatch(/▸ gates {2}● ok · 0 denied · 4 gates · 1 not fired/);
    expect(row).not.toMatch(/● completion ● tripwire/);
  });
  test('54 columns: one named row per gate in the one vocabulary', () => {
    const t = text(world(54, 40, 'working', { expanded: 'health:gates' }));
    expect(t.some((l) => /● completion\s+8 pass · 0 deny/.test(l))).toBe(true);
    expect(t.some((l) => /○ header\s+not fired/.test(l))).toBe(true);
  });
});

describe('D14: tabs', () => {
  const rowsAt = (cols: number, expanded: string | null = null, tab: PanelTab = 'route'): string[] => tabRows({ ...world(cols, 40), tab, expanded }).map((l) => lineText(l).trimEnd());
  test('wide: all six chips on one row, each ` label ` with a one-cell gap', () => {
    expect(rowsAt(54)).toEqual([' status   team   channel   gates   core   board']); // ` status ` + a gap + ` team `: three cells between the words
  });
  for (const cols of [54, 50, 47, 40, 37, 30]) {
    test(`${cols} columns: every visible chip is a 1-cell padded label, one cell between, nothing wider than the pane`, () => {
      const [row] = tabRows(world(cols, 40));
      const chips = row!.runs.filter((x) => x.t.trim() !== '');
      for (const c of chips) expect(c.t).toMatch(/^ \S+( \S+)? $/);
      const gaps = row!.runs.filter((x) => x.t.trim() === '');
      for (const g of gaps) expect(g.t).toBe(' ');
      expect(textWidth(lineText(row!))).toBeLessThanOrEqual(cols);
    });
  }
  test('37 columns: trailing tabs fold into a `▸ more` chip; the folded ones are not in the first row', () => {
    const [row] = rowsAt(37);
    expect(row).toMatch(/^ status {3}team {3}channel {3}▸ more$/);
    expect(row).not.toMatch(/gates|core|board/);
    const chip = tabRows(world(37, 40))[0]!.runs.find((x) => x.t === ' ▸ more ')!;
    expect(chip.press).toBe('tabs:more');
    expect(chip.hover).toBe(true);
  });
  test('`▸ more` swaps the visible set in place for the folded tabs, `‹ back` swaps it back', () => {
    const open = rowsAt(37, 'tabs:more');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatch(/^ gates {3}core {3}board {3}‹ back$/);
  });
  test('the chips are the same shape at every width: only the count of visible chips changes', () => {
    const shapes = new Set<string>();
    for (let cols = 24; cols <= 120; cols++) for (const c of tabRows(world(cols, 40))[0]!.runs.filter((x) => x.t.trim() !== '' && !x.t.includes('more'))) shapes.add(c.t);
    expect([...shapes].sort()).toEqual([' channel ', ' core ', ' gates ', ' status ', ' team ', ' board '].sort());
  });
  test('the active tab is named in the header: `▸ SIDEPANEL · <tab>` (the marker stays)', () => {
    for (const [tab, label] of [['route', 'status'], ['team', 'team'], ['channel', 'channel'], ['gates', 'gates'], ['core', 'core']] as const) {
      const r = lineText(ribbonRow({ ...world(54, 40), tab }));
      expect(r).toContain(`◖ ◆ ATLAS ◗ ▸ SIDEPANEL · ${label}`);
    }
  });
  test('the drawn pane: tab Buttons are the ` label ` chips, `▸ more` is a Button that toggles tabs:more, a folded tab has no Button', () => {
    const calls: string[] = [];
    const h: SidebarHandlers = { ...on, toggle: (k) => calls.push(`toggle:${k}`), setView: (v) => calls.push(`view:${v}`) };
    const m: SidebarModel = { ...goldenModel('route'), columns: 38, rows: 40 };
    const tree = sidebarTree(els, m, h);
    const keys = all(tree).filter((n) => n.kind === 'Button').map((n) => n.props.key);
    expect(keys).toContain('tab:more');
    expect(keys).not.toContain('tab:gates');
    expect(keys).toContain('tab:channel');
    const more = all(tree).find((n) => n.kind === 'Button' && n.props.key === 'tab:more')!;
    expect(textOf(more)).toBe(' ▸ more ');
    more.props.onPress();
    expect(calls).toEqual(['toggle:tabs:more']);
    const opened = sidebarTree(els, { ...m, ui: { ...m.ui, expanded: 'tabs:more' } }, h);
    const okeys = all(opened).filter((n) => n.kind === 'Button').map((n) => n.props.key);
    expect(okeys).toEqual(expect.arrayContaining(['tab:gates', 'tab:core', 'tab:back']));
    expect(okeys).not.toContain('tab:more');
    const gates = all(opened).find((n) => n.kind === 'Button' && n.props.key === 'tab:gates')!;
    expect(textOf(gates)).toBe(' gates ');
    gates.props.onPress();
    expect(calls.at(-1)).toBe('view:gates');
  });
});

describe('D14: each tab owns the full body', () => {
  for (const tab of ['team', 'channel', 'gates', 'core'] as PanelTab[]) {
    test(`${tab}: no ACTIVITY, CONTEXT or RECENT from the status dashboard`, () => {
      const m = { ...world(54, 40, 'idle'), tab, lead: { name: 'lead', state: 'running' as const, detail: '' } };
      const t = [...headerRows(m), ...bodyLines(m)].map((l) => lineText(l)).join('\n');
      expect(t).not.toMatch(/\b(PULSE|HEALTH|RECENT)\b/);
      expect(t).not.toMatch(/\b(pulse|health|recent)\b/);
      expect(t).toContain(FOOT); // round 3 (E6): the footer is the last row of every tab
    });
  }
  test('status: PHASE, ACTIVITY, CONTEXT, RUNS, GATES and RECENT in that order', () => {
    const t = text(world(54, 40));
    const at = ['PHASE', 'ACTIVITY', 'CONTEXT', 'RUNS', 'GATES', 'RECENT'].map((h) => t.findIndex((l) => new RegExp(`^ ── ${h}\\b`).test(l)));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
});

describe('D4 leftovers: no gate ratios', () => {
  test('the gates tab and the status view say `ok` or `N denied`, never `n/m`', () => {
    const gates = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'a', label: 'a', ok: true }, { id: 'b', label: 'b', ok: false }] }, { id: 'routing', title: 'Tool routing', lines: [{ id: 'c', label: 'c', ok: true }] }];
    const m = world(54, 40, 'working', { gates, health: undefined as never, workers: [{ name: 'alpha', state: 'running', detail: '', secs: 4 }] });
    for (const tab of ['route', 'gates'] as PanelTab[]) {
      const t = [...headerRows({ ...m, tab }), ...bodyLines({ ...m, tab })].map(lineText).join('\n');
      expect(t).not.toMatch(/\b\d+\/\d+\b/);
      expect(t).not.toMatch(/\d+\/\d+ green|\d+ of \d+ green/);
    }
    const t = [...headerRows({ ...m, tab: 'gates' }), ...bodyLines({ ...m, tab: 'gates' })].map(lineText).join('\n');
    expect(t).toMatch(/1 denied|1 deny/);
  });
  test('the panel context gauge is the card gauge (one gaugeRuns): the same fill and track cells', () => {
    const card = healthCardRows(health({ ctxPct: 62 }), { cols: 100, ui }).map((r) => r.map((x) => x.t).join('')).find((l) => /[█▉▊▋▌▍▎▏]+░+ 62%/.test(l))!;
    const panel = text(world(54, 40, 'working', { health: health({ ctxPct: 62 }) })).find((l) => /[█▉▊▋▌▍▎▏]+░+ 62%/.test(l))!;
    const cells = (s: string): string => /[█▉▊▋▌▍▎▏]+░+/.exec(s)![0].replace(/░+/g, '').slice(0, 3);
    expect(cells(panel)).toBe(cells(card));
    expect(panelLines(world(54, 40, 'working', { health: health({ ctxPct: 62 }) })).flatMap((l) => l.runs).some((x) => x.tone === 'warn' && /^█+/.test(x.t))).toBe(true);
  });
});

// ---- D1 on the real module, and the band slack ticker -----------------------------------------------------------------------------------

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kidsOf = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: unknown): Node[] => [n as Node, ...kidsOf(n as Node).flatMap(all)];
const textOf = (n: unknown): string => ((n as Node).kind === 'Text' ? String((n as Node).props.children ?? '') : kidsOf(n as Node).map(textOf).join(''));
const on: SidebarHandlers = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} };
const sidebarPanelBg = (): string => { const t = all(sidebarTree(els, { ...goldenModel('route'), columns: 55, rows: 40 }, on)).find((n) => n.kind === 'Box')!; return t.props.backgroundColor; };
const lum = (hex: string): number => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
const contrast = (a: string, b: string): number => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi! + 0.05) / (lo! + 0.05); };

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
const noopNext: AnyNext = async (input) => input;
const settle = async (): Promise<void> => { for (let i = 0; i < 2000; i++) await Promise.resolve(); };
const ROOT = '/tmp/r2-panel';
const START = 1_910_000_000_000;

function bootHarness() {
  const handlers: { event: string; matcher: Record<string, unknown> | undefined; hook: AnyHandler }[] = [];
  const onFn = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const matcher = maybeHook === undefined ? undefined : (hookOrMatcher as Record<string, unknown>);
    handlers.push({ event, matcher, hook: (maybeHook ?? hookOrMatcher) as AnyHandler });
    return { catch() {} };
  }) as unknown as On;
  const one = (event: string, key?: [string, unknown]): AnyHandler => {
    const found = handlers.find((h) => h.event === event && (key === undefined || h.matcher?.[key[0]] === key[1]));
    if (!found) throw new Error(`no ${event} handler`);
    return found.hook;
  };
  const files: Record<string, string> = { [`${ROOT}/.git`]: '', [`${ROOT}/.atlas/.run/todos.json`]: '{"items":[]}' };
  const clock = { now: START };
  const timers: { ms: number; fn: () => void; next: number; live: boolean }[] = [];
  const rec = { closes: [] as { id: string }[], opens: [] as string[] };
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => clock.now, every: (ms: number, fn: () => void) => { const t = { ms, fn, next: clock.now + ms, live: true }; timers.push(t); return { cancel() { t.live = false; } }; }, after: () => ({ cancel() {} }), sleep: async () => {} },
    session: { id: async () => 'sess-r2' },
    process: { run: async () => ({ exitCode: 0, stdout: 'main', stderr: '' }) },
    fs: {
      read: async (p: string) => { if (p in files) return files[p]; throw new Error('missing'); },
      stat: async (p: string) => { if (!(p in files)) throw new Error('missing'); return { size: files[p]!.length, mtimeMs: 1 }; },
      exists: async (p: string) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
      list: async (dir: string) => [...new Set(Object.keys(files).filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split('/')[0]!))].map((name) => ({ name })),
    },
    agent: { list: async () => [] },
    state: memState(),
    audio: { play: async () => {} },
    ui: {
      log: () => {}, invalidate: () => {}, status: () => {}, resolve: () => els,
      open: async (a: { id: string }) => { rec.opens.push(a.id); return { isPlaced: true as const }; },
      close: async (a: { id: string }) => { rec.closes.push(a); },
      toast: () => {},
    },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  } as unknown as EngineInterface;
  /** Advance the clock 50 ms at a time, firing every due `every` timer (settled), with a redraw behind each step. */
  const advance = async (ms: number, after?: () => Promise<void>): Promise<void> => {
    for (let t = 0; t < ms; t += 50) {
      clock.now += 50;
      for (const timer of timers) { if (!timer.live || timer.next > clock.now) continue; timer.next += timer.ms; timer.fn(); await settle(); }
      if (after) await after();
    }
  };
  return { handlers, onFn, one, $, clock, rec, advance };
}
const band = async (h: ReturnType<typeof bootHarness>): Promise<Node> =>
  (await h.one('ui.render', ['component', 'AbovePrompt'])(h.$, { surface: 'terminal', props: { hasSurvey: false, bodyColumns: 150, maxRows: 14, isWorking: false } }, async () => els.Text({ children: 'prompt' }))) as Node;
const button = (tree: Node, key: string, text?: string): Node => {
  const found = all(tree).find((n) => n.kind === 'Button' && n.props.key === key && (text === undefined || textOf(n).includes(text)));
  if (!found) throw new Error(`no Button ${key}${text ? ` with ${text}` : ''}`);
  return found;
};
const press = async (n: Node): Promise<void> => { n.props.onPress(); await settle(); };

describe('D1: card and panel never show at once', () => {
  test('a card open when the panel opens is closed, and stays closed after the panel closes; the panel up, the band chip opens no card', async () => {
    const h = bootHarness();
    resetCore();
    await register(h.onFn, {});
    await h.one('session.start')(h.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
    await settle();
    await h.advance(20_000, async () => { await band(h); }); // the boot run rests until the band reads idle
    await press(button(await band(h), 'band:health', 'health'));
    expect(textOf(await band(h))).toContain('HEALTH'); // the card, panel closed
    await h.one('command.run', ['command', 'atlas-cc'])(h.$, { command: 'atlas-cc' }, noopNext);
    await settle();
    expect(h.rec.opens).toContain('atlas');
    expect(textOf(await band(h))).not.toContain('HEALTH'); // the panel opened: the card is gone
    await press(button(await band(h), 'band:health', 'health')); // with the panel up the chip opens the panel's gates row, never a card
    expect(textOf(await band(h))).not.toContain('HEALTH');
    await h.one('ui.close')(h.$, { id: 'atlas', origin: { kind: 'person' } }, noopNext);
    await settle();
    expect(textOf(await band(h))).not.toContain('HEALTH'); // the card does not come back by itself
    await press(button(await band(h), 'band:health', 'health'));
    expect(textOf(await band(h))).toContain('HEALTH'); // panel closed: the chip opens the card again
  });
  test('the card collapses from its ribbon title chip (key band:health)', async () => {
    const h = bootHarness();
    resetCore();
    await register(h.onFn, {});
    await h.one('session.start')(h.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
    await settle();
    await h.advance(20_000, async () => { await band(h); }); // the boot run rests until the band reads idle
    await press(button(await band(h), 'band:health', 'health'));
    const open = await band(h);
    expect(textOf(open)).toContain('HEALTH');
    expect(textOf(open)).not.toContain('hide');
    await press(button(open, 'band:health', 'HEALTH'));
    expect(textOf(await band(h))).not.toContain('HEALTH');
  });
});

describe('the band slack ticker', () => {
  const ui2: Ui = { ...uiFromEnv({}), color: 'truecolor' };
  const handlers: BandHandlers = { openView() {}, toggleTodos() {}, toggleHealth() {} };
  const g = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as any;
  const PULSE: Pulse = { events: [0, 0, 0, 0, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 1], ctx: [], runs: [] };
  const snap = () => busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 6 } as never);
  const hooks = (recent: { label: string; ageSecs: number }[]) => ({ total: 3, byLabel: [{ label: 'tool.call', n: 3 }], recent, lastEventSecs: 12, runTools: 3, runTool: 'Bash' });
  const model = (kind: Kind, columns: number, recent: { label: string; ageSecs: number }[]): BandModel => ({
    snapshot: snap(), live: [], gates: ['completion', 'tripwire', 'routing', 'header'].map(g), columns, tick: 0, maxRows: 12, ui: ui2,
    health: { upSecs: 9, version: '17.24.0', branch: 'master', tokens: 64_000, window: 1_000_000, hooks: hooks(recent), pulse: PULSE, open: false },
    ...(kind === 'working' ? { working: true, workSecs: 3 } : {}), ...(kind === 'done' ? { ranSecs: 5, restSecs: 1 } : {}),
  } as BandModel);
  const first = (b: BandModel): string => textOf(kidsOf(bandTree(els, b, handlers) as unknown as Node)[0]!);
  const chipCol = (row: string): number => textWidth(row.slice(0, row.indexOf('▸ health')));
  for (const kind of ['idle', 'working', 'done'] as Kind[]) {
    test(`150 columns ${kind}: the newest hook event fills the slack as a dim ticker without an age, the chip column does not move`, () => {
      const bare = first(model(kind, 150, []));
      const row = first(model(kind, 150, [{ label: 'tool.call Bash', ageSecs: 2 }, { label: 'session.measure', ageSecs: 4 }]));
      expect(row).toContain('· tool call Bash');
      expect(row).not.toMatch(/tool call Bash\s+\d/);
      expect(chipCol(row)).toBe(chipCol(bare));
      expect(textWidth(row)).toBe(textWidth(bare));
    });
  }
  test('a burst in one second reads `turn finished · 3 events`', () => {
    const row = first(model('idle', 150, [{ label: 'turn.complete', ageSecs: 1 }, { label: 'session.measure', ageSecs: 1 }, { label: 'classic.Stop', ageSecs: 1 }]));
    expect(row).toContain('· turn finished · 3 events');
  });
  test('the ticker is dim, and it only fills slack: at 110 the chip is where it was and the row is no wider', () => {
    const tree = bandTree(els, model('idle', 150, [{ label: 'tool.call Bash', ageSecs: 2 }]), handlers) as unknown as Node;
    const t = all(tree).find((n) => n.kind === 'Text' && String(n.props.children).includes('tool call Bash'))!;
    expect(t.props.color).toBeDefined();
    for (const cols of [110, 100]) {
      const bare = first(model('idle', cols, []));
      const row = first(model('idle', cols, [{ label: 'tool.call Bash', ageSecs: 2 }]));
      expect(chipCol(row)).toBe(chipCol(bare));
      expect(textWidth(row)).toBeLessThanOrEqual(cols);
    }
  });
});
