# Microsoft Graph API references - cipp-users

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. List users (v1.0) - https://learn.microsoft.com/graph/api/user-list?view=graph-rest-1.0
2. user resource type (properties, relationships) - https://learn.microsoft.com/graph/api/resources/user?view=graph-rest-1.0
3. Working with the authentication methods usage report API (MFA registration) - https://learn.microsoft.com/graph/api/resources/authenticationmethods-usage-insights-overview?view=graph-rest-1.0
4. userRegistrationDetails resource type - https://learn.microsoft.com/graph/api/resources/userregistrationdetails?view=graph-rest-1.0

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
