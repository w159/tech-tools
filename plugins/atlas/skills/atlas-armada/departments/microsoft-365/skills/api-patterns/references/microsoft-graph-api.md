# Microsoft Graph API references - api-patterns

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Microsoft Graph query parameters ($select/$filter/$count/$search/$top/$skip/$expand/$orderby) - https://learn.microsoft.com/graph/query-parameters
2. Microsoft Graph $filter query parameter - https://learn.microsoft.com/graph/filter-query-parameter
3. Microsoft Graph $search query parameter - https://learn.microsoft.com/graph/search-query-parameter
4. Microsoft Graph throttling guidance (429, Retry-After) - https://learn.microsoft.com/graph/throttling
5. Microsoft Graph service-specific throttling limits - https://learn.microsoft.com/graph/throttling-limits
6. Microsoft Graph JSON batching ($batch, 20-request limit, dependsOn) - https://learn.microsoft.com/graph/json-batching
7. Microsoft Graph delta query overview (incremental sync) - https://learn.microsoft.com/graph/delta-query-overview
8. Microsoft Graph authentication and authorization overview - https://learn.microsoft.com/graph/auth/auth-concepts
9. Microsoft Graph permissions reference - https://learn.microsoft.com/graph/permissions-reference

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
