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
import type { LiveSnapshot } from './orchestra-types';

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
    const s = world({ squad: [{ name: 'alpha-explorer', persona: 'explorer', state: 'running', source: 'task' }], activity: { lead: act({ mood: 'working', startedAt: NOW - 20000 }), 'alpha-explorer': act({ startedAt: NOW - 15_400, since: NOW, mood: 'working', toolCount: 1 }) } }) as unknown as LiveSnapshot;
    const clock = NOW + 1_000; // the shared clock runs ahead of the snapshot between polls: the HUD reads the larger
    const hud = agentModel(hudAgents(liveWorkers(s, s.now), s.squad, queuedMembers(s)), s.todos, null, Math.max(clock, s.now));
    const row = hud.find((a) => a.name.startsWith('alpha'))!;
    const lane = panelModelOf(model(s as never, 'team', { kind: 'working', secs: 20 }, { clock }), ui, 110).workers.find((w) => w.name.startsWith('alpha'))!;
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

import { hudLines, type HudAgent, type HudInput } from './hud';
import { runsString } from './atlas-ui';
import { ownTodos } from './data/todos';
import { functionsIn } from './hud';
import { blockedText } from './data/runstate';
import { beatDue, KIND_HOLD_MS, newKindHold, stepKind, type KindWord } from './band-motion';

describe('step 4: a refused stop or a failed worker reads blocked, never idle, and no working glyph is ever drawn frozen', () => {
  const base: MissionModel = { cols: 110, maxRows: 1, tick: 0, project: 'p', phases: ['research', 'implement', 'done'], phase: 'implement', done: 4, total: 5, workers: [{ name: 'ghost-explorer', state: 'failed', secs: 4 }, { name: 'alpha-explorer', state: 'done', secs: 13 }], checks: null, ui, ranSecs: 38, restSecs: 3, tally: { running: 0, waiting: 0, queued: 0, failed: 1, done: 2, blocked: 0 } as never };
  const text = (m: MissionModel): string => runsText(bandLines(m)[0]!.runs).replace(/\s+/g, ' ');
  test('stoprun-110-2 f0076: a closed run with a failed worker reads `▲ blocked · 1 failed 0:38`, never `○ idle · 0:38`', () => {
    expect(text(base)).toMatch(/▲ blocked · 1 failed 0:38/);
    expect(text(base)).not.toContain('idle');
  });
  test('it stays blocked as the rest grows, until a new run (not idle at 60 s, not done)', () => {
    for (const restSecs of [0, 3, 30, 60, 600]) expect(text({ ...base, restSecs }), String(restSecs)).toMatch(/▲ blocked · 1 failed 0:38/);
    expect(text({ ...base, restSecs: 600, phase: 'done', done: 5, total: 5 })).toMatch(/▲ blocked/);
  });
  test('a failure beside live work stays a count on a working band; a closed failure is not a block; no run seen keeps the old reading', () => {
    expect(text({ ...base, busy: true })).toMatch(/working/);
    expect(text({ ...base, closed: 1 })).not.toMatch(/blocked/);
    const { ranSecs: _r, ...noRun } = base;
    expect(text(noRun as MissionModel)).toMatch(/idle/);
  });
  test('the blocked word and the reason are the card\'s own: `1 failed`', () => {
    expect(blockedText({ refused: false, failed: 1 })).toBe('1 failed');
  });
  test('a held `working` word beats on: every beat is due while the band draws working, whatever holds it (f0096-f0097: two beats-worth frames frozen for 1.81 s)', () => {
    for (const shown of ['working'] as KindWord[]) expect(beatDue({ working: false, shown, open: false, ended: false, flip: false })).toBe(true);
    expect(beatDue({ working: false, shown: 'idle', open: false, ended: false, flip: false })).toBe(false);
    expect(beatDue({ working: false, shown: 'blocked', open: false, ended: false, flip: false })).toBe(false);
  });
  test('the idle hold shows `working` only for KIND_HOLD_MS, and a beat is due for every one of those frames', () => {
    let h = newKindHold();
    h = stepKind(h, 'working', 1_000).hold;
    let frozen = 0;
    for (let t = 1_100; t <= 4_000; t += 100) {
      const s = stepKind(h, 'idle', t);
      h = s.hold;
      if (s.shown === 'working') { expect(beatDue({ working: false, shown: s.shown, open: false, ended: false, flip: false })).toBe(true); frozen += 100; }
    }
    expect(frozen).toBeLessThanOrEqual(KIND_HOLD_MS);
  });
  test('register.ts redraws on beatDue and records the word the band drew', () => {
    expect(src).toContain('beatDue({ working, shown: shownKind,');
    expect(src).toContain('shownKind = kStep.shown;');
  });
});

describe('step 5: small truth items', () => {
  const ag = (name: string, state: string, ui2: HudAgent['ui']): HudAgent => ({ name, role: 'explorer', state, ui: ui2, model: 'haiku', since: NOW - 5000, startedAt: NOW - 20000 });
  const todos = ownTodos(['alpha', 'beta'].map((n, i) => ({ id: `t${i + 1}`, content: `T${i + 1} read ${n}.py (${n}-explorer)`, status: 'completed', owner: `${n}-explorer` })) as never);
  const input = (states: Array<[string, HudAgent['ui']]>): HudInput => ({ todos: todos as unknown as HudInput['todos'], agents: states.map(([s, u], i) => ag(i ? 'beta-explorer' : 'alpha-explorer', s, u)) });
  test('the idle TODO meter keeps its 203 cell for a failed row (stoprun-110-2 f0076:22 against f0096:22)', () => {
    const failedTodos = ownTodos([{ id: 't1', content: 'T1 read alpha.py (alpha-explorer)', status: 'completed', owner: 'alpha-explorer' }, { id: 't2', content: 'T2 read ghost.py (ghost-explorer)', status: 'blocked', owner: 'ghost-explorer' }] as never);
    const inp: HudInput = { todos: failedTodos as unknown as HudInput['todos'], agents: [ag('alpha-explorer', 'done', 'done'), ag('ghost-explorer', 'failed', 'failed')] };
    const rows = (idle: boolean) => hudLines(inp, { cols: 110, maxRows: 30, ui, rich: false, now: NOW, ...(idle ? { idle: true } : {}) }).find((l) => l.some((x) => x.t === '▰' || /^▰+$/.test(x.t)));
    const cells = (idle: boolean) => rows(idle)!.filter((x) => /^▰+$/.test(x.t)).map((x) => x.tone);
    expect(cells(false)).toContain('bad');
    expect(cells(true)).toContain('bad');
  });
  test('FN reads 2 for alpha when its report says `defines two functions` and lists `alpha_one()` defined at alpha.py:1 (live-150-1 f0092:34)', () => {
    expect(functionsIn(['STATUS: Done. alpha.py defines two functions.'])).toBe(2);
    expect(functionsIn(['EVIDENCE:\n- `alpha_one()` defined at /tmp/x/alpha.py:1\n- `alpha_two(x)` defined at /tmp/x/alpha.py:5'])).toBe(2);
    expect(functionsIn(['3 functions', 'nothing here'])).toBe(3);
    expect(functionsIn(['read the whole thing, one file'])).toBe(0);
  });
  test('SUBAGENTS column starts are the same working and at rest at one terminal width (stoprun-110-2: 12 against 16 cells was the host\'s reflow, 61 against 71 columns)', () => {
    const starts = (cols: number, states: Array<[string, HudAgent['ui']]>, extra: object): number[] => {
      const head = hudLines(input(states), { cols, maxRows: 30, ui, rich: false, now: NOW, merge: false, ...extra }).map(runsString).find((r) => /AGENT\s+STATE/.test(r))!;
      return ['AGENT', 'STATE', 'TIME', 'CALLS', 'FN', 'LAST'].map((w) => head.indexOf(w));
    };
    for (const cols of [61, 80, 110, 150]) {
      const idle = starts(cols, [['done', 'done'], ['done', 'done']], { idle: true });
      const work = starts(cols, [['working', 'running'], ['done', 'done']], { working: true });
      expect(work, String(cols)).toEqual(idle);
    }
  });
});
