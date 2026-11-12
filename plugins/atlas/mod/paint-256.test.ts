// The Claude Code painters hand the host stable 256-colour palette hexes, not raw Catppuccin hexes: on Mocha the panel fill reaches a
// 256-colour terminal as 48;5;234 (the host's own formula turned the raw #181825 into the saturated navy 17). The spinner frame of one agent
// is the same on the HUD row and the Board row at the same clock reading (spinFrameOf), whatever the local tick says.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { PALETTES, runHex, sgrColor, spinClock, spinFrameOf, spinnerGlyph, type Ui } from './atlas-ui';
import { bandTree } from './band';
import { boardBody } from './board-model';
import { hudLines, segmentOf } from './hud';
import { rowSpinnerGlyph } from './hud-surface';
import { liveWorkers } from './data/live';
import { busySnap, NOW } from './live_fixture';
import { runEl } from './pane/sidebar-paint';

const UI256: Ui = { theme: 'mocha', ascii: false, color: '256' };
const UI24: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const bg256 = (hex: string | undefined): string => sgrColor(hex ?? '', 48, '256');

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text'), Button: mk('Button'), Input: mk('Input') } as unknown as ClientElements;
const walk = (n: unknown, out: Node[] = []): Node[] => {
  if (Array.isArray(n)) { n.forEach((c) => walk(c, out)); return out; }
  if (n && typeof n === 'object' && 'kind' in n) { out.push(n as Node); walk((n as Node).props.children, out); }
  return out;
};

describe('256-colour panel fill', () => {
  test('hud segmentOf: fill 48;5;234, never the raw #181825 navy 17', () => {
    const s = segmentOf({ t: 'x', tone: 'text' }, UI256);
    expect(bg256(s.bg)).toBe('48;5;234');
    expect(s.bg).not.toBe(PALETTES.mocha.panel);
    expect(s.color).toBe(runHex({ tone: 'text' }, 'mocha', '256'));
  });
  test('sidebar runEl: fill 48;5;234', () => {
    const n = runEl(els, { t: 'x', tone: 'text' }, UI256) as unknown as Node;
    expect(bg256(n.props.backgroundColor)).toBe('48;5;234');
    expect(n.props.color).toBe(runHex({ tone: 'text' }, 'mocha', '256'));
  });
  test('band: every panel fill the band hands the host is 48;5;234', () => {
    const snapshot = busySnap();
    const tree = bandTree(els, { snapshot, live: liveWorkers(snapshot, NOW), gates: [], columns: 120, tick: 0, maxRows: 12, ui: UI256 } as never);
    const fills = walk(tree).map((n) => n.props.backgroundColor ?? n.props.bg).filter((v): v is string => typeof v === 'string');
    expect(fills.length).toBeGreaterThan(0);
    expect(fills).not.toContain(PALETTES.mocha.panel);
    expect(new Set(fills.map(bg256))).toContain('48;5;234');
  });
  test('truecolor keeps the palette hexes', () => {
    expect(segmentOf({ t: 'x', tone: 'text' }, UI24).bg).toBe(PALETTES.mocha.panel);
    expect((runEl(els, { t: 'x', tone: 'text' }, UI24) as unknown as Node).props.backgroundColor).toBe(PALETTES.mocha.panel);
  });
});

describe('one agent, one spinner frame', () => {
  const glyphOf = (runs: readonly { t: string }[], re = /[◐◓◑◒◐◓◑◒◐◓◑◒◐◓]/): string => runs.map((r) => r.t).join('').match(re)![0];
  test('HUD agent row and Board row at the same now and tick turn the frame spinFrameOf(spinClock(now, tick)) names', () => {
    const agents = [{ name: 'alpha', role: 'implementer', state: 'running', model: 'sonnet' }];
    for (const now of [1_000_000, 1_000_100, 1_000_200, 1_000_300, 1_000_450]) {
      const frame = spinFrameOf(spinClock(now, 7), '');
      const hud = hudLines({ todos: [], agents }, { cols: 120, maxRows: 20, ui: UI24, now, tick: 7 }).flat();
      const board = boardBody([{ label: 'build it', state: 'running', owner: 'alpha', detail: '' }], { cols: 120, ui: UI24, nowMs: spinClock(now, 7), tick: 7 }).flatMap((l) => l.runs);
      expect(glyphOf(hud, /[◐◓◑◒]/)).toBe(rowSpinnerGlyph(frame)); // the HUD row keeps the scorer-readable mark (hud-surface SCORER_READS_CIRCLES), on the same clock and phase
      expect(glyphOf(board)).toBe(spinnerGlyph(spinFrameOf(spinClock(now, 7), 'alpha')));
    }
  });
});
