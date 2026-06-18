---
name: sonarqube-quality-gate
description: Report a SonarQube project's quality-gate status and new-code issues by first enumerating the connected sonarqube MCP server's tools at runtime and mapping operations to them, never assuming tool names. Use when the user asks "check the SonarQube quality gate", "is the quality gate passing", or "show new-code issues from SonarQube". Read-only.
---

# SonarQube Quality Gate

Report a SonarQube project's quality-gate status and its new-code issues using the connected `sonarqube` MCP server. The exact tool names this server exposes are NOT known ahead of time and MUST be discovered at runtime. Do not assume, guess, or hardcode any SonarQube tool name. This skill is read-only.

## Pipeline

1. Enumerate the server. List the tools the connected `sonarqube` MCP server exposes (a `tools/list` call against that server). Read each tool's name and description to learn the actual surface available in this environment.
2. Map operations to discovered tools. From the enumerated list, identify which tools cover:
   - Listing or resolving projects and project keys.
   - Reading quality-gate status for a project (pass or fail, and the failing conditions).
   - Listing issues, filtered to new code (the new-code period or leak period) where the tool supports it.
   If a needed capability has no matching tool in the enumerated list, say so plainly rather than substituting a guessed name.
3. Resolve the target project. Ask the user for the project key or name if not given, or use the appropriate discovered tool to list projects and confirm the target.
4. Read the quality gate. Call the discovered status tool for the target project and capture the gate result and each failing condition (metric, threshold, actual value).
5. Read new-code issues. Call the discovered issues tool, scoped to new code where supported, and collect issue type, severity, file, line, and rule.
6. Produce the report (see Output).

## Output

A concise quality-gate report:

- Project key or name and the SonarQube instance it came from.
- Overall quality-gate verdict: PASSING or FAILING.
- Each failing condition: metric, threshold, actual value.
- New-code issues grouped by severity, each with type, rule, file, and line.
- A one-line note stating which discovered tool names were used for the status read and the issues read (so the run is reproducible).

If a capability was missing from the enumerated tool set, state which part of the report could not be produced and why.

## Rules and Guardrails

- Read-only. This skill only reads SonarQube state; it never sets quality gates, resolves issues, or mutates the project.
- Discover tool names at runtime. Always enumerate the connected `sonarqube` server first and map operations to the tools it actually exposes. Never hardcode or fabricate SonarQube tool names.
- If the `sonarqube` server is not connected or exposes no usable tools, report that and stop. Do not invent results.
- Ground every reported number and issue in an actual tool response. Do not estimate gate status or issue counts.
- Name the discovered tools used so a reader can reproduce the run.
