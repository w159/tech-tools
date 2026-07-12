# webapp-testing integration

How atlas-odysseus relates to the repo-root `webapp-testing` skill, and where
the boundary between them sits.

## The two skills

| Skill | Location | Role |
|---|---|---|
| atlas-odysseus | `plugins/atlas/skills/atlas-odysseus/` | Orchestrates the full UX test swarm: discovery, persona generation, scripted entry, browser walks, fuzz, calc oracle, synthesis. The single authority for the swarm. |
| webapp-testing | `skills/webapp-testing/SKILL.md` (repo root) | Low-level browser automation via Playwright MCP: navigate, click, fill, screenshot, read console/network. One app, one page, one flow at a time. |

## Boundary

odysseus orchestrates and verifies. It never navigates the app or enters data
itself. The browser-walk and fuzz phases delegate the actual browser work to
`atlas:ui-runtime-tester` agents, which in turn lean on the `webapp-testing`
skill for the Playwright primitives.

```
atlas-odysseus (orchestration + gates)
  -> dispatches atlas:ui-runtime-tester agents (one per persona/route)
       -> each agent uses the webapp-testing skill for browser automation
```

odysseus supplies: the run directory, the contract snapshot from phase 0, the
persona record, and the route/field matrix. The ui-runtime-tester agent
supplies: the live browser session via webapp-testing, the observed behavior,
and the evidence files (screenshots, console logs, network shapes).

## What odysseus passes down

When dispatching a ui-runtime-tester agent, the brief includes:

- `RUN_DIR` - the run's root, with `coverage/contract-snapshot.json` loaded
- the persona id and its generated data record
- the specific route and selectors to walk (from the route matrix)
- the evidence directory: `RUN_DIR/evidence/<persona-id>/`
- the required evidence shape (see `references/evidence-severity.md`)

## What odysseus never delegates

- The three hard gates (G1 client-surface success, G2 evidence-complete, G3
  accuracy). Synthesis-reporter enforces these in the main context, never in a
  delegated agent.
- Phase 0 discovery (the cartographer agent, not a browser walk).
- The final verdict and completion-rate headline.

## webapp-testing is not required for smoke tier

`smoke` coverage runs no browser walk and no fuzz. It uses only the scripted
persona (phase 2) and the calc verifier (phase 5), plus discovery. So
webapp-testing is only invoked for `standard` and `full` tiers.

## Driver script

`scripts/ux-swarm-driver.sh` sets up the run directory and emits the phase
plan for the chosen tier. It does not dispatch agents - the skill itself does
that in one parallel message. The script is read-only with respect to the
app: it writes only under `RUN_DIR`.