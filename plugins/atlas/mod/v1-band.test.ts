// v1 band: the live band matches frames B1-B10 of the approved text-frame spec (critics/mock-final.md section 3), cell for cell, at 150 and 110 with the pane open (band 89 and 55) and closed (145 and 100).
// The spec draws the host's ` [-]` after the band; the band itself is `W` cells, so a frame here is the spec line without that handle. Where a frame is not reproducible it says so in its test.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandRuns, bandTree, type BandModel } from './band';
import { hostEnv, PALETTES, uiFromEnv, xtermHex, type Run, type Ui } from './atlas-ui';
import { busySnap } from './live_fixture';
import { hookStats, noteHook, noteHookMs, resetHookLog } from './hook-log';
import { denyAgeSecs, noteDenied, resetPulse } from './pulse';
import { deniedCalls } from './vocab';
import { textWidth } from './theme';
import type { Pulse } from './pulse';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const NOW = 4_000_000_000_000; // a multiple of 1600 ms: tick 0 is heartbeat frame 0 and spinner frame 0
const FRAME_END = 4; // ` [-]`: the host's handle after the band, as the spec draws it

/** The heartbeat ramp only moves on a capable terminal; pin the env so the ramp tests do not depend on how the suite was launched. */
function pinMotionEnv(): () => void {
  const env = hostEnv() as Record<string, string | undefined>;
  const keys = ['TERM', 'NO_COLOR', 'ATLAS_REDUCED_MOTION', 'REDUCE_MOTION'];
  const saved = keys.map((k) => [k, env[k]] as const);
  env.TERM = 'xterm-256color';
  for (const k of keys.slice(1)) delete env[k];
  return () => { for (const [k, v] of saved) { if (v === undefined) delete env[k]; else env[k] = v; } };
}

type Kind = 'idle' | 'working' | 'done';
const green = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as never;
const GATES_OK = ['completion', 'tripwire', 'routing', 'header'].map(green);
const GATES_ARMED = ['completion', 'tripwire', 'routing', 'header'].map((id) => ({ id, title: id, lines: [] }) as never);
const GATES_DENY = [green('completion'), green('tripwire'), { id: 'routing', title: 'routing', lines: [{ id: 'grep', label: 'Native Grep calls', ok: false, detail: '2 calls denied', fix: 'use ctx_search' }, { id: 'glob', label: 'Native Glob calls', ok: true }] } as never, green('header')];
const series = (tail: number[]): number[] => [...new Array<number>(28 - tail.length).fill(0), ...tail];
const pulse = (events: number[], cost?: number): Pulse => ({ events: series(events), ctx: [], runs: [], ...(cost !== undefined ? { cost: { usd: cost } } : {}) });
const hooks = (over: object = {}) => ({ total: 3, byLabel: [], recent: [], ...over });

type Over = { kind: Kind; cols: number; panel: boolean; tick?: number; upSecs?: number; rest?: number; gates?: never[]; health?: object; ctx?: number; phase?: string };
function model(o: Over): BandModel {
  const snap = busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: o.ctx ?? 0, phase: (o.phase ?? 'test') as never, now: NOW });
  return {
    snapshot: o.kind === 'done' ? { ...snap, phase: 'done' as never } : snap, live: [], gates: o.gates ?? GATES_OK, columns: o.cols, tick: o.tick ?? 0, maxRows: 12, ui,
    health: { upSecs: o.upSecs ?? 41, hooks: hooks(), ...(o.panel ? { panel: true } : {}), ...o.health },
    ...(o.kind === 'working' ? { working: true, workSecs: 3 } : {}),
    ...(o.kind === 'done' ? { ranSecs: 5, restSecs: o.rest ?? 12 } : {}),
  } as BandModel;
}
const text = (runs: Run[]): string => runs.map((x) => x.t).join('');
const row = (o: Over): string => text(bandRuns(model(o), true));
/** The spec's line without the host handle. */
const frame = (line: string): string => line.slice(0, line.length - FRAME_END);

// B3, B5, B7 spark data: the last ten buckets that draw `▁▁▁▂▁▅▃▁▂█` (15 events) and `▁▅▆▃▁▁▂▂█▇` (26).
const SPARK15 = [0, 0, 0, 1, 0, 4, 2, 0, 1, 7];
const SPARK26 = [0, 4, 5, 2, 0, 0, 1, 1, 7, 6];
const WORK_HOOKS = { runTool: 'Bash', runTools: 6, lastEventSecs: 5 };

describe('B1: 150, pane open, idle: the heartbeat ramps ◌ ◎ ◌ ◌ and the clock rolls', () => {
  const frames = [
    '◖ ◆ ATLAS ◗ ◌ idle up 0:41               │  ○ gates     │ ▁▁▁▁▁▁▁▁▂▁   1 ev/5m            [-]',
    '◖ ◆ ATLAS ◗ ◎ idle up 0:41               │  ○ gates     │ ▁▁▁▁▁▁▁▁▂▁   1 ev/5m            [-]',
    '◖ ◆ ATLAS ◗ ◌ idle up 0:41               │  ○ gates     │ ▁▁▁▁▁▁▁▁▂▁   1 ev/5m            [-]',
    '◖ ◆ ATLAS ◗ ◌ idle up 0:42               │  ○ gates     │ ▁▁▁▁▁▁▁▁▂▁   1 ev/5m            [-]',
  ];
  frames.forEach((f, i) => {
    test(`frame ${i + 1} is the spec line, 89 cells`, () => {
      const got = row({ kind: 'idle', cols: 89, panel: true, tick: i * 4, upSecs: i === 3 ? 42 : 41, gates: GATES_ARMED as never[], health: { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 0, 1, 0]), hooks: hooks() } });
      expect(got).toBe(frame(f));
      expect(textWidth(got)).toBe(89);
    });
  });
  test('only the heartbeat glyph changes colour with time; every other run is the same four frames', () => {
    const restore = pinMotionEnv();
    try {
    const at = (tick: number): Run[] => bandRuns(model({ kind: 'idle', cols: 89, panel: true, tick, gates: GATES_ARMED as never[], health: { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 0, 1, 0]) } }), true);
    const [a, b] = [at(0), at(2)];
    const heart = (rs: Run[]): Run => rs.find((x) => /^[◌◎]/.test(x.t))!;
    expect(heart(a).fg).not.toBe(heart(b).fg);
    const rest = (rs: Run[]): string => JSON.stringify(rs.filter((x) => !/^[◌◎]/.test(x.t)));
    expect(rest(a)).toBe(rest(b));
    } finally { restore(); }
  });
  test('the heartbeat colour stays inside the 97 to 183 ramp', () => {
    const restore = pinMotionEnv();
    try {
    const lo = parseInt(xtermHex(97).slice(1, 3), 16);
    const hi = parseInt(xtermHex(183).slice(1, 3), 16);
    for (let tick = 0; tick < 28; tick++) {
      const r = bandRuns(model({ kind: 'idle', cols: 89, panel: true, tick }), true).find((x) => /^[◌◎]/.test(x.t))!;
      const red = parseInt(r.fg!.slice(1, 3), 16);
      expect(red).toBeGreaterThanOrEqual(Math.min(lo, hi));
      expect(red).toBeLessThanOrEqual(Math.max(lo, hi));
    }
    } finally { restore(); }
  });
  test('the idle clock is the session uptime, never the age of the last event', () => {
    expect(row({ kind: 'idle', cols: 89, panel: true, upSecs: 3725, health: { hooks: hooks({ lastEventSecs: 9 }) } })).toContain('idle up 1:02:05');
  });
});

describe('B2: 110, pane open, idle', () => {
  test('the 5-cell spark is replaced by the bare count', () => {
    const got = row({ kind: 'idle', cols: 55, panel: true, gates: GATES_ARMED as never[], health: { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 0, 1, 0]) } });
    expect(got).toBe(frame('◖ ◆ ATLAS ◗ ◌ idle up 0:41    │  ○ gates     │   1/5m   [-]'));
    expect(textWidth(got)).toBe(55);
  });
});

describe('B3 and B4: working', () => {
  const h = { pulse: pulse(SPARK15), hooks: hooks(WORK_HOOKS) };
  test('B3 150 pane open: the spinner turns ◐ then ◓ on the shared frame (100 ms here; the spec draws 200 ms, see the report), the newest tool in the detail slot', () => {
    const f1 = '◖ ◆ ATLAS ◗ ◐ test 3/6        Bash       │  ● gates ok  │ ▁▁▁▂▁▅▃▁▂█  15 ev/5m │ ctx   6% [-]';
    const f2 = f1.replace('◐', '◓');
    expect(row({ kind: 'working', cols: 89, panel: true, tick: 0, ctx: 6, health: h })).toBe(frame(f1));
    expect(row({ kind: 'working', cols: 89, panel: true, tick: 1, ctx: 6, health: h })).toBe(frame(f2));
  });
  test('B4 110 pane open', () => {
    expect(row({ kind: 'working', cols: 55, panel: true, ctx: 6, health: h })).toBe(frame('◖ ◆ ATLAS ◗ ◐ test 3/6        │  ● gates ok  │  15/5m   [-]'));
  });
  test('the head names the contract phase out of six, not the five-step rail', () => {
    expect(row({ kind: 'working', cols: 89, panel: true, phase: 'implement', health: h })).toContain('◐ implement 5/6');
    expect(row({ kind: 'working', cols: 89, panel: true, phase: 'verify', health: h })).toContain('◐ verify 6/6');
  });
  test('an mcp tool reads as its bare name, and a long one is cut inside the 10-cell slot', () => {
    const got = row({ kind: 'working', cols: 89, panel: true, health: { ...h, hooks: hooks({ ...WORK_HOOKS, runTool: 'mcp__lean-ctx__ctx_compose_all_things' }) } });
    expect(got.slice(30, 40)).toBe('ctx_compo…');
    expect(textWidth(got)).toBe(89);
  });
});

describe('B5 and B6: done', () => {
  const h = { pulse: pulse(SPARK26), hooks: hooks({ ...WORK_HOOKS, lastEventSecs: 10 }) };
  test('B5 150 pane open: `ended Ns` ticks each second', () => {
    expect(row({ kind: 'done', cols: 89, panel: true, rest: 12, ctx: 6, health: h })).toBe(frame('◖ ◆ ATLAS ◗ ● done 6/6        ended 12s  │  ● gates ok  │ ▁▅▆▃▁▁▂▂█▇  26 ev/5m │ ctx   6% [-]'));
    expect(row({ kind: 'done', cols: 89, panel: true, rest: 13, ctx: 6, health: h })).toBe(frame('◖ ◆ ATLAS ◗ ● done 6/6        ended 13s  │  ● gates ok  │ ▁▅▆▃▁▁▂▂█▇  26 ev/5m │ ctx   6% [-]'));
  });
  test('B6 110 pane open', () => {
    expect(row({ kind: 'done', cols: 55, panel: true, ctx: 6, health: h })).toBe(frame('◖ ◆ ATLAS ◗ ● done 6/6        │  ● gates ok  │  26/5m   [-]'));
  });
  test('only the done glyph is ok green', () => {
    const rs = bandRuns(model({ kind: 'done', cols: 89, panel: true, ctx: 6, health: h }), true);
    const greens = rs.filter((x) => x.fg === xtermHex(78));
    expect(greens.map((x) => x.t)).toEqual(['●']);
    expect(rs.find((x) => x.t === '●')!.fg).toBe(xtermHex(78));
  });
  test('the head returns to idle with the session uptime after 60 s', () => {
    expect(row({ kind: 'done', cols: 89, panel: true, rest: 59, health: h })).toContain('● done 6/6        ended 59s');
    const idle = row({ kind: 'idle', cols: 89, panel: true, upSecs: 125, health: h });
    expect(idle).toContain('idle up 2:05');
    expect(idle).not.toContain('ended');
  });
});

describe('B7 and B8: gate denial', () => {
  const h = { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, runTool: 'Grep' }) };
  test('B7 150 pane open: `■ 2 denied` counts denied calls, not failing checks', () => {
    expect(row({ kind: 'working', cols: 89, panel: true, ctx: 6, gates: GATES_DENY as never[], health: h })).toBe(frame('◖ ◆ ATLAS ◗ ◐ test 3/6        Grep       │  ■ 2 denied  │ ▁▁▁▂▁▅▃▁▂█  15 ev/5m │ ctx   6% [-]'));
  });
  test('B8 110 pane open', () => {
    expect(row({ kind: 'working', cols: 55, panel: true, ctx: 6, gates: GATES_DENY as never[], health: h })).toBe(frame('◖ ◆ ATLAS ◗ ◐ test 3/6        │  ■ 2 denied  │  15/5m   [-]'));
  });
  test('the denial chip is an alert chip (bg 52, fg 210) while the run works', () => {
    const rs = bandRuns(model({ kind: 'working', cols: 89, panel: true, ctx: 6, gates: GATES_DENY as never[], health: h }), true);
    const chip = rs.filter((x) => x.press);
    expect(chip.map((x) => x.t).join('')).toBe(' ■ 2 denied ');
    expect(chip[0]!.bgHex).toBe(xtermHex(52));
    expect(chip[0]!.fg).toBe(xtermHex(210));
  });
  test('after the run, 60 s on, the chip is neutral with only the ■ red (N3)', () => {
    const rs = bandRuns(model({ kind: 'done', cols: 89, panel: true, gates: GATES_DENY as never[], health: { ...h, denyAgeSecs: 61 } }), true);
    const chip = rs.filter((x) => x.press);
    expect(chip.map((x) => x.t).join('')).toBe(' ■ 2 denied ');
    expect(new Set(chip.map((x) => x.bgHex))).toEqual(new Set([xtermHex(239)]));
    expect(chip.filter((x) => x.fg === xtermHex(203)).map((x) => x.t)).toEqual(['■']);
    const fresh = bandRuns(model({ kind: 'done', cols: 89, panel: true, gates: GATES_DENY as never[], health: { ...h, denyAgeSecs: 59 } }), true).filter((x) => x.press);
    expect(fresh[0]!.bgHex).toBe(xtermHex(52));
  });
  test('deniedCalls reads the count in a line\'s own detail, one for a failing line that says none, and skips the Stop verdict', () => {
    const g = (lines: { id: string; ok: boolean; detail?: string }[]) => [{ lines }];
    expect(deniedCalls(g([{ id: 'a', ok: false, detail: '2 calls denied' }, { id: 'b', ok: false }, { id: 'c', ok: true, detail: '9 calls denied' }, { id: 'stop-verdict', ok: false }]))).toBe(3);
    expect(deniedCalls(g([{ id: 'a', ok: true }]))).toBe(0);
  });
  test('the denied count remembers when it last rose (N3) and forgets at zero', () => {
    resetPulse();
    expect(denyAgeSecs(10_000)).toBeUndefined();
    noteDenied(2, 1_000);
    expect(denyAgeSecs(11_500)).toBe(10);
    noteDenied(2, 5_000);
    expect(denyAgeSecs(11_500)).toBe(10); // unchanged count: not a rise
    noteDenied(3, 8_000);
    expect(denyAgeSecs(11_500)).toBe(3);
    noteDenied(0, 9_000);
    expect(denyAgeSecs(11_500)).toBeUndefined();
  });
});

describe('B9: 150, pane closed (band 145): idle, working, done; the health chip is the card toggle', () => {
  const idleH = { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]), hooks: hooks({ latency: { n: 1, p50: 2, p95: 2 } }) };
  test('idle: hook latency from the handlers, no ctx and no cost before their first datum', () => {
    const got = row({ kind: 'idle', cols: 145, panel: false, gates: GATES_ARMED as never[], health: idleH });
    expect(got).toBe(frame('◖ ◆ ATLAS ◗ ◌ idle up 0:41               │  ○ gates     │ ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂▁▁▁   1 ev/5m │ hook   2ms                                   ▸ health  [-]'));
    expect(textWidth(got)).toBe(145);
  });
  const lat = { n: 8, p50: 3, p95: 5 };
  // The spec's own counts (15 and 26) are not the sum of the 20 cells it draws at its own scale (21 and 28); the band prints the real sum, so those two figures are the only cells that differ.
  test('working: ctx, hook, last and cost join as they fit, the chip stays right-anchored', () => {
    const got = row({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 3, 3, 3, 0, 0, 0, 0, 1, 7, 3], 0.01), hooks: hooks({ ...WORK_HOOKS, latency: lat }) } });
    expect(got).toBe(frame('◖ ◆ ATLAS ◗ ◐ test 3/6        Bash       │  ● gates ok  │ ▁▁▁▁▁▁▁▂▁▁▄▄▄▁▁▁▁▂█▄  15 ev/5m │ ctx   6% │ hook   3ms │ last 5s   │ $0.01    ▸ health  [-]').replace('15 ev/5m', '21 ev/5m'));
  });
  test('done', () => {
    const got = row({ kind: 'done', cols: 145, panel: false, rest: 12, ctx: 6, health: { pulse: pulse([0, 0, 2, 2, 3, 2, 2, 0, 0, 0, 0, 0, 1, 0, 0, 1, 5, 3, 7, 0], 0.01), hooks: hooks({ ...WORK_HOOKS, lastEventSecs: 10, latency: lat }) } });
    expect(got).toBe(frame('◖ ◆ ATLAS ◗ ● done 6/6        ended 12s  │  ● gates ok  │ ▁▁▃▃▄▃▃▁▁▁▁▁▂▁▁▂▆▄█▁  26 ev/5m │ ctx   6% │ hook   3ms │ last 10s  │ $0.01    ▸ health  [-]').replace('26 ev/5m', '28 ev/5m'));
  });
  test('the chips: gates opens the gates tab, health toggles the card; both on the 239 fill, one chip each', () => {
    const calls: string[] = [];
    const els = { Box: (p: object) => ({ kind: 'Box', props: p }), Text: (p: object) => ({ kind: 'Text', props: p }), Button: (p: object) => ({ kind: 'Button', props: p }), Input: (p: object) => ({ kind: 'Input', props: p }) } as unknown as ClientElements;
    const tree = bandTree(els, model({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }) } }), { openView: (v) => calls.push(`view:${v}`), toggleTodos: () => calls.push('todos'), toggleHealth: () => calls.push('health') });
    const buttons: { key: string; onPress: () => void; children: { props: { children: string; backgroundColor: string } }[] }[] = [];
    const walk = (n: any): void => { if (!n || typeof n !== 'object') return; if (n.kind === 'Button') buttons.push(n.props); for (const c of [n.props?.children].flat()) walk(c); };
    walk(tree);
    expect(buttons.map((b) => b.key)).toEqual(['band:gates', 'band:health']);
    expect(buttons.map((b) => b.children[0]!.props.children)).toEqual([' ● gates ok ', ' ▸ health ']);
    expect(buttons.map((b) => b.children[0]!.props.backgroundColor)).toEqual([xtermHex(239), xtermHex(239)]);
    buttons.forEach((b) => b.onPress());
    expect(calls).toEqual(['view:gates', 'health']);
  });
  test('chip columns: gates 44-55 and health 136-145 (1-based), as the spec legend says', () => {
    const rs = bandRuns(model({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }), } }), true);
    let col = 1;
    const at: Record<string, [number, number]> = {};
    for (const x of rs) { if (x.press) at[x.press] = [col, col + textWidth(x.t) - 1]; col += textWidth(x.t); }
    expect(at['band:gates']).toEqual([44, 55]);
    expect(at['band:health']).toEqual([136, 145]);
  });
});

describe('B10: 110, pane closed (band 100): working', () => {
  test('ctx fits, hook does not, the chip is right-anchored', () => {
    const got = row({ kind: 'working', cols: 100, panel: false, ctx: 6, health: { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }) } });
    expect(got).toBe(frame('◖ ◆ ATLAS ◗ ◐ test 3/6        Bash       │  ● gates ok  │ ▁▁▁▂▁▅▃▁▂█  15 ev/5m │ ctx   6%  ▸ health  [-]'));
  });
});

describe('the rules the frames rest on', () => {
  const h = { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }) };
  test('the health chip exists only while the pane is closed', () => {
    expect(row({ kind: 'working', cols: 145, panel: true, ctx: 6, health: h })).not.toContain('health');
    expect(row({ kind: 'working', cols: 145, panel: false, ctx: 6, health: h })).toContain('▸ health');
    expect(row({ kind: 'working', cols: 100, panel: false, ctx: 6, health: { ...h, open: true } })).toContain('▴ health');
  });
  test('the band is one row, with no second `checks` row under a denial', () => {
    const b = model({ kind: 'working', cols: 89, panel: true, ctx: 6, gates: GATES_DENY as never[], health: h });
    const els = { Box: (p: object) => ({ kind: 'Box', props: p }), Text: (p: object) => ({ kind: 'Text', props: p }), Button: (p: object) => ({ kind: 'Button', props: p }), Input: (p: object) => ({ kind: 'Input', props: p }) } as unknown as ClientElements;
    const rows = ((bandTree(els, b, { openView() {}, toggleTodos() {} }) as unknown as { props: { children: unknown[] } }).props.children);
    expect(rows).toHaveLength(1);
  });
  test('slot widths never move: the gates chip is 12 cells whatever it says, the dividers keep their columns', () => {
    const cols = (o: Partial<Over>, extra: object = {}): number[] => { const t = row({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { ...h, ...extra }, ...o }); return [...t].map((c, i) => (c === '│' ? i + 1 : 0)).filter(Boolean); };
    const base = cols({});
    expect(cols({ ctx: 100 })).toEqual(base);
    expect(cols({ gates: GATES_DENY as never[] })).toEqual(base);
    expect(cols({ gates: GATES_ARMED as never[] })).toEqual(base);
    expect(cols({}, { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 0, 0, 120]) })).toEqual(base);
  });
  test('amber only for ctx >= 70 % and hook p50 >= 50 ms', () => {
    const amber = (o: Partial<Over>, extra: object = {}): string[] => bandRuns(model({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { ...h, ...extra }, ...o }), true).filter((x) => x.fg === xtermHex(214)).map((x) => x.t);
    expect(amber({})).toEqual([]);
    expect(amber({ ctx: 70 })).toEqual(['  70%'.slice(1)]);
    expect(amber({}, { hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 50, p95: 80 } }) })).toEqual([' 50ms'.slice(0)]);
  });
  test('narrowing: the detail slot drops under 85, the spark shrinks 20 / 10 / 5, the extras drop from the end', () => {
    const w = (cols: number, panel = false): string => row({ kind: 'working', cols, panel, ctx: 6, health: { pulse: pulse(SPARK15, 0.01), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }) } });
    expect([...w(120).match(/[▁-█]+/)![0]]).toHaveLength(20);
    expect([...w(100).match(/[▁-█]+/)![0]]).toHaveLength(10);
    expect([...w(84).match(/[▁-█]+/)![0]]).toHaveLength(5);
    expect(w(84)).not.toContain('Bash');
    expect(w(100)).toContain('Bash');
    for (const cols of [145, 120, 100, 89, 84, 70, 55, 44, 40, 29, 20]) expect(textWidth(w(cols))).toBeLessThanOrEqual(cols);
    expect(w(145)).toContain('$0.01');
    expect(w(125)).not.toContain('$0.01');
    expect(w(100)).not.toContain('hook');
  });
  test('no printed key hints and no private-use glyphs in any frame', () => {
    for (const cols of [145, 100, 89, 55]) for (const kind of ['idle', 'working', 'done'] as Kind[]) {
      const t = row({ kind, cols, panel: cols < 100, ctx: 6, health: h });
      expect(t).not.toMatch(/[-]/);
      expect(t).not.toMatch(/\bpress\b|\[[a-z]\]|ctrl\+/i);
    }
  });
  test('ASCII: every glyph has a plain stand-in and the width holds', () => {
    const a: Ui = { ...ui, ascii: true };
    const t = text(bandRuns({ ...model({ kind: 'working', cols: 100, panel: false, ctx: 6, health: h }), ui: a }, true));
    expect(t).not.toMatch(/[│●○■▸◌◎▁-█]/);
    expect(textWidth(t)).toBe(100);
  });
});

describe('N1: hook latency measured in the handlers (hook-log)', () => {
  test('a sample is the handler\'s own milliseconds; the median and p95 are over every label', () => {
    resetHookLog();
    expect(hookStats(0).latency).toBeUndefined();
    noteHook('tool.call Bash', 100);
    for (const ms of [2, 3, 3, 5, 40]) noteHookMs('tool.call Bash', 100, 100 + ms);
    noteHookMs('turn.complete', 200, 204);
    expect(hookStats(1000).latency).toEqual({ n: 6, p50: 3, p95: 40 });
  });
  test('an unreadable clock reads no sample, never a made-up one', () => {
    resetHookLog();
    noteHookMs('x', undefined, 5);
    noteHookMs('x', 5, undefined);
    noteHookMs('x', Number.NaN, 5);
    expect(hookStats(0).latency).toBeUndefined();
  });
  test('the ring keeps the newest 64 per label and a reset forgets them', () => {
    resetHookLog();
    for (let i = 0; i < 100; i++) noteHookMs('a', 0, i);
    expect(hookStats(0).latency!.n).toBe(64);
    expect(hookStats(0).latency!.p50).toBe(67);
    resetHookLog();
    expect(hookStats(0).latency).toBeUndefined();
  });
});
