---
name: asana-sprint-planning
description: Read an Asana project's sections, tasks, and task counts, assess open work against capacity, and propose a sprint or iteration plan, creating tasks only after explicit confirmation. Use when the user asks to "plan a sprint in Asana", "fill the next iteration", or "what can the team commit to this sprint".
when_to_use: Planning a sprint or iteration directly inside an Asana project; filling the next iteration from Asana backlog and sections; assessing what the team can commit to against stated capacity; proposing new Asana tasks for explicit confirmation.
allowed-tools: Read, Glob, Grep, Bash, mcp__asana__*
---

# Asana Sprint Planning

Build a sprint or iteration plan from a live Asana project. Reads the board structure and open work, weighs it against stated capacity, and proposes a committed set plus a stretch set. Any task creation is gated behind explicit user confirmation.

## Pipeline

1. Resolve the project. If the user gives a project name, call `asana_typeahead_search` with resource_type "project" to map the name to a gid. Confirm the match before proceeding. If given a gid, use it directly.
2. Read structure. Call `asana_get_project` for project metadata and `asana_get_project_sections` to list sections (for example Backlog, To Do, In Progress, Done).
3. Read counts. Call `asana_get_project_task_counts` to get total, completed, and incomplete task counts for the project.
4. Read open work. Call `asana_search_tasks` scoped to the project with `completed` set to false, requesting opt-fields: name, due_on, assignee.name, memberships.section.name, dependencies, custom_fields. Page through results if more than one page is returned.
5. Resolve assignees and capacity. Call `asana_get_workspace_users` to list available people. Ask the user for sprint length and per-person availability (PTO, on-call, meetings) if not provided. Do not assume a velocity number; ask for it or derive it only from explicit user input.
6. Assess and propose. Map open tasks to sections, flag tasks with incomplete dependencies as not-ready, and split the proposal into a committed set (fits capacity, no blockers) and a stretch set.

## Output

```markdown
## Sprint Proposal: [project name]
Sprint: [start] to [end] | Capacity: [stated] | Open tasks: [N] | Blocked: [N]

### Committed
| Task | Section | Assignee | Due | Notes |
|------|---------|----------|-----|-------|

### Stretch
| Task | Section | Assignee | Notes |
|------|---------|----------|-------|

### Not Ready (blocked or unassigned)
- Task name (blocked by: [dependency] / no assignee)

### Proposed New Tasks (NOT yet created)
- Task name, assignee, due date, target section
```

## Rules and Guardrails

- Reads are unrestricted. Writes are not.
- VISIBLE-TO-OTHERS: `asana_create_task` creates work that teammates and watchers can see. Never call it from the proposal step. Present the "Proposed New Tasks" list, then require an explicit "yes, create these" from the user before calling `asana_create_task` for each item.
- VISIBLE-TO-OTHERS: `asana_update_task` (moving a task into a sprint section, changing assignee or due date) and `asana_set_task_dependencies` are mutations visible to others. Restate the exact change and require explicit confirmation before calling either.
- After any confirmed create or update, read the result back (`asana_get_task`) and report the new gid and state; do not claim success without the read-back.
- Do not fabricate capacity, velocity, or section names. Ask when the input is missing.
- If a write fails, surface the vendor HTTP status and message and stop; do not retry blindly or continue creating remaining tasks.
