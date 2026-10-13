// Native band: one borderless row, three width tiers, live workers with a spinner, idle without one.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { bandTree } from './band';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import { textWidth } from './theme';

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
    expect(t).toContain('✗ runner-1');
    expect(t).toContain('awaits');
    expect(t).toContain('✗1 gate');
    expect(t).toContain('▸ /atlas-cc');
  });
  test('mid tier drops hint and ages, keeps failures', () => {
    const t = row(80);
    expect(t).toContain('✗ runner-1');
    expect(t).not.toContain('/atlas-cc');
    expect(t).not.toContain('42s');
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
    expect(t).toMatch(/^⚑ idle · implement \d+\/\d+ · 0 open$/);
    expect(t).not.toMatch(BRAILLE);
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
  test('no border', () => {
    const snapshot = busySnap();
    expect((bandTree(els, { snapshot, live: [], gates: [], columns: 120, tick: 0 }) as unknown as Node).props.borderStyle).toBeUndefined();
  });
});
