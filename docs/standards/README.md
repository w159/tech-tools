# Standards Reference Library

Best-practice rulebooks extracted from the awesome-copilot `instructions/` corpus. These are
reference documents, not auto-imported context. They are deliberately kept out of `rules/`
(which `AGENTS.md` expands into every session) so they do not bloat the session context. Agents
and skills consult them on demand when the work touches a given domain.

## Layout

| Domain | File | Covers |
| --- | --- | --- |
| security | `security/security-and-owasp.md` | OWASP Top 10, secure-coding rulebook, language-agnostic |
| azure | `azure/azure-verified-modules-bicep.md` | Azure Verified Modules + Bicep IaC standards |
| azure | `azure/dotnet-architecture-good-practices.md` | .NET application architecture rules |
| devops | `devops/containerization-docker-best-practices.md` | Docker image and container best practices |
| devops | `devops/kubernetes-deployment-best-practices.md` | Kubernetes deployment standards |
| devops | `devops/github-actions-ci-cd-best-practices.md` | GitHub Actions CI/CD pipeline patterns |
| devops | `devops/devops-core-principles.md` | Core DevOps principles |
| devops | `devops/performance-optimization.md` | Cross-language performance optimization |
| devops | `devops/powershell.md` | PowerShell scripting standards |
| devops | `devops/powershell-pester-5.md` | Pester 5 testing for PowerShell |
| testing | `testing/playwright-typescript.md` | Playwright (TypeScript) test authoring |
| testing | `testing/playwright-python.md` | Playwright (Python) test authoring |
| code-quality | `code-quality/self-explanatory-code-commenting.md` | Comment-the-why discipline |
| code-quality | `code-quality/object-calisthenics.md` | Object calisthenics / clean-code rules |

## Provenance

Source: `awesome-copilot/instructions/*.instructions.md` (the `.instructions.md` suffix and the
VS Code `applyTo` frontmatter were the only Copilot-specific parts; content is plain markdown).
Extracted 2026-06-03 during the workspace consolidation.
