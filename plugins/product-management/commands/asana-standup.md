---
description: Generate a yesterday/today/blockers standup from recent Asana task activity and stories for the current user
---

# /asana-standup

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Build a daily standup from live Asana activity. Run the `asana-standup-generator` skill.

## Usage

```
/asana-standup [optional time window, e.g. "since Friday"]
```

## How It Works

1. Resolve the workspace with `asana_list_workspaces`.
2. Pull recently active assigned tasks via `asana_search_tasks` (assignee "me", `modified_at.after` set to the window) and `asana_get_my_tasks`.
3. Split into Yesterday (completed in window) and Today (open, modified in window or due today).
4. Read `asana_get_stories_for_task` for substantive progress notes and check dependencies for blockers via `asana_get_task`.
5. Emit a Yesterday / Today / Blockers standup.

## Output

A markdown standup with Yesterday, Today, and Blockers sections, one sentence per line, grounded in real timestamps and stories.

## Rules

- Read-only. Do not call any Asana write tool.
- VISIBLE-TO-OTHERS: if the user asks to post the standup as a comment or status, restate the target and text and require explicit confirmation before any write (`asana_create_task_story` / `asana_update_task`).
- Use real `modified_at` and `completed_at` values to bucket items; do not guess. If there is no activity in the window, say so.
