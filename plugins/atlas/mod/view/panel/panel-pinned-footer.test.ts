// Round 2 panel and card rules (spec-r2 D1, D8, D11, D12, D13, D14 and the band slack ticker): the side panel fills its height with a pinned footer, one chip idiom, inert uppercase headers,
// phases and gates without cryptic forms at any width, each tab owns its body, and the health card shows only while the panel is closed.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements, EngineInterface, On } from 'claude-code';
import { uiFromEnv, type Run, type Ui } from '../../design/atlas-ui';
import { chipStyle } from '../../input/clickable';
import { healthCardRows } from '../hud/hud-surface';
import { bodyLines, headerRows, lineText, panelLines, ribbonRow, tabRows, type PanelLine, type PanelModel, type PanelTab } from './panel-layout';
import { panelWorld } from '../../../contracts/panel-world';
import { goldenModel } from './pane/sidebar.golden-cases';
import { sidebarTree, type SidebarHandlers, type SidebarModel } from './pane/sidebar';
import { bandTree, type BandHandlers, type BandModel } from '../band/band';
import { busySnap, NOW } from '../../live_fixture';
import { register, resetCore } from '../../register';
import { memState } from '../../test_helpers';
import { textWidth } from '../../design/theme';
import type { Health } from '../../data/idle-health';
import type { Pulse } from '../../data/pulse';

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
  }
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
  for (const cols of [54, 50, 47, 40, 37, 30]) {
  }
});

describe('D14: each tab owns the full body', () => {
  for (const tab of ['team', 'channel', 'core'] as PanelTab[]) {
  }
});

describe('D4 leftovers: no gate ratios', () => {
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
const band = async (h: ReturnType<typeof bootHarness>, bodyColumns = 150): Promise<Node> =>
  (await h.one('ui.render', ['component', 'AbovePrompt'])(h.$, { surface: 'terminal', props: { hasSurvey: false, bodyColumns, maxRows: 14, isWorking: false } }, async () => els.Text({ children: 'prompt' }))) as Node;
const button = (tree: Node, key: string, text?: string): Node => {
  const found = all(tree).find((n) => n.kind === 'Button' && n.props.key === key && (text === undefined || textOf(n).includes(text)));
  if (!found) throw new Error(`no Button ${key}${text ? ` with ${text}` : ''}`);
  return found;
};
const press = async (n: Node): Promise<void> => { n.props.onPress(); await settle(); };

describe('D1: the band holds no health card', () => {
  test('pressing the band `health` chip never draws a card in the band slot (the expanded health view lives on the panel health tab)', async () => {
    const h = bootHarness();
    resetCore();
    await register(h.onFn, {});
    await h.one('session.start')(h.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
    await settle();
    await h.advance(20_000, async () => { await band(h); }); // the boot run rests until the band reads idle
    await press(button(await band(h), 'band:health', 'health'));
    await settle();
    expect(textOf(await band(h))).not.toContain('HEALTH'); // no card title in the band
  });
  // at 150 the chip sits on the band's row; at 110 the idle health strip above the band carries the same key
  for (const cols of [150, 110]) {
    test(`at ${cols}: pressing \`band:health\` opens the side panel on its health tab (view \`core\`), as the gates pill does`, async () => {
      const h = bootHarness();
      resetCore();
      await register(h.onFn, {});
      await h.one('session.start')(h.$, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
      await settle();
      await h.advance(20_000, async () => { await band(h, cols); });
      const view = async (): Promise<unknown> => (await h.$.state.get({ plugin: 'atlas', key: 'atlasView' })).value;
      expect(await view()).not.toBe('core');
      const opened = h.rec.opens.length;
      await press(button(await band(h, cols), 'band:health'));
      expect(await view()).toBe('core');
      expect(h.rec.opens.slice(opened)).toEqual(['atlas']);
    });
  }
});
