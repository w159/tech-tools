// Wave 31 (critique 29, build 0ed6e55b): one-row toasts and finish cards, a side panel whose state is the band's, one run clock on the board and the tabs.
// Every test fails on 0ed6e55b; the capture it comes from is quoted beside it.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from './live_fixture';
import { forgetRefusals } from './data/channels';
import type { Ui } from './atlas-ui';
import { boardText, boardTimeline } from './board-model';
import { bodyLines, lineText } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { FINISH_W, finishWidth, notificationTree } from './transcript/cards';
import { cardFade, cardStackHidden, cardAged, forgetPlaced } from './transcript/placed';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'truecolor' };
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] };
const flat = (n: unknown): string => (Array.isArray(n) ? n.map(flat).join('') : n && typeof n === 'object' ? flat((n as El).children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '');
const rowsOfCard = (n: unknown): string[] => {
  const e = n as El;
  return e.props?.flexDirection === 'column' ? (e.children ?? []).map(flat) : [flat(e)];
};
const colorsOf = (n: unknown, out: string[] = []): string[] => { const e = n as El; if (Array.isArray(n)) n.forEach((c) => colorsOf(c, out)); else if (e && typeof e === 'object') { if (typeof e.props?.color === 'string') out.push(e.props.color); colorsOf(e.children, out); } return out; };
const cells = (s: string): number => [...s].length;

const todo = (id: string, content: string, status: string, owner: string | null, c: number, d: number) => ({ id, content, status, owner, session_id: 's', claimed_at: (NOW - 30000) / 1000 + c, completed_at: status === 'completed' ? (NOW - 30000) / 1000 + d : null });
const snap = (now = NOW) => ({
  ...busySnap(), phase: 'implement', now, channel: 'lc-vukicic6', sessionId: 's',
  squad: [
    { name: 'alpha-explorer', persona: 'explorer', state: 'finished', source: 'task' },
    { name: 'ghost-explorer', persona: 'explorer', state: 'failed', source: 'task' },
    { name: 'beta-explorer', persona: 'explorer', state: 'finished', source: 'task' },
  ],
  activity: {
    lead: act({ mood: 'working', toolCount: 5 }),
    'alpha-explorer': act({ startedAt: NOW - 27000, since: NOW - 16000, mood: 'done', calls: [NOW - 26000, NOW - 24000, NOW - 20000, NOW - 17000], toolCount: 4 }),
    'ghost-explorer': act({ startedAt: NOW - 26000, since: NOW - 16000, mood: 'failed', calls: [NOW - 25000, NOW - 20000], toolCount: 2 }),
    'beta-explorer': act({ startedAt: NOW - 14000, since: NOW - 7000, mood: 'done', calls: [NOW - 13000, NOW - 9000, NOW - 8000], toolCount: 3 }),
  },
  todos: [
    todo('1', 'T1 read alpha.py', 'completed', 'alpha-explorer', 0, 11), todo('2', 'T2 read ghost.py', 'completed', 'ghost-explorer', 1, 12), todo('3', 'T3 read beta.py', 'completed', 'beta-explorer', 13, 20),
  ],
  notes: [
    { seq: 1, ts: new Date(NOW - 20000).toISOString(), owner: 'lead', to: 'all', text: 'starting the three reads' },
    { seq: 2, ts: new Date(NOW - 12000).toISOString(), owner: 'alpha-explorer', to: 'lead', text: 'alpha done: two functions', kind: 'handoff' },
    { seq: 3, ts: new Date(NOW - 5000).toISOString(), owner: 'beta-explorer', to: 'lead', text: 'beta done: one function', kind: 'handoff' },
  ],
}) as never;
type Run = NonNullable<SidebarModel['run']>;
const model = (view: SidebarView, columns: number, rows: number, run?: Run): SidebarModel => ({ snapshot: snap(), gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows, look: ui, ...(run ? { run } : {}) } as SidebarModel);
const render = (view: SidebarView, columns: number, rows: number, run?: Run): string[] => { forgetRefusals(); return textOf(sidebarTree(els, model(view, columns, rows, run), on) as unknown as Node).split('\n'); };
const body = (view: SidebarView, columns: number, rows: number, run?: Run): string[] => { forgetRefusals(); return bodyLines(panelModelOf(model(view, columns + 1, rows, run), ui, columns)).map((l) => lineText(l).trimEnd()); };

describe('wave 31 item 1: a toast or finish card is one clean row (critique 29: `● don` / `e` at 110 columns, widths 42/62/61)', () => {
  for (const cols of [110, 150, 60]) {
    test(`at ${cols} columns the card is one row no wider than min(56, cols - 4), no frame`, () => {
      const rows = rowsOfCard(notificationTree('beta-explorer', 'explorer', 'finished · 0:13', false, ui, false, { cols }));
      expect(rows).toHaveLength(1);
      expect(cells(rows[0]!)).toBe(Math.min(56, cols - 4));
      expect(rows[0]).not.toMatch(/[▛▜▙▟╭╮╰╯]/);
    });
  }
  test('the width is fixed whatever the name', () => {
    expect(FINISH_W).toBe(56);
    expect(finishWidth(110)).toBe(56);
    expect(finishWidth(40)).toBe(36);
    const w = (name: string): number => cells(rowsOfCard(notificationTree(name, 'explorer', 'finished · 0:13', false, ui, false, { cols: 110 }))[0]!);
    expect(new Set([w('a'), w('beta-explorer'), w('a-very-long-worker-name-that-needs-cutting-down-to-size')]).size).toBe(1);
  });
  test('the row reads `▌ ◆ ATLAS  ● done  beta-explorer ... 0:13` (wave 32: `explorer finished` is gone, so the scorer regex no longer applies)', () => {
    const t = rowsOfCard(notificationTree('beta-explorer', 'explorer', 'finished · 0:13', false, ui, false, { cols: 110 }))[0]!;
    expect(t).toMatch(/▌\s*◆ ATLAS\s+(\S)\s+(\w+)\s+(\S+)\s{2,}\d+:\d\d/);
    expect(t.trimEnd()).toMatch(/0:13 · -$/); // wave 37: a card with no count ends in the calls column's dash
    expect(/▌\s*◆ ATLAS\s+(\S)\s+(\w+)\s+(\S+)/.exec(t)!.slice(1, 4)).toEqual(['●', 'done', 'beta-explorer']);
  });
  test('a long name is cut with an ellipsis (`~` in ASCII) before anything else, and the row stays one row', () => {
    const long = 'a-very-long-worker-name-that-needs-cutting-down-to-size';
    const t = rowsOfCard(notificationTree(long, 'explorer', 'finished · 0:13', false, ui, false, { cols: 110 }))[0]!;
    expect(t).toContain('…');
    expect(t).toMatch(/0:13 · -\s*$/);
    const a = rowsOfCard(notificationTree(long, 'explorer', 'finished · 0:13', false, ascii, false, { cols: 110 }))[0]!;
    expect(a).toContain('~');
    expect(a).not.toContain('…');
  });
  test('the bar is the accent and fades to 245 once the card has aged', () => {
    const bar = (fade: number): string => colorsOf(notificationTree('beta-explorer', 'explorer', 'finished · 0:13', false, ui, false, { cols: 110, fade }))[0]!;
    expect(bar(0)).toBe('#af87ff');
    expect(bar(1)).toBe('#8a8a8a');
  });
  test('a failure card keeps its 203 mark and stays one row', () => {
    const n = notificationTree('ghost-explorer', 'explorer', 'killed · 0:06', true, ui, false, { cols: 110, fade: 1 });
    expect(colorsOf(n)).toContain('#ff5f5f');
    expect(rowsOfCard(n)).toHaveLength(1);
  });
  test('the fade takes one second and at most two cards stack, the newest replacing the oldest', () => {
    forgetPlaced();
    for (const k of ['done-a', 'done-b', 'done-c']) cardAged(k, 1_000);
    expect(cardFade('done-a', 1_000)).toBe(0);
    expect(Math.abs(cardFade("done-a", 1_500) - 0.5) < 1e-9).toBe(true);
    expect(cardFade('done-a', 2_000)).toBe(1);
    expect(cardFade('done-a', 9_000)).toBe(1);
    expect(cardStackHidden('done-a', 30_000)).toBe(true);
    expect(cardStackHidden('done-b', 30_000)).toBe(false);
    expect(cardStackHidden('done-c', 30_000)).toBe(false);
    forgetPlaced();
  });
});

describe('wave 31 item 2: the panel phase row is the band (critique 29: `phase ● done` under a working band)', () => {
  const phase = (run: Run): string => body('route', 65, 45, run).find((l) => l.trimStart().startsWith('phase'))!;
  test('working: a spinner and `working`', () => {
    expect(phase({ kind: 'working' })).toMatch(/phase\s+[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◐◓◑◒]\s+working/);
  });
  test('done: `● done`', () => {
    expect(phase({ kind: 'done' })).toMatch(/phase\s+●\s+done/);
  });
  test('idle: `○ idle`', () => {
    expect(phase({ kind: 'idle' })).toMatch(/phase\s+○\s+idle/);
  });
  test('blocked: `▲ blocked`', () => {
    expect(phase({ kind: 'blocked' })).toMatch(/phase\s+▲\s+blocked/);
  });
  test('the replayed sequence working -> done -> idle -> blocked reads the band each time', () => {
    const words = (['working', 'done', 'idle', 'blocked'] as const).map((kind) => /\b(working|done|idle|blocked)\b/.exec(phase({ kind }))![1]);
    expect(words).toEqual(['working', 'done', 'idle', 'blocked']);
  });
  test('the word wears the band tones: 141, 114, 245, 203', () => {
    const tone = (kind: Run['kind']): string | undefined => {
      forgetRefusals();
      const line = bodyLines(panelModelOf(model('route', 66, 45, { kind }), ui, 65)).find((l) => lineText(l).trimStart().startsWith('phase'))!;
      return line.runs.find((x) => /^(working|done|idle|blocked)$/.test(x.t))?.tone;
    };
    expect([tone('working'), tone('done'), tone('idle'), tone('blocked')]).toEqual(['accent', 'ok', 'muted', 'bad']);
  });
});

describe('wave 31 item 3: the channel tab times are the run clock and the pane is filled (critique 29: `01:30:26`, a `0s` column, 80% blank)', () => {
  const rows = body('channel', 65, 45, { kind: 'working', secs: 28, startMs: NOW - 28000 });
  test('each post carries `+m:ss` seconds from the run start', () => {
    const text = rows.join('\n');
    expect(text).toMatch(/\+0:08\b/);
    expect(text).toMatch(/\+0:23\b/);
    expect(text).not.toMatch(/\b\d\d:\d\d:\d\d\b/);
  });
  test('there is no `0s` age column', () => {
    expect(rows.filter((l) => /\b\d+s\s*$/.test(l))).toHaveLength(0);
  });
  test('the pane carries the counts per kind; the `last by sender` block is gone (wave 33)', () => {
    const text = rows.join('\n');
    expect(text).toMatch(/\d+ posts/);
    expect(text).not.toMatch(/last by sender/);
  });
});

describe('wave 31 item 4: the team tab histogram carries the band total (wave 32 dropped its `scale` legend)', () => {
  test('there is no `scale` legend row', () => {
    expect(body('team', 65, 45, { kind: 'working', secs: 28 }).join('\n')).not.toMatch(/\bscale\b/);
  });
  test('the total is the band run clock', () => {
    expect(body('team', 65, 45, { kind: 'working', secs: 61 }).join('\n')).toMatch(/total\s+1:01/);
  });
});

describe('wave 31 item 5: the board has a ticked axis, N calls labels and rows in start order', () => {
  const agents = [
    { name: 'beta-explorer', state: 'done' as const, secs: 7, startMs: 13_000, endMs: 20_000, calls: [14_000, 18_000, 19_000] },
    { name: 'alpha-explorer', state: 'done' as const, secs: 11, startMs: 0, endMs: 11_000, calls: [1_000, 3_000, 7_000, 10_000] },
    { name: 'ghost-explorer', state: 'failed' as const, secs: 10, startMs: 1_000, endMs: 11_000, calls: [2_000, 7_000] },
  ];
  const t = boardText(boardTimeline(agents, { cols: 65, ui }));
  test('rows come in start order, not completion order', () => {
    const at = (n: string): number => t.findIndex((l) => l.includes(n));
    expect(at('alpha-explorer')).toBeLessThan(at('ghost-explorer'));
    expect(at('ghost-explorer')).toBeLessThan(at('beta-explorer'));
  });
  test('the axis ends at the run rounded up to 10 s, with a tick every 10 s', () => {
    const labels = (t.at(-1)!.match(/\d+:\d\d/g) ?? []).map((x) => Number(x.split(':')[0]) * 60 + Number(x.split(':')[1]));
    expect(labels[0]).toBe(0);
    expect(labels.every((v, i) => i === 0 || v - labels[i - 1]! === 10)).toBe(true);
    expect(labels.at(-1)!).toBe(20); // 0:11 rounded up to the next 10 s
    expect(t.at(-2)!.match(/┬/g)).toHaveLength(3); // 0:00, 0:10, 0:20
  });
  test('the failed word is on the plan row and in the footer count (wave 35) and no full-width rule runs under it', () => {
    const out = render('board', 65, 45, { kind: 'working', secs: 28 });
    expect(out.filter((l) => /\bfailed\b/.test(l))).toHaveLength(2);
    expect(out.filter((l) => /^\s*[━─]{40,}\s*$/.test(l))).toHaveLength(0);
  });
  test('the sparkline rows say `N calls`', () => {
    const out = render('board', 65, 45, { kind: 'working', secs: 28 }).join('\n');
    expect(out).toMatch(/\d+ calls/);
  });
});

describe('wave 31 item 6: one failure word', () => {
  test('the card says `failed` (wave 33), never `killed`', () => {
    const card = rowsOfCard(notificationTree('ghost-explorer', 'explorer', 'failed · 0:06', true, ui, false, { cols: 110 }))[0]!;
    expect(card).toMatch(/■\s+failed/);
    expect(card).not.toMatch(/killed/);
  });
  test('the board says `failed` (wave 33), never `killed`', () => {
    const out = render('board', 65, 45, { kind: 'working', secs: 28 }).join('\n');
    expect(out).toMatch(/■ [^\n]*\bfailed\b/);
    expect(out).not.toMatch(/\bkilled\b/);
  });
});
