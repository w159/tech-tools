// Characterization: sidebarTree over representative models serializes identically across refactors.
// Regenerate the fixture only on an intended visual change (see sidebar.golden-cases.ts).
import { describe, expect, test } from 'claude-code/testing';
import { goldenText, serializeGolden } from './sidebar.golden-cases';
import { GOLDEN } from './sidebar.golden-fixture';

describe('sidebar golden', () => {
  test('serialized trees match the fixture', () => {
    expect(serializeGolden()).toBe(GOLDEN);
  });
});

describe('sidebar golden text', () => {
  test('route: tab bar over a vertical phase list with the current phase nested', () => {
    expect(goldenText('route').split('\n')).toEqual([
      'route  team  channel  gates 2 failing',
      '✓ research',
      '✓ theory',
      '✓ test',
      '✓ validate',
      '⠋ implement 0/2',
      '  ◉ task c with some longer content to fit · alice-long-…',
      '  ○ task d with some longer content to fit',
      '○ verify',
    ]);
  });
  test('route with a tick turns the spinner', () => {
    expect(goldenText('routeSpinning').split('\n')[5]).toBe('⠸ implement 0/2');
  });
  test('the bar says how many checks fail in words, with no code', () => {
    for (const k of ['team', 'channel', 'route', 'gates']) {
      const bar = goldenText(k).split('\n')[0]!;
      expect(bar).toContain('gates 2 failing');
      expect(bar).not.toMatch(/[✗◈◎●✉▤]/u);
    }
  });
});

describe('sidebar golden text: team, channel and gates in plain words', () => {
  test('team: mark, name, role, activity in words, age; the lead summary last', () => {
    expect(goldenText('team').split('\n')).toEqual([
      'route  team  channel  gates 2 failing',
      '⏸ impl-auth   implementer  waiting for lead reply   42s',
      '✗ runner-1    runner       failed                   42s',
      '⠸ explorer-1  explorer     Grep                     42s',
      'lead  1 running · 1 blocked · 1 failed',
      '', // the message input
    ]);
  });
  test('team under 50 cells drops the role and cuts the activity', () => {
    expect(goldenText('cols38').split('\n').slice(1, 4)).toEqual([
      '⏸ impl-auth   waiting for lead…   42s',
      '✗ runner-1    failed              42s',
      '⠋ explorer-1  Grep                42s',
    ]);
  });
  test('gates: one row per group with its failing count in words, no per-hue titles', () => {
    expect(goldenText('gates').split('\n')).toEqual([
      'route  team  channel  gates 2 failing',
      'gates  what the Stop gate will check',
      '✗ Completion gate  1 failing  run the hooks suite',
      '✗ Header contract  1 failing',
      '     unavailable: findings.json unreadable',
      '✓ Tool routing  passing',
    ]);
  });
  test('channel: the header counts people, not nicks', () => {
    expect(goldenText('channel').split('\n').slice(1, 2)).toEqual(['#lead-1  3 people']);
  });
});
