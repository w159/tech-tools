// Rev 5 HUD (slice B): plain titles with a thin rule and a right-aligned meter, the dim done rows, one spinner phase, the column header that
// stays while the grid shows, and a LAST that is never blank. Live shape: stoprun-150-4b5b5a94-1/frames/f0075.ans:24-35 (TODO 0/5 with two
// running rows out of phase, SUBAGENTS without its column header, ragged `killed`).
import { describe, expect, test } from 'claude-code/testing';
import { cells, rowWordTone, runsString, spinClock, spinFrameOf, type Run, type Ui } from './atlas-ui';
import type { TodoItem } from './contract';
import { hudLines, type HudAgent } from './hud';
import { rowSpinnerGlyph } from './hud-surface';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'none' };
const NOW = 5_000_000;
const todo = (n: number, state: (i: number) => string, owner: (i: number) => string | undefined = () => undefined): TodoItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, content: `T${i + 1} step ${i + 1}`, status: state(i), ...(owner(i) ? { owner: owner(i) } : {}) }) as unknown as TodoItem);
const ag = (name: string, state: string, over: Partial<HudAgent> = {}): HudAgent => ({ name, role: 'explorer', state, ui: state === 'working' ? 'running' : (state as never), model: 'haiku', since: NOW - 1000, ...over });
const rows = (todos: TodoItem[], agents: HudAgent[], o: { cols?: number; maxRows?: number; ui?: Ui; tick?: number } = {}): Run[][] =>
  hudLines({ todos, agents }, { cols: o.cols ?? 150, maxRows: o.maxRows ?? 30, ui: o.ui ?? ui, now: NOW, ...(o.tick !== undefined ? { tick: o.tick } : {}) });
const text = (r: Run[]): string => runsString(r);

describe('title rows: a plain title, the count and the meter inside a thin rule that runs to the edge', () => {
  const t = rows(todo(5, (i) => (i < 3 ? 'completed' : 'pending')), []);
  test('TODO  3/5, then the 8-cell meter, then a thin rule to the last cell where the host draws its marker, no heavy rule', () => {
    const head = text(t[0]!);
    expect(head).toMatch(/^◖ ◆ ATLAS ◗ ▸ TODO {2}3\/5 ▰{5}▱{3} ─+$/);
    expect(cells(head)).toBe(150);
    expect(head).not.toContain('━');
  });
  test('the title is bold neutral text, the rule the line tone, the brand is quiet (no chip, no fill)', () => {
    const head = t[0]!;
    const title = head.find((x) => x.t === 'TODO')!;
    expect([title.tone, title.bold]).toEqual(['text', true]);
    expect(head.some((x) => x.chip === true || x.bg === 'accent')).toBe(false);
    expect(head.find((x) => /^─{6,}$/.test(x.t))!.tone).toBe('line');
  });
  test('the meter is full only when every item is done, and never empty once one is', () => {
    const meter = (done: number, n: number): string => text(rows(todo(n, (i) => (i < done ? 'completed' : 'pending')), [])[0]!).match(/[▰▱]+/)![0];
    expect(meter(0, 5)).toBe('▱'.repeat(8));
    expect(meter(1, 40)).toBe('▰' + '▱'.repeat(7));
    expect(meter(39, 40)).toBe('▰'.repeat(7) + '▱');
    expect(meter(5, 5)).toBe('▰'.repeat(8));
  });
  test('ASCII keeps the same cells: `#` and `-` for the meter, a `-` rule', () => {
    const head = text(rows(todo(5, (i) => (i < 3 ? 'completed' : 'pending')), [], { ui: ascii })[0]!);
    expect(head).toMatch(/^\[ATLAS\] > TODO {2}3\/5 #{5}-{3} -+$/);
    expect(cells(head)).toBe(150);
  });
  test('the title row is exactly the width at every width, with or without the meter', () => {
    for (const cols of [40, 60, 80, 100, 110, 150]) expect([cols, cells(text(rows(todo(5, (i) => (i < 3 ? 'completed' : 'pending')), [], { cols })[0]!))]).toEqual([cols, cols]);
  });
});

describe('SUBAGENTS title: the working signal rides the title', () => {
  test('a running agent puts the HUD spinner glyph before the counts, inside the rule; no running agent, no spinner', () => {
    const frame = spinFrameOf(spinClock(NOW, 0), '');
    const run = rows(todo(2, () => 'in_progress'), [ag('alpha-explorer', 'working')]);
    const head = text(run.find((r) => text(r).includes('SUBAGENTS'))!);
    expect(head).toContain(`${rowSpinnerGlyph(frame)} 1 running ─`);
    const idle = rows(todo(2, () => 'completed'), [ag('alpha-explorer', 'done')]);
    const idleHead = text(idle.find((r) => text(r).includes('SUBAGENTS'))!);
    expect(idleHead).toContain('1 done');
    expect(idleHead).not.toMatch(/[◐◓◑◒⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
  });
  test('the spinner advances with the tick', () => {
    const at = (tick: number): string => text(rows(todo(2, () => 'in_progress'), [ag('a-explorer', 'working')], { tick }).find((r) => text(r).includes('SUBAGENTS'))!);
    expect(at(0)).toContain(`${rowSpinnerGlyph(spinFrameOf(spinClock(NOW, 0), ''))} 1 running`);
    expect(at(1)).toContain(`${rowSpinnerGlyph(spinFrameOf(spinClock(NOW, 1), ''))} 1 running`);
    expect(rowSpinnerGlyph(spinFrameOf(spinClock(NOW, 0), ''))).not.toBe(rowSpinnerGlyph(spinFrameOf(spinClock(NOW, 1), '')));
  });
  test('critique 21: ONE spinner set on the block: the title and every running row turn the same quarter circle on one clock, no braille anywhere', () => {
    for (const tick of [0, 1, 2, 3]) {
      const out = rows(todo(2, () => 'in_progress'), [ag('a-explorer', 'working', { tool: 'Read', target: 'a.py' })], { tick });
      const all = out.map(text).join('\n');
      expect(all).not.toMatch(/[⠀-⣿]/);
      const marks = new Set(out.flatMap((r) => [...text(r)]).filter((c) => '◐◓◑◒'.includes(c)));
      expect(marks.size).toBe(1); // title, TODO rows and agent row on one frame
    }
  });
});

describe('rows: one phase, dim done rows, state words by weight', () => {
  const plan = todo(5, (i) => (i === 0 ? 'completed' : i === 1 || i === 2 ? 'in_progress' : 'pending'), (i) => ['alpha-explorer', 'beta-explorer', 'gamma-explorer'][i]);
  const agents = [ag('alpha-explorer', 'done', { lastTool: 'Read' }), ag('beta-explorer', 'working', { tool: 'Read', target: 'beta.py' }), ag('gamma-explorer', 'working', { tool: 'Read', target: 'gamma.py' })];
  const out = rows(plan, agents, { maxRows: 30 });
  test('every running glyph on every row of one frame is the same character (the critic counted out-of-phase spinners as a defect)', () => {
    const glyphOf = (r: Run[]): string => r[2]!.t;
    const running = out.filter((r) => /\brunning\b/.test(text(r)) && !text(r).includes('▸ SUBAGENTS') && !text(r).includes('▸ TODO'));
    expect(running.length).toBe(4); // two TODO rows, two agent rows
    expect(new Set(running.map(glyphOf)).size).toBe(1);
  });
  test('a done row is quiet from its label to its detail, never struck through, and keeps its green disc (critique 21)', () => {
    const done = out.find((r) => text(r).includes('step 1'))!;
    const label = done.find((x) => x.t.includes('step 1'))!;
    expect([label.tone, label.strike ?? false, label.bold ?? false]).toEqual(['muted', false, false]);
    const word = done.find((x) => x.t === 'done')!;
    expect(word.tone).toBe(rowWordTone('done'));
    expect(done.find((x) => x.t === '●')!.tone).toBe('ok');
    const agent = out.find((r) => text(r).includes('alpha-explorer') && text(r).includes('haiku'))!;
    expect(agent.filter((x) => x.t.trim() !== '' && x.t !== '●' && x.t !== 'done').every((x) => x.tone === 'muted')).toBe(true);
    expect(agent.find((x) => x.t === '●')!.tone).toBe('ok'); // the agent row's glyph keeps the done colour while its text goes quiet
    expect(out.flat().some((x) => x.strike)).toBe(false);
  });
  test('the running state word is bold; failed is the error tone; a warning is never bold', () => {
    const run = out.find((r) => text(r).includes('step 2'))!.find((x) => x.t === 'running')!;
    expect([run.tone, run.bold]).toEqual([rowWordTone('running'), true]);
    const dead = rows(todo(2, () => 'pending', (i) => (i === 0 ? 'ghost-explorer' : undefined)), [ag('ghost-explorer', 'failed', { lastTool: 'Read', target: 'ghost.py' })]);
    const failed = dead.find((r) => text(r).includes('ghost-explorer') && text(r).includes('haiku'))!.find((x) => x.t === 'failed')!;
    expect([failed.tone, failed.bold ?? false]).toEqual(['bad', false]);
    const warn = rows(todo(1, () => 'pending', () => 'ghost-explorer'), [ag('ghost-explorer', 'blocked')]).flatMap((r) => r).find((x) => x.t === 'blocked' || x.t === 'waiting')!;
    expect([warn.tone, warn.bold ?? false]).toEqual([rowWordTone(warn.t === 'blocked' ? 'blocked' : 'waiting'), false]);
  });
});

describe('SUBAGENTS grid: the header stays while the grid shows; LAST and TASK are never blank', () => {
  const plan = todo(5, () => 'pending', (i) => (i < 3 ? ['alpha-explorer', 'ghost-explorer', 'beta-explorer'][i] : undefined));
  const agents = [ag('alpha-explorer', 'working', { tool: 'Read', target: 'alpha.py' }), ag('ghost-explorer', 'failed', { lastTool: 'Read', target: 'ghost.py' }), ag('beta-explorer', 'working', { tool: 'Read', target: 'beta.py' })];
  test('f0075: 11 rows for 5 todos and 3 agents keep the AGENT/STATE header (12 rows would not fit, so the blank row goes, not the header)', () => {
    const out = rows(plan, agents, { maxRows: 11 }).map(text);
    expect(out.length).toBeLessThanOrEqual(11);
    expect(out.some((r) => /AGENT\s+STATE\s+MODEL\s+TASK\s+LAST/.test(r))).toBe(true);
    expect(out.filter((r) => /explorer\s+(running|failed)\s+haiku/.test(r)).length).toBe(3);
  });
  test('a tighter slot caps the TODO rows before it drops the header', () => {
    const out = rows(plan, agents, { maxRows: 9 }).map(text);
    expect(out.length).toBeLessThanOrEqual(9);
    expect(out.some((r) => /AGENT\s+STATE/.test(r))).toBe(true);
    expect(out.filter((r) => /explorer\s+(running|failed)\s+haiku/.test(r)).length).toBe(3);
  });
  test('an agent with no task and no last call reads `-` in TASK and LAST, at 150 and at 110 (61-cell pane)', () => {
    const bare = [ag('lone-explorer', 'queued', { model: 'haiku' })];
    for (const cols of [150, 61]) {
      const row = rows([], bare, { cols }).map(text).find((r) => r.includes('lone-explorer'))!;
      expect([cols, row.trimEnd().endsWith('-')]).toEqual([cols, true]);
    }
    const wide = rows([], bare, { cols: 150 }).map(text).find((r) => r.includes('lone-explorer'))!;
    expect(wide).toMatch(/queued\s+haiku\s+-\s+-\s*$/);
  });
});
