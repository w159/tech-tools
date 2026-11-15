// Round 2 band rules (spec-r2 D2, D9, D10 and the band half of D1): no clock while working, a frozen `done m:ss`, a ticking `idle Ns`, fixed-width slots with the chip right-anchored,
// no orphan rows under the band, narrowing from the right by priority, and the chip opening the panel's gates row (not the card) while the side panel is up.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandRowCount, bandTree, type BandHandlers, type BandModel } from './band';
import { uiFromEnv, type Ui } from './atlas-ui';
import { busySnap } from './live_fixture';
import { hudLines } from './hud';
import { textWidth } from './theme';
import type { Pulse } from './pulse';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];
const textOf = (n: Node): string => (n.kind === 'Text' || typeof n.props.children === 'string' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const rows = (b: BandModel, on: BandHandlers | undefined = handlers): string[] => kids(bandTree(els, b, on) as unknown as Node).map(textOf);
const first = (b: BandModel): string => rows(b)[0]!;

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const handlers: BandHandlers = { openView() {}, toggleTodos() {}, toggleHealth() {} };
const green = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as any;
const GATES = ['completion', 'tripwire', 'routing', 'header'].map(green);
const PULSE: Pulse = { events: [0, 0, 0, 0, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 1], ctx: [], runs: [] };
const hooks = (over: object = {}) => ({ total: 3, byLabel: [{ label: 'tool.call', n: 3 }], recent: [], lastEventSecs: 12, runTools: 3, runTool: 'Bash', ...over });
const HEALTH = { upSecs: 9, version: '17.24.0', branch: 'master', tokens: 64_000, window: 1_000_000, hooks: hooks(), pulse: PULSE, open: false };
const snap = (over: Record<string, unknown> = {}) => busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 6, ...over } as never);
type Kind = 'idle' | 'working' | 'done';
const KINDS: Kind[] = ['idle', 'working', 'done'];
const model = (kind: Kind, columns: number, over: Partial<BandModel> = {}, health: object = {}): BandModel => ({
  snapshot: kind === 'done' ? snap({ phase: 'done' }) : snap(), live: [], gates: GATES, columns, tick: 0, maxRows: 12, ui,
  health: { ...HEALTH, ...health },
  ...(kind === 'working' ? { working: true, workSecs: 3 } : {}),
  ...(kind === 'done' ? { ranSecs: 5, restSecs: 1 } : {}),
  ...over,
} as BandModel);
/** The display column the `▸ health` chip starts at. */
const chipCol = (row: string): number => textWidth(row.slice(0, row.indexOf('▸ health')));
const SPARK = /[▁-█]+/;

describe('D2: the head', () => {
  for (const cols of [150, 110]) {
    test(`(a) working at ${cols}: phase and count in the 24-cell slot (the tool gives way to the count), no clock`, () => {
      const row = first(model('working', cols));
      expect(row).toMatch(/[◐◓◑◒] implement · 3 tools/);
      expect(row).not.toMatch(/\d:\d\d/);
    });
    test(`(a) working at ${cols}: one tool reads \`1 tool\`, no known tool omits that part, a short phase keeps both`, () => {
      expect(first(model('working', cols, {}, { hooks: hooks({ runTools: 1 }) }))).toMatch(/implement · 1 tool\b(?!s)/);
      expect(first({ ...model('working', cols), snapshot: snap({ phase: 'test' }) })).toMatch(/test · Bash · 3 tools/);
      const none = first(model('working', cols, {}, { hooks: hooks({ runTool: undefined }) }));
      expect(none).toMatch(/implement · 3 tools/);
      expect(none).not.toMatch(/Bash/);
    });
    test(`(b) done at ${cols}: \`● done 0:05\` with no separator`, () => {
      const row = first(model('done', cols));
      expect(row).toMatch(/● done 0:05(?! ·)/);
      expect(row).not.toMatch(/done ·/);
    });
    test(`run time appears once per frame (done only) at ${cols}`, () => {
      for (const k of KINDS) expect((rows(model(k, cols)).join('\n').match(/\d:\d\d/g) ?? []).length).toBe(k === 'done' ? 1 : 0);
    });
  }
  test('(c) idle head is seconds since the last hook event and advances with it', () => {
    const at = (s: number): string => first(model('idle', 150, {}, { hooks: hooks({ lastEventSecs: s }) }));
    expect(at(12)).toMatch(/○ idle 12s(?!\w)/);
    expect(at(13)).toMatch(/○ idle 13s(?!\w)/);
    expect(at(65)).toMatch(/○ idle 1m 05s/);
    expect(at(12)).not.toMatch(/\d:\d\d/);
  });
  test('idle with no event seen reads `○ idle` alone', () => {
    const row = first(model('idle', 150, {}, { hooks: hooks({ lastEventSecs: undefined }) }));
    expect(row).toMatch(/○ idle(?! \d)/);
  });
});

describe('D9: fixed slots', () => {
  for (const cols of [150, 110]) {
    test(`(d) the chip sits at the same column in idle, working and done at ${cols}, flush to the last cell`, () => {
      const cs = KINDS.map((k) => { const row = first(model(k, cols)); expect(row).toContain('▸ health'); return chipCol(row); });
      expect(new Set(cs).size).toBe(1);
      for (const k of KINDS) expect(textWidth(first(model(k, cols)).trimEnd())).toBeGreaterThanOrEqual(cols - 1);
    });
    test(`(d) a slot changes content, not width: the gates slot starts at one column in all three states at ${cols}`, () => {
      const cols_ = KINDS.map((k) => textWidth(first(model(k, cols)).slice(0, first(model(k, cols)).indexOf('● gates ok'))));
      expect(new Set(cols_).size).toBe(1);
    });
    test(`(e) the band has the same row count in idle, working and done at ${cols}, open or closed`, () => {
      for (const panel of [false, true]) {
        const n = KINDS.map((k) => rows(model(k, cols, {}, panel ? { panel: true } : {})).length);
        expect(new Set(n).size).toBe(1);
        expect(new Set(KINDS.map((k) => bandRowCount(model(k, cols, {}, panel ? { panel: true } : {}), true))).size).toBe(1);
      }
    });
    test(`(f) no tab or chip row under the band at ${cols}`, () => {
      for (const k of KINDS) {
        const rs = rows(model(k, cols));
        expect(rs.length).toBe(1);
        expect(rs.join('\n')).not.toMatch(/status.*team|team.*channel/);
      }
    });
  }
  test('(f) an empty run draws no `no plan yet` / `0 agents` ribbon', () => {
    const out = hudLines({ todos: [], agents: [], squad: [], now: 0 } as never, { cols: 100, maxRows: 4, reserve: true, healthLine: 'x', ui, tick: 0 } as never);
    expect(out.map((l) => l.map((x) => x.t).join('')).join('\n')).not.toMatch(/no plan yet|0 agents/);
  });
});

describe('D10: narrowing', () => {
  const WIDTHS = Array.from({ length: 111 }, (_, i) => 150 - i); // 150 down to 40, every width
  const feats = (cols: number, k: Kind) => {
    const row = first(model(k, cols));
    const spark = (row.match(SPARK)?.[0] ?? '').length;
    return { row, ctx: /ctx \d+%/.test(row), rate: /\d+\/5m/.test(row), spark, chip: row.includes('▸ health'), head: /○ idle|[◐◓◑◒] |● done/.test(row) };
  };
  for (const k of KINDS) test(`(g) ${k}: ctx goes first, then the rate text, then the spark shrinks 8 to 4; head and chip stay`, () => {
    const f = WIDTHS.map((c) => feats(c, k));
    expect(f[0]).toMatchObject({ ctx: true, rate: true, spark: 8 });
    for (const [i, x] of f.entries()) {
      expect(textWidth(x.row)).toBeLessThanOrEqual(WIDTHS[i]!);
      expect(x.chip && x.head).toBe(true);
      if (!x.ctx) expect(f.slice(i).every((y) => !y.ctx)).toBe(true); // once gone, gone
      if (x.ctx) expect(x.rate && x.spark === 8).toBe(true); // ctx outlasts nothing: it is the first to go
      if (!x.rate) expect(x.ctx).toBe(false);
      if (x.spark < 8) expect(x.rate).toBe(false);
    }
    expect(f.some((x) => !x.ctx && x.rate)).toBe(true);
    expect(f.some((x) => !x.rate && x.spark === 8)).toBe(true);
    expect(f.some((x) => x.spark === 4)).toBe(true);
    const at = (c: number) => f[WIDTHS.indexOf(c)]!;
    expect(at(110)).toMatchObject({ ctx: true, rate: true, spark: 8 });
    expect(at(84)).toMatchObject({ ctx: true, rate: true, spark: 8 }); // round 3 (E10): the state slot shrinks to its minimum before ctx goes
    expect(at(78)).toMatchObject({ ctx: false, rate: true, spark: 8 });
    expect(at(66)).toMatchObject({ ctx: false, rate: false, spark: 8 });
    expect(at(60).spark).toBeLessThan(8);
  });
  test('the state head never depends on width: same kind at every width', () => {
    for (const c of WIDTHS) {
      expect(feats(c, 'idle').row).toMatch(/○ idle/);
      expect(feats(c, 'working').row).toMatch(/[◐◓◑◒] /);
      expect(feats(c, 'done').row).toMatch(/● done/);
    }
  });
});

describe('D1 (band half): the chip with the side panel up', () => {
  const press = (b: BandModel, on: BandHandlers): void => {
    const root = bandTree(els, b, on) as unknown as Node;
    const btn = all(root).find((n) => n.kind === 'Button' && String(n.props.key) === 'band:health')!;
    btn.props.onPress();
  };
  test('(h) panel open: the press opens the panel gates row and never toggles the card', () => {
    const calls: string[] = [];
    const on: BandHandlers = { ...handlers, toggleHealth: () => calls.push('card'), openHealthInPanel: () => calls.push('panel') };
    press(model('idle', 150, {}, { panel: true }), on);
    expect(calls).toEqual(['panel']);
  });
  test('(h) panel closed: the press toggles the card', () => {
    const calls: string[] = [];
    const on: BandHandlers = { ...handlers, toggleHealth: () => calls.push('card'), openHealthInPanel: () => calls.push('panel') };
    press(model('idle', 150), on);
    expect(calls).toEqual(['card']);
  });
});
