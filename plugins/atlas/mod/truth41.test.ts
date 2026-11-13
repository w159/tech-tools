// Truth 41 (critique 40 of build 11e67a82): one frozen run total and one state at run end, on every surface. One group per step; each test names the frame it comes from.
import { describe, expect, test } from 'claude-code/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClientElements } from 'claude-code';
import { closedTotal, newRunClock, readRun, runKey, stepRun, type ClockHold, type RunClock } from './band-motion';
import { elapsedClock, phaseGlyph, type Ui } from './atlas-ui';
import { bandLines, runsText, type MissionModel } from './mission-layout';
import { panelWorld } from '../contracts/panel-world';
import { lineText, panelLines, bodyLines } from './panel-layout';
import { forgetPhases, panelModelOf } from './pane/sidebar-model';
import { sidebarTree, type SidebarHandlers, type SidebarModel, type SidebarView } from './pane/sidebar';
import { forgetRefusals } from './data/channels';
import { agentModel, hudAgents } from './hud';
import { liveWorkers, queuedMembers } from './data/live';
import { busySnap, NOW } from './live_fixture';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const src = readFileSync(resolve(import.meta.dir, 'register.ts'), 'utf8');

/** A run that opened at 5 s and whose clock closed at `end` ms when the host turn ended (the beat grace never moves it). */
const runTo = (end: number): { open: RunClock; closed: RunClock } => {
  let c = stepRun(newRunClock(), true, 5_000);
  for (let t = 5_100; t <= end; t += 100) c = stepRun(c, true, t);
  return { open: c, closed: stepRun(c, false, end + 100, { hostIdle: true }) };
};

describe('step 1: the done clock never moves once the run closed (live-150-1 f0093-f0095: done 0:46, 0:47, 0:48)', () => {
  test('after the close, every reading of the run is the one total, for 10 s of renders', () => {
    const { open, closed } = runTo(51_000);
    let hold: ClockHold = null;
    const seen: Array<number | undefined> = [];
    for (let t = 5_000; t <= 51_000; t += 500) { const r = readRun(hold, open, t); hold = r.hold; }
    for (let t = 51_100; t <= 62_000; t += 100) {
      const r = readRun(hold, closed, t);
      hold = r.hold;
      seen.push(r.work, r.final);
    }
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBeGreaterThanOrEqual(46);
  });
  test('the band `done` line prints the same clock on every one of those renders', () => {
    const { closed } = runTo(51_000);
    let hold: ClockHold = null;
    const lines = new Set<string>();
    for (let t = 51_100; t <= 62_000; t += 100) {
      const r = readRun(hold, closed, t);
      hold = r.hold;
      const m: MissionModel = { cols: 150, maxRows: 1, tick: Math.floor(t / 100), project: 'p', phases: ['research', 'done'], phase: 'done', done: 5, total: 5, workers: [], checks: null, ui, ranSecs: r.final!, restSecs: 0 };
      lines.add(runsText(bandLines(m)[0]!.runs).match(/done\s*·?\s*(\d+:\d\d)/)![1]!);
    }
    expect([...lines]).toEqual([elapsedClock(Math.floor(closed.ranMs! / 1000))]);
  });
  test('the total is never lower than the largest figure the open clock showed (0:30 then 0:29 stays 0:30), and a new run starts over', () => {
    const { closed } = runTo(36_000);
    const key = runKey(closed);
    const shown: ClockHold = { key: key!, max: 40 };
    expect(closedTotal(shown, closed).secs).toBe(40);
    expect(closedTotal({ key: 1, max: 99 }, closed).secs).toBe(Math.floor(closed.ranMs! / 1000));
  });
  test('register.ts reads the run total only through readRun (no rest added to a closed clock)', () => {
    expect(src).toContain('readRun(clockHeld, runClock');
    expect(src).not.toContain('runElapsed(');
  });
});

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const on = { selectRecipient() {}, toggle() {}, draftChange() {}, send() {}, copy() {}, focus() {}, expand() {}, setView() {} } as unknown as SidebarHandlers;
const kids = (n: Node): Node[] => { const c = n.props.children; return (Array.isArray(c) ? c : c == null ? [] : [c]).filter((x: unknown): x is Node => typeof x === 'object' && x !== null); };
const textOf = (n: Node): string => (n.kind === 'Text' ? String(n.props.children ?? '') : n.kind === 'Box' && n.props.width === 0 ? '' : kids(n).map(textOf).join(n.props.flexDirection === 'column' ? '\n' : ''));
const act = (o: Record<string, unknown>) => ({ tool: null, since: NOW, toolCount: 0, tokens: null, mood: 'idle', lastLine: '', ...o });
/** The live-150-1 shape at its end: three explorers finished, no channel post, the lead done. */
const world = (over: Record<string, unknown> = {}) => ({
  ...busySnap(), phase: 'done', now: NOW, channel: 'lc-t41', sessionId: 's',
  squad: ['alpha-explorer', 'beta-explorer', 'gamma-explorer'].map((name) => ({ name, persona: 'explorer', state: 'finished', source: 'task' })),
  activity: {
    lead: act({ mood: 'working', toolCount: 9, startedAt: NOW - 46000 }),
    'alpha-explorer': act({ startedAt: NOW - 32000, since: NOW - 13000, mood: 'done', calls: [NOW - 30000, NOW - 20000, NOW - 14000], toolCount: 3 }),
    'beta-explorer': act({ startedAt: NOW - 32000, since: NOW - 18000, mood: 'done', calls: [NOW - 30000, NOW - 25000, NOW - 19000], toolCount: 3 }),
    'gamma-explorer': act({ startedAt: NOW - 31000, since: NOW - 18000, mood: 'done', calls: [NOW - 30000, NOW - 25000, NOW - 19000], toolCount: 3 }),
  },
  todos: ['alpha', 'beta', 'gamma'].map((n, i) => ({ id: String(i + 1), content: `T${i + 1} read ${n}.py`, status: 'completed', owner: `${n}-explorer`, session_id: 's', claimed_at: (NOW - 32000) / 1000, completed_at: (NOW - 14000) / 1000 })), notes: [], ...over,
}) as never;
const model = (s: never, view: SidebarView, run: SidebarModel['run'], over: Partial<SidebarModel> = {}): SidebarModel => ({ snapshot: s, gates: [], ui: { recipient: null, expanded: null, draft: '', view }, columns: 111, rows: 41, look: ui, ...(run ? { run } : {}), ...over } as SidebarModel);
const render = (view: SidebarView, run: SidebarModel['run'], s = world()): string[] => { forgetRefusals(); forgetPhases(); return textOf(sidebarTree(els, model(s, view, run), on) as unknown as Node).split('\n'); };

describe('step 2: one run total on the band, the panel, the board and the axis (live-150-1 f0095: card 0:46, band 0:48, panel 0:47)', () => {
  const RUN = { kind: 'done' as const, secs: 46, startMs: NOW - 46000 };
  test('the board footer, the board axis end, the team axis end and the route phase clock all print 0:46', () => {
    const board = render('board', RUN);
    expect(board.join('\n')).toMatch(/total 0:46\b/);
    expect(board.find((l) => /^\s+0:00\s.*\d:\d\d\s*$/.test(l))).toMatch(/0:46\s*$/);
    expect(render('team', RUN).find((l) => /^\s+0:00\s+\d:\d\d\s*$/.test(l))).toMatch(/0:00\s+0:46\s*$/);
    expect(render('route', RUN).find((l) => /^\s*phase\b/.test(l))).toMatch(/done 0:46$/);
  });
  test('the band prints the same total as the panel: `● done 0:46`', () => {
    const m: MissionModel = { cols: 150, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'done'], phase: 'done', done: 5, total: 5, workers: [], checks: null, ui, ranSecs: 46, restSecs: 0 };
    expect(runsText(bandLines(m)[0]!.runs)).toMatch(/● done\s+·?\s*0:46/);
  });
  test('the channel tab and the events list stamp one worker\'s end with one time (live-150-1: +0:39 finished against +0:33 done)', () => {
    const route = render('route', RUN).join('\n');
    const channel = render('channel', RUN).join('\n');
    for (const who of ['alpha-explorer', 'beta-explorer', 'gamma-explorer']) {
      const ev = route.match(new RegExp(`(\\+\\d:\\d\\d)\\s+${who}\\s+done`));
      const ch = channel.match(new RegExp(`${who}\\s+(\\+\\d:\\d\\d)`));
      expect(ev, `${who} in events`).not.toBeNull();
      expect(ch, `${who} in channel`).not.toBeNull();
      expect(ch![1], who).toBe(ev![1]);
    }
  });
  test('the run origin the panel stamps from is fixed per run, not recomputed from the clock on every render', () => {
    expect(src).toContain('originOf(snapshot.now, paneNow)');
    expect(src).not.toContain('startMs: snapshot.now - elapsedMs');
  });
  test('a worker\'s time on the panel lane is the SUBAGENTS row\'s on the same frame (live-150-1 f0063: alpha 0:16 against 0:17)', () => {
    const running = world({ squad: [{ name: 'alpha-explorer', persona: 'explorer', state: 'running', source: 'task' }], activity: { lead: act({ mood: 'working', startedAt: NOW - 20000 }), 'alpha-explorer': act({ startedAt: NOW - 15_400, since: NOW, mood: 'working', toolCount: 1 }) } }) as never as { now: number };
    const clock = NOW + 1_000; // the shared clock runs ahead of the snapshot between polls: the HUD reads the larger
    const s = running as never;
    const hud = agentModel(hudAgents(liveWorkers(s, s.now), s.squad, queuedMembers(s)), s.todos, null, Math.max(clock, s.now));
    const row = hud.find((a) => a.name.startsWith('alpha'))!;
    const lane = panelModelOf(model(s, 'team', { kind: 'working', secs: 20 }, { clock }), ui, 110).workers.find((w) => w.name.startsWith('alpha'))!;
    expect(elapsedClock(lane.secs!)).toBe(row.elapsed);
    expect(row.elapsed).toBe('0:16');
  });
});

describe('step 3: the panel phase row is the band for one now, in every state (live-150-1 f0063 `⠴` against `⠦`; f0092 `⠸ working` under `● done`)', () => {
  const base: MissionModel = { cols: 150, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'implement', 'done'], phase: 'implement', done: 3, total: 5, workers: [], checks: null, ui };
  const cases: Array<{ name: string; m: Partial<MissionModel>; word: string }> = [
    { name: 'working', m: { busy: true, turnSecs: 42 }, word: 'working' },
    { name: 'done', m: { phase: 'done', done: 5, total: 5, ranSecs: 46, restSecs: 0 }, word: 'done' },
    { name: 'blocked', m: { blocked: true, ranSecs: 38 }, word: 'blocked' },
    { name: 'idle', m: { ranSecs: 39, restSecs: 60 }, word: 'idle' },
  ];
  const lead = (t: string) => { const x = t.match(/ATLAS ◗ +(\S) (working|done|idle|blocked)\b[^\d]*(\d+:\d\d)?/); return x ? { glyph: x[1], word: x[2], clock: x[3] } : null; };
  const phase = (t: string) => { const x = t.replace(/\s+/g, ' ').match(/phase (\S) (working|done|idle|blocked)\b[^\d]*(\d+:\d\d)?/); return x ? { glyph: x[1], word: x[2], clock: x[3] } : null; };
  for (const tick of [0, 3, 7, 9]) {
    for (const c of cases) {
      test(`${c.name} at frame ${tick}: same glyph, word and clock`, () => {
        const mm: MissionModel = { ...base, ...c.m, tick };
        const band = lead(runsText(bandLines(mm)[0]!.runs));
        expect(band, 'band').not.toBeNull();
        expect(band!.word).toBe(c.word);
        const secs = c.word === 'working' ? mm.turnSecs! : mm.ranSecs!;
        const pm = panelWorld('route', 150, ui, { rows: 40, now: 1_000_000 + tick * 7, run: { kind: c.word as 'working', secs, frame: tick }, phase: 'implement' });
        const row = phase(panelLines(pm).map(lineText).find((l) => /^\s*phase\b/.test(l))!);
        expect(row, 'panel').not.toBeNull();
        expect(row!.glyph).toBe(band!.glyph);
        expect(row!.word).toBe(band!.word);
        expect(row!.clock).toBe(band!.clock);
      });
    }
  }
  test('phaseGlyph is the one glyph function: working turns, the others stand still', () => {
    expect(phaseGlyph('done', 3)).toBe(phaseGlyph('done', 8));
    expect(phaseGlyph('working', 1)).not.toBe(phaseGlyph('working', 2));
    expect(phaseGlyph('blocked', 0)).toBe('▲');
  });
  test('register.ts builds the band\'s model and the panel\'s from one function', () => {
    expect(src).toContain('...runBandModel({ snapshot, live, gates, core, agentsAlive, isWorking: e.props.isWorking, clockNow, look })');
    expect(src).toContain('...runBandModel({ snapshot, live: paneLive,');
    expect(src).toContain('frame: paneFrame % 10');
  });
});
