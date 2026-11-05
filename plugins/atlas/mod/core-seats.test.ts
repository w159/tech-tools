// Two seats of one role in a cell (a haiku inventory seat and a sonnet privilege seat) keep their own tier in the route view.
import { describe, expect, test } from 'claude-code/testing';
import { type Offload, routesOf } from './data/core';

const matrix = JSON.stringify({
  classes: {
    'db-audit': {
      medium: {
        team: [
          { role: 'db-prober', seat: 'inventory', count: 1, effort: 'medium', model: 'haiku' },
          { role: 'db-prober', seat: 'privileges', count: 1, effort: 'medium', model: 'sonnet' },
        ],
      },
    },
  },
});
const team = JSON.stringify({
  team_id: 't1',
  class: 'db-audit',
  effort: 'medium',
  created: 1,
  members: [
    { name: 'db-prober-aaaa', role: 'db-prober', seat: 'inventory', model: 'haiku' },
    { name: 'db-prober-bbbb', role: 'db-prober', seat: 'privileges', model: 'sonnet' },
  ],
});
const ran = (name: string, model: string): Offload => ({
  name, role: 'db-prober', model, brief: 0, peak: 0, kept: 0, returned: 0, costUsd: null, finished: true,
});

describe('routes with two seats of one role', () => {
  test('each seat is matched to the members spawned for its label, so there is no false drift', () => {
    const [route] = routesOf([{ name: 't1.json', text: team }], matrix, [
      ran('db-prober-aaaa', 'claude-haiku-4-5'),
      ran('db-prober-bbbb', 'claude-sonnet-5-5'),
    ]);
    expect(route!.seats.map((s) => [s.seat, s.model, s.ran])).toEqual([
      ['inventory', 'haiku', ['claude-haiku-4-5']],
      ['privileges', 'sonnet', ['claude-sonnet-5-5']],
    ]);
    expect(route!.drift).toEqual([]);
  });
  test('a seat that ran the other seat tier is still reported as drift', () => {
    const [route] = routesOf([{ name: 't1.json', text: team }], matrix, [
      ran('db-prober-aaaa', 'claude-sonnet-5-5'),
      ran('db-prober-bbbb', 'claude-sonnet-5-5'),
    ]);
    expect(route!.drift).toEqual(['db-prober ran claude-sonnet-5-5, seat is haiku']);
  });
  test('an unlabelled seat still matches by role', () => {
    const plain = JSON.stringify({ classes: { 'db-audit': { medium: { team: [{ role: 'db-prober', count: 2, model: 'sonnet' }] } } } });
    const [route] = routesOf([{ name: 't1.json', text: team }], plain, [ran('db-prober-aaaa', 'claude-sonnet-5-5')]);
    expect(route!.seats[0]!.seat).toBeUndefined();
    expect(route!.drift).toEqual([]);
  });
});
