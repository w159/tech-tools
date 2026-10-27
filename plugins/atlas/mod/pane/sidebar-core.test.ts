// The core view (g): four section heads, the REFUTED verdict row, a press toggles it, the expanded row shows its evidence.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { coreFixture, coreMatrix } from '../../contracts/core-fixture';
import { coreModel } from '../data/core';
import { busySnap } from '../live_fixture';
import { textWidth } from '../theme';
import { coreRows } from './sidebar-core';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const all = (n: Node): Node[] => [n, ...kids(n).flatMap(all)];

const pressed: string[] = [];
const on = { toggle: (k: string) => pressed.push(k), copy() {} } as unknown as SidebarHandlers;
const core = coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 0 });
const model = (expanded: string | null = null, withCore = true): SidebarModel => ({
  snapshot: busySnap({ phase: 'implement' }), gates: [], core: withCore ? core : null,
  ui: { recipient: null, expanded, draft: '', view: 'gates' }, columns: 80, rows: 40,
});
const rows = (m: SidebarModel, inner = 70): Node[] => coreRows(els, m, on, inner) as unknown as Node[];

describe('core view', () => {
  test('all four section heads', () => {
    const out = rows(model()).map(textOf).join('\n');
    for (const h of ['CONTRACT', 'VERDICTS', 'OFFLOAD', 'ROUTE']) expect(out).toContain(h);
  });
  test('the rejected verdict row reads REFUTED, the verified one verified', () => {
    const out = rows(model()).map(textOf);
    expect(out.find((r) => r.includes('mean-iterable'))).toContain('REFUTED');
    expect(out.find((r) => r.includes('mean-fix'))).toContain('verified');
  });
  test('pressing a verdict row toggles its key; expanded it shows the evidence', () => {
    const button = rows(model()).find((r) => r.kind === 'Button' && textOf(r).includes('mean-iterable'))!;
    button.props.onPress();
    expect(pressed).toEqual(['core:v:mean-iterable']);
    const open = rows(model('core:v:mean-iterable')).map(textOf).join('\n');
    expect(open).toContain('evidence:');
    expect(open).toContain('TypeError: object of type');
    expect(rows(model()).map(textOf).join('\n')).not.toContain('evidence:');
  });
  test('every row fits the inner width', () => {
    for (const inner of [40, 56, 70]) for (const r of rows(model('core:v:mean-iterable'), inner)) expect(textWidth(textOf(r))).toBeLessThanOrEqual(inner);
  });
  test('without core data the view says so', () => {
    expect(rows(model(null, false)).map(textOf).join('\n')).toContain('no verdicts, workers or gates yet');
    expect(all(rows(model(null, false))[0]!).length).toBeGreaterThan(0);
  });
});
