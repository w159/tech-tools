// Expert round 4, slice S2: ONE band layout at every width and pane state (P2, S-1, S-2), the run time printed once (P1, S-3), the 110 chip row as the band's own second row, and the 5 Hz idle breathing (S-8).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree, type BandHandlers, type BandModel } from './band';
import { beatDue, idleLevel, idlePhase, idleRamp, IDLE_PHASES, IDLE_RAMP_256 } from './band-motion';
import { runHex, uiFromEnv, xtermHex, type Ui } from './atlas-ui';
import { busySnap, NOW } from './live_fixture';
import { durationTree } from './restyle';
import { textWidth } from './theme';
import type { Health } from './idle-health';
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

const ui: Ui = { ...uiFromEnv({}), color: 'truecolor' };
const handlers: BandHandlers = { openView() {}, toggleTodos() {}, toggleHealth() {} };
const green = (id: string) => ({ id, title: id, lines: [{ id, label: id, ok: true }] }) as any;
const GATES = ['completion', 'tripwire', 'routing', 'header'].map(green);
const PULSE: Pulse = { events: [0, 0, 0, 0, 0, 0, 1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 5, 1], ctx: [], runs: [] };
const HEALTH = { upSecs: 9, version: '17.24.0', branch: 'master', tokens: 64_000, window: 1_000_000, hooks: { total: 3, byLabel: [{ label: 'tool.call', n: 3 }], recent: [], lastEventSecs: 2, runTools: 3 }, pulse: PULSE, open: false };
const snap = (over: Record<string, unknown> = {}) => busySnap({ squad: [], activity: {}, comms: [], todos: [], todoGroups: [], counts: { done: 0, total: 0, byPhase: {} }, contextPct: 6, ...over } as never);
type Kind = 'idle' | 'working' | 'done';
const model = (kind: Kind, columns: number, panel: boolean, over: Partial<BandModel> = {}): BandModel => ({
  snapshot: kind === 'done' ? snap({ phase: 'done' }) : snap(), live: [], gates: GATES, columns, tick: 0, maxRows: 12, ui,
  health: { ...HEALTH, ...(panel ? { panel: true } : {}) },
  ...(kind === 'working' ? { working: true, workSecs: 3 } : {}),
  ...(kind === 'done' ? { ranSecs: 5, restSecs: 1 } : {}),
  ...over,
});
const first = (b: BandModel): string => rows(b)[0]!;

/** The segments the band row draws, by id, in the order they appear. */
const idsIn = (row: string): string[] => [
  ['gates', /gates ok|\d+ denied|○ gates/], ['events', /[▁-█]{4,}/], ['ctx', /ctx +\d+%/], ['health', /▸ health/],
].map(([id, re]) => ({ id: id as string, at: row.search(re as RegExp) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at).map((x) => x.id);

const ORDER = ['gates', 'events', 'ctx', 'health'];

describe('(a) the band is one row of a fixed order; the head and the cap always stay, the health chip only with the pane closed', () => {
  for (const cols of [150, 110, 100, 89, 80, 60, 55]) for (const panel of [false, true]) for (const kind of ['idle', 'working', 'done'] as Kind[]) {
    test(`${kind} at ${cols} ${panel ? 'pane open' : 'pane closed'}`, () => {
      const row = first(model(kind, cols, panel));
      expect(textWidth(row)).toBeLessThanOrEqual(cols);
      const ids = idsIn(row);
      expect(ids).toEqual(ORDER.filter((id) => ids.includes(id))); // what stays keeps the fixed order of the frame spec
      if (panel) expect(ids).not.toContain('health');
      else if (cols >= 80) expect(ids.at(-1)).toBe('health');
      expect(row).toContain('◖ ◆ ATLAS ◗ ');
      expect(row).toMatch(kind === 'idle' ? (panel && cols <= 60 ? /◌ idle (up [\d:]+ )?│/ : /◌ idle up/) : kind === 'working' ? /[◐◓◑◒] implement/ : /● done/);
    });
  }
  test('the wide band reads like the frame spec', () => {
    expect(first(model('idle', 150, false)).trimEnd()).toMatch(/^◖ ◆ ATLAS ◗ ◌ idle up 0:09 +│  ○ gates armed › │ [▁-█]{20} +12 ev\/5m │ ctx +6% │ .*▸ health$/);
    expect(first(model('working', 150, false)).trimEnd()).toMatch(/[◐◓◑◒] implement 5\/6 +│  ● gates ok › +│ [▁-█]{20} +12 ev\/5m │ ctx +6% │ .*▸ health$/);
    expect(first(model('done', 150, false)).trimEnd()).toMatch(/● done 6\/6 +ended 1s +│  ● gates ok › +│ [▁-█]{20} +12 ev\/5m │ ctx +6% .*▸ health$/); // Y1c: no `last 0s` beside `ended 1s`
  });
});

describe('(b) with the pane open the band is the same row without the health chip', () => {
  for (const kind of ['idle', 'working', 'done'] as Kind[]) for (const cols of [150, 100]) {
    test(`${kind} at ${cols}`, () => {
      const closed = first(model(kind, cols, false)).replace(/ *▸ health *$/, '');
      const open = first(model(kind, cols, true));
      expect(open).not.toContain('health');
      if (kind === 'idle') {
        // Z6: the idle band beside the open pane gives its empty detail slot to one live health figure (the context here: this health has no hook latency), the spark keeps its unit
        expect(open.trimEnd()).toMatch(/[▁-█]{3,} +\d+ ev\/5m │ ctx +6%$/);
        expect(open.trimEnd()).not.toMatch(/last \d|\$\d/);
      } else expect(closed.trimEnd()).toBe(open.trimEnd());
    });
  }
});

describe('(c) empty segments are hidden', () => {
  for (const cols of [150, 110, 80, 60, 40, 30]) for (const kind of ['idle', 'working', 'done'] as Kind[]) {
    test(`${kind} at ${cols}: no \`todo -\` and no \`no agents\` placeholder anywhere on the band`, () => {
      for (const row of rows(model(kind, cols, false))) expect(row).not.toMatch(/todo -|no agents/);
    });
  }
});

describe('(d) idle liveness: beatDue and the breathing ramp', () => {
  const rest = { working: false, shown: 'idle' as const, open: false, ended: false, flip: false };
  test('idleLive lets the beats through at rest; without it a rest beat is not due', () => {
    expect(beatDue({ ...rest, idleLive: true })).toBe(true);
    expect(beatDue({ ...rest })).toBe(false);
    expect(beatDue({ ...rest, idleLive: false })).toBe(false);
  });
  test('with the beat counter every beat is a visible step (10 Hz, round W L)', () => {
    const due = Array.from({ length: 10 }, (_, n) => beatDue({ ...rest, idleLive: true, idleBeat: n }));
    expect(due).toEqual(Array(10).fill(true));
  });
  const envOk = { TERM: 'xterm-256color' };
  const frames = (idleLive: boolean, theUi: Ui, env: Record<string, string>): { phase: number; hex?: string }[] => {
    const out: { phase: number; hex?: string }[] = [];
    for (let n = 0; n < 30; n++) if (beatDue({ ...rest, idleLive, idleBeat: n })) out.push(idleRamp(NOW + n * 100, theUi, env));
    return out;
  };
  test('3 s of 100 ms beats at idle: a 2.4 s period, 12+ distinct pill tones in truecolor; none when idleLive is false', () => {
    const f = frames(true, ui, envOk);
    expect(new Set(f.map((x) => x.phase)).size).toBe(IDLE_PHASES);
    expect(IDLE_PHASES * 100).toBe(2400);
    expect(f).toHaveLength(30);
    expect(new Set(f.map((x) => x.hex)).size).toBeGreaterThanOrEqual(12);
    expect(frames(false, ui, envOk)).toEqual([]);
  });
  test('256 colours: eight stable xterm violets, at least six distinct in one breath', () => {
    const f = frames(true, { ...ui, color: '256' }, envOk);
    const hexes = new Set(f.map((x) => x.hex));
    expect(hexes.size).toBe(8);
    expect(hexes.size).toBeGreaterThanOrEqual(6);
    expect([...hexes].sort()).toEqual(IDLE_RAMP_256.map(xtermHex).sort());
  });
  test('TERM=dumb, NO_COLOR and reduced motion give no ramp', () => {
    expect(frames(true, ui, { TERM: 'dumb' }).every((x) => x.hex === undefined)).toBe(true);
    expect(frames(true, { ...ui, color: 'none' }, envOk).every((x) => x.hex === undefined)).toBe(true);
    expect(frames(true, ui, { ATLAS_REDUCED_MOTION: '1' }).every((x) => x.hex === undefined)).toBe(true);
  });
  test('the phase is a 24-step triangle through 13 levels', () => {
    expect(Array.from({ length: IDLE_PHASES }, (_, p) => idleLevel(p))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(idlePhase(0)).toBe(0);
    expect(idlePhase(100 * IDLE_PHASES)).toBe(0);
  });
  describe('the band wears it: the idle dot and the newest spark cell only', () => {
    const penv = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
    const withEnv = <T,>(env: Record<string, string | undefined>, f: () => T): T => {
      const saved = Object.fromEntries(Object.keys(env).map((k) => [k, penv[k]]));
      for (const [k, v] of Object.entries(env)) { if (v === undefined) delete penv[k]; else penv[k] = v; }
      try { return f(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete penv[k]; else penv[k] = v; } }
    };
    const colours = (kind: Kind): { dot: Set<string | undefined>; cell: Set<string | undefined>; rest: Set<string> } => {
      const dot = new Set<string | undefined>();
      const cell = new Set<string | undefined>();
      const rest = new Set<string>();
      for (let tick = 0; tick < 30; tick += 1) {
        const texts = all(bandTree(els, model(kind, 150, false, { tick }), handlers) as unknown as Node).filter((n) => n.kind === 'Text');
        const d = texts.find((n) => textOf(n) === ' ◆ ');
        const c = texts.filter((n) => /[▁-█]$/.test(textOf(n).trimEnd()) && /[▁-█]/.test(textOf(n)));
        dot.add(d?.props.backgroundColor);
        cell.add(c.at(-1)?.props.color);
        rest.add(texts.filter((n) => /gates|ctx|up /.test(textOf(n))).map((n) => `${n.props.color}`).join('|'));
      }
      return { dot, cell, rest };
    };
    test('idle: the wordmark pill background breathes through the ramp over 3 s while the spark and the other segments hold still (round W L)', () => {
      const c = withEnv({ TERM: undefined, ATLAS_REDUCED_MOTION: undefined, NO_COLOR: undefined }, () => colours('idle'));
      expect(c.dot.size).toBeGreaterThanOrEqual(12);
      expect(c.cell.size).toBe(1);
      expect(c.rest.size).toBe(1);
    });
    test('working and done do not breathe', () => {
      withEnv({ TERM: undefined, ATLAS_REDUCED_MOTION: undefined, NO_COLOR: undefined }, () => {
        expect(colours('done').cell.size).toBe(1);
        expect(colours('working').cell.size).toBe(1);
      });
    });
    test('TERM=dumb: the idle band is still', () => {
      expect(withEnv({ TERM: 'dumb' }, () => colours('idle')).dot.size).toBe(1);
    });
  });
});

describe('(e) the run seconds appear once across the band and the closing footer', () => {
  const flat = (tree: unknown): string => { const out: string[] = []; const walk = (n: unknown): void => { if (typeof n === 'string') out.push(n); else if (n && typeof n === 'object') for (const k of (n as { children?: unknown[] }).children ?? []) walk(k); }; walk(tree); return out.join(''); };
  test('a finished 0:05 run: `done n/n` and `ended Ns` on the band, nothing on the closing footer', () => {
    const band = rows(model('done', 150, false)).join('\n');
    const s = snap({ phase: 'done', counts: { done: 1, total: 1, byPhase: {} } }) as never;
    const footer = flat(durationTree(s, { durationMs: 8000 }, { turnStart: NOW - 8000, runStart: NOW - 5000, done: 1 }, NOW, ui, 5));
    const banded = flat(durationTree(s, { durationMs: 8000 }, { turnStart: NOW - 8000, runStart: NOW - 5000, done: 0 }, NOW, ui, 5));
    for (const f of [footer, banded]) { expect(f).not.toMatch(/\d:\d\d/); expect(f).not.toContain('run '); }
    expect(band).not.toContain('0:05'); // v1 frame spec: the band says `done 6/6` and `ended 1s`; the run clock is the panel's
  });
});

describe('(f) at 110 with the pane closed the band is one row (round 2 D9: tabs live only in the panel)', () => {
  const b = model('idle', 110, false);
  test('no chip row under the band, no `last run` line', () => {
    const rs = kids(bandTree(els, b, handlers) as unknown as Node);
    expect(rs).toHaveLength(1);
    expect(all(rs[0]!).filter((n) => n.kind === 'Button').map((n) => String(n.props.key).split('#')[0]).filter((k, i, a) => a.indexOf(k) === i)).toEqual(['band:gates', 'band:health']);
    for (const r of rows(b)) expect(r).not.toMatch(/last run|last \d+s ago| events?\b|status/);
  });
  test('a run that ended adds no `last run m:ss` to the band', () => {
    const joined = rows(model('done', 110, false)).join('\n');
    expect(joined).not.toMatch(/last run/);
    expect(joined).toMatch(/done 6\/6 +ended 1s/);
  });
});

describe('(g) no pulse, no spark', () => {
  test('the events segment is omitted, never invented', () => {
    const { pulse: _p, ...noPulse } = HEALTH;
    for (const kind of ['idle', 'working', 'done'] as Kind[]) {
      const row = first({ ...model(kind, 150, false), health: noPulse });
      expect(row).not.toMatch(/[⣀-⣿▁-█]/);
      expect(row).toMatch(/gates (ok|armed)/);
      expect(row).toMatch(/ctx +6%/);
    }
  });
});
