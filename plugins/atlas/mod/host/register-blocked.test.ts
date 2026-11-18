// Wave 36 (critique 35): the band reads `blocked` only after two consecutive host-idle renders that both computed blocked, and never while the host turn is active
// (data/runstate.ts stepBlocked, driven from register.ts's band render). The board holds one open dispatch row that no worker answers, which is what computes blocked.
// The engine stub resolves real element builders, so the AbovePrompt handler returns the band's tree.
import { describe, expect, test } from 'claude-code/testing';
import type { EngineInterface, On } from 'claude-code';
import { register, resetBlockedDebounce, resetCore } from '../register';
import { memState } from '../test_helpers';
import { readHostEntry } from '../fixtures/source-tree';
import type { ClientElements } from 'claude-code';
import { worldGates, worldSidebar, worldSnapshot } from '../../contracts/world-live';
import { bandTree } from '../view/band/band';
import { liveWorkers } from '../data/live';
import { panelModelOf } from '../view/panel/pane/sidebar-model';
import { bodyLines, lineText } from '../view/panel/panel-layout';
import type { Ui } from '../atlas-ui';

type AnyNext = (input: unknown) => Promise<unknown>;
type AnyHandler = ($: EngineInterface, e: unknown, next: AnyNext) => Promise<unknown>;
const noopNext: AnyNext = async (input) => input;

function captureOn() {
  const handlers = new Map<string, AnyHandler>();
  const on = ((event: string, hookOrMatcher: unknown, maybeHook?: unknown) => {
    const hook = (maybeHook ?? hookOrMatcher) as AnyHandler;
    handlers.set(maybeHook === undefined ? event : `${event}|${String((hookOrMatcher as Record<string, unknown>).component ?? '')}`, hook);
    return { catch() {} };
  }) as unknown as On;
  return { on, pick: (key: string): AnyHandler => handlers.get(key) ?? (() => { throw new Error(`no ${key}`); }) };
}

const ROOT = '/tmp/proj-blocked';
const TODOS = `${ROOT}/.atlas/.run/todos.json`;
const NOW = 1_910_000_000_000;
const BOARD = JSON.stringify({ items: [{ id: 't1', content: 'T1 read ghost.py', status: 'completed', session_id: 'sess-blocked', origin: 'session', phase: 'research', claimed_at: NOW / 1000 - 40, completed_at: NOW / 1000 - 20 }, { id: 'd1', content: 'dispatch T1 read ghost.py', status: 'in_progress', owner: 'ghost-explorer', session_id: 'sess-blocked', origin: 'dispatch', phase: 'research', claimed_at: NOW / 1000 - 30 }] });

type Node = { kind: string; props: Record<string, unknown> };
const mk = (kind: string) => (props: Record<string, unknown>): Node => ({ kind, props });
const flat = (n: unknown): string => {
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(flat).join('');
  if (n === null || typeof n !== 'object') return '';
  const o = n as { props?: { children?: unknown } };
  return flat(o.props?.children);
};

function stubEngine() {
  const files: Record<string, string> = { [`${ROOT}/.git`]: '', [TODOS]: BOARD };
  const $ = {
    plugin: { name: 'atlas', root: '/plugins/atlas' },
    env: { get: async () => undefined },
    clock: { now: async () => NOW, every: () => ({ cancel() {} }), after: () => ({ cancel() {} }), sleep: async () => {} },
    session: { id: async () => 'sess-blocked' },
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
    ui: { log: () => {}, invalidate: () => {}, open: async () => ({ isPlaced: true as const }), toast: () => {}, status: () => {}, resolve: () => ({ Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') }) },
    command: { register: async (spec: { name: string }) => ({ command: spec.name }) },
  };
  return $ as unknown as EngineInterface;
}

async function boot() {
  resetCore();
  resetBlockedDebounce();
  const cap = captureOn();
  const $ = stubEngine();
  await register(cap.on, {});
  await cap.pick('session.start')($, { cwd: ROOT, surface: 'terminal', isInteractive: true }, noopNext);
  for (let i = 0; i < 2000; i++) await Promise.resolve();
  /** One band render with the host turn flag `isWorking`; the text of everything it drew. */
  const render = async (isWorking: boolean): Promise<string> =>
    flat(await cap.pick('ui.render|AbovePrompt')($, { surface: 'terminal', viewport: { columns: 160, rows: 40, isFullscreen: false }, props: { hasSurvey: false, bodyColumns: 160, maxRows: 30, isWorking } }, noopNext));
  return { render };
}

describe('the blocked debounce, through the band render', () => {
  test('the band reads blocked on the second consecutive host-idle render, not the first', async () => {
    const { render } = await boot();
    const first = await render(false);
    const second = await render(false);
    expect(first, 'first idle render').not.toContain('blocked');
    expect(second, 'second idle render').toContain('blocked');
  });

  test('the band never reads blocked while the host turn is active; an idle render after active ones starts the count again', async () => {
    const { render } = await boot();
    for (let i = 0; i < 4; i++) expect(await render(true), `active render ${i + 1}`).not.toContain('blocked');
    expect(await render(false), 'first idle render after the active ones').not.toContain('blocked');
  });
});

describe('blocked-same-update', () => {
// Critique 25 (stoprun-150-3 f0106): the panel read `phase blocked` while the band still said `working`; the band flipped one frame later (f0107). Root cause: register.ts frameBeat bumped
// spinnerTickState (the redraw that carries the band) BEFORE it read the Stop verdict, so the band drew the old gates for one more beat. Two guards: both surfaces derive the state from the
// one snapshot (so a single update flips both), and frameBeat reads the verdict first.

type Node = { kind: string; props: { children?: unknown } };
const mk = (kind: string) => (props: Node['props']): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const textOf = (n: unknown): string => {
  const node = n as Node;
  const c = node.props?.children;
  if (typeof c === 'string') return c;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).map(textOf).join('');
};
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };

describe('5d: the band and the panel flip to blocked on the same update', () => {
  const blocked = worldSnapshot({ phase: 'blocked' } as never);
  const working = worldSnapshot();

  test('one snapshot with the Stop refusal: the band head says blocked and the route tab says `phase blocked`', () => {
    const band = textOf(bandTree(els, { snapshot: blocked, live: liveWorkers(blocked, blocked.now), gates: worldGates(), columns: 150, tick: 0, maxRows: 1, ui } as never));
    const panel = bodyLines(panelModelOf(worldSidebar('route', 100, blocked), ui, 100)).map(lineText).join('\n');
    expect(band).toMatch(/blocked/);
    expect(panel).toMatch(/phase\s+▲ blocked/);
  });
  test('the same snapshot without the refusal: the band says working and the panel does not say `phase blocked`', () => {
    const band = textOf(bandTree(els, { snapshot: working, live: liveWorkers(working, working.now), gates: worldGates(), columns: 150, tick: 0, maxRows: 1, ui } as never));
    const panel = bodyLines(panelModelOf(worldSidebar('route', 100, working), ui, 100)).map(lineText).join('\n');
    expect(band).toMatch(/working/);
    expect(/phase\s+▲ blocked/.test(panel)).toBe(false);
  });
  test('register.ts frameBeat reads the Stop verdict before it bumps the spinner tick (the redraw that carries the band)', () => {
    const src = readHostEntry();
    const beat = src.slice(src.indexOf('async function frameBeat'), src.indexOf('let verdictBusy'));
    const verdict = beat.indexOf('await verdictFast(');
    const bump = beat.indexOf('update($, spinnerTickState');
    expect(verdict).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(-1);
    expect(verdict).toBeLessThan(bump);
  });
});
});
