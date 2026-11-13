// Truth 39: the band, the side panel's phase row and the transcript cards print only what is true (critique of build 63934f09). One group per step.
import { describe, expect, test } from 'claude-code/testing';
import { newRunClock, runLive, stepRun } from './band-motion';
import { runElapsed } from './data/runstate';

describe('step 1: no `working` after done or idle without a new prompt, and the clock never passes the run total', () => {
  // live-150-2 f0105 `idle 0:39`, f0106 `working 3:11`: /atlas-cc ran as a host turn, no prompt armed a run, and runElapsed added the whole rest to the closed run.
  const closed = (): ReturnType<typeof newRunClock> => {
    let c = stepRun(newRunClock(), true, 5_000);
    c = stepRun(c, true, 44_000);
    return stepRun(c, false, 44_100, { hostIdle: true });
  };
  test('a closed run is not live again from a host turn alone; a prompt (armed) or an open clock is', () => {
    const c = closed();
    expect(c.startMs).toBeNull();
    expect(runLive(c, false)).toBe(false);
    expect(runLive(c, true)).toBe(true);
    expect(runLive(newRunClock(), false)).toBe(true); // nothing has run yet: the first run needs no prompt
    expect(runLive(stepRun(c, true, 200_000, { promptMs: 199_000 }), false)).toBe(true);
  });
  test('work with no prompt behind it after the run closed starts no clock (stepRun)', () => {
    const c = closed();
    expect(stepRun(c, true, 195_000)).toBe(c);
  });
  test('the closed clock reads its frozen total, never the total plus the rest: 0:39 stays 0:39 at 3:11', () => {
    const c = closed();
    const total = runElapsed(c, 44_100)!;
    expect(runElapsed(c, 195_000)).toBe(total);
    expect(runElapsed(c, 44_100 + 1_000)).toBeGreaterThanOrEqual(total); // a resume inside the grace still counts on
  });
});
