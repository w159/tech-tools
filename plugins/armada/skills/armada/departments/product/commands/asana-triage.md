---
description: Pull the user's assigned Asana tasks, flag overdue and blocked work, and output a prioritized day plan
---

# /asana-triage

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Triage the current user's Asana work into a ranked day plan. Run the `asana-my-tasks-triage` skill.

## Usage

```
/asana-triage
```

## How It Works

1. Resolve the workspace with `asana_list_workspaces`.
2. Pull assigned tasks via `asana_get_my_tasks` (and `asana_search_tasks` with assignee "me", completed false, for a broader sweep).
3. Resolve project names via `asana_get_project` / `asana_get_projects` and cache the mapping.
4. Check dependencies via `asana_get_task` to flag blocked tasks.
5. Bucket by urgency (Overdue, Today, This Week, Later) against today's date and group by project.

## Output

A day plan with Overdue, Due Today, Due This Week, Later, and Blocked sections, ending with the top 3 tasks to clear first.

## Rules

- Read-only. Do not call any Asana write tool.
- VISIBLE-TO-OTHERS: if the user asks to reassign, reschedule, or comment, restate the exact change and require explicit confirmation before `asana_update_task` or `asana_create_task_story`.
- Compute overdue and due-today against the actual current date. Never invent due dates, projects, or blocking relationships.
