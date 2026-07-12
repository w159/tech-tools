---
name: sentry-seer-root-cause
description: Run Sentry Seer AI analysis on a specific issue to get an AI root-cause and suggested fix, then summarize cause, blast radius, and recommended fix. Read-only. Use when user asks "run Seer on this issue", "what is the root cause", or "what fix does Sentry suggest".
when_to_use: "When running Seer AI analysis on one confirmed Sentry issue, corroborating its root-cause hypothesis against event data, or summarizing cause, blast radius, and a recommended fix"
allowed-tools: Read, Glob, Grep, Bash, mcp__io_github_getsentry_sentry-mcp__*
---

# Sentry Seer Root Cause

Use Sentry's Seer AI analysis to get a machine-generated root-cause hypothesis and suggested fix for one issue, then turn that raw analysis into a tight engineer-facing summary. Read-only.

## Pipeline

1. Resolve scope: `find_organizations` then `find_projects` to fix the org and project slug if the issue reference does not already carry them.
2. Identify the target issue. Accept a short id or URL directly; otherwise narrow with `search_issues` and confirm the single target with the user before spending a Seer run.
3. Call `analyze_issue_with_seer` on the confirmed issue id to obtain the AI root-cause analysis and any suggested fix or code change.
4. Ground the Seer output against reality: use `get_sentry_resource` to pull the referenced event or release, and `search_events` to confirm the affected-user and event volume the summary will quote. Do not relay Seer claims you cannot corroborate.
5. Synthesize: state the most likely cause, the blast radius (releases, users, environments affected), and the recommended fix, distinguishing what Seer asserts from what you verified.

## Output

A root-cause brief containing:

- Issue identity: short id, title, level, last seen.
- Root cause: Seer's hypothesis, labeled as AI-generated, with the evidence you used to corroborate or qualify it.
- Blast radius: affected releases, user count, and environments.
- Recommended fix: the concrete change Seer suggests (file, function, approach), framed as a proposal for an engineer to review.
- Confidence note: how strongly the evidence supports the hypothesis, and the next step to confirm before shipping a fix.

## Rules and Guardrails

- Read-only. Never call `update_issue`. update_issue is VISIBLE-TO-OTHERS and mutates team-visible state; this skill analyzes and recommends only.
- Seer output is a hypothesis, not ground truth. Always label AI-generated conclusions as such and corroborate volume and user numbers with `search_events` before quoting them.
- Run Seer on one confirmed issue at a time; do not fan out Seer runs across a list without explicit user direction.
- Always report the org slug, project slug, and issue id analyzed.
- If Seer is unavailable or returns no analysis, say so and fall back to a manual evidence summary from event data instead of inventing a cause.
