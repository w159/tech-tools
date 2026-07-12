# Task Master AI - gotchas

Task Master (`task-master` CLI, or the `task-master-ai` MCP server) manages tasks in
`.taskmaster/`. Full command list: `task-master --help`.

## Prohibitions and gotchas

- **DO NOT RE-INITIALIZE** a project. `task-master init` only re-adds the same core
  files; it does not reset or recover tasks.
- **Never manually edit** `.taskmaster/tasks/tasks.json` or `.taskmaster/config.json`.
  Use `task-master` commands (`task-master models` for config; `add-task` /
  `update-task` / `update-subtask` for tasks).
- Task markdown files in `.taskmaster/tasks/` are **auto-generated**. After any
  manual change to `tasks.json`, run `task-master generate` to resync them.

## Slow operations (make AI calls, may take up to a minute)

`parse-prd`, `analyze-complexity`, `expand` / `expand --all`, `add-task`, `update`,
`update-task`, `update-subtask` - these call a model and are slow; budget for it.