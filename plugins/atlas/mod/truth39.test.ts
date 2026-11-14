// Truth 39: the band, the side panel's phase row and the transcript cards print only what is true (critique of build 63934f09). One group per step.
import { describe, expect, test } from 'claude-code/testing';
import { newRunClock, runLive, stepRun } from './band-motion';
import { readFileSync } from 'node:fs';
import { blockedText, runElapsed } from './data/runstate';
import { noteWorkerFacts, resetWorkerFacts } from './data/live';
import { busySnap } from './live_fixture';
import type { AtlasSnapshot } from './contract';
import { cardAged, cardsDue, forgetPlaced, noteBlocked, noteRunFinal, placedTree, placeFinished } from './transcript/placed';
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

describe('step 5: transcript cards are immutable, ordered and complete', () => {
  const NOW = 3_000_000;
  const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
  type El = { children?: unknown[] };
  const flat = (n: unknown): string => (typeof n === 'string' ? n : n && typeof n === 'object' ? ((n as El).children ?? []).map(flat).join('') : '');
  const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
  const NAMES = ['alpha-explorer', 'beta-explorer', 'gamma-explorer'];
  const snapAt = (now: number, states: Record<string, 'running' | 'finished'>, calls: Record<string, number[]> = {}): AtlasSnapshot => {
    const done = NAMES.filter((n) => states[n] === 'finished').length;
    return {
      ...(busySnap() as object), now, phase: 'research', sessionId: 's', counts: { done: done === 3 ? 5 : done, total: 5, byPhase: {} }, todos: [], todoGroups: [], comms: [],
      squad: NAMES.map((name) => ({ name, persona: 'explorer', state: states[name] ?? 'running', source: 'task' })),
      activity: Object.fromEntries(NAMES.map((n, i) => [n, act({ startedAt: now - 12_000 - i * 1000 - (states[n] === 'finished' ? 0 : 0), since: states[n] === 'finished' ? now : now - 1000, mood: states[n] === 'finished' ? 'done' : 'working', calls: calls[n] ?? [] })])),
    } as unknown as AtlasSnapshot;
  };
  const engine = (ids: string[]) => ({ ui: { place: async ({ id }: { id: string }) => { ids.push(id); return { isPlaced: true, requestId: id }; }, invalidate: () => undefined } }) as never;

  test('a placed card is never removed: three finishes and a long age leave all three drawn (beta vanished at live-150-1 f0077)', async () => {
    forgetPlaced(); resetWorkerFacts();
    const ids: string[] = [];
    const run = { 'alpha-explorer': 'running', 'beta-explorer': 'running', 'gamma-explorer': 'running' } as const;
    await placeFinished(engine(ids), snapAt(NOW, run), snapAt(NOW + 1_000, { ...run, 'gamma-explorer': 'finished' }));
    await placeFinished(engine(ids), snapAt(NOW + 1_000, { ...run, 'gamma-explorer': 'finished' }), snapAt(NOW + 2_000, { ...run, 'gamma-explorer': 'finished', 'beta-explorer': 'finished' }));
    await placeFinished(engine(ids), snapAt(NOW + 2_000, { ...run, 'gamma-explorer': 'finished', 'beta-explorer': 'finished' }), snapAt(NOW + 3_000, { 'alpha-explorer': 'finished', 'beta-explorer': 'finished', 'gamma-explorer': 'finished' }));
    const workers = ids.filter((i) => !i.startsWith('done-run'));
    expect(workers).toHaveLength(3);
    for (const id of workers) {
      cardAged(id, NOW + 3_000); // drawn once, then long past the old stacking window
      const text = flat(placedTree(id, ui, true, { hidden: true }));
      expect(text, id).toMatch(/ATLAS/);
    }
    for (const id of workers) expect(flat(placedTree(id, ui, true, { hidden: true }))).toMatch(/explorer/);
    expect(workers.map((id) => /(gamma|beta|alpha)-explorer/.exec(flat(placedTree(id, ui)))![1])).toEqual(['gamma', 'beta', 'alpha']); // in the order they finished
    forgetPlaced();
  });

  test('a placed worker card is fixed: the SUBAGENTS cells moving on later (0:12 then 0:13, 3 then 4 calls) never rewrite it', async () => {
    forgetPlaced(); resetWorkerFacts();
    const ids: string[] = [];
    noteWorkerFacts(['alpha-explorer'], '0:10', '2'); // the table drew the running row
    const run = { 'alpha-explorer': 'running', 'beta-explorer': 'running', 'gamma-explorer': 'running' } as const;
    await placeFinished(engine(ids), snapAt(NOW, run), snapAt(NOW + 1_000, { ...run, 'alpha-explorer': 'finished' }));
    expect(ids).toHaveLength(0); // truth 40: the card waits for the row drawn after the worker ended
    noteWorkerFacts(['alpha-explorer'], '0:12', '3');
    await placeFinished(engine(ids), snapAt(NOW + 1_000, { ...run, 'alpha-explorer': 'finished' }), snapAt(NOW + 1_000, { ...run, 'alpha-explorer': 'finished' }));
    const id = ids.find((i) => !i.startsWith('done-run'))!;
    const placed = flat(placedTree(id, ui));
    expect(placed).toMatch(/alpha-explorer\s+0:12 · 3 calls$/);
    noteWorkerFacts(['alpha-explorer'], '0:13', '4');
    expect(flat(placedTree(id, ui))).toBe(placed);
    forgetPlaced(); resetWorkerFacts();
  });

  test('the run card waits for the band: nothing is placed while the band works, and only a beat after it flipped done', async () => {
    forgetPlaced();
    const ids: string[] = [];
    const fin = { 'alpha-explorer': 'finished', 'beta-explorer': 'finished', 'gamma-explorer': 'finished' } as const;
    const was = snapAt(NOW, fin);
    const now = snapAt(NOW + 500, fin);
    noteRunFinal(null); // the band's run is open
    expect(cardsDue()).toBe(false);
    await placeFinished(engine(ids), was, now);
    expect(ids.filter((i) => i.startsWith('done-run'))).toHaveLength(0);
    noteRunFinal(38); // the render in which the band reads done: the card is due, and placed by the next beat (register.ts frameBeat), never inside the render
    expect(cardsDue()).toBe(true);
    await placeFinished(engine(ids), now, now);
    const run = ids.filter((i) => i.startsWith('done-run'));
    expect(run).toHaveLength(1);
    expect(flat(placedTree(run[0]!, ui))).toMatch(/done\s+5\/5 · 3 workers\s+0:38$/);
    expect(cardsDue()).toBe(false);
    await placeFinished(engine(ids), now, now);
    expect(ids.filter((i) => i.startsWith('done-run'))).toHaveLength(1);
    forgetPlaced();
  });

  test('the render never places a card itself: register.ts places from the frame beat only', () => {
    const src = readFileSync(`${import.meta.dir}/register.ts`, 'utf8');
    const render = src.slice(src.indexOf("noteRunFinal(finalNow)"), src.indexOf("noteRunFinal(finalNow)") + 400);
    expect(render).not.toMatch(/placeFinished/);
    expect(src).toMatch(/if \(cardsDue\(\)\) await placeFinished\(/);
  });

  test('a blocked card is printed once when the band first reads blocked: `▌ ◆ ATLAS  ▲ blocked · stop refused  0:36`, a 203 bar', async () => {
    forgetPlaced();
    const ids: string[] = [];
    const s = snapAt(NOW, { 'alpha-explorer': 'running', 'beta-explorer': 'running', 'gamma-explorer': 'running' });
    expect(cardsDue()).toBe(false);
    noteBlocked({ reason: blockedText({ refused: true, failed: 1 }), secs: 36 });
    expect(cardsDue()).toBe(true);
    await placeFinished(engine(ids), s, s);
    await placeFinished(engine(ids), s, s);
    noteBlocked({ reason: blockedText({ refused: true, failed: 1 }), secs: 37 }); // the band keeps reading blocked: no second card
    await placeFinished(engine(ids), s, s);
    const cards = ids.filter((i) => i.startsWith('done-blocked'));
    expect(cards).toHaveLength(1);
    const tree = placedTree(cards[0]!, ui)!;
    expect(flat(tree)).toMatch(/^▌ ◆ ATLAS {2}▲ blocked · stop refused\s+0:36$/);
    expect(JSON.stringify(tree)).toMatch(/"color":"#ff5f5f"[^}]*\},"children":\["▌"\]/); // the bar is xterm 203
    expect(placedTree(cards[0]!, ui, true, { hidden: true })).toEqual(tree); // aged and stacked or not, it stays
    noteBlocked(null, 10_000); // the band left blocked for good; a new blocked spell (3 s later) prints one more
    noteBlocked({ reason: blockedText({ refused: false, failed: 1 }), secs: 50 }, 13_100);
    await placeFinished(engine(ids), s, s);
    expect(ids.filter((i) => i.startsWith('done-blocked'))).toHaveLength(2);
    expect(flat(placedTree(ids.filter((i) => i.startsWith('done-blocked'))[1]!, ui))).toMatch(/▲ blocked · 1 failed\s+0:50$/);
    forgetPlaced();
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
      expect(narrow, String(cols)).toMatch(/[◐◓◑◒]1 ●1 ■1$/);
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
  test('stoprun-150-3 f0074: the run built from the band\'s inputs says blocked 0:36, and the panel prints exactly that (truth 41: no copy of a note)', () => {
    expect(rowOf({ run: { kind: 'blocked', secs: 36 } }).replace(/\s+/g, ' ').trim()).toBe('phase ▲ blocked 0:36');
  });
  test('live-150-2 f0106: a run that reads idle 0:39 prints idle 0:39, never working', () => {
    const row = rowOf({ run: { kind: 'idle', secs: 39 } });
    expect(row.replace(/\s+/g, ' ').trim()).toBe('phase ○ idle 0:39');
  });
  test('a band note is never read: the panel prints the run it was built with', () => {
    noteBandFrame(2, 36, NOW, 'blocked');
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
