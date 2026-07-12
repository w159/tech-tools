# Microsoft Graph API references - cipp-ops

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. CIPP documentation (GDAP, scheduled tasks, server health) - https://docs.cipp.dev
2. Granular Delegated Admin Privileges (GDAP) overview - Partner Center - https://learn.microsoft.com/en-us/partner-center/granular-delegate-admin-privileges
3. Microsoft Graph MCP Server for Enterprise overview (activity logs, appId filter) - https://learn.microsoft.com/graph/mcp-server/overview

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
