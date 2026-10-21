import type { DomainHandler, DomainName } from '../utils/types.js';

// Lazily import each domain module so a server with sparse credentials never
// pays the cost of loading tool schemas it cannot use yet.
export async function getDomainHandler(domain: DomainName): Promise<DomainHandler> {
  switch (domain) {
    case 'session':
      return (await import('./session.js')).sessionHandler;
    case 'system':
      return (await import('./system.js')).systemHandler;
    case 'config':
      return (await import('./config.js')).configHandler;
    case 'objects':
      return (await import('./objects.js')).objectsHandler;
    case 'policies':
      return (await import('./policies.js')).policiesHandler;
    case 'interfaces':
      return (await import('./interfaces.js')).interfacesHandler;
    case 'vpn':
      return (await import('./vpn.js')).vpnHandler;
    case 'logs':
      return (await import('./logs.js')).logsHandler;
    case 'generic':
      return (await import('./generic.js')).genericHandler;
    default: {
      const exhaustive: never = domain;
      throw new Error(`Unknown domain: ${exhaustive}`);
    }
  }
}
