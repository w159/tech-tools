# Microsoft Graph API references - teams

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. List members of a channel (v1.0) - https://learn.microsoft.com/graph/api/channel-list-members?view=graph-rest-1.0
2. List allMembers (v1.0) - direct + indirect members, shared channels - https://learn.microsoft.com/graph/api/channel-list-allmembers?view=graph-rest-1.0
3. Managing channel memberships (Microsoft Teams APIs) - https://learn.microsoft.com/graph/manage-channel-memberships
4. Microsoft Graph overview for Teams - https://learn.microsoft.com/graph/teams-concept-overview

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
