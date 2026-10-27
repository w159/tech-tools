# Browser delegation

How atlas-ux-test hands browser work to `atlas:ui-runtime-tester` agents, and
where the boundary sits. Everything this skill needs ships inside
`plugins/atlas`; nothing here depends on a skill outside the plugin.

## Roles

| Part | Location | Role |
|---|---|---|
| atlas-ux-test | `plugins/atlas/skills/atlas-ux-test/` | Orchestrates the swarm: discovery, persona generation, scripted entry, browser walks, fuzz, calc oracle, synthesis. The single authority for the swarm. |
| atlas:ui-runtime-tester | `plugins/atlas/agents/ui-runtime-tester.md` | Drives one real browser session: navigate, click, fill, screenshot, read console and network. One app, one flow at a time. |

## Boundary

atlas-ux-test orchestrates and verifies. It never navigates the app or enters
data itself. The browser-walk and fuzz phases dispatch one
`atlas:ui-runtime-tester` agent per persona or route, in one parallel message.

atlas-ux-test supplies: the run directory, the contract snapshot from phase 0,
the persona record and the route and field matrix. The agent supplies the live
browser session, the observed behavior and the evidence files (screenshots,
console logs, network shapes).

## Headless fallback

The agent picks the browser surface in this order: the cmux browser on macOS,
the Claude_Preview MCP, then headless Playwright. Headless Playwright needs
`PLAYWRIGHT_MCP_HEADLESS=1` (or `--headless`) so no window opens, and the agent
must say in its report which surface it used. If no surface works, the agent
reports BLOCKED; it does not guess at results.

## What atlas-ux-test passes down

When dispatching a ui-runtime-tester agent, the brief includes:

- `RUN_DIR` - the run's root, with `coverage/contract-snapshot.json` loaded
- the persona id and its generated data record
- the specific route and selectors to walk (from the route matrix)
- the evidence directory: `RUN_DIR/evidence/<persona-id>/`
- the required evidence shape (see `references/evidence-severity.md`)

## What atlas-ux-test never delegates

- The three hard gates (G1 client-surface success, G2 evidence-complete, G3
  accuracy). Synthesis-reporter enforces these in the main context, never in a
  delegated agent.
- Phase 0 discovery (the cartographer agent, not a browser walk).
- The final verdict and completion-rate headline.

## Smoke tier

`smoke` coverage runs no browser walk and no fuzz. It uses only the scripted
persona (phase 2) and the calc verifier (phase 5), plus discovery. Browser
delegation applies to `standard` and `full` tiers only.

## Driver script

`scripts/ux-swarm-driver.sh` sets up the run directory and emits the phase
plan for the chosen tier. It does not dispatch agents; the skill does that in
one parallel message. The script is read-only with respect to the app: it
writes only under `RUN_DIR`.
