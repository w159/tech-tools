---
description: Generate or update a comprehensive, production-ready README.md from the full codebase
argument-hint: "<path to repo or 'update' to refresh existing README>"
---

# /readme

> Generate a complete, professional, contributor-ready README.md by analyzing the entire codebase. See the **readme-generation** skill for the full documentation standard and quality bar.

## Usage

```
/readme $ARGUMENTS
```

Analyze the codebase and generate (or update) a README.md for: @$1

If no argument is provided, analyze the current working directory.

If `update` is passed and a README.md already exists, diff the current README against the actual codebase state and update it to reflect reality — preserving any manually written sections.

## Workflow

### Step 1: Full Codebase Analysis

Before writing anything, scan and understand the **entire** repository:

- All folders and files (tree structure)
- Package manifests (`package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.)
- Config files (`.env.example`, `tsconfig.json`, `webpack.config.*`, `docker-compose.yml`, etc.)
- CI/CD workflows (`.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, etc.)
- Infrastructure definitions (Terraform, CloudFormation, Pulumi, k8s manifests)
- Test directories and testing frameworks
- Scripts and automation (`Makefile`, `scripts/`, npm/yarn scripts)
- API route definitions and middleware
- External service integrations and SDK usage
- Authentication and authorization patterns
- Environment variables and secrets references

### Step 2: Identify External Dependencies

For every library, framework, API, or SDK detected:

- Record the exact version from the manifest
- Locate the official documentation URL
- Note what it's used for in this project
- **Never invent references** — only cite official sources

### Step 3: Generate the README

Follow the **readme-generation** skill for the complete section structure, formatting rules, and quality bar.

Key structural requirements:

- Table of Contents with anchor links
- Collapsible `<details>` sections for deep dives (keeps the high-level view clean)
- Tables for environment variables, API integrations, tech stack
- Code blocks for all commands and config examples
- ASCII architecture diagrams where helpful
- Icons and badges for visual engagement (build status, coverage, license)

### Step 4: Validate Before Output

Before finalizing, verify:

1. Every major folder is documented
2. Every integration and external dependency is referenced with official links
3. Setup instructions are complete and runnable
4. No placeholder text remains
5. Collapsible deep-dive sections exist for complex areas
6. Markdown renders correctly (proper heading hierarchy, blank lines before lists)
7. A new engineer could onboard and contribute using only this document

## Output

Write the final README.md directly to the repository root. If updating, show a summary of what changed.

## If Connectors Available

If **GitHub** is connected:
- Pull repository metadata (description, topics, license)
- Check CI/CD workflow status for badge generation
- Inspect open issues and PRs for roadmap/contributing context

If **~~project tracker** is connected:
- Link to the project board for roadmap context
- Pull active milestones or epics for the roadmap section

If **~~knowledge base** is connected:
- Check for existing architecture docs, ADRs, or onboarding guides to reference
- Pull brand or style guidelines for the contributing section

## Tips

1. **Run from the repo root** — I'll scan everything from the current directory down.
2. **Use `update` to keep it fresh** — I'll diff against reality and only change what's stale.
3. **Works with any stack** — Frontend, backend, full-stack, monorepo, microservices, CLI tools, libraries.
4. **Pair with `/review`** — After generating, use `/review` to sanity-check the README against the code.
