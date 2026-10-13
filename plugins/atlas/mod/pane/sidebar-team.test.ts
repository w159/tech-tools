// Team table tests over a fake element table (same pattern as sidebar.test.ts).
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { busySnap, NOW } from '../live_fixture';
import { textWidth } from '../theme';
import type { SidebarHandlers, SidebarModel } from './sidebar-types';
import { teamRows } from './sidebar-team';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const kids = (n: Node): Node[] => {
  const c = n.props.children;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null);
};
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : kids(n).map(textOf).join(''));

const calls: string[] = [];
const on: SidebarHandlers = {
  selectRecipient: (n: string) => calls.push(`select:${n}`), toggle: (k: string) => calls.push(`toggle:${k}`), draftChange: () => {}, send: () => {},
  copy: () => {}, focus: () => {}, expand: () => {}, setView: () => {},
} as unknown as SidebarHandlers;
const model = (over: Partial<SidebarModel['ui']> = {}): SidebarModel => ({
  snapshot: { ...busySnap(), now: NOW }, gates: [], ui: { recipient: null, expanded: null, draft: '', ...over }, columns: 80, rows: 40, tick: 3,
} as SidebarModel);
const rows = (inner: number, over?: Partial<SidebarModel['ui']>) => teamRows(els, model(over), on, inner) as unknown as Node[];

describe('team table', () => {
  for (const inner of [44, 80, 120]) {
    test(`rows fit ${inner} cells, blocked then failed then working, lead row last`, () => {
      const r = rows(inner);
      const t = r.filter((n) => n.kind !== 'Input').map(textOf);
      for (const line of t) expect(textWidth(line)).toBeLessThanOrEqual(inner);
      const at = (s: string) => t.findIndex((l) => l.includes(s));
      expect(at('impl-auth')).toBeLessThan(at('runner-1'));
      expect(at('runner-1')).toBeLessThan(at('explorer-1'));
      expect(t[at('runner-1')]).toContain('✗');
      expect(t.at(-1)).toContain('running 1 · 0 done · 1 blocked');
      expect(t.join('\n')).not.toContain('more');
    });
  }
  test('header only from 50 cells', () => {
    expect(textOf(rows(44)[0]!)).not.toContain('agent');
    expect(textOf(rows(80)[0]!)).toMatch(/^st\s+agent\s+role\s+now\s+age\s+tools\s+last line/);
    expect(textOf(rows(60)[0]!)).not.toContain('role');
  });
  test('Enter toggles a 2-line detail and selects the worker', () => {
    const base = rows(80).length;
    expect(rows(80, { expanded: 'worker:runner-1' }).length).toBe(base + 2);
    const b = rows(80).find((n) => n.props.key === 'worker:runner-1')!;
    b.props.onPress();
    expect(calls).toEqual(['select:runner-1', 'toggle:worker:runner-1']);
  });
  test('message input keeps the recipient', () => {
    const i = rows(80, { recipient: 'runner-1' }).find((n) => n.kind === 'Input')!;
    expect(i.props.label).toBe("▸ to runner-1");
  });
});
