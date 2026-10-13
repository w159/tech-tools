// Native band: one borderless row, three width tiers, live workers with a spinner, idle without one.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree } from './band';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import { spin, textWidth } from './theme';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const line = (n: Node): string => (n.props.children as Node[]).map((t) => t.props.children).join('');
const BRAILLE = /[\u2800-\u28ff]/;
const gate = { id: 'completion' as const, title: 'Gates', lines: [{ ok: false, text: 'x' }] } as any;

const row = (columns: number, over: Record<string, unknown> = {}) => {
  const snapshot = busySnap();
  return line(bandTree(els, { snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns, tick: 3, ...over }) as unknown as Node);
};

describe('bandTree', () => {
  test('full tier: phase, meter, workers with ages, hint', () => {
    const t = row(120, { gates: [gate] });
    expect(t).toMatch(/implement 1\/3 /);
    expect(t).toContain('explorer-1 Grep 42s');
    expect(t).toContain(' ATLAS ⚒ implement');
    expect(t).toContain('✗ runner-1');
    expect(t).toContain('awaits');
    expect(t).toContain('✗1 gate');
    expect(t).toContain('▸ /atlas-cc');
  });
  test('mid tier drops hint and ages, keeps failures', () => {
    const t = row(80);
    expect(t).toContain('✗ runner-1');
    expect(t).not.toContain('/atlas-cc');
    expect(t).not.toContain('Grep');
  });
  test('narrow tier is phase and counts only', () => {
    const t = row(44, { gates: [gate] });
    expect(t).toContain('implement 1/3');
    expect(t).toContain('2 working');
    expect(t).toContain('✗1');
    expect(t).not.toContain('explorer-1');
  });
  test('never wider than columns at any tier', () => {
    for (const columns of [120, 100, 99, 80, 60, 59, 44, 20, 10]) {
      expect(textWidth(row(columns, { gates: [gate] }))).toBeLessThanOrEqual(columns);
    }
  });
  test('idle shows no spinner and counts open gates', () => {
    const snapshot = busySnap({ squad: [], activity: {} });
    const t = line(bandTree(els, { snapshot, live: [], gates: [], columns: 120, tick: 3 }) as unknown as Node);
    expect(t).toMatch(/^ ATLAS ⚑ idle · implement \d+\/\d+ · 0 open$/);
    expect(t).not.toMatch(BRAILLE);
  });
  test('worker age counts from startedAt, not the current tool', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, since: NOW - 2_000, startedAt: NOW - 125_000 };
    expect(line(bandTree(els, { snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns: 120, tick: 3 }) as unknown as Node)).toContain('explorer-1 Grep 2m');
  });
  test('idle after a finished turn never prints a stale done phase; open gates read blocked; parked is idle', () => {
    const snapshot = busySnap({ squad: [{ name: 'p', persona: 'explorer', state: 'parked', source: 'task' }], activity: {}, phase: 'done' as never });
    const idle = (gates: unknown[]) => line(bandTree(els, { snapshot, live: liveWorkers(snapshot, NOW), gates: gates as never, columns: 120, tick: 3 }) as unknown as Node);
    expect(idle([])).toMatch(/^ ATLAS ⚑ idle/);
    expect(idle([])).not.toContain('done');
    expect(idle([gate])).toMatch(/^ ATLAS ⚑ blocked/);
  });
  test('working worker carries a spinner frame', () => {
    expect(row(120)).toMatch(BRAILLE);
  });
  test('at most 3 named, the rest fold to +N', () => {
    const snapshot = busySnap();
    const w = liveWorkers(snapshot, NOW);
    const live = [...w, { ...w[0]!, name: 'extra-1' }];
    expect(line(bandTree(els, { snapshot, live, gates: [], columns: 120, tick: 0 }) as unknown as Node)).toContain('+1');
  });
  test('brand pill at MID and up, absent below; full tier shows the tool target', () => {
    const snapshot = busySnap();
    snapshot.activity['explorer-1'] = { ...snapshot.activity['explorer-1']!, tool: 'Edit', target: 'band.tsx' } as never;
    const at = (columns: number) => row(columns, { snapshot, live: liveWorkers(snapshot, NOW) });
    expect(at(120)).toContain(' ATLAS ');
    expect(at(120)).toContain('Edit band.tsx');
    expect(at(80)).toContain(' ATLAS ');
    expect(at(70)).not.toContain('band.tsx');
    expect(at(59)).not.toContain('ATLAS');
  });
  test('phase frames: implement cycles single-width frames and wraps', () => {
    const f = Array.from({ length: 8 }, (_, i) => spin(i, 'implement'));
    expect(f.every((c) => textWidth(c) === 1)).toBe(true);
    expect(f[6]).toBe(f[0]);
    expect(f[0]).not.toBe(f[1]);
    expect(spin(2, 'unknown')).toBe(spin(2));
  });
  test('phase frames differ between whole-second samples at the 250 ms tick', () => {
    for (const phase of ['research', 'theory', 'test', 'implement', 'verify']) {
      const seen = new Set([0, 8, 16, 24].map((tick) => spin(tick, phase))); // 2 s apart
      expect(seen.size).toBeGreaterThan(2);
      expect(spin(4, phase)).not.toBe(spin(0, phase)); // 1 s apart
    }
  });
  test('no border', () => {
    const snapshot = busySnap();
    expect((bandTree(els, { snapshot, live: [], gates: [], columns: 120, tick: 0 }) as unknown as Node).props.borderStyle).toBeUndefined();
  });
});
