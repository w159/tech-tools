// The Atlas core row in the band: directly under the phase rail, in the idle and the full layout, inside maxRows.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { coreFixture, coreMatrix } from '../contracts/core-fixture';
import { bandTree } from './band';
import { coreModel } from './data/core';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const text = (row: Node): string => (row.props.children as Node[]).map((t) => (t.kind === 'Text' ? String(t.props.children ?? '') : '')).join('');
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 0 });

const rowsOf = (columns: number, maxRows: number, idle: boolean, withCore = true): string[] => {
  const snapshot = idle ? busySnap({ squad: [], activity: {}, comms: [] }) : busySnap();
  const node = bandTree(els, { snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns, tick: 3, maxRows, core: withCore ? core : null }) as unknown as Node;
  return (node.props.children as Node[]).map(text);
};

describe('band core row', () => {
  for (const idle of [false, true]) {
    const layout = idle ? 'idle' : 'full';
    test(`${layout}: the core row sits directly under the rail`, () => {
      for (const columns of [120, 160]) {
        const rows = rowsOf(columns, 12, idle);
        expect(rows[1]).toContain('IMPLEMENT');
        expect(rows[2]).toContain('CONTRACT');
        expect(rows[2]).toContain('VERDICT');
        expect(rows.filter((r) => r.includes('CONTRACT'))).toHaveLength(1);
      }
    });
    test(`${layout}: never more rows than maxRows`, () => {
      for (const columns of [80, 100, 120, 160]) for (let maxRows = 1; maxRows <= 14; maxRows++) {
        expect(rowsOf(columns, maxRows, idle).length).toBeLessThanOrEqual(maxRows);
      }
    });
    test(`${layout}: no core, no extra row`, () => {
      const without = rowsOf(160, 12, idle, false);
      expect(without.some((r) => r.includes('CONTRACT'))).toBe(false);
      expect(rowsOf(160, 12, idle)).toHaveLength(without.length + 1);
    });
  }

  test('full: a lane survives a tight budget', () => {
    const rows = rowsOf(160, 5, false);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toContain('CONTRACT');
    expect(rows[3]).toMatch(/WAIT|RUN|THINK|START/);
  });
  test('full: the core row waits for room (4 rows)', () => {
    expect(rowsOf(160, 3, false).some((r) => r.includes('CONTRACT'))).toBe(false);
    expect(rowsOf(160, 4, false).some((r) => r.includes('CONTRACT'))).toBe(true);
  });
  test('narrow bands (under 80 columns) show no core row', () => {
    expect(rowsOf(70, 12, false).some((r) => r.includes('CONTRACT'))).toBe(false);
  });
});
