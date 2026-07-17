# Recommendation Engine

the onboard mode analyzes the workspace and produces ranked recommendations. Each
recommendation names a skill, a reason, a confidence level, and the command to
run.

## Analysis matrix

the onboard mode checks these signals in order and produces one recommendation per gap
found. The order is priority-ranked: earlier items are more urgent.

### 1. Setup gaps (confidence: high)

Check: does `.atlas/` exist? Does `docs/CHANGELOG.md` exist? Are hooks
wired? Is claude-mem installed? Is context-mode installed?

If any are missing: recommend atlas-setup (boot and configure).
Command: `/atlas` (which runs atlas-setup).

### 2. Structural completeness (confidence: high)

Check: does the canonical structure from `atlas-loop/references/docs-ssot.md`
actually exist? Any absent root file (`README.md`, `AGENTS.md`, `CLAUDE.md`)?
Any missing `docs/` base subfolder (architecture/, decisions/, plans/,
specs/, features/, lessons/, wiki/)? Any missing `.atlas/` subfolder
(findings/, audits/, decisions/, archive/, understand-anything/, graphify/
plus the `.atlas/CLAUDE.md` and `.atlas/AGENTS.md` orientation files)?

If any of the above is missing or partial: recommend running the scaffolder
to repair it - not a full re-onboard, since the scaffolder is idempotent and
only fills the gaps.
Command: `python3 "${CLAUDE_SKILL_DIR}/scripts/scaffold_docs.py" <repo-root>`.
Reason: cite the specific missing root file, `docs/` subfolder, or `.atlas/`
subfolder found.

### 3. Security audit overdue (confidence: high)

Check: does `docs/audits/` contain a security audit newer than the last
known code change? Has atlas-audit ever run on this project?

If no audit or stale audit: recommend atlas-audit (security/quality audit).
Command: invoke the atlas-audit skill.
Reason: "No security audit has been run, or the last audit predates recent code
changes."

### 4. Architecture map missing or stale (confidence: high)

Check: does `docs/architecture/boundaries.md` exist? If it exists, has
the codebase changed since it was written (compare git log dates)?

If missing or stale: recommend atlas-audit (architecture map).
Command: invoke the atlas-audit skill.
Reason: "The architecture has not been mapped, or the map is stale relative to
recent changes."

### 5. Run health regressing (confidence: medium)

Check: read the atlas-audit observability DB. Are inline_ops trending up? Is
verifier_coverage below 1.0? Are there unpaired implementer dispatches?

If any metric is regressing: recommend atlas-audit (observability audit).
Command: invoke the atlas-audit skill.
Reason: cite the specific metric and its direction.

### 6. Org deployment not configured (confidence: medium)

Check: does `.atlas/org-config.yaml` exist? If it exists, are departments
active? Are connectors provisioned for departments that need them?

If org config is missing or incomplete: recommend armada (org setup).
Command: invoke the armada skill.
Reason: "Organizational configuration is not set up" or cite the specific gap.

### 7. UX coverage gap (confidence: medium)

Check: is there a frontend? Has atlas-ux-test ever tested it? If it has, are
there open findings from the last run?

If frontend exists and no UX test has run: recommend atlas-ux-test.
Command: invoke the atlas-ux-test skill.
Reason: "The frontend has not been tested by the UX swarm."

### 8. Docs drift (confidence: high)

Check: does `docs/AGENTS.md` match the actual stack? Does CHANGELOG have
entries for recent git commits? Are there features without specs?

If drift detected: recommend atlas-orchestrate (orchestrator) to drive a docs
reconciliation pass.
Command: invoke atlas-orchestrate with a docs-reconcile task.
Reason: "Documentation has drifted from the codebase."

### 9. Recurring task identified (confidence: low)

Check: read the observability DB for repeated prompts. Are there tasks the
user asks for repeatedly that could be automated as a loop?

If repeated patterns found: recommend atlas-loop (loop library).
Command: invoke the atlas-loop skill.
Reason: "You have repeated this task N times; a loop could automate it."

### 10. Tech debt accumulation (confidence: low)

Check: are there TODO/FIXME/HACK comments? Are there stale branches? Is the
test coverage below a threshold?

If debt signals found: recommend atlas-orchestrate with a tech-debt sweep task.
Command: invoke atlas-orchestrate.
Reason: "N TODO/FIXME markers found; tech debt is accumulating."

### 11. Connector not provisioned (confidence: low)

Check: does the stack suggest vendor connectors (e.g. an MSP shop with RMM
signals but no NinjaOne connector)? Does atlas-setup show disabled connectors?

If vendor signals present but connector not configured: recommend
atlas-setup (connector setup).
Command: invoke the atlas-setup skill.
Reason: "Your stack suggests you use <vendor> but the connector is not
configured."

## Presentation format

the onboard mode presents recommendations as a numbered list:

```
Based on your workspace analysis, here are my top recommendations:

1. [HIGH] Run atlas-audit (security audit)
   Reason: No security audit has been run on this project.
   Command: invoke the atlas-audit skill

2. [HIGH] Run atlas-audit (architecture map)
   Reason: The architecture has not been mapped.
   Command: invoke the atlas-audit skill

3. [MEDIUM] Run atlas-audit (observability audit)
   Reason: verifier_coverage is 0.6 (below 1.0 target) on the last 3 runs.
   Command: invoke the atlas-audit skill

Pick a number to run it, or tell me what you'd like to work on.
```

## Confidence levels

- **high**: the signal is deterministic (file exists or does not, audit ran
  or did not). the onboard mode is confident this recommendation is correct.
- **medium**: the signal is probabilistic (metrics trending, partial config).
  the onboard mode recommends but the user may have context that changes priority.
- **low**: the signal is heuristic (TODO counts, repeated prompts). the onboard mode
  suggests but the user should decide if it is worth their time.

## What atlas-setup never recommends

atlas-setup does not recommend itself -- it IS the recommendation engine.