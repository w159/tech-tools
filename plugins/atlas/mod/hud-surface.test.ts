// The TODO and SUBAGENTS surfaces against the rev 4 design goldens (round2/design/evidence/golden), built from the one fixture world.
import { describe, expect, test } from 'claude-code/testing';
import { world } from '../contracts/band-world';
import { subagents_120, subagents_120_rich, subagents_80, todo_120, todo_120_rich, todo_40, todo_80 } from '../contracts/hud-golden';
import { chipCount, runsString, type Run, type Ui } from './atlas-ui';
import { COUNT_ORDER, type UiState } from './atlas-ui';
import { textWidth } from './theme';
import { agentRows, fitStack, padRows, sortAgents, stack, stateCounts, taskCell, todoRows, windowRows, type AgentRow, type SurfaceOpts, type TodoRow } from './hud-surface';

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
    expect(out.some((l) => /^progress |· \d+%/.test(l))).toBe(false); // one count, in the ribbon
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
  test('A4: 80 to 99 columns (a wide terminal with the pane docked) show model, task and last line, as 104 does', () => {
    for (const cols of [80, 88, 99]) {
      const rows = text(agentRows(worldAgents(), opts(cols), full));
      expect(rows[1]).toMatch(/AGENT +STATE +MODEL +TASK +LAST/);
      expect(rows[2]).toMatch(/implementer-band +running +opus +T4 +read runs\.ts:17/);
      expect(rows[4]).toMatch(/runner-land +queued +opus +T5 +waits on implementer-live/);
      for (const r of agentRows(worldAgents(), opts(cols), full)) expect(runsString(r).length).toBeLessThanOrEqual(cols);
    }
    // nothing a narrow terminal shows is missing from a wide one: the 104 column row carries the same cells
    const cells = (cols: number) => (text(agentRows(worldAgents(), opts(cols), full))[2] ?? '').split(/\s+/).filter(Boolean);
    expect(cells(88)).toEqual(cells(104));
  });
  test('60 and 40 columns draw no Subagents block (the band counts carry it)', () => {
    for (const cols of [60, 40]) expect(agentRows(worldAgents(), opts(cols), full)).toEqual([]);
  });
  test('header counts equal the row sums', () => {
    const agents = worldAgents();
    expect(stateCounts(agents.map((a) => a.state))).toBe('1 running · 1 failed · 1 queued · 2 done');
    expect(text(agentRows(agents, opts(120), full))[0]).toContain('1 running · 1 failed · 1 queued · 2 done');
  });
  test('A3: one count order everywhere, attention first (the shared COUNT_ORDER)', () => {
    const all: UiState[] = ['done', 'queued', 'waiting', 'failed', 'blocked', 'running'];
    expect(stateCounts(all)).toBe('1 running · 1 blocked · 1 failed · 1 waiting · 1 queued · 1 done');
    expect(stateCounts(all)).toBe(COUNT_ORDER.map((s) => `1 ${s}`).join(' · '));
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
  test('a row that completed within LINGER_MS stays visible when queued rows compete; older done rows fold first, newest first', () => {
    const NOW = 1_000_000;
    const row = (label: string, state: TodoRow['state'], doneAt?: number): TodoRow => ({ label, state, detail: '', focus: false, ...(doneAt !== undefined ? { doneAt } : {}) });
    const rows = [row('old done', 'done', NOW - 90_000), row('q1', 'queued'), row('fresh done', 'done', NOW - 5_000), row('q2', 'queued')];
    expect(windowRows(rows, 3, NOW).shown.map((r) => r.label)).toContain('fresh done'); // keep 2: the fresh done row and one queued row
    expect(windowRows(rows, 3, NOW).shown.map((r) => r.label)).toEqual(['q1', 'fresh done']);
    const dones = [row('d1', 'done', NOW - 90_000), row('d2', 'done', NOW - 60_000), row('d3', 'done', NOW - 80_000)];
    expect(windowRows(dones, 2, NOW).shown.map((r) => r.label)).toEqual(['d2']); // newest completion first, not plan order
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
    expect(text(agentRows([row('a', [1])], opts(80), full))[1]).toMatch(/^ {4}AGENT +STATE +MODEL +TASK +LAST$/); // A4: 80 columns names them too (it was blank below 100)
  });
});

describe('mutation kills (round 2): order, slots, focus mark, name column cap, stacking', () => {
  const ag = (name: string, state: AgentRow['state'] = 'running'): AgentRow => ({ name, state, model: 'opus', tasks: [], tool: '', ctx: null, focus: false });
  const td = (label: string, state: TodoRow['state'] = 'queued', focus = false): TodoRow => ({ label, state, detail: '', focus });

  test('sortAgents puts running, blocked, failed, waiting, queued, done in that order and keeps input order inside a state', () => {
    const rows = [ag('f1', 'failed'), ag('b1', 'blocked'), ag('r1'), ag('r2'), ag('d1', 'done'), ag('q1', 'queued'), ag('w1', 'waiting'), ag('r3'), ag('b2', 'blocked')];
    expect(sortAgents(rows).map((r) => r.name)).toEqual(['r1', 'r2', 'r3', 'b1', 'b2', 'f1', 'w1', 'q1', 'd1']);
  });
  test('windowRows with no slot shows nothing and counts every row hidden; one slot is only the overflow row', () => {
    const rows = [td('a', 'running'), td('b', 'queued')];
    expect(windowRows(rows, 0)).toEqual({ shown: [], hidden: 2 });
    expect(windowRows(rows, 1)).toEqual({ shown: [], hidden: 2 });
    expect(windowRows(rows, 2).shown).toHaveLength(2);
  });
  test('windowRows ranks blocked ahead of failed when slots run out', () => {
    const rows = [td('f', 'failed'), td('b', 'blocked'), td('q', 'queued')];
    expect(windowRows(rows, 2).shown.map((r) => r.label)).toEqual(['b']);
  });
  test('todoRows draws nothing for no rows, and a ribbon plus the row for exactly one', () => {
    expect(todoRows([], opts(120), full)).toEqual([]);
    const one = text(todoRows([td('only one')], opts(120), { spacers: false, extras: false }));
    expect(one).toHaveLength(2);
    expect(one[1]).toContain('only one');
  });
  test('the focus marker is a bold accent triangle (a bold > in ASCII); an unfocused row has a plain blank', () => {
    const on = todoRows([td('a', 'running', true)], opts(120), { spacers: false, extras: false })[1]![0]!;
    expect(on).toMatchObject({ t: '▸', tone: 'accent', bold: true });
    const off = todoRows([td('a', 'running', false)], opts(120), { spacers: false, extras: false })[1]![0]!;
    expect(off.t).toBe(' ');
    expect(off.bold).toBeUndefined();
    const asciiRow = todoRows([td('a', 'running', true)], { ...opts(120), ui: { ...ui, ascii: true } }, { spacers: false, extras: false })[1]![0]!;
    expect(asciiRow).toMatchObject({ t: '>', bold: true });
  });
  test('a long agent name shows whole while the row has room; only a name that alone overflows is end-clipped', () => {
    const long = 'board-auditor-open-items-and-more'; // 33 cells
    const rows = text(agentRows([ag(long)], opts(120), { spacers: false, extras: false }));
    expect(rows[1]).toContain(long);
    const tight = text(agentRows([ag('x'.repeat(90))], opts(80), { spacers: false, extras: false }));
    expect(tight[1]).toContain('running');
    expect(tight[1]).toMatch(/x\.\.\. +running/);
  });
  test('stack puts a blank row between the blocks only when spacers is on and both blocks exist', () => {
    const s = { todos: [td('t')], agents: [ag('a')] };
    const blanks = (b: { spacers: boolean; extras: boolean }, x: { todos: TodoRow[]; agents: AgentRow[] }) => stack(x, opts(120), b).filter((r) => r.length === 0).length;
    const on = { spacers: true, extras: false };
    expect(blanks(on, s)).toBe(1); // the separator between the blocks (the TODO block has no blank row) (the agents' spacer row holds the column words)
    expect(blanks({ spacers: false, extras: false }, s)).toBe(0);
    // One block alone never gets the separator row.
    expect(blanks(on, { todos: s.todos, agents: [] })).toBe(0); // no separator and no blank inside the block
    expect(blanks(on, { todos: [], agents: s.agents })).toBe(0);
  });
  test('fitStack at two rows with two agents ends on the two bare ribbons (no spacer row to push it to one)', () => {
    const rows = fitStack({ todos: [td('t')], agents: [ag('a'), ag('b')] }, opts(120), 2);
    expect(text(rows).map((l) => l.trim().split(/\s+/)[2] ?? '')).toHaveLength(2);
    expect(text(rows)[0]).toContain('TODO');
    expect(text(rows)[1]).toContain('SUBAGENTS');
  });
});

describe('hud fixes (round 3): whole names, dropped columns, task text, one TODO layout', () => {
  const row = (o: Partial<AgentRow> & { name: string }): AgentRow => ({ state: 'running', model: 'haiku', tasks: [], tool: 'read alpha.py -> first lines', ctx: null, focus: false, ...o });
  const lines = (rows: AgentRow[], cols: number): string[] => text(agentRows(rows, opts(cols), { spacers: false, extras: false })).slice(1);
  test('a narrow row drops last text, then task, then model; the state word is never cut', () => {
    const a = row({ name: 'board-auditor-open-items', task: 'list open items' });
    const widths = [140, 100, 90, 80];
    const seen = widths.map((w) => lines([a], w)[0]!);
    for (const l of seen) { expect(l).toContain('board-auditor-open-items'); expect(l).toContain('running'); expect(l).not.toContain('...items'); }
    expect(seen[0]).toContain('first lines');
    expect(seen[3]).not.toContain('first');
    const at = (l: string) => ({ model: l.includes('haiku'), task: l.includes('list open'), last: l.includes('read alpha') });
    // Whatever survives, a later column never shows without the earlier one.
    for (const l of seen) { const c = at(l); if (c.last) expect(c.task && c.model).toBe(true); if (c.task) expect(c.model).toBe(true); }
  });
  test('no state word is cut at any width (runnin, haik)', () => {
    for (let w = 80; w <= 120; w++) {
      const l = lines([row({ name: 'board-auditor-open-items' })], w)[0]!;
      expect(l).toContain(' running');
      expect(/haik(?!u)/.test(l)).toBe(false);
    }
  });
  test('the TASK column carries the dispatch description when the agent owns no plan row', () => {
    const l = lines([row({ name: 'alpha-explorer', task: 'read alpha.py' })], 120)[0]!;
    expect(l).toContain('read alpha.py');
  });
  test('C1: the TODO block has one layout at every width: ribbon with the one count, then a row per item with its state column; no blank row, no progress row', () => {
    for (const cols of [150, 110, 100, 80, 60, 40]) {
      const out = text(todoRows(worldTodos(), opts(cols), full));
      expect([cols, out[0]]).toEqual([cols, expect.stringContaining('TODO')]);
      expect(out.filter((l) => l === '')).toHaveLength(0);
      expect(out[0]).toMatch(/\d+( of |\/)\d+/); // the count is in the ribbon
      expect(out.slice(1).filter((l) => /\d+ of \d+ done|\d+\/\d+\b(?!:)|\d+%/.test(l))).toHaveLength(0); // and only there
      expect(out.some((l) => /^progress /.test(l))).toBe(false);
      const rows = out.slice(1);
      expect(rows).toHaveLength(worldTodos().length);
      for (const l of rows) expect([cols, l]).toEqual([cols, expect.stringMatching(/(done|running|queued|failed|blocked|waiting)/)]); // the state column at every width
      for (const l of rows) expect(textWidth(l)).toBeLessThanOrEqual(cols);
    }
  });
  test('C1: the first row of the stack is never blank, at any width or row budget, with the TODO block first or alone', () => {
    for (const cols of [150, 110, 80, 60, 40]) for (const maxRows of [30, 12, 8, 5, 3, 2, 1]) {
      for (const sets of [{ todos: worldTodos(), agents: worldAgents() }, { todos: worldTodos(), agents: [] }, { todos: [], agents: worldAgents() }]) {
        const rows = fitStack(sets, opts(cols), maxRows);
        if (rows.length) expect([cols, maxRows, runsString(rows[0]!).trim() !== '']).toEqual([cols, maxRows, true]);
      }
    }
  });
  test('C1: a pane under 13 cells has no room for a state word and keeps the title alone', () => {
    const out = text(todoRows(worldTodos(), opts(12), full));
    for (const l of out.slice(1)) expect(textWidth(l)).toBeLessThanOrEqual(12);
    expect(out.slice(1).some((l) => /done|running|queued/.test(l))).toBe(false);
  });

});
