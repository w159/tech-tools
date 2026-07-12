# Microsoft Graph API references - cipp-security

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. List namedLocations (v1.0) - conditional access - https://learn.microsoft.com/graph/api/conditionalaccessroot-list-namedlocations?view=graph-rest-1.0
2. conditionalAccessPolicy resource type - https://learn.microsoft.com/graph/api/resources/conditionalaccesspolicy?view=graph-rest-1.0
3. countryNamedLocation resource type - https://learn.microsoft.com/graph/api/resources/countrynamedlocation?view=graph-rest-1.0

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
