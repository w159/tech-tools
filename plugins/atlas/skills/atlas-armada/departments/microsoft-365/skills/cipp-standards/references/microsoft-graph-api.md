# Microsoft Graph API references - cipp-standards

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. secureScore resource type (per-day tenant secure score) - https://learn.microsoft.com/graph/api/resources/securescore?view=graph-rest-1.0
2. List secureScores (v1.0) - https://learn.microsoft.com/graph/api/security-list-securescores?view=graph-rest-1.0
3. Microsoft Secure Score (Defender XDR) - https://learn.microsoft.com/en-us/defender-xdr/microsoft-secure-score

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
