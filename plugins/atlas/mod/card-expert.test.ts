// Slice S4 of the mods expert-grade spec: the HEALTH card is a flat full-width ribbon with the pulse block, every gate is one `● name n/m`, team is its own item, and a run's duration prints once.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import type { AtlasSnapshot, SquadAgent } from './contract';
import { bandTree, type BandHandlers, type BandModel } from './band';
import { busySnap, NOW } from './live_fixture';
import { uiFromEnv, type Run } from './atlas-ui';
import { healthCardRows } from './hud-surface';
import { healthRows, type Health } from './idle-health';
import { bodyLines, lineText } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { textWidth } from './theme';
import { gateLine, gatesTotal } from './vocab';
import { forgetPlaced, noteRunFinal, placeFinished, placedTree } from './transcript/placed';
import type { Pulse } from './pulse';

const ui = { ...uiFromEnv({}), color: 'truecolor' as const };
const text = (row: Run[]): string => row.map((x) => x.t).join('');
const rowsText = (rows: Run[][]): string[] => rows.map(text);

const check = (id: string, over: Record<string, unknown> = {}) => ({ id, ok: true, title: id, lines: 3, pass: 3, ...over });
const HOOKS = { total: 6, byLabel: [{ label: 'tool.call', n: 3 }, { label: 'session.start', n: 3 }], recent: [{ label: 'tool.call Bash', ageSecs: 12 }], lastEventSecs: 12 };
const health = (over: Partial<Health> = {}): Health => ({
  gates: { total: 4, green: 4, checks: [check('completion', { lines: 1, pass: 1, note: 'Last Stop allowed' }), check('tripwire', { lines: 2, pass: 2, note: 'Team mode: off' }), check('routing', { lines: 8, pass: 8 }), check('header', { lines: 0, pass: 0 })] },
  ctxPct: 6, tokens: 64_000, window: 1_000_000, upSecs: 9, branch: 'master', version: '17.24.0', hooks: HOOKS, ...over,
});
const IDLE: Pulse = { events: Array(20).fill(0), ctx: [], runs: [] };
const BUSY: Pulse = { events: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 4, 2, 1], ctx: [{ tokens: 20_000, pct: 2, at: 1 }, { tokens: 41_000, pct: 4, at: 2 }, { tokens: 64_000, pct: 6, at: 3 }], runs: [{ secs: 41, ok: true, at: 1 }, { secs: 5, ok: false, at: 2 }], window: 1_000_000, cost: { usd: 0.04 } };
const card = (h: Health, cols: number, pulse?: Pulse): Run[][] => healthCardRows({ ...h, ...(pulse ? { pulse } : {}) }, { cols, ui });

describe('card: a flat ribbon, every row exactly cols wide', () => {
  for (const cols of [88, 93, 110, 146]) {
    test(`at ${cols}: every row is ${cols} cells, no rounded corners, the ribbon is flat`, () => {
      const rows = rowsText(card(health(), cols, BUSY));
      for (const r of rows) expect(textWidth(r), r).toBe(cols);
      expect(rows.join('\n')).not.toMatch(/[╭╮╰╯]/);
      expect(rows[0]).toMatch(/^── /);
      expect(rows[0]).toContain('▾ HEALTH');
      expect(rows[0]).toContain('▾ hide');
    });
  }
  test('the hide chip is a Button target that closes the card (the band\'s own key)', () => {
    const chip = card(health(), 100, BUSY)[0]!.find((x) => x.t.includes('▾ hide'));
    expect(chip).toMatchObject({ press: 'band:health', tone: 'accent', bold: true });
  });
});

describe('card: a superset of the panel health rows', () => {
  test('every health row the panel shows is a labelled row of the card', () => {
    const h = { ...health(), pulse: BUSY };
    const ids = healthRows(h, ui, { recent: true }).map((r) => r.label);
    const t = rowsText(card(health(), 100, BUSY)).join('\n');
    for (const id of ['gates', 'events', 'context', 'runs', 'session']) expect(ids).toContain(id);
    for (const label of ids) expect(t, label).toMatch(new RegExp(`^ {2}${label} `, 'm'));
  });
});

describe('card: team is its own item, never a note or a suffix', () => {
  test('`Team mode: off` is nowhere; `team off` is a field of the session row', () => {
    const rows = rowsText(card(health(), 110, BUSY));
    expect(rows.join('\n')).not.toContain('Team mode');
    const session = rows.find((r) => /^ {2}session /.test(r))!;
    expect(session).toContain('team off');
    expect(session).toMatch(/up 0:09 · master · team off · atlas 17\.24\.0 · cost \$0\.04/);
    const panel = healthRows({ ...health(), pulse: BUSY }, ui, { recent: true });
    expect(JSON.stringify(panel)).not.toContain('Team mode');
  });
  test('a Health with its own team field says it', () => {
    const rows = rowsText(card(health({ team: 'on' }), 110, BUSY));
    expect(rows.find((r) => /^ {2}session /.test(r))).toContain('team on');
  });
});

describe('gates: one vocabulary', () => {
  test('every gate line in the card and in the health rows reads `● name n/m`; a gate with no checks is 0/0 in the neutral tone', () => {
    const rows = card(health(), 110, BUSY);
    const lines = rowsText(rows).join('\n').match(/● \w+ +\d+\/\d+/g) ?? [];
    expect(lines.map((l) => l.replace(/ +/g, ' '))).toEqual(['● completion 1/1', '● tripwire 2/2', '● routing 8/8', '● header 0/0']);
    const mark = rows.flat().filter((x) => x.t === '●');
    expect(mark.map((x) => x.tone)).toEqual(['ok', 'ok', 'ok', 'sub']);
    const g = healthRows({ ...health(), pulse: BUSY }, ui, { recent: true }).find((r) => r.id === 'gates')!;
    for (const d of g.detail.filter((x) => !x.startsWith(' '))) expect(d).toMatch(/● \w+ +\d+\/\d+/);
    expect(gateLine('header', 0, 0).tone).toBe('sub');
  });
  test('the sum of the shown n/m is the one total (vocab.gatesTotal), nowhere a second count', () => {
    const t = rowsText(card(health(), 110, BUSY)).join('\n');
    const nm = [...t.matchAll(/● \w+ +(\d+)\/(\d+)/g)].map((m) => ({ pass: Number(m[1]), total: Number(m[2]) }));
    expect(gatesTotal(nm).text).toBe('11/11');
    expect(t).not.toMatch(/\d+\/\d+ green|checks? pass/);
  });
  test('a failed gate keeps its red mark and its count', () => {
    const h = health({ gates: { total: 2, green: 1, checks: [check('completion'), check('routing', { ok: false, lines: 8, pass: 6 })] } });
    const rows = card(h, 110, BUSY);
    expect(rowsText(rows).join('\n')).toMatch(/● routing +6\/8/);
    expect(rows.flat().filter((x) => x.t === '●').map((x) => x.tone)).toEqual(['ok', 'bad']);
  });
});

describe('pulse rows', () => {
  test('events: a 28-cell spark of pulse.events and `N in 5m`; context: framed gauge, `64k of 1M`, a short spark; cost only when the pulse has it', () => {
    const rows = rowsText(card(health(), 110, BUSY));
    const ev = rows.find((r) => /^ {2}events /.test(r))!;
    expect(ev).toMatch(/[⣀-⣿]{28}/);
    expect(ev).not.toMatch(/[⣀-⣿]{29}/);
    expect(ev).toContain('8 in 5m');
    const cx = rows.find((r) => /^ {2}context /.test(r))!;
    expect(cx).toMatch(/▕[█▏▎▍▌▋▊▉░]{20}▏ 64k of 1M · [⣀-⣿]{3}/);
    expect(rows.join('\n')).toContain('cost $0.04');
    const noCost = rowsText(card(health(), 110, { ...BUSY, cost: undefined } as Pulse)).join('\n');
    expect(noCost).not.toMatch(/cost|\$/);
  });
  test('an empty pulse is a flat baseline and `none yet`, never an invented number', () => {
    const rows = rowsText(card(health({ ctxPct: undefined, tokens: undefined, window: undefined }), 110, IDLE));
    const ev = rows.find((r) => /^ {2}events /.test(r))!;
    expect(ev).toMatch(/⣀{28}/);
    expect(ev).toContain('none yet');
    expect(ev).not.toMatch(/\d+ in 5m/);
    expect(rows.find((r) => /^ {2}runs /.test(r))).toContain('none yet');
    expect(rows.find((r) => /^ {2}context /.test(r))).toContain('none yet');
    expect(rows.join('\n')).not.toMatch(/cost|\$/);
    const none = rowsText(card(health({ hooks: undefined }), 110)); // no pulse at all and no hook seen (a card built before the pulse is wired)
    expect(none.find((r) => /^ {2}events /.test(r))).toContain('none yet');
    const seen = rowsText(card(health(), 110)).find((r) => /^ {2}events /.test(r))!; // no pulse yet but the hooks did fire: their own count, on a flat baseline
    expect(seen).toMatch(/⣀{28}\s+6 events/);
  });
  test('runs: one bar per run (shapes, no seconds), the count and the failures', () => {
    const r = rowsText(card(health(), 110, BUSY)).find((x) => /^ {2}runs /.test(x))!;
    expect(r).toMatch(/runs +[⣀-⣿]{2} +2 runs · 1 failed/);
    expect(r).not.toMatch(/\d+:\d\d/);
  });
});

describe('the run duration prints once across band, panel and transcript card', () => {
  const els = ((): ClientElements => { const mk = (kind: string) => (props: Record<string, any>) => ({ kind, props }); return { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements; })();
  type N = { kind: string; props: Record<string, any> };
  const kids = (n: N): N[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is N => typeof x === 'object' && x !== null); };
  const textOf = (n: N): string => (n.kind === 'Text' || typeof n.props.children === 'string' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
  const handlers: BandHandlers = { openView() {}, toggleTodos() {}, toggleHealth() {} };
  const doneSnap = (now: number): AtlasSnapshot => {
    const squad = [{ name: 'alpha-explorer', persona: 'explorer', state: 'finished', source: 'task' }] as SquadAgent[];
    const todos = [{ id: 't1', content: 'T1 read alpha.py', status: 'completed', owner: 'alpha-explorer' }];
    return { root: null, sessionId: 's1', channel: 'c', todos, notes: [], members: [], squad, contextPct: 0, now, contract: { phases: [], todoPhases: [], headerFirstLinePattern: '^ATLAS', itemPhasePrefix: '' }, personas: [], counts: { done: 1, total: 1, byPhase: {} }, phase: 'done', phaseSource: 'default', activity: { 'alpha-explorer': { tool: null, since: now - 2000, startedAt: now - 5000, toolCount: 3, tokens: null, mood: 'done', lastLine: '', calls: [1, 2, 3] } }, comms: [], todoGroups: [] } as unknown as AtlasSnapshot;
  };
  const flat = (tree: unknown): string => { const out: string[] = []; const walk = (n: unknown): void => { if (typeof n === 'string') out.push(n); else if (n && typeof n === 'object') for (const k of (n as { children?: unknown[] }).children ?? []) walk(k); }; walk(tree); return out.join(''); };
  const engine = (placed: string[]) => ({ ui: { place: async ({ id }: { id: string }) => { placed.push(id); return { isPlaced: true, requestId: id }; }, invalidate: () => undefined } }) as never;

  test('one finished run of 0:05: the band says it, the panel says a `runs` row, the transcript card says its other facts', async () => {
    forgetPlaced();
    try {
      const green = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as any;
      const band: BandModel = { snapshot: doneSnap(NOW), live: [], gates: ['completion', 'tripwire', 'routing', 'header'].map(green), columns: 150, tick: 0, maxRows: 12, ui, ranSecs: 5, restSecs: 1, health: { upSecs: 30, version: '17.24.0', branch: 'master', panel: true, open: false } } as never;
      const bandText = kids(bandTree(els, band, handlers) as unknown as N).map(textOf).join('\n');
      expect(bandText).toContain('done 0:05');
      const h = health({ panel: true, last: { secs: 5, done: 1, total: 1, agents: 1, failed: 0, endedAgo: 4, workers: [{ name: 'alpha-explorer', state: 'done', secs: 5 }] } });
      const world = panelWorld('route', 150, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], run: { kind: 'done', secs: 5, startMs: NOW }, health: { ...h, pulse: BUSY } } as never);
      const panelText = bodyLines(world).map(lineText).join('\n');
      expect(panelText).toMatch(/\bruns\b/);
      expect(panelText).not.toContain('last run');
      const ids: string[] = [];
      noteRunFinal(5);
      await placeFinished(engine(ids), { ...doneSnap(NOW - 6000), squad: [{ name: 'alpha-explorer', persona: 'explorer', state: 'running', source: 'task' }] } as unknown as AtlasSnapshot, doneSnap(NOW));
      const runId = ids.find((i) => i.startsWith('done-run'))!;
      const cardText = flat(placedTree(runId, ui));
      expect(cardText).toMatch(/● done\s+1\/1 · 1 worker/);
      const joined = [bandText, panelText, cardText].join('\n');
      expect(joined.match(/0:05/g)).toHaveLength(1);
    } finally { forgetPlaced(); }
  });
  test('a run card with no facts is not placed (never an empty card)', async () => {
    forgetPlaced();
    try {
      const ids: string[] = [];
      noteRunFinal(5);
      const bare = { ...doneSnap(NOW), counts: { done: 0, total: 0, byPhase: {} } } as unknown as AtlasSnapshot;
      await placeFinished(engine(ids), bare, bare);
      expect(ids.filter((i) => i.startsWith('done-run'))).toEqual([]);
    } finally { forgetPlaced(); }
  });
});
