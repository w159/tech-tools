---
name: asana-my-tasks-triage
description: Pull the user's assigned Asana tasks, group them by due-date urgency and project, flag overdue and blocked work, and output a prioritized day plan. Use when the user asks "what should I work on today", "triage my Asana tasks", or "what's overdue and blocking me".
---

# Asana My Tasks Triage

Read-only triage of the current user's assigned work in Asana. Produces a ranked day plan grouped by urgency and project, with overdue and blocked items called out first.

## Pipeline

1. Resolve the workspace. Call `asana_list_workspaces` and use the single workspace, or ask the user to pick if more than one is returned. Capture the workspace gid.
2. Pull assigned tasks. Call `asana_get_my_tasks` for the resolved workspace to get the user's My Tasks list. If a broader sweep is needed (tasks assigned but not in My Tasks), also call `asana_search_tasks` with `assignee.any` set to "me" and `completed` set to false, requesting opt-fields: name, due_on, due_at, completed, projects.name, assignee.name, dependencies, memberships.section.name.
3. Resolve project names. For task project gids that are not already named in the response, call `asana_get_project` per distinct project gid (or `asana_get_projects` for a batch) to map gid to project name. Cache the mapping; do not re-resolve a gid you already have.
4. Detect blocked tasks. For tasks that expose dependencies, call `asana_get_task` to read the `dependencies` field and resolve whether each blocking task is still incomplete. A task is blocked when it has one or more incomplete dependencies.
5. Bucket by urgency using today's date:
   - Overdue: due_on before today and not completed.
   - Today: due_on equals today.
   - This week: due_on within the next 7 days.
   - Later / no due date: everything else.
6. Within each bucket, group by project name and sort overdue-first, then by due date ascending.

## Output

```markdown
## Day Plan: [date]
Workspace: [name] | Assigned open tasks: [N] | Overdue: [N] | Blocked: [N]

### Overdue (do first)
- [project] Task name (due [date]) [BLOCKED by: dependency task name]

### Due Today
- [project] Task name (due today)

### Due This Week
- [project] Task name (due [date])

### Later / No Due Date
- [project] Task name

### Blocked (waiting on others)
- [project] Task name (blocked by: [blocking task name])
```

End with a one-line recommended focus: the top 3 tasks to clear first and why.

## Rules and Guardrails

- Read-only skill. Do not call any write tool. `asana_create_task`, `asana_update_task`, and `asana_create_task_story` are out of scope here.
- VISIBLE-TO-OTHERS: if the user later asks to reassign, reschedule, or comment on a task, that is a mutation. Stop, restate the exact change, and require explicit confirmation before calling `asana_update_task` or `asana_create_task_story`.
- Never invent due dates, project names, or blocking relationships. If a field is missing from the API response, say "no due date" or "unknown project", do not guess.
- Compute overdue and due-today against the actual current date, not a remembered one.
- If `asana_get_my_tasks` returns an auth or permission error, surface the vendor message and tell the user to re-authenticate the Asana connector; do not silently fall back to empty results.
