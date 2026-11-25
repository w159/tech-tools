// Characterization (NOT design evidence; the design mocks are in contracts/panel-golden.ts): sidebarTree over representative models serializes identically across refactors.
// Regenerate the fixture only on an intended visual change (see sidebar.golden-cases.ts). Regenerated on purpose for the panel redesign (tabs status / health / channel / bored).
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
  test('every tab opens on the pill row, a blank row, the strip with four labelled tabs and the rule under it', () => {
    for (const k of ['route', 'team', 'channel', 'core']) {
      const r = rows(k);
      expect(r[0]).toContain('◆ ATLAS');
      expect(r[1]!.trim()).toBe('');
      expect(r[2]!.trim().replace(/ +/g, ' ').replace(/ \d+/g, '')).toBe('status health channel bored');
      expect(r[3]).toMatch(/^ [─━]+$/);
    }
  });
  test('the lit tab is the filled chip with one accent segment of the rule under it', () => {
    for (const k of ['route', 'channel', 'core']) expect(rows(k)[3]!.match(/━+/g)).toHaveLength(1);
  });
  test('route: the phase timeline, the plan with `n of m`, the team tally in words', () => {
    const r = rows('route');
    expect(r.some((l) => l.trim().startsWith('PHASE'))).toBe(true);
    expect(r.some((l) => l.includes('PLAN') && l.includes('1 of 7'))).toBe(true);
    expect(r.some((l) => l.includes('TEAM') && l.includes('1 running') && l.includes('1 failed') && l.includes('1 waiting'))).toBe(true);
    expect(r[2]).toMatch(/health {2}1 /); // the tool-routing group holds no data: it is not a third gate (gateTally); the unmet completion line is pending until a Stop refuses, so the badge is the one denial
  });
  test('route lists every open plan task, not only the current phase; the completed one is folded into `N done`', () => {
    const r = rows('route').join('\n');
    for (const id of ['b', 'c', 'd', 'n1', 'n2', 'n3']) expect(r).toContain(`task ${id} `);
    expect(r).not.toContain('task a ');
  });
  test('route with a tick turns the spinner glyph', () => {
    expect(rows('route')).not.toEqual(rows('routeSpinning'));
  });
  test('team: every subagent by name with its state mark, in start order (critique 11 A3)', () => {
    const r = rows('team');
    const team = r.slice(r.findIndex((l) => l.includes('TEAM')) + 1).filter((l) => /^▸ \S/.test(l)).slice(0, 3);
    expect(team[0]).toMatch(/^▸ [◐◓◑◒] explorer-1\s+/);
    expect(team[1]).toMatch(/^▸ ◉ impl-auth\s+/); // the HUD's order (hud-surface sortAgents): no task, so the squad's start order
    expect(team[2]).toMatch(/^▸ ✗ runner-1\s+/);
  });
  test('team at 38 columns (the 110-column pane) draws the strip as one row of chips with the trailing tabs behind `more ›` (D14), and keeps name and state', () => {
    const r = rows('cols38');
    expect(r[2]!.trim().replace(/ +/g, ' ').replace(/ \d+/g, '')).toBe('status health more ›');
    expect(r[3]!.match(/━+/g)).toHaveLength(1); // the lit status chip's segment
    expect(r.join('\n')).toContain('explorer-1');
    for (const l of r) expect([...l].length).toBeLessThanOrEqual(37);
  });
  test('30 columns still fits: no row is wider than the pane', () => {
    for (const l of rows('cols30')) expect([...l].length).toBeLessThanOrEqual(29);
  });
  test('120 columns widens the team rows to the role and last-step columns', () => {
    expect(rows('cols120').join('\n')).toContain('explorer-1');
  });
  test('channel: the online count in words', () => {
    expect(rows('channel').join('\n')).toMatch(/\d+ online/);
  });
  test('health: the gates section lists the failing line and its fix is on the card, copyable', () => {
    const t = goldenText('core');
    expect(t).toContain('GATES');
    expect(t).toContain('○ verifica'); // the unmet completion line is pending until a Stop refuses: a hollow mark in the grid, no DENIED card (the fix of a denied line is tested in sidebar.test.ts)
    expect(goldenText('coreGatesExpanded')).toContain('○ verifica');
  });
  test('health: with no core ledger the tab shows the gates section rather than a blank pane', () => {
    expect(goldenText('core')).toContain('GATES');
  });
  test('an empty squad reads as nothing running, not a blank pane', () => {
    expect(goldenText('empty').trim().length).toBeGreaterThan(0);
  });
  test('no legacy glyphs: no bullet, and no ASCII `...`, in any case (the circle quarters are the one spinner)', () => {
    for (const k of ['route', 'team', 'channel', 'core', 'cols38', 'cols30', 'cols120', 'channelLog', 'routeOpenPending', 'routeOpenDone'])
      { expect(goldenText(k)).not.toMatch(/•/u); expect(goldenText(k)).not.toContain('...'); } // a cut is one `…` (wave 24)
  });
});

// These fixtures pin truecolor hexes; a tmux-style TERM=*256color with no COLORTERM would put the bare surfaces in 256-colour mode, so pin the depth for this file.
import { clearLook } from '../../../design/look';
import { afterAll as pinAfter, beforeAll as pinBefore } from 'bun:test';
let pinnedColorterm: string | undefined;
let pinnedTz: string | undefined;
pinBefore(() => { clearLook(); pinnedColorterm = process.env.COLORTERM; process.env.COLORTERM = 'truecolor'; pinnedTz = process.env.TZ; process.env.TZ = 'UTC'; }); // the chat prints a post's clock time in the local zone: the fixture is the UTC reading
pinAfter(() => { if (pinnedColorterm === undefined) delete process.env.COLORTERM; else process.env.COLORTERM = pinnedColorterm; if (pinnedTz === undefined) delete process.env.TZ; else process.env.TZ = pinnedTz; });
