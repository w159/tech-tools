// Round 3, slice A: one spinner, one palette, the four band leads, the closed count, the pill and the band's worker rows.
import { describe, expect, test } from 'claude-code/testing';
import { ATLAS_GLYPHS, GLYPH5, LEAD_FRAMES, PALETTES, SPIN_FRAMES, STATE_GLYPHS, spinnerGlyph, wordmark, type Ui } from './atlas-ui';
import { bandLines, missionLines, needsOf, runsText, type MissionModel, type MissionWorker } from './mission-layout';
import { withStopVerdict } from './register';
import { spin } from './theme';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const PHASES = ['research', 'plan', 'build', 'verify', 'done'] as const;
const BRAILLE = /[⠀-⣿]/;
const model = (over: Partial<MissionModel> = {}): MissionModel => ({ cols: 150, maxRows: 1, tick: 0, project: 'p', phases: PHASES, phase: 'build', done: 3, total: 7, workers: [], checks: null, ui, ...over });
const head = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs).trimEnd();
const lead = (m: MissionModel): string => head(m).replace(/^◖ ◆ ATLAS ◗\s+/, '');
const live: MissionWorker[] = [{ name: 'impl-a', state: 'running', secs: 4, tool: 'Read', target: 'a.ts' }];

describe('round 3 A1: rows turn circle quarters; the band lead alone turns braille', () => {
  test('the spinner, the running glyph and the theme spinner are the same four circle quarters', () => {
    expect(SPIN_FRAMES.join('')).toBe('◐◓◑◒');
    expect([0, 1, 2, 3].map((f) => spinnerGlyph(f)).join('')).toBe('◐◓◑◒');
    expect([0, 1, 2, 3].map((f) => spin(f, 'implement')).join('')).toBe('◐◓◑◒');
    expect(STATE_GLYPHS.running).toBe('◐');
    expect(GLYPH5.running).toBe('◐');
    expect(BRAILLE.test(ATLAS_GLYPHS)).toBe(false);
  });
  test('a working band carries two braille glyphs on one frame, the lead spinner and the agents count, at any tick or width; the worker rows stay circles', () => {
    for (const cols of [150, 110, 80, 60]) for (const tick of [0, 1, 2, 3, 4]) {
      const t = head(model({ cols, tick, busy: true, workers: live }));
      expect(t.match(/[\u2800-\u28ff]/g)).toHaveLength(2);
      expect(t).toContain(`${LEAD_FRAMES[tick % 10]!} working`);
    }
  });
  test('the lead spinner steps once per frame of the shared clock, the running count on the same frame index', () => {
    for (const tick of [0, 1, 2, 3, 4, 9, 10, 11]) {
      const t = head(model({ tick, busy: true, workers: live }));
      expect(t).toContain(`${LEAD_FRAMES[tick % 10]!} working`);
      expect(t).toContain(`${LEAD_FRAMES[tick % 10]!} 1 running`);
    }
  });
});

describe('round 3 A3: the palette is one colour per state', () => {
  test('the dark palette is the brief: accent 141, ok 114, warn 179, error 203, body 252, ink 234', () => {
    expect(PALETTES.mocha).toMatchObject({ accent: '#af87ff', ok: '#87d787', warn: '#d7af5f', bad: '#ff5f5f', block: '#ff5f5f', text: '#d0d0d0', run: '#d0d0d0', ink: '#1c1c1c' });
  });
  test('blocked and failed share the error colour; done is ok; running is the body tone', () => {
    const p = PALETTES.mocha;
    expect(p.block).toBe(p.bad);
    const toneOf = (m: MissionModel, text: string) => bandLines(m)[0]!.runs.find((x) => x.t.includes(text))?.tone;
    expect(toneOf(model({ blocked: true }), 'blocked')).toBe('bad');
    expect(toneOf(model({ phase: 'done', done: 7, total: 7 }), 'done')).toBe('ok');
    expect(toneOf(model({ busy: true, workers: live }), 'working')).toBe('text');
  });
});

describe('round 3 A2: the band lead has four states', () => {
  for (const cols of [150, 110]) {
    test(`at ${cols} columns: working, done, idle and blocked each lead with their glyph and word`, () => {
      expect(lead(model({ cols, busy: true, turnSecs: 36, workers: live }))).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working 0:36/);
      expect(lead(model({ cols, phase: 'done', done: 5, total: 5, ranSecs: 62 }))).toMatch(/^● done · 1:02/);
      expect(lead(model({ cols, phase: 'research', done: 0, total: 0 }))).toMatch(/^○ idle/);
      expect(lead(model({ cols, blocked: true, openDispatchTitle: 'T2 read x', openDispatch: 1 } as Partial<MissionModel>))).toMatch(/^▲ blocked · /);
    });
  }
  test('blocked names what it needs, and keeps moving while the host fixes it', () => {
    const m = model({ stopGates: ['dispatch T2 read x open'], openDispatchTitle: 'T2 read x', openDispatch: 1 } as Partial<MissionModel>);
    expect(lead(m)).toMatch(/^▲ blocked · needs: close dispatch T2/);
    expect(lead({ ...m, busy: true })).toMatch(/^▲ blocked · needs: close dispatch T2 · [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] fixing/);
    expect(lead({ ...m, busy: true, tick: 1 })).toContain('⠙ fixing');
    expect(head({ ...m, ui: { ...ui, ascii: true } })).not.toMatch(/[◐◓◑◒]/);
  });
  test('needsOf: a dispatch row reads as the task to close, retry stop as the spinner word retrying, others stay in the gate words', () => {
    expect(needsOf('dispatch T2 read ghost.py open')).toBe('needs: close dispatch T2');
    expect(needsOf('dispatch T2 read ghost.py open', 'short')).toBe('needs: close T2');
    expect(needsOf('dispatch T2 read ghost.py open', 'bare')).toBe('close T2');
    expect(needsOf('dispatch fix the thing open')).toBe('needs: close dispatch fix the thing');
    expect(needsOf('retry stop')).toBe('retrying');
    expect(needsOf('routing')).toBe('routing');
  });
  test('a gate warning never leads: idle and done lead with their own word, the warning is the second segment', () => {
    const checks = [{ id: 'doctor', ok: false, name: 'doctor' }];
    const idle = lead(model({ phase: 'research', done: 0, total: 0, checks }));
    expect(idle).toMatch(/^○ idle\b.* · △ 1 gate to check/);
    const done = lead(model({ cols: 110, phase: 'done', done: 7, total: 7, ranSecs: 42, checks }));
    expect(done).toMatch(/^● done · 0:42 · todo 7\/7 · △ 1 gate to check/);
    expect(head(model({ busy: true, workers: live, checks }))).not.toMatch(/^◖ ◆ ATLAS ◗\s+▲/);
  });
});

describe('round 3 A2: a closed failure is a dim record, not a red mark', () => {
  const failed: MissionWorker[] = [{ name: 'a-explorer', state: 'failed', secs: 9 }];
  test('while the dispatch row is open the count is `■ 1 failed`; once it closes it is the word `1 closed` with no glyph (critique 26: the done disc means done)', () => {
    expect(head(model({ workers: failed }))).toContain('■ 1 failed');
    const t = head(model({ workers: failed, closed: 1 }));
    expect(t).toContain('1 closed');
    expect(t).not.toContain('● 1 closed');
    expect(t).not.toContain('■ 1 failed');
    const tone = bandLines(model({ workers: failed, closed: 1 }))[0]!.runs.find((x) => x.t === '1 closed')?.tone;
    expect(tone).toBe('dim');
  });
});

describe('round 3 A2: the Stop hook\'s own write flips the band', () => {
  const write = (blocked: boolean, why: string[] = []) => JSON.stringify({ sessions: { s1: { blocked, why, letters: [] } } });
  test('a blocked verdict becomes the completion group\'s `Last Stop blocked` line with the recorded words', () => {
    const g = withStopVerdict([], write(true, ['dispatch T2 read x open']), 's1');
    expect(g).toHaveLength(1);
    expect(g[0]!.id).toBe('completion');
    expect(g[0]!.lines[0]).toMatchObject({ id: 'stop-verdict', label: 'Last Stop blocked', detail: 'dispatch T2 read x open' });
  });
  test('an allowed verdict reads `Last Stop allowed`, replacing the old line rather than adding one', () => {
    const first = withStopVerdict([], write(true, ['x']), 's1');
    const next = withStopVerdict(first, write(false), 's1');
    expect(next[0]!.lines.filter((l) => l.id === 'stop-verdict')).toHaveLength(1);
    expect(next[0]!.lines[0]!.label).toBe('Last Stop allowed');
  });
  test('another session, an empty record or bad JSON leave the groups as they are', () => {
    expect(withStopVerdict([], write(true), 'other')).toEqual([]);
    expect(withStopVerdict([], 'not json', 's1')).toEqual([]);
    expect(withStopVerdict([], '{}', 's1')).toEqual([]);
  });
});

describe('round 3 A4: the brand chip is a solid pill', () => {
  test('caps in accent on the default background; ` ◆ ` and the letters are ink on an accent fill; the literal text is unchanged', () => {
    const runs = wordmark(ui);
    expect(runsText(runs)).toBe('◖ ◆ ATLAS ◗');
    expect(runs[0]).toMatchObject({ t: '◖', tone: 'accent' });
    expect(runs.at(-1)).toMatchObject({ t: '◗', tone: 'accent' });
    expect(runs[0]!.bg).toBeUndefined();
    const body = runs.slice(1, -1);
    expect(body.every((x) => x.bg === 'accent' && x.bold === true && x.tone !== 'accent')).toBe(true);
  });
  test('the pill stays solid: no letter is a hole, working or not, reduced motion or not (the inverted letter read as a stray cursor)', () => {
    expect(wordmark(ui, 2).some((x) => x.bg === 'panel')).toBe(false);
    expect(wordmark(ui).some((x) => x.bg === 'panel')).toBe(false);
    const holes = (m: MissionModel) => bandLines(m)[0]!.runs.filter((x) => x.bg === 'panel' && x.bold && 'ATLAS'.includes(x.t) && x.t.length === 1).length;
    for (const tick of [0, 1, 2, 3, 4]) expect(holes(model({ busy: true, workers: live, tick }))).toBe(0);
    expect(holes(model({ busy: true, workers: live, still: true }))).toBe(0);
  });
});

describe('round 3 A5: the band lists its workers in the scorer\'s row shape', () => {
  const scorer = /^\s*([◐◓◑◒◇■▲◉●])\s+(\S+)\s+([a-z][a-z-]*)\s{2,}\S/; // live_capture.py: band worker row
  const workers: MissionWorker[] = [
    { name: 'impl-a', state: 'running', secs: 42, tool: 'Read', target: 'runs.ts:17', role: 'implementer' },
    { name: 'impl-b', state: 'failed', secs: 95, tool: 'Edit', role: 'implementer' },
    { name: 'run-c', state: 'queued', secs: 0, role: 'runner' },
    { name: 'impl-d', state: 'done', secs: 351, role: 'implementer' },
  ];
  for (const cols of [150, 110]) {
    test(`at ${cols} columns, with room, one row per worker: glyph, name, state word, last, time`, () => {
      const rows = missionLines(model({ cols, maxRows: 8, busy: true, workers, workersInHud: true })).map((l) => runsText(l.runs).trimEnd());
      const wr = rows.filter((r) => scorer.test(r));
      expect(wr).toHaveLength(4);
      for (const r of wr) expect(r).not.toMatch(/│/);
      expect(wr.map((r) => scorer.exec(r)![3])).toEqual(expect.arrayContaining(['running', 'failed', 'queued', 'done']));
      expect(wr.find((r) => r.includes('impl-a'))).toMatch(/running {2}read runs\.ts:17 +00:42$/);
    });
  }
  test('with no room (a one-row band) there are no worker rows', () => {
    expect(missionLines(model({ maxRows: 1, workers, workersInHud: true }))).toHaveLength(1);
  });
});
