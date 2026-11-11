// Edge pins for mod/todo-panel.tsx (surviving mutants of the 553a9bce run): a one-row budget is only `+N more`, a pane of zero
// rows still keeps one, and the pane box does not shrink.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { WORLD_NOW, worldItems } from '../contracts/board-golden';
import type { Ui } from './atlas-ui';
import { boardTree, todoRows } from './todo-panel';
import type { Segment } from './runs';

const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const text = (row: Segment[]): string => row.map((s) => s.t).join('');
type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const tree = (over: Record<string, unknown>) => boardTree(els, worldItems(), { cols: 120, rows: 30, tick: 0, now: WORLD_NOW, ui: mocha, ...over }) as unknown as Node;

describe('todoRows budget', () => {
  test('a one-row slot is `+N more` alone, counting every row it left out', () => {
    const all = todoRows(worldItems(), { cols: 120, tick: 0, expanded: true, maxRows: 99, now: WORLD_NOW, ui: mocha });
    const one = todoRows(worldItems(), { cols: 120, tick: 0, expanded: true, maxRows: 1, now: WORLD_NOW, ui: mocha });
    expect(one).toHaveLength(1);
    expect(text(one[0]!).trimEnd()).toBe(`  +${all.length} more`);
  });
});

describe('boardTree budget and box', () => {
  test('rows of 0 (or less) still keep one row: `+N more`', () => {
    for (const rows of [0, -3]) {
      const kids = tree({ rows }).props.children as Node[];
      expect(kids).toHaveLength(1);
      expect((kids[0]!.props.children as Node[]).map((t) => t.props.children).join('').trimEnd()).toMatch(/^ {2}\+\d+ more$/);
    }
  });
  test('the pane box is a column that does not shrink', () => {
    const box = tree({});
    expect(box.props.flexDirection).toBe('column');
    expect(box.props.flexShrink).toBe(0);
  });
});
