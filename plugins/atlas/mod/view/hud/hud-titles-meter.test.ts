// Rev 5 HUD (slice B): plain titles with a thin rule and a right-aligned meter, the dim done rows, one spinner phase, the column header that
// stays while the grid shows, and a LAST that is never blank. Live shape: stoprun-150-4b5b5a94-1/frames/f0075.ans:24-35 (TODO 0/5 with two
// running rows out of phase, SUBAGENTS without its column header, ragged `killed`).
import { describe, expect, test } from 'claude-code/testing';
import { cells, leadSpinnerGlyph, rowWordTone, runsString, spinClock, spinFrameOf, type Run, type Ui } from '../../design/atlas-ui';
import type { TodoItem } from '../../contract';
import { hudLines, type HudAgent } from './hud';
import { rowSpinnerGlyph } from './hud-surface';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
const NOW = 5_000_000;
const todo = (n: number, state: (i: number) => string, owner: (i: number) => string | undefined = () => undefined): TodoItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, content: `T${i + 1} step ${i + 1}`, status: state(i), ...(owner(i) ? { owner: owner(i) } : {}) }) as unknown as TodoItem);
const ag = (name: string, state: string, over: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: state === 'working' ? 'running' : (state as never), model: 'haiku', since: NOW - 1000, ...over });
const rows = (todos: TodoItem[], agents: HudAgent[], o: { cols?: number; maxRows?: number; ui?: Ui; tick?: number } = {}): Run[][] =>
  hudLines({ todos, agents }, { merge: false, cols: o.cols ?? 150, maxRows: o.maxRows ?? 30, ui: o.ui ?? ui, now: NOW, ...(o.tick !== undefined ? { tick: o.tick } : {}) });
const text = (r: Run[]): string => runsString(r);

describe('title rows: a plain title, the count and the meter inside a thin rule that runs to the edge', () => {
  const t = rows(todo(5, (i) => (i < 3 ? 'completed' : 'pending')), []);
  test('TODO, then the count and the one-cell-per-item bar at the right end of the rule, a thin rule to the last cell where the host draws its marker, no heavy rule', () => {
    const head = text(t[0]!);
    expect(head).toMatch(/^╭─ TODO ─+ 3\/5 ▰{3}▱{2} ─╮$/);
    expect(cells(head)).toBe(150);
    expect(head).not.toContain('━');
  });
  test('the header is quiet: no breadcrumb, the title is bold body text, the rule and the corners 240, and no run of the header is a filled chip (critique 22)', () => {
    const head = t[0]!;
    const title = head.find((x) => x.t === 'TODO')!;
    expect([title.tone, title.bold]).toEqual(['text', true]);
    expect(text(head)).not.toContain(' ◆ ATLAS ');
    expect(head.filter((x) => x.chip === true || x.bg !== undefined)).toEqual([]);
    const rule = head.find((x) => /^─{6,}$/.test(x.t))!;
    expect([rule.tone, rule.fg]).toEqual(['dim', '#585858']);
    expect(text(head).startsWith('╭─ ')).toBe(true);
    const sub = rows(todo(2, () => 'pending'), [ag('alpha-explorer', 'working')]).find((r) => text(r).includes('SUBAGENTS'))!;
    expect(sub.filter((x) => x.chip === true || x.bg !== undefined)).toEqual([]);
  });
  test('the bar is one cell per item, full only when every item is done, and never empty once one is', () => {
    const meter = (done: number, n: number): string => text(rows(todo(n, (i) => (i < done ? 'completed' : 'pending')), [])[0]!).match(/[▰▱]+/)![0];
    expect(meter(0, 5)).toBe('▱'.repeat(5));
    expect(meter(5, 5)).toBe('▰'.repeat(5));
    expect(meter(2, 5)).toBe('▰▰▱▱▱');
    expect(meter(1, 40)).toBe('▰' + '▱'.repeat(11)); // past 12 items the bar is scaled to 12 cells
    expect(meter(39, 40)).toBe('▰'.repeat(11) + '▱');
  });
  test('ASCII keeps the same cells: `#` and `-` for the bar, a `-` rule, no breadcrumb', () => {
    const head = text(rows(todo(5, (i) => (i < 3 ? 'completed' : 'pending')), [], { ui: ascii })[0]!);
    expect(head).toMatch(/^\+- TODO -+ 3\/5 #{3}-{2} -\+$/);
    expect(cells(head)).toBe(150);
  });
  test('the title row is exactly the width at every width, with or without the meter', () => {
    for (const cols of [40, 60, 80, 100, 110, 150]) expect([cols, cells(text(rows(todo(5, (i) => (i < 3 ? 'completed' : 'pending')), [], { cols })[0]!))]).toEqual([cols, cols]);
  });
});

describe('SUBAGENTS title: the working signal rides the title', () => {
  test('a running agent counts itself with a still bullet before the word, inside the rule; no running agent, no accent bullet', () => {
    const run = rows(todo(2, () => 'in_progress'), [ag('alpha-explorer', 'working')]);
    const head = text(run.find((r) => text(r).includes('SUBAGENTS'))!);
    expect(head).toContain('● 1 running ─╮'); // the counts sit at the right end of the top rule
    const idle = rows(todo(2, () => 'completed'), [ag('alpha-explorer', 'done')]);
    const idleHead = text(idle.find((r) => text(r).includes('SUBAGENTS'))!);
    expect(idleHead).toContain('✓ 1 done');
    expect(idleHead).not.toMatch(/[◐◓◑◒●]/);
  });
  test('the rows turn the shared spinner with the tick; the title stays still', () => {
    const at = (tick: number) => rows(todo(2, () => 'in_progress'), [ag('a-explorer', 'working')], { tick });
    for (const tick of [0, 1]) {
      const glyph = leadSpinnerGlyph(spinFrameOf(spinClock(NOW, tick), ''));
      const out = at(tick);
      expect(text(out.find((r) => text(r).includes('SUBAGENTS'))!)).toContain('● 1 running');
      expect(out.map(text).filter((r) => r.startsWith(`▌ ${glyph} `) || r.startsWith(`│ ${glyph} `)).length).toBe(3); // two TODO rows, one agent row
    }
    expect(leadSpinnerGlyph(spinFrameOf(spinClock(NOW, 0), ''))).not.toBe(leadSpinnerGlyph(spinFrameOf(spinClock(NOW, 1), '')));
  });
  test('critique 25: every running row keeps one circle quarter on the one clock, in every frame', () => {
    for (const tick of [0, 1, 2, 3]) {
      const out = rows(todo(2, () => 'in_progress'), [ag('a-explorer', 'working', { tool: 'Read', target: 'a.py' })], { tick });
      expect(out.filter((r) => !text(r).includes('SUBAGENTS')).map(text).join('\n')).not.toMatch(/[⠀-⣿]/); // the rows are glyph-parsed: circles only
      const marks = new Set(out.flatMap((r) => [...text(r)]).filter((c) => '◐◓◑◒'.includes(c)));
      expect(marks.size).toBe(1); // TODO rows and agent row on one frame
    }
  });
});

describe('rows: one phase, dim done rows, state words by weight', () => {
  const plan = todo(5, (i) => (i === 0 ? 'completed' : i === 1 || i === 2 ? 'in_progress' : 'pending'), (i) => ['alpha-explorer', 'beta-explorer', 'gamma-explorer'][i]);
  const agents = [ag('alpha-explorer', 'done', { lastTool: 'Read' }), ag('beta-explorer', 'working', { tool: 'Read', target: 'beta.py' }), ag('gamma-explorer', 'working', { tool: 'Read', target: 'gamma.py' })];
  const out = rows(plan, agents, { maxRows: 30 });
  test('every running glyph on every row of one frame is the same character (the critic counted out-of-phase spinners as a defect)', () => {
    const glyphOf = (r: Run[]): string => r[2]!.t; // border, blank, glyph
    const running = out.filter((r) => /\brunning\b/.test(text(r)) && !text(r).includes('SUBAGENTS') && !text(r).includes('TODO'));
    expect(running.length).toBe(4); // two TODO rows, two agent rows
    expect(new Set(running.map(glyphOf)).size).toBe(1);
  });
  test('a done row is quiet from its label to its detail, never struck through, and keeps its green disc (critique 21)', () => {
    const done = out.find((r) => text(r).includes('step 1'))!;
    const label = done.find((x) => x.t.includes('step 1'))!;
    expect([label.tone, label.strike ?? false, label.bold ?? false]).toEqual(['muted', false, false]);
    const word = done.find((x) => x.t.trim() === 'done')!;
    expect(word.tone).toBe('ok'); // the redesigned rows: the state word of a finished row is green, its label and clock dim
    expect(done.find((x) => x.t === '✓')!.tone).toBe('ok');
    const agent = out.find((r) => /^[│▌] [◐◓◑◒○✓✗▲◉] alpha-explorer\s/.test(text(r)))!;
    expect(agent.filter((x) => x.t.trim() !== '' && x.t !== '✓' && x.t.trim() !== 'done' && x.t.trim() !== 'explorer' && !/^[│]$/.test(x.t)).every((x) => x.tone === 'muted' || x.tone === 'sub')).toBe(true);
    expect(agent.find((x) => x.t === '✓')!.tone).toBe('ok'); // the agent row's glyph keeps the done colour while its text goes quiet
    expect(out.flat().some((x) => x.strike)).toBe(false);
  });
  test('the running state word is bold; failed is the error tone; a warning is never bold', () => {
    const run = out.find((r) => text(r).includes('step 2'))!.find((x) => x.t.trim() === 'running')!;
    expect([run.tone, run.bold ?? false]).toEqual(['accent', true]); // accent; bold only on the focus row (the first running row, step 2, is the focus)
    expect(out.find((r) => text(r).includes('step 3'))!.find((x) => x.t.trim() === 'running')!.bold).toBeUndefined();
    const dead = rows(todo(2, () => 'pending', (i) => (i === 0 ? 'ghost-explorer' : undefined)), [ag('ghost-explorer', 'failed', { lastTool: 'Read', target: 'ghost.py' })]);
    const failed = dead.find((r) => /^[│▌] [◐◓◑◒○✓✗▲◉] ghost-explorer\s/.test(text(r)))!.find((x) => x.t.trim() === 'failed')!; // critique 28: a failed agent that was in a call reads killed
    expect([failed.tone, failed.bold ?? false]).toEqual(['bad', false]);
    const warn = rows(todo(1, () => 'pending', () => 'ghost-explorer'), [ag('ghost-explorer', 'blocked')]).flatMap((r) => r).filter((x) => x.t.trim() === 'blocked' || x.t.trim() === 'waiting').at(-1)!; // the agent row (the plan row is the focus row, bold by design)
    expect([warn.tone, warn.bold ?? false]).toEqual([rowWordTone(warn.t.trim() === 'blocked' ? 'blocked' : 'waiting'), false]);
  });
});

describe('SUBAGENTS grid: the header stays while the grid shows; LAST and TASK are never blank', () => {
  const plan = todo(5, () => 'pending', (i) => (i < 3 ? ['alpha-explorer', 'ghost-explorer', 'beta-explorer'][i] : undefined));
  const agents = [ag('alpha-explorer', 'working', { tool: 'Read', target: 'alpha.py' }), ag('ghost-explorer', 'failed', { lastTool: 'Read', target: 'ghost.py' }), ag('beta-explorer', 'working', { tool: 'Read', target: 'beta.py' })];
  const planRows = (out: string[]): number => out.filter((r) => /^[│▌] [◐◓◑◒○✓✗▲◉] T[1-5] /.test(r)).length;
  const agentLines = (out: string[]): number => out.filter((r) => /^[│▌] [◐◓◑◒○✓✗▲◉] \w+-explorer\s+\S+\s+(running|failed|killed)/.test(r)).length;
  const corners = (out: string[]): [number, number] => [out.filter((r) => r.startsWith('╭─ ') && r.endsWith('╮')).length, out.filter((r) => r.startsWith('╰') && r.endsWith('╯')).length];
  test('14 rows for 5 todos and 3 agents keep every row, both column-name rows and both closed boxes, with no blank row between them', () => {
    const out = rows(plan, agents, { maxRows: 14 }).map(text);
    expect(out).toHaveLength(14);
    expect(out.some((r) => /AGENT\s+ROLE\s+STATE\s+NOW/.test(r))).toBe(true);
    expect(out.some((r) => /ITEM\s+STATE\s+OWNER/.test(r))).toBe(true);
    expect(out.filter((r) => r.trim() === '')).toHaveLength(0);
    expect(agentLines(out)).toBe(3);
    expect(planRows(out)).toBe(5);
    expect(corners(out)).toEqual([2, 2]);
  });
  test('at 13 and 12 rows the column names go together, never a closing rule: both boxes stay closed and the five plan rows and the three agents stay (critique 28)', () => {
    const thirteen = rows(plan, agents, { maxRows: 13 }).map(text);
    expect(thirteen).toHaveLength(12);
    expect(thirteen.some((r) => /AGENT\s+ROLE\s+STATE/.test(r))).toBe(false);
    expect(thirteen.filter((r) => r.trim() === '')).toHaveLength(0);
    expect(corners(thirteen)).toEqual([2, 2]);
    const out = rows(plan, agents, { maxRows: 12 }).map(text);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.some((r) => /AGENT\s+ROLE\s+STATE/.test(r))).toBe(false);
    expect(out.filter((r) => r.trim() === '')).toHaveLength(0);
    expect(corners(out)).toEqual([2, 2]); // critique 28: a box is closed at every agent count
    expect(out.filter((r) => r.startsWith('── ') && /(TODO|SUBAGENTS)/.test(r))).toHaveLength(0);
    for (const o of [thirteen, out]) {
      expect(agentLines(o)).toBe(3);
      expect(planRows(o)).toBe(5);
    }
  });
  test('a tighter slot folds plan rows onto one summary row inside the TODO box (open rows first) and keeps every agent row; both boxes stay closed (critique 28)', () => {
    const out = rows(plan, agents, { maxRows: 9 }).map(text);
    expect(out.length).toBeLessThanOrEqual(9);
    expect(corners(out)).toEqual([2, 2]);
    expect(out[0]).toMatch(/TODO ─+ 0\/5 · ✗1 /);
    expect(out[0]).not.toMatch(/\+\d+ more/); // state 39: the rows left out ride ONE dim summary row inside the box, never the title
    expect(out.some((r) => /^│ {2}\S \d+ (?:more )?(?:queued|running|done|failed)/.test(r)), out.join('\n')).toBe(true);
    expect(planRows(out)).toBeGreaterThanOrEqual(1);
    expect(agentLines(out)).toBe(3);
    expect(out.some((r) => /not shown/.test(r))).toBe(false);
  });
  test('an agent with no call yet reads `-` in NOW / RESULT and its clock 0:00, at 150 and at 110 (61-cell pane)', () => {
    const bare = [ag('lone-explorer', 'queued', { model: 'haiku' })];
    for (const cols of [150, 61]) {
      const row = rows([], bare, { cols }).map(text).find((r) => r.includes('lone-explorer'))!;
      expect([cols, /queued\s+-\s+0:00\s+│$/.test(row)]).toEqual([cols, true]); // NOW `-`, TIME the clock (a queued agent has run for 0:00)
    }
  });
});
