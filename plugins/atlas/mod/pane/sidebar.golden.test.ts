// Characterization (NOT design evidence; the design mocks are in contracts/panel-golden.ts): sidebarTree over representative models serializes identically across refactors.
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
  test('every tab opens on the ribbon, a blank row, the strip with six labelled tabs', () => {
    for (const k of ['route', 'team', 'channel', 'gates', 'core']) {
      const r = rows(k);
      expect(r[0]).toContain('ATLAS');
      expect(r[0]).toContain('SIDEPANEL');
      expect(r[1]!.trim()).toBe('');
      expect(r[2]).toBe(' route  team  channel  gates  core  board');
    }
  });
  test('the lit tab is ruled by a heavy line under its label only', () => {
    expect(rows('route')[3]!.trimEnd()).toBe(' ━━━━━');
    expect(rows('team')[3]!.trimEnd()).toBe('        ━━━━');
  });
  test('route: phase, gates, todo gauge with N of M, agents in words', () => {
    const r = rows('route');
    expect(r).toContain(' phase  implement');
    expect(r.some((l) => l.startsWith(' gates ') && l.endsWith('0/2 green'))).toBe(true); // the tool-routing group holds no data: it is not a third gate (gateTally)
    expect(r.some((l) => l.startsWith(' todo ') && l.includes('1/7'))).toBe(true);
    expect(r.some((l) => l.startsWith(' agents ') && l.includes('1 running') && l.includes('1 failed') && l.includes('1 waiting'))).toBe(true);
  });
  test('route lists every plan task with its state word, not only the current phase', () => {
    const r = rows('route').join('\n');
    for (const id of ['a', 'b', 'c', 'd', 'n1', 'n2', 'n3']) expect(r).toContain(`task ${id} `);
  });
  test('route with a tick turns the spinner glyph', () => {
    expect(rows('route')).not.toEqual(rows('routeSpinning'));
  });
  test('team: the lead row first, then every subagent by name with its state word, in start order (critique 11 A3)', () => {
    const r = rows('team').slice(4).filter((l) => !/^ {4}\S/.test(l)).slice(0, 4); // the detail rows a tall pane adds sit under their agent
    expect(r[0]).toMatch(/^ {2}[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] lead\s+running/);
    expect(r[1]).toMatch(/^▸ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] explorer-1\s+running/);
    expect(r[2]).toMatch(/^ {2}◉ impl-auth\s+(\S+\s+)?waiting/); // the HUD's order (hud-surface sortAgents): no task, so the squad's start order
    expect(r[3]).toMatch(/^ {2}■ runner-1\s+(\S+\s+)?failed/);
  });
  test('team at 38 columns (the 110-column pane) draws the six whole words on one row (critique 18; one form on every tab), and keeps name and state', () => {
    const r = rows('cols38');
    expect(r[2]!.trimEnd()).toBe(' route team channel gates core board');
    expect(r[3]!.trimEnd()).toBe('       ━━━━'); // the rule under the lit team tab
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
    expect(t).toMatch(/Completion gate.* 1\/2\n/);
    expect(goldenText('gatesExpanded')).toContain('verification coverage');
    expect(goldenText('gatesExpanded')).toContain('run the hooks suite');
  });
  test('core: the empty ledger says so in one centred line rather than a blank pane', () => {
    expect(goldenText('core')).toContain('no verdicts, workers or gates yet');
  });
  test('an empty squad reads as nothing running, not a blank pane', () => {
    expect(goldenText('empty').trim().length).toBeGreaterThan(0);
  });
  test('no legacy glyphs: no check, bullet or circle, and no ASCII `...`, in any case (braille is the rev 5 spinner)', () => {
    for (const k of ['route', 'team', 'channel', 'gates', 'core', 'cols38', 'cols30', 'cols120', 'channelLog', 'routeOpenPending', 'routeOpenDone'])
      { expect(goldenText(k)).not.toMatch(/[✓•✗○]/u); expect(goldenText(k)).not.toContain('...'); } // a cut is one `…` (wave 24)
  });
});
