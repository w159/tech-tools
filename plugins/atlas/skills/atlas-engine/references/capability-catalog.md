# Capability catalog

Maps a detected project signal to the asset Atlas recommends installing. The
`/atlas` architect runs `scripts/discover_capabilities.py` (read-only) to detect
the signals, then presents matching rows here for confirmation. Nothing installs
without the user's explicit OK.

Columns: signal, asset, type (skill / plugin / mcp), why, install command.

| Signal | Asset | Type | Why | Install command |
| --- | --- | --- | --- | --- |
| Any multi-session repo | claude-mem | plugin | Persist lessons, decisions, and errors across sessions; backs the self-improvement layer. | `claude plugin install claude-mem` |
| Logs present or any file over 1 MB | context-mode | plugin | Process large command output and files in a sandbox so raw bytes stay out of context. | `claude plugin install context-mode` |
| 8+ third-party deps in package.json | context7 | mcp | Live, version-correct library docs instead of guessing from memory. | `claude mcp add context7 -- npx -y @upstash/context7-mcp` |
| react / vue / svelte / next / angular | playwright | mcp | Drive a real browser for runtime UI checks and end-to-end tests. | `claude mcp add playwright -- npx -y @playwright/mcp@latest` |
| Frontend framework present | ui-ux-pro-max | skill | Design-system, palette, and UX-guideline intelligence for UI work. | `claude plugin install ui-ux-pro-max` |
| .ps1 / .csproj / .sln (Microsoft stack) | microsoft-docs | mcp | Official Microsoft/Azure/Graph docs grounding. | `claude mcp add microsoft-docs -- npx -y @microsoft/mcp-docs` |
| .tf files (Terraform / IaC) | iac skill | skill | Infra-aware generation and review for Terraform. | `claude plugin install <iac-skill>` |
| Dockerfile / compose / k8s manifests | container tooling | skill | Container build and deploy awareness. | `claude plugin install <container-skill>` |
| .sql / Prisma / Drizzle schema | atlas:db-prober (built in) | agent | Use the bundled read-only DB prober for schema, RLS, grants, indexes, and EXPLAIN plans. | (already shipped with atlas) |
| CI files (.github/workflows, gitlab-ci) | (review awareness) | note | Make reviews CI-aware; mirror the pipeline's lint/test/build gate locally. | (no install; routing note) |

Maintenance: when the discovery script learns a new signal, add a row here with the
same signal wording the script emits, so the two stay in lockstep. Placeholder
asset names in angle brackets mean Atlas should resolve the current best plugin at
recommend time rather than hardcode a slug that may move.
