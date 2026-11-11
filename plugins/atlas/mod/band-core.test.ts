// The Atlas core row in the band: idle only, directly under the band, inside maxRows. A running band spends its
// rows on workers (spec: docs/specs/2026-11-10_atlas-terminal-ui.md, Core (idle)).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { coreGolden } from '../contracts/core-golden';
import { bandTree } from './band';
import { coreModel } from './data/core';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => (t.kind === 'Text' ? String(t.props.children ?? '') : '')).join('');
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });

const rowsOf = (columns: number, maxRows: number, idle: boolean, withCore = true): string[] => {
  const snapshot = idle ? busySnap({ squad: [], activity: {}, comms: [] }) : busySnap();
  const node = bandTree(els, { snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns, tick: 3, maxRows, core: withCore ? core : null }) as unknown as Node;
  return (node.props.children as Node[]).map(text);
};

describe('band core row', () => {
  test('idle: the core row sits directly under the band, with muted labels and plain figures', () => {
    for (const columns of [120, 160]) {
      const rows = rowsOf(columns, 12, true);
      expect(rows[0]).toContain('implement');
      expect(rows[1]).toContain('contract  ');
      expect(rows[1]).toContain('verdicts  ');
      expect(rows.filter((r) => r.includes('contract  '))).toHaveLength(1);
    }
  });
  test('idle at 120 columns prints the shared core golden', () => {
    expect(rowsOf(120, 12, true)[1]!.trimEnd()).toBe(coreGolden[120]);
    expect(rowsOf(160, 12, true)[1]!.trimEnd()).toBe(coreGolden[160]);
  });
  test('a running band shows no core row: its rows go to workers', () => {
    for (const columns of [80, 120, 160]) expect(rowsOf(columns, 12, false).some((r) => r.includes('contract  '))).toBe(false);
  });
  test('never more rows than maxRows', () => {
    for (const idle of [false, true])
      for (const columns of [80, 100, 120, 160]) for (let maxRows = 1; maxRows <= 14; maxRows++) {
        expect(rowsOf(columns, maxRows, idle).length).toBeLessThanOrEqual(maxRows);
      }
  });
  test('idle: no core, no extra row', () => {
    const without = rowsOf(160, 12, true, false);
    expect(without.some((r) => r.includes('contract  '))).toBe(false);
    expect(rowsOf(160, 12, true)).toHaveLength(without.length + 1);
  });
  test('idle: the core row waits for room (the band, then core at 2 rows)', () => {
    expect(rowsOf(160, 1, true).some((r) => r.includes('contract  '))).toBe(false);
    expect(rowsOf(160, 2, true).some((r) => r.includes('contract  '))).toBe(true);
  });
  test('narrow bands (under 80 columns) show no core row', () => {
    expect(rowsOf(70, 12, true).some((r) => r.includes('contract  '))).toBe(false);
  });
});
