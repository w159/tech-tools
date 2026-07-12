# Microsoft Graph API references - cipp-mailboxes

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Outlook mail API overview (inbox rules, MIME, mail tips) - https://learn.microsoft.com/graph/outlook-mail-concept-overview
2. message: forward (v1.0) - https://learn.microsoft.com/graph/api/message-forward?view=graph-rest-1.0
3. Use the Microsoft Search API to search Outlook messages - https://learn.microsoft.com/graph/search-concept-messages

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
