# Connectors

## How tool references work

Plugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~data warehouse` might mean Snowflake, BigQuery, or any other warehouse with an MCP server.

Plugins are **tool-agnostic** - they describe workflows in terms of categories (data warehouse, chat, project tracker, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.

## Connectors for this plugin

| Category | Placeholder | Included servers | Env var(s) | Other options |
|----------|-------------|-----------------|------------|---------------|
| Cloud marketplace | `~~cloud marketplace` | Pax8 | `PAX8_MCP_TOKEN` | - |
| Document automation | `~~documents` | PandaDoc | `PANDADOC_API_KEY` | - |
| Data warehouse | `~~data warehouse` | Snowflake\*, Databricks\*, BigQuery | - | Redshift, PostgreSQL |
| Email | `~~email` | Microsoft 365 | - | - |
| Office suite | `~~office suite` | Microsoft 365 | - | - |
| Chat | `~~chat` | Slack | - | Microsoft Teams |
| ERP / Accounting | `~~erp` | - (no supported MCP servers yet) | - | NetSuite, SAP, QuickBooks, Xero |
| Analytics / BI | `~~analytics` | - (no supported MCP servers yet) | - | Tableau, Looker, Power BI |

\* Placeholder -- MCP URL not yet configured

### Wired connector details

**Pax8** (`PAX8_MCP_TOKEN`): Token from app.pax8.com -> Integrations -> MCP. Connects to the Pax8 hosted MCP server at `https://mcp.pax8.com/v1/mcp` via the `x-pax8-mcp-token` header. No base URL override is needed.

**PandaDoc** (`PANDADOC_API_KEY`): API key from app.pandadoc.com -> Settings -> Integrations -> API. Connects to the PandaDoc hosted MCP server at `https://developers.pandadoc.com/mcp` via the `Authorization: API-Key` header. No base URL override is needed.
