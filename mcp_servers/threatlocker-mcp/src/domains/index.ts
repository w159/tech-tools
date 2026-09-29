import type { DomainName, DomainHandler } from '../utils/types.js';

const domainCache = new Map<DomainName, DomainHandler>();

export async function getDomainHandler(domain: DomainName): Promise<DomainHandler> {
  const cached = domainCache.get(domain);
  if (cached) return cached;

  let handler: DomainHandler;
  switch (domain) {
    case 'computers': {
      const { computersHandler } = await import('./computers.js');
      handler = computersHandler;
      break;
    }
    case 'computer_groups': {
      const { computerGroupsHandler } = await import('./computer_groups.js');
      handler = computerGroupsHandler;
      break;
    }
    case 'approval_requests': {
      const { approvalRequestsHandler } = await import('./approval_requests.js');
      handler = approvalRequestsHandler;
      break;
    }
    case 'audit_log': {
      const { auditLogHandler } = await import('./audit_log.js');
      handler = auditLogHandler;
      break;
    }
    case 'organizations': {
      const { organizationsHandler } = await import('./organizations.js');
      handler = organizationsHandler;
      break;
    }
    case 'policies': {
      const { policiesHandler } = await import('./policies.js');
      handler = policiesHandler;
      break;
    }
    case 'applications': {
      const { applicationsHandler } = await import('./applications.js');
      handler = applicationsHandler;
      break;
    }
    case 'config_manager': {
      const { configManagerHandler } = await import('./config_manager.js');
      handler = configManagerHandler;
      break;
    }
    case 'dac': {
      const { dacHandler } = await import('./dac.js');
      handler = dacHandler;
      break;
    }
    case 'system_audit': {
      const { systemAuditHandler } = await import('./system_audit.js');
      handler = systemAuditHandler;
      break;
    }
    case 'tags': {
      const { tagsHandler } = await import('./tags.js');
      handler = tagsHandler;
      break;
    }
    default:
      throw new Error(`Unknown domain: ${domain}`);
  }

  domainCache.set(domain, handler);
  return handler;
}