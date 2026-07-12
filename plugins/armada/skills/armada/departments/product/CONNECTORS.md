# Connectors

## How tool references work

Plugin files use `~~category` as a placeholder for whatever tool the user connects in that category. For example, `~~project tracker` might mean Linear, Asana, Jira, or any other tracker with an MCP server.

Plugins are **tool-agnostic** - they describe workflows in terms of categories (project tracker, design, product analytics, etc.) rather than specific products. The `.mcp.json` pre-configures specific MCP servers, but any MCP server in that category works.

## Connectors for this plugin

| Category | Placeholder | Included servers | Other options |
|----------|-------------|-----------------|---------------|
| Calendar | `~~calendar` | Google Calendar | Microsoft 365 |
| Chat | `~~chat` | (none preconfigured) | Slack, Microsoft Teams |
| Competitive intelligence | `~~competitive intelligence` | (none preconfigured) | Similarweb, Crayon, Klue |
| Design | `~~design` | (none preconfigured) | Figma, Sketch, Adobe XD |
| Email | `~~email` | Gmail | Microsoft 365 |
| Knowledge base | `~~knowledge base` | (none preconfigured) | Notion, Confluence, Guru, Coda |
| Meeting transcription | `~~meeting transcription` | Fireflies | Gong, Dovetail, Otter.ai |
| Product analytics | `~~product analytics` | (none preconfigured) | Amplitude, Pendo, Mixpanel, Heap, FullStory |
| Project tracker | `~~project tracker` | Asana, ClickUp | Linear, monday.com, Atlassian (Jira/Confluence), Shortcut, Basecamp |
| User feedback | `~~user feedback` | (none preconfigured) | Intercom, Productboard, Canny, UserVoice |
