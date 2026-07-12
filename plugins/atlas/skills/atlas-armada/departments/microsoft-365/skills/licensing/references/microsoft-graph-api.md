# Microsoft Graph API references - licensing

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Set-MgUserLicense (assign/remove licenses, subscribedSkus, disabledPlans) - https://learn.microsoft.com/powershell/module/microsoft.graph.users.actions/set-mguserlicense?view=graph-powershell-1.0
2. Microsoft Graph permissions reference (LicenseAssignment.ReadWrite.All, User.ReadWrite.All) - https://learn.microsoft.com/graph/permissions-reference
3. List users (v1.0) - license assignment queries - https://learn.microsoft.com/graph/api/user-list?view=graph-rest-1.0

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
