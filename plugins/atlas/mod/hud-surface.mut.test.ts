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

  test('the RESULT text goes first, MODEL shows only from 120 columns, and a row too narrow for TASK keeps LAST', () => {
    const wide = runsString(agentRows([agent({ name: 'a'.repeat(19), tasks: [1, 2, 3], model: 'haiku', tool: 'read alpha.py' })], { cols: 80, ui }, plain)[1]!);
    expect(wide).toContain('3 tasks');
    expect(runsCells(agentRows([agent({ name: 'a'.repeat(19), tasks: [1, 2, 3], model: 'haiku', tool: 'read alpha.py' })], { cols: 80, ui }, plain)[1]!)).toBeLessThanOrEqual(80);
    const tight = runsString(agentRows([agent({ name: 'a'.repeat(19), tasks: [1], model: 'haiku', tool: 'read alpha.py' })], { cols: 44, ui }, plain)[1]!);
    expect(tight).not.toContain('alpha.py'); // round 5: with room for one column only, LAST (the elapsed clock) is the one kept; the task id and MODEL (120 columns and up) go
    expect(tight).not.toContain('haiku');
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

describe('fitStack with the plan folded', () => {
  test('B5 (critique 28): a short slot folds plan rows onto the title and keeps every agent row; both boxes stay closed, the plan box goes whole before an agent row is windowed', () => {
    const todos: TodoRow[] = [0, 1, 2].map((i) => ({ label: `item${i}`, state: 'queued', detail: '', focus: false }));
    const agents = [0, 1, 2].map((i) => agent({ name: `agent${i}` }));
    const closed = (rows: string[]): number => rows.filter((l) => l.startsWith('+-') && l.endsWith('+') && !l.includes('[ATLAS]')).length; // the ASCII bottom rule
    const nine = fitStack({ todos, agents }, { cols: 100, ui }, 9).map((r) => runsString(r));
    expect(nine.length).toBe(9);
    expect(nine[0]).toMatch(/TODO .*0\/3 · \+1 more/); // the plan folds onto its title in one wording
    expect(nine.filter((l) => /agent\d/.test(l)).length).toBe(3);
    expect(closed(nine)).toBe(2);
    const eight = fitStack({ todos, agents }, { cols: 100, ui }, 8).map((r) => runsString(r));
    expect(eight[0]).toMatch(/TODO .*0\/3 · \+2 more/);
    expect(eight.filter((l) => /item\d/.test(l)).length).toBe(1);
    expect(eight.filter((l) => /agent\d/.test(l)).length).toBe(3);
    expect(eight.some((l) => /not shown/.test(l))).toBe(false);
    const five = fitStack({ todos, agents }, { cols: 100, ui }, 5).map((r) => runsString(r)); // no room for a plan box: it goes whole, the three agents stay
    expect(five.length).toBe(5);
    expect(five.some((l) => /TODO/.test(l))).toBe(false);
    expect(five.filter((l) => /agent\d/.test(l)).length).toBe(3);
    expect(closed(five)).toBe(1);
    const four = fitStack({ todos, agents }, { cols: 100, ui }, 4).map((r) => runsString(r)); // only now an agent row is windowed, and the title counts it
    expect(four.length).toBe(4);
    expect(four[0]).toMatch(/SUBAGENTS .*\+1 more/);
    expect(four.filter((l) => /agent\d/.test(l)).length).toBe(2);
    const roomy = fitStack({ todos, agents }, { cols: 100, ui }, 12).map((r) => runsString(r));
    expect(roomy.filter((l) => /item\d/.test(l)).length).toBe(3);
    expect(roomy.filter((l) => /agent\d/.test(l)).length).toBe(3);
  });
  test('B5: the column names go before an agent row does; only a budget with no room for the title, one agent and its rule drops to the ribbon', () => {
    const agents = [0, 1, 2].map((i) => agent({ name: `agent${i}` }));
    const six = fitStack({ todos: [], agents }, { cols: 100, ui }, 6).map((r) => runsString(r));
    expect(six.some((l) => /AGENT\s+STATE/.test(l))).toBe(true);
    const five = fitStack({ todos: [], agents }, { cols: 100, ui }, 5).map((r) => runsString(r));
    expect(five.some((l) => /AGENT\s+STATE/.test(l))).toBe(false);
    expect(five.filter((l) => /agent\d/.test(l)).length).toBe(3);
    const three = fitStack({ todos: [], agents }, { cols: 100, ui }, 3).map((r) => runsString(r));
    expect(three.filter((l) => /agent\d/.test(l)).length).toBe(1);
    expect(three[0]).toMatch(/\+2 more/);
    const two = fitStack({ todos: [], agents }, { cols: 100, ui }, 2).map((r) => runsString(r)); // below the title, one agent and its rule: the agents' ribbon alone
    expect(two).toHaveLength(1);
    expect(two[0]).toMatch(/SUBAGENTS/);
  });
});
