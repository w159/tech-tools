// truth 40: the band works whenever a host turn of the run is on (stoprun-110-1 f0062-f0072), a later slash command still never extends the clock, and the run clock never steps back (f0061 0:30, f0062 0:29).
import { describe, expect, test } from 'claude-code/testing';
import { holdClock, newRunClock, resumeOk, runKey, runLive, stepRun, type RunClock } from './band-motion';
import { runElapsed } from './data/runstate';
import { bandLines, runsText, type MissionModel, type MissionWorker } from './mission-layout';
import { leadSpinnerGlyph, type Ui } from './atlas-ui';
import { forgetBandFrame, noteBandFrame } from './motion';
import { lineText, panelLines, type PanelModel } from './panel-layout';
import { panelWorld } from '../contracts/panel-world';
import { blockedText } from './data/runstate';
import { noteWorkerFacts, resetWorkerFacts } from './data/live';
import { busySnap } from './live_fixture';
import type { AtlasSnapshot } from './contract';
import { forgetPlaced, noteBlocked, placedTree, placeFinished } from './transcript/placed';

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

describe('step 4: the panel phase row is the band\'s last frame', () => {
  const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
  const NOW = 2_000_000;
  const rowOf = (now: number, over: Partial<PanelModel> = {}): string => {
    const m = panelWorld('route', 150, ui, { rows: 40, now, run: { kind: 'working', secs: 24 }, phase: 'research', ...over });
    return panelLines(m).map(lineText).find((l) => /^\s*phase\b/.test(l))!.replace(/\s+/g, ' ').trim();
  };
  test('band draws frame N / 0:25; the panel at the same now, one beat later and 1.9 s later has the same glyph, word and clock', () => {
    for (const frame of [0, 3, 5, 9]) {
      noteBandFrame(frame, 25, NOW, 'working');
      for (const dt of [0, 100, 1_900]) expect(rowOf(NOW + dt), `${frame}+${dt}`).toMatch(new RegExp(`^phase ${leadSpinnerGlyph(frame)} working · research 0:25`));
    }
    forgetBandFrame();
  });
  test('a band frame older than 2 s is not used', () => {
    noteBandFrame(5, 25, NOW, 'working');
    expect(rowOf(NOW + 2_500)).not.toMatch(/0:25/);
    forgetBandFrame();
  });
  test('a blocked strip puts the mark on the last phase the run entered, not on an earlier header phase', () => {
    noteBandFrame(2, 41, NOW, 'blocked');
    const m = panelWorld('route', 150, ui, { rows: 40, now: NOW, run: { kind: 'blocked', secs: 41 }, phase: 'research', entered: ['plan', 'research', 'build'] });
    const chain = panelLines(m).map(lineText).find((l) => /research ›/.test(l))!;
    expect(chain).toMatch(/▲ build/);
    expect(chain).not.toMatch(/▲ research/);
    forgetBandFrame();
  });
});

describe('step 5: one blocked card per spell, and a worker card carries its final row', () => {
  const NOW = 3_000_000;
  const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
  type El = { children?: unknown[] };
  const flat = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as El).children ?? []).map(flat).join('') : '');
  const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
  const NAMES = ['alpha-explorer', 'beta-explorer'];
  const snapAt = (now: number, finished: string[], calls: number[] = []): AtlasSnapshot => ({
    ...(busySnap() as object), now, phase: 'research', sessionId: 's', counts: { done: 0, total: 5, byPhase: {} }, todos: [], todoGroups: [], comms: [],
    squad: NAMES.map((name) => ({ name, persona: 'explorer', state: finished.includes(name) ? 'finished' : 'running', source: 'task' })),
    activity: Object.fromEntries(NAMES.map((n, i) => [n, act({ startedAt: now - 12_000 - i * 1000, since: finished.includes(n) ? now : now - 1000, mood: finished.includes(n) ? 'done' : 'working', calls })])),
  }) as unknown as AtlasSnapshot;
  const slowEngine = (ids: string[]) => ({ ui: { place: async ({ id }: { id: string }) => { await Promise.resolve(); await Promise.resolve(); ids.push(id); return { isPlaced: true, requestId: id }; }, invalidate: () => undefined } }) as never;
  const blockedIds = (ids: string[]): string[] => ids.filter((i) => i.startsWith('done-blocked'));

  test('the tick and the beat reaching the place together print one blocked card (stoprun-150-1 f0111 printed two)', async () => {
    forgetPlaced();
    const ids: string[] = [];
    const s = snapAt(NOW, []);
    noteBlocked({ reason: blockedText({ refused: true, failed: 1 }), secs: 41 });
    await Promise.all([placeFinished(slowEngine(ids), s, s), placeFinished(slowEngine(ids), s, s), placeFinished(slowEngine(ids), s, s)]);
    await placeFinished(slowEngine(ids), s, s);
    expect(blockedIds(ids)).toHaveLength(1);
    forgetPlaced();
  });
  test('the band flickering off blocked for under 3 s (the idle hold) and back is the same spell: no second card', async () => {
    forgetPlaced();
    const ids: string[] = [];
    const s = snapAt(NOW, []);
    noteBlocked({ reason: 'stop refused', secs: 41 }, 1_000);
    await placeFinished(slowEngine(ids), s, s);
    noteBlocked(null, 2_000);
    noteBlocked({ reason: 'stop refused', secs: 42 }, 2_500);
    await placeFinished(slowEngine(ids), s, s);
    expect(blockedIds(ids)).toHaveLength(1);
    noteBlocked(null, 3_000); // really gone
    noteBlocked({ reason: 'stop refused', secs: 60 }, 6_100);
    await placeFinished(slowEngine(ids), s, s);
    expect(blockedIds(ids)).toHaveLength(2);
    forgetPlaced();
  });
  test('live-150-1 f0052: beta ends at 0:13 while the table last drew its running row at 0:10; the card waits and prints the row drawn after the end', async () => {
    forgetPlaced(); resetWorkerFacts();
    const ids: string[] = [];
    noteWorkerFacts(['beta-explorer'], '0:10', '2'); // the running row
    await placeFinished(slowEngine(ids), snapAt(NOW, []), snapAt(NOW + 1_000, ['beta-explorer'], [1, 2, 3]));
    expect(ids.filter((i) => i.startsWith('done-beta'))).toHaveLength(0);
    noteWorkerFacts(['beta-explorer'], '0:13', '3'); // the SUBAGENTS row once the worker is done
    const next = snapAt(NOW + 1_100, ['beta-explorer'], [1, 2, 3]);
    await placeFinished(slowEngine(ids), next, next);
    const card = ids.filter((i) => i.startsWith('done-beta'));
    expect(card).toHaveLength(1);
    expect(flat(placedTree(card[0]!, ui))).toMatch(/beta-explorer\s+0:13 · 3 calls$/);
    forgetPlaced(); resetWorkerFacts();
  });
  test('no table drawn at all: the card is placed at once, as before', async () => {
    forgetPlaced(); resetWorkerFacts();
    const ids: string[] = [];
    await placeFinished(slowEngine(ids), snapAt(NOW, []), snapAt(NOW + 1_000, ['beta-explorer'], [1, 2, 3]));
    expect(ids.filter((i) => i.startsWith('done-beta'))).toHaveLength(1);
    forgetPlaced();
  });
});
