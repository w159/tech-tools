// The core model over the captured run (contracts/core-fixture.ts) and small synthetic inputs for the edge cases.
// ROUTE row trace (2026-11-10), every input of CoreModel.routes:
//   - CoreInput.teams: register.ts buildCore reads every .atlas/.run/teams/*.json (all sessions; `channels` narrows it)
//   - CoreInput.matrix: <plugin>/contracts/scope-matrix.json (class/effort aliases applied)
//   - CoreInput.logs: .atlas/.run/logs/*.log (the model each tmux member ran) and the team records' member roles
//   - CoreInput.dispatches (optional): in-process Agent/Task dispatches (orchestration SpawnMeta); absent => tmux only.
//     A dispatch with no or a malformed SCOPE is bucketed under class `-`, effort `-` (no seats), never dropped.
// Fixtures: live_fixture.ts, contracts/core-fixture.ts and mod/fixtures/* are imported only by tests and golden files,
// none is reachable in production. With no team the pane draws `no team this session`.
import { describe, expect, test } from 'claude-code/testing';
import { coreFixture, coreMatrix } from '../../contracts/core-fixture';
import type { TodoItem } from '../contract';
import { claimsOf, coreModel, dispatchRoutes, hasCore, pairClaims, offloadOf, parseFindings, roleOfName, tok, type CoreInput } from './core';

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
      expect(r.transport).toBe('tmux');
      for (const s of r.seats) expect(s.ran).toEqual(['claude-sonnet-5-5']);
    }
    expect(m.inProcess).toBe(false);
  });
  test('contract carries the header tally and the open gates', () => {
    expect(m.contract.header).toEqual({ ok: 3, total: 4 });
    expect(m.contract.openGates).toBe(3);
    expect(hasCore(m)).toBe(true);
  });
});

describe('core model edges', () => {
  test('B2: done-with-evidence counts the plan items only, the denominator the band todo count uses', () => {
    const row = (id: string, over: Record<string, unknown>) => ({ id, content: `item ${id}`, status: 'completed', evidence: 'ran it', ...over }) as unknown as TodoItem;
    const todos = [row('T1', { origin: 'session' }), row('T2', { origin: 'session', evidence: '' }), row('d1', { origin: 'dispatch' }), row('d2', { origin: 'dispatch' }), row('a1', { origin: 'advisor' }), row('s1', { content: 'placeholder' })];
    const m = coreModel(input({ todos }));
    expect(m.contract.evidence).toEqual({ ok: 1, total: 2 });
    expect(m.contract.verifiedDone.total).toBe(2);
  });

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

describe('core model: context accounting and defaults', () => {
  const emptyIn = (over: Partial<CoreInput>): CoreInput =>
    ({ findings: '', teams: [], matrix: '', logs: {}, reports: [], todos: [], header: { ok: 0, total: 0 }, openGates: 0, ...over });

  test('omp usage sums input + cacheRead + cacheWrite; claude usage sums its three fields', () => {
    const omp = JSON.stringify({ type: 'message_end', message: { role: 'assistant', usage: { input: 1, cacheRead: 20, cacheWrite: 300 } } });
    expect(offloadOf('w-1', omp, '').brief).toBe(321);
    const cl = JSON.stringify({ type: 'assistant', message: { id: 'a', usage: { input_tokens: 1, cache_read_input_tokens: 20, cache_creation_input_tokens: 300 } } });
    expect(offloadOf('w-1', cl, '').brief).toBe(321);
  });

  test('assistant lines with the same message id collapse to the latest usage; id-less lines stay separate', () => {
    const a = (id: string | undefined, n: number) => JSON.stringify({ type: 'assistant', message: { ...(id ? { id } : {}), usage: { input_tokens: n } } });
    const dup = offloadOf('w-1', [a('m1', 100), a('m1', 300)].join('\n'), '');
    expect([dup.brief, dup.peak, dup.kept]).toEqual([300, 300, 0]);
    const anon = offloadOf('w-1', [a(undefined, 100), a(undefined, 300)].join('\n'), '');
    expect([anon.brief, anon.peak, anon.kept]).toEqual([100, 300, 200]);
  });

  test('offloadOf: model from the costliest modelUsage entry, cost from total_cost_usd, no calls => zeros', () => {
    const log = JSON.stringify({ type: 'result', total_cost_usd: 1.25, modelUsage: { cheap: { costUSD: 0.1 }, dear: { costUSD: 1 } } });
    expect(offloadOf('w-1', log, 'abcde')).toEqual({
      name: 'w-1', role: 'w', model: 'dear', brief: 0, peak: 0, kept: 0, returned: 2, costUsd: 1.25, finished: true,
    });
    expect(offloadOf('w-1', 'not json\n{bad', '').finished).toBe(false);
    expect(offloadOf('w-1', JSON.stringify({ type: 'result' }), '').model).toBeNull();
  });

  test('roleOfName strips a trailing tag containing a digit only', () => {
    expect(roleOfName('implementer-0278')).toBe('implementer');
    expect(roleOfName('docs-curator-2')).toBe('docs-curator');
    expect(roleOfName('impl-auth')).toBe('impl-auth');
    expect(roleOfName('test-engineer-f768')).toBe('test-engineer');
  });

  test('contract evidence tally counts completed items with non-blank evidence; verifiedDone follows verified ids', () => {
    const t = (id: string, status: string, evidence?: string) => ({ id, content: id, status, session_id: 's', evidence }) as TodoItem;
    const m = coreModel(emptyIn({
      findings: JSON.stringify([{ id: 'a', status: 'verified' }, { id: 'b', status: 'rejected' }]),
      todos: [t('a', 'completed', 'proof'), t('b', 'completed', '   '), t('c', 'completed'), t('d', 'pending', 'x')],
      openGates: 2,
      header: { ok: 1, total: 2 },
    }));
    expect(m.contract).toEqual({ header: { ok: 1, total: 2 }, evidence: { ok: 1, total: 3 }, openGates: 2, verifiedDone: { ok: 1, total: 3 } });
  });

  test('offload ratio is kept/returned, null when either side is zero', () => {
    const log = JSON.stringify({ type: 'assistant', message: { id: 'a', usage: { input_tokens: 10 } } }) + '\n' + JSON.stringify({ type: 'assistant', message: { id: 'b', usage: { input_tokens: 50 } } });
    const reports = [{ owner: 'w-1', text: 'x'.repeat(8), at: 1 }];
    expect(coreModel(emptyIn({ logs: { 'w-1': log }, reports })).offload).toMatchObject({ kept: 40, returned: 2, ratio: 20 });
    expect(coreModel(emptyIn({ logs: { 'w-1': log } })).offload.ratio).toBeNull();
    expect(coreModel(emptyIn({ logs: { 'w-1': 'x' }, reports })).offload.ratio).toBeNull();
  });

  test('a one-token report still yields a ratio; non-finite numbers in team records fall back to defaults', () => {
    const log = JSON.stringify({ type: 'assistant', message: { id: 'a', usage: { input_tokens: 10 } } }) + '\n' + JSON.stringify({ type: 'assistant', message: { id: 'b', usage: { input_tokens: 50 } } });
    const one = coreModel(emptyIn({ logs: { 'w-1': log }, reports: [{ owner: 'w-1', text: 'abcd', at: 1 }] }));
    expect(one.offload).toMatchObject({ kept: 40, returned: 1, ratio: 40 });
    const matrix = JSON.stringify({ classes: { fix: { low: { team: [{ role: 'implementer' }] } } } });
    const inf = '{"class":"fix","effort":"low","max_parallel":1e999,"members":[]}';
    expect(coreModel(emptyIn({ matrix, teams: [{ name: 't.json', text: inf }] })).routes[0]!.maxParallel).toBe(1);
  });

  test('routes: defaults, ordering by created, class and effort aliases, labelled seats', () => {
    const matrix = JSON.stringify({
      class_aliases: { bug: 'fix' },
      effort_aliases: { lo: 'low' },
      classes: { fix: { low: { team: [{ role: 'implementer', count: 2, model: 'sonnet' }, { role: 'verifier', seat: 'deep', effort: 'high' }] } } },
    });
    const mk = (extra: object, created: number) => JSON.stringify({ class: 'bug', effort: 'lo', created, members: [], ...extra });
    const m = coreModel(emptyIn({
      matrix,
      teams: [{ name: 'late.json', text: mk({ name: 'L' }, 9) }, { name: 'early.json', text: mk({ name: 'E', max_parallel: 3, isolation: 'worktree', team_id: 'T-1' }, 2) }, { name: 'bad.json', text: '{"x":1}' }],
    }));
    expect(m.routes.map((r) => [r.teamId, r.name, r.maxParallel, r.isolation])).toEqual([['T-1', 'E', 3, 'worktree'], ['late', 'L', 1, '']]);
    expect(m.routes[0]!.seats).toEqual([
      { role: 'implementer', count: 2, model: 'sonnet', effort: 'lo', ran: [] },
      { role: 'verifier', seat: 'deep', count: 1, model: 'inherit', effort: 'high', ran: [] },
    ]);
  });

  test('labelled seats of one role match only the members spawned for that label', () => {
    const matrix = JSON.stringify({ classes: { fix: { low: { team: [
      { role: 'verifier', seat: 'a', model: 'haiku' }, { role: 'verifier', seat: 'b', model: 'sonnet' },
    ] } } } });
    const members = [{ name: 'verifier-1', role: 'verifier', seat: 'a' }, { name: 'verifier-2', role: 'verifier', seat: 'b' }];
    const log = (model: string) => JSON.stringify({ type: 'assistant', message: { id: 'z', model, usage: { input_tokens: 1 } } });
    const m = coreModel(emptyIn({
      matrix,
      teams: [{ name: 't.json', text: team(members) }],
      logs: { 'verifier-1': log('claude-haiku-5'), 'verifier-2': log('claude-sonnet-5') },
    }));
    expect(m.routes[0]!.seats.map((s) => s.ran)).toEqual([['claude-haiku-5'], ['claude-sonnet-5']]);
    expect(m.routes[0]!.drift).toEqual([]);
  });

  test('hasCore is true for each kind of content on its own', () => {
    const base = coreModel(emptyIn({}));
    expect(hasCore({ ...base, verdicts: [{ id: 'a', status: 'verified', title: '', by: '', at: 0, evidence: '' }] })).toBe(true);
    expect(hasCore({ ...base, claims: [{ owner: 'o', role: 'r', status: 'DONE', at: 0, matched: null }] })).toBe(true);
    expect(hasCore(coreModel(emptyIn({ logs: { 'w-1': '' } })))).toBe(true);
    expect(hasCore(coreModel(emptyIn({ matrix: '{}', teams: [{ name: 't.json', text: team([]) }] })))).toBe(true);
  });

  test('one id appearing three times counts once, by its latest entry', () => {
    const findings = JSON.stringify([
      { id: 'x', status: 'verified', title: 'first', verified_at: '2026-01-01T00:00:00Z' },
      { id: 'x', status: 'rejected', title: 'second', verified_at: '2026-01-02T00:00:00Z' },
      { id: 'x', status: 'verified', title: 'third', verified_at: '2026-01-03T00:00:00Z' },
      { id: 'y', status: 'needs-evidence', title: 'y' },
    ]);
    const m = coreModel(emptyIn({ findings }));
    expect(m.verdicts.map((r) => [r.id, r.title])).toEqual([['x', 'third'], ['y', 'y']]);
    expect(m.ledger).toMatchObject({ verified: 1, refuted: 0, pending: 1 });
  });
  test('an entry without id or title falls back to batch and claim', () => {
    const findings = JSON.stringify([{ batch: 'batch-1', claim: 'fixed the thing', status: 'verified' }, { status: 'verified' }]);
    const m = coreModel(emptyIn({ findings }));
    expect(m.verdicts.map((r) => [r.id, r.title])).toEqual([['batch-1', 'fixed the thing'], ['', '']]);
  });

  test('tok formats at the 1000 and 1,000,000 boundaries', () => {
    expect([tok(0), tok(912), tok(999.6), tok(1000), tok(58800), tok(999999), tok(1_000_000), tok(1_250_000)]).toEqual(['0', '912', '1000', '1.0k', '58.8k', '1000.0k', '1.0M', '1.3M']);
  });
});

describe('routes: transport and session', () => {
  const emptyIn = (over: Partial<CoreInput>): CoreInput =>
    ({ findings: '', teams: [], matrix: '', logs: {}, reports: [], todos: [], header: { ok: 0, total: 0 }, openGates: 0, ...over });
  const matrix = JSON.stringify({
    class_aliases: { bug: 'fix' },
    classes: { fix: { low: { team: [{ role: 'implementer', model: 'sonnet' }, { role: 'verifier', model: 'haiku' }] } } },
  });
  const rec = (channel: string, created: number) =>
    ({ name: `${channel}.json`, text: JSON.stringify({ class: 'fix', effort: 'low', channel, created, members: [] }) });

  test('with channels, a previous session team record is no route', () => {
    const teams = [rec('crew/lead-aaaaaa', 1), rec('crew/lead-bbbbbb', 2)];
    const m = coreModel(emptyIn({ matrix, teams, channels: ['lead-bbbbbb'] }));
    expect(m.routes.map((r) => r.teamId)).toEqual(['crew/lead-bbbbbb']);
    expect(coreModel(emptyIn({ matrix, teams, channels: ['lead-cccccc'] })).routes).toEqual([]);
    expect(coreModel(emptyIn({ matrix, teams })).routes).toHaveLength(2);
  });

  test('in-process dispatches become in-process routes per SCOPE, seats ran the dispatch model', () => {
    const dispatches = [
      { name: 'impl-a', type: 'atlas:implementer', scope: 'bug/low', model: 'claude-opus-5-5', at: 2 },
      { name: 'ver-a', type: 'atlas:verifier', scope: 'fix/low', model: 'claude-haiku-5', at: 3 },
      { name: 'loose', type: 'atlas:explorer', at: 1 },
    ];
    const m = coreModel(emptyIn({ matrix, dispatches }));
    expect(m.inProcess).toBe(true);
    expect(m.routes.map((r) => [r.teamId, r.transport, r.cls, r.effort, r.maxParallel])).toEqual([
      ['in-process:-/-', 'in-process', '-', '-', 1],
      ['in-process:bug/low', 'in-process', 'bug', 'low', 1],
      ['in-process:fix/low', 'in-process', 'fix', 'low', 1],
    ]);
    expect(m.routes[0]!.seats).toEqual([]);
    expect(m.routes[1]!.seats.map((s) => s.ran)).toEqual([['claude-opus-5-5'], []]);
    expect(m.routes[1]!.drift).toEqual(['implementer ran claude-opus-5-5, seat is sonnet']);
    expect(m.routes[2]!.drift).toEqual([]);
    expect(dispatchRoutes([], matrix)).toEqual([]);
  });

  test('SCOPE-less or malformed-SCOPE dispatches are bucketed under -/- with no seats, never dropped', () => {
    const rs = dispatchRoutes([
      { name: 'a', type: 'atlas:implementer', model: 'sonnet', at: 1 },
      { name: 'b', type: 'atlas:explorer', at: 2 },
    ], matrix);
    expect(rs.map((r) => [r.teamId, r.transport, r.cls, r.effort, r.maxParallel])).toEqual([
      ['in-process:-/-', 'in-process', '-', '-', 2],
    ]);
    expect(rs[0]!.seats).toEqual([]);
    expect(rs[0]!.drift).toEqual([]);
    const bad = dispatchRoutes([{ type: 'atlas:verifier', scope: 'not a scope', at: 1 }], matrix);
    expect(bad.map((r) => r.teamId)).toEqual(['in-process:-/-']);
  });

  test('tmux and in-process routes sit side by side; no dispatches handed in means inProcess false', () => {
    const m = coreModel(emptyIn({ matrix, teams: [rec('lead-x', 1)], dispatches: [{ type: 'atlas:implementer', scope: 'fix/low' }] }));
    expect(m.routes.map((r) => r.transport)).toEqual(['tmux', 'in-process']);
    expect(coreModel(emptyIn({ matrix, teams: [rec('lead-x', 1)] })).inProcess).toBe(false);
  });
});

describe('D4 route count drift', () => {
  const matrix = JSON.stringify({ classes: { audit: { low: { team: [{ role: 'explorer', model: 'haiku' }] } } } });
  const dispatch = (n: number) => ({ name: `ex-${n}`, type: 'atlas:explorer', scope: 'audit/low', model: 'claude-haiku-5', at: n });
  test('D4: three explorer dispatches against a one-explorer seat are drift, though the model matches', () => {
    const [r] = dispatchRoutes([dispatch(1), dispatch(2), dispatch(3)], matrix);
    expect(r!.seats[0]).toMatchObject({ count: 1 });
    expect(r!.seats[0]!.ran).toHaveLength(3);
    expect(r!.drift).toEqual(['explorer ran 3, seat plans 1']);
  });
  test('D4: as many dispatches as seats is no drift', () => {
    expect(dispatchRoutes([dispatch(1)], matrix)[0]!.drift).toEqual([]);
  });
});
