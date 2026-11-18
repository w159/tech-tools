// Round 2 panel and card rules (spec-r2 D1, D8, D11, D12, D13, D14 and the band slack ticker): the side panel fills its height with a pinned footer, one chip idiom, inert uppercase headers,
// phases and gates without cryptic forms at any width, each tab owns its body, and the health card shows only while the panel is closed.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements, EngineInterface, On } from 'claude-code';
import { uiFromEnv, type Run, type Ui } from './atlas-ui';
import { chipStyle } from './input/clickable';
import { healthCardRows } from './hud-surface';
import { bodyLines, headerRows, lineText, panelLines, ribbonRow, tabRows, type PanelLine, type PanelModel, type PanelTab } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { goldenModel } from './pane/sidebar.golden-cases';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './pane/sidebar';
import { bandTree, type BandHandlers, type BandModel } from './view/band/band';
import { busySnap, NOW } from './live_fixture';
import { register, resetCore } from './register';
import { memState } from './test_helpers';
import { textWidth } from './theme';
import type { Health } from './data/idle-health';
import type { Pulse } from './data/pulse';

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
const FOOT = 'atlas 17.24.0 · master';

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
});

describe('D8: one chip idiom, inert uppercase headers', () => {
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
  test('the card has no collapse control of its own: the band chip closes it (frame spec section 6); no `▾ hide` chip', () => {
    const rows = healthCardRows(health(), { cols: 100, ui });
    const flat = rows.map((r) => r.map((x) => x.t).join(''));
    expect(flat.join('\n')).not.toContain('hide');
    expect(new Set(rows.flat().filter((x) => x.press !== undefined).map((x) => x.press))).toEqual(new Set(['band:health'])); // round W M: the title chip is the toggle, nothing else is
    expect(flat[0]!.trimEnd()).toMatch(/^ +▾ HEALTH +─+$/);
  });
  test('the card keeps every health row when the panel is closed', () => {
    const flat = healthCardRows(health(), { cols: 100, ui }).map((r) => r.map((x) => x.t).join('')).join('\n');
    for (const word of ['completion', 'tripwire', 'routing', 'header', 'ACTIVITY', 'CONTEXT', 'GATES', 'HOOKS', '64k of 1M']) expect(flat).toContain(word); // the session figures (uptime, branch, version) are the pane's NOW line and footer
  });
});

describe('D12: the phase stepper', () => {
  const stepper = (m: PanelModel): PanelLine => panelLines(m).find((l) => /research/.test(lineText(l)) || /● ◐|[●◐◓◑◒–○] [●◐◓◑◒–○]/.test(lineText(l)))!;
});

describe('D13: narrow gates are named', () => {
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
  test('37 columns: trailing tabs fold into a `more ›` chip; the folded ones are not in the first row', () => {
    const [row] = rowsAt(37);
    expect(row).toMatch(/^ status {3}team {3}chan {3}more ›$/); // AA5: the short label, no swapping
    expect(row).not.toMatch(/gates|core|board/);
    const chip = tabRows(world(37, 40))[0]!.runs.find((x) => x.t === ' more › ')!;
    expect(chip.press).toBe('tabs:more');
    expect(chip.hover).toBe(true);
  });
  test('`more ›` swaps the visible set in place for the folded tabs, `‹ back` swaps it back', () => {
    const open = rowsAt(37, 'tabs:more');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatch(/^ gates {3}core {3}board {3}‹ back$/);
  });
  test('the chips are the same shape at every width: only the count of visible chips changes', () => {
    const shapes = new Set<string>();
    for (let cols = 24; cols <= 120; cols++) for (const c of tabRows(world(cols, 40))[0]!.runs.filter((x) => x.t.trim() !== '' && !x.t.includes('more'))) shapes.add(c.t);
    expect([...shapes].sort()).toEqual([' chan ', ' channel ', ' core ', ' gates ', ' status ', ' team ', ' board '].sort());
  });
  test('the active tab is named in the header: `▸ SIDEPANEL · <tab>` (the marker stays)', () => {
    for (const [tab, label] of [['route', 'status'], ['team', 'team'], ['channel', 'channel'], ['gates', 'gates'], ['core', 'core']] as const) {
      const r = lineText(ribbonRow({ ...world(54, 40), tab }));
      expect(r).toContain(`◖ ◆ ATLAS ◗ ▸ SIDEPANEL · ${label}`);
    }
  });
  test('the drawn pane: tab Buttons are the ` label ` chips, `more ›` is a Button that toggles tabs:more, a folded tab has no Button', () => {
    const calls: string[] = [];
    const h: SidebarHandlers = { ...on, toggle: (k) => calls.push(`toggle:${k}`), setView: (v) => calls.push(`view:${v}`) };
    const m: SidebarModel = { ...goldenModel('route'), columns: 38, rows: 40 };
    const tree = sidebarTree(els, m, h);
    const keys = all(tree).filter((n) => n.kind === 'Button').map((n) => n.props.key);
    expect(keys).toContain('tab:more');
    expect(keys).not.toContain('tab:gates');
    expect(keys).toContain('tab:channel');
    const more = all(tree).find((n) => n.kind === 'Button' && n.props.key === 'tab:more')!;
    expect(textOf(more)).toBe(' more › ');
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
    test(`${tab}: no PULSE or HEALTH block; the dock under it is the status tab's own sections (round X)`, () => {
      const m = { ...world(54, 40, 'idle'), tab, lead: { name: 'lead', state: 'running' as const, detail: '' } };
      const t = [...headerRows(m), ...bodyLines(m)].map((l) => lineText(l)).join('\n');
      expect(t).not.toMatch(/\b(PULSE|HEALTH)\b/);
      expect(t).not.toMatch(/\b(pulse|health)\b/);
      expect(t).toContain(FOOT); // round 3 (E6): the footer is the last row of every tab
    });
  }
});

describe('D4 leftovers: no gate ratios', () => {
  test('the gates tab and the status view say `ok` or `N denied`, never `n/m`', () => {
    // fix1728: an unmet completion line is pending until a Stop refuses, so the one denial is a routing line (a call denied in the current run)
    const gates = [{ id: 'completion', title: 'Completion gate', lines: [{ id: 'a', label: 'a', ok: true }] }, { id: 'routing', title: 'Tool routing', lines: [{ id: 'c', label: 'c', ok: true }, { id: 'b', label: 'b', ok: false }] }];
    const m = world(54, 40, 'working', { gates, health: undefined as never, workers: [{ name: 'alpha', state: 'running', detail: '', secs: 4 }] });
    for (const tab of ['route', 'gates'] as PanelTab[]) {
      const t = [...headerRows({ ...m, tab }), ...bodyLines({ ...m, tab })].map(lineText).join('\n');
      expect(t).not.toMatch(/\b\d+\/\d+\b/);
      expect(t).not.toMatch(/\d+\/\d+ green|\d+ of \d+ green/);
    }
    const t = [...headerRows({ ...m, tab: 'gates' }), ...bodyLines({ ...m, tab: 'gates' })].map(lineText).join('\n');
    expect(t).toMatch(/1 denied|1 deny/);
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
    expect(all(await band(h)).some((n) => n.kind === 'Button' && n.props.key === 'band:health')).toBe(false); // v1 frame spec: with the panel up the band draws no health chip, so no card can open
    expect(all(await band(h)).some((n) => n.kind === 'Button' && String(n.props.key).startsWith('band:gates'))).toBe(true); // the gates chip stays and opens the panel on its gates tab
    expect(textOf(await band(h))).not.toContain('HEALTH');
    await h.one('ui.close')(h.$, { id: 'atlas', origin: { kind: 'person' } }, noopNext);
    await settle();
    expect(textOf(await band(h))).not.toContain('HEALTH'); // the card does not come back by itself
    await press(button(await band(h), 'band:health', 'health'));
    expect(textOf(await band(h))).toContain('HEALTH'); // panel closed: the chip opens the card again
  });
  test('round W M: the card title chip toggles too: it reads `▾ HEALTH` while open and a click closes the card; the band keeps a `▾ health` chip that closes it', async () => {
    const h = bootHarness();
    resetCore();
    await register(h.onFn, {});
    await h.one('session.start')(h.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
    await settle();
    await h.advance(20_000, async () => { await band(h); });
    await press(button(await band(h), 'band:health', 'health'));
    const open = await band(h);
    const title = all(open).find((n) => n.kind === 'Button' && String(n.props.key).startsWith('band:health') && textOf(n).includes('HEALTH'));
    expect(title).toBeDefined();
    expect(textOf(open)).toContain('▾ HEALTH');
    expect(textOf(button(open, 'band:health', 'health'))).toContain('▾ health'); // the band chip stays, selected
    await press(title!);
    expect(textOf(await band(h))).not.toContain('HEALTH'); // the title click closed it
    await press(button(await band(h), 'band:health', 'health'));
    expect(textOf(await band(h))).toContain('▾ HEALTH'); // and the band chip opens it again
    await press(button(await band(h), 'band:health', 'health'));
    expect(textOf(await band(h))).not.toContain('HEALTH');
  });
  test('the card collapses from the band chip that opened it (key band:health), selected while open', async () => {
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
    await press(button(open, 'band:health', 'health'));
    expect(textOf(await band(h))).not.toContain('HEALTH');
  });
});
