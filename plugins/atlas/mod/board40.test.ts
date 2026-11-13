// State 40 step 5 (critique 39, build 29d9dbb4): the board while blocked or failed. Each test names the 29d9dbb4 defect it comes from.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from './live_fixture';
import { forgetRefusals } from './data/channels';
import { DONE_DOUBT, type Ui } from './atlas-ui';
import { agentModel, hudAgents, resetAgentSeq } from './hud';
import { meterRuns } from './hud-surface';
import { liveWorkers, queuedMembers } from './data/live';
import { forgetPhases } from './pane/sidebar-model';
import { leadBarState, sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { boardLines, boardText, boardTimeline, type BoardRow } from './board-model';
import { workersByTask } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const texts = (n: Node, out: Array<{ t: string; color?: string }> = []): Array<{ t: string; color?: string }> => { if (n.kind === 'Text') out.push({ t: String(n.props.children ?? ''), color: n.props.color }); for (const k of kids(n)) texts(k, out); return out; };
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
const todo = (id: string, content: string, status: string, owner: string | null, c: number, d: number) => ({ id, content, status, owner, session_id: 's', claimed_at: (NOW - 30000) / 1000 + c, completed_at: status === 'completed' ? (NOW - 30000) / 1000 + d : null });
const RED = '#ff5f5f'; // 203
const GREEN = '#87d787'; // 114
const VIOLET = '#af87ff'; // 141
const AMBER = '#d7af5f'; // 179
const DIM = '#585858'; // 240

type Run = NonNullable<SidebarModel['run']>;
const model = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null): SidebarModel => ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows, look: ui, ...(run ? { run } : {}) } as SidebarModel);
const tree = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null): Node => { forgetRefusals(); return sidebarTree(els, model(s, view, columns, rows, run), on) as unknown as Node; };
const render = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null): string[] => textOf(tree(s, view, columns, rows, run)).split('\n');

/** The stop run as the scenario drives it: ghost killed, the lead CLOSED T2 (completed) over the dead worker, every other row completed. */
const stop = (over: Record<string, unknown> = {}): never => ({
  ...busySnap(), phase: 'implement', now: NOW, channel: 'lc-w38', sessionId: 's',
  squad: [
    { name: 'alpha-explorer', persona: 'explorer', state: 'finished', source: 'task' },
    { name: 'ghost-explorer', persona: 'explorer', state: 'failed', source: 'task' },
    { name: 'beta-explorer', persona: 'explorer', state: 'finished', source: 'task' },
  ],
  activity: {
    lead: act({ mood: 'working', toolCount: 10, startedAt: NOW - 31000, calls: [NOW - 30000, NOW - 20000, NOW - 10000] }),
    'alpha-explorer': act({ startedAt: NOW - 27000, since: NOW - 16000, mood: 'done', calls: [NOW - 26000, NOW - 24000, NOW - 20000, NOW - 17000], toolCount: 4 }),
    'ghost-explorer': act({ startedAt: NOW - 26000, since: NOW - 16000, mood: 'failed', calls: [NOW - 25000, NOW - 20000], toolCount: 2 }),
    'beta-explorer': act({ startedAt: NOW - 14000, since: NOW - 7000, mood: 'done', calls: [NOW - 13000, NOW - 9000, NOW - 8000], toolCount: 3 }),
  },
  todos: [
    todo('1', 'T1 read alpha.py', 'completed', 'alpha-explorer', 0, 11), todo('2', 'T2 read ghost.py', 'completed', 'ghost-explorer', 1, 12), todo('3', 'T3 read beta.py', 'completed', 'beta-explorer', 13, 20),
    todo('4', 'T4 combine the reports', 'completed', null, 21, 22), todo('5', 'T5 write the final summary', 'completed', null, 22, 23),
  ],
  notes: [], ...over,
}) as never;


const lanes = (t: string[]): string[] => t.filter((l) => /▇/.test(l));
const bars = (n: Node): Array<{ t: string; color?: string }> => texts(n).filter((x) => /^▇+/.test(x.t));
const axisOf = (t: string[]): { end: string; ticks: number } => { const at = t.findIndex((l) => /┬/.test(l)); return { end: t[at + 1]!.match(/\d+:\d\d/g)!.at(-1)!, ticks: (t[at]!.match(/┬/g) ?? []).length }; };

describe('step 5: the board while blocked (stoprun-150-1: the lead lane green `●` under a blocked band; ghost lane without a glyph)', () => {
  const blocked: Run = { kind: 'blocked', secs: 29, startMs: NOW - 29000 };
  for (const [cols, rows] of [[57, 45], [38, 41]] as const) {
    test(`${cols === 57 ? 150 : 110} cols: the lead lane is 203 with the blocked glyph while the run is blocked`, () => {
      forgetPhases();
      const n = tree(stop(), 'board', cols, rows, blocked);
      expect(bars(n)[0]!.color).toBe(RED);
      const t = textOf(n).split('\n');
      expect(lanes(t)[0]).toMatch(/^ ▲ lead\s/);
    });
    test(`${cols === 57 ? 150 : 110} cols: every lane carries its state glyph, the failed worker's \`■\` included`, () => {
      forgetPhases();
      const t = render(stop(), 'board', cols, rows, blocked);
      for (const l of lanes(t)) expect(l).toMatch(/^ [●■▲◆◇▰]/);
      expect(lanes(t).some((l) => /^ ■ ghost/.test(l))).toBe(true);
    });
    test(`${cols === 57 ? 150 : 110} cols: the axis end equals the run total, ticks every 10 s inside it`, () => {
      forgetPhases();
      const t = render(stop(), 'board', cols, rows, blocked);
      expect(axisOf(t).end).toBe('0:29');
      expect(axisOf(t).ticks).toBeGreaterThanOrEqual(3);
      const foot = t.find((l) => / · (?:total )?\d+:\d\d/.test(l))!;
      expect(/ · (?:total )?(\d+:\d\d)/.exec(foot)![1]).toBe('0:29');
    });
  }
  test('the lead lane follows the run: 141 working, 114 done, 203 blocked, 203 when its own row failed', () => {
    const color = (s: never, run: Run): string | undefined => { forgetPhases(); return bars(tree(s, 'board', 38, 41, run))[0]?.color; };
    expect(color(stop(), { kind: 'working', secs: 29, startMs: NOW - 29000 })).toBe(VIOLET);
    expect(color(stop(), { kind: 'done', secs: 29, startMs: NOW - 29000 })).toBe(GREEN);
    expect(color(stop(), blocked)).toBe(RED);
    expect(leadBarState('blocked', 'running')).toBe('blocked');
    expect(leadBarState('done', 'failed')).toBe('failed');
    expect(leadBarState('working', 'running')).toBe('running');
  });
  test('the helper: a failed lane keeps its glyph; the axis end is the run total at any width', () => {
    const agents = [{ name: 'lead', state: 'blocked' as const, secs: 29, startMs: 0, endMs: 29_000, total: true }, { name: 'ghost-explorer', state: 'failed' as const, secs: 20, startMs: 0, endMs: 20_000 }];
    for (const cols of [38, 57, 100]) {
      const t = boardText(boardTimeline(agents, { cols, ui, runSecs: 29, quiet: new Set(['ghost-explorer']) }));
      expect(lanes(t).every((l) => /^ [▲■]/.test(l))).toBe(true);
      expect(t.at(-1)!.match(/\d+:\d\d/g)!.at(-1)).toBe('0:29');
    }
  });
});
