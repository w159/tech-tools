// Characterization: sidebarTree over representative models serializes identically across refactors.
// Regenerate the fixture only on an intended visual change (see sidebar.golden-cases.ts).
import { describe, expect, test } from 'claude-code/testing';
import { goldenText, serializeGolden } from './sidebar.golden-cases';
import { GOLDEN } from './sidebar.golden-fixture';

const rows = (k: string): string[] => goldenText(k).split('\n');

describe('sidebar golden', () => {
  test('serialized trees match the fixture', () => {
    expect(serializeGolden()).toBe(GOLDEN);
  });
});

describe('sidebar golden text', () => {
  test('every tab opens on the ribbon, a blank row, the strip with five labelled tabs', () => {
    for (const k of ['route', 'team', 'channel', 'gates', 'core']) {
      const r = rows(k);
      expect(r[0]).toContain('ATLAS');
      expect(r[0]).toContain('SIDEPANEL');
      expect(r[1]!.trim()).toBe('');
      expect(r[2]).toBe('r: route  t: team  c: channel  g: gates  k: core');
    }
  });
  test('the lit tab is ruled by a heavy line under its label only', () => {
    expect(rows('route')[3]).toBe('   ━━━━━' + ' '.repeat(40));
    expect(rows('team')[3]!.trim()).toBe('━━━━');
  });
  test('route: phase, gates, todo gauge with N of M, agents in words', () => {
    const r = rows('route');
    expect(r).toContain('phase  implement 5/6');
    expect(r.some((l) => l.startsWith('gates ') && l.endsWith('1/3'))).toBe(true);
    expect(r.some((l) => l.startsWith('todo ') && l.includes('1 of 7'))).toBe(true);
    expect(r.some((l) => l.startsWith('agents ') && l.includes('1 running') && l.includes('1 failed') && l.includes('1 waiting'))).toBe(true);
  });
  test('route lists every plan task with its state word, not only the current phase', () => {
    const r = rows('route').join('\n');
    for (const id of ['a', 'b', 'c', 'd', 'n1', 'n2', 'n3']) expect(r).toContain(`task ${id} `);
  });
  test('route with a tick turns the spinner glyph', () => {
    expect(rows('route')).not.toEqual(rows('routeSpinning'));
  });
  test('team: every subagent by name with its state word, running first', () => {
    const r = rows('team').slice(5, 8);
    expect(r[0]).toMatch(/^▸ [◐◓◑◒] explorer-1\s+running/);
    expect(r[1]).toMatch(/^ {2}◉ impl-auth\s+waiting/);
    expect(r[2]).toMatch(/^ {2}■ runner-1\s+failed/);
  });
  test('team at 38 columns wraps the strip to a second row and keeps name and state', () => {
    const r = rows('cols38');
    expect(r[2]).toBe('r: route  t: team  c: channel');
    expect(r[4]).toBe('g: gates  k: core');
    expect(r.join('\n')).toContain('explorer-1');
    for (const l of r) expect([...l].length).toBeLessThanOrEqual(37);
  });
  test('30 columns still fits: no row is wider than the pane', () => {
    for (const l of rows('cols30')) expect([...l].length).toBeLessThanOrEqual(29);
  });
  test('120 columns widens the team rows to model and task columns', () => {
    expect(rows('cols120').join('\n')).toContain('explorer-1');
  });
  test('channel: people and unread counted in words', () => {
    expect(rows('channel').join('\n')).toMatch(/\d+ people/);
  });
  test('gates: group rows with failing lines in words, copy fix when expanded', () => {
    const t = goldenText('gates');
    expect(t).toContain('Completion gate');
    expect(t).toContain('1 failing');
    expect(goldenText('gatesExpanded')).toContain('verification coverage');
    expect(goldenText('gatesExpanded')).toContain('run the hooks suite');
  });
  test('core: the empty ledger reads (no state) rather than a blank pane', () => {
    expect(goldenText('core')).toContain('(no state)');
  });
  test('an empty squad reads as nothing running, not a blank pane', () => {
    expect(goldenText('empty').trim().length).toBeGreaterThan(0);
  });
  test('no legacy glyphs: no check, bullet, ellipsis or spinner braille in any case', () => {
    for (const k of ['route', 'team', 'channel', 'gates', 'core', 'cols38', 'cols30', 'cols120', 'channelLog', 'routeOpenPending', 'routeOpenDone'])
      expect(goldenText(k)).not.toMatch(/[✓•…⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✗○]/u);
  });
});
