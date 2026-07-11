# Recommendation Engine

Olympus analyzes the workspace and produces ranked recommendations. Each
recommendation names a skill, a reason, a confidence level, and the command to
run.

## Analysis matrix

Olympus checks these signals in order and produces one recommendation per gap
found. The order is priority-ranked: earlier items are more urgent.

### 1. Setup gaps (confidence: high)

Check: does `.atlas/` exist? Does `.atlas/docs/CHANGELOG.md` exist? Are hooks
wired? Is claude-mem installed? Is context-mode installed?

If any are missing: recommend atlas-hephaestus (boot and configure).
Command: `/atlas` (which runs atlas-hephaestus).

### 2. Security audit overdue (confidence: high)

Check: does `.atlas/docs/audits/` contain a security audit newer than the last
known code change? Has atlas-athena ever run on this project?

If no audit or stale audit: recommend atlas-athena (security/quality audit).
Command: invoke the atlas-athena skill.
Reason: "No security audit has been run, or the last audit predates recent code
changes."

### 3. Architecture map missing or stale (confidence: high)

Check: does `.atlas/docs/architecture/boundaries.md` exist? If it exists, has
the codebase changed since it was written (compare git log dates)?

If missing or stale: recommend atlas-ariadne (architecture map).
Command: invoke the atlas-ariadne skill.
Reason: "The architecture has not been mapped, or the map is stale relative to
recent changes."

### 4. Run health regressing (confidence: medium)

Check: read the atlas-argus observability DB. Are inline_ops trending up? Is
verifier_coverage below 1.0? Are there unpaired implementer dispatches?

If any metric is regressing: recommend atlas-argus (observability audit).
Command: invoke the atlas-argus skill.
Reason: cite the specific metric and its direction.

### 5. Org deployment not configured (confidence: medium)

Check: does `.atlas/org-config.yaml` exist? If it exists, are departments
active? Are connectors provisioned for departments that need them?

If org config is missing or incomplete: recommend atlas-armada (org setup).
Command: invoke the atlas-armada skill.
Reason: "Organizational configuration is not set up" or cite the specific gap.

### 6. UX coverage gap (confidence: medium)

Check: is there a frontend? Has atlas-odysseus ever tested it? If it has, are
there open findings from the last run?

If frontend exists and no UX test has run: recommend atlas-odysseus.
Command: invoke the atlas-odysseus skill.
Reason: "The frontend has not been tested by the UX swarm."

### 7. Docs drift (confidence: high)

Check: does `.atlas/docs/AGENTS.md` match the actual stack? Does CHANGELOG have
entries for recent git commits? Are there features without specs?

If drift detected: recommend atlas-metis (orchestrator) to drive a docs
reconciliation pass.
Command: invoke atlas-metis with a docs-reconcile task.
Reason: "Documentation has drifted from the codebase."

### 8. Recurring task identified (confidence: low)

Check: read the observability DB for repeated prompts. Are there tasks the
user asks for repeatedly that could be automated as a loop?

If repeated patterns found: recommend atlas-chronos (loop library).
Command: invoke the atlas-chronos skill.
Reason: "You have repeated this task N times; a loop could automate it."

### 9. Tech debt accumulation (confidence: low)

Check: are there TODO/FIXME/HACK comments? Are there stale branches? Is the
test coverage below a threshold?

If debt signals found: recommend atlas-metis with a tech-debt sweep task.
Command: invoke atlas-metis.
Reason: "N TODO/FIXME markers found; tech debt is accumulating."

### 10. Connector not provisioned (confidence: low)

Check: does the stack suggest vendor connectors (e.g. an MSP shop with RMM
signals but no NinjaOne connector)? Does atlas-hermes show disabled connectors?

If vendor signals present but connector not configured: recommend
atlas-hermes (connector setup).
Command: invoke the atlas-hermes skill.
Reason: "Your stack suggests you use <vendor> but the connector is not
configured."

## Presentation format

Olympus presents recommendations as a numbered list:

```
Based on your workspace analysis, here are my top recommendations:

1. [HIGH] Run atlas-athena (security audit)
   Reason: No security audit has been run on this project.
   Command: invoke the atlas-athena skill

2. [HIGH] Run atlas-ariadne (architecture map)
   Reason: The architecture has not been mapped.
   Command: invoke the atlas-ariadne skill

3. [MEDIUM] Run atlas-argus (observability audit)
   Reason: verifier_coverage is 0.6 (below 1.0 target) on the last 3 runs.
   Command: invoke the atlas-argus skill

Pick a number to run it, or tell me what you'd like to work on.
```

## Confidence levels

- **high**: the signal is deterministic (file exists or does not, audit ran
  or did not). Olympus is confident this recommendation is correct.
- **medium**: the signal is probabilistic (metrics trending, partial config).
  Olympus recommends but the user may have context that changes priority.
- **low**: the signal is heuristic (TODO counts, repeated prompts). Olympus
  suggests but the user should decide if it is worth their time.

## What Olympus never recommends

Olympus does not recommend:
- Itself (atlas-olympus) -- it IS the recommendation engine.
- atlas-nestor -- that is a meta-skill the user invokes when they want to stack
  skills; Olympus can suggest it as a secondary recommendation if multiple
  skills are relevant.
- The twelfth (reserved) seat.