---
name: asana-api-patterns
description: Reference the Asana connector's gid model, name-to-gid resolution, search opt-fields and filters, pagination, and the read-versus-write tool split. Use when the user asks "how do Asana gids work", "which Asana tool resolves a project name", or "what opt-fields can asana_search_tasks return".
---

# Asana API Patterns

Reference skill for working with the Asana connector tools. Consult this before composing a multi-call Asana workflow so the other Asana skills resolve names correctly, request the right fields, and stay on the correct side of the read/write line.

## The gid and workspace model

- Every Asana object (workspace, project, section, task, user, story) is identified by a `gid`, an opaque string. Tools take and return gids, not names.
- Almost every list or search operation is scoped to a workspace. Resolve the workspace first with `asana_list_workspaces`. If exactly one is returned, use it; if more than one, ask the user to choose.
- Cache gid-to-name mappings within a run. Once you resolve a project or user gid to a name, do not call the API again for the same gid.

## Resolving names to gids

1. `asana_typeahead_search` is the primary name resolver. Pass the workspace gid, a `resource_type` (for example "project", "user", "task"), and the query string. It returns ranked matches with gids. Confirm the intended match with the user when the query is ambiguous.
2. For users specifically, `asana_get_workspace_users` lists everyone in the workspace and is useful for assignee resolution and capacity work.
3. For projects, `asana_get_projects`, `asana_get_projects_for_workspace`, and `asana_get_project` map and expand project gids.

## asana_search_tasks: opt-fields and filters

- `asana_search_tasks` is the workhorse read. It accepts filters and an `opt_fields` (or `opt-fields`) list controlling which fields come back. Request only what you need; unrequested fields return as bare gids or are omitted.
- Common useful opt-fields: `name`, `completed`, `completed_at`, `due_on`, `due_at`, `modified_at`, `assignee.name`, `projects.name`, `memberships.section.name`, `dependencies`, `custom_fields`.
- Common filters: `assignee.any` (use "me" for the current user), `completed` (true/false), `projects.any` (scope to a project gid), `modified_at.after` and `completed_at.after` (ISO timestamps for activity windows), `due_on.before` / `due_on.after`.
- `asana_get_my_tasks` is a convenience read for the current user's My Tasks list and is cheaper than a broad search when you only need assigned work.

## Pagination

- List and search responses can be paged. When a response indicates more results (a next-page token or offset), continue requesting until exhausted before aggregating, or the rollup will undercount.
- Prefer narrowing with filters (project scope, date windows) over fetching everything and filtering client-side.

## Read versus write tool split

Read tools (safe to call freely, no confirmation needed):

- `asana_list_workspaces`, `asana_search_tasks`, `asana_get_task`, `asana_get_tasks`, `asana_get_my_tasks`
- `asana_get_project`, `asana_get_projects`, `asana_get_projects_for_workspace`, `asana_get_project_sections`, `asana_get_project_task_counts`
- `asana_get_stories_for_task`, `asana_typeahead_search`, `asana_get_workspace_users`

Write tools (VISIBLE-TO-OTHERS, require explicit confirmation before calling):

- `asana_create_task` creates work others can see.
- `asana_update_task` changes a task (assignee, due date, section, fields) that watchers see.
- `asana_create_task_story` posts a comment or status others see.
- `asana_set_task_dependencies` changes blocking relationships others depend on.

## Rules and Guardrails

- VISIBLE-TO-OTHERS: never call `asana_create_task`, `asana_update_task`, `asana_create_task_story`, or `asana_set_task_dependencies` without first restating the exact change and getting explicit user confirmation. After a confirmed write, read the object back and report its gid and new state.
- Resolve gids before acting; never pass a human-readable name where a gid is required.
- When a tool returns an error, surface the vendor HTTP status and message plus a remediation hint (re-authenticate the connector, pick a valid workspace, supply a real gid). Do not swallow errors.
