# Microsoft Graph API references - graph-querying

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Overview of Microsoft MCP Server for Enterprise (RAG workflow, tools) - https://learn.microsoft.com/graph/mcp-server/overview
2. Sample prompts for Microsoft MCP Server for Enterprise - https://learn.microsoft.com/graph/mcp-server/mcp-server-sample-prompts
3. Microsoft Graph permissions reference (RBAC, scopes) - https://learn.microsoft.com/graph/permissions-reference
4. Customize Microsoft Graph responses with query parameters ($select, $filter, $count) - https://learn.microsoft.com/graph/query-parameters
5. Advanced query capabilities on directory objects (ConsistencyLevel: eventual) - https://learn.microsoft.com/graph/aad-advanced-queries

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
