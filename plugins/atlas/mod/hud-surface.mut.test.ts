// Mutation-kill tests for hud-surface.ts (seed 1105 survivors): the narrow tier spends every cell after its four-cell head on the label.
import { describe, expect, test } from 'claude-code/testing';
import type { Ui } from './atlas-ui';
import { todoRows, type TodoRow } from './hud-surface';

const ui: Ui = { theme: 'mocha', ascii: true, color: 'truecolor' };

describe('todoRows at the min tier', () => {
  test('a long label fills exactly the width', () => {
    const rows: TodoRow[] = [{ label: 'x'.repeat(100), state: 'running', detail: '', focus: false }];
    const out = todoRows(rows, { cols: 70, ui }, { spacers: false, extras: false });
    const line = out.find((r) => r.some((x) => x.t.startsWith('xxx')))!;
    expect(line.map((x) => x.t).join('').length).toBe(70);
  });
});
