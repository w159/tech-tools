// Slice S4 of the mods expert-grade spec: the HEALTH card is a flat full-width ribbon with the pulse block, every gate is one `● name 8 pass · 0 deny`, team is its own item, and a run's duration prints once.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import type { AtlasSnapshot, SquadAgent } from '../../contract';
import { bandTree, type BandHandlers, type BandModel } from '../band/band';
import { busySnap, NOW } from '../../live_fixture';
import { uiFromEnv, type Run } from '../../atlas-ui';
import { healthCardRows } from './hud-surface';
import { gateOf, healthRows, type Health } from '../../data/idle-health';
import { bodyLines, lineText } from '../../panel-layout';
import { panelWorld } from '../../../contracts/panel-world';
import { textWidth } from '../../theme';
import { gateLine, gatesTotal } from '../../vocab';
import { forgetPlaced, noteRunFinal, placeFinished, placedTree } from '../transcript/placed';
import type { Pulse } from '../../data/pulse';

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
    test(`at ${cols}: every row is ${cols} cells, no rounded corners, the HEALTH ribbon is flat`, () => {
      const rows = rowsText(card(health(), cols, BUSY));
      for (const r of rows) expect(textWidth(r), r).toBe(cols);
      expect(rows.join('\n')).not.toMatch(/[╭╮╰╯]/);
      expect(rows[0]!.trimEnd()).toMatch(/^ +▾ HEALTH +─+$/); // X4: one `▾ HEALTH` chip and a rule; the pill is the band's, right under the card
      expect(rows[0]).not.toContain('hide');
    });
  }
  test('the card title is its own toggle (round W M): `▾ HEALTH` closes it, as does the band\'s `▾ health` chip; no other run is pressable', () => {
    const p = card(health(), 100, BUSY).flat().filter((x) => x.press !== undefined);
    expect(new Set(p.map((x) => x.press))).toEqual(new Set(['band:health']));
    expect(p.map((x) => x.t.trim())).toEqual(['▾ HEALTH']);
  });
});

describe('card: the pane\'s own sections', () => {
  test('ACTIVITY, CONTEXT, RUNS, GATES and HOOKS are each a ribbon of the card (the footer and the session figures stay on the pane)', () => {
    const t = rowsText(card(health(), 100, BUSY)).join('\n');
    for (const head of ['ACTIVITY', 'CONTEXT', 'RUNS', 'GATES', 'HOOKS']) expect(t, head).toMatch(new RegExp(`── ${head} `));
    expect(t).not.toMatch(/SESSION|\bsession +up /);
  });
});

describe('card: team is its own item, never a note or a suffix', () => {
  test('`Team mode: off` is nowhere on the card or in the health rows', () => {
    expect(rowsText(card(health(), 110, BUSY)).join('\n')).not.toContain('Team mode');
    expect(JSON.stringify(healthRows({ ...health(), pulse: BUSY }, ui, { recent: true }))).not.toContain('Team mode');
  });
});

describe('gates: one vocabulary', () => {
  test('a gate that fired is `● name  pass  deny` (columns under `ok fail`); a gate that never fired is a dim `○ name  0  0  —`', () => {
    const lines = rowsText(card(health(), 110, BUSY)).join('\n').match(/[●○] \w+ +\d+ +\d+ +(?:\d+[smh]|—)(?= |$)/gm) ?? [];
    expect(lines.map((l) => l.replace(/ +/g, ' ').split(' ').slice(0, 4).join(' '))).toEqual(['● completion 1 0', '● tripwire 2 0', '● routing 8 0', '○ header 0 0']);
    expect(health().gates.checks.map((c) => gateOf(c, ui).tone)).toEqual(['ok', 'ok', 'ok', 'sub']);
    const g = healthRows({ ...health(), pulse: BUSY }, ui, { recent: true }).find((r) => r.id === 'gates')!;
    for (const d of g.detail.filter((x) => !x.startsWith(' '))) expect(d).toMatch(/[●○] \w+ (?:\d+ pass · \d+ deny|not fired)/);
    expect(gateLine('header', 0, 0).tone).toBe('sub');
  });
  test('no gate ratio: the ribbon names the columns (`pass deny last`, the status tab columns)', () => {
    const t = rowsText(card(health(), 110, BUSY)).join('\n');
    expect(t).toContain('pass deny last');
    expect(t).not.toMatch(/\d+\/\d+ green|checks? pass|\d+\/\d+ gates/);
    expect(gatesTotal([{ pass: 11, total: 11 }, { pass: 0, total: 0 }])).toMatchObject({ text: 'ok', pass: 11, total: 11, fired: 1, notFired: 1 });
  });
  test('a denied gate keeps its red mark and its count', () => {
    const h = health({ gates: { total: 2, green: 1, checks: [check('completion'), check('routing', { ok: false, lines: 8, pass: 6 })] } });
    const rows = card(h, 110, BUSY);
    expect(rowsText(rows).join('\n')).toMatch(/■ routing +6 +2/);
    expect(rows.flat().find((x) => x.t === '■')).toMatchObject({ tone: 'bad' });
    expect(h.gates.checks.map((c) => gateOf(c, ui).tone)).toEqual(['ok', 'bad']);
  });
});

describe('pulse rows', () => {
  test('events: the chart, `N ev` and the peak; context: the gauge, `6%`, `64k of 1M`; the cost stays on the pane\'s footer', () => {
    const rows = rowsText(card(health(), 110, BUSY));
    expect(rows.find((r) => /^ +-\d+m .*-[\d.]+m .*now/.test(r))).toBeDefined(); // the chart's axis under the bars
    expect(rows.find((r) => r.includes('── ACTIVITY'))).toMatch(/\b8 ev · peak \d+ \/ [\d.]+s/);
    const cx = rows.join('\n');
    expect(cx).toMatch(/▰[▰▱]{11} 6%/);
    expect(cx).toContain('64k of 1M');
    expect(cx).not.toMatch(/cost|\$/);
  });
  test('an empty pulse is a flat baseline and `0 ev`, never `none yet` or an invented number', () => {
    const rows = rowsText(card(health({ ctxPct: undefined, tokens: undefined, window: undefined }), 110, IDLE));
    expect(rows.find((r) => /^ +-\d+m .*-[\d.]+m .*now/.test(r))).toBeDefined();
    expect(rows.join('\n')).toMatch(/\b0 ev\b/);
    expect(rows.join('\n')).not.toContain('none yet');
    expect(rows.join('\n')).not.toMatch(/cost|\$/);
    expect(rows.join('\n')).not.toContain('── CONTEXT'); // nothing measured: the section is absent
    const none = rowsText(card(health({ hooks: undefined }), 110)); // no pulse at all and no hook seen (a card built before the pulse is wired)
    expect(none.find((r) => r.includes('── ACTIVITY'))).toBeDefined();
  });
  test('runs: a bar per run (newest right), the count and the median; the p90 only from 5 runs (Z2)', () => {
    const t = rowsText(card(health(), 110, BUSY)).join('\n');
    expect(t).toMatch(/── RUNS /);
    expect(t).toMatch(/[▁-█] \d:\d\d (ok|failed) · [▁-█] \d:\d\d (ok|failed)/); // AA3: fewer than 3 runs is a one-line list, no chart
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

  test('one finished run of 0:05: the band says it, the panel says a `RUNS` section, the transcript card says its other facts', async () => {
    forgetPlaced();
    try {
      const green = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as any;
      const band: BandModel = { snapshot: doneSnap(NOW), live: [], gates: ['completion', 'tripwire', 'routing', 'header'].map(green), columns: 150, tick: 0, maxRows: 12, ui, ranSecs: 5, restSecs: 1, health: { upSecs: 30, version: '17.24.0', branch: 'master', panel: true, open: false } } as never;
      const bandText = kids(bandTree(els, band, handlers) as unknown as N).map(textOf).join('\n');
      expect(bandText).toContain('done'); expect(bandText).toMatch(/done 5\/5/); // AA2: the pane is open here, so the band has no `ended` detail
      const h = health({ panel: true, last: { secs: 5, done: 1, total: 1, agents: 1, failed: 0, endedAgo: 4, workers: [{ name: 'alpha-explorer', state: 'done', secs: 5 }] } });
      const world = panelWorld('route', 150, ui, { rows: 40, todos: [], workers: [], gates: [], notes: [], run: { kind: 'done', secs: 5, startMs: NOW }, health: { ...h, pulse: BUSY } } as never);
      const panelText = bodyLines(world).map(lineText).join('\n');
      expect(panelText).toMatch(/\bRUNS\b/);
      expect(panelText).not.toContain('last run');
      const ids: string[] = [];
      noteRunFinal(5);
      await placeFinished(engine(ids), { ...doneSnap(NOW - 6000), squad: [{ name: 'alpha-explorer', persona: 'explorer', state: 'running', source: 'task' }] } as unknown as AtlasSnapshot, doneSnap(NOW));
      const runId = ids.find((i) => i.startsWith('done-run'))!;
      const cardText = flat(placedTree(runId, ui));
      expect(cardText).toMatch(/● done\s+1\/1 · 1 worker/);
      expect(bandText).not.toContain('0:05'); // v1 frame spec: the band's head is `done n/n` and `ended Ns`, the run clock is the panel's
      expect(panelText.match(/0:05/g) ?? []).toHaveLength(1); // AA1: the RUNS list says the run's one m:ss text, once (the band has no run clock)
      expect(cardText).not.toContain('0:05'); // the transcript card says its other facts
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
