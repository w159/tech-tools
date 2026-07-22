# Skill Routing

Maps user-described tasks and goals to the right atlas skill. atlas-setup uses
this when the user describes what they want to do and it needs to decide
which skill to activate.

## Task-to-skill routing table

| User says | Skill | Why |
|---|---|---|
| "audit my code" / "security scan" / "OWASP" | atlas-audit (code mode) | Comprehensive security and quality audit |
| "map the architecture" / "find duplication" / "unify systems" | atlas-audit (architecture mode) | Architecture mapping and structural dedup |
| "how are my runs doing" / "metrics" / "context cost" / "session forensics" | atlas-audit (self mode) | Atlas run health and self-improvement |
| "build a feature" / "fix a bug" / "refactor" / "debug" | atlas-orchestrate | Multi-step orchestration with subagents |
| "boot this project" / "set up atlas" / "configure tooling" | atlas-setup (install mode) | Project bootstrap and configuration |
| "set up connectors" / "configure vendor" / "enable NinjaOne/etc" | atlas-setup (connectors mode) | Vendor MCP connector setup |
| "atlas is broken" / "subagents not launching" | atlas-setup (repair mode) | Plugin install repair |
| "run something repeatedly" / "poll" / "iterate until" / "sweep a backlog" | atlas-loop | Recurring/iterative loop library |
| "test my UI" / "UX test" / "persona test" / "pre-release sweep" | atlas-ux-test | UX test swarm |
| "set up my org" / "configure departments" / "brand enforcement" | armada plugin (separate install) | Organizational deployment layer |
| "set up my workspace" / "what should I run" / "analyze my project" | atlas-setup (onboard mode) | Scaffold and recommend |

## Routing logic

When the user describes a task:

1. **Match keywords** against the routing table above.
2. **If exactly one skill matches with high confidence**: activate it directly.
3. **If two or more skills could handle it**: present the candidates as an
   AskUserQuestion (one round, recommendation first, each with a one-line
   reason).
4. **If no skill matches**: present the menu below and ask the user to pick.

## Ambiguous cases

| Task | Candidate skills | Default recommendation |
|---|---|---|
| "improve my code" | atlas-audit (code or architecture mode), atlas-orchestrate (orchestrate fixes) | atlas-audit first (find what needs improving), then atlas-orchestrate to fix |
| "make my app better" | atlas-audit (code mode), atlas-ux-test (UX test) | atlas-audit first (broadest), then follow its recommendations |
| "automate a task" | atlas-loop (loop), atlas-orchestrate (orchestrate) | atlas-loop if the task is recurring; atlas-orchestrate if it is a one-time build |

## Menu mode

When the user asks "what can you do?" or "menu", atlas-setup presents the
fleet:

```
The atlas fleet:

 1. atlas-orchestrate  -- Orchestrate multi-step build/fix/audit/refactor
 2. atlas-audit        -- Code/security audit, architecture map, self telemetry
 3. atlas-setup        -- Onboard, install, connectors, repair (this skill)
 4. atlas-loop         -- Recurring/iterative task loops
 5. atlas-ux-test      -- UX test swarm on any web app
 6. Task skills        -- atlas-feature, atlas-debug, atlas-refactor,
                          atlas-frontend, atlas-component, atlas-db-audit,
                          atlas-gitignore, atlas-handoff, atlas-harden,
                          atlas-launch, atlas-prompt,
                          atlas-readme, atlas-validate,
                          atlas-wiki

Org deployment lives in the separate armada plugin.

Tell me what you'd like to work on, or pick a number.
```

## Blind activation

Each skill can also be invoked "blindly" -- with no specific task -- and it
will determine what to do based on context:

- **atlas-orchestrate** with no task: runs the decision gate (is this multi-stage?) and
  if not, asks the user for a task.
- **atlas-audit** with no task: runs zero-arg discovery (builds the knowledge
  graph, asks for audit depth); self mode with no task runs the trends report.
- **atlas-setup** with no task: onboard/recommend, per its mode routing.
- **atlas-loop** with no task: lists the loop library grouped by category.
- **atlas-ux-test** with no task: runs phase 0 discovery on the app.

This means the user can invoke any skill with no arguments and it will figure
out what to do, give menu options if it is not sure, or ask the user what they
would like to work on and then make suggestions or automatically kick off
whatever skill would accomplish their goals.
