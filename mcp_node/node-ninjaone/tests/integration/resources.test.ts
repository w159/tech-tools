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

/**
 * Every path below is transcribed from the NinjaRMM v2 OpenAPI spec
 * (NinjaRMM-API-v2.json). Five of them were wrong in 1.7.0 and returned HTTP
 * 404 or 400 against the live API: the script catalog, reboot, Windows service
 * control, scripting options, and the maintenance verb. msw runs with
 * onUnhandledRequest: 'error', so a drifted path fails here instead of in
 * production.
 */
describe('spec-verified paths', () => {
  /** Register a one-shot handler for any method and capture the real request. */
  function capture(method: 'get' | 'post' | 'put' | 'delete' | 'patch', path: string, body: unknown = {}) {
    const seen: { url?: URL; body?: unknown } = {};
    server.use(
      http[method](`${BASE_URL}${path}`, async ({ request }) => {
        seen.url = new URL(request.url);
        try {
          seen.body = await request.json();
        } catch {
          seen.body = undefined;
        }
        return HttpResponse.json(body);
      })
    );
    return seen;
  }

  it('lists the script catalog from /v2/automation/scripts, not /v2/scripts', async () => {
    const seen = capture('get', '/v2/automation/scripts', []);

    await makeClient().automation.listScripts();

    expect(seen.url?.pathname).toBe('/v2/automation/scripts');
  });

  it('lists scheduled tasks from /v2/tasks', async () => {
    const seen = capture('get', '/v2/tasks', []);

    await makeClient().automation.listTasks();

    expect(seen.url?.pathname).toBe('/v2/tasks');
  });

  it('puts the reboot mode in the path, not the body', async () => {
    const seen = capture('post', '/v2/device/:id/reboot/:mode');

    await makeClient().devices.reboot(77, 'FORCED', 'patch window');

    expect(seen.url?.pathname).toBe('/v2/device/77/reboot/FORCED');
    expect(seen.body).toEqual({ reason: 'patch window' });
  });

  it('controls a Windows service through /control with the verb in the body', async () => {
    const seen = capture('post', '/v2/device/:id/windows-service/:serviceId/control');

    await makeClient().devices.controlService(77, 'Spooler', 'RESTART');

    expect(seen.url?.pathname).toBe('/v2/device/77/windows-service/Spooler/control');
    expect(seen.body).toEqual({ action: 'RESTART' });
  });

  it('runs a catalog script with {type, id}, not {scriptId}', async () => {
    const seen = capture('post', '/v2/device/:id/script/run');

    await makeClient().devices.runScript(77, { type: 'SCRIPT', id: 42, parameters: '-Verbose' });

    expect(seen.url?.pathname).toBe('/v2/device/77/script/run');
    expect(seen.body).toEqual({ type: 'SCRIPT', id: 42, parameters: '-Verbose' });
  });

  it('runs a built-in action by uid', async () => {
    const seen = capture('post', '/v2/device/:id/script/run');

    await makeClient().devices.runScript(77, { type: 'ACTION', uid: 'abc-123' });

    expect(seen.body).toEqual({ type: 'ACTION', uid: 'abc-123' });
  });

  it('reads scripting options from scripting/options, not scripting-options', async () => {
    const seen = capture('get', '/v2/device/:id/scripting/options');

    await makeClient().devices.getScriptingOptions(77);

    expect(seen.url?.pathname).toBe('/v2/device/77/scripting/options');
  });

  it('schedules maintenance with PUT and an end timestamp', async () => {
    const seen = capture('put', '/v2/device/:id/maintenance');

    await makeClient().devices.scheduleMaintenance(77, {
      end: 1900000000,
      disabledFeatures: ['ALERTS', 'PATCHING'],
    });

    expect(seen.url?.pathname).toBe('/v2/device/77/maintenance');
    expect(seen.body).toEqual({ end: 1900000000, disabledFeatures: ['ALERTS', 'PATCHING'] });
  });

  it.each([
    ['os', 'scan'],
    ['os', 'apply'],
    ['software', 'scan'],
    ['software', 'apply'],
  ] as const)('triggers a %s patch %s', async (patchType, action) => {
    const seen = capture('post', `/v2/device/:id/patch/${patchType}/${action}`);

    await makeClient().devices.runPatchAction(77, patchType, action);

    expect(seen.url?.pathname).toBe(`/v2/device/77/patch/${patchType}/${action}`);
  });

  it('reads active jobs for one device', async () => {
    const seen = capture('get', '/v2/device/:id/jobs', []);

    await makeClient().devices.getActiveJobs(77);

    expect(seen.url?.pathname).toBe('/v2/device/77/jobs');
  });

  it('reads and clears policy overrides', async () => {
    const client = makeClient();

    const read = capture('get', '/v2/device/:id/policy/overrides');
    await client.devices.getPolicyOverrides(77);
    expect(read.url?.pathname).toBe('/v2/device/77/policy/overrides');

    const clear = capture('delete', '/v2/device/:id/policy/overrides');
    await client.devices.resetPolicyOverrides(77);
    expect(clear.url?.pathname).toBe('/v2/device/77/policy/overrides');
  });

  it('searches devices by free text', async () => {
    const seen = capture('get', '/v2/devices/search', []);

    await makeClient().devices.search('LAPTOP-42', 10);

    expect(seen.url?.pathname).toBe('/v2/devices/search');
    expect(seen.url?.searchParams.get('q')).toBe('LAPTOP-42');
    expect(seen.url?.searchParams.get('limit')).toBe('10');
  });

  it('lists detailed devices', async () => {
    const seen = capture('get', '/v2/devices-detailed', []);

    await makeClient().devices.listDetailed({ pageSize: 5 });

    expect(seen.url?.pathname).toBe('/v2/devices-detailed');
    expect(seen.url?.searchParams.get('pageSize')).toBe('5');
  });

  it('forwards patch filters on a device inventory sub-resource', async () => {
    const seen = capture('get', '/v2/device/:id/os-patches', []);

    await makeClient().devices.getInventoryByKind(77, 'os-patches', { status: 'FAILED' });

    expect(seen.url?.pathname).toBe('/v2/device/77/os-patches');
    expect(seen.url?.searchParams.get('status')).toBe('FAILED');
  });

  it('reads vulnerability scan groups', async () => {
    const client = makeClient();

    const list = capture('get', '/v2/vulnerability/scan-groups', []);
    await client.vulnerability.listScanGroups();
    expect(list.url?.pathname).toBe('/v2/vulnerability/scan-groups');

    const one = capture('get', '/v2/vulnerability/scan-groups/:id');
    await client.vulnerability.getScanGroup(9);
    expect(one.url?.pathname).toBe('/v2/vulnerability/scan-groups/9');
  });
});
