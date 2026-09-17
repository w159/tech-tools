import type { DomainHandler, DomainName } from '../utils/types.js';

// Lazily import each domain module so a server with sparse credentials never
// pays the cost of loading tool schemas it cannot use yet. Mirrors
// vanta-mcp/src/domains/index.ts.
export async function getDomainHandler(domain: DomainName): Promise<DomainHandler> {
  switch (domain) {
    case 'config':
      return (await import('./config.js')).configHandler;
    case 'commits':
      return (await import('./commits.js')).commitsHandler;
    case 'operations':
      return (await import('./operations.js')).operationsHandler;
    case 'logs':
      return (await import('./logs.js')).logsHandler;
    case 'reports':
      return (await import('./reports.js')).reportsHandler;
    case 'files':
      return (await import('./files.js')).filesHandler;
    case 'objects':
      return (await import('./objects.js')).objectsHandler;
    case 'policies':
      return (await import('./policies.js')).policiesHandler;
    case 'updates':
      return (await import('./updates.js')).updatesHandler;
    case 'certificates':
      return (await import('./certificates.js')).certificatesHandler;
    default: {
      const exhaustive: never = domain;
      throw new Error(`Unknown domain: ${exhaustive}`);
    }
  }
}
