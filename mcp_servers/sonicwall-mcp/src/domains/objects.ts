import { crudDomain } from './crud.js';

// Objects are keyed by name. Resource strings are the SonicOS wire path segments.
const RESOURCES = [
  'address-objects/ipv4', 'address-objects/ipv6', 'address-objects/fqdn', 'address-objects/mac',
  'address-groups/ipv4', 'address-groups/ipv6', 'service-objects', 'service-groups', 'zones', 'schedules',
] as const;

export const objectsHandler = crudDomain({ prefix: 'sonicwall_objects', noun: 'SonicOS object', resources: RESOURCES, key: 'name' });
