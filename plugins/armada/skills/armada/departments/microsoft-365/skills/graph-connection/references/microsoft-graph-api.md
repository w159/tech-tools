# Microsoft Graph API references - graph-connection

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Overview of Microsoft MCP Server for Enterprise (preview) - https://learn.microsoft.com/graph/mcp-server/overview
2. Register an application in Microsoft Entra ID (quickstart) - https://learn.microsoft.com/entra/identity-platform/quickstart-register-app
3. Convert single-tenant app to multitenant on Microsoft Entra ID (admin consent) - https://learn.microsoft.com/entra/identity-platform/howto-convert-app-to-be-multi-tenant
4. Grant tenant-wide admin consent to an application (portal) - https://learn.microsoft.com/entra/identity/enterprise-apps/grant-admin-consent
5. Developer's guide to requesting permissions and consent (admin consent for multitenant) - https://learn.microsoft.com/entra/identity-platform/consent-types-developer
6. Microsoft Graph throttling limits (MCP server 100 calls/min/user) - https://learn.microsoft.com/graph/throttling-limits

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
