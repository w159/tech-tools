---
name: atlas-readme
description: Generate an onboarding-grade README.md by inspecting the actual repo, every claim traced to a real file. Use when a repo has no README or its README is stale.
when_to_use: a repo has no README or its README is stale, and every claim must trace to a real file
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
paths: ["README.md", "**/README.md"]
argument-hint: '[repo path] [audience: contributors/internal/both]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-metis/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-metis/references/operating-contract.md` and apply it before proceeding.

Generate a README.md for: $ARGUMENTS

Read the arguments as: the target repo path, then the audience (contributors, internal, or both). If either is missing or ambiguous, ask once for it, then proceed.

Inspect first, write second:
- Dispatch atlas:explorer (or an equivalent read-only explorer) to inventory the repo before writing a word. Have it return: entry points, config files, dependency manifests, scripts, the real run/test/build commands, env files, and CI/CD pipeline files. Pass back paths and findings, not file dumps.
- Identify the repo's actual package manager and test runner from the manifests present. Use the commands that exist in the repo. Do not invent or assume them.
- Document only commands you have seen in a real file. If you must infer a command, mark it [verify] inline so the reader knows it is unconfirmed.
- Source every env var from the real .env.example, sample config, or settings file. Do not list env vars from memory.

Produce a single README.md with these sections:
- What and Why: one paragraph.
- Quickstart: the shortest path from clone to running, using the repo's actual commands.
- Prerequisites and Setup: exact commands using the repo's real package manager.
- Project Structure: top-level directory map, one line each.
- Architecture and Data Flow: include a Mermaid diagram only if the system complexity warrants it; skip it otherwise.
- Configuration: env vars and config keys sourced from the real .env.example or config file.
- Operations: run, test, build, and troubleshooting for the common failure modes.
- External Dependencies: links to the third-party or vendor docs the code actually relies on.

Constraints: plain direct language, U.S.-keyboard ASCII only, no marketing fluff, no superlatives. Every factual claim must trace to a specific file or line.

VERIFY before reporting:
- Walk each factual claim in the README back to the file or line that supports it. Anything that does not trace is either removed or marked [verify].
- Confirm every command appears verbatim in a real script, manifest, or CI file. Unconfirmed commands stay marked [verify].
- Confirm every env var maps to a key in the real env or config file.

REPORT:
- The path to the README.md written.
- The list of files you read to generate it.
- Any claim or command left marked [verify] and why.

## Supporting files
- `references/readme-section-standard.md` - the canonical section order
  (What and Why, Quickstart, Prerequisites and Setup, Project Structure,
  Architecture and Data Flow, Configuration, Operations, External
  Dependencies), the sourcing rules for commands/env vars/runtime versions,
  and the `[verify]` convention.
- `templates/README.seed.md` - the README skeleton with every standard
  section. Fill it from the repo's actual files; delete any section the repo
  does not warrant; delete the blockquote before delivery.

If a required input is missing or ambiguous, ask once for it, then proceed.
