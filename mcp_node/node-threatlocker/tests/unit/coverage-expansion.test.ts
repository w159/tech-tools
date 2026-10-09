import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreatLockerClient } from '../../src/index.js';

// Request-shape tests: stub global fetch, capture path/method/body, return a
// bare array (the verified PortalAPI shape for the *GetByParameters endpoints).
// Note: this package's existing MSW-based suites cannot run here (msw is not an
// installed dependency), so these tests stub fetch directly instead.
const captured: { url: string; init: RequestInit }[] = [];

function stubFetch(json: unknown): void {
  captured.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    captured.push({ url: String(input), init });
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const client = new ThreatLockerClient({ apiKey: 'test-key' });

describe('PoliciesResource request shape', () => {
  it('posts to PolicyGetByParameters with documented defaults', async () => {
    stubFetch([
      { policyId: 'p1', name: 'Block PowerShell', policyActionId: 2, isEnabled: true, totalRows: 1 },
    ]);
    const result = await client.policies.list();
    expect(captured[0].url).toContain('/Policy/PolicyGetByParameters');
    expect(captured[0].init.method).toBe('POST');
    expect(JSON.parse(String(captured[0].init.body))).toMatchObject({
      computerGroupId: '00000000-0000-0000-0000-000000000000',
      filter: '',
      pageNumber: 1,
      pageSize: 25,
    });
    expect(result.items[0].name).toBe('Block PowerShell');
    expect(result.total).toBe(1);
  });

  it('passes body fields through', async () => {
    stubFetch([]);
    await client.policies.list({ computerGroupId: 'g1', filter: 'ringfence', osType: 1, activeOnly: true, searchText: 'edge', showAllPolicies: true, pageNumber: 2, pageSize: 10 });
    expect(JSON.parse(String(captured[0].init.body))).toMatchObject({
      computerGroupId: 'g1', filter: 'ringfence', osType: 1, activeOnly: true, searchText: 'edge', showAllPolicies: true, pageNumber: 2, pageSize: 10,
    });
  });

  it('gets by id via GET query param', async () => {
    stubFetch({ policyId: 'p1', name: 'X' });
    const row = await client.policies.get('p1');
    expect(captured[0].url).toContain('/Policy/PolicyGetById?policyId=p1');
    expect(captured[0].init.method).toBe('GET');
    expect(row.name).toBe('X');
  });
});

describe('ApplicationsResource request shape', () => {
  it('posts to ApplicationGetByParameters with documented defaults', async () => {
    stubFetch([{ applicationId: 'a1', name: 'Chrome', osType: 1 }]);
    const result = await client.applications.list();
    expect(captured[0].url).toContain('/Application/ApplicationGetByParameters');
    expect(captured[0].init.method).toBe('POST');
    expect(JSON.parse(String(captured[0].init.body))).toMatchObject({
      orderBy: 'name', pageNumber: 1, pageSize: 25, searchBy: 'app',
    });
    expect(result.items[0].name).toBe('Chrome');
  });

  it('gets by id via GET query param', async () => {
    stubFetch({ applicationId: 'a1', name: 'Chrome' });
    const row = await client.applications.get('a1');
    expect(captured[0].url).toContain('/Application/ApplicationGetById?applicationId=a1');
    expect(row.name).toBe('Chrome');
  });
});

describe('ConfigManagerResource request shape', () => {
  it('lists configurations as a bare array', async () => {
    stubFetch([{ value: 42, name: 'Require screen lock', category: 'LocalSecurity' }]);
    const list = await client.configManager.listConfigurations();
    expect(captured[0].url).toContain('/CMConfiguration/CMConfigurationGetWithCategoryByIsEnabled');
    expect(captured[0].init.method).toBe('GET');
    expect(list[0].value).toBe(42);
  });

  it('posts to CMPolicyGetbyParameters with documented defaults', async () => {
    stubFetch([{ cMPolicyId: 'c1', name: 'BitLocker', status: 1 }]);
    const result = await client.configManager.listPolicies();
    expect(captured[0].url).toContain('/CMPolicy/CMPolicyGetbyParameters');
    expect(JSON.parse(String(captured[0].init.body))).toMatchObject({
      appliesTo: '00000000-0000-0000-0000-000000000000',
      status: 99,
      pageNumber: 1,
      pageSize: 25,
    });
    expect(result.items[0].name).toBe('BitLocker');
  });
});

describe('DacResource request shape', () => {
  it('posts to DACAnalysisResultsGetByParameters', async () => {
    stubFetch([{ analysisItemId: 7, categoryId: 2, criticalityId: 3 }]);
    const result = await client.dac.listResults({ categoryId: 2 });
    expect(captured[0].url).toContain('/DACAnalysisResult/DACAnalysisResultsGetByParameters');
    expect(captured[0].init.method).toBe('POST');
    expect(JSON.parse(String(captured[0].init.body))).toMatchObject({ pageNumber: 1, pageSize: 25, categoryId: 2 });
    expect(result.items[0].categoryId).toBe(2);
  });

  it('gets an item by integer id', async () => {
    stubFetch({ analysisItemId: 7 });
    const item = await client.dac.getItem(7);
    expect(captured[0].url).toContain('/DACAnalysisItem/DACAnalysisItemGetById?analysisItemId=7');
    expect(item.analysisItemId).toBe(7);
  });
});

describe('SystemAuditResource request shape', () => {
  it('posts to SystemAuditGetByParameters with portal date format and actions array', async () => {
    stubFetch([{ systemAuditId: 's1', action: 'Modify' }]);
    const result = await client.systemAudit.search({
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-02T00:00:00.000Z',
      actions: ['Modify', 'Delete'],
      effectiveAction: 'Denied',
      emailAddress: 'admin@example.com',
    });
    expect(captured[0].url).toContain('/SystemAudit/SystemAuditGetByParameters');
    expect(captured[0].init.method).toBe('POST');
    expect(JSON.parse(String(captured[0].init.body))).toMatchObject({
      startDate: '2026-09-01T00:00:00Z', // fractional seconds stripped
      endDate: '2026-09-02T00:00:00Z',
      pageNumber: 1,
      pageSize: 100,
      actions: ['Modify', 'Delete'],
      effectiveAction: 'Denied',
      emailAddress: 'admin@example.com',
    });
    expect(result.items[0].action).toBe('Modify');
  });
});

describe('TagsResource request shape', () => {
  it('gets dropdown options with includeBuiltIns param', async () => {
    stubFetch([{ label: 'Prod', value: 't1' }]);
    const list = await client.tags.list(true);
    expect(captured[0].url).toContain('/Tag/TagGetDowndownOptionsByOrganizationId?includeBuiltIns=true');
    expect(list[0]).toMatchObject({ label: 'Prod', value: 't1' });
  });
});

describe('ApprovalRequestsResource.getStorageApproval', () => {
  it('gets storage approval by id', async () => {
    stubFetch({ approvalRequestId: 'r1', storagePolicy: 'Block USB' });
    const row = await client.approvalRequests.getStorageApproval('r1');
    expect(captured[0].url).toContain('/ApprovalRequest/ApprovalRequestGetStorageApprovalById?approvalRequestId=r1');
    expect(row.storagePolicy).toBe('Block USB');
  });
});