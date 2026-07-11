---
name: asana-standup-generator
description: Generate a yesterday/today/blockers standup from recent Asana task activity, stories, and updates. Use when the user asks to "write my standup", "what did I do yesterday in Asana", or "draft a daily update from my tasks".
---

# Asana Standup Generator

Read-only standup builder. Reads recent task activity and stories to produce a yesterday / today / blockers summary for the current user.

## Pipeline

1. Resolve workspace and user. Call `asana_list_workspaces` to get the workspace gid. Treat the current user as "me" for assignee filters.
2. Pull recently active assigned tasks. Call `asana_search_tasks` with `assignee.any` set to "me", `modified_at.after` set to the start of yesterday (or the user's stated window), requesting opt-fields: name, completed, completed_at, due_on, modified_at, projects.name, memberships.section.name.
3. Split into done and in-progress:
   - Yesterday (done): tasks with completed true and completed_at within the window.
   - Today (in progress): tasks modified within the window that are still open, plus tasks due today from `asana_get_my_tasks`.
4. Read what changed. For the active tasks, call `asana_get_stories_for_task` to pull recent comments and status changes, and summarize the substantive ones (not system noise) into plain-language progress notes.
5. Detect blockers. For tasks exposing dependencies, call `asana_get_task` to check for incomplete blocking tasks; list those as blockers with the blocking task name.

## Output

```markdown
## Standup: [date]

### Yesterday
- [project] Completed: task name (short note from story)

### Today
- [project] Working on: task name (due [date] if set)

### Blockers
- [project] task name blocked by [blocking task name]
- (or) No blockers
```

Keep each line to one sentence. If there is no activity in the window, say so plainly rather than padding.

## Rules and Guardrails

- Read-only skill. Do not call `asana_create_task`, `asana_update_task`, or `asana_create_task_story`.
- VISIBLE-TO-OTHERS: if the user asks to post this standup as a comment on a task or as a project status, that is a mutation. Stop, restate the target and text, and require explicit confirmation before any write tool runs.
- Use the real modified_at and completed_at timestamps to bucket items; do not guess what was done yesterday.
- Summarize stories faithfully. Do not invent progress that the stories do not show.
- Filter out automated/system stories (assignment changes, due-date echoes) from the human-facing summary unless they are the only signal of progress.
- If the activity search returns an auth error, surface the vendor message and prompt re-authentication; do not emit an empty standup as if it were real.
