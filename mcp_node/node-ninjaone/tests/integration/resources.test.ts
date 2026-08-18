/**
 * Wiring and path construction for the queries, automation, and directory
 * resources.
 *
 * These three were added as isolated files and only reached NinjaOneClient in a
 * separate pass, so a resource can compile and test green at the MCP layer while
 * being absent from the client at runtime. Asserting the property exists AND
 * that each method hits the documented path is what catches that.
 *
 * The msw setup runs with onUnhandledRequest: 'error', so a request to any path
 * other than the one asserted fails the test rather than passing silently.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { NinjaOneClient } from '../../src/client.js';

const BASE_URL = 'https://app.ninjarmm.com';

function makeClient() {
  return new NinjaOneClient({
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    region: 'us',
  });
}

/** Register a one-shot handler and capture the URL the client actually called. */
function captureGet(path: string, body: object = []) {
  const seen: { url?: URL } = {};
  server.use(
    http.get(`${BASE_URL}${path}`, ({ request }) => {
      seen.url = new URL(request.url);
      return HttpResponse.json(body);
    })
  );
  return seen;
}

describe('client resource wiring', () => {
  it('exposes every resource NinjaOneClient documents', () => {
    const client = makeClient();

    expect(client.organizations).toBeDefined();
    expect(client.devices).toBeDefined();
    expect(client.alerts).toBeDefined();
    expect(client.tickets).toBeDefined();
    expect(client.webhooks).toBeDefined();
    expect(client.queries).toBeDefined();
    expect(client.automation).toBeDefined();
    expect(client.directory).toBeDefined();
  });
});

describe('QueriesResource', () => {
  it('routes a named query to /v2/queries/{query}', async () => {
    const seen = captureGet('/v2/queries/os-patch-installs', { results: [] });

    await makeClient().queries.run('os-patch-installs');

    expect(seen.url?.pathname).toBe('/v2/queries/os-patch-installs');
  });

  it('sends tenant scope as df, never as organizationId', async () => {
    // Those endpoints have no organizationId parameter: sending one filters
    // nothing and returns a whole-tenant result that reads like a scoped one.
    const seen = captureGet('/v2/queries/software', { results: [] });

    await makeClient().queries.run('software', { df: 'org = 7' });

    expect(seen.url?.searchParams.get('df')).toBe('org = 7');
    expect(seen.url?.searchParams.get('organizationId')).toBeNull();
  });

  it('routes the device-scoped patch history to /v2/device/{id}/os-patch-installs', async () => {
    const seen = captureGet('/v2/device/210/os-patch-installs', []);

    await makeClient().queries.osPatchInstallsForDevice(210);

    expect(seen.url?.pathname).toBe('/v2/device/210/os-patch-installs');
  });
});

describe('AutomationResource', () => {
  it('lists the script catalog from /v2/scripts', async () => {
    const seen = captureGet('/v2/scripts', []);

    await makeClient().automation.listScripts();

    expect(seen.url?.pathname).toBe('/v2/scripts');
  });

  it('lists jobs from /v2/jobs and forwards df', async () => {
    const seen = captureGet('/v2/jobs', []);

    await makeClient().automation.listJobs({ df: 'org = 3' });

    expect(seen.url?.pathname).toBe('/v2/jobs');
    expect(seen.url?.searchParams.get('df')).toBe('org = 3');
    expect(seen.url?.searchParams.get('organizationId')).toBeNull();
  });
});

describe('DirectoryResource', () => {
  it('reads policies, a single policy, and its conditions', async () => {
    const client = makeClient();

    const list = captureGet('/v2/policies', []);
    await client.directory.listPolicies();
    expect(list.url?.pathname).toBe('/v2/policies');

    const one = captureGet('/v2/policies/12', {});
    await client.directory.getPolicy(12);
    expect(one.url?.pathname).toBe('/v2/policies/12');

    const cond = captureGet('/v2/policies/12/conditions', []);
    await client.directory.getPolicyConditions(12);
    expect(cond.url?.pathname).toBe('/v2/policies/12/conditions');
  });

  it('resolves a saved group to device ids', async () => {
    const seen = captureGet('/v2/group/5/device-ids', []);

    await makeClient().directory.getGroupDeviceIds(5);

    expect(seen.url?.pathname).toBe('/v2/group/5/device-ids');
  });

  it.each(['users', 'locations', 'roles', 'node-classes'] as const)(
    'reads the %s catalog from its own path',
    async (kind) => {
      const seen = captureGet(`/v2/${kind}`, []);

      await makeClient().directory.list(kind);

      expect(seen.url?.pathname).toBe(`/v2/${kind}`);
    }
  );
});
