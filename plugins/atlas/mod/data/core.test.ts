// The core model over the captured run (contracts/core-fixture.ts) and small synthetic inputs for the edge cases.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../../contracts/core-fixture';
import { claimsOf, coreModel, hasCore, pairClaims, offloadOf, parseFindings, tok, type CoreInput } from './core';

const input = (over: Partial<CoreInput> = {}): CoreInput => ({
  ...coreFixture,
  matrix: coreMatrix,
  todos: [],
  header: { ok: 3, total: 4 },
  openGates: 3,
  ...over,
});

const team = (members: { name: string; role: string }[], created = 1) =>
  JSON.stringify({ team_id: 'tx', name: 'x', class: 'fix', effort: 'low', isolation: 'shared', max_parallel: 1, created, members });
const resultLog = (model: string): string =>
  [
    JSON.stringify({ type: 'assistant', message: { id: 'm1', model, usage: { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', message: { id: 'm2', model, usage: { input_tokens: 10, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } } }),
    JSON.stringify({ type: 'result', total_cost_usd: 0.5, modelUsage: { [model]: { costUSD: 0.5 } } }),
  ].join('\n');
const doneReport = (owner: string, at: number) => ({ owner, at, text: 'STATUS: DONE\nSTEPS: 1/1' });

describe('core model on the captured run', () => {
  const m = coreModel(input());
  test('the adversarial ledger', () => {
    expect(m.ledger).toEqual({ verified: 1, refuted: 1, pending: 0, claimed: 1, unchecked: 0 });
    expect(m.verdicts.map((v) => [v.id, v.status])).toEqual([['mean-fix', 'verified'], ['mean-iterable', 'rejected']]);
    expect(m.claims[0]?.matched).toBe('mean-fix');
  });
  test('offload: 17948 tokens kept in tmux, 608 returned', () => {
    expect(m.offload.kept).toBe(17948);
    expect(m.offload.returned).toBe(608);
    expect(Math.round((m.offload.ratio ?? 0) * 100)).toBe(2952);
    expect(m.offload.workers.every((w) => w.finished)).toBe(true);
    expect(tok(m.offload.kept)).toBe('17.9k');
  });
  test('routes: newest first by created is the last; every seat ran sonnet, no drift', () => {
    const last = m.routes[m.routes.length - 1]!;
    expect([last.teamId, last.name, last.cls, last.effort]).toEqual(['t4eafa8', 'gencheck', 'verify', 'low']);
    expect(m.routes).toHaveLength(3);
    for (const r of m.routes) {
      expect(r.drift).toEqual([]);
      for (const s of r.seats) expect(s.ran).toEqual(['claude-sonnet-5-5']);
    }
  });
  test('contract carries the header tally and the open gates', () => {
    expect(m.contract.header).toEqual({ ok: 3, total: 4 });
    expect(m.contract.openGates).toBe(3);
    expect(hasCore(m)).toBe(true);
  });
});

describe('core model edges', () => {
  test('a seat whose worker ran another model reads as drift', () => {
    const m = coreModel(input({
      findings: '[]',
      teams: [{ name: 'tx.json', text: team([{ name: 'implementer-1', role: 'implementer' }]) }],
      logs: { 'implementer-1': resultLog('claude-opus-5-5') },
      reports: [],
    }));
    expect(m.routes[0]?.drift).toEqual(['implementer ran claude-opus-5-5, seat is sonnet']);
  });

  test('a DONE claim with no verdict after it is unchecked', () => {
    const m = coreModel(input({
      findings: '[]',
      teams: [{ name: 'tx.json', text: team([{ name: 'implementer-1', role: 'implementer' }]) }],
      logs: {},
      reports: [doneReport('implementer-1', Date.parse('2026-10-27T09:00:00Z'))],
    }));
    expect(m.ledger).toMatchObject({ claimed: 1, unchecked: 1, verified: 0 });
    expect(m.claims[0]?.matched).toBeNull();
  });

  test('a verdict recorded before the claim does not check it', () => {
    const findings = JSON.stringify([{ id: 'f1', status: 'verified', title: 't', evidence: ['e'], verified_at: '2026-10-27T08:00:00+00:00' }]);
    const m = coreModel(input({ findings, reports: [doneReport('implementer-1', Date.parse('2026-10-27T09:00:00Z'))], teams: [], logs: {} }));
    expect(m.ledger.unchecked).toBe(1);
  });

  test('an omp message_end usage log counts context like claude assistant lines', () => {
    const line = (cacheRead: number) => JSON.stringify({ type: 'message_end', message: { role: 'assistant', usage: { input: 100, output: 5, cacheRead, cacheWrite: 0 } } });
    const w = offloadOf('implementer-1', [line(900), line(4900), JSON.stringify({ type: 'agent_end' })].join('\n'), 'x'.repeat(40));
    expect([w.brief, w.peak, w.kept, w.returned, w.finished]).toEqual([1000, 5000, 4000, 10, true]);
  });

  test('bad findings JSON reads as no verdicts', () => {
    expect(parseFindings('{not json')).toEqual([]);
    expect(parseFindings('{"a":1}')).toEqual([]);
    expect(coreModel(input({ findings: '{not json' })).verdicts).toEqual([]);
  });

  test('nothing in, nothing to show', () => {
    expect(hasCore(coreModel({ findings: '', teams: [], matrix: '', logs: {}, reports: [], todos: [], header: { ok: 0, total: 0 }, openGates: 0 }))).toBe(false);
    expect(hasCore(null)).toBe(false);
  });
});

describe('claim pairing by id', () => {
  const t = (iso: string) => Date.parse(iso);
  const finding = (id: string, iso: string) => ({ id, status: 'verified' as const, title: id, by: 'v', at: t(iso), evidence: '' });
  const rep = (owner: string, iso: string, extra: string) => ({ owner, at: t(iso), text: `STATUS: DONE\n${extra}` });
  const roles = { 'implementer-1': 'implementer', 'implementer-2': 'implementer' };

  test('an unrelated-id verdict does not check a claim when another claim names it', () => {
    const claims = claimsOf([rep('implementer-1', '2026-10-27T09:00:00Z', 'fixed other'), rep('implementer-2', '2026-10-27T09:10:00Z', 'covers F-9')], roles);
    const out = pairClaims(claims, [finding('f-9', '2026-10-27T09:20:00Z')]);
    expect(out.map((c) => c.matched)).toEqual([null, 'f-9']);
  });

  test('an id-linked verdict pairs out of time-order preference', () => {
    const claims = claimsOf([rep('implementer-1', '2026-10-27T09:00:00Z', 'alpha'), rep('implementer-2', '2026-10-27T09:10:00Z', 'see beta-2')], roles);
    const out = pairClaims(claims, [finding('beta-2', '2026-10-27T09:20:00Z')]);
    expect(out.map((c) => c.matched)).toEqual([null, 'beta-2']);
  });

  test('an id seen only in an already-checked claim does not fall back onto another claim', () => {
    const claims = claimsOf([rep('implementer-1', '2026-10-27T09:00:00Z', 'dup-1'), rep('implementer-2', '2026-10-27T09:10:00Z', 'nothing')], roles);
    const out = pairClaims(claims, [finding('dup-1', '2026-10-27T09:20:00Z'), finding('dup-1', '2026-10-27T09:30:00Z')]);
    expect(out.map((c) => c.matched)).toEqual(['dup-1', null]);
  });

  test('a verdict whose id no claim names falls back to time order, and tokens match whole words only', () => {
    const claims = claimsOf([rep('implementer-1', '2026-10-27T09:00:00Z', 'about f1x')], roles);
    expect(pairClaims(claims, [finding('f1', '2026-10-27T09:20:00Z')])[0]?.matched).toBe('f1');
  });
});
