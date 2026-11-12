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
  test('TASK holds plan ids only: a dispatch description never fills it (critique 19 B2: `read beta.py` for a retry)', () => {
    const out = agentRows([agent({ task: 'x'.repeat(30), tasks: [3] })], { cols: 200, ui }, plain);
    expect(runsString(out[1]!)).toContain('T3');
    expect(runsString(out[1]!)).not.toContain('xxx');
    expect(runsString(agentRows([agent({ task: 'read beta.py' })], { cols: 200, ui }, plain)[1]!)).not.toContain('read beta.py');
  });

  test('the last text goes before the model, and the model before a task id is cut', () => {
    const wide = runsString(agentRows([agent({ name: 'a'.repeat(19), tasks: [1, 2, 3], model: 'haiku', tool: 'read alpha.py' })], { cols: 80, ui }, plain)[1]!);
    expect(wide).toContain('3 tasks');
    expect(runsCells(agentRows([agent({ name: 'a'.repeat(19), tasks: [1, 2, 3], model: 'haiku', tool: 'read alpha.py' })], { cols: 80, ui }, plain)[1]!)).toBeLessThanOrEqual(80);
    const tight = runsString(agentRows([agent({ name: 'a'.repeat(19), tasks: [1], model: 'haiku', tool: 'read alpha.py' })], { cols: 44, ui }, plain)[1]!);
    expect(tight).toContain('T1');
    expect(tight).not.toContain('alpha.py');
  });

  test('ctx gauge column: drawn when the block fits exactly, at stateAt + 14; absent one cell short', () => {
    const rich = { cols: 120, ui, rich: true };
    // nameW 83 -> stateAt 89 (4 + 83 + the 2-cell gutter); the ctx block needs stateAt + 14 + 4 + 8 + 5 = 120 cells: exactly cols.
    const fit = agentRows([agent({ name: 'n'.repeat(83), ctx: 0.5 })], rich, plain)[1]!;
    const at = fit.findIndex((x) => x.t === 'ctx ');
    expect(at).toBeGreaterThan(0);
    expect(runsCells(fit.slice(0, at))).toBe(89 + 14);
    // nameW 84 -> stateAt 90: one cell short, no gauge.
    const short = agentRows([agent({ name: 'n'.repeat(84), ctx: 0.5 })], rich, plain)[1]!;
    expect(runsString(short)).not.toContain('ctx ');
  });

  test('an empty cell draws nothing, not padding out to its column', () => {
    const s = runsString(agentRows([agent({ task: 'job', tool: '' })], { cols: 200, ui }, plain)[1]!);
    expect(s).toBe(s.trimEnd());
  });

  test('a cell whose column was dropped draws nothing', () => {
    // nameW 50 -> stateAt 56; with the model column gone (task at 68) last would start at 76 and need 8 more cells: 84 > 80.
    const out = agentRows([agent({ name: 'n'.repeat(50), tool: 'bashtool' })], { cols: 80, ui }, plain);
    expect(runsString(out[1]!)).not.toContain('bashtool');
    expect(runsCells(out[1]!)).toBeLessThanOrEqual(80);
  });
});

describe('fitStack with the plan hidden', () => {
  test('B5: the agents-only try keeps the column header and windows the agents instead', () => {
    const todos: TodoRow[] = [0, 1, 2].map((i) => ({ label: `item${i}`, state: 'queued', detail: '', focus: false }));
    const agents = [0, 1, 2].map((i) => agent({ name: `agent${i}` }));
    const five = fitStack({ todos, agents }, { cols: 100, ui }, 5).map((r) => runsString(r));
    expect(five.length).toBe(5); // the column names and the closing rules are the decoration that goes first: the plan's ribbon (its rows counted on it), the agents' title and all three agents
    expect(five[0]).toMatch(/TODO/);
    expect(five.filter((l) => /agent\d/.test(l)).length).toBe(3);
    expect(five.some((l) => /AGENT\s+STATE/.test(l))).toBe(false);
    expect(five.some((l) => /^(╰─+|\+-+)$/.test(l))).toBe(false);
    const four = fitStack({ todos, agents }, { cols: 100, ui }, 4).map((r) => runsString(r)); // one row less: the plan's ribbon goes, the agents are windowed and the names stay
    expect(four.length).toBe(4);
    expect(four.some((l) => /AGENT\s+STATE/.test(l))).toBe(true);
    expect(four.filter((l) => /agent\d/.test(l)).length).toBe(1);
    expect(four.some((l) => /2 more agents not shown/.test(l))).toBe(true);
  });
  test('B5: only a budget with no room for the header and one agent drops the header, never the agent', () => {
    const agents = [0, 1, 2].map((i) => agent({ name: `agent${i}` }));
    const text = fitStack({ todos: [], agents }, { cols: 100, ui }, 3).map((r) => runsString(r));
    expect(text.some((l) => /AGENT\s+STATE/.test(l))).toBe(false);
    expect(text.filter((l) => /agent\d/.test(l)).length).toBe(1);
  });
});
