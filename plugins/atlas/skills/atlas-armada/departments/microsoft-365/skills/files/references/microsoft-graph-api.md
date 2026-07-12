# Microsoft Graph API references - files

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Working with files in Microsoft Graph (OneDrive, SharePoint, DriveItem) - https://learn.microsoft.com/graph/api/resources/onedrive?view=graph-rest-1.0
2. List sharing permissions on a driveItem - https://learn.microsoft.com/graph/api/driveitem-list-permissions?view=graph-rest-1.0
3. Microsoft Graph permissions reference (Files.Read, Files.Read.All, Sites.Read.All) - https://learn.microsoft.com/graph/permissions-reference

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
