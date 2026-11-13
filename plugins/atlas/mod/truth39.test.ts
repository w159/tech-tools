// Truth 39: the band, the side panel's phase row and the transcript cards print only what is true (critique of build 63934f09). One group per step.
import { describe, expect, test } from 'claude-code/testing';
import { newRunClock, runLive, stepRun } from './band-motion';
import { runElapsed } from './data/runstate';
import { bandLines, runsText, type MissionModel, type MissionWorker } from './mission-layout';
import { panelWorld } from '../contracts/panel-world';
import type { Ui } from './atlas-ui';
import { bandFrame, forgetBandFrame, noteBandFrame } from './motion';
import { lineText, panelLines, type PanelModel } from './panel-layout';

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

describe('step 4: the narrow band keeps the state glyph, the clock and every non-zero count', () => {
  const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
  const PH = ['research', 'theory', 'test', 'implement', 'verify'] as const;
  const base = (over: Partial<MissionModel>): MissionModel => ({ cols: 62, maxRows: 1, tick: 0, project: 'p', phases: PH, phase: 'research', done: 1, total: 5, bar: true, checks: [], workers: [], ui, ...over });
  const w = (name: string, state: MissionWorker['state']): MissionWorker => ({ name, state, secs: 5 });
  const band = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs).trimEnd();
  test('stoprun-110-1 f0098: blocked at 62 cells keeps its clock, the failure and the done count (the reason text goes first)', () => {
    const t = band(base({ stopGates: ['stop refused'], ranSecs: 48, workers: [w('a', 'done'), w('b', 'done'), w('c', 'failed')], tally: { running: 0, waiting: 0, queued: 0, failed: 1, done: 2, blocked: 0 } as never }));
    expect(t).toMatch(/^◖ ◆ ATLAS ◗ ▲ blocked(?: · stop refused)? 0:48 ▌ (?:todo )?1\/5 ■1 ▌ .*■1/);
    expect(t).toMatch(/●2/);
    expect(t.length).toBeLessThanOrEqual(62);
  });
  test('the clock outlasts the reason at every width down to 40 cells', () => {
    for (const cols of [90, 80, 70, 62, 56, 48, 40]) {
      const t = band(base({ cols, stopGates: ['stop refused'], ranSecs: 48, workers: [w('c', 'failed')], tally: { running: 0, waiting: 0, queued: 0, failed: 1, done: 0, blocked: 0 } as never }));
      expect(t, String(cols)).toContain('0:48');
      expect(t, String(cols)).toContain('▲');
    }
  });
  test('stoprun-110-2 f0078: a running worker no longer hides the failed and the done counts', () => {
    const m = base({ turnSecs: 39, busy: true, workers: [w('a', 'running'), w('b', 'done'), w('c', 'failed')], tally: { running: 1, waiting: 0, queued: 0, failed: 1, done: 1, blocked: 0 } as never });
    const t = band({ ...m, cols: 100 });
    expect(t).toMatch(/working 0:39/);
    expect(t).toMatch(/1 running · ● 1 done · ■1$/);
    for (const cols of [62, 46]) {
      const narrow = band({ ...m, cols });
      expect(narrow, String(cols)).toMatch(/0:39/);
      expect(narrow, String(cols)).toMatch(/ 1 ●1 ■1$/);
    }
  });
});

describe('step 3: the channel tab does not contradict itself', () => {
  const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
  const text = (over: Partial<PanelModel>): string[] => panelLines(panelWorld('channel', 110, ui, { rows: 40, now: 2_000_000, notes: [], ...over })).map(lineText);
  test('senders shown: no `○ no messages` above them, `0 messages` under them', () => {
    const t = text({});
    expect(t.some((l) => l.includes('senders'))).toBe(true);
    expect(t.join('\n')).not.toContain('no messages');
    const at = (re: RegExp): number => t.findIndex((l) => re.test(l));
    expect(at(/^\s+0 messages$/)).toBeGreaterThan(at(/senders/));
  });
  test('no senders: the tab keeps its one `○ no messages` line', () => {
    const t = text({ workers: [], mates: [], lead: undefined });
    expect(t.filter((l) => l.includes('○ no messages'))).toHaveLength(1);
    expect(t.join('\n')).not.toContain('senders');
  });
});

describe('step 2: the side panel phase row prints the band\'s glyph, word and clock', () => {
  const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
  const NOW = 2_000_000;
  const rowOf = (over: Partial<PanelModel>): string => {
    const m = panelWorld('route', 150, ui, { rows: 40, now: NOW, run: { kind: 'working', secs: 37 }, phase: 'research', ...over });
    return panelLines(m).map(lineText).find((l) => /^\s*phase\b/.test(l))!;
  };
  test('the band note carries the state word', () => {
    noteBandFrame(2, 36, NOW, 'blocked');
    expect(bandFrame()).toEqual({ frame: 2, secs: 36, kind: 'blocked' });
    forgetBandFrame();
  });
  test('stoprun-150-3 f0074: the band reads blocked 0:36, the panel (own reading: working 0:37) reads `▲ blocked 0:36`', () => {
    noteBandFrame(2, 36, NOW, 'blocked');
    expect(rowOf({}).replace(/\s+/g, ' ').trim()).toBe('phase ▲ blocked 0:36');
    forgetBandFrame();
  });
  test('live-150-2 f0106: the band reads idle 0:39, the panel does not say working', () => {
    noteBandFrame(2, 39, NOW, 'idle');
    const row = rowOf({ run: { kind: 'working', secs: 191 } });
    expect(row.replace(/\s+/g, ' ').trim()).toBe('phase ○ idle 0:39');
    forgetBandFrame();
  });
  test('a stale note is ignored: the panel keeps its own reading', () => {
    noteBandFrame(2, 36, NOW - 5_000, 'blocked');
    expect(rowOf({})).toContain('working');
    forgetBandFrame();
  });
  test('the phase strip does not sit lit on `research` after the plan finished and the band rests', () => {
    const todos = [1, 2, 3].map((i) => ({ id: `t${i}`, label: `T${i}`, state: 'done' as const }));
    noteBandFrame(2, 39, NOW, 'idle');
    const m = panelWorld('route', 150, ui, { rows: 40, now: NOW, run: { kind: 'idle', secs: 39 }, phase: 'research', todos });
    const chain = panelLines(m).map(lineText).find((l) => /research ›/.test(l))!;
    expect(chain).toMatch(/● research/);
    expect(chain).not.toMatch(/○ research/);
    forgetBandFrame();
  });
});
