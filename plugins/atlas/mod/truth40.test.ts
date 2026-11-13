// truth 40: the band works whenever a host turn of the run is on (stoprun-110-1 f0062-f0072), a later slash command still never extends the clock, and the run clock never steps back (f0061 0:30, f0062 0:29).
import { describe, expect, test } from 'claude-code/testing';
import { holdClock, newRunClock, resumeOk, runKey, runLive, stepRun, type RunClock } from './band-motion';
import { runElapsed } from './data/runstate';
import { bandLines, runsText, type MissionModel, type MissionWorker } from './mission-layout';
import type { Ui } from './atlas-ui';

// the run of stoprun-110-1: it began at 6 s and its clock closed at 35.2 s (host turn flag fell), with 0:29 on the clock
const closed = (): RunClock => stepRun(stepRun(stepRun(newRunClock(), true, 6_000), true, 35_100), false, 35_200, { hostIdle: true });

describe('a stop-hook or notification continuation is the same run', () => {
  test('the closed run is live again for a turn the notification woke a beat before the close', () => {
    const c = closed();
    expect(c.startMs).toBeNull();
    const resumedAt = 34_780; // prompt.submit of the worker notification, 0.4 s before the close
    expect(runLive(c, false, false)).toBe(false);
    expect(resumeOk(c, resumedAt, 35_300)).toBe(true);
    expect(runLive(c, false, resumeOk(c, resumedAt, 35_300))).toBe(true);
  });
  test('the clock reopens at the run start and counts on: 0:29 becomes 0:35, never frozen', () => {
    const r = stepRun(closed(), true, 41_400, { resumed: true });
    expect(r.startMs).toBe(6_000);
    expect(runElapsed(r, 41_400)).toBe(35);
  });
  test('a Stop refusal 1 s after the close resumes too', () => {
    expect(resumeOk(closed(), 36_200, 36_300)).toBe(true);
  });
  test('without the resume mark a blip after the close stays closed', () => {
    const c = closed();
    expect(stepRun(c, true, 41_400)).toBe(c);
  });
});

describe('a slash command after the run does not extend it', () => {
  test('a mark from mid-run (a notification 20 s before the close) does not count', () => {
    expect(resumeOk(closed(), 15_000, 36_000)).toBe(false);
  });
  test('a mark older than the window does not count, nor does none', () => {
    const c = closed();
    expect(resumeOk(c, 35_000, 35_200 + 31_000)).toBe(false);
    expect(resumeOk(c, null, 36_000)).toBe(false);
    expect(runLive(c, false, resumeOk(c, null, 230_000))).toBe(false);
  });
  test('the closed clock reads its frozen 0:29 at 3:11', () => {
    expect(runElapsed(closed(), 6_000 + 191_000)).toBe(29);
  });
});

describe('the run clock never steps back', () => {
  test('0:30 then 0:29 holds at 0:30 within the run', () => {
    const k = runKey(closed());
    const a = holdClock(null, k, 30);
    expect(holdClock(a.hold, k, 29).secs).toBe(30);
  });
  test('a new run starts over', () => {
    const a = holdClock(null, 6_000, 30);
    expect(holdClock(a.hold, 90_000, 2).secs).toBe(2);
  });
  test('the key is the same open and closed', () => {
    expect(runKey(stepRun(newRunClock(), true, 6_000))).toBe(runKey(closed()));
  });
});

describe('step 3: every non-zero count keeps its glyph and figure, and the clock shows, at every width', () => {
  const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
  const PH = ['research', 'theory', 'test', 'implement', 'verify'] as const;
  const w = (name: string, state: MissionWorker['state']): MissionWorker => ({ name, state, secs: 5 });
  const m: MissionModel = { cols: 110, maxRows: 1, tick: 0, project: 'p', phases: PH, phase: 'research', done: 1, total: 5, bar: true, checks: [], busy: true, turnSecs: 25, ui, workers: [w('a', 'running'), w('b', 'running'), w('c', 'done'), w('d', 'failed')], tally: { running: 2, waiting: 0, queued: 0, failed: 1, done: 1, blocked: 0 } as never };
  test('stoprun-110 band: the running figure sits against its glyph, the done and failed counts stay', () => {
    for (const cols of [110, 80, 62, 46]) {
      const t = runsText(bandLines({ ...m, cols })[0]!.runs).trimEnd();
      expect(t, String(cols)).toContain('0:25');
      expect(t, String(cols)).toMatch(/●\s?1/);
      expect(t, String(cols)).not.toMatch(/[⠀-⣿] 2 ●1/);
    }
  });
});
