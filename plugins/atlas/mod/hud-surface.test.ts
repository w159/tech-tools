// The TODO and SUBAGENTS surfaces against the rev 4 design goldens (round2/design/evidence/golden), built from the one fixture world.
import { describe, expect, test } from 'claude-code/testing';
import { world } from '../contracts/band-world';
import { subagents_120, subagents_120_rich, subagents_80, todo_120, todo_120_rich, todo_40, todo_80 } from '../contracts/hud-golden';
import { chipCount, elapsedClock, leadSpinnerGlyph, runsCells, runsString, type Run, type Ui } from './atlas-ui';
import { COUNT_ORDER, type UiState } from './atlas-ui';
import { textWidth } from './theme';
import { agentRows, fitStack, padRows, rowSpinnerGlyph, sortAgents, stack, stateCounts, taskCell, todoRows, windowRows, type AgentRow, type SurfaceOpts, type TodoRow } from './hud-surface';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
export const worldTodos = (): TodoRow[] => world.todos.map((t) => ({ label: t.label, state: t.state, detail: t.detail, focus: t.state === 'running' }));
export const worldAgents = (): AgentRow[] => // the adapter's order (hud.ts agentModel): by task, not by state
  sortAgents(world.workers.map((w) => ({ name: w.name, state: w.state, model: w.model, tasks: world.todos.filter((t) => t.owner === w.name).map((t) => Number(t.id.slice(1))), tool: w.last_tool, ctx: w.ctx, focus: w.state === 'running', elapsed: elapsedClock(w.age_s) })));
const opts = (cols: number, rich = false): SurfaceOpts => ({ cols, ui, rich, phases: { ids: world.phases.map((p) => p.id), active: world.phases.findIndex((p) => p.state === 'active') } });
const text = (rows: Run[][]): string[] => rows.map((r) => runsString(r).trimEnd());
/** A golden title carries `@SPIN@` for the band's braille spinner glyph at frame 0 (the title turns the band frame; the rows keep the circle quarters). */
const spun = (rows: readonly string[]): string[] => rows.map((r) => (r.includes('SUBAGENTS') ? r.replace(leadSpinnerGlyph(0), '@SPIN@') : r));
const full = { spacers: true, extras: true, close: true };

describe('TODO surface goldens (rev 4)', () => {
  for (const [cols, rich, golden] of [[120, false, todo_120], [120, true, todo_120_rich], [80, false, todo_80], [40, false, todo_40]] as const) {
    test(`${cols} columns rich=${rich} equals the design golden`, () => {
      expect(text(todoRows(worldTodos(), opts(cols, rich), full))).toEqual([...golden]);
    });
  }
  test('60 columns uses the 40 column form under a 60 column ribbon', () => {
    const rows = text(todoRows(worldTodos(), opts(60), full));
    expect(rows.slice(1, -1)).toEqual(todo_40.slice(1, -1));
    expect(rows[0]!.length).toBe(60); // the title rule runs to the last cell, where the host draws its `[-]`
    expect(rows[0]!).toMatch(/TODO {2}3\/7 ▰{3}▱{5} ─+╮$/); // critique 21: the count and the meter sit INSIDE the rule, which runs on to the corner at the edge
    expect(rows.at(-1)).toBe(`╰${'─'.repeat(58)}╯`); // the box closes at the width of the surface
  });
  test('completed rows are drawn as done: a green disc, the word, and quiet 247 text that is never struck through (critique 21)', () => {
    const rows = todoRows(worldTodos(), opts(120), full);
    const done = rows.filter((r) => r.some((x) => x.t === 'done'));
    expect(done).toHaveLength(3);
    for (const r of done) {
      const disc = r.find((x) => x.t === '●')!;
      expect(disc.tone).toBe('ok');
      const label = r.find((x) => x.t.startsWith('Wire') || x.t.startsWith('Layout') || x.t.startsWith('Gate golden'))!;
      expect(label.tone).toBe('muted');
      expect(r.some((x) => x.strike)).toBe(false);
    }
  });
  test('a block is a box: a bottom rule of only ╰─╯ closes TODO and SUBAGENTS, rows carry no side border, and `close` off draws neither', () => {
    for (const cols of [120, 80, 40]) {
      const t = text(todoRows(worldTodos(), opts(cols), full));
      const a = text(agentRows(worldAgents(), opts(cols), full));
      for (const rows of [t, a]) {
        expect(rows.at(-1)).toBe(`╰${'─'.repeat(cols - 2)}╯`);
        expect(rows.slice(1, -1).some((r) => /[│]/.test(r))).toBe(false);
      }
    }
    expect(text(todoRows(worldTodos(), opts(120), { spacers: true, extras: true })).some((r) => r.startsWith('╰'))).toBe(false);
    expect(text(agentRows(worldAgents(), opts(120), { spacers: true, extras: true })).some((r) => r.startsWith('╰'))).toBe(false);
    expect(todoRows(worldTodos(), opts(120), { spacers: true, extras: true, close: true, cap: 0 })).toHaveLength(1); // a ribbon alone has nothing to close
    expect(agentRows(worldAgents(), opts(120), { spacers: true, extras: true, close: true, cap: 0 })).toHaveLength(1);
  });
  test('the title rule carries the count, the meter and the spinner inside it and ends on a rule cell, in every width', () => {
    for (const cols of [40, 60, 80, 120, 150]) {
      const t = todoRows(worldTodos(), opts(cols), full)[0]!;
      const line = runsString(t);
      expect(line.startsWith('╭─ ◖ ◆ ATLAS ◗ ▸ TODO')).toBe(true);
      expect(runsCells(t)).toBe(cols);
      expect(line.endsWith('╮')).toBe(true); // no right corner: the host's [-] ends the rule
      expect(line.indexOf('▰')).toBeLessThan(line.lastIndexOf('─'));
      expect(line.indexOf('3/7')).toBeLessThan(line.indexOf('▰'));
    }
  });
  test('header counts equal the row sums', () => {
    const rows = worldTodos();
    const out = text(todoRows(rows, opts(120), full));
    const done = rows.filter((r) => r.state === 'done').length;
    expect(out[0]).toContain(`${done}/${rows.length}`);
    expect(out.some((l) => /^progress |· \d+%/.test(l))).toBe(false); // one count, in the ribbon
    expect(out.filter((l) => /^[ ▸] [●◐◐◇■▲▲◉] /.test(l))).toHaveLength(rows.length);
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
      expect(spun(text(agentRows(worldAgents(), opts(cols, rich), full)))).toEqual([...golden]);
    });
  }
  test('A4: 80 to 99 columns (a wide terminal with the pane docked) show model, task and last line, as 104 does', () => {
    for (const cols of [80, 88, 99]) {
      const rows = text(agentRows(worldAgents(), opts(cols), full));
      expect(rows[1]).toMatch(/AGENT +STATE +TASK +LAST/); // MODEL joins from 120 columns
      expect(rows[1]).not.toMatch(/MODEL/);
      expect(rows[4]).toMatch(/implementer-band +running +T4 +\d+:\d\d +read runs\.ts:17/);
      expect(rows[5]).toMatch(/runner-land +queued +T5 +0:00 +waits on implementer-live/);
      for (const r of agentRows(worldAgents(), opts(cols), full)) expect(runsString(r).length).toBeLessThanOrEqual(cols);
    }
    // nothing a narrow terminal shows is missing from a wide one: the 104 column row carries the same cells
    const cells = (cols: number) => (text(agentRows(worldAgents(), opts(cols), full))[4] ?? '').split(/\s+/).filter(Boolean);
    expect(cells(88)).toEqual(cells(104));
  });
  test('60 and 40 columns still draw the Subagents block, every row within the width', () => {
    for (const cols of [60, 40]) {
      const rows = agentRows(worldAgents(), opts(cols), full);
      expect(text(rows)[0]).toContain('SUBAGENTS');
      expect(rows.length).toBeGreaterThan(worldAgents().length);
      for (const r of rows) expect(runsCells(r)).toBeLessThanOrEqual(cols);
    }
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
    const rows = text(agentRows([{ ...worldAgents().find((a) => a.state === 'running')!, name: 'implementer-capture-harness' }], opts(120), full));
    expect(rows[2]).toContain('implementer-capture-harness');
    expect(rows[2]!.indexOf('running')).toBe(4 + 27 + 2); // the AGENT column keeps a 2-cell gutter before STATE (critique 21)
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
      const hidden = Number(/\+(\d+) more/.exec(rows.join("\n"))?.[1] ?? 0) + Number(/TODO .*· (\d+) done/.exec(rows[0] ?? '')?.[1] ?? 0); // finished rows fold into `N done` (critique 17 B4)
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
    expect(text(agentRows([row('a', [1])], opts(120), full))[1]).toMatch(/^ {4}AGENT +STATE +MODEL +TASK +LAST +RESULT$/);
    expect(text(agentRows([row('a', [1])], opts(120, true), full))[1]).toMatch(/^ {4}AGENT +STATE +CTX +MODEL +LAST +RESULT$/);
    expect(text(agentRows([row('a', [1])], opts(80), full))[1]).toMatch(/^ {4}AGENT +STATE +TASK +LAST +RESULT$/); // A4: 80 columns names them too, without MODEL (120 columns and up)
  });
});

describe('mutation kills (round 2): order, slots, focus mark, name column cap, stacking', () => {
  const ag = (name: string, state: AgentRow['state'] = 'running'): AgentRow => ({ name, state, model: 'opus', tasks: [], tool: '', ctx: null, focus: false });
  const td = (label: string, state: TodoRow['state'] = 'queued', focus = false): TodoRow => ({ label, state, detail: '', focus });

  test('sortAgents orders by the first plan row each agent owns, whatever its state, and keeps input order for those without one (critique 11 A3)', () => {
    const t = (name: string, state: AgentRow['state'], ...tasks: number[]): AgentRow => ({ ...ag(name, state), tasks });
    const rows = [t('f1', 'failed', 3), ag('d0', 'done'), t('r1', 'running', 2), t('d1', 'done', 5, 1), ag('q0', 'queued'), t('w1', 'waiting', 4)];
    expect(sortAgents(rows).map((r) => r.name)).toEqual(['d1', 'r1', 'f1', 'w1', 'd0', 'q0']);
    // a worker that finishes does not move: the same rows with other states give the same order
    expect(sortAgents(rows.map((r) => ({ ...r, state: 'done' as const }))).map((r) => r.name)).toEqual(['d1', 'r1', 'f1', 'w1', 'd0', 'q0']);
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
    expect(tight[1]).toMatch(/x… {2}running/); // a one-cell `…` and the 2-cell gutter, never `...`
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
    const a = row({ name: 'board-auditor-open-items', tasks: [1] }); // critique 19 B2: TASK is the plan id
    const widths = [140, 100, 90, 80];
    const seen = widths.map((w) => lines([a], w)[0]!);
    for (const l of seen) { expect(l).toContain('board-auditor-open-items'); expect(l).toContain('running'); expect(l).not.toContain('...items'); }
    expect(seen[0]).toContain('first lines');
    expect(seen[3]).not.toContain('first');
    const at = (l: string) => ({ task: l.includes('T1'), last: l.includes('read alpha') });
    // Whatever survives, a later column never shows without the earlier one (MODEL is 120 columns and up only).
    for (const l of seen) { const c = at(l); if (c.last) expect(c.task).toBe(true); }
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
      expect(out.at(-1)).toBe(`╰${'─'.repeat(cols - 2)}╯`); // the box closes (critique 21)
      const rows = out.slice(1, -1);
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

describe('critique 7 B4/B5: LAST and the column header at 110 columns', () => {
  const row = (o: Partial<AgentRow> & { name: string }): AgentRow => ({ state: 'running', model: 'haiku', tasks: [], tool: 'read alpha.py', ctx: null, focus: false, ...o });
  test('B5 (critique 26): a short slot gives up the blank, then the closing rules, then agent rows down to one, then plan rows; the column names stay while an agent row shows, and no plan row folds before decoration', () => {
    const rows = [row({ name: 'alpha-explorer', task: 'read alpha.py' }), row({ name: 'beta-explorer', task: 'read beta.py' })];
    const todos: TodoRow[] = [0, 1, 2].map((i) => ({ label: `item${i}`, state: 'queued', detail: '', focus: false }));
    const at = (n: number): string[] => text(fitStack({ todos, agents: rows }, opts(110), n));
    const full = at(11); // title + 3 plan rows + rule + blank + title + column names + 2 agents + rule
    expect(full).toHaveLength(11);
    expect(full[4]).toMatch(/^╰─+╯$/);
    expect(full[5]).toBe('');
    expect(full.at(-1)).toMatch(/^╰─+╯$/);
    const tops = (o: string[]): number => o.filter((l) => l.startsWith('╭─ ') && l.endsWith('╮')).length;
    const bottoms = (o: string[]): number => o.filter((l) => /^╰─+╯$/.test(l)).length;
    const names = (o: string[]): boolean => o.some((l) => /^ {4}AGENT +STATE +TASK +LAST +RESULT$/.test(l));
    const blank = at(10); // the blank goes first, both rules and both corners stay
    expect(blank).toHaveLength(10);
    expect([tops(blank), bottoms(blank)]).toEqual([2, 2]);
    expect(blank.filter((l) => l === '')).toHaveLength(0);
    expect(names(blank)).toBe(true);
    expect(blank.filter((l) => l.includes('queued')).length).toBe(3);
    const bare = at(9); // then the closing rules; every plan row, the names and both agents stay
    expect(bare.length).toBeLessThanOrEqual(9);
    expect([tops(bare), bottoms(bare)]).toEqual([2, 0]);
    expect(names(bare)).toBe(true);
    expect(bare.filter((l) => l.includes('queued')).length).toBe(3);
    expect(bare.filter((l) => /(alpha|beta)-explorer/.test(l))).toHaveLength(2);
    const win = at(7); // then the agents are windowed (the count rides the ribbon) before a plan row folds
    expect(names(win)).toBe(true);
    expect(win.filter((l) => l.includes('queued')).length).toBe(3);
    expect(win.filter((l) => /(alpha|beta)-explorer/.test(l))).toHaveLength(1);
    const packed = at(6); // then plan rows fold into the title count, one wording
    expect(packed.filter((l) => l.includes('queued')).length).toBe(2);
    expect(packed[0]).toMatch(/0\/3 · \+1 more/);
    expect(names(packed)).toBe(true);
  });
  test('B4: a doubled verb draws once in the LAST column', () => {
    const out = text(agentRows([row({ name: 'alpha-explorer', tasks: [1], tool: 'read Read alpha.py' })], opts(110), full));
    expect(out[2]).toContain('T1      -       read alpha.py'); // TASK is a fixed 7-cell column, LAST the elapsed clock (a dash with no start), then RESULT draws the verb once
    expect(out[2]).not.toContain('Read');
    expect(out[2]).not.toContain('read alpha.py read alpha.py');
  });
  test('B4: a 53-cell LAST fits whole at 110 on the fixed grid (critique 19 B2: the model column no longer gives or takes slack)', () => {
    const last = 'one two three four five six seven eight nine tenth ab'; // 53 cells: LAST starts at 52 of 110
    const out = text(agentRows([row({ name: 'alpha-explorer', task: 'read alpha.py', tool: last })], opts(110), full));
    expect(out[2]).toContain(last);
    expect(out[2]).not.toContain('...');
    expect(textWidth(out[2]!)).toBeLessThanOrEqual(110);
  });
  test('B4: a done agent keeps its LAST text (the row turning done does not blank it)', () => {
    const out = text(agentRows([row({ name: 'alpha-explorer', state: 'done', task: 'read alpha.py', tool: 'read runs.ts:17' })], opts(110), full));
    expect(out[2]).toContain('done');
    expect(out[2]).toContain('read runs.ts:17');
  });
});

describe('critique 11 C4: the TODO box', () => {
  const live = (): TodoRow[] => [
    { label: 'T1 read alpha.py (alpha-explorer)', state: 'done', detail: 'alpha-explorer', focus: false },
    { label: 'T2 read beta.py (beta-explorer)', state: 'running', detail: 'beta-explorer', focus: true },
    { label: 'T4 combine the three reports', state: 'queued', detail: 'wave one', focus: false },
  ];
  test('the owner is not printed twice: a detail the title already names is dropped (live-110-5d6a53ef-1 f0072 row 22)', () => {
    const out = text(todoRows(live(), opts(110), full));
    expect(out[1]).toContain('(alpha-explorer)');
    expect(out[1]!.match(/alpha-explorer/g)!.length).toBe(1);
    expect(out[2]!.match(/beta-explorer/g)!.length).toBe(1);
    expect(out[3]).toContain('wave one'); // a detail the title does not say stays
  });
  test('the title rule of every block runs to the last cell, so the host\'s [-] ends it (live PNGs: [-] floated past a gap); the count and meter sit inside it', () => {
    for (const cols of [80, 110, 150]) {
      const first = fitStack({ todos: live(), agents: [] }, opts(cols), 10)[0]!;
      expect(runsString(first)).toMatch(/ ▰+▱* ─+╮$/);
      expect(textWidth(runsString(first))).toBe(cols);
    }
    const second = fitStack({ todos: live(), agents: worldAgents() }, opts(110), 20).find((r) => runsString(r).includes('SUBAGENTS'))!;
    expect(runsString(second)).toMatch(/ ─+╮$/);
    expect(textWidth(runsString(second))).toBe(110);
  });
  test('a 110 column budget of 13 rows keeps all 5 plan rows, the column names, both closing rules and 3 agents; the blank is the row that goes (round 5)', () => {
    const todos: TodoRow[] = [1, 2, 3, 4, 5].map((i) => ({ label: `T${i} item`, state: 'queued', detail: '', focus: false }));
    const agents = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map((name): AgentRow => ({ name, state: 'done', model: 'haiku', tasks: [], tool: 'read x.py', ctx: null, focus: false }));
    const out = text(fitStack({ todos, agents }, opts(110), 13));
    expect(out.length).toBe(13);
    expect(out[6]).toMatch(/^╰─+╯$/);
    expect(out[7]).toContain('SUBAGENTS'); // no blank between the boxes
    expect(out[8]).toMatch(/^ {4}AGENT +STATE/);
    expect(out.filter((l) => /^╰─+╯$/.test(l))).toHaveLength(2);
    expect(out.filter((l) => l.includes('queued')).length).toBe(5); // all five plan rows still show
    expect(out.filter((l) => /explorer +done/.test(l))).toHaveLength(3);
    expect(text(fitStack({ todos, agents }, opts(110), 14))).toHaveLength(14); // one more row: the blank returns
  });
});
