---
name: asana-portfolio-rollup
description: Roll up status across multiple Asana projects into an executive summary with per-project completion percentage, at-risk items, and recent activity. Use when the user asks for a "portfolio rollup", "status across all my projects", or "an exec summary of where everything stands".
when_to_use: The user requests a portfolio rollup or status across multiple Asana projects; preparing an executive summary of cross-project health; aggregating completion, at-risk work, and recent activity for a leadership readout.
allowed-tools: Read, Glob, Grep, Bash, mcp__asana__*
---

# Asana Portfolio Rollup

Read-only cross-project status rollup. Aggregates completion, at-risk work, and recent activity across a set of Asana projects into a concise executive summary.

## Pipeline

1. Resolve the project set. If the user names a team or workspace, call `asana_get_projects_for_workspace` (or `asana_get_projects`) to list projects, then confirm which to include. If the user lists specific project names, resolve each with `asana_typeahead_search` (resource_type "project") to a gid.
2. Per project, pull counts. Call `asana_get_project_task_counts` for total, completed, and incomplete counts. Completion percent equals completed divided by total (guard against divide-by-zero; report "no tasks" when total is 0).
3. Per project, find at-risk work. Call `asana_search_tasks` scoped to the project with `completed` set to false, requesting opt-fields: name, due_on, assignee.name. Flag overdue tasks (due_on before today) and unassigned tasks as at-risk.
4. Per project, pull recent activity. For the most recently modified open tasks, call `asana_get_stories_for_task` to read recent comments and status changes. Summarize the latest meaningful update per project. Cache task and project name lookups; do not re-resolve a gid already known.
5. Aggregate into a portfolio view sorted by risk (most overdue or lowest completion first).

## Output

```markdown
## Portfolio Rollup: [date]
Projects: [N] | Overall completion: [%] | At-risk projects: [N]

### Per Project
| Project | Completion | Open | Overdue | At-risk items | Latest update |
|---------|-----------|------|---------|---------------|---------------|

### At Risk (attention needed)
- [project] reason (overdue tasks, stalled, unassigned)

### Recent Activity
- [project] latest story or status change summary
```

End with a 2-3 sentence executive readout: what is on track, what is slipping, and the single biggest risk.

## Rules and Guardrails

- Read-only skill. Do not call `asana_create_task`, `asana_update_task`, `asana_create_task_story`, or any other write tool.
- VISIBLE-TO-OTHERS: if the user asks to post this rollup as a project status update, that is a mutation visible to others. Stop and require explicit confirmation; status posting is owned by the asana-stakeholder-update skill.
- Compute completion and overdue against the actual current date and the real counts returned; never estimate a percentage.
- If a project returns zero tasks, report "no tasks" rather than 0% or 100%.
- Do not invent updates. If `asana_get_stories_for_task` returns no recent activity, say "no recent activity".
- Surface vendor errors (status plus message) for any project that fails to load, and continue with the projects that succeeded rather than aborting the whole rollup.
