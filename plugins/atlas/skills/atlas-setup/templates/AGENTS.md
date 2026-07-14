# AGENTS.md

How this project works: architecture, conventions, and the commands an agent
or developer needs to operate it. atlas-setup seeds this file; later atlas
skills (atlas-audit, atlas-setup, atlas-orchestrate) enrich it as they
discover the real stack.

## Stack

<!-- Filled in by atlas-setup after stack detection. -->
- Language(s): <unknown until first scan>
- Framework(s): <unknown until first scan>
- Package manager: <unknown until first scan>
- Test runner: <unknown until first scan>

## Architecture

<!-- Filled in by atlas-audit after the first architecture map. -->
- Entry points: <unknown>
- Boundaries: <unknown>
- Key modules: <unknown>

## Conventions

- The single source of truth lives under `docs/`.
- Every claim cites file:line.
- Every completion carries its evidence in the same message.
- The `.atlas/.run/` directory is ephemeral and gitignored.

## Commands

<!-- Filled in by atlas-setup. -->
- Build: <unknown>
- Test: <unknown>
- Lint: <unknown>
- Run: <unknown>