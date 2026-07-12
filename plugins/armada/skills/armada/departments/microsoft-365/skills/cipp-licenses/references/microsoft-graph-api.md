# Microsoft Graph API references - cipp-licenses

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Set-MgUserLicense (assign/remove licenses, subscribedSkus reference) - https://learn.microsoft.com/powershell/module/microsoft.graph.users.actions/set-mguserlicense?view=graph-powershell-1.0
2. assignedLicense resource type (disabledPlans, skuId) - https://learn.microsoft.com/graph/api/resources/assignedlicense?view=graph-rest-1.0
3. user: assignLicense (POST /users/{id}/assignLicense) - https://learn.microsoft.com/graph/api/user-assignlicense?view=graph-rest-1.0
4. Microsoft Graph permissions reference (LicenseAssignment.ReadWrite.All) - https://learn.microsoft.com/graph/permissions-reference

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
