// Round W2 (items F-N of critics/spec-w.md): one chip idiom, honest gate wording, pill caps on the band fill, gates rows cut at the end with a fixed verdict column and `×N` merging,
// empty tabs with a skeleton and last-run figures, 110 parity, the slow pill breathe, and a real per-gate `last` age.
import { describe, expect, test } from 'claude-code/testing';
import { bandRuns, type BandModel } from '../band/band';
import { hostEnv, uiFromEnv, xtermHex, type Run, type Ui } from '../../design/atlas-ui';
import { busySnap } from '../../live_fixture';
import { bodyLines, lineText, panelLines, type PanelModel } from './panel-layout';
import { panelWorld } from '../../../contracts/panel-world';
import { gateLastSecs } from '../hud/status-frame';
import { textWidth } from '../../design/theme';
import { NOW } from '../../live_fixture';
import type { Health } from '../../data/idle-health';
import type { Pulse } from '../../data/pulse';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const text = (rs: Run[]): string => rs.map((x) => x.t).join('');
const green = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as never;
const GATES = ['completion', 'tripwire', 'routing', 'header'].map(green);
const pulse = (events: number[]): Pulse => ({ events: [...new Array<number>(28 - events.length).fill(0), ...events], ctx: [], runs: [] });
type Kind = 'idle' | 'working' | 'done';
function model(kind: Kind, cols: number, panel: boolean, over: Partial<BandModel> = {}, health: object = {}, ui2: Ui = ui): BandModel {
  const snap = busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 6, phase: 'test' as never, now: NOW });
  return {
    snapshot: kind === 'done' ? { ...snap, phase: 'done' as never } : snap, live: [], gates: GATES, columns: cols, tick: 0, maxRows: 12, ui: ui2,
    health: { upSecs: 41, hooks: { total: 3, byLabel: [{ label: 'prompt.submit', n: 1 }], recent: [], lastEventSecs: 4, runTools: 0 }, pulse: pulse([0, 0, 1, 3, 0, 2, 5, 1]), button: true, ...(panel ? { panel: true } : {}), ...health },
    ...(kind === 'working' ? { working: true, workSecs: 3 } : {}),
    ...(kind === 'done' ? { ranSecs: 5, restSecs: 12 } : {}),
    ...over,
  } as BandModel;
}
const row = (kind: Kind, cols: number, panel: boolean, over: Partial<BandModel> = {}, health: object = {}): string => text(bandRuns(model(kind, cols, panel, over, health), true));

describe('F/G: one chip idiom and honest gate wording', () => {
  test('status text is not a chip: the spark, ctx and last runs carry no press', () => {
    const rs = bandRuns(model('idle', 150, false), true);
    for (const x of rs) if (x.press) expect(x.press).toMatch(/^band:(gates|health)/);
    expect(rs.find((x) => /ctx/.test(x.t))!.press).toBeUndefined();
  });
  test('ASCII: the chip reads `> ` and the dot `*`', () => {
    const a = { ...ui, ascii: true } as Ui;
    expect(text(bandRuns(model('idle', 150, false, {}, {}, a), true))).toMatch(/\* gates ok >/);
  });
});

describe('H: the pill caps sit on the band fill, no notch', () => {
});

describe('I: gates rows', () => {
  const lines = [
    ...Array.from({ length: 4 }, () => ({ id: 'rd', label: 'Native Read calls', ok: true })),
    { id: 'long', label: 'A very long gate label that cannot fit the pane width', ok: true },
    { id: 'gr', label: 'Native Grep calls', ok: false, detail: '2 calls denied', fix: 'use ctx_search' },
  ];
  const world = (cols: number): string[] => {
    const h: Health = { gates: { total: 1, green: 0, checks: [{ id: 'routing', ok: false, lines: 6, pass: 5 }], denied: 2 }, upSecs: 9, version: '1', branch: 'm', hooks: { total: 3, byLabel: [{ label: 'tool.call', n: 3 }], recent: [{ label: 'tool.call Bash', ageSecs: 7, ms: 2 }] } } as never;
    const m = panelWorld('core', cols, ui, { rows: 40, todos: [], workers: [], notes: [], gates: [{ id: 'routing', title: 'routing', lines }], run: { kind: 'working', secs: 5, startMs: NOW, frame: 0 }, health: h } as never);
    return panelLines(m).map((l) => lineText(l).trimEnd());
  };
  for (const cols of [48, 41]) test(`at ${cols}: identical rows merge as ×N, labels cut at the end with …, the verdict is a right column`, () => {
    const t = world(cols);
    expect(t.filter((l) => /Native Read/.test(l))).toHaveLength(1);
    expect(t.find((l) => /Native Read/.test(l))).toMatch(/×4/);
    const long = t.find((l) => /A very long/.test(l))!;
  });
});

describe('J: empty tabs own their body', () => {
  const EMPTY = { workers: [], notes: [], gates: [], todos: [], core: null } as Partial<PanelModel>;
  const h = (last?: object): Health => ({ gates: { total: 4, green: 4, checks: [] }, upSecs: 36, version: '1', branch: 'm', team: 'off', hooks: { total: 3, byLabel: [{ label: 'tool.call', n: 3 }, { label: 'session.start', n: 1 }], recent: [] }, ...(last ? { last } : {}) }) as never;
  const body = (tab: string, last?: object, cols = 54): string[] => {
    const m = panelWorld(tab as never, cols, ui, { rows: 40, ...EMPTY, run: { kind: 'idle', secs: 0, startMs: NOW, frame: 0 }, health: h(last), ...(tab === 'route' ? { board: true } : {}) } as never);
    return panelLines(m).map((l) => lineText(l).trimEnd());
  };
  for (const [tab, fact] of [['team', 'no workers yet'], ['channel', 'no notes yet'], ['core', 'no verdicts yet'], ['route', 'no items yet']] as const) {
  }
});

describe('K: 110 parity', () => {
  test('the pane open at 110 is the closed row without the health chip: width independent', () => {
    for (const cols of [150, 110, 100]) for (const kind of ['idle', 'working', 'done'] as Kind[]) {
      expect(row(kind, cols, true)).not.toContain('health');
      if (cols < 121) expect(row(kind, cols, true).slice(0, 62)).toBe(row(kind, cols, false).slice(0, 62)); // AA2: the same slots at the same columns, with the chip after them
    }
  });
});

describe('L: the pill breathes slowly', () => {
  const env = hostEnv() as Record<string, string | undefined>;
  const withMotion = <T,>(f: () => T): T => {
    const saved = ['TERM', 'NO_COLOR', 'ATLAS_REDUCED_MOTION', 'REDUCE_MOTION'].map((k) => [k, env[k]] as const);
    env.TERM = 'xterm-256color';
    for (const k of ['NO_COLOR', 'ATLAS_REDUCED_MOTION', 'REDUCE_MOTION']) delete env[k];
    try { return f(); } finally { for (const [k, v] of saved) { if (v === undefined) delete env[k]; else env[k] = v; } }
  };
  const fills = (u: Ui, n = 24): Set<string | undefined> => new Set(Array.from({ length: n }, (_, tick) => bandRuns(model('idle', 150, false, { tick }, {}, u), true).find((x) => x.t === ' ◆ ')!.bgHex));
});

describe('N: the GATES last column is a real per-gate age', () => {
  const h: Health = { gates: { total: 4, green: 4, checks: [] }, upSecs: 9, hooks: { total: 9, byLabel: [], recent: [{ label: 'tool.call Bash', ageSecs: 6, ms: 2 }, { label: 'turn.complete', ageSecs: 41, ms: 3 }, { label: 'classic.Stop', ageSecs: 125, ms: 4 }] } } as never;
  test('each gate reads its own hook\'s newest event, or nothing (shown as —)', () => {
    expect(gateLastSecs(h, { id: 'tripwire' })).toBe(6);
    expect(gateLastSecs(h, { id: 'header' })).toBe(41);
    expect(gateLastSecs(h, { id: 'completion' })).toBe(125);
    expect(gateLastSecs({ ...h, hooks: { ...h.hooks!, recent: [] } }, { id: 'routing' })).toBeUndefined();
  });
  test('a check\'s own lastSecs wins over the hook\'s', () => {
    expect(gateLastSecs(h, { id: 'tripwire', lastSecs: 2 })).toBe(2);
  });
});

describe('the band gates chip and its pill, in the redesigned band', () => {
  const chip = (rs: Run[]): Run[] => rs.filter((x) => x.press?.startsWith('band:gates'));
  const deny = [{ id: 'routing', title: 'routing', lines: [{ id: 'g', label: 'Native Grep calls', ok: false, detail: '2 calls denied' }] }] as never[];
  test('before any prompt the chip is a grey `○ gates armed ›`, pressable with a hover', () => {
    const rs = chip(bandRuns(model('idle', 150, false, {}, { hooks: { total: 0, byLabel: [], recent: [] } }), true));
    expect(text(rs)).toBe('○ gates armed ›');
    expect(rs.every((x) => x.hover === true && x.fg === rs[0]!.fg)).toBe(true);
  });
  test('after a prompt with no denial it is `✓ gates ok ›` with the dot in green and the chip on one fill', () => {
    const rs = chip(bandRuns(model('idle', 150, false), true));
    expect(text(rs).trim()).toBe('✓ gates ok ›');
    expect(rs[0]!.fg).not.toBe(rs[2]!.fg); // the green mark and word, the grey arrow
    expect(new Set(rs.map((x) => x.bgHex)).size).toBe(1);
  });
  test('a denial is `■ N denied ›` in red while fresh (also while working), amber after 5 minutes', () => {
    const at = (kind: Kind, age: number) => chip(bandRuns(model(kind, 150, false, { gates: deny }, { denyAgeSecs: age }), true));
    const reds = [['done', 10], ['done', 299], ['working', 4000]] as const;
    for (const [kind, age] of reds) expect(text(at(kind, age))).toContain('■ 2 denied ›');
    const fresh = at('done', 10)[0]!.fg;
    for (const [kind, age] of reds.slice(1)) expect(at(kind, age)[0]!.fg).toBe(fresh);
    const old = at('done', 301);
    expect(text(old)).toContain('■ 2 denied ›');
    expect(old[0]!.fg).not.toBe(fresh);
  });
  test('with the pane open at 110 (band 89) the band keeps the tool spark with its unit', () => {
    for (const kind of ['idle', 'working', 'done'] as Kind[]) expect(row(kind, 89, true)).toMatch(/tools [▁-█]{8} +[\d—]+\/m/);
  });
  test('the idle head is the same at 110 and 150', () => {
    for (const cols of [150, 110, 100, 89]) expect(row('idle', cols, false)).toMatch(/^ ◆ ATLAS  ◌ idle up 0:41/);
  });
});

describe('the pill breathes slowly (only idle, only in colour)', () => {
  const env = hostEnv() as Record<string, string | undefined>;
  const withMotion = <T,>(f: () => T): T => {
    const saved = ['TERM', 'NO_COLOR', 'ATLAS_REDUCED_MOTION', 'REDUCE_MOTION'].map((k) => [k, env[k]] as const);
    env.TERM = 'xterm-256color';
    for (const k of ['NO_COLOR', 'ATLAS_REDUCED_MOTION', 'REDUCE_MOTION']) delete env[k];
    try { return f(); } finally { for (const [k, v] of saved) { if (v === undefined) delete env[k]; else env[k] = v; } }
  };
  const fills = (u: Ui, kind: Kind = 'idle', n = 24): Set<string | undefined> => new Set(Array.from({ length: n }, (_, tick) => bandRuns(model(kind, 150, false, { tick }, {}, u), true).find((x) => x.t === ' ◆ ATLAS ')!.bgHex));
  test('truecolor: 13 tones, one 2.4 s breath (24 beats of 100 ms)', () => withMotion(() => { expect(fills(ui).size).toBe(13); }));
  test('256 colours: eight violets in one breath (at least six distinct)', () => withMotion(() => { const n = fills({ ...ui, color: '256' }).size; expect(n).toBe(8); expect(n).toBeGreaterThanOrEqual(6); }));
  test('no colour: the pill does not move', () => withMotion(() => { expect(fills({ ...ui, color: 'none' }).size).toBe(1); }));
  test('only idle breathes: working and done hold one pill fill', () => withMotion(() => {
    for (const kind of ['working', 'done'] as Kind[]) expect(fills(ui, kind).size).toBe(1);
  }));
});
