# Security testing: sast, sca, secrets, dast, iac-policy, container-scan, authz, supply chain (TYPE IDs: `sast`, `sca`, `secrets`, `dast`, `iac-policy`, `container-scan`, `authz`; supply chain mapped to `sca` + build attestation)

## Definition

Tests that look for vulnerabilities rather than behavior bugs. Layered: static code analysis (sast) and dependency scanning (sca) per PR; secret detection at commit time; dynamic probing (dast) and infrastructure/container policy checks against built artifacts; authorization tests as real test suites; supply-chain attestation for what you ship. For a regulated firm (SEC Reg S-P, FTC Safeguards Rule, GLBA) these are the control-evidence backbone: each tool run is a monitoring record.

## SAST (TYPE ID: `sast`)

Oracle = **zero new findings above severity threshold**; findings map to rules, not guesses.

| Tool | Languages | Status (verified 2026-10-14 unless noted) | Notes |
|---|---|---|---|
| Semgrep | 30+ incl. Python, JS/TS, Go, PHP, Java, Ruby | Active | Fast, rule-precise, custom rules in simple YAML; community registry; CI-friendly (diff-aware scanning). The default polyglot pick. |
| CodeQL | Java/Kotlin, C#, Python, JS/TS, Go, Ruby, C/C++ | Active (GitHub Advanced Security) | Deep dataflow/taint analysis; free on public repos, needs GHAS licensing for private repos. |
| Bandit | Python | Active | The Python baseline; runs in seconds; pair with Semgrep for flow analysis. |
| ESLint security plugins | JS/TS | Active | `eslint-plugin-security` (and node-security plugin); cheap PR-tier findings; not a real SAST alone. |
| gosec | Go | Active | Golang-specific checks (file perms, crypto, integer overflow). |
| SonarQube | Polyglot | Active (Community Edition free) | Quality-gate style with security rules; heavier setup; good org-wide dashboards. |
| Psalm | PHP | Active | `--taint-analysis` gives real taint tracking for PHP; run alongside Semgrep. |
| Roslyn analyzers + SecurityCodeScan | C#/.NET | Roslyn analyzers: active/built-in (Microsoft.NetSdk analyzers ship with the SDK, `EnableNETAnalyzers`); SecurityCodeScan: effectively unmaintained [INFERENCE from repo dormancy - prefer SDK analyzers + Semgrep/CodeQL on C#] | C# taint analysis via CodeQL or Semgrep. |
| Brakeman | Ruby on Rails | Active | Rails-specific static scanner; free, no config; run per PR on Rails apps. |
| PSScriptAnalyzer | PowerShell | Active (Microsoft) | Lint + security-relevant rules for PS modules/scripts; `Invoke-ScriptAnalyzer`. |

PR vs nightly: fast linters (Bandit, gosec, ESLint security, PSScriptAnalyzer, Brakeman) per PR on changed files; Semgrep full-repo per PR in diff mode + nightly full; CodeQL nightly (it is slow). Suppress findings with inline `// nosemgrep`-style annotations plus a written reason - silent baselines hide regressions.

## SCA / dependency vulnerabilities (TYPE ID: `sca`)

Oracle = **zero known vulnerabilities above threshold in the resolved dependency tree**.

| Tool | Ecosystem | Notes (verified 2026-10-14 unless noted) |
|---|---|---|
| `npm audit` / `pnpm audit` | JS/TS | Built-in; registry-driven; `audit fix` carefully (major bumps break builds). |
| pip-audit | Python | PyPA tool; audits requirements/lockfiles against PyPI Advisory DB + OSV. |
| OSV-Scanner | Polyglot (Google) | Scans lockfiles/SBOMs against the OSV database; good cross-language single command. |
| govulncheck | Go | Official Go tool; call-graph-aware (only reports vulns your code actually reaches). |
| `dotnet list package --vulnerable` | .NET | Built into the SDK; NuGetAudit (NuGetAuditLevel) makes vulnerable transitive packages build warnings. |
| `composer audit` | PHP | Built into Composer (uses Packagist advisory DB). |
| `bundler-audit` / `cargo-audit` | Ruby / Rust | RubySec advisory DB / RustSec advisory DB; both mature and active. |
| Trivy (Aqua) | Polyglot + containers + IaC | One scanner for deps, images, IaC, secrets; the multi-tool default. |
| Grype (Anchore) | Polyglot + containers | SBOM-driven (pairs with Syft); compare severity databases with Trivy if adopting one. |
| Dependabot | GitHub-hosted | Auto PRs for bumps; version-update + grouped security updates. |
| Renovate | GitHub/GitLab | More configurable bump automation (batching, scheduling, lockfile maintenance). Pick one of Dependabot/Renovate, not both. |

PR vs nightly: lockfile-aware scanners per PR (fail on new critical/high); scheduled full scans + Dependabot/Renovate cadence weekly; keep an SLA for remediation (critical 7 days, high 30 days) - the SLA itself is Safeguards-Rule evidence.

## Secrets scanning (TYPE ID: `secrets`)

Oracle = **zero secrets in history**; detection plus prevention.

- gitleaks: fast, config-as-code, runs pre-commit and CI (also scans git history).
- trufflehog: 800+ verified-credential checkers (tests whether the leaked key still works - triage gold).
- detect-secrets (IBM/Yelp): baseline-file workflow for retrofitting legacy repos.
- GitHub push protection: blocks pushes containing detected secrets org-wide; enable it - it is free and the only control that stops the leak before it lands.

Rotation rule: a detected secret is compromised, full stop - revoke and rotate first, clean history (git filter-repo / BFG) second. Verified live credentials found by trufflehog are an incident: rotate within hours and record it (Reg S-P incident-response record).

## DAST (TYPE ID: `dast`)

Oracle = **no exploitable findings in a running system**; complements SAST by seeing what actually executes.

- OWASP ZAP: the default. Baseline scan (`zap-baseline.py`) for unauthenticated surface per PR/staging deploy; API scan driven by an OpenAPI spec for the backend; full active scan nightly against a dedicated test environment only. Requires explicit written permission before scanning anything you do not own.
- Nuclei (ProjectDiscovery): template-driven probing (CVEs, misconfigs, exposures); fast targeted checks in CI against staging.
- Burp Suite (Pro/Enterprise): the manual/semi-automated pen-test standard; enterprise edition for scheduled scans. Human pen tests with Burp belong in the annual cycle, not CI.

Run DAST only against isolated test environments with synthetic data - a DAST scan against a system holding client PII is itself a Safeguards Rule problem. Provide test credentials and scope files; review findings weekly, not per-build.

## IaC / policy scanning (TYPE ID: `iac-policy`)

Oracle = **zero policy violations in Terraform/Bicep/ARM/cloud config**.

- Checkov (Prisma/Bridgecrew): multi-framework (Terraform, CloudFormation, Kubernetes, etc.), custom policies in Python/YAML; active.
- tfsec -> Trivy: tfsec is now part of Trivy (the tfsec repo itself states "Tfsec is now part of Trivy"; tfsec releases stopped while Trivy's misconfiguration engine continued); for new setups use `trivy config`; existing tfsec CI steps should migrate.
- KICS (Checkmarx): broad IaC query language; good second opinion alongside Checkov.
- PSRule for Azure (`PSRule.Rules.Azure`): the Azure-specific ruleset for Bicep/ARM/Terraform-Output; run in PR validation pipelines for the Azure estate (Microsoft-maintained, active).
- OPA / Conftest: Rego policies over any structured config (Kubernetes manifests, Terraform plans); the escape hatch when vendor rules do not cover your policy - e.g. "all storage with client data must have private endpoints" as a unit-tested Rego policy.

PR-tier: scan plan/manifest diffs per PR, full scan nightly.

## Container scanning (TYPE ID: `container-scan`)

Oracle = **image passes vulnerability + misconfiguration gates before deploy**.

- Trivy and Grype again (image mode): scan built images in CI; gate deploys on critical/high with a fix available; track "no fix available" separately.
- Docker Scout: Docker's built-in image analysis (integrated with Docker Hub/Registry); fine as a developer signal, pair with Trivy/Grype for the gate.
- hadolint: Dockerfile lint (pin versions, avoid latest, no secrets in layers) per PR.
- Also scan base images on a schedule: rebuild on every base-image CVE, not only on your code changes.

## Authorization testing (TYPE ID: `authz`)

Oracle = **explicit allow/deny matrix over identities, roles, and resources** - the highest-priority security test family for a firm handling client PII. Static scanners cannot decide this; it is a real test suite.

- **IDOR / BOLA tests**: for every client-data endpoint, a test that principal A requesting principal B's resource gets 404/403 (not 200, not a filtered 200). Generate the matrix from your role model (advisor, CSA, compliance officer, client) x resource types (household, financial account, document, note). Map to OWASP API Security Top 10 2023: BOLA (API1) - the current published edition is 2023 [watch for a 2026 refresh; unverified if released].
- **Role matrix tests**: table-driven tests asserting each (role, action, resource) triple; a missing cell is a failing test, not a TODO. Property-based variant: model-based testing (see types-input-generation.md) where the state machine is the permission model.
- **RLS tests (Postgres)**: connect with the actual app roles (not superuser!) and assert row visibility per role for seeded fixtures; test that policies fail closed (new table without policy = invisible, not visible). Superuser/owner connections bypass RLS - the test must use the real connection identity. Coordinate with references/data-sql-databases.md for RLS setup.
- **OWASP API Top 10 mapping**: cover API1 BOLA, API2 Broken Authentication, API3 BOPLA (mass assignment), API4 Unrestricted Resource Consumption (rate limits), API5 BFLA, API6 Sensitive Business Flows, API7 SSRF, API8 Security Misconfiguration, API9 Improper Inventory, API10 Unsafe API consumption - at minimum a test or documented manual check per category, with the mapping written into the test plan.
- Audit-log assertions: every denied access attempt must produce an audit event; test it (Safeguards Rule access monitoring evidence).

## Supply chain (mapped to `sca` + build attestation)

Oracle = **every artifact is traceable to a signed, attested build from its sources**.

- SBOM: generate with Syft (image/fs) or CycloneDX tooling (language-native); store the SBOM with each release artifact; it is the input to OSV-Scanner/Grype and the answering document for the "what was affected" question in any vendor incident (GLBA vendor-management expectation).
- SLSA: build-level framework; current major version is SLSA v1.x (v1.0 published 2023; v1.1 in progress [unverified]); aim for Build L3 on CI-hosted builds (provenance for GitHub Actions via the SLSA generator).
- Sigstore / cosign: keyless signing (`cosign sign`) + verification admission check in deploy pipelines; verify signatures of third-party images you consume too.
- OpenSSF Scorecard: automated repo-risk score; run it on your own repos and on critical vendor repos (vendor due-diligence input under the Safeguards Rule).

## PR vs nightly strategy

| Stage | Runs |
|---|---|
| Pre-commit / push | Secret scanning (gitleaks pre-commit; GitHub push protection enabled) |
| PR | Fast SAST on diff (Bandit, gosec, ESLint security, Brakeman, PSScriptAnalyzer, Semgrep diff); lockfile SCA; hadolint + IaC scan on manifest diffs; authz unit/matrix tests in the normal suite |
| Nightly | CodeQL full; Semgrep full; Trivy/Grype image scans on rebuilt images; ZAP baseline + API scan against staging; OSV-Scanner with stored SBOMs; OpenSSF Scorecard refresh |
| Scheduled (weekly/quarterly) | Dependency-bump PRs (Dependabot/Renovate); Nuclei template refresh + staging sweep; human pen test (annual); RLS/role-matrix review with access reviews (quarterly access review is Safeguards-aligned) |

## Interpreting results and thresholds

- Every scanner reports raw findings; only triaged, owned findings count as controls. Track: new findings per PR (gate), open findings by severity/age (SLA), false-positive rate after tuning.
- Gates: PR fails on new critical/high SAST, new vulnerable dependency at critical/high, any secret, any IaC violation at high severity. DAST findings triage weekly (too noisy to gate per build).
- Scanner noise: tune by rule (disable rules with >90% false-positive rate and document why), never by ignoring output.
- Version drift: SCA tools disagree (different advisory DBs); pick one canonical scanner per tier and record which database backs each report.

## Reg S-P / FTC Safeguards / GLBA control-evidence mapping

| Control area (16 CFR Part 314.4) | Testing evidence from this file |
|---|---|
| 314.4(a) designated qualified individual | Named owner per scanner/gate in CI config (committed, reviewable) |
| 314.4(b) risk assessment | SCA + SAST + authz-matrix findings as the technical risk inventory; DAST results validate it |
| 314.4(c)/(d) access controls, safeguards | Authz/role-matrix/RLS test suites; secrets scanning ensuring credential hygiene |
| 314.4(e) training | Out of scope here (human control) - reference security-awareness program records (e.g. KnowBe4) |
| 314.4(f) service providers | OpenSSF Scorecard + SBOM on vendor repos; vendor image signature verification |
| 314.4(g) evaluate/adjust safeguards | Quarterly scanner-threshold review; trend dashboards of open findings |
| 314.4(h) incident response | trufflehog verified-credential alerts + rotation records; DAST/ZAP incident runs; secrets-as-incidents documented |
| 314.4(i) monitoring/logging | Audit-log assertions in authz tests; CI scan history as monitoring records |
| Reg S-P (amended) incident-response programs, customer notification | Same evidence set; access/authorization tests demonstrate the controls that limit breach scope |

## Sources

- https://semgrep.dev/docs/ ; https://codeql.github.com/ ; https://bandit.readthedocs.io/ ; https://github.com/nodesec/eslint-plugin-security ; https://github.com/securego/gosec ; https://www.sonarsource.com/open-source-editions/ ; https://psalm.dev/docs/running_psalm/plugins/technical_docs_taint/ (taint analysis) ; https://brakemanscanner.org/ ; https://github.com/PowerShell/PSScriptAnalyzer
- https://docs.npmjs.com/cli/commands/npm-audit ; https://pip-audit.pypa.io/ ; https://github.com/google/osv-scanner ; https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck ; https://learn.microsoft.com/nuget/concepts/auditing-packages ; https://getcomposer.org/doc/03-cli.md#audit ; https://github.com/rubysec/bundler-audit ; https://github.com/rustsec/rustsec (cargo-audit) ; https://trivy.dev/ ; https://github.com/anchore/grype ; https://docs.github.com/en/code-security/dependabot ; https://docs.renovatebot.com/
- https://github.com/gitleaks/gitleaks ; https://github.com/trufflesecurity/trufflehog ; https://github.com/Yelp/detect-secrets ; https://docs.github.com/en/code-security/secret-scanning/push-protection
- https://www.zaproxy.org/docs/desktop/addons/import-openapi-definition/ (API scan) ; https://github.com/projectdiscovery/nuclei ; https://portswigger.net/burp
- https://www.checkov.io/ ; https://trivy.dev/latest/docs/scanner/misconfiguration/ ; https://github.com/Checkmarx/kics ; https://microsoft.github.io/PSRule/stable/ (PSRule.Rules.Azure) ; https://www.openpolicyagent.org/docs/policy-language ; https://github.com/open-policy-agent/conftest
- https://trivy.dev/ ; https://github.com/anchore/grype ; https://docs.docker.com/scout/ ; https://github.com/hadolint/hadolint
- https://owasp.org/API-Security/ (Top 10 2023) ; https://github.com/OWASP/www-project-api-security-testing-framework (ASTF, cross-user BOLA checks)
- Syft: https://github.com/anchore/syft ; https://cyclonedx.org/ ; https://slsa.dev/ ; https://docs.sigstore.dev/ (cosign) ; https://github.com/ossf/scorecard

Verified: 2026-10-14 via web search - OWASP API Security Top 10 current edition is 2023 (OWASP project pages incl. the OWASP API Security Testing Framework which targets it); axe/WCAG items verified separately in types-nonfunctional.md. From memory / not re-verified: [unverified] exact current versions for Semgrep, CodeQL, Bandit, gosec, Psalm, Brakeman, PSScriptAnalyzer, Trivy, Grype, gitleaks, trufflehog, ZAP, Nuclei, Checkov, KICS, PSRule.Rules.Azure, Syft, cosign; SecurityCodeScan maintenance status (marked as inference); tfsec->Trivy status now verified from the tfsec repo itself ("Tfsec is now part of Trivy"); SLSA v1.1 status; OWASP API Top 10 2026 edition existence; `.NET` SDK analyzer defaults.
