# QuickBooks Online Plugin

Claude Code plugin for the QuickBooks Online (Intuit) accounting platform integration.

## Overview

This plugin provides Claude with deep knowledge of QuickBooks Online, enabling:

- **Customer Management** - Search, create, and manage MSP client records
- **Invoice Management** - Create and track invoices for managed services
- **Payment Tracking** - Record and reconcile client payments
- **Expense Management** - Track purchases and per-client costs
- **Financial Reporting** - Generate P&L, Balance Sheet, A/R Aging, and other reports

> **Note:** Intuit publishes an official `quickbooks-online-mcp-server` (early preview, sandbox only). This plugin complements that server by providing MSP-specific skills, commands, and accounting workflows on top of the QuickBooks Online v3 API.

## Prerequisites

### API Credentials

You need OAuth2 credentials from the Intuit Developer Portal:

1. Go to [developer.intuit.com](https://developer.intuit.com) and sign in
2. Navigate to **My Apps** and click **Create an app**
3. Select **QuickBooks Online and Payments**
4. Copy the **Client ID** and **Client Secret** from the Keys & credentials tab
5. Set your Redirect URI (e.g., `http://localhost:3000/callback`)
6. Complete the OAuth2 authorization flow to obtain access and refresh tokens
7. Note your **Realm ID** (Company ID) from the URL after connecting

### OAuth2 Token Management

QuickBooks Online uses OAuth2 with short-lived access tokens:

| Token | Lifetime | Notes |
|-------|----------|-------|
| Access Token | 60 minutes | Must be refreshed before expiry |
| Refresh Token | 100 days | Use to obtain new access tokens |

Use the official `intuit-oauth` npm package or `node-quickbooks` SDK to handle token refresh automatically.

### Environment Variables

Set the following environment variables:

```bash
export QBO_CLIENT_ID="your-client-id"
export QBO_CLIENT_SECRET="your-client-secret"
export QBO_REALM_ID="your-company-id"
export QBO_ACCESS_TOKEN="your-access-token"
export QBO_REFRESH_TOKEN="your-refresh-token"
export QBO_ENVIRONMENT="production"  # or "sandbox"
```

## Installation

1. Clone this plugin to your Claude plugins directory
2. Configure environment variables
3. For automated token refresh, install the SDK: `npm install node-quickbooks`

## Available Skills

| Skill | Description |
|-------|-------------|
| `api-patterns` | QuickBooks Online API patterns, OAuth2, query language, and best practices |
| `customers` | Customer (client) management for MSP accounts |
| `invoices` | Invoice creation and management for managed services |
| `expenses` | Purchase and expense tracking per client |
| `payments` | Payment recording, application, and reconciliation |
| `reports` | Financial reports -- P&L, Balance Sheet, A/R Aging, and more |

## Available Commands

| Command | Description |
|---------|-------------|
| `/create-invoice` | Create an invoice for a client's managed services |
| `/search-customers` | Find a customer by name or other criteria |
| `/get-balance` | View outstanding balances across all MSP clients |
| `/expense-summary` | Summarize expenses by client, vendor, or date range |

## Quick Start

### Search for a Customer

```
/search-customers "Acme"
```

### Create an Invoice

```
/create-invoice --customer "Acme Corp" --line "Monthly IT Services" --amount 2500
```

### Get Outstanding Balances

```
/get-balance
```

### View Expense Summary

```
/expense-summary --from 2026-01-01 --to 2026-01-31
```

## Security Considerations

### Token Security

- Never commit OAuth tokens or client secrets to version control
- Use environment variables or a secure vault for all credentials
- Implement automatic token refresh to avoid manual re-authorization
- Rotate client secrets periodically via the Intuit Developer Portal
- Access tokens expire after 60 minutes; always use refresh tokens

### API Permissions

- OAuth scopes control what your app can access (e.g., `com.intuit.quickbooks.accounting`)
- Use the minimum required scopes for your workflows
- Review connected apps regularly in the Intuit Developer Portal

## API Rate Limits

QuickBooks Online enforces the following rate limits:

| Metric | Limit |
|--------|-------|
| Requests per minute | 500 |
| Concurrent requests | 40 |
| Requests per second per user | 10 |

The plugin handles rate limiting with exponential backoff. If you hit limits, reduce request frequency and batch operations where possible.

## Troubleshooting

### Authentication Errors

If you see "AuthenticationFailed" or 401 errors:
1. Verify `QBO_ACCESS_TOKEN` is current (tokens expire after 60 minutes)
2. Use the refresh token to obtain a new access token
3. Confirm `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET` are correct
4. Check that OAuth scopes include `com.intuit.quickbooks.accounting`

### Invalid Realm ID

If you see "Invalid Company ID" or entity-not-found errors:
1. Verify `QBO_REALM_ID` matches your QuickBooks company
2. The Realm ID is the numeric ID shown in the QBO URL after login
3. Ensure the OAuth token was issued for this specific company

### Rate Limiting

If you see 429 or "ThrottleExceeded" errors:
1. Wait at least 60 seconds before retrying
2. Reduce request frequency to stay under 500/minute
3. Batch queries using the Intuit query language instead of individual lookups

### Sandbox vs Production

If data looks wrong or requests fail unexpectedly:
1. Check `QBO_ENVIRONMENT` -- ensure you are hitting the correct base URL
2. Sandbox: `https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/`
3. Production: `https://quickbooks.api.intuit.com/v3/company/{realmId}/`

## API Documentation

- [QuickBooks Online API Reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account)
- [Intuit OAuth2 Documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization)
- [Intuit Developer Portal](https://developer.intuit.com)
- [node-quickbooks SDK](https://www.npmjs.com/package/node-quickbooks)
- [intuit-oauth SDK](https://www.npmjs.com/package/intuit-oauth)
- [QuickBooks Online MCP Server (early preview)](https://github.com/anthropics/quickbooks-online-mcp-server)

## Contributing

See the main [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

All contributions require a PRD in the `prd/` directory before implementation.

## Changelog

### 0.1.0 (2026-02-23)

- Initial release
- 6 skills: api-patterns, customers, invoices, expenses, payments, reports
- 4 commands: create-invoice, search-customers, get-balance, expense-summary
