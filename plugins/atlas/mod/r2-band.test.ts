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
    test(`(a) working at ${cols}: the phase word with n/6 in the 17-cell head, the newest tool in the detail slot, no clock`, () => {
      const row = first(model('working', cols));
      expect(row).toMatch(/[◐◓◑◒] implement 5\/6 +Bash +│/);
      expect(row).not.toMatch(/\d:\d\d/);
    });
    test(`(a) working at ${cols}: no known tool leaves the detail slot blank, a tool name is clipped to its 10 cells`, () => {
      expect(first(model('working', cols, {}, { hooks: hooks({ runTool: undefined }) }))).toMatch(/implement 5\/6 {5,}│/);
      expect(first(model('working', cols, {}, { hooks: hooks({ runTool: 'a_very_long_tool_name_indeed' }) }))).toMatch(/implement 5\/6 +a_very_lo… +│/);
    });
    test(`(b) done at ${cols}: \`● done 6/6\` and \`ended 1s\`, no run clock`, () => {
      const row = first(model('done', cols));
      expect(row).toMatch(/● done 6\/6 +ended 1s +│/);
      expect(row).not.toMatch(/\d:\d\d/);
    });
    test(`the run clock appears nowhere on the band at ${cols} (the idle head's uptime is the one \`m:ss\`)`, () => {
      for (const k of KINDS) expect((rows(model(k, cols)).join('\n').match(/\d:\d\d/g) ?? []).length).toBe(k === 'idle' ? 1 : 0);
    });
  }
  test('(c) idle head is `up M:SS`; the newest hook event is the `last` extra and advances with it', () => {
    const at = (s: number): string => first(model('idle', 150, {}, { hooks: hooks({ lastEventSecs: s }) }));
    expect(at(12)).toMatch(/◌ idle up 0:09/);
    expect(at(12)).toMatch(/last 12s(?!\w)/);
    expect(at(13)).toMatch(/last 13s(?!\w)/);
    expect(at(65)).toMatch(/last 1m5s|last 1m/);
  });
  test('idle with no event seen draws no `last` extra', () => {
    const row = first(model('idle', 150, {}, { hooks: hooks({ lastEventSecs: undefined }) }));
    expect(row).toMatch(/◌ idle up/);
    expect(row).not.toContain('last');
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
      const cols_ = KINDS.map((k) => textWidth(first(model(k, cols)).slice(0, first(model(k, cols)).search(/[●○] gates (ok|armed)/))));
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

describe('D10: narrowing (frame spec 2.7: extras from the end, the spark shrinks 20/10/5 then gives way to the count, the head stays)', () => {
  const WIDTHS = Array.from({ length: 111 }, (_, i) => 150 - i); // 150 down to 40, every width
  const feats = (cols: number, k: Kind) => {
    const row = first(model(k, cols));
    const spark = (row.match(SPARK)?.[0] ?? '').length;
    return { row, ctx: /ctx +\d+%/.test(row), rate: /\d+ ev\/5m/.test(row), count: /\d+\/5m/.test(row), spark, chip: row.includes('▸ health'), head: /◌ idle|[◐◓◑◒] |● done/.test(row) };
  };
  for (const k of KINDS) test(`(g) ${k}: ctx goes before the spark gives way; the head stays and no row is wider than its band`, () => {
    const f = WIDTHS.map((c) => feats(c, k));
    expect(f[0]).toMatchObject({ ctx: true, rate: true, spark: 20 });
    for (const [i, x] of f.entries()) {
      expect(textWidth(x.row)).toBeLessThanOrEqual(WIDTHS[i]!);
      expect(x.head).toBe(true);
      if (x.spark === 20) expect(x.ctx).toBe(true);
    }
    const at = (c: number) => f[WIDTHS.indexOf(c)]!;
    expect(at(110)).toMatchObject({ ctx: true, rate: true, spark: 10, chip: true });
    expect(at(100)).toMatchObject({ ctx: true, rate: true, spark: 5, chip: true }); // the 16-cell gates chip (round W) narrows the spark at 109 and below
    expect(at(96)).toMatchObject({ ctx: false, rate: true, spark: 5, chip: true });
    expect(at(86).chip).toBe(true);
    expect(at(86).rate || at(86).count).toBe(true); // one cell short of the 5-cell spark: a 3-cell spark keeps its unit
    expect(at(84).spark).toBe(5);
    expect(at(62)).toMatchObject({ rate: false, chip: true });
    expect(f.filter((x) => x.spark === 20 && !x.ctx)).toEqual([]);
  });
  test('the state head never depends on width: same kind at every width', () => {
    for (const c of WIDTHS) {
      expect(feats(c, 'idle').row).toMatch(/◌ idle/);
      expect(feats(c, 'working').row).toMatch(/[◐◓◑◒] /);
      expect(feats(c, 'done').row).toMatch(/● done/);
    }
  });
});

describe('D1 (band half): the chips', () => {
  const press = (b: BandModel, on: BandHandlers, key: string): void => {
    const root = bandTree(els, b, on) as unknown as Node;
    const btn = all(root).find((n) => n.kind === 'Button' && String(n.props.key).split('#')[0] === key)!;
    btn.props.onPress();
  };
  test('(h) pane closed: the health chip toggles the card, the gates chip opens the pane on its gates tab', () => {
    const calls: string[] = [];
    const on: BandHandlers = { openView: (v: string) => calls.push(`view:${v}`), toggleTodos() {}, toggleHealth: () => calls.push('card') };
    press(model('idle', 150), on, 'band:health');
    press(model('idle', 150), on, 'band:gates');
    expect(calls).toEqual(['card', 'view:gates']);
  });
  test('(h) pane open: the band draws no health chip, so a card can never open beside the panel; the gates chip stays', () => {
    const root = bandTree(els, model('idle', 150, {}, { panel: true }), handlers) as unknown as Node;
    const keys = all(root).filter((n) => n.kind === 'Button').map((n) => String(n.props.key).split('#')[0]).filter((k, i, a) => a.indexOf(k) === i);
    expect(keys).toEqual(['band:gates']);
  });
});
