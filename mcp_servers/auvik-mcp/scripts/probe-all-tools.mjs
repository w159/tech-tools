#!/usr/bin/env node
// Live-probe every Auvik MCP tool against real credentials.
// Loads creds from the parent toolkit .env, then exercises each handler with
// realistic args and reports pass/fail per tool.
//
// Run with:  npx tsx scripts/probe-all-tools.mjs

import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });
config({ path: resolve(__dirname, '../.env'), override: false });

const status = await import('../src/tools/status.ts');
const tenants = await import('../src/tools/tenants.ts');
const devices = await import('../src/tools/devices.ts');
const networks = await import('../src/tools/networks.ts');
const interfaces = await import('../src/tools/interfaces.ts');
const configs = await import('../src/tools/configurations.ts');
const components = await import('../src/tools/components.ts');
const entities = await import('../src/tools/entities.ts');
const alerts = await import('../src/tools/alerts.ts');
const stats = await import('../src/tools/statistics.ts');
const billing = await import('../src/tools/billing.ts');
const navigate = await import('../src/tools/navigate.ts');

const results = [];
const summarize = (r) => {
  if (!r) return 'no result';
  if (r.isError) return `ERROR: ${(r.content?.[0]?.text || '').split('\n')[0].slice(0, 180)}`;
  try {
    const body = JSON.parse(r.content[0].text);
    if (body?.data == null) return 'ok (empty)';
    if (Array.isArray(body.data)) return `ok (${body.data.length} items)`;
    return `ok (${body.data?.type || 'object'})`;
  } catch {
    return `ok (${(r.content?.[0]?.text || '').slice(0, 60)})`;
  }
};
const run = async (name, fn, { allow404 = false } = {}) => {
  let r;
  try {
    r = await fn();
  } catch (e) {
    r = { isError: true, content: [{ text: `THREW: ${e.message}` }] };
  }
  let ok = !r.isError;
  const summary = summarize(r);
  // Some by-id endpoints legitimately 404 when the resource has no record.
  if (!ok && allow404 && /404/.test(summary)) ok = true;
  results.push({ name, ok, summary });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}  ${summary}`);
  return r;
};
const parse = (r) => {
  try {
    return JSON.parse(r.content[0].text);
  } catch {
    return {};
  }
};

console.log('=== Auvik MCP — live tool probe ===');
console.log(`Region: ${process.env.AUVIK_REGION}  User: ${process.env.AUVIK_USERNAME}\n`);

await run('auvik_status', () => status.handleStatus());

const tResp = await run('auvik_tenants_list', () => tenants.handleTenantsList());
const tItems = parse(tResp).data || [];
const client = tItems.find((t) => t.attributes?.tenantType !== 'parentMsp') || tItems[0];
const tenantId = client?.id;
const prefix = client?.attributes?.domainPrefix;
console.log(`  → tenantId=${tenantId} prefix=${prefix}`);

if (prefix) await run('auvik_tenants_detail', () => tenants.handleTenantsDetail({ tenantDomainPrefix: prefix }));
if (tenantId && prefix)
  await run('auvik_tenants_get_detail', () => tenants.handleTenantsGetDetail({ id: tenantId, tenantDomainPrefix: prefix }));

if (!tenantId) {
  console.log('No tenant id — aborting.');
  process.exit(1);
}
const T = { tenants: tenantId, pageSize: 5 };

const dResp = await run('auvik_devices_list', () => devices.handleDevicesList(T));
const deviceId = parse(dResp).data?.[0]?.id;
console.log(`  → deviceId=${deviceId}`);

if (deviceId) {
  await run('auvik_devices_get', () => devices.handleDevicesGet({ deviceId }));
  await run('auvik_devices_get_details', () => devices.handleDevicesGetDetails({ deviceId }));
  await run('auvik_devices_get_extended', () => devices.handleDevicesGetExtended({ deviceId }));
  await run('auvik_devices_get_warranty', () => devices.handleDevicesGetWarranty({ deviceId }), { allow404: true });
  await run('auvik_devices_get_lifecycle', () => devices.handleDevicesGetLifecycle({ deviceId }), { allow404: true });
}
await run('auvik_devices_list_details', () => devices.handleDevicesListDetails(T));
await run('auvik_devices_list_extended', () => devices.handleDevicesListExtended({ ...T, filter_deviceType: 'switch' }));
await run('auvik_devices_list_warranty', () => devices.handleDevicesListWarranty(T));
await run('auvik_devices_list_lifecycle', () => devices.handleDevicesListLifecycle(T));

const nResp = await run('auvik_networks_list', () => networks.handleNetworksList(T));
const networkId = parse(nResp).data?.[0]?.id;
if (networkId) {
  await run('auvik_networks_get', () => networks.handleNetworksGet({ networkId }));
  await run('auvik_networks_get_detail', () => networks.handleNetworksGetDetail({ networkId }), { allow404: true });
}
await run('auvik_networks_list_detail', () => networks.handleNetworksListDetail(T));

const iResp = await run('auvik_interfaces_list', () => interfaces.handleInterfacesList(T));
const interfaceId = parse(iResp).data?.[0]?.id;
if (interfaceId) await run('auvik_interfaces_get', () => interfaces.handleInterfacesGet({ interfaceId }));

const cfgResp = await run('auvik_configurations_list', () => configs.handleConfigurationsList(T));
const configId = parse(cfgResp).data?.[0]?.id;
if (configId) await run('auvik_configurations_get', () => configs.handleConfigurationsGet({ configurationId: configId }));

const compResp = await run('auvik_components_list', () => components.handleComponentsList(T));
const componentId = parse(compResp).data?.[0]?.id;
if (componentId) await run('auvik_components_get', () => components.handleComponentsGet({ componentId }));

const noteResp = await run('auvik_entities_list_notes', () => entities.handleEntitiesListNotes(T));
const noteId = parse(noteResp).data?.[0]?.id;
if (noteId) await run('auvik_entities_get_note', () => entities.handleEntitiesGetNote({ noteId }));
const auditResp = await run('auvik_entities_list_audits', () => entities.handleEntitiesListAudits(T));
const auditId = parse(auditResp).data?.[0]?.id;
if (auditId) await run('auvik_entities_get_audit', () => entities.handleEntitiesGetAudit({ auditId }), { allow404: true });

const alertResp = await run('auvik_alerts_list', () => alerts.handleAlertsList(T));
const alertId = parse(alertResp).data?.[0]?.id;
if (alertId) await run('auvik_alerts_get', () => alerts.handleAlertsGet({ alertId }), { allow404: true });

const thru = new Date();
const from = new Date(thru.getTime() - 24 * 3600 * 1000);
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, '.000Z');
const win = { tenants: tenantId, fromTime: iso(from), thruTime: iso(thru), interval: 'hour' };

await run('auvik_statistics_device', () => stats.handleStatisticsDevice({ statId: 'cpuUtilization', ...win, deviceId }));
await run('auvik_statistics_device_availability', () =>
  stats.handleStatisticsDeviceAvailability({ statId: 'uptime', ...win })
);
await run('auvik_statistics_interface', () =>
  stats.handleStatisticsInterface({ statId: 'utilization', ...win, interfaceId })
);
await run('auvik_statistics_service', () => stats.handleStatisticsService({ statId: 'pingTime', ...win }));
await run('auvik_statistics_component', () =>
  stats.handleStatisticsComponent({ componentType: 'fan', statId: 'speed', ...win })
);
await run('auvik_statistics_oid', () => stats.handleStatisticsOid({ statId: 'deviceMonitor', tenants: tenantId }));

const billFrom = new Date(thru.getTime() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
const billThru = thru.toISOString().slice(0, 10);
await run('auvik_billing_client_usage', () => billing.handleBillingClientUsage({ fromDate: billFrom, thruDate: billThru }));
if (deviceId)
  await run(
    'auvik_billing_device_usage',
    () => billing.handleBillingDeviceUsage({ deviceId, fromDate: billFrom, thruDate: billThru }),
    { allow404: true }
  );

const next = parse(dResp)?.links?.next;
if (next) await run('auvik_navigate', () => navigate.handleNavigate({ url: next }));
else console.log('[SKIP] auvik_navigate — no links.next');

console.log('\n=== summary ===');
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`${pass} passed, ${fail} failed, ${results.length} total`);
for (const r of results) if (!r.ok) console.log(`  FAIL  ${r.name}: ${r.summary}`);
process.exit(fail ? 1 : 0);
