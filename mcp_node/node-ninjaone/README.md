Part of [tech-tools](https://github.com/w159/tech-tools) — see repo for the matching MCP server (`mcp_servers/ninjaone-mcp`) and plugin (`plugins/ninjaone-*`).

# node-ninjaone

Comprehensive, fully-typed Node.js/TypeScript library for the NinjaOne/NinjaRMM API.

> **Vendored within the [tech-tools](https://github.com/w159/tech-tools) monorepo.**
> Consumed by `ninjaone-mcp` via `"node-ninjaone": "file:../../mcp_node/node-ninjaone"`.
> This is not the public `@asachs01/node-ninjaone` npm package — do not `npm install @asachs01/node-ninjaone`.

## Features

- Full TypeScript support with comprehensive type definitions
- OAuth 2.0 authentication with automatic token refresh
- Support for all six regional endpoints (US, EU, Oceania, Canada, US2, Federal)
- Built-in rate limiting with configurable thresholds
- Automatic retry logic for rate limits and server errors
- Clean, intuitive API design

## Installation

This library is vendored — no separate installation needed. It is consumed by `ninjaone-mcp` as a local file dependency within the monorepo.

## Quick Start

```typescript
import { NinjaOneClient } from 'node-ninjaone';

const client = new NinjaOneClient({
  clientId: process.env.NINJAONE_CLIENT_ID!,
  clientSecret: process.env.NINJAONE_CLIENT_SECRET!,
  region: 'us', // 'us' | 'eu' | 'oc' | 'ca' | 'us2' | 'fed'
});

// List organizations
const organizations = await client.organizations.list();
console.log(`Found ${organizations.length} organizations`);

// Get devices for an organization
const devices = await client.devices.listByOrganization(organizations[0].id);
console.log(`Found ${devices.length} devices`);

// Get active alerts
const alerts = await client.alerts.list({ status: 'OPEN' });
console.log(`Found ${alerts.length} open alerts`);

// Create a ticket
const ticket = await client.tickets.create({
  subject: 'Server maintenance required',
  priority: 'HIGH',
  organizationId: organizations[0].id,
});
console.log(`Created ticket: ${ticket.ticketNumber}`);
```

## Configuration

### Basic Configuration

```typescript
const client = new NinjaOneClient({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  region: 'us', // Optional, defaults to 'us'
});
```

### Regional Endpoints

NinjaOne has three regional endpoints:

| Region | Base URL |
|--------|----------|
| US (default) | `https://app.ninjarmm.com` |
| EU | `https://eu.ninjarmm.com` |
| Oceania | `https://oc.ninjarmm.com` |

```typescript
// EU region
const euClient = new NinjaOneClient({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  region: 'eu',
});

// Custom base URL
const customClient = new NinjaOneClient({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  baseUrl: 'https://custom.ninjarmm.example.com',
});
```

### OAuth Scopes

```typescript
const client = new NinjaOneClient({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  scopes: ['monitoring', 'management', 'control'], // Default: ['monitoring', 'management']
});
```

### Rate Limiting

The client includes built-in rate limiting with sensible defaults:

```typescript
const client = new NinjaOneClient({
  clientId: 'your-client-id',
  clientSecret: 'your-client-secret',
  rateLimit: {
    enabled: true,           // Enable/disable rate limiting
    maxRequests: 100,        // Max requests per window
    windowMs: 60000,         // Window duration (1 minute)
    throttleThreshold: 0.8,  // Start throttling at 80%
    retryAfterMs: 5000,      // Retry delay for 429 errors
    maxRetries: 3,           // Max retry attempts
  },
});
```

## API Reference

### Organizations

```typescript
// List all organizations
const organizations = await client.organizations.list();

// Get a single organization
const org = await client.organizations.get(123);

// Get detailed organization info (includes device counts)
const detailed = await client.organizations.getDetailed(123);

// Create an organization
const newOrg = await client.organizations.create({
  name: 'New Customer',
  description: 'Customer description',
  nodeApprovalMode: 'AUTOMATIC',
});

// Update an organization
const updated = await client.organizations.update(123, {
  name: 'Updated Name',
});

// Delete an organization
await client.organizations.delete(123);
```

### Devices

```typescript
// List all devices
const devices = await client.devices.list();

// List devices by organization
const orgDevices = await client.devices.listByOrganization(123);

// Get a single device
const device = await client.devices.get(456);

// Update a device
const updated = await client.devices.update(456, {
  displayName: 'New Display Name',
  tags: ['production', 'critical'],
});

// Reboot a device
await client.devices.reboot(456, 'Maintenance window');

// Get device activities
const activities = await client.devices.getActivities(456);

// Get Windows services
const services = await client.devices.getServices(456);

// Start/stop/restart a service
await client.devices.startService(456, 'Spooler');
await client.devices.stopService(456, 'Spooler');
await client.devices.restartService(456, 'Spooler');

// Get software inventory
const software = await client.devices.getSoftware(456);

// Get hardware inventory
const inventory = await client.devices.getInventory(456);
```

### Alerts

```typescript
// List all alerts
const alerts = await client.alerts.list();

// List alerts with filters
const criticalAlerts = await client.alerts.list({
  severity: 'CRITICAL',
  status: 'OPEN',
});

// List alerts by device
const deviceAlerts = await client.alerts.listByDevice(456);

// List alerts by organization
const orgAlerts = await client.alerts.listByOrganization(123);

// Get a single alert
const alert = await client.alerts.get('alert-uid-123');

// Delete/acknowledge an alert
await client.alerts.delete('alert-uid-123');

// Reset an alert
await client.alerts.reset('alert-uid-123');
```

### Tickets

```typescript
// List tickets
const result = await client.tickets.list();
console.log(`Total tickets: ${result.totalCount}`);

// List with filters
const openTickets = await client.tickets.list({
  status: 'OPEN',
  priority: 'HIGH',
});

// Get a single ticket
const ticket = await client.tickets.get(789);

// Create a ticket
const newTicket = await client.tickets.create({
  subject: 'Server not responding',
  description: 'The file server is not responding to pings',
  priority: 'HIGH',
  organizationId: 123,
  deviceId: 456,
});

// Update a ticket
const updated = await client.tickets.update(789, {
  status: 'IN_PROGRESS',
  assigneeUid: 'tech-user-uid',
});

// Get ticket comments
const comments = await client.tickets.getComments(789);

// Add a comment
const comment = await client.tickets.addComment(789, {
  body: 'Working on this issue.',
  internal: false,
});

// List ticket forms
const forms = await client.tickets.listForms();
```

### Webhooks

```typescript
// List webhooks
const webhooks = await client.webhooks.list();

// Get a single webhook
const webhook = await client.webhooks.get(111);

// Create a webhook
const newWebhook = await client.webhooks.create({
  url: 'https://your-server.com/webhook',
  activityTypes: ['ALERT_TRIGGERED', 'ALERT_RESET', 'DEVICE_ADDED'],
  isActive: true,
});

// Update a webhook
const updated = await client.webhooks.update(111, {
  url: 'https://new-server.com/webhook',
});

// Delete a webhook
await client.webhooks.delete(111);
```

## Error Handling

The library provides specific error classes for different error conditions:

```typescript
import {
  NinjaOneError,
  NinjaOneAuthenticationError,
  NinjaOneForbiddenError,
  NinjaOneNotFoundError,
  NinjaOneValidationError,
  NinjaOneRateLimitError,
  NinjaOneServerError,
} from 'node-ninjaone';

try {
  const device = await client.devices.get(999);
} catch (error) {
  if (error instanceof NinjaOneNotFoundError) {
    console.log('Device not found');
  } else if (error instanceof NinjaOneAuthenticationError) {
    console.log('Authentication failed - check credentials');
  } else if (error instanceof NinjaOneRateLimitError) {
    console.log(`Rate limited - retry after ${error.retryAfter}ms`);
  } else if (error instanceof NinjaOneValidationError) {
    console.log('Validation errors:', error.errors);
  } else if (error instanceof NinjaOneError) {
    console.log(`API error: ${error.message} (${error.statusCode})`);
  }
}
```

## TypeScript Support

All types are exported for use in your TypeScript projects:

```typescript
import type {
  Organization,
  OrganizationCreateData,
  Device,
  DeviceStatus,
  DeviceNodeClass,
  Alert,
  AlertSeverity,
  Ticket,
  TicketStatus,
  TicketPriority,
  Webhook,
  WebhookActivityType,
} from 'node-ninjaone';
```

## Rate Limit Status

You can check the current rate limit status:

```typescript
const status = client.getRateLimitStatus();
console.log(`Remaining requests: ${status.remaining}`);
console.log(`Current rate: ${status.rate * 100}%`);
```

## License

Apache-2.0

## Author

Aaron Sachs
