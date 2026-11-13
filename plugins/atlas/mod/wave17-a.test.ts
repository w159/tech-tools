// Wave 17 slice A (critique 16): one count and one blocked state across the band, the route, the gates and the board.
// Shapes: stoprun-150-e4a8186a-1 f0090 (band vs TODO header vs route), live-150-e4a8186a-1 gate flicker, live-110-e4a8186a-1 band words.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { panelWorld } from '../contracts/panel-world';
import { bandTree } from './band';
import { STATE_GLYPHS, STATE_TOKEN, warnMark, type Ui } from './atlas-ui';
import { blockReasons, gateTally, withCoreTally } from './data/runstate';
import { busySnap, NOW } from './live_fixture';
import { bodyLines, lineText } from './panel-layout';
import { bandLines, runsText, type MissionModel } from './mission-layout';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => t.props.children).join('');
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const SESSION = 'd87fbe79';
const lead = (tool: string | null, mood: string) => ({ lead: { tool, since: NOW, toolCount: 1, tokens: null, mood, lastLine: '' } });
const idle = (over: Record<string, unknown> = {}) => busySnap({ squad: [], comms: [], sessionId: SESSION, activity: lead(null, 'done'), ...over } as never);
const rows = (snapshot: ReturnType<typeof busySnap>, gates: unknown[], columns = 150, maxRows = 12): string[] =>
  ((bandTree(els, { snapshot, live: [], gates, columns, tick: 0, maxRows, ui, core: null } as never) as unknown as Node).props.children as Node[]).map(text);
const row = (id: string, status: string, origin: string, session_id: string, content: string, owner?: string) => ({ id, content, status, origin, session_id, ...(owner ? { owner } : {}) });
const stopGroup = (detail: string) => ({ id: 'completion', title: 'C', lines: [{ id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail }] });
// stoprun-150-e4a8186a-1 f0090: five plan rows closed, the ghost dispatch row still open, Stop refused on `1 todo open`.
const stopStore = [
  ...['T1 read alpha.py', 'T2 read ghost.py', 'T3 read beta.py', 'T4 combine the reports', 'T5 write the final summary'].map((c, i) => row(`t${i}`, 'completed', 'session', '', c)),
  row('da', 'completed', 'dispatch', SESSION, 'read alpha.py', 'alpha-explorer'),
  row('dg', 'pending', 'dispatch', SESSION, 'read ghost.py', 'ghost-explorer'),
];
const mission = (over: Partial<MissionModel> = {}): MissionModel => ({ cols: 150, maxRows: 12, tick: 0, project: 'p', phases: ['plan', 'build', 'verify'], phase: 'verify', done: 5, total: 5, workers: [], checks: null, ui, ...over });
const band = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs);

describe('A1: the band counts the plan rows the TODO header counts, and names the open dispatch row', () => {
  test('f0090 from the store: band reads todo 5/5 and `blocked · stop refused` (state 38), never 5/6', () => {
    const out = rows(idle({ todos: stopStore }), [stopGroup('1 todo open')]).join('\n');
    expect(out).toMatch(/todo [^0-9]*5\/5/);
    expect(out).toContain('blocked · stop refused');
    expect(out).not.toContain('5/6');
  });
  // Critique 17 A4 (stoprun-150-a4fad2f9-2 f0088: `dispatch Attempt to read gho... open`): the band names the open row by its plan row's title, never by the dispatch prompt.
  test('a plan row that names its worker never leaks the dispatch prompt into the reason: `stop refused` (state 38)', () => {
    const named = [
      ...['T1 read alpha.py (alpha-explorer)', 'T2 read ghost.py (ghost-explorer)', 'T3 read beta.py', 'T4 combine the reports', 'T5 write the final summary'].map((c, i) => row(`t${i}`, 'completed', 'session', '', c)),
      row('da', 'completed', 'dispatch', SESSION, 'List the function names defined in alpha.py.', 'alpha-explorer'),
      row('dg', 'pending', 'dispatch', SESSION, 'Read ghost.py first (it does not exist), then, one Read call at a time, README.md, util.py and only then report.', 'ghost-explorer'),
    ];
    const out = rows(idle({ todos: named }), [stopGroup('1 todo open')]).join('\n');
    expect(out).toContain('blocked · stop refused');
    expect(out).not.toMatch(/Read ghost|first|\.\.\./);
  });
  test('the reason holds while the lead declares the block: `stop refused` in both frames when Stop refused, never `needs you`', () => {
    expect(blockReasons(true, ['1 todo open'], 'T2 read ghost.py').long).toBe('stop refused');
    expect(blockReasons(false, ['1 todo open'], 'T2 read ghost.py').long).toBe('stop refused');
    expect(blockReasons(true, [], 'T2 read ghost.py').long).toBe('run blocked'); // a declared block with Stop not refusing and no failure has no reason of its own
    expect(blockReasons(true, ['team gate'], 'T2 read ghost.py').long).toBe('stop refused');
  });
  test('the figure is the plan\'s own at every width', () => {
    const m = mission({ openWork: 1, openDispatch: 1, openDispatchTitle: 'read ghost.py', stopGates: ['1 todo open'] });
    for (const cols of [150, 120, 110, 100, 80, 60]) {
      const t = band({ ...m, cols });
      expect(t).not.toContain('5/6');
      if (cols >= 80) expect(t).toContain('5/5');
    }
    expect(band({ ...m, cols: 150 })).toContain('blocked · stop refused');
  });
  test('an open dispatch row with nothing running blocks the band: `stop refused` beside the plan count', () => {
    expect(band(mission({ openWork: 1, openDispatch: 1, openDispatchTitle: 'read ghost.py' }))).toContain('blocked · stop refused');
  });
  test('blockReasons never names a row or a gate: the open-row gate reads `stop refused`', () => {
    expect(blockReasons(false, ['1 todo open'], 'read ghost.py').long).toBe('stop refused');
    expect(blockReasons(false, ['team gate', 'todos drained'], 'x').long).toBe('stop refused');
    expect(blockReasons(false, ['1 todo open']).long).toBe('stop refused');
    expect(blockReasons(false, ['1 todo open'], 'a very long dispatch goal that must be clipped').long.length).toBeLessThanOrEqual(40);
  });
});

describe('A2: blocked is one red square, warnings keep the amber triangle, counts are words', () => {
  test('tokens', () => {
    expect(STATE_GLYPHS.blocked).toBe('▲');
    expect(STATE_GLYPHS.failed).toBe('■');
    expect(STATE_TOKEN.blocked).toBe('block'); // critique 18 B3: blocked is orange, failed stays red
    expect(warnMark(ui).t).toBe('▲');
  });
  test('the band never prints a bare glyph-and-number count (`▲1 · ■2`) at any width', () => {
    const m = mission({ todoBlocked: 1, workers: [{ name: 'a', state: 'failed', secs: 1 }, { name: 'b', state: 'failed', secs: 1 }, { name: 'c', state: 'running', secs: 1 }] });
    for (const cols of [150, 110, 100, 90, 80, 73, 60]) expect(band({ ...m, cols })).not.toMatch(/[■▲▲◐◇◉]\d/);
    for (const cols of [50, 40]) expect(band({ ...m, cols })).not.toMatch(/[■▲▲]1/); // narrower than the word forms: the blocked count is dropped, never a bare glyph and number
    expect(band({ ...m, cols: 73 })).toContain('1 running');
    expect(band({ ...m, cols: 110 })).toContain('2 failed');
  });
});

describe('A3: never `done` while the band is blocked', () => {
  const blockedGates = [stopGroup('1 todo open')];
  test('f0090: the route phase row reads blocked, not `done 5/5`', () => {
    const phase = bodyLines(panelWorld('route', 80, ui, { phase: 'done', gates: blockedGates as never, workers: [], todos: [] })).map(lineText).find((l) => l.trimStart().startsWith('phase'))!;
    expect(phase).toContain('blocked');
    expect(phase).not.toMatch(/done|5\/5/);
  });
  test('Stop allowed keeps `done`', () => {
    const allowed = [{ id: 'completion', title: 'C', lines: [{ id: 'stop-verdict', label: 'Last Stop allowed', ok: true }] }];
    const phase = bodyLines(panelWorld('route', 80, ui, { phase: 'done', gates: allowed as never, workers: [], todos: [] })).map(lineText).find((l) => l.trimStart().startsWith('phase'))!;
    expect(phase).toContain('done');
  });
});

describe('A4: the gates figure never rises and falls in a clean run; a check Stop alone decides reads pending', () => {
  const line = (id: string, ok: boolean, extra: Record<string, unknown> = {}) => ({ id, label: id, ok, ...extra });
  const grp = (id: string, lines: ReturnType<typeof line>[]) => ({ id, title: id, lines });
  // live-150-e4a8186a-1: header and routing and tripwire start green; the 2nd in-process dispatch turns (s) red until its one advisory is used; the lead's own helper calls reach 4 of 4.
  const world = (o: { s?: boolean; i?: boolean; drift?: boolean; inline?: boolean }) => [
    grp('completion', [line('m', true), line('i', !o.i, { detail: o.i ? '5 open' : undefined }), line('s', !o.s)]),
    grp('tripwire', [line('inline', !o.inline)]),
    grp('routing', [line('lean', true)]),
    grp('header', [line('h', true)]),
  ];
  const core = (drift: boolean) => ({ contract: { header: { ok: 1, total: 1 } }, routes: drift ? [{ cls: 'audit', effort: 'low', seats: [], drift: ['explorer ran 2 > seat plans 1'] }] : [] });
  test('f0034 -> f0094: 4/4, 3/4, 3/4, 3/4, 2/4 (never 2/4 then 3/4); the (s) flip is pending, not red', () => {
    const frames = [world({}), world({}), world({ s: true }), world({}), world({ inline: true })];
    const drift = [false, true, true, true, true];
    const figs = frames.map((g, i) => { const t = gateTally(withCoreTally(g as never, core(drift[i]!) as never)); return t.green; });
    expect(figs).toEqual([4, 3, 2, 3, 2]); // critique 18 A2: the figure counts the green marks drawn, and a pending check (`◇`) is not a green mark
    const s = gateTally(withCoreTally(world({ s: true }) as never, core(true) as never));
    expect(s.checks.find((c) => c.id === 'completion')).toMatchObject({ ok: true, pending: true });
    expect(s.failing).toEqual(['routing']);
  });
  test('`Todos drained` with open rows is pending too while Stop has not decided', () => {
    const t = gateTally(withCoreTally(world({ i: true }) as never, null));
    expect(t.green).toBe(t.total - 1); // the pending group is drawn `◇`, not a green mark (critique 18 A2)
    expect(t.failing).toEqual([]);
    expect(t.checks.find((c) => c.id === 'completion')?.pending).toBe(true);
  });
  test('Stop refused: the same lines are failing, never pending', () => {
    const g = world({ s: true, i: true });
    (g[0] as { lines: unknown[] }).lines.push({ id: 'stop-verdict', label: 'Last Stop blocked', ok: true, detail: 'team gate' });
    const t = gateTally(withCoreTally(g as never, null));
    expect(t.failing).toContain('completion');
    expect(t.checks.find((c) => c.id === 'completion')?.pending).toBeUndefined();
  });
  test('a real failure (not (i) or (s)) is never pending', () => {
    const g = world({});
    (g[0] as { lines: ReturnType<typeof line>[] }).lines.push(line('a', false));
    expect(gateTally(withCoreTally(g as never, null)).failing).toEqual(['completion']);
  });
  test('the band checks row and the gates tab draw it as the queued mark with the word pending', () => {
    const snap = idle({ activity: lead(null, 'working') });
    const out = rows(snap, world({ s: true }) as never, 150).join('\n');
    expect(out).toContain('◇ completion');
    expect(out).toContain('3/4 green'); // three ● marks and the pending ◇
    const tab = bodyLines(panelWorld('gates', 100, ui, { gates: world({ s: true }) as never })).map(lineText).join('\n');
    expect(tab).toMatch(/◇ +completion +pending/);
    expect(tab).not.toMatch(/▲ +completion/);
  });
});

describe('A5: the docked 110-column band (73 cells) uses the words of the 150-column band', () => {
  // live-110-e4a8186a-1 f0035..f0067: `todo 0/5 · ◓1`, `◒2`; stoprun-110-e4a8186a-1 f0054..f0061: `· 2 dispatches open · ◑1 ■1`.
  const at = (cols: number, over: Partial<MissionModel>): string => band(mission({ cols, done: 0, total: 5, ...over }));
  const run = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `w${i}`, state: 'running' as const, secs: 3 }));
  test('running agents read `2 running`, never the bare glyph and number', () => {
    for (const cols of [73, 93, 150]) expect(at(cols, { workers: run(2) })).toMatch(/2 running/);
    expect(at(73, { workers: run(2) })).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]2/);
  });
  test('the stop-run shape keeps both counts in words; the open-dispatch note is the first segment to go at 73 cells (the state word, spinner and todo come first)', () => {
    const w = [...run(1), { name: 'g', state: 'failed' as const, secs: 3 }];
    const t = at(73, { openWork: 7, openDispatch: 2, workers: w });
    expect(t).toMatch(/working · todo 0\/5 · .* 1 running · .* 1 failed/);
    expect(t).not.toMatch(/[■◐◓◑◒]1\b/);
    expect(at(150, { openWork: 7, openDispatch: 2, workers: w })).toMatch(/todo .* 0\/5 +.* 1 running · ■ 1 failed/);
  });
});
