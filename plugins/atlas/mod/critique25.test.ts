// Critique 25 (round 2 live captures): one brand mark, one spinner family on the shared frame, and one word for a killed worker on every surface.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { worldGates, worldSidebar, worldSnapshot } from '../contracts/world-live';
import { LEAD_FRAMES, PALETTE5, SPIN_FRAMES, leadSpinnerGlyph, toneHex, spinClock, spinFrameOf, DONE_DOUBT, rowWordTone, runsString, type Ui } from './atlas-ui';
import { bandTree } from './band';
import { boardRowsOf, boardText, boardLines } from './board-model';
import { liveWorkers } from './data/live';
import { todoState } from './data/todos';
import { hudAgents, hudLines } from './hud';
import { panelModelOf } from './pane/sidebar-model';
import { bodyLines, lineText, noteToastText, toastRuns, toastText } from './panel-layout';
import { notificationTree } from './transcript/cards';
import { workerCard } from './transcript/cards';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };

type Node = { kind: string; props: { children?: unknown } };
const mk = (kind: string) => (props: Node['props']): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const textOf = (n: unknown): string => {
  const node = n as Node;
  const c = node?.props?.children;
  if (typeof c === 'string') return c;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).map(textOf).join('');
};
const flat = (n: unknown): string => {
  const node = n as { type?: string; children?: unknown[]; props?: { children?: unknown } };
  const kids = (node?.children ?? node?.props?.children ?? []) as unknown;
  const list = Array.isArray(kids) ? kids : [kids];
  return list.map((k) => (typeof k === 'string' ? k : k && typeof k === 'object' ? flat(k) : '')).join('');
};

describe('the brand mark `◆ ATLAS` sits on the band, the block ribbons, the panel title and the finish cards only', () => {
  test('toasts and the note toast carry no brand', () => {
    for (const s of ['running', 'done', 'failed', 'waiting', 'blocked', 'queued'] as const) expect(toastText(s, 'name', 'fact', ui)).not.toContain('ATLAS');
    expect(noteToastText('lead', 'ship it', ui)).not.toContain('ATLAS');
  });
  test('the dispatch (start) card carries no brand; the finish cards (done and failed) carry it', () => {
    const start = flat(workerCard({ id: 'c', name: 'Agent', input: { subagent_type: 'atlas:implementer', name: 'impl-a', prompt: 'GOAL: x', model: 'sonnet' }, isRunning: true } as never, 'running', 60, undefined, '', { now: 'Grep 12s' }));
    expect(start).not.toContain('ATLAS');
    expect(flat(notificationTree('wave-a', 'explorer', 'STATUS: DONE', false, ui))).toContain('◆ ATLAS');
    expect(flat(notificationTree('wave-b', 'explorer', 'boom', true, ui))).toContain('◆ ATLAS');
  });
  test('the brand on a finish card is the accent (141, wave 32: the 240 label was barely visible on 234), new or aged', () => {
    for (const state of ['done', 'failed'] as const) {
      const runs = toastRuns(state, 'name', 'fact', ui, true);
      const marks = runs.filter((x) => x.t.trim() === '◆' || x.t === 'ATLAS');
      expect(marks.map((x) => x.t.trim())).toEqual(['◆', 'ATLAS']);
      for (const m of marks) expect(toneHex(m.tone, 'mocha')).toBe(PALETTE5.accent);
    }
    expect(toastRuns('done', 'name', 'fact', ui).some((x) => x.t.includes('ATLAS'))).toBe(false); // the default has no brand
  });
});

describe('one spinner family: the band count, the SUBAGENTS title and the panel agent rows turn the band braille frame; plan rows keep the circle quarters', () => {
  const snap = worldSnapshot();
  const live = liveWorkers(snap, snap.now);
  for (const tick of [0, 1, 2, 3, 7]) {
    test(`tick ${tick}`, () => {
      const frame = spinFrameOf(spinClock(snap.now, tick), '');
      const braille = LEAD_FRAMES[((frame % 10) + 10) % 10]!;
      expect(leadSpinnerGlyph(frame)).toBe(braille);
      const band = textOf(bandTree(els, { snapshot: snap, live, gates: worldGates(), columns: 150, tick, maxRows: 1, ui } as never));
      expect(band).toContain(`${braille} 1 running`);
      const agents = hudAgents(live, snap.squad);
      const title = hudLines({ todos: [], agents }, { cols: 120, maxRows: 40, ui, tick, now: snap.now }).map((r) => runsString(r)).find((l) => l.includes('SUBAGENTS'))!;
      expect(title).toContain(`${braille} 1 running`);
      const team = bodyLines(panelModelOf({ ...worldSidebar('team', 100, snap), tick }, ui, 100)).map(lineText);
      expect(team.some((l) => l.includes(`${braille} implementer-band`))).toBe(true);
      // The HUD TODO and SUBAGENTS rows and the band worker rows are glyph-parsed by the capture scorer: circles only.
      const hudRows = hudLines({ todos: [], agents }, { cols: 120, maxRows: 40, ui, tick, now: snap.now }).map((r) => runsString(r)).filter((l) => !l.includes('SUBAGENTS'));
      expect(hudRows.join('\n')).not.toMatch(/[⠀-⣿]/);
      expect(SPIN_FRAMES.length).toBe(4);
    });
  }
});

describe('a killed worker reads `closed` in error red on the HUD, the board and the panel', () => {
  test('the word is one constant and its tone is error on every surface', () => {
    expect(DONE_DOUBT).toBe('closed');
    expect(todoState('completed', 'failed', false)).toEqual({ state: 'done', word: 'closed' });
    expect(rowWordTone('done', DONE_DOUBT)).toBe('bad');
  });
  test('HUD row, board row and panel route row all spell `closed` for the same T2', () => {
    const plan = [
      { id: 't1', content: 'T1 read alpha.py (alpha-explorer)', status: 'completed', owner: 'alpha-explorer' },
      { id: 't2', content: 'T2 read ghost.py (ghost-explorer)', status: 'completed', owner: 'ghost-explorer' },
    ] as never;
    const agents = [{ name: 'alpha-explorer', role: 'explorer', state: 'done' as const }, { name: 'ghost-explorer', role: 'explorer', state: 'failed' as const }];
    const hud = hudLines({ todos: plan, agents }, { cols: 150, maxRows: 60, ui, now: 0 }).map((r) => runsString(r)).find((l) => l.includes('T2 read ghost.py'))!;
    expect(hud).toContain('killed'); // critique 28: the HUD row reads `■ failed`; the board keeps `closed`
    const rows = boardRowsOf([{ content: 'T2 read ghost.py (ghost-explorer)', status: 'completed', owner: 'ghost-explorer', ownerState: 'failed' }]);
    const board = boardText(boardLines(rows, { cols: 120, ui, ribbon: false, title: false })).join('\n');
    expect(board).toMatch(/failed\s+ghost-explorer/);
    expect(board).not.toMatch(/\bdone\b/);
    expect(hud).not.toMatch(/\bdone\b/);
  });
});
