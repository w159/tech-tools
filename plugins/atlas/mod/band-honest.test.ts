// Round 3, slice A: the band reads honestly in every state at every width (`todo N/M` never drops), its motion clock cannot freeze, and its colours are the brief's exact xterm indices.
import { describe, expect, test } from 'claude-code/testing';
import { cells, holdSpinFrame, paintAnsi, PALETTES, sharedSpinFrame, SPINNER_MS, spinClock, withSpinFrame, type Tone, type Ui } from './atlas-ui';
import { beatStale, END_GRACE_MS, FRAME_MS, newRunClock, ranSecsOf, restSecsOf, stepRun, STALE_BEATS, workSecsOf } from './band-motion';
import { demoFrames } from './motion-demo';
import { MOTION_STEP_MS } from './motion';
import { bandLines, IDLE_AFTER_SECS, runsText, type MissionModel, type MissionWorker } from './mission-layout';
import { fitHudToBand } from './register';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['research', 'plan', 'build', 'verify', 'done'] as const;
const live: MissionWorker[] = [{ name: 'impl-a', state: 'running', secs: 4, tool: 'Read', target: 'a.ts' }, { name: 'impl-b', state: 'running', secs: 9 }];
const model = (over: Partial<MissionModel> = {}): MissionModel => ({ cols: 150, maxRows: 1, tick: 0, project: 'p', phases: PHASES, phase: 'build', done: 3, total: 5, workers: [], checks: null, ui, ...over });
const head = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs).trimEnd();
/** The scorer's figure: the word `todo`, an optional gauge, then N/M. */
const TODO_FIGURE = /todo\b[^0-9\n]*\d+\/\d+/;
const checks = [{ id: 'doctor', ok: false, name: 'doctor' }, { id: 'routing', ok: false, name: 'routing' }];

const STATES: Record<string, Partial<MissionModel>> = {
  working: { busy: true, turnSecs: 42, workers: live, ctx: 0.4, checks },
  idle: { phase: 'done', done: 5, total: 5, ranSecs: 68, restSecs: IDLE_AFTER_SECS + 5, checks },
  done: { phase: 'done', done: 5, total: 5, ranSecs: 68, restSecs: 3, checks },
  blocked: { busy: true, workers: live.slice(0, 1), stopGates: ['dispatch T2 read x open'], openDispatchTitle: 'T2 read x', openDispatch: 1, checks } as Partial<MissionModel>,
};

describe('step 1: `todo N/M` survives every width in every state', () => {
  for (const [name, over] of Object.entries(STATES)) {
    for (const cols of [150, 120, 110, 93, 80, 70, 62]) {
      test(`${name} at ${cols} columns keeps the capsule and the todo figure, inside the width`, () => {
        const t = head(model({ cols, ...over }));
        expect(t).toContain('◖ ◆ ATLAS ◗');
        expect(t).toMatch(TODO_FIGURE);
        expect(cells(t)).toBeLessThanOrEqual(cols);
        expect(t).toMatch(/\d\/\d/);
      });
    }
  }
  test('the four leads are what the brief says, at 110 columns', () => {
    const lead = (over: Partial<MissionModel>): string => head(model({ cols: 110, ...over })).replace(/^◖ ◆ ATLAS ◗\s+/, '');
    expect(lead(STATES.working!)).toMatch(/^◐ working 0:42 · todo 3\/5 · ◐ 2 running/);
    expect(lead(STATES.done!)).toMatch(/^● done · 1:08 · todo 5\/5/);
    expect(lead(STATES.idle!)).toMatch(/^○ idle · last run 1:08 · todo 5\/5/);
    expect(lead(STATES.blocked!)).toMatch(/^▲ blocked · needs: close dispatch T2 · ◐ fixing · todo 3\/5/);
  });
  test('the done count is said once, and a gate warning never leads', () => {
    const t = head(model({ cols: 110, ...STATES.done! }));
    expect(t.match(/5\/5/g)).toHaveLength(1);
    expect(t).toMatch(/· △ 2 gates to check/);
    for (const over of Object.values(STATES)) expect(head(model({ cols: 150, ...over }))).not.toMatch(/^◖ ◆ ATLAS ◗\s+△/);
  });
  test('the blocked reason agrees with the todo: it names the open task and the plan figure is the plan\'s own', () => {
    const t = head(model({ cols: 110, ...STATES.blocked! }));
    expect(t).toContain('needs: close dispatch T2');
    expect(t).toContain('todo 3/5');
    expect(t).not.toMatch(/stop again/);
  });
});

describe('scorer markers: the band line matches the scorer\'s todo regex in every state', () => {
  const SCORER = /\btodo\b\D*?(\d+)\s*(?:of|\/)\s*(\d+)/;
  for (const [name, over] of Object.entries(STATES)) {
    for (const cols of [80, 110, 150]) {
      test(`${name} at ${cols}: ribbon \`◖ ◆ ATLAS ◗\` leads and the scorer regex reads the plan figure`, () => {
        const t = head(model({ cols, ...over }));
        expect(t.startsWith('◖ ◆ ATLAS ◗')).toBe(true);
        const m = SCORER.exec(t);
        expect(m).not.toBeNull();
        expect([Number(m![1]), Number(m![2])]).toEqual([over.done ?? 3, over.total ?? 5]);
      });
    }
  }
});

describe('step 2: the run clock', () => {
  test('a run that flickers (a gap under the grace) keeps one start; the clock never resets to 0:00', () => {
    let c = stepRun(newRunClock(), true, 1_000);
    c = stepRun(c, false, 1_110); // a worker ended a beat before the next started
    c = stepRun(c, true, 1_220);
    expect(workSecsOf(c, 43_000)).toBe(42);
    expect(ranSecsOf(c)).toBeUndefined();
  });
  test('after the grace the run ends: the duration is frozen, and the rest clock starts from the last working beat', () => {
    let c = stepRun(newRunClock(), true, 0);
    c = stepRun(c, true, 68_000);
    c = stepRun(c, false, 68_000 + END_GRACE_MS);
    expect(workSecsOf(c, 90_000)).toBeUndefined();
    expect(ranSecsOf(c)).toBe(68);
    expect(restSecsOf(c, 68_000 + 10_000)).toBe(10);
    expect(ranSecsOf(stepRun(c, false, 200_000))).toBe(68); // later idle beats never change it
    expect(restSecsOf(c, 68_000 + IDLE_AFTER_SECS * 1000)).toBe(IDLE_AFTER_SECS);
  });
  test('a skipped or late beat cannot stall the figure: the reading is wall-clock, not a count', () => {
    const c = stepRun(newRunClock(), true, 5_000);
    expect(workSecsOf(c, 5_000)).toBe(0);
    expect(workSecsOf(c, 65_000)).toBe(60); // no beat in between
  });
  test('one frame loop, 100 to 120 ms a frame (under the host\'s ten redraws a second), watched by a staleness check', () => {
    expect(FRAME_MS).toBeGreaterThanOrEqual(100);
    expect(FRAME_MS).toBeLessThanOrEqual(120);
    expect(beatStale(1_000, 1_000 + STALE_BEATS * FRAME_MS)).toBe(false);
    expect(beatStale(1_000, 1_000 + STALE_BEATS * FRAME_MS + 1)).toBe(true);
  });
  test('the shared frame index: every surface in one render turns the same frame, and it is released afterwards', () => {
    expect(sharedSpinFrame()).toBeNull();
    const release = holdSpinFrame(7);
    expect(sharedSpinFrame()).toBe(7);
    expect(spinClock(123_456, 99)).toBe(7 * SPINNER_MS); // the counter, not the wall clock and not the caller's tick
    release();
    expect(sharedSpinFrame()).toBeNull();
    expect(withSpinFrame(3, () => spinClock(1, 50))).toBe(3 * SPINNER_MS);
    expect(sharedSpinFrame()).toBeNull();
  });
  test('a frame in each of four consecutive ticks differs: the band spinner moves every frame', () => {
    const frames = [0, 1, 2, 3].map((tick) => head(model({ busy: true, turnSecs: 5, workers: live, tick })));
    expect(new Set(frames).size).toBe(4);
  });
});

describe('step 2: the band row can never vanish', () => {
  const gap = (rows: readonly string[]): number => (rows.length ? 1 : 0);
  test('the HUD gives up rows until at least one row of the budget is left for the band', () => {
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(fitHudToBand(rows, 8, gap)).toHaveLength(6);
    expect(fitHudToBand(rows, 6, gap).length + 1 + 1).toBeLessThanOrEqual(6 + 1); // rows + gap + band row never pass the budget
    for (let budget = 1; budget <= 10; budget++) {
      const kept = fitHudToBand(rows, budget, gap);
      expect(kept.length + gap(kept) + 1).toBeLessThanOrEqual(budget);
    }
  });
  test('a closed slot (budget under one) is left alone: the band draws nothing by design', () => {
    expect(fitHudToBand(['a', 'b'], 0, gap)).toHaveLength(2);
  });
});

describe('step 3 and 5: a solid chip, and the brief\'s exact palette indices', () => {
  test('the chip is a solid accent pill at every tick', () => {
    for (const tick of [0, 1, 2, 3, 4]) {
      const runs = bandLines(model({ busy: true, workers: live, tick }))[0]!.runs;
      const body = runs.filter((x) => x.bg === 'accent');
      expect(body.length).toBeGreaterThan(0);
      expect(runs.filter((x) => x.bg === 'panel' && x.bold && x.t.length === 1 && 'ATLAS'.includes(x.t))).toHaveLength(0);
    }
  });
  test('256 colours: each tone is painted as its xterm index, never a nearest match', () => {
    const ui256: Ui = { theme: 'mocha', ascii: false, color: '256' };
    const want: Record<string, number> = { accent: 141, bad: 203, warn: 179, ok: 114, text: 252, sub: 245, dim: 240 };
    for (const [tone, idx] of Object.entries(want)) expect(paintAnsi({ t: 'x', tone: tone as Tone }, ui256)).toContain(`38;5;${idx}`);
    expect(paintAnsi({ t: 'x', tone: 'accent', bg: 'accent' }, ui256)).toContain('48;5;141'); // the chip fill is the same lavender
  });
  test('truecolor keeps the hexes', () => {
    expect([PALETTES.mocha.accent, PALETTES.mocha.bad, PALETTES.mocha.warn, PALETTES.mocha.ok]).toEqual(['#af87ff', '#ff5f5f', '#d7af5f', '#87d787']);
    expect(paintAnsi({ t: 'x', tone: 'ok' }, ui)).toContain('38;2;135;215;135');
  });
  test('the lead word is bold body text and the spinner glyph is the accent', () => {
    const runs = bandLines(model({ busy: true, turnSecs: 42, workers: live }))[0]!.runs;
    const spinner = runs.find((x) => /^[◐◓◑◒]$/.test(x.t))!;
    const word = runs.find((x) => x.t.startsWith('working'))!;
    expect(spinner.tone).toBe('accent');
    expect([word.tone, word.bold]).toEqual(['text', true]);
  });
});

describe('step 6: the motion demo strips show the rows, not the bottom border', () => {
  test('todo-strip and agent-strip carry the row text of every frame', () => {
    const all = demoFrames(100, MOTION_STEP_MS, 'truecolor');
    const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
    for (const [file, text] of [['todo-strip.ans', 'wire the gate'], ['agent-strip.ans', 'implementer-band']] as const) {
      const lines = plain(all[file]!).split('\n').filter((l) => l.trim() !== '');
      expect(lines.length).toBeGreaterThan(1);
      for (const l of lines) {
        expect(l).toContain(text);
        expect(l).not.toContain('└');
        expect(l).not.toContain('╰');
      }
    }
  });
});
