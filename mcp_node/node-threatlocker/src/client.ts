import type { ThreatLockerClientConfig } from './types/index.js';
import { HttpClient } from './http.js';
import { RateLimiter } from './rate-limiter.js';
import { ComputersResource } from './resources/computers.js';
import { ComputerGroupsResource } from './resources/computer-groups.js';
import { ApprovalRequestsResource } from './resources/approval-requests.js';
import { AuditLogResource } from './resources/audit-log.js';
import { OrganizationsResource } from './resources/organizations.js';
import { PoliciesResource } from './resources/policies.js';
import { ApplicationsResource } from './resources/applications.js';
import { ConfigManagerResource } from './resources/config-manager.js';
import { DacResource } from './resources/dac.js';
import { SystemAuditResource } from './resources/system-audit.js';
import { TagsResource } from './resources/tags.js';

export class ThreatLockerClient {
  readonly computers: ComputersResource;
  readonly computerGroups: ComputerGroupsResource;
  readonly approvalRequests: ApprovalRequestsResource;
  readonly auditLog: AuditLogResource;
  readonly organizations: OrganizationsResource;
  readonly policies: PoliciesResource;
  readonly applications: ApplicationsResource;
  readonly configManager: ConfigManagerResource;
  readonly dac: DacResource;
  readonly systemAudit: SystemAuditResource;
  readonly tags: TagsResource;

  constructor(config: ThreatLockerClientConfig) {
    const rateLimiter = new RateLimiter(config.rateLimitPerSecond ?? 10);
    const http = new HttpClient({
      baseUrl: config.baseUrl ?? 'https://portalapi.g.threatlocker.com/portalapi',
      apiKey: config.apiKey,
      organizationId: config.organizationId,
      maxRetries: config.maxRetries ?? 3,
      rateLimiter,
    });

    this.computers = new ComputersResource(http);
    this.computerGroups = new ComputerGroupsResource(http);
    this.approvalRequests = new ApprovalRequestsResource(http);
    this.auditLog = new AuditLogResource(http);
    this.organizations = new OrganizationsResource(http);
    this.policies = new PoliciesResource(http);
    this.applications = new ApplicationsResource(http);
    this.configManager = new ConfigManagerResource(http);
    this.dac = new DacResource(http);
    this.systemAudit = new SystemAuditResource(http);
    this.tags = new TagsResource(http);
  }
}