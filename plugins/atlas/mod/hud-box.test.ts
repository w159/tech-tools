// Round 3, slice B (critique 21): the HUD as two boxes. A gutter before STATE, `…` and never `...`, a LAST that is never blank or raw at 110, a closing rule and a blank
// between the blocks at 110, and a SUBAGENTS row on the first snapshot that names a worker (hud_subagents 89.5% at 150).
import { describe, expect, test } from 'claude-code/testing';
import { runsCells, runsString, type Run, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { agentRows, clipEll, fitStack, todoRows, type AgentRow, type TodoRow } from './hud-surface';
import { hudLines, namedAgents, type HudAgent } from './hud';
import { Motion, MOTION_MS } from './motion';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const full = { spacers: true, extras: false, close: true };
const agent = (over: Partial<AgentRow> = {}): AgentRow => ({ name: 'alpha-explorer', state: 'running', model: 'haiku', tasks: [1], tool: 'read alpha.py', ctx: null, focus: false, ...over });
const text = (rows: Run[][]): string[] => rows.map(runsString);

describe('SUBAGENTS: the AGENT column keeps a gutter before STATE', () => {
  test('at least two cells separate the longest name from the state word, at every width and name length', () => {
    for (const cols of [150, 110, 80, 61]) {
      for (const name of ['a', 'alpha-explorer', 'implementer-capture-harness', 'x'.repeat(19)]) {
        const rows = agentRows([agent({ name }), agent({ name: 'beta', state: 'done' })], { cols, ui }, full);
        const row = text(rows)[2]!; // [title, column names, first agent]
        const nameEnd = 4 + [...name].length;
        const at = row.indexOf('running');
        expect([cols, name, at - nameEnd >= 2 || at === -1]).toEqual([cols, name, true]);
        expect([cols, name, text(rows)[1]!.indexOf('STATE') - nameEnd >= 2]).toEqual([cols, name, true]);
      }
    }
  });
  test('a name that alone overflows the row is cut with a one-cell `…`, the state word still whole after the gutter', () => {
    const row = text(agentRows([agent({ name: 'x'.repeat(90) })], { cols: 80, ui }, full))[2]!;
    expect(row).toMatch(/x…\s{2,}running/);
    expect(row).not.toContain('...');
  });
});

describe('truncation is `…`, never `...`, in every cell of both blocks', () => {
  const long = (n: number): TodoRow[] => Array.from({ length: n }, (_, i) => ({ label: `Item ${i + 1} ${'with a very long title '.repeat(6)}`, state: i === 1 ? 'running' : 'queued', detail: `owner-number-${i + 1}-with-a-long-name`, focus: i === 1 }));
  test('TODO titles and details, SUBAGENTS names, tasks and LAST, from 150 down to 40 columns', () => {
    for (const cols of [150, 110, 80, 61, 40]) {
      const rows = [
        ...text(todoRows(long(3), { cols, ui }, full)),
        ...text(agentRows([agent({ name: 'implementer-capture-harness-extra-long', tool: 'a very long sentence that cannot possibly fit in the last column of a narrow row' }), agent({ name: 'b' })], { cols, ui }, full)),
      ];
      expect([cols, rows.filter((r) => r.includes('...'))]).toEqual([cols, []]);
      for (const r of rows) expect(runsCells([{ t: r, tone: 'text' }])).toBeLessThanOrEqual(cols);
    }
  });
  test('clipEll: whole when it fits, else n cells ending in one `…`', () => {
    expect(clipEll('abc', 3)).toBe('abc');
    expect(clipEll('abcdef', 4)).toBe('abc…');
    expect(clipEll('abcdef', 1)).toBe('…');
    expect(clipEll('abcdef', 0)).toBe('');
  });
});

describe('LAST is never blank or raw (critique 21: `first 3` and an empty cell at 110)', () => {
  const lasts = (cols: number, rows: AgentRow[]): string[] => text(agentRows(rows, { cols, ui }, full)).slice(2, -1).map((r) => r.trimEnd());
  test('a text that does not fit whole is cut on a word with `…`, or reads the state word', () => {
    const rows = [
      agent({ name: 'alpha-explorer', state: 'done', tool: 'first 3 lines of the file were returned to the lead' }),
      agent({ name: 'beta-explorer', state: 'running', tool: 'no-spaces-in-this-one-long-word-at-all-really' }),
      agent({ name: 'gamma-explorer', state: 'failed', tool: '' }),
    ];
    for (const cols of [150, 110, 90, 80]) {
      for (const [i, line] of lasts(cols, rows).entries()) {
        const last = line.split(/\s{2,}/).at(-1)!;
        expect([cols, i, last.length > 0]).toEqual([cols, i, true]);
        expect([cols, i, /^\w+$/.test(last) || last === '-' || last.endsWith('…') || rows[i]!.tool.startsWith(last)]).toEqual([cols, i, true]); // a whole text, a cut with a mark, a word, or the dash
        expect([cols, i, /\S\.\.\.$/.test(last)]).toEqual([cols, i, false]);
      }
    }
  });
  test('a worker with nothing to say reads its last tool or `-`, never the state word again; a text of one unbreakable word that cannot fit is cut with `…`, not swapped (critique 22)', () => {
    const rows = [agent({ name: 'alpha-explorer', state: 'done', tool: '' }), agent({ name: 'beta-explorer', state: 'running', tool: 'x'.repeat(60) }), agent({ name: 'gamma-explorer', state: 'done', tool: '', fallback: 'read' })];
    const [a, b, c] = lasts(80, rows);
    expect(a!.endsWith(' -')).toBe(true);
    expect(b!.endsWith('…')).toBe(true);
    expect(b!).not.toContain('running  running');
    expect(c!.endsWith(' read')).toBe(true);
  });
});

describe('the boxes at 110: a closing rule and a blank between the blocks', () => {
  const todos: TodoRow[] = [1, 2, 3].map((i) => ({ label: `T${i} item`, state: i === 1 ? 'done' : 'queued', detail: '', focus: false }));
  const edge = `╰${'─'.repeat(108)}╯`;
  test('with the rows to spare: TODO, its closing rule, one blank, SUBAGENTS, its closing rule', () => {
    const out = text(fitStack({ todos, agents: [agent()] }, { cols: 110, ui }, 20));
    const at = out.findIndex((r) => r.includes('SUBAGENTS'));
    expect(out[at - 1]).toBe('');
    expect(out[at - 2]).toBe(edge);
    expect(out.at(-1)).toBe(edge);
    expect(out.filter((r) => r === '')).toHaveLength(1);
  });
  test('short of rows (critique 28) the blank goes first, then the column names, then the finished rows fold, then plan rows; every box stays closed and the agent keeps its row', () => {
    const rows = (n: number): string[] => text(fitStack({ todos, agents: [agent()] }, { cols: 110, ui }, n));
    const tops = (out: string[]): number => out.filter((r) => r.startsWith('╭─ ') && r.endsWith('╮')).length;
    const names = (out: string[]): boolean => out.some((r) => /AGENT\s+STATE/.test(r));
    expect(rows(20)).toHaveLength(10); // title, 3 rows, rule, blank, title, names, 1 agent, rule
    const nine = rows(9); // the blank goes; all three plan rows, the names and both rules stay
    expect(tops(nine)).toBe(2);
    expect(nine.filter((r) => r === edge)).toHaveLength(2);
    expect(nine.filter((r) => /T\d item/.test(r))).toHaveLength(3);
    expect(nine.filter((r) => r === '')).toEqual([]);
    expect(names(nine)).toBe(true);
    expect(nine[0]).not.toMatch(/done/);
    const eight = rows(8); // the column names go before a plan row folds; the boxes stay closed
    expect(tops(eight)).toBe(2);
    expect(eight.filter((r) => r === edge)).toHaveLength(2);
    expect(names(eight)).toBe(false);
    expect(eight[0]).not.toMatch(/done/);
    expect(eight.filter((r) => /T\d item/.test(r))).toHaveLength(3);
    const seven = rows(7); // then the finished row folds into the count on the title
    expect(seven[0]).toMatch(/1 done/);
    expect(seven.filter((r) => /T[23] item/.test(r))).toHaveLength(2);
    const six = rows(6); // then plan rows are cut, and the title says so, in one wording at every width
    expect(six[0]).toMatch(/\+\d+ more/);
    expect(tops(six)).toBe(2);
    const four = rows(4); // the agent keeps its row and its closed box; the plan box goes whole
    expect(tops(four)).toBe(1);
    expect(four.filter((r) => /alpha-explorer/.test(r))).toHaveLength(1);
    expect(four.at(-1)).toBe(edge);
  });
});

describe('a SUBAGENTS row on the first snapshot that names a worker', () => {
  const dispatch = (owner: string, status = 'in_progress'): TodoItem => ({ id: `d-${owner}`, content: `Read ${owner}`, status, owner, origin: 'dispatch' }) as unknown as TodoItem;
  const hud = (todos: TodoItem[], agents: HudAgent[] = []): string[] => hudLines({ todos, agents }, { cols: 110, maxRows: 30, ui, now: 0 }).map(runsString);
  test('an open dispatch row with no listed worker draws a queued row before the squad or an event lists it', () => {
    const rows = hud([dispatch('alpha-explorer')]);
    expect(rows.some((r) => r.includes('SUBAGENTS'))).toBe(true);
    expect(rows.find((r) => r.includes('alpha-explorer'))).toMatch(/◇ alpha-explorer\s+queued/);
  });
  test('it never doubles a listed worker (by name, host key or retry), never names lead, and a finished dispatch row names nobody', () => {
    const listed: HudAgent = { name: 'alpha-explorer', role: 'explorer', state: 'working', ui: 'running', since: 0 };
    expect(namedAgents([dispatch('alpha-explorer')], [listed])).toEqual([]);
    expect(namedAgents([dispatch('alpha-explorer')], [{ ...listed, name: 'alpha-explorer #2' }])).toEqual([]);
    expect(namedAgents([dispatch('hash-1')], [{ ...listed, name: 'alpha', key: 'hash-1' }])).toEqual([]);
    expect(namedAgents([dispatch('lead'), dispatch('lead-a3a3ab')], [])).toEqual([]);
    expect(namedAgents([dispatch('alpha-explorer', 'completed')], [])).toEqual([]);
    expect(namedAgents([{ id: 'p1', content: 'T1 plan row', status: 'in_progress', owner: 'alpha-explorer' } as unknown as TodoItem], [])).toEqual([]); // a plan row's owner is not a dispatch
    expect(namedAgents([dispatch('b-explorer'), dispatch('b-explorer')], []).map((a) => a.name)).toEqual(['b-explorer']);
  });
  test('the row replaces itself with the real worker the moment the squad lists it (one row, not two)', () => {
    const rows = hud([dispatch('alpha-explorer')], [{ name: 'alpha-explorer', role: 'explorer', state: 'working', ui: 'running', since: 0, model: 'haiku' }]);
    expect(rows.filter((r) => r.includes('alpha-explorer'))).toHaveLength(1);
    expect(rows.find((r) => r.includes('alpha-explorer'))).toMatch(/◐ alpha-explorer\s+running/);
  });
});

describe('the done flash is the disc stepping from bright to ok on a SUBAGENTS row too', () => {
  test('no ring pop at any beat; the glyph is ● throughout and its colour ends on the done tone', () => {
    const row = (state: 'running' | 'done'): AgentRow => agent({ key: 'agent:a', state });
    const mo = new Motion(true);
    mo.observe('agents', [{ key: 'agent:a', state: 'running' }], 0);
    mo.observe('agents', [{ key: 'agent:a', state: 'done' }], 1000);
    const glyphs = [1000, 1200, 1400, 1600].map((now) => {
      const r = agentRows([row('done')], { cols: 110, ui, motion: mo.ctx(now)! }, full)[2]!;
      return r[2]!.t;
    });
    expect(glyphs).toEqual(['●', '●', '●', '●']);
    const rest = agentRows([row('done')], { cols: 110, ui, motion: mo.ctx(1000 + MOTION_MS)! }, full)[2]!;
    expect(rest[2]!.tone).toBe('ok');
  });
});
