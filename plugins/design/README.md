# Design Plugin

A design productivity plugin primarily designed for [Cowork](https://claude.com/product/cowork), Anthropic's agentic desktop application — though it also works in Claude Code. Helps with design critique, system management, UX writing, accessibility, research synthesis, and developer handoff. Works with any design team — standalone with your input, supercharged when you connect Figma and other tools.

## Installation

```bash
claude plugins add knowledge-work-plugins/design
```

## Commands

Explicit workflows you invoke with a slash command:

| Command | Description |
|---|---|
| `/critique` | Get structured design feedback — usability, visual hierarchy, accessibility, and consistency |
| `/design-system` | Audit, document, or extend your design system — components, tokens, patterns |
| `/handoff` | Generate developer handoff specs — measurements, tokens, states, interactions, and edge cases |
| `/ux-copy` | Write or review UX copy — microcopy, error messages, empty states, onboarding flows |
| `/accessibility` | Run an accessibility audit — WCAG compliance, color contrast, screen reader, and keyboard navigation |
| `/research-synthesis` | Synthesize user research — interviews, surveys, usability tests into actionable insights |
| `/readme` | Generate or update a comprehensive, production-ready README.md from full codebase analysis |
| `/refactor` | Audit, plan, and execute a principled codebase refactoring — naming, structure, modularity, SOLID |
| `/ui-refactor` | Modernize a frontend into a production-grade interface built on shadcn/ui, Tailwind CSS, and Radix UI |

All commands work **standalone** (describe your design or paste screenshots) and get **supercharged** with MCP connectors.

## Skills

Domain knowledge Claude uses automatically when relevant:

| Skill | Description |
|---|---|
| `design-critique` | Evaluate designs for usability, visual hierarchy, consistency, and adherence to design principles |
| `design-system-management` | Manage design tokens, component libraries, and pattern documentation |
| `ux-writing` | Write effective microcopy — clear, concise, consistent, and brand-aligned |
| `accessibility-review` | Audit designs and code for WCAG 2.1 AA compliance |
| `user-research` | Plan, conduct, and synthesize user research — interviews, surveys, usability testing |
| `design-handoff` | Create comprehensive developer handoff documentation from designs |
| `readme-generation` | Generate enterprise-grade README.md files from full codebase analysis — architecture, setup, APIs, and more |
| `codebase-organization` | Refactor codebases using SOLID principles, strict naming conventions, clean architecture, and defensive programming |
| `ui-design-system` | Modernize frontends with shadcn/ui — design tokens, component architecture, progress feedback patterns, accessibility, dark mode |

## Example Workflows

### Getting Design Feedback

```
/critique
```

Share a Figma link, screenshot, or describe your design. Get structured feedback on usability, visual hierarchy, consistency, and accessibility.

### Auditing Your Design System

```
/design-system audit
```

I'll review your component library for consistency, completeness, and naming conventions. Get a report with specific improvement recommendations.

### Writing UX Copy

```
/ux-copy error messages for payment flow
```

Get context-appropriate copy with tone guidance, alternatives, and localization notes.

### Developer Handoff

```
/handoff
```

Share a Figma link and get a complete spec: measurements, design tokens, component states, interaction notes, and edge cases.

### Accessibility Check

```
/accessibility
```

Share a design or URL. Get a WCAG 2.1 AA compliance report with specific issues, severity, and remediation steps.

### Synthesizing Research

```
/research-synthesis
```

Upload interview transcripts, survey results, or usability test notes. Get themes, insights, and prioritized recommendations.

### Generating a README

```
/readme
```

Run from a repo root. I'll analyze every file, folder, config, and integration to produce a complete, contributor-ready README.md with architecture diagrams, setup instructions, API docs, and collapsible deep dives.

```
/readme update
```

Already have a README? I'll diff it against the codebase and update only what's stale.

### Refactoring a Codebase

```
/refactor
```

Full audit → plan → execute → validate cycle. I'll scan for naming violations, duplication, dead code, silent catch blocks, and structural issues, then present findings before touching anything.

```
/refactor audit
```

Audit only — get the findings report without making changes.

```
/refactor backend/src/auth
```

Scope it down to a specific area while respecting project-wide conventions.

### Modernizing a Frontend

```
/ui-refactor
```

Full audit → plan → execute → validate cycle. I'll catalog every component, identify shadcn/ui replacements, fix loading/feedback gaps, and migrate page by page with visual regression checks.

```
/ui-refactor audit
```

Audit only — get a findings report on design inconsistencies, feedback gaps, accessibility issues, and dark mode readiness.

```
/ui-refactor frontend/src/features/dashboard
```

Scope it to a specific area while respecting the project-wide design system.

## Standalone + Supercharged

Every command and skill works without any integrations:

| What You Can Do | Standalone | Supercharged With |
|-----------------|------------|-------------------|
| Design critique | Describe or screenshot | Figma MCP (pull designs directly) |
| Design system | Describe your system | Figma MCP (audit component library) |
| Handoff specs | Describe or screenshot | Figma MCP (exact measurements, tokens) |
| UX copy | Describe the context | Knowledge base (brand voice guidelines) |
| Accessibility | Describe or screenshot | Figma MCP, analytics for real usage data |
| Research synthesis | Paste transcripts | User feedback tools (pull raw data) |
| README generation | Run from any repo | GitHub MCP (repo metadata, CI status, badges) |
| Codebase refactoring | Run from any repo | GitHub MCP (branch/PR creation), project tracker (subtasks) |
| UI modernization | Run from any frontend | Figma MCP (design tokens, component specs), project tracker (migration subtasks) |

## MCP Integrations

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](CONNECTORS.md).

Connect your tools for a richer experience:

| Category | Examples | What It Enables |
|---|---|---|
| **Design tool** | Figma | Pull designs, inspect components, access design tokens |
| **User feedback** | Intercom, Productboard | Raw feedback, feature requests, NPS data |
| **Project tracker** | Linear, Asana, Jira | Link designs to tickets, track implementation |
| **Knowledge base** | Notion | Brand guidelines, design principles, research repository |
| **Product analytics** | Amplitude, Mixpanel | Usage data for research synthesis and design decisions |
| **Source control** | GitHub | Repo metadata, CI status, PR context for README generation |

See [CONNECTORS.md](CONNECTORS.md) for the full list of supported integrations.
