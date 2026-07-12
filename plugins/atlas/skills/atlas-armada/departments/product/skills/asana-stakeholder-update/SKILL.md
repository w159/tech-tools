---
name: asana-stakeholder-update
description: Compose a stakeholder-ready status narrative from live Asana project data, drafting an update for review and posting it only after explicit confirmation. Use when the user asks to "write a stakeholder update", "draft a status update for leadership", or "post a project status in Asana".
when_to_use: Drafting a stakeholder status narrative from live Asana project data; preparing a leadership status update grounded in Asana counts and stories; posting a project status update back to Asana after explicit user confirmation.
allowed-tools: Read, Glob, Grep, Bash, mcp__asana__*
---

# Asana Stakeholder Update

Compose a clear, non-jargon status narrative for stakeholders from live Asana project data. The narrative is a draft by default. Posting it back to Asana is a confirmation-gated, visible-to-others write.

## Pipeline

1. Resolve the project. Map a project name to a gid via `asana_typeahead_search` (resource_type "project"), or use a supplied gid. Confirm the match.
2. Pull the facts. Call `asana_get_project` for metadata, `asana_get_project_task_counts` for completion, and `asana_get_project_sections` for board shape.
3. Pull progress and risks. Call `asana_search_tasks` scoped to the project with `completed` set to false (opt-fields: name, due_on, assignee.name, dependencies) to find overdue, blocked, and unassigned work. Call `asana_search_tasks` with `completed` set to true and a recent `completed_at.after` window to find recent wins.
4. Pull recent narrative. Call `asana_get_stories_for_task` on the highest-signal tasks to ground the "what changed" section in real comments and status changes.
5. Draft the narrative. Write a stakeholder update: headline status, key accomplishments, what is next, risks and asks. Plain language, no internal jargon, no fabricated metrics.

## Output

```markdown
## Stakeholder Update: [project name] ([date])
Status: [On track / At risk / Off track] | Completion: [%]

### Summary
[2-3 sentence plain-language readout]

### Recent Wins
- [completed item, stated as outcome]

### In Progress / Next
- [what the team is moving on next]

### Risks and Asks
- [risk or decision needed, with the ask]
```

After presenting the draft, ask whether to post it to Asana.

## Rules and Guardrails

- Composing the draft is read-only and always safe to run.
- VISIBLE-TO-OTHERS: posting the update writes content others see. Do NOT post until the user explicitly confirms. Posting maps to a write tool: a project status comment via `asana_create_task_story` on the relevant task, or `asana_update_task` to update a status field. Before calling either, restate the exact text and target gid and require an explicit "yes, post it".
- After a confirmed post, read it back (`asana_get_task` or `asana_get_stories_for_task`) and report the resulting gid; never claim it posted without the read-back.
- Status (On track / At risk / Off track) must follow from the real counts and overdue/blocked findings, not optimism. Do not invent metrics, dates, or wins.
- If the post fails, surface the vendor HTTP status and message and stop.
- Keep the draft free of straight-internal jargon and acronyms a stakeholder would not recognize.
