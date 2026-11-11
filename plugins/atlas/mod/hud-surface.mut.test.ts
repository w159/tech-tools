// Mutation-kill tests for hud-surface.ts (seed 1105 survivors): the narrow tier spends every cell after its four-cell head on the label;
// the task column drops the model and the last text before it is cut; the ctx gauge needs its exact block width; an empty or column-less cell draws nothing; the agents-only fit has no header.
//
// Equivalent (seed 1105, third pass), not tested:
//  - maxLen reduce seed `0` -> `1` (hud-surface.ts:40): the seed only shows when every cell width is 0, and both callers floor the result well above 1
//    (line 97: `Math.max(26|30, maxLen + 5)`; line 145: `Math.max(19, maxLen)`).
//  - fitStack hideTodo try `extras: false` -> `true` (line 250): that try empties the todos, todoRows([]) returns [] (line 69), and agentRows never
//    reads `extras` (only `cap` and `spacers`), so the stack is identical.
import { describe, expect, test } from 'claude-code/testing';
import { runsCells, runsString, type Ui } from './atlas-ui';
import { agentRows, fitStack, todoRows, type AgentRow, type TodoRow } from './hud-surface';

const ui: Ui = { theme: 'mocha', ascii: true, color: 'truecolor' };
const agent = (over: Partial<AgentRow> = {}): AgentRow => ({ name: 'a', state: 'running', model: 'm', tasks: [], tool: '', ctx: null, focus: false, ...over });
const plain = { spacers: false, extras: false };

describe('todoRows at the min tier', () => {
  test('a long label fills exactly the width', () => {
    const rows: TodoRow[] = [{ label: 'x'.repeat(100), state: 'running', detail: '', focus: false }];
    const out = todoRows(rows, { cols: 70, ui }, { spacers: false, extras: false });
    const line = out.find((r) => r.some((x) => x.t.startsWith('xxx')))!;
    expect(line.map((x) => x.t).join('').length).toBe(70);
  });
});

describe('agentRows columns', () => {
  test('a long task cell is shown whole while it fits (critique 6: no 18-cell cut)', () => {
    const out = agentRows([agent({ task: 'x'.repeat(30) })], { cols: 200, ui }, plain);
    expect(runsString(out[1]!)).toContain('x'.repeat(30));
  });

  test('the model and the last text go before the task is cut', () => {
    const task = 'one two three four five six seven eight nine'; // 44 cells: beside the model at 80 columns it would pass the edge
    const out = agentRows([agent({ name: 'a'.repeat(19), task, model: 'haiku', tool: 'read alpha.py' })], { cols: 80, ui }, plain);
    const row = runsString(out[1]!);
    expect(row).toContain(task);
    expect(row).not.toContain('haiku');
    expect(row).not.toContain('alpha.py');
    expect(runsCells(out[1]!)).toBeLessThanOrEqual(80);
    // only when the task alone does not fit is it ended on a whole word
    const tight = runsString(agentRows([agent({ name: 'a'.repeat(19), task: `${task} ${task}` })], { cols: 80, ui }, plain)[1]!);
    expect(tight).toMatch(/nine\.\.\.$|eight\.\.\.$|seven\.\.\.$/);
  });

  test('ctx gauge column: drawn when the block fits exactly, at stateAt + 14; absent one cell short', () => {
    const rich = { cols: 120, ui, rich: true };
    // nameW 84 -> stateAt 89; the ctx block needs stateAt + 14 + 4 + 8 + 5 = 120 cells: exactly cols.
    const fit = agentRows([agent({ name: 'n'.repeat(84), ctx: 0.5 })], rich, plain)[1]!;
    const at = fit.findIndex((x) => x.t === 'ctx ');
    expect(at).toBeGreaterThan(0);
    expect(runsCells(fit.slice(0, at))).toBe(89 + 14);
    // nameW 85 -> stateAt 90: one cell short, no gauge.
    const short = agentRows([agent({ name: 'n'.repeat(85), ctx: 0.5 })], rich, plain)[1]!;
    expect(runsString(short)).not.toContain('ctx ');
  });

  test('an empty cell draws nothing, not padding out to its column', () => {
    const s = runsString(agentRows([agent({ task: 'job', tool: '' })], { cols: 200, ui }, plain)[1]!);
    expect(s).toBe(s.trimEnd());
  });

  test('a cell whose column was dropped draws nothing', () => {
    // nameW 40 -> stateAt 45, model 57, task 67, last would start at 73 and need 8 more cells: 81 > 80.
    const out = agentRows([agent({ name: 'n'.repeat(40), tool: 'bashtool' })], { cols: 80, ui }, plain);
    expect(runsString(out[1]!)).not.toContain('bashtool');
    expect(runsCells(out[1]!)).toBeLessThanOrEqual(80);
  });
});

describe('fitStack with the plan hidden', () => {
  test('the agents-only try draws no column header', () => {
    const todos: TodoRow[] = [0, 1, 2].map((i) => ({ label: `item${i}`, state: 'queued', detail: '', focus: false }));
    const agents = [0, 1, 2].map((i) => agent({ name: `agent${i}` }));
    const text = fitStack({ todos, agents }, { cols: 100, ui }, 4).map((r) => runsString(r));
    expect(text.length).toBe(4);
    expect(text.some((l) => /AGENT\s+STATE/.test(l))).toBe(false);
    expect(text.filter((l) => /agent\d/.test(l)).length).toBe(3);
  });
});
