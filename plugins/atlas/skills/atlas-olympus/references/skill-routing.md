# Skill Routing

Maps user-described tasks and goals to the right atlas skill. Olympus uses
this when the user describes what they want to do and Olympus needs to decide
which skill to activate.

## Task-to-skill routing table

| User says | Skill | Why |
|---|---|---|
| "audit my code" / "security scan" / "OWASP" | atlas-athena | Comprehensive security and quality audit |
| "map the architecture" / "find duplication" / "unify systems" | atlas-ariadne | Architecture mapping and structural dedup |
| "build a feature" / "fix a bug" / "refactor" / "debug" | atlas-metis | Multi-step orchestration with subagents |
| "boot this project" / "set up atlas" / "configure tooling" | atlas-hephaestus | Project bootstrap and configuration |
| "how are my runs doing" / "metrics" / "context cost" / "session forensics" | atlas-argus | Observability and self-improvement |
| "run something repeatedly" / "poll" / "iterate until" / "sweep a backlog" | atlas-chronos | Recurring/iterative loop library |
| "set up connectors" / "configure vendor" / "enable NinjaOne/Vanta/etc" | atlas-hermes | Vendor MCP connector setup |
| "test my UI" / "UX test" / "persona test" / "pre-release sweep" | atlas-odysseus | UX test swarm |
| "what skills should I use" / "stack skills" / "compose a workflow" | atlas-nestor | Interactive skill-stacking concierge |
| "set up my org" / "configure departments" / "brand enforcement" / "compliance" | atlas-armada | Organizational deployment layer |
| "set up my workspace" / "what should I run" / "analyze my project" | atlas-olympus | This skill: scaffold and recommend |

## Routing logic

When the user describes a task:

1. **Match keywords** against the routing table above.
2. **If exactly one skill matches with high confidence**: activate it directly.
3. **If two or more skills could handle it**: present the candidates as an
   AskUserQuestion (one round, recommendation first, each with a one-line
   reason).
4. **If no skill matches**: present the full menu of twelve skills and ask the
   user to pick.

## Ambiguous cases

| Task | Candidate skills | Default recommendation |
|---|---|---|
| "improve my code" | atlas-athena (audit), atlas-metis (orchestrate fixes), atlas-ariadne (architecture) | atlas-athena first (find what needs improving), then atlas-metis to fix |
| "set up my project" | atlas-hephaestus (configure), atlas-olympus (scaffold) | atlas-olympus first (scaffolds + bootstraps), which delegates to atlas-hephaestus |
| "make my app better" | atlas-athena (quality audit), atlas-odysseus (UX test), atlas-ariadne (architecture) | atlas-athena first (broadest), then follow its recommendations |
| "automate a task" | atlas-chronos (loop), atlas-metis (orchestrate) | atlas-chronos if the task is recurring; atlas-metis if it is a one-time build |

## Menu mode

When the user asks "what can you do?" or "menu", Olympus presents all twelve
skills:

```
The twelve gods of atlas:

 1. atlas-metis       -- Orchestrate multi-step build/fix/audit/refactor
 2. atlas-hephaestus  -- Boot and configure a project for atlas
 3. atlas-ariadne     -- Map architecture, find duplication, unify
 4. atlas-athena      -- Security and quality audit
 5. atlas-argus       -- Measure run health, audit context, mine sessions
 6. atlas-chronos     -- Recurring/iterative task loops
 7. atlas-hermes      -- Vendor MCP connector setup
 8. atlas-odysseus    -- UX test swarm on any web app
 9. atlas-nestor      -- Compose skills into a stack
10. atlas-armada      -- Org deployment: roles, branding, compliance
11. atlas-olympus     -- Scaffold, recommend, activate (this skill)
12. (reserved)        -- The next skill the fleet needs

Tell me what you'd like to work on, or pick a number.
```

## Blind activation

Each skill can also be invoked "blindly" -- with no specific task -- and it
will determine what to do based on context:

- **atlas-metis** with no task: runs the decision gate (is this multi-stage?) and
  if not, asks the user for a task.
- **atlas-hephaestus** with no task: runs the no-args scan (what is missing to
  bring the project to atlas standard).
- **atlas-ariadne** with no task: runs zero-arg discovery (surveys the repo,
  proposes feature boundaries).
- **atlas-athena** with no task: runs zero-arg discovery (builds the knowledge
  graph, asks for audit depth).
- **atlas-argus** with no task: runs the no-arg trends report.
- **atlas-chronos** with no task: lists the loop library grouped by category.
- **atlas-hermes** with no task: runs the connector status scan.
- **atlas-odysseus** with no task: runs phase 0 discovery on the app.
- **atlas-nestor** with no task: elicits the goal via AskUserQuestion.
- **atlas-armada** with no task: runs the org deployment status scan.
- **atlas-olympus** with no task: runs the recommendation analysis.

This means the user can invoke any skill with no arguments and it will figure
out what to do, give menu options if it is not sure, or ask the user what they
would like to work on and then make suggestions or automatically kick off
whatever skill would accomplish their goals.