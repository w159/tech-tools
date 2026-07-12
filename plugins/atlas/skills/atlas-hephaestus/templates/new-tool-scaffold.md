# New capability recommendation scaffold

Use this scaffold when the discovery signals surface a need that the
existing capability catalog does not cover, and you want to propose a
new capability to the user. One scaffold per proposed capability. See
`references/tool-patterns.md` for the decision rule behind each field.

```yaml
id: <asset id, lowercase-kebab, e.g. "terraform-lint-skill">
name: <human-readable name>
kind: skill | plugin | mcp
signals: [<the discover_capabilities.py signals that triggered this, e.g. "terraform", "ci">]
reason: <one sentence: why this fits this project's stack>
install_command: <exact install command, or "manual drop to ~/.claude/skills/<id>/">
context_cost: <rough: "one SKILL.md body" | "bundled skills+agents+hooks" | "server process + tool schemas">
recommended: true | false
```

## Field rules

- `id` is a filesystem-safe slug (lowercase, only `a-z 0-9 - _`). No
  colon, slash, or space: the repo must stay checkout-able on Windows.
- `kind` must be exactly one of `skill`, `plugin`, `mcp`. If you are
  torn between skill and plugin, default to skill (the lighter kind)
  unless the capability needs bundled agents or hooks to work.
- `signals` lists the project signals that justify the recommendation.
  A recommendation with no matching signal is a guess; mark
  `recommended: false` and let the user decide.
- `reason` is one sentence. "Fits the terraform signal because it
  runs `tflint` on every plan" not "improves code quality."
- `install_command` is the exact command the user runs. If the
  capability is a manual drop, say so: the user needs to know it is
  not a one-liner.
- `context_cost` is rough and comparative. The point is to let the user
  weigh idle cost against value, not to produce an exact number.
- `recommended: true` only for the top entries. The shortlist is a
  multiSelect AskUserQuestion with recommended items first; everything
  else is `recommended: false` and presented unranked.

## Example

```yaml
id: terraform-lint-skill
name: Terraform lint
kind: skill
signals: ["terraform", "ci"]
reason: Fits the terraform signal because it runs tflint on every plan and surfaces the findings as file:line.
install_command: /plugin install terraform-lint@<marketplace>
context_cost: one SKILL.md body
recommended: true
```

## After the user picks

Install only what the user picks. After install, record the asset id
in `.claude/atlas.local.md` under `capabilities_installed` (if
accepted) or `capabilities_declined` (if skipped). Show the config
diff and confirm before writing. Never install silently.