import { crudDomain } from './crud.js';

// Policies are keyed by uuid. access-rules has no PATCH in the inventory, so
// the shared update guard rejects patch: true there with a clear error.
const RESOURCES = [
  'access-rules/ipv4', 'access-rules/ipv6', 'security-policies/ipv4', 'security-policies/ipv6',
  'nat-policies/ipv4', 'nat-policies/ipv6', 'route-policies/ipv4', 'route-policies/ipv6',
] as const;

export const policiesHandler = crudDomain({ prefix: 'sonicwall_policies', noun: 'SonicOS policy rule', resources: RESOURCES, key: 'uuid' });
