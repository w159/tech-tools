---
name: readme-generation
description: Generate comprehensive, production-ready README.md documentation from a full codebase analysis. Trigger with "generate readme", "create readme", "update readme", "document this project", "write documentation for this repo", or when someone needs a complete project README created or refreshed from the actual implementation.
---

# README Generation

Generate enterprise-grade, contributor-ready README.md files by analyzing every aspect of a codebase. The output must be detailed enough that a new engineer can onboard and contribute immediately, while staying visually clean and not overwhelming.

## Core Philosophy

- **Analyze first, write second** - Never summarize superficially. Understand the architecture before documenting it.
- **Progressive disclosure** - Keep the top level scannable. Hide deep technical detail inside collapsible `<details>` sections.
- **Link to authority** - Every external dependency gets a link to its official docs. Never invent references.
- **Stay current** - When updating, diff against reality. Don't preserve stale docs.

## Required Sections

Adapt section depth to the project's complexity, but never omit critical areas.

### 1. Project Header
- Project name and badges (build, coverage, license, version)
- One-paragraph overview: what it does, who it's for, what problem it solves
- Key differentiators (what makes this different from alternatives)

### 2. Table of Contents
- Anchor links to every major section
- Keeps the document navigable at any length

### 3. Overview
- Business purpose and target users
- Core capabilities (bullet list, 1-2 sentences each)
- High-level architecture context (what kind of app is this?)

### 4. Architecture
- High-level diagram (ASCII art or Mermaid if the renderer supports it)
- Frontend structure and component architecture
- Backend structure, API layers, service boundaries
- Data flow - how requests move through the system
- Authentication and authorization flow
- External integrations map
- Permission model

Use collapsible sections for detailed breakdowns of each layer.

### 5. Tech Stack

Present as a table:

| Technology | Purpose | Documentation |
|-----------|---------|---------------|
| [Name] | [What it does in this project] | [Official docs URL] |

Always cite exact versions from package manifests. Link to official repos/docs only.

### 6. Folder & File Structure

Tree-style breakdown of the repository. For each major directory:
- Purpose
- Key files and what they do
- How it connects to other layers

Wrap detailed per-file explanations in collapsible sections:

```markdown
<details>
<summary>src/api/ - API route handlers</summary>

- `routes/auth.ts` - OAuth2 token exchange, session creation
- `routes/users.ts` - CRUD operations, role validation
- `middleware/auth.ts` - JWT verification, scope checking
- **Pattern**: Controller -> Service -> Repository
- **Error handling**: Centralized via `errorHandler.ts`

</details>
```

### 7. Environment Setup

#### Prerequisites
- Required runtimes with minimum versions
- Required CLI tools
- Required accounts/services/API keys
- Link to official installation guides

#### Installation
Step-by-step (numbered) with exact commands:
1. Clone
2. Install dependencies
3. Configure environment variables
4. Database/service setup (if applicable)
5. Build
6. Run and verify

#### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgres://user:pass@localhost:5432/app` |

Note security considerations for sensitive values.

### 8. Authentication & Authorization
- Token/session acquisition flow
- Required scopes or permissions
- Role hierarchy
- Common failure modes (401, 403) and how to fix them
- Links to provider docs (OAuth, SAML, API key docs, etc.)

### 9. API Integrations

For each external API:

#### [API Name]
- Purpose in this project
- Base URL and version
- Required credentials/scopes
- Rate limiting behavior
- Error handling patterns
- Known limitations
- Official documentation link

### 10. Data Models
- Core entities and relationships
- Schema definitions or TypeScript types
- Mapping/transformation layers
- Use collapsible sections for full schema detail

### 11. Frontend Documentation
- Component architecture and hierarchy
- State management approach
- Routing strategy
- Data fetching patterns
- Error boundaries
- Styling system (CSS modules, Tailwind, styled-components, etc.)

### 12. Backend Documentation
- Server structure and entry point
- Middleware pipeline
- Route organization
- Service layer patterns
- Database access patterns
- Logging, validation, caching strategies

### 13. Testing Strategy
- Test types present (unit, integration, e2e)
- Testing frameworks used
- How to run tests (exact commands)
- Coverage expectations and thresholds
- Mocking strategy
- CI validation process

### 14. Scripts & Automation
Explain every script in `package.json` (or `Makefile`, `justfile`, etc.):

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `yarn dev` | Start development server with hot reload |
| `build` | `yarn build` | Production build |
| `test` | `yarn test` | Run full test suite |
| `lint` | `yarn lint` | ESLint + Prettier check |

### 15. CI/CD & Deployment
- Pipeline stages and what each does
- Deployment environments (dev, staging, prod)
- How to deploy (automated vs. manual steps)
- Rollback procedures

### 16. Security Considerations
- Token/secret storage approach
- Input validation strategy
- Scope minimization
- Logging hygiene (what's redacted)
- CSP headers or security middleware

### 17. Performance Considerations
- Caching layers and strategies
- Pagination approach
- Lazy loading and code splitting
- Known bottlenecks and mitigations

### 18. Contributing Guide
- Code style and linting rules
- Branch strategy (trunk-based, gitflow, etc.)
- PR requirements (reviews, CI, labels)
- Commit conventions
- Testing expectations before merge
- How to add new features/integrations

### 19. Extending the Project
- How to add a new API endpoint
- How to add a new UI page/component
- How to add a new integration
- How to add a new data model
- Required validation steps after changes

### 20. Troubleshooting
Common issues with solutions:
- Build failures
- Auth errors (401, 403)
- Dependency conflicts
- Environment misconfigurations
- Database connection issues

### 21. FAQ
Anticipate common questions from the codebase patterns.

### 22. License
Detect from `LICENSE` file or `package.json`.

## Formatting Standards

- **Heading hierarchy**: `#` for project name, `##` for major sections, `###` for subsections
- **Blank lines**: Always before lists and after headers (CommonMark compliance)
- **Tables**: For structured data (env vars, scripts, tech stack, APIs)
- **Code blocks**: For all commands, config snippets, file examples
- **Collapsible sections**: For deep technical detail - keeps the main flow readable
- **Badges**: At the top for build status, coverage, version, license
- **Icons**: Use sparingly for visual engagement (folder icon for folders, performance icon for performance, security icon for security)
- **No placeholder text**: Every section must have real content or be omitted

## Quality Bar

The README must:
- Feel enterprise-grade and suitable for open-source release
- Be visually clean with consistent formatting
- Not overwhelm beginners but still satisfy senior engineers
- Require no additional explanation outside the document
- Render correctly in GitHub/GitLab Markdown

## Update Mode

When updating an existing README:
1. Read the existing README
2. Scan the codebase for current state
3. Diff: identify stale sections, missing sections, and accurate sections
4. Preserve manually written content (custom notes, historical context)
5. Update only what's changed or missing
6. Output a summary of changes made
