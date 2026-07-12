# Microsoft Graph API references - cipp-alerts

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Microsoft Entra audit logs API overview (directoryAudits, signIn) - https://learn.microsoft.com/graph/api/resources/azure-ad-auditlog-overview?view=graph-rest-1.0
2. List directoryAudits (v1.0) - https://learn.microsoft.com/graph/api/directoryaudit-list?view=graph-rest-1.0
3. signIn resource type - https://learn.microsoft.com/graph/api/resources/signin?view=graph-rest-1.0
4. How to analyze activity logs with Microsoft Graph - https://learn.microsoft.com/entra/identity/monitoring-health/howto-analyze-activity-logs-with-microsoft-graph

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
