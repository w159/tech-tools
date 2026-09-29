import { describe, it, expect } from 'vitest';
import { applicationSummary, applicationsHandler } from '../domains/applications.js';
import { policySummary, policiesHandler } from '../domains/policies.js';
import { dacSummary, dacHandler } from '../domains/dac.js';
import { cmPolicySummary, configManagerHandler } from '../domains/config_manager.js';
import { systemAuditSummary, systemAuditHandler } from '../domains/system_audit.js';
import { namedId, oneOf, timeWindow, parseArgs, InvalidArgsError } from '../domains/_args.js';
import { resolvePolicy, resolveApplication, ResolutionError } from '../utils/resolve.js';

import type { SummaryFn } from '../domains/_helpers.js';

const GUID = '00000000-0000-4000-8000-000000000000';

// SummaryFn may return null; every summary here returns an object.
const row = (fn: SummaryFn, item: Record<string, unknown>) => fn(item) as Record<string, unknown>;

describe('summaries', () => {
  it('applicationSummary maps enum ids to names and drops empties', () => {
    expect(row(applicationSummary, { applicationId: 'a', name: 'n', description: '', category: 1, osType: 2, appVer: '', policyCount: 0 }))
      .toEqual({ applicationId: 'a', name: 'n', description: undefined, category: 'Custom', osType: 'macOS', appVer: undefined, policyCount: 0 });
    expect(row(applicationSummary, { category: 99 }).category).toBe(99);
    expect(row(applicationSummary, { category: 'x' }).category).toBe('x');
    expect(row(applicationSummary, { osType: 'x' }).osType).toBeUndefined();
  });
  it('policySummary names the action and only adds computerGroupId when present', () => {
    expect(row(policySummary, { policyActionId: 6, osType: 1 })).toMatchObject({ action: 'Permit with Ringfencing', osType: 'Windows' });
    expect(row(policySummary, { policyActionId: 7 }).action).toBe(7);
    expect(row(policySummary, {}).action).toBeUndefined();
    expect(row(policySummary, {})).not.toHaveProperty('computerGroupId');
    expect(row(policySummary, { computerGroupId: 'g' })).toHaveProperty('computerGroupId', 'g');
  });
  it('dacSummary names category, criticality and entity type, passing unknowns through', () => {
    expect(row(dacSummary, { categoryId: 2, criticalityId: 4, entityTypeId: 2, appliesToId: 'x' }))
      .toEqual({ analysisItemId: undefined, category: 'Storage Policy', criticality: 'Critical', entityType: 'Computer Group', appliesTo: 'x' });
    expect(row(dacSummary, { categoryId: 99, criticalityId: 'c', entityTypeId: null })).toMatchObject({ category: 99, criticality: 'c', entityType: null });
  });
  it('cmPolicySummary names the status including -1', () => {
    expect(row(cmPolicySummary, { status: -1 }).status).toBe('Not Configured');
    expect(row(cmPolicySummary, { status: 1 }).status).toBe('Enabled');
    expect(row(cmPolicySummary, { status: 5 }).status).toBe(5);
    expect(row(cmPolicySummary, { status: 'x' }).status).toBe('x');
  });
  it('systemAuditSummary drops empty fields', () => {
    expect(row(systemAuditSummary, { dateTime: 't', action: '', iPAddress: '1.1.1.1' }))
      .toEqual({ time: 't', action: undefined, details: undefined, user: undefined, ipAddress: '1.1.1.1', effective: undefined });
  });
});

describe('timeWindow', () => {
  const now = new Date('2026-09-01T12:00:00.789Z');
  it('defaults to the last 24 hours, without fractional seconds', () => {
    expect(timeWindow({}, now)).toEqual({ startDate: '2026-08-31T12:00:00Z', endDate: '2026-09-01T12:00:00Z' });
  });
  it('honours hours, ignores non-positive hours, and prefers startDate', () => {
    expect(timeWindow({ hours: 2 }, now).startDate).toBe('2026-09-01T10:00:00Z');
    expect(timeWindow({ hours: -1 }, now).startDate).toBe('2026-08-31T12:00:00Z');
    expect(timeWindow({ hours: 2, startDate: '2026-01-01T00:00:00.500Z', endDate: '2026-01-02T00:00:00Z' }, now))
      .toEqual({ startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-02T00:00:00Z' });
  });
  it('throws on an invalid date', () => {
    expect(() => timeWindow({ startDate: 'nope' }, now)).toThrow('Invalid date: nope');
  });
});

describe('argument parsing', () => {
  it('namedId is case-insensitive, blank-tolerant and rejects unknown names', () => {
    const table = { all: 0, windows: 1 };
    expect(namedId({ osType: ' Windows ' }, 'osType', table, 'h')).toBe(1);
    expect(namedId({ osType: 'all' }, 'osType', table, 'h')).toBe(0);
    expect(namedId({}, 'osType', table, 'h')).toBeUndefined();
    expect(namedId({ osType: ' ' }, 'osType', table, 'h')).toBeUndefined();
    expect(() => namedId({ osType: 'bsd' }, 'osType', table, 'h')).toThrow('Unknown osType "bsd".');
  });
  it('oneOf accepts listed values and rejects others', () => {
    expect(oneOf({ k: 'a' }, 'k', ['a', 'b'])).toBe('a');
    expect(oneOf({}, 'k', ['a'])).toBeUndefined();
    expect(() => oneOf({ k: 'z' }, 'k', ['a', 'b'])).toThrow(InvalidArgsError);
  });
  it('parseArgs turns InvalidArgsError into an INVALID_ARGS tool result and rethrows others', () => {
    const bad = parseArgs(() => namedId({ osType: 'bsd' }, 'osType', {}, 'Use all.'));
    expect(bad.error?.isError).toBe(true);
    expect(bad.error?.content[0].text).toContain('"code": "INVALID_ARGS"');
    expect(bad.error?.content[0].text).toContain('Use all.');
    expect(() => parseArgs(() => { throw new Error('boom'); })).toThrow('boom');
  });
});

describe('resolvePolicy / resolveApplication', () => {
  const clientWith = (items: { name: string }[]) => ({
    policies: { list: async () => ({ items }) },
    applications: { list: async () => ({ items }) },
  });

  it('accepts a GUID without calling the API, and rejects blank input', async () => {
    expect(await resolvePolicy({}, ` ${GUID} `)).toEqual({ policyId: GUID });
    expect(await resolveApplication({}, GUID)).toEqual({ applicationId: GUID });
    await expect(resolvePolicy({}, ' ')).rejects.toThrow('A policy name is required.');
    await expect(resolveApplication({}, '')).rejects.toThrow('An application name is required.');
  });
  it('returns the single case-insensitive exact match', async () => {
    const row = { name: 'Block USB' };
    expect(await resolvePolicy(clientWith([row, { name: 'Block USB 2' }]), 'block usb')).toBe(row);
    expect(await resolveApplication(clientWith([row]), 'BLOCK USB')).toBe(row);
  });
  it('fails closed on a miss, with closest names or the empty wording', async () => {
    await expect(resolvePolicy(clientWith([{ name: 'A' }, { name: 'B' }]), 'x')).rejects.toThrow('No policy named "x". Closest matches: A, B.');
    await expect(resolveApplication(clientWith([]), 'x')).rejects.toThrow('No application matching "x" in ThreatLocker.');
  });
  it('fails closed on ambiguity and carries the candidates', async () => {
    const client = clientWith([{ name: 'Dup' }, { name: 'dup' }]);
    await expect(resolvePolicy(client, 'dup')).rejects.toThrow('Policy name "dup" matches 2 policies (Dup, dup). Use the policyId GUID instead.');
    await expect(resolveApplication(client, 'dup')).rejects.toThrow('Use the applicationId GUID to pick one.');
    await resolveApplication(client, 'dup').catch(e => expect((e as ResolutionError).candidates).toEqual(['Dup', 'dup']));
  });
});

describe('handleCall validation (no network)', () => {
  const text = (r: { content: { text: string }[] }) => r.content[0].text;

  it('rejects an unknown tool in every domain', async () => {
    for (const h of [applicationsHandler, policiesHandler, dacHandler, configManagerHandler, systemAuditHandler]) {
      const r = await h.handleCall('threatlocker_nope', {});
      expect(r).toEqual({ content: [{ type: 'text', text: 'Unknown tool: threatlocker_nope' }], isError: true });
      expect((await h.handleCall('constructor', {})).isError).toBe(true);
    }
  });
  it('requires a name or id for get tools', async () => {
    expect(text(await applicationsHandler.handleCall('threatlocker_applications_get', {}))).toContain('Give an application name or an applicationId GUID.');
    expect(text(await policiesHandler.handleCall('threatlocker_policies_get', {}))).toContain('Give a policy name or a policyId GUID.');
  });
  it('rejects bad enum args before touching the API', async () => {
    const os = await applicationsHandler.handleCall('threatlocker_applications_list', { osType: 'bsd' });
    expect(text(os)).toContain('Unknown osType \\"bsd\\".');
    expect(text(os)).toContain('Use all, windows, mac, linux, or \\"windows xp\\".');
    expect(text(await policiesHandler.handleCall('threatlocker_policies_list', { filter: 'zzz' }))).toContain('Unknown filter');
    expect(text(await dacHandler.handleCall('threatlocker_dac_results_list', { criticality: 'zzz' }))).toContain('Use low, moderate, high, or critical.');
    expect(text(await configManagerHandler.handleCall('threatlocker_config_manager_policies_list', { status: 'zzz' }))).toContain('not-configured');
    expect(text(await systemAuditHandler.handleCall('threatlocker_system_audit_search', { startDate: 'nope' }))).toContain('Invalid date: nope');
    expect(text(await systemAuditHandler.handleCall('threatlocker_system_audit_search', { actions: ['Bad'] }))).toContain('Unknown action in actions.');
    expect(text(await systemAuditHandler.handleCall('threatlocker_system_audit_search', { effectiveAction: 'x' }))).toContain('effectiveAction must be Denied or Permitted');
  });
});
