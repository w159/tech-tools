// Wave 32 (critique 30, build a839663a): the side panel's route, channel, team and board tabs, and the transcript cards.
// Every test fails on a839663a; the defect it comes from is quoted beside it.
import { describe, expect, test } from 'claude-code/testing';
import { resetWorkerFacts } from './data/live';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from './live_fixture';
import { forgetRefusals } from './data/channels';
import { forgetBandFrame } from './motion';
import { type Ui } from './atlas-ui';
import { bodyLines, lineText, type PanelLine } from './panel-layout';
import { forgetPhases, panelModelOf } from './pane/sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { placedTree, placeFinished, forgetPlaced } from './transcript/placed';
import { durationTree } from './restyle';
import { memState } from './test_helpers';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
const todo = (id: string, content: string, status: string, owner: string | null, c: number, d: number) => ({ id, content, status, owner, session_id: 's', claimed_at: (NOW - 30000) / 1000 + c, completed_at: status === 'completed' ? (NOW - 30000) / 1000 + d : null });

const snap = (o: { notes?: boolean; running?: boolean } = {}) => ({
  ...busySnap(), phase: 'implement', now: NOW, channel: 'lc-vukicic6', sessionId: 's',
  squad: [
    { name: 'alpha-explorer', persona: 'explorer', state: o.running ? 'running' : 'finished', source: 'task' },
    { name: 'ghost-explorer', persona: 'explorer', state: 'failed', source: 'task' },
    { name: 'beta-explorer', persona: 'explorer', state: 'finished', source: 'task' },
  ],
  activity: {
    lead: act({ mood: 'working', toolCount: 5, startedAt: NOW - 27000 }),
    'alpha-explorer': act({ startedAt: NOW - 27000, since: o.running ? NOW - 1000 : NOW - 16000, mood: o.running ? 'working' : 'done', calls: [NOW - 26000, NOW - 24000, NOW - 20000, NOW - 17000], toolCount: 4 }),
    'ghost-explorer': act({ startedAt: NOW - 26000, since: NOW - 16000, mood: 'failed', calls: [NOW - 25000, NOW - 20000], toolCount: 2 }),
    'beta-explorer': act({ startedAt: NOW - 14000, since: NOW - 7000, mood: 'done', calls: [NOW - 13000, NOW - 9000, NOW - 8000], toolCount: 3 }),
  },
  todos: [
    todo('1', 'T1 read alpha.py', 'completed', 'alpha-explorer', 0, 11), todo('2', 'T2 read ghost.py', 'completed', 'ghost-explorer', 1, 12), todo('3', 'T3 read beta.py', 'completed', 'beta-explorer', 13, 20),
    todo('4', 'T4 combine the reports', 'in_progress', null, 21, 22), todo('5', 'T5 write the final summary', 'pending', null, 22, 23),
  ],
  notes: o.notes === false ? [] : [
    { seq: 1, ts: new Date(NOW - 20000).toISOString(), owner: 'lead', to: 'all', text: 'starting the three reads' },
    { seq: 2, ts: new Date(NOW - 12000).toISOString(), owner: 'alpha-explorer', to: 'lead', text: 'alpha done: two functions', kind: 'handoff' },
  ],
}) as never;
type Run = NonNullable<SidebarModel['run']>;
const RUN: Run = { kind: 'working', secs: 57, startMs: NOW - 57000 };
const model = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null = RUN, look: Ui = ui): SidebarModel => ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows, look, ...(run ? { run } : {}) } as SidebarModel);
const render = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN, look: Ui = ui): string[] => { forgetRefusals(); forgetBandFrame(); return textOf(sidebarTree(els, model(s, view, columns, rows, run, look), on) as unknown as Node).split('\n'); };
const bodyOf = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN): PanelLine[] => { forgetRefusals(); forgetBandFrame(); return bodyLines(panelModelOf(model(s, view, columns + 1, rows, run), ui, columns)); };
const body = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN): string[] => bodyOf(view, columns, rows, s, run).map((l) => lineText(l).trimEnd());
const SPIN_MARK = /[◐◓◑◒]/;
const NO_BRAILLE = /[\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f]/; // the retired ten-frame lead set (the sparkline's cells are other code points)


const flat = (tree: unknown): string => {
  const out: string[] = [];
  const walk = (n: unknown): void => { if (typeof n === 'string') out.push(n); else if (n && typeof n === 'object') { const c = (n as { children?: unknown }).children; for (const k of Array.isArray(c) ? c : c == null ? [] : [c]) walk(k); } };
  walk(tree);
  return out.join('');
};
const width = (l: string): number => [...l].length;

describe('item 1: the route tab carries the phase timeline (critique 30: the tab had no content under the todo gauge)', () => {
  test('a `timeline` head and one chain of the phases, the current one on the spinner with its elapsed time', () => {
    forgetPhases();
    const t = render('route', 66, 45).join('\n');
    expect(t).toMatch(/phase /);
    expect(t).toMatch(/· research › · theory › · test › [◐◓◑◒] implement 0:57 › · verify/); // wave 34: a phase is green only once the run was in it
  });
  test('the plan is not drawn here (wave 34: the HUD above the prompt and the board tab list it)', () => {
    const t = render('route', 66, 45).join('\n');
    expect(t).not.toMatch(/T1 read alpha\.py|plan {2}▰/);
  });
});

describe('item 2: the channel tab (critique 30: `no messages yet` floated mid-pane)', () => {
  const empty = () => render('channel', 66, 45, { ...(snap({ notes: false }) as object), squad: [], todos: [], activity: {} } as never);
  test('one `○ no messages` row, left on the rows indent, right under the head', () => {
    const rows = empty();
    const at = rows.findIndex((l) => l.includes('○ no messages'));
    expect(at).toBeGreaterThan(3);
    expect(rows.filter((l) => l.includes('no messages'))).toHaveLength(1);
    expect(rows[at]!.length - rows[at]!.trimStart().length).toBe(4);
    expect(rows.join('\n')).not.toContain('no messages yet');
  });
  test('the pane keeps its height with nothing to say', () => {
    expect(empty()).toHaveLength(45);
  });
});

describe('item 3: the team tab (critique 30: unaligned sparklines, a `scale` legend, lead 0:26 against 0:57)', () => {
  const rows = () => render('team', 66, 45);
  test('no `scale` legend', () => {
    expect(rows().join('\n')).not.toMatch(/\bscale\b/);
  });
  test('the lead row carries the run total, the one clock of the board and the band', () => {
    const lead = rows().find((l) => l.includes('lead') && l.includes('running'))!;
    expect(lead).toMatch(/\b0:57\b/);
    expect(rows().join('\n')).toMatch(/total\s+0:57/);
  });
  test('every sparkline starts in one column and ends in one column', () => {
    const lines = rows().filter((l) => /[⣀⣤⣶⣿]{2,}/.test(l) && /(explorer|lead)/.test(l));
    expect(lines.length).toBe(4);
    const ends = new Set(lines.map((l) => width(l.trimEnd().replace(/\s+$/, ''))));
    const starts = new Set(lines.map((l) => l.search(/[⣀⣤⣶⣿]/)));
    expect(starts.size).toBe(1);
    expect(ends.size).toBeLessThanOrEqual(3); // trailing blanks of an idle tail aside
  });
});

describe('item 4: the board (critique 30: colliding axis labels, ticks past the bars, a floating hint)', () => {
  for (const [cols, rows] of [[150, 61], [110, 50], [66, 45]] as const) {
    const out = () => render('board', cols, rows);
    test(`${cols} cols: the axis labels are apart and no tick runs past the last bar`, () => {
      const o = out();
      const ticks = o.findIndex((l) => /┬/.test(l));
      expect(ticks).toBeGreaterThan(0);
      const labels = o[ticks + 1]!;
      expect(labels).not.toMatch(/\d:\d\d\d:\d\d/); // no two labels run together
      expect(labels).not.toMatch(/\S\d:\d\d/); // each label has a blank before it
      expect(o.some((l) => /▇/.test(l))).toBe(true); // wave 38: one-row `▇` bars
      expect(labels.match(/\d:\d\d/g)!.at(-1)).toBe('1:00'); // wave 38: the axis ends at the 0:57 run rounded up to 10 s, at every width
      expect(o[ticks]!.trimEnd().length).toBeLessThanOrEqual(cols - 1); // and no tick runs past the pane
    });
    test(`${cols} cols: the total and the close hint share the last row`, () => {
      const o = out();
      const foot = o.filter((l) => l.trim()).at(-1)!;
      expect(foot).toMatch(/total 0:57/);
      expect(foot).toMatch(/o closes/);
      expect(o.filter((l) => l.includes('o closes'))).toHaveLength(1);
    });
    test(`${cols} cols: no repeated \`5 of 5 items done\` and no unlabelled tick stub`, () => {
      const o = out().join('\n');
      expect(o).not.toMatch(/5 of 5 items done/);
      expect(o).not.toMatch(/closed ·/);
    });
  }
});

describe('item 5: one spinner vocabulary (critique 30: circles in the panel, braille in the band; now the circle quarters on both)', () => {
  test('the route phase row and the team lead row wear the one spinner, never braille', () => {
    const route = render('route', 66, 45);
    expect(route.find((l) => l.includes('phase'))).toMatch(SPIN_MARK);
    expect(route.find((l) => l.includes('phase'))).not.toMatch(NO_BRAILLE);
    const team = render('team', 66, 45, snap({ running: true }));
    const lead = team.find((l) => l.includes('lead') && l.includes('running'))!;
    expect(lead).toMatch(SPIN_MARK);
    expect(lead).not.toMatch(NO_BRAILLE);
    expect(team.find((l) => l.includes('alpha-explorer'))).toMatch(SPIN_MARK);
  });
  test('no braille spinner anywhere on the Claude pane (one family, the circle quarters)', () => {
    for (const v of ['route', 'team', 'channel', 'board'] as const) expect(render(v, 66, 45, snap({ running: true })).join('\n')).not.toMatch(NO_BRAILLE);
  });
  test('the start card animates: the dispatch card takes the spinner frame, frames differ', () => {
    const a = flat(toastWith(0)), b = flat(toastWith(3));
    expect(a).toMatch(SPIN_MARK);
    expect(a).not.toBe(b);
  });
});

import { toastRuns } from './panel-layout';
import { workerCard } from './transcript/cards';
function toastWith(frame: number) {
  const card = workerCard({ tool: 'Agent', input: { subagent_type: 'atlas:implementer', name: 'impl-a', description: 'd', prompt: 'GOAL: x', model: 'sonnet' }, isRunning: true, isErrored: false, isInterrupted: false } as never, 'running', 60, undefined, '', { now: 'Grep', wave: 1, frame } as never);
  return card as never;
}

describe('item 6: the finish card (critique 30: `done ... explorer finished`, a static brand, an unlabelled time)', () => {
  const card = async () => {
    forgetPlaced();
    const ids: string[] = [];
    const eng = { ui: { place: async ({ id }: { id: string }) => { ids.push(id); return { isPlaced: true, requestId: id }; } } } as never;
    const s = (state: string, now: number, extra: Record<string, unknown>) => ({ ...(snap() as object), now, squad: [{ name: 'alpha-explorer', persona: 'explorer', state, source: 'task' }], activity: { 'alpha-explorer': extra }, comms: [], todoGroups: [] }) as never;
    await placeFinished(eng, s('running', NOW - 12000, { tool: null, since: 0, toolCount: 0, tokens: null, mood: 'working', lastLine: '', startedAt: NOW - 12000 }), s('finished', NOW, { tool: null, since: NOW - 1000, toolCount: 2, tokens: null, mood: 'done', lastLine: '', startedAt: NOW - 12000, calls: [NOW - 9000, NOW - 5000] }));
    const row = flat(placedTree(ids[0]!, ui));
    forgetPlaced();
    return row;
  };
  test('`▌ ◆ ATLAS  ● done  alpha-explorer  ...  0:11 · 2 calls`: done once, the time then its calls', async () => {
    resetWorkerFacts();
    const row = await card();
    expect(row).toMatch(/^▌ ◆ ATLAS\s+● done\s+alpha-explorer\s+0:11 · 2 calls$/); // wave 34: the figure counts tool calls, so it says calls
    expect(row).not.toContain('finished');
  });
  test('the turn footer is labelled: `turn 0:17` (the turn time, not the run total)', () => {
    const snapNow = { counts: { done: 0, total: 0 }, squad: [], contextPct: 0 } as never;
    expect(flat(durationTree(snapNow, { durationMs: 17000 }, {} as never, null, ui))).toMatch(/turn 0:17/);
  });
});
