import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  withClientList,
  withClientItem,
  extractShapeArgs,
  SHAPE_PROPS,
  type SummaryFn,
  type FlatResource,
} from './shared.js';

const tenantSummary: SummaryFn<FlatResource> = (t: FlatResource) => ({
  id: t.id,
  domainPrefix: t.domainPrefix,
  tenantType: t.tenantType,
  enabled: t.enabled,
});

const tenantDetailSummary: SummaryFn<FlatResource> = (t: FlatResource) => ({
  id: t.id,
  displayName: t.displayName,
  domainPrefix: t.domainPrefix,
  tenantType: t.tenantType,
  authorizations: t.authorizations,
  subscriptionStatus: t.subscriptionStatus,
});

export const tenantsListTool: Tool = {
  name: 'auvik_tenants_list',
  description:
    'GET /v1/tenants — list every Auvik tenant (MSP clients + parent) the credentials can access. Returns compact summary (id, domainPrefix, tenantType, enabled) by default; pass full=true or fields=[...] for more. Each item exposes the numeric tenant `id` (used as the `tenants` param elsewhere) and `attributes.domainPrefix` (used by auvik_tenants_detail). Start here when you need a tenant ID.',
  inputSchema: {
    type: 'object',
    properties: {
      ...SHAPE_PROPS,
    },
    additionalProperties: false,
  },
};

export const tenantsDetailTool: Tool = {
  name: 'auvik_tenants_detail',
  description:
    'GET /v1/tenants/detail?tenantDomainPrefix=<prefix> — extended metadata (displayName, subscription, authorizations) for tenants under a domain prefix. Pass the domain PREFIX (e.g. "acme"), NOT the numeric tenant ID. Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      tenantDomainPrefix: {
        type: 'string',
        description: 'Tenant domain prefix from auvik_tenants_list attributes.domainPrefix (e.g. "acme").',
      },
      filter_availableTenants: {
        type: 'boolean',
        description: 'filter[availableTenants] — when true, include tenants available to (but not yet managed by) the caller.',
      },
      ...SHAPE_PROPS,
    },
    required: ['tenantDomainPrefix'],
    additionalProperties: false,
  },
};

export const tenantsGetDetailTool: Tool = {
  name: 'auvik_tenants_get_detail',
  description:
    'GET /v1/tenants/detail/{id} — extended metadata for a single tenant by numeric ID. Requires BOTH the tenant id and its domainPrefix (both from auvik_tenants_list). Returns compact summary by default; pass full=true or fields=[...] for more.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Numeric tenant ID from auvik_tenants_list.' },
      tenantDomainPrefix: { type: 'string', description: 'Domain prefix of that tenant (e.g. "acme").' },
      ...SHAPE_PROPS,
    },
    required: ['id', 'tenantDomainPrefix'],
    additionalProperties: false,
  },
};

export const handleTenantsList = (args: Record<string, unknown> = {}) =>
  withClientList((c) => c.tenants.list(), tenantSummary, extractShapeArgs(args), 'auvik_tenants_list');

export const handleTenantsDetail = (args: { tenantDomainPrefix: string; filter_availableTenants?: boolean } & Record<string, unknown>) =>
  withClientList(
    (c) => c.tenants.detail(args.tenantDomainPrefix, { filter_availableTenants: args.filter_availableTenants }),
    tenantDetailSummary,
    extractShapeArgs(args),
    'auvik_tenants_detail'
  );

export const handleTenantsGetDetail = (args: { id: string; tenantDomainPrefix: string } & Record<string, unknown>) =>
  withClientItem(
    (c) => c.tenants.detailById(args.id, args.tenantDomainPrefix),
    tenantDetailSummary,
    extractShapeArgs(args),
    'auvik_tenants_get_detail'
  );
