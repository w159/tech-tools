# Microsoft Graph API references - cipp-groups

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Manage groups in Microsoft Graph (overview, use cases, Entra roles) - https://learn.microsoft.com/graph/api/resources/groups-overview?view=graph-rest-1.0
2. List groups (v1.0) - https://learn.microsoft.com/graph/api/group-list?view=graph-rest-1.0
3. Add members (POST /groups/{id}/members/$ref, PATCH /groups/{id}) - https://learn.microsoft.com/graph/api/group-post-members?view=graph-rest-1.0
4. List group members (v1.0) - https://learn.microsoft.com/graph/api/group-list-members?view=graph-rest-1.0

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
