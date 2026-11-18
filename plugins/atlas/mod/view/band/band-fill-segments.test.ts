// Round 3 band and chart edges (spec-r3 E8, E10 and the chart rules): the band's static segments sit on the band fill with `▌` separators (only the `▸ health` chip is a raised chip), the state slot is sized to its
// longest head (cap 24) with a green done head and no slab, the band spark is eighth blocks, a narrow band keeps state, gates and a 4-cell spark, CONTEXT draws no chart under 2 measures and no `░` track, the ACTIVITY
// window follows the session age, and the `session` row has its own SESSION ribbon.
import { describe, expect, test } from 'claude-code/testing';
import { bandRuns, bandTree, type BandModel } from './band';
import type { ClientElements } from 'claude-code';
import { PALETTES, uiFromEnv, type Run, type Ui } from '../../atlas-ui';
import { tileOf } from '../../input/clickable';
import { healthStripBg } from './mission-layout';
import { busySnap } from '../../live_fixture';
import { textWidth } from '../../theme';
import type { Pulse } from '../../data/pulse';
import { activitySection, contextSection, type Health } from '../../data/idle-health';
import { healthCardRows } from '../../hud-surface';
import { lineText, panelLines, type PanelModel, type PanelTab } from '../../panel-layout';
import { panelWorld } from '../../../contracts/panel-world';
import { NOW } from '../../live_fixture';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' || typeof n.props.children === 'string' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const first = (b: BandModel): string => kids(bandTree(els, b, { openView() {}, toggleTodos() {}, toggleHealth() {} }) as unknown as Node).map(textOf)[0]!;

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const green = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as any;
const GATES = ['completion', 'tripwire', 'routing', 'header'].map(green);
const PULSE: Pulse = { events: [0, 0, 0, 0, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 1], ctx: [], runs: [] };
const hooks = (over: object = {}) => ({ total: 3, byLabel: [{ label: 'tool.call', n: 3 }], recent: [{ label: 'tool.call Bash', ageSecs: 4 }], lastEventSecs: 12, runTools: 3, runTool: 'Bash', ...over });
const HEALTH = { upSecs: 9, version: '17.24.0', branch: 'master', tokens: 64_000, window: 1_000_000, hooks: hooks(), pulse: PULSE, open: false };
const snap = (over: Record<string, unknown> = {}) => busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 6, ...over } as never);
type Kind = 'idle' | 'working' | 'done';
const KINDS: Kind[] = ['idle', 'working', 'done'];
const model = (kind: Kind, columns: number, health: object = {}): BandModel => ({
  snapshot: kind === 'done' ? snap({ phase: 'done' }) : snap(), live: [], gates: GATES, columns, tick: 0, maxRows: 12, ui,
  health: { ...HEALTH, ...health },
  ...(kind === 'working' ? { working: true, workSecs: 3 } : {}),
  ...(kind === 'done' ? { ranSecs: 5, restSecs: 1 } : {}),
} as BandModel);
const BLOCK = /[▁▂▃▄▅▆▇█]/g;
const BAND_FILL = healthStripBg(ui);
/** The runs after the wordmark's `◗` (the band's own segments). */
const afterCap = (runs: Run[]): Run[] => { let seen = false; return runs.filter((x) => { const was = seen; if (x.t.includes('◗')) seen = true; return was; }); };

describe('E8/E10: static segments on the band fill, two chips (v1 frame spec)', () => {
  for (const cols of [150, 110, 93]) for (const k of KINDS) {
    test(`${k} at ${cols}: every run after the wordmark sits on the band fill except the gates and health chips`, () => {
      const rs = afterCap(bandRuns(model(k, cols), true));
      const fills = new Set(rs.filter((x) => !x.press && x.t.trim() !== '').map((x) => x.bgHex));
      expect([...fills]).toEqual([BAND_FILL]);
      const chips = rs.filter((x) => x.press);
      expect(new Set(chips.map((x) => String(x.press).split('#')[0]))).toEqual(new Set(['band:gates', 'band:health']));
      for (const c of chips) expect(c.bgHex).not.toBe(BAND_FILL);
      expect(chips.map((x) => x.t).join('')).toContain(' ▸ health ');
    });
    test(`${k} at ${cols}: the static segments are divided by \`│\` and no raised plan tile is drawn`, () => {
      const rs = bandRuns(model(k, cols), true);
      expect(rs.filter((x) => x.t.includes('│')).length).toBeGreaterThanOrEqual(2);
      const raised = [PALETTES.mocha.accent, '#3a3a3a', '#585858'];
      for (const x of afterCap(rs)) if (!x.press) expect(raised).not.toContain(x.bgHex);
    });
  }
});

describe('E10: the state slot (v1 frame spec: a fixed 17-cell head, the same in idle, working and done)', () => {
  const headEnd = (runs: Run[]): number => { const rs = afterCap(runs); const at = rs.findIndex((x) => x.t.includes('│')); return rs.slice(0, at).reduce((n, x) => n + textWidth(x.t), 0); };
  test('the head and its detail slot end at the same column in idle, working and done at 150', () => {
    const w = KINDS.map((k) => headEnd(bandRuns(model(k, 150), true)));
    expect(new Set(w).size).toBe(1);
  });
  test('a long tool name is clipped into the detail slot, never widening it', () => {
    const w = headEnd(bandRuns(model('working', 150, { hooks: hooks({ runTool: 'a_very_long_tool_name_indeed' }) }), true));
    expect(w).toBe(headEnd(bandRuns(model('working', 150), true)));
  });
  test('done head: green glyph on the normal band fill, never the saturated slab', () => {
    const rs = afterCap(bandRuns(model('done', 150), true));
    const dot = rs.find((x) => x.t.includes('●'))!;
    expect(dot).toBeDefined();
    expect(dot.bgHex).toBe(BAND_FILL);
    for (const x of rs) expect(x.bgHex).not.toBe(PALETTES.mocha.ok);
    expect(first(model('done', 150))).toMatch(/● done 6\/6 · ended 1s/);
  });
  test('working head sits on the band fill with the spinner in the accent', () => {
    const rs = afterCap(bandRuns(model('working', 150), true));
    const spin = rs.find((x) => /^[◐◓◑◒]/.test(x.t.trim()))!;
    expect(spin.bgHex).toBe(BAND_FILL);
    for (const x of rs) expect(x.bgHex).not.toBe(PALETTES.mocha.accent);
  });
});

describe('E10: the band spark is eighth blocks', () => {
  for (const k of KINDS) test(`${k} at 150: an 8-cell block spark with a \`▁\` baseline, the peak \`peak N / Ns\`, no braille`, () => {
    const row = first(model(k, 150));
    expect(row).not.toMatch(/[⠀-⣿]/);
    expect(row).toMatch(/[▁▂▃▄▅▆▇█]{8} peak \d+ \/ \d+s/);
    const rs = afterCap(bandRuns(model(k, 150), true));
    expect(rs.some((x) => /^▁+$/.test(x.t))).toBe(true);
  });
});

describe('E10: a narrow band (110 columns with the side pane open) keeps the head, the gates chip and a block spark', () => {
  for (const cols of [89, 66, 61, 56, 55]) for (const k of KINDS) {
    test(`${k} at ${cols}: head, gates, >= 4 block cells or the count, no ticker, within ${cols}`, () => {
      const row = first(model(k, cols));
      expect(textWidth(row)).toBeLessThanOrEqual(cols);
      expect(row).toMatch(/◌ idle|[◐◓◑◒] |● done/);
      expect(row).toMatch(/[●○] gates (ok|armed)/);
      expect(row).not.toContain('session started');
      expect(cols >= 63 ? /[▁▂▃▄▅▆▇█]{8}/.test(row) : true).toBe(true);
    });
  }
  test('the extras give way before the spark and the head go', () => {
    const at = (c: number) => first(model('working', c));
    expect(at(110)).toMatch(/ctx +6%/);
    expect(at(96)).not.toMatch(/ctx +6%/);
    expect(at(96)).toMatch(/peak \d+ \/ \d+s/);
    expect(at(86)).toMatch(/implement 5\/6/);
    expect(at(86)).toMatch(/peak \d+ \/ \d+s/);
  });
});

describe('E3: CONTEXT draws no chart under 2 measures and no `░` track', () => {
  const h = (ctx: Array<{ tokens: number; pct: number; at: number }>, over: Partial<Health> = {}): Health => ({ gates: { total: 1, green: 1, checks: [{ id: 'completion', ok: true, lines: 1, pass: 1 }] }, ctxPct: 6, tokens: 64_000, window: 1_000_000, upSecs: 900, pulse: { events: [], ctx, runs: [], window: 1_000_000 }, ...over }) as Health;
  const at = (n: number) => Array.from({ length: n }, (_, i) => ({ tokens: 10_000 * (i + 1), pct: 2 + i, at: i }));
  test('0 and 1 measures: the gauge row alone', () => {
    for (const n of [0, 1]) expect(contextSection(h(at(n)), ui, { cols: 54, chartRows: 2 }).rows.length).toBe(1);
  });
  test('before the first measure with no reading the row is the gauge and `—`', () => {
    const s = contextSection(h([], { ctxPct: undefined, tokens: undefined }), ui, { cols: 54, chartRows: 2 });
    expect(s.rows.length).toBe(1);
    expect(s.rows[0]!.map((x) => x.t).join('')).toContain('—');
  });
  test('2 and more measures: the 2-row chart and the gauge row', () => {
    for (const n of [2, 3]) expect(contextSection(h(at(n)), ui, { cols: 54, chartRows: 2 }).rows.length).toBe(3);
  });
  test('the gauge track is solid dim cells in the section, the panel, the card and the band: no `░` anywhere', () => {
    const sec = contextSection(h(at(3)), ui, { cols: 54, chartRows: 2 }).rows.flat().map((x) => x.t).join('');
    expect(sec).not.toContain('░');
    const card = healthCardRows(h(at(3)), { cols: 150, ui }).flat().map((x) => x.t).join('');
    expect(card).not.toContain('░');
    const band = bandRuns(model('working', 150), true).map((x) => x.t).join('');
    expect(band).not.toContain('░');
  });
});

describe('E1: the ACTIVITY window follows the session age (2m to 7m)', () => {
  const ev = [...new Array<number>(20).fill(0), 1, 2, 3, 2, 1, 2, 3, 2];
  const h = (upSecs: number | undefined): Health => ({ gates: { total: 1, green: 1, checks: [] }, upSecs, pulse: { events: ev, ctx: [], runs: [] } }) as Health;
  const axis = (s: { rows: Run[][] }): string => s.rows.map((r) => r.map((x) => x.t).join('')).find((l) => /now$/.test(l.trimEnd()))!;
  for (const [up, label] of [[20, '-2m'], [100, '-2m'], [130, '-3m'], [200, '-4m'], [290, '-5m'], [400, '-7m'], [3600, '-7m']] as const) {
    test(`session age ${up}s labels the left edge ${label}`, () => {
      expect(axis(activitySection(h(up), ui, { cols: 54, chartRows: 3 })).trimStart().startsWith(label)).toBe(true);
    });
  }
  test('an unknown age keeps the full 7 minutes', () => {
    expect(axis(activitySection(h(undefined), ui, { cols: 54, chartRows: 3 })).trimStart().startsWith('-7m')).toBe(true);
  });
  test('a young session fills the chart: no baseline-only columns when its buckets all carry events', () => {
    const s = activitySection(h(120), ui, { cols: 54, chartRows: 3 });
    const bottom = s.rows[2]!.map((x) => x.t).join('');
    expect(bottom).not.toContain('⣀');
    const full = activitySection(h(3600), ui, { cols: 54, chartRows: 3 });
    expect(full.rows[2]!.map((x) => x.t).join('')).toContain('⣀');
  });
});

describe('E7: the card has no SESSION row (frame spec section 6: the uptime and the version are the pane\'s NOW line and footer)', () => {
  const health = (): Health => ({
    gates: { total: 2, green: 2, checks: [{ id: 'completion', ok: true, lines: 1, pass: 1 }, { id: 'tripwire', ok: true, lines: 2, pass: 2 }] },
    ctxPct: 6, tokens: 64_000, window: 1_000_000, upSecs: 900, branch: 'master', version: '17.24.0',
    hooks: { total: 40, byLabel: [{ label: 'tool.call', n: 3 }], recent: [{ label: 'tool.call Bash', ageSecs: 5 }], lastEventSecs: 3 },
    pulse: { events: [0, 1, 2, 1], ctx: [], runs: [] },
  }) as Health;
  test('the card (one column and three) draws no SESSION ribbon and no `session up` row', () => {
    for (const cols of [60, 150]) {
      const t = healthCardRows(health(), { cols, ui }).map((r) => r.map((x) => x.t).join('').trimEnd());
      expect(t.some((l) => /── SESSION ─/.test(l))).toBe(false);
      expect(t.some((l) => /session {3,}up /.test(l))).toBe(false);
    }
  });
});
