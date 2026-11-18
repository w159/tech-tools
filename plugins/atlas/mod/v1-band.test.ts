// v1 band: the live band matches frames B1-B10 of the approved text-frame spec (critics/mock-final.md section 3), cell for cell, at 150 and 110 with the pane open (band 89 and 55) and closed (145 and 100).
// The spec draws the host's ` [-]` after the band; the band itself is `W` cells, so a frame here is the spec line without that handle. Where a frame is not reproducible it says so in its test.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandRuns, bandTree, type BandModel } from './band';
import { hostEnv, PALETTES, uiFromEnv, xtermHex, type Run, type Ui } from './atlas-ui';
import { busySnap } from './live_fixture';
import { hookStats, noteHook, noteHookMs, resetHookLog } from './host/hook-log';
import { denyAgeSecs, noteDenied, resetPulse } from './data/pulse';
import { deniedCalls } from './vocab';
import { textWidth } from './theme';
import type { Pulse } from './data/pulse';

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const NOW = 4_000_000_000_000; // a multiple of 1600 ms: tick 0 is heartbeat frame 0 and spinner frame 0
// AA2: the band is slots of one fixed width each (state 17 or 28, gates chip 16, spark 8, `peak 3 / 5s` 12, `hook p50 7ms` 14, `ctx 6%` 8); a line here is the whole band row, padded to its width.
const fill = (line: string, cols: number): string => line.padEnd(cols);

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

// B3, B5, B7 spark data: the last ten buckets that draw `▁▁▁▂▁▅▃▁▂█` (15 events) and `▁▅▆▃▁▁▂▂█▇` (26).
const SPARK15 = [0, 0, 0, 1, 0, 4, 2, 0, 1, 7];
const SPARK26 = [0, 4, 5, 2, 0, 0, 1, 1, 7, 6];
const WORK_HOOKS = { runTool: 'Bash', runTools: 6, lastEventSecs: 5 };

describe('B1: 150, pane open, idle: the heartbeat ramps ◌ ◎ ◌ ◌ and the clock rolls', () => {
  const frames = [
    '◖ ◆ ATLAS ◗ ◌ idle up 0:41    │  ○ gates armed › │ ▁▁▁▅▁▁▁▁ peak 1 / 5s  │ hook p50   —  ',
    '◖ ◆ ATLAS ◗ ◌ idle up 0:41    │  ○ gates armed › │ ▁▁▁▅▁▁▁▁ peak 1 / 5s  │ hook p50   —  ',
    '◖ ◆ ATLAS ◗ ◌ idle up 0:41    │  ○ gates armed › │ ▁▁▁▅▁▁▁▁ peak 1 / 5s  │ hook p50   —  ',
    '◖ ◆ ATLAS ◗ ◌ idle up 0:42    │  ○ gates armed › │ ▁▁▁▅▁▁▁▁ peak 1 / 5s  │ hook p50   —  ',
  ];
  frames.forEach((f, i) => {
    test(`frame ${i + 1} is the band line, 89 cells`, () => {
      const got = row({ kind: 'idle', cols: 89, panel: true, tick: i * 4, upSecs: i === 3 ? 42 : 41, gates: GATES_ARMED as never[], health: { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 0, 1, 0]), hooks: hooks() } });
      expect(got).toBe(fill(f, 89));
      expect(textWidth(got)).toBe(89);
    });
  });
  test('L: at rest only the wordmark pill breathes (its background and the caps that match it); every other run is the same in every frame', () => {
    const restore = pinMotionEnv();
    try {
    const at = (tick: number): Run[] => bandRuns(model({ kind: 'idle', cols: 89, panel: true, tick, gates: GATES_ARMED as never[], health: { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 0, 1, 0]) } }), true);
    const [a, b] = [at(0), at(6)];
    const pill = (rs: Run[]): Run => rs.find((x) => x.t === ' ◆ ')!;
    expect(pill(a).bgHex).not.toBe(pill(b).bgHex);
    const rest = (rs: Run[]): string => JSON.stringify(rs.slice(rs.findIndex((x) => x.t === '◗') + 1));
    const letters = (rs: Run[]): (string | undefined)[] => rs.slice(1, rs.findIndex((x) => x.t === '◗')).map((x) => x.bgHex);
    expect(new Set(letters(a)).size).toBe(1); // every letter of the pill wears the one breathing fill
    expect(rest(a)).toBe(rest(b));
    } finally { restore(); }
  });
  test('L: the pill background breathes between xterm 97 and the accent, 13 tones over a 2.4 s period; the caps carry the pill fill on the band fill (H)', () => {
    const restore = pinMotionEnv();
    try {
    const fills = new Set<string>();
    for (let tick = 0; tick < 24; tick++) {
      const rs = bandRuns(model({ kind: 'idle', cols: 89, panel: true, tick }), true);
      const pill = rs.find((x) => x.t === ' ◆ ')!;
      fills.add(pill.bgHex!);
      const caps = rs.filter((x) => x.t === '◖' || x.t === '◗');
      expect(caps.map((x) => x.fg)).toEqual([pill.bgHex, pill.bgHex]);
      expect(caps.map((x) => x.bgHex)).toEqual([xtermHex(235), xtermHex(235)]);
    }
    expect(fills.size).toBe(13);
    const lo = parseInt(xtermHex(97).slice(1, 3), 16);
    for (const f of fills) expect(parseInt(f.slice(1, 3), 16)).toBeGreaterThanOrEqual(lo);
    const at0 = bandRuns(model({ kind: 'idle', cols: 89, panel: true, tick: 0 }), true).find((x) => x.t === ' ◆ ')!.bgHex;
    const at24 = bandRuns(model({ kind: 'idle', cols: 89, panel: true, tick: 24 }), true).find((x) => x.t === ' ◆ ')!.bgHex;
    expect(at24).toBe(at0); // 24 beats of 100 ms: one 2.4 s breath
    } finally { restore(); }
  });
  test('the idle head glyph is the same ◌ at every width and every beat (no 1/s pulse)', () => {
    for (const cols of [55, 89, 145]) for (let tick = 0; tick < 8; tick++) expect(row({ kind: 'idle', cols, panel: true, tick })).toContain('◌ idle');
  });
  test('the idle clock is the session uptime, never the age of the last event', () => {
    expect(row({ kind: 'idle', cols: 89, panel: true, upSecs: 3725, health: { hooks: hooks({ lastEventSecs: 9 }) } })).toContain('idle up 1:02:05');
  });
});

describe('B2: 110, pane open, idle', () => {
  test('AA2: the idle uptime gives way, the state slot is 11 cells, and the gates chip and the 8-cell spark stay', () => {
    const got = row({ kind: 'idle', cols: 55, panel: true, gates: GATES_ARMED as never[], health: { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 0, 1, 0]) } });
    expect(got).toBe(fill('◖ ◆ ATLAS ◗ ◌ idle      │  ○ gates armed › │ ▁▁▁▅▁▁▁▁', 55));
    expect(textWidth(got)).toBe(55);
  });
});

describe('B3 and B4: working', () => {
  const h = { pulse: pulse(SPARK15), hooks: hooks(WORK_HOOKS) };
  test('B3 150 pane open: the spinner turns ◐ then ◓ on the shared frame; the pane says the tool, so the band has no detail', () => {
    const f1 = '◖ ◆ ATLAS ◗ ◐ test 3/6        │  ● gates ok ›    │ ▁▁▁▂▁▁█▁ peak 7 / 5s  │ hook p50   —  ';
    const f2 = f1.replace('◐', '◓');
    expect(row({ kind: 'working', cols: 89, panel: true, tick: 0, ctx: 6, health: h })).toBe(fill(f1, 89));
    expect(row({ kind: 'working', cols: 89, panel: true, tick: 1, ctx: 6, health: h })).toBe(fill(f2, 89));
  });
  test('B4 110 pane open', () => {
    expect(row({ kind: 'working', cols: 55, panel: true, ctx: 6, health: h })).toBe(fill('◖ ◆ ATLAS ◗ ◐ test 3/6  │  ● gates ok ›    │ ▁▁▁▂▁▁█▁', 55));
  });
  test('the head names the contract phase out of six, not the five-step rail', () => {
    expect(row({ kind: 'working', cols: 89, panel: true, phase: 'implement', health: h })).toContain('◐ implement 5/6');
    expect(row({ kind: 'working', cols: 89, panel: true, phase: 'verify', health: h })).toContain('◐ verify 6/6');
  });
  test('an mcp tool reads as its bare name, closed up after the head, and a long one is cut inside the 28-cell state slot', () => {
    const got = row({ kind: 'working', cols: 145, panel: false, health: { ...h, hooks: hooks({ ...WORK_HOOKS, runTool: 'mcp__lean-ctx__ctx_compose_all_things' }) } });
    expect(got.slice(12, 40)).toBe('◐ test 3/6 · ctx_compose_al…');
    expect(textWidth(got)).toBe(145);
  });
});

describe('B5 and B6: done', () => {
  const h = { pulse: pulse(SPARK26), hooks: hooks({ ...WORK_HOOKS, lastEventSecs: 10 }) };
  test('B5 150 pane open: `ended Ns` ticks each second', () => {
    expect(row({ kind: 'done', cols: 145, panel: false, rest: 12, ctx: 6, health: h }).slice(0, 41)).toBe('◖ ◆ ATLAS ◗ ● done 6/6 · ended 12s       ');
    expect(row({ kind: 'done', cols: 145, panel: false, rest: 13, ctx: 6, health: h }).slice(0, 41)).toBe('◖ ◆ ATLAS ◗ ● done 6/6 · ended 13s       ');
  });
  test('B5 150 pane open: no detail beside the pane, the figures take its room', () => {
    expect(row({ kind: 'done', cols: 89, panel: true, rest: 12, ctx: 6, health: h })).toBe(fill('◖ ◆ ATLAS ◗ ● done 6/6        │  ● gates ok ›    │ ▂▁▁█▁▁▇▁ peak 7 / 5s  │ hook p50   —  ', 89));
  });
  test('B6 110 pane open', () => {
    expect(row({ kind: 'done', cols: 55, panel: true, ctx: 6, health: h })).toBe(fill('◖ ◆ ATLAS ◗ ● done 6/6  │  ● gates ok ›    │ ▂▁▁█▁▁▇▁', 55));
  });
  test('only the done glyph is ok green', () => {
    const rs = bandRuns(model({ kind: 'done', cols: 89, panel: true, ctx: 6, health: h }), true);
    const greens = rs.filter((x) => x.fg === xtermHex(78));
    expect(greens.map((x) => x.t.trim())).toEqual(['●', '●']); // the done glyph and the gates dot (the panel's green)
    expect(rs.find((x) => x.t === '●')!.fg).toBe(xtermHex(78));
  });
  test('the head returns to idle with the session uptime after 60 s', () => {
    expect(row({ kind: 'done', cols: 145, panel: false, rest: 59, health: h })).toContain('● done 6/6 · ended 59s');
    const idle = row({ kind: 'idle', cols: 89, panel: true, upSecs: 125, health: h });
    expect(idle).toContain('idle up 2:05');
    expect(idle).not.toContain('ended');
  });
});

describe('B7 and B8: gate denial', () => {
  const h = { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, runTool: 'Grep' }) };
  test('B7 150 pane open: `■ 2 denied` counts denied calls, not failing checks', () => {
    expect(row({ kind: 'working', cols: 89, panel: true, ctx: 6, gates: GATES_DENY as never[], health: h })).toBe(fill('◖ ◆ ATLAS ◗ ◐ test 3/6        │  ■ 2 denied ›    │ ▁▁▁▂▁▁█▁ peak 7 / 5s  │ hook p50   —  ', 89));
  });
  test('B8 110 pane open', () => {
    expect(row({ kind: 'working', cols: 55, panel: true, ctx: 6, gates: GATES_DENY as never[], health: h })).toBe(fill('◖ ◆ ATLAS ◗ ◐ test 3/6  │  ■ 2 denied ›    │ ▁▁▁▂▁▁█▁', 55));
  });
  test('the denial chip is an alert chip (bg 52, fg 210) while the run works', () => {
    const rs = bandRuns(model({ kind: 'working', cols: 89, panel: true, ctx: 6, gates: GATES_DENY as never[], health: h }), true);
    const chip = rs.filter((x) => x.press);
    expect(chip.map((x) => x.t).join('')).toBe(' ■ 2 denied ›   ');
    expect(chip[0]!.bgHex).toBe(xtermHex(52));
    expect(chip[0]!.fg).toBe(xtermHex(210));
  });
  test('round W G: a denial stays a red alert chip for 5 minutes after it rose, then the chip is neutral with the ■ and the words amber', () => {
    const at = (age: number): Run[] => bandRuns(model({ kind: 'done', cols: 89, panel: true, gates: GATES_DENY as never[], health: { ...h, denyAgeSecs: age } }), true).filter((x) => x.press);
    for (const age of [59, 61, 299]) {
      const chip = at(age);
      expect(chip.map((x) => x.t).join('')).toBe(' ■ 2 denied ›   ');
      expect(new Set(chip.map((x) => x.bgHex))).toEqual(new Set([xtermHex(52)]));
    }
    const old = at(301);
    expect(old.map((x) => x.t).join('')).toBe(' ■ 2 denied ›   ');
    expect(new Set(old.map((x) => x.bgHex))).toEqual(new Set([xtermHex(239)]));
    expect(new Set(old.map((x) => x.fg))).toEqual(new Set([xtermHex(214)])); // the band's amber
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
  test('idle: hook latency from the handlers, the ctx slot reads a dim dash before its first datum', () => {
    const got = row({ kind: 'idle', cols: 145, panel: false, gates: GATES_ARMED as never[], health: idleH });
    expect(got).toBe(fill('◖ ◆ ATLAS ◗ ◌ idle up 0:41               │  ○ gates armed › │ ▁▁▁▁▁▁▁▁ peak 1 / 5s  │ hook p50   2ms │ ctx   —                          ▸ health ', 145));
    expect(textWidth(got)).toBe(145);
  });
  const lat = { n: 8, p50: 3, p95: 5 };
  // The spec's own counts (15 and 26) are not the sum of the 20 cells it draws at its own scale (21 and 28); the band prints the real sum, so those two figures are the only cells that differ.
  test('working: hook and ctx fill their slots, the detail closes up after the head, the chip stays right-anchored', () => {
    const got = row({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 3, 3, 3, 0, 0, 0, 0, 1, 7, 3], 0.01), hooks: hooks({ ...WORK_HOOKS, latency: lat }) } });
    expect(got).toBe(fill('◖ ◆ ATLAS ◗ ◐ test 3/6 · Bash            │  ● gates ok ›    │ ▂▁▁█▁▁▄▁ peak 7 / 5s  │ hook p50   3ms │ ctx   6%                         ▸ health ', 145));
  });
  test('done', () => {
    const got = row({ kind: 'done', cols: 145, panel: false, rest: 12, ctx: 6, health: { pulse: pulse([0, 0, 2, 2, 3, 2, 2, 0, 0, 0, 0, 0, 1, 0, 0, 1, 5, 3, 7, 0], 0.01), hooks: hooks({ ...WORK_HOOKS, lastEventSecs: 10, latency: lat }) } });
    expect(got).toBe(fill('◖ ◆ ATLAS ◗ ● done 6/6 · ended 12s       │  ● gates ok ›    │ ▄▁▁█▁▁▁▁ peak 7 / 5s  │ hook p50   3ms │ ctx   6%                         ▸ health ', 145)); // Y1c: one age per state
  });
  test('the chips: gates opens the gates tab, health toggles the card; both on the 239 fill, one chip each', () => {
    const calls: string[] = [];
    const els = { Box: (p: object) => ({ kind: 'Box', props: p }), Text: (p: object) => ({ kind: 'Text', props: p }), Button: (p: object) => ({ kind: 'Button', props: p }), Input: (p: object) => ({ kind: 'Input', props: p }) } as unknown as ClientElements;
    const tree = bandTree(els, model({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }) } }), { openView: (v) => calls.push(`view:${v}`), toggleTodos: () => calls.push('todos'), toggleHealth: () => calls.push('health') });
    const buttons: { key: string; onPress: () => void; children: { props: { children: string; backgroundColor: string } }[] }[] = [];
    const walk = (n: any): void => { if (!n || typeof n !== 'object') return; if (n.kind === 'Button') buttons.push(n.props); for (const c of [n.props?.children].flat()) walk(c); };
    walk(tree);
    // the gates chip is two pieces (the dot in the panel's own colour, then the words), health one: every piece is one Button, all on the 239 fill
    expect(buttons.map((b) => b.key)).toEqual(['band:gates#0', 'band:gates#1', 'band:health']);
    expect(buttons.map((b) => b.children[0]!.props.children)).toEqual([' ● ', 'gates ok ›   ', ' ▸ health ']);
    expect(buttons.map((b) => b.children[0]!.props.backgroundColor)).toEqual([xtermHex(239), xtermHex(239), xtermHex(239)]);
    buttons.forEach((b) => b.onPress());
    expect(calls).toEqual(['view:gates', 'view:gates', 'health']);
  });
  test('chip columns: gates 44-55 and health 136-145 (1-based), as the spec legend says', () => {
    const rs = bandRuns(model({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }), } }), true);
    let col = 1;
    const at: Record<string, [number, number]> = {};
    for (const x of rs) { if (x.press) at[x.press] = [col, col + textWidth(x.t) - 1]; col += textWidth(x.t); }
    expect([at['band:gates#0']![0], at['band:gates#1']![1]]).toEqual([44, 59]); // the 16-cell gates chip (round W F/G): two pieces, one chip
    expect(at['band:health']).toEqual([136, 145]);
  });
});

describe('B10: 110, pane closed (band 100): working', () => {
  test('AA2: hook fits, ctx is shed first, the chip is right-anchored', () => {
    const got = row({ kind: 'working', cols: 100, panel: false, ctx: 6, health: { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }) } });
    expect(got).toBe(fill('◖ ◆ ATLAS ◗ ◐ test 3/6        │  ● gates ok ›    │ ▁▁▁▂▁▁█▁ peak 7 / 5s  │ hook p50   3ms  ▸ health ', 100));
  });
});

describe('the rules the frames rest on', () => {
  const h = { pulse: pulse(SPARK15), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }) };
  test('the health chip exists only while the pane is closed', () => {
    expect(row({ kind: 'working', cols: 145, panel: true, ctx: 6, health: h })).not.toContain('health');
    expect(row({ kind: 'working', cols: 145, panel: false, ctx: 6, health: h })).toContain('▸ health');
    expect(row({ kind: 'working', cols: 100, panel: false, ctx: 6, health: { ...h, open: true } })).toContain('▾ health');
  });
  test('the band is one row, with no second `checks` row under a denial', () => {
    const b = model({ kind: 'working', cols: 89, panel: true, ctx: 6, gates: GATES_DENY as never[], health: h });
    const els = { Box: (p: object) => ({ kind: 'Box', props: p }), Text: (p: object) => ({ kind: 'Text', props: p }), Button: (p: object) => ({ kind: 'Button', props: p }), Input: (p: object) => ({ kind: 'Input', props: p }) } as unknown as ClientElements;
    const rows = ((bandTree(els, b, { openView() {}, toggleTodos() {} }) as unknown as { props: { children: unknown[] } }).props.children);
    expect(rows).toHaveLength(1);
  });
  test('AA2: slot widths never move: the gates chip is 16 cells whatever it says, the dividers keep their columns', () => {
    const cols = (o: Partial<Over>, extra: object = {}): number[] => { const t = row({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { ...h, ...extra }, ...o }); return [...t].map((c, i) => (c === '│' ? i + 1 : 0)).filter(Boolean); };
    const base = cols({});
    expect(cols({ ctx: 100 })).toEqual(base);
    expect(cols({ gates: GATES_DENY as never[] })).toEqual(base);
    expect(cols({ gates: GATES_ARMED as never[] })).toEqual(base);
    expect(cols({}, { pulse: pulse([0, 0, 0, 0, 0, 0, 0, 0, 0, 120]) })).toEqual(base);
    expect(cols({ kind: 'idle' } as never)).toEqual(base);
    expect(cols({ kind: 'done' } as never)).toEqual(base);
  });
  test('amber only for ctx >= 70 % and a hook p50 over 100 ms (Z3: the latency thresholds, red over 500)', () => {
    const amber = (o: Partial<Over>, extra: object = {}): string[] => bandRuns(model({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { ...h, ...extra }, ...o }), true).filter((x) => x.fg === xtermHex(214)).map((x) => x.t);
    expect(amber({})).toEqual([]);
    expect(amber({ ctx: 70 })).toEqual(['  70%'.slice(1)]);
    expect(amber({}, { hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 50, p95: 80 } }) })).toEqual([]);
    expect(amber({}, { hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 120, p95: 180 } }) })).toEqual(['120ms']);
    const red = bandRuns(model({ kind: 'working', cols: 145, panel: false, ctx: 6, health: { ...h, hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 600, p95: 700 } }) } }), true).filter((x) => x.fg === xtermHex(203)).map((x) => x.t);
    expect(red).toEqual(['600ms']);
  });
  test('AA2: narrowing: the spark is always 8 cells, the detail drops under 121, ctx then hook are shed below 110, nothing overflows', () => {
    const w = (cols: number, panel = false): string => row({ kind: 'working', cols, panel, ctx: 6, health: { pulse: pulse(SPARK15, 0.01), hooks: hooks({ ...WORK_HOOKS, latency: { n: 3, p50: 3, p95: 4 } }) } });
    for (const cols of [145, 121, 120, 110, 100, 89, 70]) expect([...w(cols).match(/[▁-█]+/)![0]]).toHaveLength(8);
    expect(w(121)).toContain('Bash');
    expect(w(120)).not.toContain('Bash');
    for (const cols of [145, 121, 120, 110]) { expect(w(cols)).toContain('hook p50'); expect(w(cols)).toContain('ctx'); }
    expect(w(100)).toContain('hook p50');
    expect(w(100)).not.toContain('ctx');
    expect(w(89)).not.toContain('hook');
    for (const cols of [145, 120, 100, 89, 84, 70, 55, 44, 40, 29, 20]) expect(textWidth(w(cols))).toBeLessThanOrEqual(cols);
    expect(w(145)).not.toContain('$0.01');
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
