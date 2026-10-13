// routeRows and gateRows over a fake element table: rail never truncates, rows fit, blocked items pause, one gate row per group.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap } from '../live_fixture';
import { textWidth } from '../theme';
import { gateRows } from './sidebar-gates';
import { routeRows } from './sidebar-route';
import type { GateGroup, SidebarHandlers, SidebarModel } from './sidebar-types';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));
const on = { toggle() {}, copy() {} } as unknown as SidebarHandlers;

const gates: GateGroup[] = [
  { id: 'completion', title: 'completion', lines: [
    { id: 'c1', label: 'verifier verdict', ok: false, fix: 'dispatch verifier' },
    { id: 'c2', label: 'docs', ok: false, fix: 'dispatch docs-curator' },
  ] },
  { id: 'header', title: 'header', lines: [{ id: 'h1', label: 'first line', ok: true, detail: 'matches ^# atlas:' }] },
];
const model = (columns: number, expanded: string | null = null): SidebarModel =>
  ({ snapshot: busySnap({ phase: 'implement' }), gates, ui: { recipient: null, expanded, draft: '', view: 'route' }, columns, rows: 40 });
const text = (r: unknown): string => textOf(r as Node);
const rows = (inner: number, expanded: string | null = null) => routeRows(els, model(inner, expanded), on, inner).map(text);

describe('routeRows', () => {
  for (const inner of [30, 44, 80]) {
    test(`inner ${inner}: rail has no ellipsis, every row fits`, () => {
      const out = rows(inner);
      expect(out[0]).not.toContain('…');
      expect(out[0]).toContain('◉');
      for (const r of out) expect(textWidth(r)).toBeLessThanOrEqual(inner);
    });
  }
  test('wide rail names phases, narrow rail is glyph+state', () => {
    expect(rows(80)[0]).toContain('research ✓');
    expect(rows(30)[0]).not.toContain('research');
  });
  test('blocked owner shows pause; done hidden below 80 and shown at 80', () => {
    expect(rows(44).join('\n')).toContain('⏸ edit auth middleware · impl-auth (blocked');
    expect(rows(44).join('\n')).not.toContain('old refactor');
    expect(rows(80).join('\n')).toContain('old refactor');
  });
});

describe('gateRows', () => {
  test('one row per group, line rows only when expanded', () => {
    const out = gateRows(els, model(44), on, 44).map(text);
    expect(out).toHaveLength(gates.length);
    expect(out[0]).toBe('✗ completion  2 open  dispatch verifier');
    expect(out[1]).toBe('✓ header  ok  matches ^# atlas:');
    expect(gateRows(els, model(44, 'group:completion'), on, 44)).toHaveLength(gates.length + 2);
  });
});
