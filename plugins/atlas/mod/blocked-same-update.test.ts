// Critique 25 (stoprun-150-3 f0106): the panel read `phase blocked` while the band still said `working`; the band flipped one frame later (f0107). Root cause: register.ts frameBeat bumped
// spinnerTickState (the redraw that carries the band) BEFORE it read the Stop verdict, so the band drew the old gates for one more beat. Two guards: both surfaces derive the state from the
// one snapshot (so a single update flips both), and frameBeat reads the verdict first.
import { describe, expect, test } from 'claude-code/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClientElements } from 'claude-code';
import { worldGates, worldSidebar, worldSnapshot } from '../contracts/world-live';
import { bandTree } from './band';
import { liveWorkers } from './data/live';
import { panelModelOf } from './pane/sidebar-model';
import { bodyLines, lineText } from './panel-layout';
import type { Ui } from './atlas-ui';

type Node = { kind: string; props: { children?: unknown } };
const mk = (kind: string) => (props: Node['props']): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const textOf = (n: unknown): string => {
  const node = n as Node;
  const c = node.props?.children;
  if (typeof c === 'string') return c;
  return (Array.isArray(c) ? c : c == null ? [] : [c]).map(textOf).join('');
};
const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };

describe('5d: the band and the panel flip to blocked on the same update', () => {
  const blocked = worldSnapshot({ phase: 'blocked' } as never);
  const working = worldSnapshot();

  test('one snapshot with the Stop refusal: the band head says blocked and the route tab says `phase blocked`', () => {
    const band = textOf(bandTree(els, { snapshot: blocked, live: liveWorkers(blocked, blocked.now), gates: worldGates(), columns: 150, tick: 0, maxRows: 1, ui } as never));
    const panel = bodyLines(panelModelOf(worldSidebar('route', 100, blocked), ui, 100)).map(lineText).join('\n');
    expect(band).toMatch(/blocked/);
    expect(panel).toMatch(/phase\s+blocked/);
  });
  test('the same snapshot without the refusal: the band says working and the panel does not say `phase blocked`', () => {
    const band = textOf(bandTree(els, { snapshot: working, live: liveWorkers(working, working.now), gates: worldGates(), columns: 150, tick: 0, maxRows: 1, ui } as never));
    const panel = bodyLines(panelModelOf(worldSidebar('route', 100, working), ui, 100)).map(lineText).join('\n');
    expect(band).toMatch(/working/);
    expect(/phase\s+blocked/.test(panel)).toBe(false);
  });
  test('register.ts frameBeat reads the Stop verdict before it bumps the spinner tick (the redraw that carries the band)', () => {
    const src = readFileSync(resolve(import.meta.dir, 'register.ts'), 'utf8');
    const beat = src.slice(src.indexOf('async function frameBeat'), src.indexOf('let verdictBusy'));
    const verdict = beat.indexOf('await verdictFast(');
    const bump = beat.indexOf('update($, spinnerTickState');
    expect(verdict).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(-1);
    expect(verdict).toBeLessThan(bump);
  });
});
