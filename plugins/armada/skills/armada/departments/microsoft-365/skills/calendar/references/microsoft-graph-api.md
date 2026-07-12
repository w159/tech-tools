# Microsoft Graph API references - calendar

Version-correct Microsoft Learn sources for the Graph / Entra / Exchange Online APIs referenced in this skill. Pulled via the microsoft-docs MCP during skill authoring (Law 4).

## Citations

1. Working with calendars and events using the Microsoft Graph API - https://learn.microsoft.com/graph/api/resources/calendar-overview?view=graph-rest-1.0
2. user: findMeetingTimes (v1.0) - https://learn.microsoft.com/graph/api/user-findmeetingtimes?view=graph-rest-1.0
3. Get free/busy schedule of Outlook calendar users and resources (getSchedule) - https://learn.microsoft.com/graph/outlook-get-free-busy-schedule
4. Outlook calendar API overview - https://learn.microsoft.com/graph/outlook-calendar-concept-overview
5. calendar resource type (methods) - https://learn.microsoft.com/graph/api/resources/calendar?view=graph-rest-1.0

## Notes

- Microsoft Graph v1.0 is the production endpoint; beta is preview and may change.
- All Graph calls require a Bearer token from Microsoft Entra with the correct delegated or application permissions (see permissions reference above).
- Honor `Retry-After` on 429 responses; use `$select` and delta queries to reduce throttle pressure.
- CIPP wraps Graph calls for multi-tenant MSP workflows; CIPP's own docs live at https://docs.cipp.dev.
