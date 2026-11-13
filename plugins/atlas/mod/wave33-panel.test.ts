// Wave 33 (critique 31, build bc619a51): one failure shown once, in one word (`failed`), an honest finish chip, one toast fade, no channel slug,
// a plan on the route tab, team sparklines, one divider colour and an evenly ticked board axis. Every test fails on bc619a51; the defect it
// comes from is quoted beside it.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from './live_fixture';
import { forgetRefusals } from './data/channels';
import { type Ui } from './atlas-ui';
import { bodyLines, lineText, channelLabel, cardBarTone, toastRuns, noteToastRuns } from './panel-layout';
import { panelModelOf } from './pane/sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { boardTimeline } from './board-model';
import { notificationTree } from './transcript/cards';
import { leadRow, verdictOf, type Lead } from './transcript/leadheader';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
const todo = (id: string, content: string, status: string, owner: string | null, c: number, d: number) => ({ id, content, status, owner, session_id: 's', claimed_at: (NOW - 30000) / 1000 + c, completed_at: status === 'completed' ? (NOW - 30000) / 1000 + d : null });

const snap = (channel = 'lc-vukicic6') => ({
  ...busySnap(), phase: 'implement', now: NOW, channel, sessionId: 's',
  squad: [
    { name: 'alpha-explorer', persona: 'explorer', state: 'finished', source: 'task' },
    { name: 'ghost-explorer', persona: 'explorer', state: 'failed', source: 'task' },
    { name: 'beta-explorer', persona: 'explorer', state: 'finished', source: 'task' },
  ],
  activity: {
    lead: act({ mood: 'working', toolCount: 5, startedAt: NOW - 27000 }),
    'alpha-explorer': act({ startedAt: NOW - 27000, since: NOW - 16000, mood: 'done', calls: [NOW - 26000, NOW - 24000, NOW - 20000, NOW - 17000], toolCount: 4 }),
    'ghost-explorer': act({ startedAt: NOW - 26000, since: NOW - 16000, mood: 'failed', calls: [NOW - 25000, NOW - 20000], toolCount: 2 }),
    'beta-explorer': act({ startedAt: NOW - 14000, since: NOW - 7000, mood: 'done', calls: [NOW - 13000, NOW - 9000, NOW - 8000], toolCount: 3 }),
  },
  todos: [
    todo('1', 'T1 read alpha.py', 'completed', 'alpha-explorer', 0, 11), todo('2', 'T2 read ghost.py', 'completed', 'ghost-explorer', 1, 12), todo('3', 'T3 read beta.py', 'completed', 'beta-explorer', 13, 20),
    todo('4', 'T4 combine the reports', 'in_progress', null, 21, 22), todo('5', 'T5 write the final summary', 'pending', null, 22, 23),
  ],
  notes: [
    { seq: 1, ts: new Date(NOW - 20000).toISOString(), owner: 'lead', to: 'all', text: 'starting the three reads' },
    { seq: 2, ts: new Date(NOW - 12000).toISOString(), owner: 'alpha-explorer', to: 'lead', text: 'alpha done: two functions', kind: 'handoff' },
  ],
}) as never;
type Run = NonNullable<SidebarModel['run']>;
const RUN: Run = { kind: 'working', secs: 57, startMs: NOW - 57000 };
const model = (s: never, view: SidebarView, columns: number, rows: number, run: Run | null = RUN, look: Ui = ui): SidebarModel => ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns, rows, look, ...(run ? { run } : {}) } as SidebarModel);
const tree = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN, look: Ui = ui): Node => { forgetRefusals(); return sidebarTree(els, model(s, view, columns, rows, run, look), on) as unknown as Node; };
const render = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN, look: Ui = ui): string[] => textOf(tree(view, columns, rows, s, run, look)).split('\n');
const body = (view: SidebarView, columns: number, rows: number, s = snap(), run: Run | null = RUN): string[] => { forgetRefusals(); return bodyLines(panelModelOf(model(s, view, columns + 1, rows, run), ui, columns)).map((l) => lineText(l).trimEnd()); };

type El = { type?: string; props?: Record<string, any>; children?: unknown };
const flat = (n: unknown): string => (Array.isArray(n) ? n.map(flat).join('') : n && typeof n === 'object' ? flat((n as El).children) : typeof n === 'string' || typeof n === 'number' ? String(n) : '');
const colorsOf = (n: unknown, out: string[] = []): string[] => { const e = n as El; if (Array.isArray(n)) n.forEach((c) => colorsOf(c, out)); else if (e && typeof e === 'object') { if (typeof e.props?.color === 'string') out.push(e.props.color); colorsOf(e.children, out); } return out; };
/** The colour of the Text whose content is one run of `─`, in a rendered node tree. */
const ruleColors = (n: Node, out: Array<string | undefined>): Array<string | undefined> => {
  if (n.kind === 'Text' && /^─{3,}$/.test(String(n.props.children ?? ''))) out.push(n.props.color ?? n.props.fg);
  for (const k of kids(n)) ruleColors(k, out);
  return out;
};

const PURPLE = '#af87ff'; // 141
const GREY = '#8a8a8a'; // 245
const AMBER = '#d7af5f'; // 179
const RED = '#ff5f5f'; // 203
const GREEN = '#87d787'; // 114

describe('item 1: one kill shows once (critique 31: the same kill printed four times on the board)', () => {
  const out = render('board', 65, 45);
  test('the board names the failure on its plan row only', () => {
    expect(out.filter((l) => /\bfailed\b/.test(l))).toHaveLength(1);
    expect(out.filter((l) => /^\s*■ T2/.test(l))).toHaveLength(1);
  });
  test('the totals, the chart row and the recent list do not repeat it', () => {
    expect(out.filter((l) => /ghost-explorer/.test(l) && /■/.test(l))).toHaveLength(1); // the plan row (owner shown) only; the chart row has no end mark
    expect(out.find((l) => /\btotal\b/.test(l)) ?? '').not.toMatch(/failed|■/);
    expect(out.join('\n')).not.toMatch(/T\d failed · ghost-explorer/);
  });
});

describe('item 2: the failure word is `failed` on every surface (critique 31: `killed` here, `failed` there)', () => {
  test('board, team, channel, route and the card never say killed', () => {
    for (const v of ['board', 'team', 'channel', 'route'] as const) expect(render(v, 65, 45).join('\n')).not.toMatch(/\bkilled\b/);
    expect(render('team', 65, 45).join('\n')).toMatch(/■[^\n]*\bfailed\b/);
  });
  test('the card says `■ failed` for every spelling of the outcome', () => {
    for (const outcome of ['killed · 0:06', 'failed · 0:06', 'error · 0:06']) {
      const t = flat(notificationTree('ghost-explorer', 'explorer', outcome, true, ui, false, { cols: 110 }));
      expect(t).toMatch(/◆ ATLAS\s+■\s+failed\s+ghost-explorer/);
      expect(t).not.toMatch(/killed/);
    }
  });
});

describe('item 3: the finish chip tells the truth (critique 31: a green `all finished` over a failed worker and an open dispatch)', () => {
  const lead = (o: Partial<Lead> = {}): Lead => ({ phase: 'done', count: '', sentence: 'all finished', first: '', form: 'display', ...o });
  test('a clean run keeps the done green', () => {
    expect(verdictOf(0, 0, false)).toBeNull();
    const chip = leadRow(lead(), { ui, columns: 100, verdict: verdictOf(0, 0, false) });
    expect(colorsOf(chip)[0]).toBe(GREEN);
    expect(flat(chip)).toMatch(/done/);
  });
  test('a failed worker reads `▌ done · 1 failed` in the warn 179', () => {
    const chip = leadRow(lead(), { ui, columns: 100, verdict: verdictOf(1, 0, false) });
    expect(flat(chip)).toBe('▌ done · 1 failed');
    expect(new Set(colorsOf(chip).filter((c) => c !== undefined)).has(AMBER)).toBe(true);
    expect(colorsOf(chip)[0]).toBe(AMBER);
    expect(flat(chip)).not.toMatch(/all finished/);
  });
  test('a Stop refusal reads `▌ ▲ blocked · 1 dispatch open` in the error 203', () => {
    const chip = leadRow(lead(), { ui, columns: 100, verdict: verdictOf(0, 1, true) });
    expect(flat(chip)).toBe('▌ ▲ blocked · 1 dispatch open');
    expect(new Set(colorsOf(chip)).has(RED)).toBe(true);
    expect(new Set(colorsOf(chip)).has(GREEN)).toBe(false);
    expect(verdictOf(2, 3, true)?.text).toBe('2 failed · 3 dispatches open');
  });
});

describe('item 4: every toast bar fades the same way (critique 31: each kind had its own bar colour)', () => {
  test('141 on arrival and 245 once faded, for every card kind', () => {
    expect(cardBarTone(0)).toBe('accent');
    expect(cardBarTone(1)).toBe('sub');
    for (const s of ['done', 'failed', 'running', 'blocked'] as const) {
      expect(toastRuns(s, 'name', 'fact', ui, false, 0, 0)[0]!.tone).toBe('accent');
      expect(toastRuns(s, 'name', 'fact', ui, false, 0, 1)[0]!.tone).toBe('sub');
    }
    expect(noteToastRuns('lead', 'hello', ui, 0)[0]!.tone).toBe('accent');
    expect(noteToastRuns('lead', 'hello', ui, 1)[0]!.tone).toBe('sub');
  });
  test('the finish card bar is 141 then 245 for done and failed alike', () => {
    for (const failed of [false, true]) {
      const bar = (fade: number): string => colorsOf(notificationTree('ghost-explorer', 'explorer', 'finished · 0:10', failed, ui, false, { cols: 110, fade }))[0]!;
      expect(bar(0)).toBe(PURPLE);
      expect(bar(1)).toBe(GREY);
    }
  });
});

describe('item 5: no channel slug and no `last by sender` block (critique 31: `#lc-pbftklj5@master`)', () => {
  test('a run channel, with or without its branch, reads `this run`', () => {
    expect(channelLabel('lc-pbftklj5@master')).toBe('this run');
    expect(channelLabel('lc-pbftklj5')).toBe('this run');
    expect(channelLabel('release')).toBe('#release');
  });
  test('the channel tab carries no slug and no last-by-sender block', () => {
    for (const s of [snap('lc-pbftklj5@master'), snap('lc-pbftklj5')]) {
      const t = render('channel', 65, 45, s).join('\n');
      expect(t).not.toMatch(/lc-pbftklj5|@master/);
      expect(t).not.toMatch(/last by sender/);
      expect(t).toMatch(/\d+ posts/);
    }
  });
});

describe('item 6: the route tab lists the plan with a meter (critique 31: a bare count)', () => {
  const rows = body('route', 66, 45);
  test('a `plan` head carries the whole-plan `▰▱` meter', () => {
    const head = rows.find((l) => /^\s*plan\b/.test(l))!;
    expect(head).toBeDefined();
    expect(head).toMatch(/[▰]+[▱]*/);
    expect(head).toMatch(/3 ?\/ ?5|3 of 5/);
  });
  test('one row per item with its state glyph and its agent', () => {
    for (const [label, owner] of [['T1 read alpha.py', 'alpha-explorer'], ['T2 read ghost.py', 'ghost-explorer'], ['T3 read beta.py', 'beta-explorer']] as const) {
      const l = rows.filter((x) => x.includes(label));
      expect(l).toHaveLength(1);
      expect(l[0]).toMatch(/[●■◐○◇]/);
      expect(l[0]).toContain(owner.slice(0, 5));
    }
    for (const label of ['T4 combine the reports', 'T5 write the final summary']) expect(rows.filter((x) => x.includes(label))).toHaveLength(1);
    expect(rows.find((x) => x.includes('T2 read ghost.py'))).toMatch(/■/);
  });
});

describe('item 7: the team tab draws a 12-cell sparkline per agent, aligned (critique 31: ragged, short sparklines)', () => {
  const rows = body('team', 65, 45);
  const SPARK = /[▁▂▃▅▇█]{12}/;
  test('every agent row carries exactly 12 spark cells in the same column', () => {
    const agentRows = rows.filter((l) => /-explorer/.test(l) && SPARK.test(l));
    expect(agentRows.length).toBeGreaterThanOrEqual(3);
    const cols = agentRows.map((l) => l.search(SPARK));
    expect(new Set(cols).size).toBe(1);
    for (const l of agentRows) expect(/[▁▂▃▅▇█]+/.exec(l.slice(l.search(SPARK)))![0]).toHaveLength(12);
  });
  test('a failed agent and a short run still draw all 12 cells (floor `▁`)', () => {
    const ghost = rows.find((l) => /ghost-explorer/.test(l))!;
    expect(ghost).toMatch(SPARK);
  });
});

describe('item 8: the divider is 236 in every state (critique 31: it shifted to a lighter grey)', () => {
  const states: Array<[string, Run | null]> = [['working', { kind: 'working', secs: 5, startMs: NOW - 5000 }], ['idle', { kind: 'idle' }], ['done', { kind: 'done', secs: 30 }], ['blocked', { kind: 'blocked', secs: 30 }], ['none', null]];
  test('every rule the panel draws is #303030 in truecolor', () => {
    for (const [, run] of states) for (const v of ['route', 'team', 'board'] as const) {
      const colors = ruleColors(tree(v, 65, 45, snap(), run), []);
      expect(colors.length).toBeGreaterThan(0);
      expect(new Set(colors)).toEqual(new Set(['#303030']));
    }
  });
  test('and index 236 in a 256-colour terminal', () => {
    const look: Ui = { theme: 'mocha', ascii: false, color: '256' };
    for (const [, run] of states) {
      const colors = ruleColors(tree('route', 65, 45, snap(), run, look), []);
      expect(colors.length).toBeGreaterThan(0);
      expect(new Set(colors).size).toBe(1);
    }
  });
});

describe('item 9: the board axis ticks are evenly spaced (critique 31: gaps of 6, 7 and 5 cells)', () => {
  const agents = [
    { name: 'alpha-explorer', state: 'done' as const, secs: 11, startMs: 0, endMs: 11_000, calls: [1_000, 3_000, 7_000, 10_000] },
    { name: 'beta-explorer', state: 'done' as const, secs: 7, startMs: 13_000, endMs: 20_000, calls: [14_000, 18_000] },
  ];
  test('the gaps between the `┬` marks are equal at every width', () => {
    for (const cols of [43, 50, 59, 65, 66, 72, 80, 97]) {
      const lines = boardTimeline(agents, { cols, ui }).map((l) => l.runs.map((x) => x.t).join(''));
      const axis = lines.find((l) => /┬/.test(l))!;
      const at = [...axis].flatMap((c, i) => (c === '┬' ? [i] : []));
      expect(at.length).toBeGreaterThanOrEqual(2);
      const gaps = at.slice(1).map((v, i) => v - at[i]!);
      expect(new Set(gaps).size).toBe(1);
    }
  });
});
