/**
 * Main NinjaOne Client
 */

import type { NinjaOneConfig, ResolvedConfig } from './config.js';
import { resolveConfig } from './config.js';
import { AuthManager } from './auth.js';
import { HttpClient } from './http.js';
import { RateLimiter } from './rate-limiter.js';
import { OrganizationsResource } from './resources/organizations.js';
import { DevicesResource } from './resources/devices.js';
import { AlertsResource } from './resources/alerts.js';
import { TicketsResource } from './resources/tickets.js';
import { WebhooksResource } from './resources/webhooks.js';
import { QueriesResource } from './resources/queries.js';
import { AutomationResource } from './resources/automation.js';
import { DirectoryResource } from './resources/directory.js';

/**
 * NinjaOne API Client
 *
 * @example
 * ```typescript
 * const client = new NinjaOneClient({
 *   clientId: process.env.NINJAONE_CLIENT_ID!,
 *   clientSecret: process.env.NINJAONE_CLIENT_SECRET!,
 *   region: 'us', // or 'eu', 'oc', 'ca', 'us2', 'fed'
 * });
 *
 * // List organizations
 * const organizations = await client.organizations.list();
 *
 * // Get devices for an organization
 * const devices = await client.devices.listByOrganization(123);
 *
 * // Get active alerts
 * const alerts = await client.alerts.list({ status: 'OPEN' });
 *
 * // Create a ticket
 * const ticket = await client.tickets.create({
 *   subject: 'Server down',
 *   priority: 'HIGH',
 *   organizationId: 123,
 * });
 * ```
 */
export class NinjaOneClient {
  private readonly config: ResolvedConfig;
  private readonly authManager: AuthManager;
  private readonly rateLimiter: RateLimiter;
  private readonly httpClient: HttpClient;

  /** Organization operations */
  readonly organizations: OrganizationsResource;
  /** Device operations */
  readonly devices: DevicesResource;
  /** Alert operations */
  readonly alerts: AlertsResource;
  /** Ticket operations */
  readonly tickets: TicketsResource;
  /** Webhook operations */
  readonly webhooks: WebhooksResource;
  /** Cross-org reporting queries (/v2/queries/*) */
  readonly queries: QueriesResource;
  /** Script catalog and job visibility */
  readonly automation: AutomationResource;
  /** Policies, groups, users, locations, roles, node classes */
  readonly directory: DirectoryResource;

  constructor(config: NinjaOneConfig) {
    this.config = resolveConfig(config);
    this.authManager = new AuthManager(this.config);
    this.rateLimiter = new RateLimiter(this.config.rateLimit);
    this.httpClient = new HttpClient(this.config, this.authManager, this.rateLimiter);

    // Initialize resources
    this.organizations = new OrganizationsResource(this.httpClient);
    this.devices = new DevicesResource(this.httpClient);
    this.alerts = new AlertsResource(this.httpClient);
    this.tickets = new TicketsResource(this.httpClient);
    this.webhooks = new WebhooksResource(this.httpClient);
    this.queries = new QueriesResource(this.httpClient);
    this.automation = new AutomationResource(this.httpClient);
    this.directory = new DirectoryResource(this.httpClient);
  }

  /**
   * Get the current configuration
   */
  getConfig(): Readonly<ResolvedConfig> {
    return this.config;
  }

  /**
   * Invalidate the current auth token, forcing a new token to be acquired
   * on the next request
   */
  invalidateToken(): void {
    this.authManager.invalidateToken();
  }

  /**
   * Get the current rate limit status
   */
  getRateLimitStatus(): { remaining: number; rate: number } {
    return {
      remaining: this.rateLimiter.getRemainingRequests(),
      rate: this.rateLimiter.getCurrentRate(),
    };
  }
}
