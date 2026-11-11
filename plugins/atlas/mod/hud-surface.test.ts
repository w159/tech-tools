// The TODO and SUBAGENTS surfaces against the rev 4 design goldens (round2/design/evidence/golden), built from the one fixture world.
import { describe, expect, test } from 'claude-code/testing';
import { world } from '../contracts/band-world';
import { subagents_120, subagents_120_rich, subagents_80, todo_120, todo_120_rich, todo_40, todo_80 } from '../contracts/hud-golden';
import { chipCount, runsString, type Run, type Ui } from './atlas-ui';
import { agentRows, fitStack, padRows, stateCounts, taskCell, todoRows, windowRows, type AgentRow, type SurfaceOpts, type TodoRow } from './hud-surface';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
export const worldTodos = (): TodoRow[] => world.todos.map((t) => ({ label: t.label, state: t.state, detail: t.detail, focus: t.state === 'running' }));
export const worldAgents = (): AgentRow[] =>
  world.workers.map((w) => ({ name: w.name, state: w.state, model: w.model, tasks: world.todos.filter((t) => t.owner === w.name).map((t) => Number(t.id.slice(1))), tool: w.last_tool, ctx: w.ctx, focus: w.state === 'running' }));
const opts = (cols: number, rich = false): SurfaceOpts => ({ cols, ui, rich, phases: { ids: world.phases.map((p) => p.id), active: world.phases.findIndex((p) => p.state === 'active') } });
const text = (rows: Run[][]): string[] => rows.map((r) => runsString(r).trimEnd());
const full = { spacers: true, extras: true };

describe('TODO surface goldens (rev 4)', () => {
  for (const [cols, rich, golden] of [[120, false, todo_120], [120, true, todo_120_rich], [80, false, todo_80], [40, false, todo_40]] as const) {
    test(`${cols} columns rich=${rich} equals the design golden`, () => {
      expect(text(todoRows(worldTodos(), opts(cols, rich), full))).toEqual([...golden]);
    });
  }
  test('60 columns uses the 40 column form under a 60 column ribbon', () => {
    const rows = text(todoRows(worldTodos(), opts(60), full));
    expect(rows.slice(1)).toEqual(todo_40.slice(1));
    expect(rows[0]!.length).toBe(60 - 2); // the ribbon is 60 cells; the two trailing spaces are trimmed
    expect(rows[0]!.endsWith('3/7')).toBe(true);
  });
  test('completed rows are drawn as done: the done glyph, the word and a struck label', () => {
    const rows = todoRows(worldTodos(), opts(120), full);
    const done = rows.filter((r) => r.some((x) => x.t === 'done'));
    expect(done).toHaveLength(3);
    for (const r of done) {
      expect(r.some((x) => x.t === '●')).toBe(true);
      expect(r.some((x) => x.strike && x.tone === 'sub')).toBe(true);
    }
  });
  test('header counts equal the row sums', () => {
    const rows = worldTodos();
    const out = text(todoRows(rows, opts(120), full));
    const done = rows.filter((r) => r.state === 'done').length;
    expect(out[0]).toContain(`${done} of ${rows.length} done`);
    expect(out[2]).toContain(`${done} of ${rows.length} · 43%`);
    expect(out.filter((l) => /^[ ▸] [●◐◇■▲◉] /.test(l))).toHaveLength(rows.length);
  });
  test('columns: label at 4, state at 30, meta at 44; at most one chip per row; no row wider than the surface', () => {
    for (const rich of [false, true]) {
      const rows = padRows(todoRows(worldTodos(), opts(120, rich), full), 120);
      const body = rows.filter((r) => runsString(r).includes('Subagents block'));
      const line = runsString(body[0]!);
      expect(line.indexOf('Subagents block')).toBe(4);
      expect(line.indexOf(rich ? ' RUNNING' : 'running')).toBe(rich ? 30 : 30);
      expect(line.indexOf('elapsed')).toBe(44);
      for (const r of rows) {
        expect(chipCount(r)).toBeLessThanOrEqual(1);
        expect([...runsString(r)].length).toBe(120);
      }
    }
  });
});

describe('SUBAGENTS surface goldens (rev 4)', () => {
  for (const [cols, rich, golden] of [[120, false, subagents_120], [120, true, subagents_120_rich], [80, false, subagents_80]] as const) {
    test(`${cols} columns rich=${rich} equals the design golden`, () => {
      expect(text(agentRows(worldAgents(), opts(cols, rich), full))).toEqual([...golden]);
    });
  }
  test('60 and 40 columns draw no Subagents block (the band counts carry it)', () => {
    for (const cols of [60, 40]) expect(agentRows(worldAgents(), opts(cols), full)).toEqual([]);
  });
  test('header counts equal the row sums', () => {
    const agents = worldAgents();
    expect(stateCounts(agents.map((a) => a.state))).toBe('1 queued · 1 running · 2 done · 1 failed');
    expect(text(agentRows(agents, opts(120), full))[0]).toContain('1 queued · 1 running · 2 done · 1 failed');
  });
  test('a long name widens the name column instead of being cut, up to 28 cells', () => {
    const rows = text(agentRows([{ ...worldAgents()[0]!, name: 'implementer-capture-harness' }], opts(120), full));
    expect(rows[2]).toContain('implementer-capture-harness');
    expect(rows[2]!.indexOf('running')).toBe(4 + 28);
  });
});

describe('row budget never hides rows silently', () => {
  const many = (n: number): TodoRow[] => Array.from({ length: n }, (_, i) => ({ label: `Item ${i + 1}`, state: i < 3 ? 'done' : i === 3 ? 'running' : 'queued', detail: '', focus: i === 3 }));
  test('45 rows tall: a 30 item plan with 4 agents shows every row', () => {
    const rows = text(fitStack({ todos: many(30), agents: worldAgents().slice(0, 4) }, opts(120), 45));
    expect(rows.length).toBeLessThanOrEqual(45);
    for (let i = 1; i <= 30; i++) expect(rows.some((l) => l.includes(` Item ${i} `) || l.endsWith(` Item ${i}`))).toBe(true);
    expect(rows.join('\n')).not.toContain('more todo');
  });
  test('shown rows plus the counted hidden rows always equal the plan, at every height', () => {
    const todos = many(30);
    for (let h = 2; h <= 45; h++) {
      const rows = text(fitStack({ todos, agents: worldAgents() }, opts(120), h));
      expect(rows.length).toBeLessThanOrEqual(h);
      const shown = rows.filter((l) => / Item \d+/.test(l)).length;
      const hidden = Number(/(\d+) more todo/.exec(rows.join('\n'))?.[1] ?? 0);
      if (rows.some((l) => l.includes('TODO') && !l.includes('SUBAGENTS')) && (shown > 0 || hidden > 0)) expect(shown + hidden).toBe(30);
    }
  });
  test('windowRows keeps open work first, then the queue, in plan order', () => {
    const { shown, hidden } = windowRows(many(10), 5);
    expect(hidden).toBe(6);
    expect(shown.map((r) => r.label)).toEqual(['Item 4', 'Item 5', 'Item 6', 'Item 7']);
  });
  test('a running agent keeps its row before the plan keeps its last row', () => {
    const rows = text(fitStack({ todos: many(10), agents: worldAgents() }, opts(120), 6));
    expect(rows.length).toBeLessThanOrEqual(6);
    expect(rows.some((l) => l.includes('implementer-band'))).toBe(true);
  });
  test('one row: the Subagents ribbon when an agent runs, else the TODO ribbon', () => {
    expect(text(fitStack({ todos: many(5), agents: worldAgents() }, opts(120), 1))[0]).toContain('SUBAGENTS');
    expect(text(fitStack({ todos: many(5), agents: [] }, opts(120), 1))[0]).toContain('TODO');
    expect(fitStack({ todos: many(5), agents: [] }, opts(120), 0)).toEqual([]);
  });
});

describe('SUBAGENTS task column (critique-3 change 8)', () => {
  const row = (name: string, tasks: number[]): AgentRow => ({ name, state: 'running', model: 'opus', tasks, tool: 'read a.ts', ctx: null, focus: false });
  test('every owned id is listed; more than fit read as a count', () => {
    expect(taskCell([])).toBe('');
    expect(taskCell([4])).toBe('T4');
    expect(taskCell([1, 2])).toBe('T1,T2');
    expect(taskCell([1, 2, 3])).toBe('3 tasks');
    const out = text(agentRows([row('a', [1, 2]), row('b', [3, 4, 5]), row('c', [])], opts(120), full));
    expect(out.find((r) => / a /.test(r))).toContain('T1,T2');
    expect(out.find((r) => / b /.test(r))).toContain('3 tasks');
  });
  test('the full form names its columns in the spacer row: AGENT STATE MODEL TASK LAST (rich: CTX instead of TASK)', () => {
    expect(text(agentRows([row('a', [1])], opts(120), full))[1]).toMatch(/^ {4}AGENT +STATE +MODEL +TASK +LAST$/);
    expect(text(agentRows([row('a', [1])], opts(120, true), full))[1]).toMatch(/^ {4}AGENT +STATE +CTX +MODEL +LAST$/);
    expect(text(agentRows([row('a', [1])], opts(80), full))[1]).toBe(''); // below 100 columns the spacer stays blank
  });
});
