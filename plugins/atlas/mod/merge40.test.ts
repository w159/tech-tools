// Wave 40 follow-ups: (A) the HUD draws on the band's clock; (B) a host turn with no live run reads `working` with a moving spinner and no clock, and leaves the closed run alone.
import { describe, expect, test } from 'claude-code/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClientElements } from 'claude-code';
import { bandKindOf, bandRuns, bandTree, type BandModel } from './band';
import { newRunClock, restSecsOf, runLive, stepRun } from './band-motion';
import { runsText } from './mission-layout';
import type { Ui } from './atlas-ui';
import { forgetBandFrame, bandFrame } from './motion';
import { busySnap, NOW } from './live_fixture';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button') } as unknown as ClientElements;
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const BRAILLE = /[⠀-⣿]/;
const idleSnap = () => busySnap({ squad: [], comms: [], sessionId: 's', activity: { lead: { tool: null, since: NOW, toolCount: 1, tokens: null, mood: 'idle', lastLine: '' } } } as never);
const band = (over: Partial<BandModel>, columns = 150): BandModel => ({ snapshot: idleSnap(), live: [], gates: [], columns, tick: 3, maxRows: 12, ui, ...over });
const text = (b: BandModel): string => runsText(bandRuns(b));
const tree = (b: BandModel): string => ((bandTree(els, b) as unknown as Node).props.children as Node[]).map((r) => (r.props.children as Node[]).map((t) => t.props.children).join('')).join('\n');

describe('A: the HUD draws on the band clock', () => {
  const src = readFileSync(resolve(import.meta.dir, 'register.ts'), 'utf8');
  test('register.ts hands the HUD the clock the band reads (clockNow), not only the snapshot clock', () => {
    const view = src.slice(src.indexOf('const hudView = {'), src.indexOf('\n', src.indexOf('const hudView = {')));
    expect(view).toContain('clock: clockNow');
    const clockLine = src.slice(src.indexOf('const clockNow ='), src.indexOf('\n', src.indexOf('const clockNow =')));
    expect(clockLine).toContain('$.clock.now()');
    expect(src).toContain('restSecsOf(runClock, i.clockNow)'); // the band's own figures read the same clockNow, through the one builder (truth 41)
    expect(src).toContain('runBandModel({ snapshot, live, gates, core, agentsAlive, isWorking: e.props.isWorking, clockNow, look })');
  });
});

describe('B: host turn on, run closed, no resume mark: working, no clock, run total untouched', () => {
  const closed = stepRun(stepRun(newRunClock(), true, 6_000), false, 36_000, { hostIdle: true });
  test('the closed run is not live without a mark', () => {
    expect(closed.startMs).toBeNull();
    expect(runLive(closed, false, false)).toBe(false);
  });
  for (const cols of [150, 110, 80]) {
    test(`${cols} columns: working glyph and word, no clock`, () => {
      const t = text(band({ hostOnly: true, working: false, ranSecs: 191, columns: cols })).trimEnd();
      expect(bandKindOf(band({ hostOnly: true, ranSecs: 191, columns: cols }))).toBe('working');
      expect(t).toMatch(/[⠀-⣿] working/);
      expect(t).not.toMatch(/\d:\d\d/);
      expect(t).not.toContain('3:11');
      expect(t).not.toContain('idle');
      expect(t).not.toContain('done');
    });
  }
  test('the spinner moves between frames', () => {
    const a = text(band({ hostOnly: true, tick: 0 })).match(BRAILLE)?.[0];
    const b = text(band({ hostOnly: true, tick: 1 })).match(BRAILLE)?.[0];
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
  test('the rendered band tree and the frame note carry no clock either', () => {
    forgetBandFrame();
    const out = tree(band({ hostOnly: true, ranSecs: 191 }));
    expect(out).toMatch(/working/);
    expect(out).not.toMatch(/\b3:11\b/);
    expect(bandFrame()?.kind).toBe('working');
    expect(bandFrame()?.secs).toBeNull();
    forgetBandFrame();
  });
  test('the run total is untouched: no start, same end, same rest figure', () => {
    const before = { ...closed };
    const after = stepRun(closed, true, 100_000, { hostIdle: false }); // the host turn's work beat finds Atlas working with no prompt and no resume mark
    expect(after).toBe(closed);
    expect(closed).toEqual(before);
    expect(restSecsOf(closed, 100_000)).toBe(restSecsOf(before, 100_000));
  });
  test('host turn off: the band reads done (with its total) or idle as before', () => {
    const done = band({ hostOnly: undefined, working: false, ranSecs: 191, restSecs: 1, snapshot: busySnap({ squad: [], comms: [], sessionId: 's', phase: 'done', activity: { lead: { tool: null, since: NOW, toolCount: 1, tokens: null, mood: 'idle', lastLine: '' } } } as never) });
    expect(bandKindOf(done)).toBe('done');
    expect(text(done)).toContain('3:11');
    const idle = band({ working: false, ranSecs: 191, restSecs: 600 });
    expect(bandKindOf(idle)).toBe('idle');
    expect(text(idle)).toContain('idle');
  });
  test('a live run still shows its clock', () => {
    const t = text(band({ working: true, workSecs: 42 }));
    expect(t).toMatch(/working 0:42/);
  });
});
