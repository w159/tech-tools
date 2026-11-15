// Round W2 (items F-N of critics/spec-w.md): one chip idiom, honest gate wording, pill caps on the band fill, gates rows cut at the end with a fixed verdict column and `×N` merging,
// empty tabs with a skeleton and last-run figures, 110 parity, the slow pill breathe, and a real per-gate `last` age.
import { describe, expect, test } from 'claude-code/testing';
import { bandRuns, type BandModel } from './band';
import { hostEnv, uiFromEnv, xtermHex, type Run, type Ui } from './atlas-ui';
import { busySnap } from './live_fixture';
import { bodyLines, lineText, panelLines, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { gateLastSecs } from './status-frame';
import { textWidth } from './theme';
import { NOW } from './live_fixture';
import type { Health } from './idle-health';
import type { Pulse } from './pulse';

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
  test('before any prompt the chip is a grey `○ gates armed ›`', () => {
    const rs = bandRuns(model('idle', 150, false, {}, { hooks: { total: 0, byLabel: [], recent: [] } }), true).filter((x) => x.press?.startsWith('band:gates'));
    expect(text(rs)).toBe(' ○ gates armed ›');
    expect(rs.every((x) => x.hover === true)).toBe(true);
  });
  test('after a prompt with no denial it is `● gates ok ›` with the panel\'s green dot on the raised chip fill', () => {
    const rs = bandRuns(model('idle', 150, false), true).filter((x) => x.press?.startsWith('band:gates'));
    expect(text(rs)).toBe(' ● gates ok ›   ');
    expect(rs[0]!.fg).not.toBe(rs[1]!.fg);
    expect(new Set(rs.map((x) => x.bgHex)).size).toBe(1);
  });
  test('a denial is `■ N denied ›`: red while fresh (also while working), amber after 5 minutes', () => {
    const deny = [{ id: 'routing', title: 'routing', lines: [{ id: 'g', label: 'Native Grep calls', ok: false, detail: '2 calls denied' }] }] as never[];
    const at = (kind: Kind, age: number) => bandRuns(model(kind, 150, false, { gates: deny }, { denyAgeSecs: age }), true).filter((x) => x.press?.startsWith('band:gates'));
    for (const [kind, age] of [['done', 10], ['done', 299], ['working', 4000]] as const) {
      const c = at(kind, age);
      expect(text(c)).toContain('■ 2 denied ›');
      expect(c[0]!.bgHex).toBe(xtermHex(52));
    }
    const old = at('done', 301);
    expect(old[0]!.bgHex).not.toBe(xtermHex(52));
    expect(old.every((x) => x.fg === old[0]!.fg)).toBe(true);
  });
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
  test('both caps carry the band background and the pill colour as their foreground', () => {
    const rs = bandRuns(model('working', 150, false), true);
    const caps = rs.filter((x) => x.t === '◖' || x.t === '◗');
    expect(caps).toHaveLength(2);
    const inner = rs.find((x) => x.t === ' ◆ ')!;
    expect(new Set(caps.map((x) => x.bgHex)).size).toBe(1);
    expect(caps[0]!.bgHex).toBe(rs.find((x) => x.press?.startsWith('band:gates'))!.bgHex === caps[0]!.bgHex ? undefined : caps[0]!.bgHex); // the band fill, not the chip fill
    expect(caps[0]!.fg).toBe(inner.bgHex);
  });
});

describe('I: gates rows', () => {
  const lines = [
    ...Array.from({ length: 4 }, () => ({ id: 'rd', label: 'Native Read calls', ok: true })),
    { id: 'long', label: 'A very long gate label that cannot fit the pane width', ok: true },
    { id: 'gr', label: 'Native Grep calls', ok: false, detail: '2 calls denied', fix: 'use ctx_search' },
  ];
  const world = (cols: number): string[] => {
    const h: Health = { gates: { total: 1, green: 0, checks: [{ id: 'routing', ok: false, lines: 6, pass: 5 }], denied: 2 }, upSecs: 9, version: '1', branch: 'm', hooks: { total: 3, byLabel: [{ label: 'tool.call', n: 3 }], recent: [{ label: 'tool.call Bash', ageSecs: 7, ms: 2 }] } } as never;
    const m = panelWorld('gates', cols, ui, { rows: 40, todos: [], workers: [], notes: [], gates: [{ id: 'routing', title: 'routing', lines }], run: { kind: 'working', secs: 5, startMs: NOW, frame: 0 }, health: h } as never);
    return panelLines(m).map((l) => lineText(l).trimEnd());
  };
  for (const cols of [48, 41]) test(`at ${cols}: identical rows merge as ×N, labels cut at the end with …, the verdict is a right column`, () => {
    const t = world(cols);
    expect(t.filter((l) => /Native Read/.test(l))).toHaveLength(1);
    expect(t.find((l) => /Native Read/.test(l))).toMatch(/×4/);
    const long = t.find((l) => /A very long/.test(l))!;
    expect(long).toMatch(/…\s+ok$/); // X3: the label is cut at its end, the value column stays whole and short
    expect(long.replace(/…\s+ok$/, '').length).toBeGreaterThanOrEqual(5 + 4 + 22); // at least 22 cells of label before any cut
    const grep = t.find((l) => /Native Grep/.test(l))!;
    expect(grep).toMatch(/deny$/);
    expect(t.some((l) => /^\s+2 calls denied$/.test(l))).toBe(true); // the sentence hangs under the row, never cut into the value column
    expect(textWidth(grep)).toBeLessThanOrEqual(cols);
    for (const l of t) expect(textWidth(l)).toBeLessThanOrEqual(cols);
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
    test(`${tab}: ribbon, the live fact \`${fact}\`, no placeholder rows, then its one shared section and the pinned footer (Y2b)`, () => {
      const t = body(tab === 'route' ? 'route' : tab);
      const i = t.findIndex((l) => l.includes(fact));
      expect(i).toBeGreaterThan(0);
      expect(t.some((l) => /── (TEAM|CHAT|CORE|BOARD) /.test(l))).toBe(true);
      expect(t.some((l) => /·{3,}|--:--|○ T\d|○ w\d|queued|worker +state|time +from|check +figure|item +owner/.test(l))).toBe(false); // nothing invented
      const shared: Record<string, string> = { team: 'ACTIVITY', channel: 'RECENT', core: 'GATES', route: 'RUNS' };
      if (tab === 'team' || tab === 'core') expect(t.some((l) => l.includes(`── ${shared[tab]}`))).toBe(true); // never a void under the fact: the tab's one shared section (the board's RUNS and the channel's RECENT need data)
      expect(t.filter((l) => /^ ── [A-Z]+ /.test(l)).length).toBeLessThanOrEqual(2);
      expect(t.at(-1)!.trim()).toMatch(/^atlas /);
    });
  }
  test('no filler line of last-run figures: the tab says what will appear and what triggers it (Y2b)', () => {
    const t = body('team', { secs: 5, done: 6, total: 6, agents: 0, failed: 0, endedAgo: 3 });
    expect(t.join('\n')).not.toMatch(/last run/);
  });
});

describe('K: 110 parity', () => {
  test('with the pane open at 110 (band 89) the band keeps the spark with its unit', () => {
    for (const kind of ['idle', 'working', 'done'] as Kind[]) expect(row(kind, 89, true)).toMatch(/[▁-█]{3,} +\d+ ev\/5m/);
  });
  test('the pane open at 110 is the closed row without the health chip: width independent', () => {
    for (const cols of [150, 110, 100]) for (const kind of ['idle', 'working', 'done'] as Kind[]) {
      if (kind === 'idle') expect(row(kind, cols, true).trimEnd()).toMatch(/[▁-█]{3,} +\d+ ev\/5m( │ ctx +6%)?$/); // Z6: the idle band beside the pane drops its empty detail slot for one health figure
      else expect(row(kind, cols, true).trimEnd()).toBe(row(kind, cols, false).replace(/ *▸ health *$/, '').trimEnd());
    }
  });
  test('the idle head glyph is the same at 110 and 150', () => {
    for (const cols of [150, 110, 100, 89]) expect(row('idle', cols, false)).toMatch(/◖ ◆ ATLAS ◗ ◌ idle up 0:41/);
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
  test('truecolor: 13 tones, one 2.4 s breath (24 beats of 100 ms)', () => withMotion(() => { expect(fills(ui).size).toBe(13); }));
  test('256 colours: eight violets in one breath (at least six distinct)', () => withMotion(() => { const n = fills({ ...ui, color: '256' }).size; expect(n).toBe(8); expect(n).toBeGreaterThanOrEqual(6); }));
  test('no colour: the pill does not move', () => withMotion(() => { expect(fills({ ...ui, color: 'none' }).size).toBe(1); }));
  test('only idle breathes: working and done hold one pill fill', () => withMotion(() => {
    for (const kind of ['working', 'done'] as Kind[]) expect(new Set(Array.from({ length: 24 }, (_, tick) => bandRuns(model(kind, 150, false, { tick }), true).find((x) => x.t === ' ◆ ')!.bgHex)).size).toBe(1);
  }));
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
  test('the status table never shows one shared value on every row', () => {
    const checks = ['completion', 'tripwire', 'routing', 'header'].map((id) => ({ id, ok: true, lines: 1, pass: 1 }));
    const m = panelWorld('route', 54, ui, { rows: 40, todos: [], workers: [], notes: [], gates: [], run: { kind: 'working', secs: 5, startMs: NOW, frame: 0 }, health: { ...h, gates: { total: 4, green: 4, checks } } } as never);
    const t = panelLines(m).map((l) => lineText(l).trimEnd());
    const lasts = ['completion', 'tripwire', 'routing', 'header'].map((id) => t.find((l) => new RegExp(`● ${id}`).test(l))?.slice(-5).trim());
    expect(lasts).toEqual(['2m', '6s', '2m', '41s']); // completion and routing run on classic.Stop (125 s), the tripwire on tool.call, the header on turn.complete
    expect(new Set(lasts).size).toBeGreaterThan(1);
  });
});
