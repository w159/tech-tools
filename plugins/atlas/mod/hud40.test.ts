// State 40: the TODO summary row, the lead item, the SUBAGENTS table while agents run, its LAST text and TIME clock (critique 39).
import { describe, expect, test } from 'claude-code/testing';
import { runsString, type Run, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { hudLines, resetLeadItems, type HudAgent, type HudInput } from './hud';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const NOW = 5_000_000;
const text = (rows: readonly (readonly Run[])[]): string[] => rows.map((r) => runsString([...r]).trimEnd());
const item = (i: number, status: string, content: string, owner?: string, extra: Record<string, unknown> = {}): TodoItem => ({ id: `t${i}`, content, status, ...(owner ? { owner } : {}), ...extra }) as unknown as TodoItem;
const agent = (name: string, state: string, ui_: string, extra: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: ui_ as never, model: 'haiku', since: NOW - 20_000, ...extra }) as HudAgent;
const view = (cols: number, maxRows: number, extra: Record<string, unknown> = {}) => ({ cols, maxRows, ui, now: NOW, ...extra });

describe('1. the summary row counts every hidden state apart', () => {
  // stoprun-110-1/f0074: T2 was closed by the lead over a failed worker; the title reads `4/5 · ■1` and the hidden rows were `● 3 done`.
  const todos = [item(1, 'completed', 'T1 read alpha.py', 'alpha-explorer'), item(2, 'completed', 'T2 read ghost.py', 'ghost-explorer'), item(3, 'completed', 'T3 read beta.py', 'beta-explorer'), item(4, 'completed', 'T4 combine the reports'), item(5, 'pending', 'T5 write the summary')];
  const agents = [agent('alpha-explorer', 'done', 'done'), agent('ghost-explorer', 'failed', 'failed'), agent('beta-explorer', 'done', 'done')];
  const input: HudInput = { todos, agents };
  for (const cols of [93, 56]) {
    test(`${cols} cells: a failed item is never folded into the done count; failed rows hide after the done and queued ones`, () => {
      const rows = text(hudLines(input, view(cols, 9, { merge: false })));
      const summary = rows.find((r) => /^ {2}\S \d+ (?:more )?(?:done|failed|queued)/.test(r))!;
      expect(summary, rows.join('\n')).toBeDefined();
      expect(summary).toMatch(/● \d+ done/);
      const shown = rows.filter((r) => /^[▸ ] [◐◓◑◒◇●■▲◉] T\d/.test(r));
      const counted = [...summary.matchAll(/(\d+) (?:more )?(?:queued|running|done|failed)/g)].reduce((n, m) => n + Number(m[1]), 0);
      expect(shown.length + counted, rows.join('\n')).toBe(5);
      expect(rows.find((r) => /▸ TODO/.test(r))).toMatch(/3\/5 · ■1/);
      const failedDrawn = shown.some((r) => /^[▸ ] ■ T2/.test(r));
      expect(failedDrawn || /■ 1 failed/.test(summary), rows.join('\n')).toBe(true); // the failed row is drawn, or counted as failed: never as done
      if (/◇ \d+ queued/.test(summary)) expect(failedDrawn, rows.join('\n')).toBe(true); // queued rows go before a failed one is hidden
    });
  }
  test('with the failed row hidden the summary reads `● 3 done  ■ 1 failed  ◇ 1 queued`, each glyph in its own colour', () => {
    const lines = hudLines(input, view(93, 8, { merge: false }));
    const row = lines.find((r) => /^ {2}\S \d+ (?:done|failed|queued)/.test(runsString([...r])))!;
    expect(row, text(lines).join('\n')).toBeDefined();
    const glyphs = row.filter((x) => ['●', '■', '◇'].includes(x.t));
    expect(glyphs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(glyphs.map((x) => x.tone)).size).toBe(glyphs.length);
    expect(runsString([...row]).trim()).toBe('● 3 done  ■ 1 failed  ◇ 1 queued');
    const words = row.filter((x) => /failed/.test(x.t));
    for (const w of words) expect(w.tone).toBe('bad');
  });
});

describe('2. the lead item reads running while the host turn is on, and never queued once work on it began', () => {
  // live-150-1/f0052: T1-T3 done by workers, T4 and T5 pending in the store (the lead never writes in_progress), the host is Transmuting.
  const todos = [item(1, 'completed', 'T1 read alpha.py (alpha-explorer)'), item(2, 'completed', 'T2 read beta.py (beta-explorer)'), item(3, 'completed', 'T3 read gamma.py (gamma-explorer)'), item(4, 'pending', 'T4 combine the three reports'), item(5, 'pending', 'T5 write the final summary')];
  const agents = ['alpha', 'beta', 'gamma'].map((n) => agent(`${n}-explorer`, 'done', 'done', { startedAt: NOW - 30_000, since: NOW - 15_000 }));
  const rowOf = (rows: readonly string[], t: string): string => rows.find((r) => new RegExp(`^[▸ ] \\S ${t} `).test(r))!;
  test('while the host works T4 (the first open row, nobody else owns it) reads running with the lead, and T5 stays queued', () => {
    resetLeadItems();
    const rows = text(hudLines({ todos, agents }, view(150, 30, { working: true })));
    expect(rowOf(rows, 'T4'), rows.join('\n')).toMatch(/^▸ [◐◓◑◒] T4 combine the three reports\s+running\s+lead/);
    expect(rowOf(rows, 'T5')).toMatch(/^ {2}◇ T5 .*queued/);
  });
  test('without the host turn the same rows keep the store state: T4 queued', () => {
    resetLeadItems();
    const rows = text(hudLines({ todos, agents }, view(150, 30, {})));
    expect(rowOf(rows, 'T4')).toMatch(/◇ T4 .*queued/);
  });
  test('once T4 has run it never reads queued again: the turn ends with it open and it reads waiting', () => {
    resetLeadItems();
    hudLines({ todos, agents }, view(150, 30, { working: true }));
    const rows = text(hudLines({ todos, agents }, view(150, 30, { working: false })));
    expect(rowOf(rows, 'T4'), rows.join('\n')).toMatch(/T4 .*waiting/);
    expect(rowOf(rows, 'T5')).toMatch(/◇ T5 .*queued/);
  });
  test('an item a worker owns is never taken over: the first open row is the worker row and the lead row stays queued', () => {
    resetLeadItems();
    const open = [item(1, 'pending', 'T1 read alpha.py (alpha-explorer)'), item(2, 'pending', 'T2 combine the reports')];
    const rows = text(hudLines({ todos: open, agents: [agent('alpha-explorer', 'working', 'running', { startedAt: NOW - 5000 })] }, view(150, 30, { working: true })));
    expect(rowOf(rows, 'T1')).toMatch(/running\s+alpha-explorer/);
    expect(rowOf(rows, 'T2')).toMatch(/queued/);
  });
  test('a finished plan forgets the items: the next plan starts clean', () => {
    resetLeadItems();
    const all = todos.map((t) => ({ ...t, status: 'completed' }) as TodoItem);
    hudLines({ todos: all, agents }, view(150, 30, { working: true }));
    const rows = text(hudLines({ todos, agents }, view(150, 30, { working: false })));
    expect(rowOf(rows, 'T4')).toMatch(/◇ T4 .*queued/);
  });
});

describe('4. LAST is the last tool action: verb and the target`s base name, never the dispatch title', () => {
  const todos = [item(1, 'completed', 'T1 read alpha.py (alpha-explorer)'), item(2, 'in_progress', 'T2 read beta.py (beta-explorer)'), item(3, 'in_progress', 'T3 find defs (gamma-explorer)')];
  const title = (n: string): string => `${n}-explorer: read ${n}.py`;
  const agents = [
    agent('alpha-explorer', 'done', 'done', { startedAt: NOW - 30_000, lastTool: 'Read', target: '/home/user/tech-tools/plugins/alpha.py', task: title('alpha'), lastLine: title('alpha') }),
    agent('beta-explorer', 'working', 'running', { startedAt: NOW - 9_000, tool: 'Edit', target: 'src/deep/beta.py', task: title('beta'), lastLine: title('beta') }),
    agent('gamma-explorer', 'working', 'running', { startedAt: NOW - 8_000, tool: 'Grep', target: 'def', task: title('gamma'), lastLine: title('gamma') }),
  ];
  const lastOfRow = (rows: readonly string[], who: string): string => rows.find((r) => new RegExp(`^ {2}${who}\\S* +\\S`).test(r))!;
  for (const cols of [150, 56]) {
    test(`${cols} cells: done, running and searching rows read \`read alpha.py\`, \`edit beta.py\`, \`grep def\`; none repeats the dispatch title`, () => {
      const rows = text(hudLines({ todos, agents, root: '/home/user/tech-tools' }, view(cols, 30, { merge: true })));
      expect(lastOfRow(rows, 'alpha-'), rows.join('\n')).toMatch(/read alpha\.py$/);
      expect(lastOfRow(rows, 'beta-')).toMatch(/edit beta\.py$/);
      expect(lastOfRow(rows, 'gamma-')).toMatch(/grep def$/);
      for (const r of rows) expect(r).not.toMatch(/explorer: read/);
    });
  }
  test('a worker with no call and a closing line that is its own dispatch title reads `finished`, not the title', () => {
    const bare = [agent('alpha-explorer', 'done', 'done', { task: title('alpha'), lastLine: title('alpha') })];
    const rows = text(hudLines({ todos: [item(1, 'completed', 'T1 read alpha.py (alpha-explorer)')], agents: bare }, view(150, 30, { merge: true })));
    expect(lastOfRow(rows, 'alpha-')).toMatch(/finished$/);
  });
  test('at 56 cells LAST holds 14 cells or more and a long target is cut, never the verb', () => {
    const long = [agent('alpha-explorer', 'working', 'running', { startedAt: NOW - 9_000, tool: 'Read', target: 'a_rather_long_file_name_for_the_parser.py' })];
    const rows = text(hudLines({ todos: [item(1, 'in_progress', 'T1 read it (alpha-explorer)')], agents: long }, view(56, 30, { merge: true })));
    const head = rows.find((r) => /AGENT\s+STATE/.test(r))!;
    expect(56 - 1 - head.indexOf('LAST')).toBeGreaterThanOrEqual(14);
    const last = lastOfRow(rows, 'alpha-').slice(head.indexOf('LAST'));
    expect(last, rows.join('\n')).toMatch(/^read a_\S*…$/);
  });
});

describe('3. SUBAGENTS lists every running worker while any runs; its TIME is the render clock minus the start', () => {
  // live-150-1/f0040: three agents running, 12 slot rows: the table folded to a title on the plan's rule.
  const plan = [item(1, 'pending', 'T1 read alpha.py (alpha-explorer)'), item(2, 'pending', 'T2 read beta.py (beta-explorer)'), item(3, 'pending', 'T3 read gamma.py (gamma-explorer)'), item(4, 'pending', 'T4 combine the three reports'), item(5, 'pending', 'T5 write the final summary')];
  const run3 = ['alpha', 'beta', 'gamma'].map((n, i) => agent(`${n}-explorer`, 'working', 'running', { startedAt: NOW - 9000 + i * 1000, lastTool: 'Read', target: `${n}.py` }));
  const subRows = (rows: readonly string[]): string[] => rows.filter((r) => /^ {2}[a-z]+-explorer {2,}\S (?:running|done|failed)/.test(r));
  for (const budget of [14, 13, 12, 11]) {
    test(`3 running, ${budget} rows: the SUBAGENTS title with its tally and a row per running worker, never a bare title`, () => {
      const rows = text(hudLines({ todos: plan, agents: run3 }, view(150, budget, { working: true })));
      expect(rows.length).toBeLessThanOrEqual(budget);
      const title = rows.find((r) => /^╭─.*▸ SUBAGENTS/.test(r));
      expect(title, rows.join('\n')).toMatch(/3 running/);
      expect(subRows(rows), rows.join('\n')).toHaveLength(3);
      expect(rows.filter((r) => /^[▸ ] [◐◓◑◒] T\d/.test(r)).length).toBeGreaterThanOrEqual(1);
    });
  }
  test('10 rows cannot hold the plan box and a row per worker: every running plan row stays and SUBAGENTS is one title row with its tally', () => {
    const rows = text(hudLines({ todos: plan, agents: run3 }, view(150, 10, { working: true })));
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows.filter((r) => /^[▸ ] [◐◓◑◒] T\d/.test(r))).toHaveLength(3);
    expect(rows.find((r) => /▸ SUBAGENTS/.test(r)), rows.join('\n')).toMatch(/3 running/);
  });
  test('one done and two running at a tight slot: the done row folds first, onto the summary row inside the box', () => {
    const mixed = [agent('alpha-explorer', 'done', 'done', { startedAt: NOW - 20_000, since: NOW - 9_000 }), run3[1]!, run3[2]!];
    const todos = [item(1, 'completed', 'T1 read alpha.py (alpha-explorer)'), ...plan.slice(1)];
    const rows = text(hudLines({ todos, agents: mixed }, view(150, 10, { working: true })));
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(subRows(rows).filter((r) => /running/.test(r)), rows.join('\n')).toHaveLength(2);
    const title = rows.findIndex((r) => /^╭─.*▸ SUBAGENTS/.test(r));
    expect(rows.slice(title).some((r) => /^ {2}alpha-explorer {2,}● done/.test(r) || /^ {2}● 1 done/.test(r)), rows.join('\n')).toBe(true);
  });
  test('with room the column names and every row stay (the tight forms are only for a short slot)', () => {
    const rows = text(hudLines({ todos: plan, agents: run3 }, view(150, 30, { working: true })));
    expect(rows.some((r) => /AGENT\s+STATE\s+TIME\s+CALLS\s+FN\s+LAST/.test(r))).toBe(true);
  });
  test('TIME is the render clock minus the worker start on every render, not the snapshot clock', () => {
    const born = [agent('alpha-explorer', 'working', 'running', { startedAt: NOW - 10_000 })];
    const todos = [item(1, 'pending', 'T1 read alpha.py (alpha-explorer)')];
    const at = (extra: Record<string, unknown>): string => text(hudLines({ todos, agents: born }, view(150, 30, { now: NOW - 2_500, ...extra }))).find((r) => /^ {2}alpha-explorer {2,}\S running/.test(r))!;
    expect(at({})).toMatch(/running\s+0:07\b/); // no render clock: the snapshot's
    expect(at({ clock: NOW })).toMatch(/running\s+0:10\b/); // the render clock, 2.5 s newer than the snapshot
    expect(at({ clock: NOW + 1_000 })).toMatch(/running\s+0:11\b/); // and it moves with every render
    const rows = text(hudLines({ todos, agents: born }, view(150, 30, { now: NOW - 2_500, clock: NOW })));
    expect(rows.find((r) => /T1 read alpha.py/.test(r))).toMatch(/alpha-explorer\s+0:10$/); // the TODO row and the table never disagree
  });
});
