// Truth regressions of 46d4825c (critique 27, live and stop-run captures): every state or count a surface shows must be what the snapshot holds.
// Each test fails on 46d4825c; the frame it comes from is quoted beside it.
import { describe, expect, test } from 'claude-code/testing';
import type { TodoItem } from './contract';
import { currentPhase, dispatchOpen } from './data/todos';
import { finalSecsOf, newRunClock, stepRun } from './band-motion';
import { worldHudAgents, worldPhases, worldPlan } from '../contracts/hud-world';
import { hudHoldRows, hudLines, hudRunRows, type HudInput } from './hud';
import { RETURNED, markToken, rowWordTone, runsString, stateGlyph, type Ui } from './atlas-ui';
import { DONE_HOLD_MS, MOTION_FRAME_MS, MOTION_STEP_MS, Motion, animateRow, trackBusy, windowOf, type MotionItem } from './motion';
import * as reg from './register';
import { displayLine, leadOf, leadRow } from './transcript/leadheader';
import { slotHold } from './register';

const row = (over: Partial<TodoItem>): TodoItem => ({ id: 'x', content: 'T1 read alpha.py', status: 'completed', session_id: 's1', ...over });

describe('truth29 item 1: the panel never says done while work is open', () => {
  // stoprun-150-46d4825c-1 f0109:6 `phase  done` beside f0109:24 `working 0:54 · todo 5/5 · 1 dispatch open`.
  const plan = [row({ id: 'a' }), row({ id: 'b', content: 'T2 read beta.py' })];
  const dispatch = row({ id: 'd', content: 'dispatch beta-explorer', status: 'in_progress', origin: 'dispatch', owner: 'beta-explorer' } as Partial<TodoItem>);
  test('a full plan with an open dispatch row is not done', () => {
    expect(dispatchOpen([...plan, dispatch], 's1')).toBe(true);
    expect(currentPhase([...plan, dispatch], null, 's1', true).phase).not.toBe('done');
  });
  test('a header that says done does not win while work is open', () => {
    expect(currentPhase([...plan, dispatch], 'done', 's1', true).phase).not.toBe('done');
  });
  test('with nothing open a full plan still reads done', () => {
    expect(currentPhase(plan, null, 's1', false)).toEqual({ phase: 'done', source: 'todo' });
    expect(dispatchOpen([...plan, { ...dispatch, status: 'completed' }], 's1')).toBe(false);
  });
});

describe('truth29 item 2: the first done frame shows the final run time', () => {
  // stoprun-150-46d4825c-1 f0130:24 `● done · 0:20`, then f0131:24 `● done · 1:05`: the host turn had ended, the clock had not closed yet, and the band fell back to the worker wave's span.
  test('an open clock whose host turn ended reads the run so far, not nothing', () => {
    const c = stepRun(newRunClock(), true, 1_000);
    const open = stepRun(c, true, 66_400);
    expect(open.startMs).not.toBeNull();
    expect(finalSecsOf(open)).toBe(65);
    const closed = stepRun(open, false, 66_500, { hostIdle: true });
    expect(finalSecsOf(closed)).toBe(65);
  });
  test('an old run time is not shown for a new open run', () => {
    let c = stepRun(newRunClock(), true, 0);
    c = stepRun(c, true, 19_000);
    c = stepRun(c, false, 20_000, { hostIdle: true });
    expect(finalSecsOf(c)).toBe(19);
    c = stepRun(c, true, 30_000, { promptMs: 30_000 });
    c = stepRun(c, true, 100_000);
    expect(finalSecsOf(c)).toBe(70);
  });
});

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const three = (): HudInput => ({ todos: worldPlan(), agents: worldHudAgents().slice(0, 3).map((a) => ({ ...a, state: 'working' })), phases: worldPhases() });
const rowsAt = (input: HudInput, cols: number, maxRows: number): string[] => hudLines(input, { cols, maxRows, ui, now: 0 }).map(runsString);

describe('truth29 item 1 (register): the hold that could disagree with the band is gone', () => {
  // The side panel masked `blocked` for a hold after the band had moved on (maskBlocked), so the two surfaces named different phases for seconds.
  test('register.ts no longer exports a blocked mask or its hold', () => {
    expect('maskBlocked' in reg).toBe(false);
    expect('markBlocked' in reg).toBe(false);
  });
});

describe('truth29 item 3: the slot (and so the band row) holds one height for the whole run', () => {
  // live-150-46d4825c-1: the band stood on three screen rows within one run as the plan, then SUBAGENTS, then the agent rows arrived.
  for (const cols of [150, 110]) {
    test(`${cols} cols: an orchestrated run reserves the rows of a typical plan before the plan exists`, () => {
      const empty: HudInput = { todos: [], agents: [], phases: worldPhases() };
      const held = hudHoldRows(empty, cols, 0, true);
      const grown = hudRunRows({ ...empty, todos: worldPlan().slice(0, 5), agents: three().agents }, cols, 0); // the typical plan of five
      expect(held).toBeGreaterThanOrEqual(grown); // the first frame already asks what the run will later need
      expect(held).toBeGreaterThan(hudRunRows(empty, cols, 0)); // and the unreserved figure was smaller, which moved the band
    });
  }
  test('a slot that is held never falls and never passes the budget, so the band keeps its row', () => {
    const asks = [3, 3, 8, 8, 17, 10, 14, 6];
    let held = 0;
    const seen: number[] = [];
    for (const used of asks) { held = slotHold(held, true, used, 17, 40); seen.push(held); }
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(17);
    expect(slotHold(17, false, 3, 17, 40)).toBe(0); // at rest nothing is held
  });
});

describe('truth29 item 4: the two boxes lose their rules together or keep them together', () => {
  // live-150-46d4825c-2 f0093: `╭─ TODO ...` with no `╰`, while SUBAGENTS kept its bottom rule.
  for (const cols of [150, 110]) {
    test(`${cols} cols: from 10 to 18 rows with 7 todos and 3 agents, no top rule lacks its bottom rule`, () => {
      for (let maxRows = 10; maxRows <= 18; maxRows++) {
        const rows = rowsAt(three(), cols, maxRows);
        const tops = rows.filter((r) => r.startsWith('╭')).length;
        const bottoms = rows.filter((r) => r.startsWith('╰')).length;
        expect([cols, maxRows, tops]).toEqual([cols, maxRows, bottoms]);
        const ribbons = rows.filter((r) => /^(?:── )?.*▸ (?:TODO|SUBAGENTS)/.test(r));
        const flat = ribbons.filter((r) => r.startsWith('── ')).length;
        expect([cols, maxRows, flat === 0 || flat === ribbons.length]).toEqual([cols, maxRows, true]); // both boxes are flat, or neither is
      }
    });
  }
});

describe('truth29 item 5: a hidden agent row is counted in the SUBAGENTS title', () => {
  // live-110-46d4825c-1 f0071: `SUBAGENTS 3 running` over one agent row and no overflow line.
  for (const cols of [150, 110]) {
    test(`${cols} cols: 3 running and rows hidden: the merged block counts them once, on the TODO ribbon (wave 31)`, () => {
      const rows = rowsAt(three(), cols, 3); // state 39: title, ONE dim summary row, the closing rule that carries the SUBAGENTS title (folded to its one row, never an empty box)
      const title = rows.find((r) => r.includes('SUBAGENTS'))!;
      expect(title).toContain('3 running');
      const summary = rows.find((r) => /^ {2}\S (?:\d+ done {2}\S )?\d+ more running/.test(r) || /more running/.test(r))!;
      expect(summary, rows.join('\n')).toBeDefined();
      expect(Number(/(\d+) more running/.exec(summary)?.[1])).toBeGreaterThanOrEqual(2); // the hidden running rows are counted once, on the summary row
      expect(rows.some((r) => /\+\d+ more/.test(r))).toBe(false); // one idiom: no `+N more` on any title
      expect(title).not.toContain('more');
    });
  }
  test('nothing hidden, nothing counted', () => {
    expect(rowsAt(three(), 110, 16).find((r) => r.includes('SUBAGENTS'))).not.toContain('more');
  });
});

describe('truth29 item 6: a returned worker is drawn with the neutral glyph and the word in 245', () => {
  // live-150-46d4825c-1 f0107: `●` (green, 114) with `returned` in 240.
  test('the glyph, its colour token and the word tone', () => {
    expect(stateGlyph(RETURNED, ui)).toBe('◉');
    expect(stateGlyph(RETURNED, { ascii: true })).toBe('?');
    expect(markToken(RETURNED)).toBe('text');
    expect(rowWordTone('done', RETURNED)).toBe('sub');
  });
  test('a HUD row whose owner returned: the neutral disc in body text, never the green done disc, and the word in secondary', () => {
    const todo = (i: number, owner: string): TodoItem => ({ id: `t${i}`, content: `T${i} read beta.py`, status: 'in_progress', owner } as unknown as TodoItem);
    const agent = (name: string, state: string, u: 'running' | 'done') => ({ name, role: 'explorer', state, ui: u, model: 'haiku', since: 1 }) as HudInput['agents'] extends (infer A)[] | undefined ? A : never;
    const input: HudInput = { todos: [todo(1, 'a-explorer'), todo(2, 'b-explorer')], agents: [agent('a-explorer', 'working', 'running'), agent('b-explorer', 'done', 'done')] };
    const rows = hudLines(input, { cols: 150, maxRows: 40, ui, now: 5 });
    const r = rows.find((x) => runsString(x).includes('T2 read beta.py'))!;
    expect(r.some((x) => x.t === '●')).toBe(false);
    expect(r.find((x) => x.t === '◉')?.tone).toBe('text');
    expect(r.find((x) => x.t === 'returned')?.tone).toBe('sub');
  });
});

describe('truth29 item 7: one case and one mark on the lead header line', () => {
  // live-150-46d4825c-1 f0065:23 `● ▌ research · waiting on 3 explorers` and, elsewhere, `▌ RESEARCH working`.
  const lead = leadOf('ATLAS | 🔍 research 1/3 | waiting on 3 explorers', '^(?:● )?ATLAS \\|')!;
  test('the host-drawn line carries no bar of ours and no capitals', () => {
    const line = displayLine(lead);
    expect(line).toBe('research 1/3 · waiting on 3 explorers');
    expect(line).not.toContain('▌');
  });
  test('the display form is read back with or without a bar, and a bare phase word is no header', () => {
    expect(leadOf('research 1/3 · waiting on 3 explorers', '')?.phase).toBe('research');
    expect(leadOf('▌ research 1/3 · waiting on 3 explorers', '')?.phase).toBe('research');
    expect(leadOf('done', '')).toBeNull();
  });
  test('the chip draws the phase word in lower case', () => {
    const flat = (n: unknown): string => JSON.stringify(n);
    const chip = flat(leadRow(lead, { ui, columns: 150 }));
    expect(chip).toContain('research');
    expect(chip).not.toContain('RESEARCH');
  });
});

describe('truth29 item 8: the done mark holds its highlighted first state', () => {
  // The 200 ms fade appeared in 0 of the live frames (500 ms capture period). The first beat now stays DONE_HOLD_MS, redraws stay at 10 a second.
  const items = (state: string): MotionItem[] => [{ key: 'todo:a', state }];
  const row = [{ t: '●', tone: 'ok' as const }, { t: ' wire the gate', tone: 'sub' as const }];
  test('wave 31: a done mark shows its first (231) beat for one 200 ms step and then moves to the held 151', () => {
    expect(DONE_HOLD_MS).toBe(MOTION_STEP_MS);
    const m = new Motion(true);
    m.observe('todo', items('running'), 0);
    m.observe('todo', items('done'), 5000);
    const shot = (dt: number): string => JSON.stringify(animateRow(row, 'todo:a', 'done', m.ctx(5000 + dt), ui));
    for (const dt of [0, 100, DONE_HOLD_MS - 1]) expect([dt, shot(dt)]).toEqual([dt, shot(0)]);
    expect(shot(DONE_HOLD_MS)).not.toBe(shot(0));
    expect(runsString(animateRow(row, 'todo:a', 'done', m.ctx(5000), ui))).toContain('◌'); // the pop starts on its first glyph and holds it
  });
  test('any capture at a 500 ms period sees the highlighted state at least once', () => {
    const m = new Motion(true);
    m.observe('todo', items('running'), 0);
    m.observe('todo', items('done'), 5000);
    const rest = JSON.stringify(row);
    const lit = [0, 500, 1000, 1500].filter((dt) => JSON.stringify(animateRow(row, 'todo:a', 'done', m.ctx(5000 + dt), ui)) !== rest);
    expect(lit.length).toBeGreaterThanOrEqual(2);
  });
  test('the window is longer for done, other states keep MOTION_MS, and the timer never runs faster than 10 a second', () => {
    expect(windowOf({ state: 'done' })).toBe(DONE_HOLD_MS + 3 * MOTION_STEP_MS);
    expect(windowOf({ state: 'running' })).toBe(4 * MOTION_STEP_MS);
    expect(MOTION_FRAME_MS).toBeGreaterThanOrEqual(100);
    const m = new Motion(true);
    m.observe('todo', items('running'), 0);
    m.observe('todo', items('done'), 5000);
    expect(m.animating(5000 + windowOf({ state: 'done' }) - 1)).toBe(true);
    expect(m.animating(5000 + windowOf({ state: 'done' }))).toBe(false);
  });
});
