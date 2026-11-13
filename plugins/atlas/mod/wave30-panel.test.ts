// Wave 30 (critique 28, build a7bc7b0d): the board, the side panel's team and channel tabs and the finish cards, next to btop, lazygit and k9s.
// Every test fails on a7bc7b0d; the capture it comes from is quoted beside it.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from './live_fixture';
import { forgetRefusals } from './data/channels';
import { PALETTE5, type Ui } from './atlas-ui';
import { bodyLines, lineText, toastRuns } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { notificationTree } from './transcript/cards';
import { leadRow, type Lead } from './transcript/leadheader';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
const todo = (id: string, content: string, status: string, owner: string | null, c: number, d: number) => ({ id, content, status, owner, session_id: 's', claimed_at: (NOW - 30000) / 1000 + c, completed_at: status === 'completed' ? (NOW - 30000) / 1000 + d : null });

/** The stop-run of critique 28: alpha and beta finish, ghost is killed, the lead closes ghost's row. */
const snap = (o: { running?: boolean; now?: number } = {}) => {
  const now = o.now ?? NOW;
  return {
    ...busySnap(), phase: 'implement', now, channel: 'lc-vukicic6', sessionId: 's',
    squad: [
      { name: 'alpha-explorer', persona: 'explorer', state: o.running ? 'running' : 'finished', source: 'task' },
      { name: 'ghost-explorer', persona: 'explorer', state: 'failed', source: 'task' },
      { name: 'beta-explorer', persona: 'explorer', state: 'finished', source: 'task' },
    ],
    activity: {
      lead: act({ mood: 'working', toolCount: 5 }),
      'alpha-explorer': act({ startedAt: NOW - 27000, since: o.running ? NOW - 1000 : NOW - 16000, mood: o.running ? 'working' : 'done', calls: [NOW - 26000, NOW - 24000, NOW - 20000, NOW - 17000], toolCount: 4 }),
      'ghost-explorer': act({ startedAt: NOW - 26000, since: NOW - 16000, mood: 'failed', calls: [NOW - 25000, NOW - 20000], toolCount: 2 }),
      'beta-explorer': act({ startedAt: NOW - 14000, since: NOW - 7000, mood: 'done', calls: [NOW - 13000, NOW - 9000, NOW - 8000], toolCount: 3 }),
    },
    todos: [
      todo('1', 'T1 read alpha.py', 'completed', 'alpha-explorer', 0, 11), todo('2', 'T2 read ghost.py', 'completed', 'ghost-explorer', 1, 12), todo('3', 'T3 read beta.py', 'completed', 'beta-explorer', 13, 20),
      todo('4', 'T4 combine the reports', 'completed', null, 21, 22), todo('5', 'T5 write the final summary', 'completed', null, 22, 23),
    ],
    notes: [
      { seq: 1, ts: new Date(NOW - 20000).toISOString(), owner: 'lead', to: 'all', text: 'starting the three reads' },
      { seq: 2, ts: new Date(NOW - 12000).toISOString(), owner: 'alpha-explorer', to: 'lead', text: 'alpha done: two functions', kind: 'handoff' },
      { seq: 3, ts: new Date(NOW - 5000).toISOString(), owner: 'beta-explorer', to: 'lead', text: 'beta done: one function', kind: 'handoff' },
    ],
  } as never;
};
const model = (s: never, view: SidebarView, columns: number, rows: number): SidebarModel => ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows, look: ui } as SidebarModel);
const render = (view: SidebarView, columns: number, rows: number, s = snap()): string[] => { forgetRefusals(); return textOf(sidebarTree(els, model(s, view, columns, rows), on) as unknown as Node).split('\n'); };
const body = (view: SidebarView, columns: number, rows: number, s = snap()): string[] => { forgetRefusals(); return bodyLines(panelModelOf(model(s, view, columns + 1, rows), ui, columns)).map((l) => lineText(l).trimEnd()); };
const SPIN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

const blankRun = (rows: readonly string[]): number => { let max = 0; let run = 0; for (const l of rows) { run = l.trim() === '' ? run + 1 : 0; max = Math.max(max, run); } return max; };
// A post is its sender row (name, word, time, age) and, under it, its text: the row that heads a text.
const headOf = (rows: readonly string[], text: string): string => rows[rows.findIndex((l) => l.includes(text)) - 1] ?? '';
const lastContent = (rows: readonly string[]): number => rows.reduce((n, l, i) => (l.trim() ? i : n), -1);

describe('wave 30 item 3: the channel tab shows each message its own time (stoprun-150-a7bc7b0d-3 tab-channel.png: every row 23:41)', () => {
  const rows = body('channel', 65, 45);
  const stamps = rows.map((l) => /\b(\d\d:\d\d:\d\d)\b/.exec(l)?.[1]).filter((x): x is string => !!x);
  test('the rows of five different messages carry five different times, to the second', () => {
    expect(stamps.length).toBeGreaterThanOrEqual(5);
    expect(new Set(stamps).size).toBe(stamps.length);
  });
  test('each row carries its relative age', () => {
    expect(headOf(rows, 'starting the three reads')).toMatch(/\b20s\b/);
    expect(headOf(rows, 'beta done')).toMatch(/\b5s\b/);
  });
  test('the generated #lc- slug is not drawn', () => {
    expect(render('channel', 65, 45).join('\n')).not.toMatch(/#lc-/);
  });
  test('a closure the store gave no time keeps the time it was first seen, it does not follow the clock', () => {
    const a = body('channel', 65, 45, snap({ now: NOW }));
    const b = body('channel', 65, 45, snap({ now: NOW + 90_000 }));
    const at = (r: string[]): string => /\b(\d\d:\d\d:\d\d)\b/.exec(r.find((l) => l.includes('ghost-explorer'))!)![1]!;
    expect(at(b)).toBe(at(a));
  });
  test('the age is drawn in the dim grey (240), after the time', () => {
    forgetRefusals();
    const pm = panelModelOf(model(snap(), 'channel', 66, 45), ui, 65);
    const all = bodyLines(pm);
    const row = all[all.findIndex((l) => lineText(l).includes('starting the three reads')) - 1]!;
    const age = row.runs.find((x) => /^\s*20s\s*$/.test(x.t));
    expect(age?.tone).toBe('dim');
  });
});

describe('wave 30 item 1: the board is a timeline that fills the pane (stoprun-150-a7bc7b0d-3 tab-board.png: 45% blank, hairline bars)', () => {
  for (const [cols, rows] of [[65, 45], [43, 40]] as const) {
    const out = render('board', cols, rows);
    test(`pane ${cols}x${rows}: no run of more than 3 blank rows and the content reaches the foot`, () => {
      expect(blankRun(out)).toBeLessThanOrEqual(3);
      expect(lastContent(out)).toBeGreaterThanOrEqual(rows - 11); // wave 33: the closure footer line is gone (the plan row carries the failure once), three rows higher again. wave 32: was rows - 6; the closing `closed · N of N` line and the tick-stub rows are gone, so a run-less pane ends two rows higher (a live pane pins the footer to the foot)
    });
    test(`pane ${cols}x${rows}: the bars are solid fills and the axis has tick marks with labels`, () => {
      const text = out.join('\n');
      expect(text).toMatch(/█{2,}/);
      expect(text).not.toMatch(/alpha-explorer\s+━{3,}/);
      expect(text).toMatch(/[┬┼╷]/);
      expect(text).toMatch(/0:00/);
      expect(text).toMatch(/0:2\d/);
    });
    test(`pane ${cols}x${rows}: a summary names the states and the total elapsed time`, () => {
      const text = out.join('\n');
      expect(text).toMatch(/■ T2/); // wave 33: the plan row marks the failure once, the totals do not count it again
      expect(text).toMatch(/2 done/);
      expect(text).toMatch(/0:2\d/); // wave 35: the footer's time, `total 0:2x` where it fits and `0:2x` in the short forms
    });
  }
  test('a running bar grows with the clock and its leading edge moves between frames', () => {
    const at = (ms: number) => render('board', 65, 45, snap({ running: true, now: NOW + ms })).find((l) => l.includes('alpha-explorer') && /[█▏▎▍▌▋▊▉]/.test(l))!;
    const [a, b] = [at(0), at(2000)];
    const fill = (l: string): number => [...l].filter((c) => /[█▏▎▍▌▋▊▉]/.test(c)).length;
    expect(fill(b)).toBeGreaterThan(fill(a));
    const edge = (ms: number): string => at(ms).slice(0, 60);
    expect(new Set([edge(0), edge(200), edge(400), edge(600)]).size).toBeGreaterThan(1);
  });
  test('the axis rule is the 236 divider, not the 240 grey', () => {
    forgetRefusals();
    const src = textOf(sidebarTree(els, model(snap(), 'board', 65, 45), on) as unknown as Node);
    expect(src).toContain('0:00');
    const tree = JSON.stringify(sidebarTree(els, model(snap(), 'board', 65, 45), on));
    expect(tree).toContain(PALETTE5.rule);
  });
});

describe('wave 30 item 2: the team tab names each seat with role, state, time and activity (live-150-a7bc7b0d-1 tab-team.png: four bare rows)', () => {
  const rows = body('team', 65, 45);
  test('the lead row carries its elapsed time', () => {
    expect(rows[0]).toMatch(/lead\b.*\b\d:\d\d\b/);
  });
  test('every worker row has glyph, name, role, state word, elapsed time and a 12-cell activity sparkline', () => {
    for (const n of ['alpha-explorer', 'ghost-explorer', 'beta-explorer']) {
      const l = rows.find((x) => x.includes(n))!;
      expect(l).toMatch(/explorer\s+(done|failed)\s+\d:\d\d\s+[▁-█ ·]{12}/);
    }
  });
  test('a team summary line counts the states and the total time, and the pane is filled', () => {
    expect(rows.join('\n')).toMatch(/workers\s+0 running · 2 done · 1 failed/);
    expect(rows.join('\n')).toMatch(/total\s+0:2\d/);
    expect(lastContent(rows)).toBeGreaterThanOrEqual(11); // wave 33: the failure note is no longer repeated under recent
  });
});

describe('wave 30 item 4: the route tab gives the title the space (stoprun-150-a7bc7b0d-1 f0114:13-17: `T1 read alph…`)', () => {
  const rows = body('route', 57, 45);
  test('a 57-cell pane shows the whole title of every row', () => {
    for (const t of ['T1 read alpha.py', 'T2 read ghost.py', 'T3 read beta.py', 'T4 combine the reports']) expect(rows.join('\n')).toContain(t);
    expect(rows.join('\n')).not.toMatch(/T\d [^\n]*…/);
  });
  test('the phase word wears its state glyph', () => {
    const phase = rows.find((l) => /^\s*phase/.test(l))!;
    expect(phase).toMatch(/^\s*phase\s+[◐●○▲] /);
  });
  test('panel spinners are the accent (141) and the glyph is the band frame', () => {
    forgetRefusals();
    const pm = panelModelOf(model(snap({ running: true }), 'team', 66, 45), ui, 65);
    const row = bodyLines(pm).find((l) => lineText(l).includes('alpha-explorer'))!;
    const spin = row.runs.find((x) => SPIN.test(x.t));
    expect(spin?.tone).toBe('accent');
  });
});

describe('wave 30 item 6: one word per failure, `■ failed` in error 203 (wave 33: the word is `failed`)', () => {
  const all = (): string[] => [...render('board', 65, 45), ...render('team', 65, 45), ...render('channel', 65, 45), ...render('route', 57, 45), ...render('board', 43, 40)];
  test('no surface of this wave says closed, worker killed or killed', () => {
    const text = all().join('\n');
    expect(text).not.toMatch(/\bclosed\b/);
    expect(text).not.toMatch(/worker killed/);
    expect(text).not.toMatch(/\bkilled\b/);
    expect(text).toMatch(/■ [^\n]*\bfailed\b/);
  });
  test('the failed word is the error tone', () => {
    forgetRefusals();
    const pm = panelModelOf(model(snap(), 'team', 66, 45), ui, 65);
    const row = bodyLines(pm).find((l) => lineText(l).includes('ghost-explorer'))!;
    expect(row.runs.find((x) => x.t.trim() === 'failed')?.tone).toBe('bad');
  });
  test('a failure card says failed', () => {
    expect(rowsOfCard(notificationTree('ghost-explorer', 'explorer', 'failed · 0:10', true, ui)).join('\n')).toMatch(/■\s+failed/);
    expect(toastRuns('failed', 'ghost-explorer', '', ui).map((x) => x.t).join('')).toMatch(/failed/);
  });
});

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] };
const flat = (n: unknown): string => (Array.isArray(n) ? n.map(flat).join('') : n && typeof n === 'object' ? flat((n as El).children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '');
const rowsOfCard = (n: unknown): string[] => {
  const e = n as El;
  return e.props?.flexDirection === 'column' ? (e.children ?? []).map(flat) : [flat(e)];
};
const colorsOf = (n: unknown, out: string[] = []): string[] => { const e = n as El; if (Array.isArray(n)) n.forEach((c) => colorsOf(c, out)); else if (e && typeof e === 'object') { if (typeof e.props?.color === 'string') out.push(e.props.color); colorsOf(e.children, out); } return out; };

describe('wave 30 item 5 (rewritten in wave 31): the finish card is one row (critique 29: a framed card wrapped at 110 columns)', () => {
  const FINISH = /▌\s*◆ ATLAS\s+(\S)\s+(\w+)\s+(\S+)\s{2,}\d+:\d\d/; // wave 32: the tail is the time, not `<role> finished`
  const done = rowsOfCard(notificationTree('beta-explorer', 'explorer', 'finished · 0:15', false, ui));
  test('the card is a single row, no frame rules', () => {
    expect(done.length).toBe(1);
    expect(done[0]).toMatch(/^▌/);
  });
  test('the title line still matches the recording harness regex on one line', () => {
    const m = FINISH.exec(done.find((l) => FINISH.test(l))!)!;
    expect([m[1], m[2], m[3]]).toEqual(['●', 'done', 'beta-explorer']);
  });
  test('the bar is the accent and the state glyph carries the state colour', () => {
    const c = colorsOf(notificationTree('beta-explorer', 'explorer', 'finished · 0:15', false, ui));
    expect(c).toContain('#af87ff');
    expect(c).toContain('#87d787');
  });
  test('a failure card is failed and says so in 203', () => {
    const f = rowsOfCard(notificationTree('ghost-explorer', 'explorer', 'killed · 6s', true, ui));
    expect(f.some((l) => /◆ ATLAS\s+■\s+failed\s+ghost-explorer/.test(l))).toBe(true);
    expect(colorsOf(notificationTree('ghost-explorer', 'explorer', 'killed · 6s', true, ui))).toContain('#ff5f5f');
  });
  test('a card with a result stays one row', () => {
    const withResult = rowsOfCard(notificationTree('beta-explorer', 'explorer', 'finished · 0:15 · 1 function', false, ui));
    expect(withResult.length).toBe(1);
  });
});

describe('wave 30 item 5: the lead chip is coloured by its true state', () => {
  const lead = (o: Partial<Lead>): Lead => ({ phase: 'done', count: '4/5', sentence: 'marking T5, the last item', first: '', form: 'display', ...o });
  const barColor = (l: Lead, quiet = false): string => colorsOf(leadRow(l, { ui, columns: 100, quiet }))[0]!;
  test('a 4/5 progress note is the accent, not the done green', () => {
    expect(barColor(lead({}))).toBe('#af87ff');
    expect(barColor(lead({ count: '5/5', sentence: 'all five rows closed' }))).toBe('#87d787');
  });
  test('a 4/5 progress note does not say done', () => {
    expect(flat(leadRow(lead({}), { ui, columns: 100 }))).not.toMatch(/\bdone\b/);
  });
  test('a quiet chip with a bare count prints no row of its own', () => {
    const t = flat(leadRow(lead({ count: '5/5', sentence: '' }), { ui, columns: 100, quiet: true }));
    expect(t.trim()).toBe('');
  });
});
