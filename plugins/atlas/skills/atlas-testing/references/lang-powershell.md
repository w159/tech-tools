# PowerShell testing reference

How PowerShell (modules, scripts, ops automation incl. Microsoft Graph/Intune/Exchange calls) maps to the atlas-testing taxonomy. TYPE IDs are the canonical ids from `references/taxonomy.md`; gap output references rows here.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
|---|---|---|---|---|
| static-lint | PSScriptAnalyzer 1.25.0 (+ custom rule modules e.g. PSUseConstrainedLanguageMode rule) | `Install-PSResource PSScriptAnalyzer` | `Invoke-ScriptAnalyzer -Path . -Recurse -EnableExit` | Lint + formatter (`Invoke-Formatter`). 1.24+ raised minimum to PowerShell 5.1. `-EnableExit` sets exit code to the diagnostic count, CI-friendly. |
| type-check | Not applicable (see list) | | | |
| unit | Pester 6.2.0 (or Pester 5.9.1, maintenance mode) | `Install-PSResource Pester` | `Invoke-Pester` | Pester 6 (Jul 2026) ships new `Should-*` assertions, `Should-BeEquivalent` deep compare, `Run.Shuffle`, experimental parallel runner (incl. Windows PowerShell 5.1), Cobertura coverage. `Should.DisableV5` turns off classic `Should -Be`. Pester 5 gets critical fixes only. |
| integration | Pester 6 integration suites with mocked remote APIs; real endpoints only in a tagged CI stage | `Install-PSResource Pester` | `Invoke-Pester -Configuration $config` | Split unit/integration into `tests/unit`, `tests/integration`; Pester 6's `Pester.BeforeContainer.ps1` chain gives per-folder setup. Mock `Invoke-RestMethod`, `Invoke-Command`, `New-PSSession` at unit level; hit real Graph/Intune sandboxes in the integration stage only. |
| component | Not applicable (see list) | | | |
| api | Pester tests calling `Invoke-RestMethod` against stubbed or sandbox endpoints (WireMock-like stub servers, or `Start-Job` host) | Pester | `Invoke-Pester` | Assert status codes, auth headers (`Authorization: Bearer` token plumbing), and response shape contracts for REST consumers. |
| contract | Not applicable (see list) | | | |
| e2e | Pester scenario suites exercising the real module/CLI end to end in a disposable tenant/VM | Pester | `Invoke-Pester` | Full runbook path: connect to a sandbox tenant, execute, assert side effects via read-back. Nightly; never against production tenants. |
| smoke | Pester smoke suite (fast tags), plus `Import-Module` load test | Pester | `Invoke-Pester -Tag Smoke` | Module imports, help exists, no syntax errors; runs on every CI build. |
| regression | Full Pester suite after refactors; `Run.Shuffle = $true` to surface order dependencies | Pester | `Invoke-Pester` | Shuffle with a printed seed makes hidden inter-test dependencies visible; replay with `Run.ShuffleSeed`. |
| snapshot-approval | Golden-file pattern: `Get-Content expected.json -Raw` + `Should-BeString` (Pester 6 prints a real diff) | Pester | `Invoke-Pester` | No dedicated snapshot tool; commit expected JSON/table output and diff. Good enough for report/CSV renderers. |
| characterization | Same golden-file pattern over wrapped legacy scripts | Pester | `Invoke-Pester` | Capture current output of untested scripts before refactoring. |
| coverage | Pester CodeCoverage config (`CodeCoverage.Enabled`, `OutputPath`, `CoveragePercentTarget`); Pester 6 adds Cobertura and parallel-safe collection | Pester | `Invoke-Pester -Configuration $config` | Exclude `.Tests.ps1` from analysis; enforce `CoveragePercentTarget` in CI. |
| sast | PSScriptAnalyzer 1.25.0 + InjectionHunter 1.0.0 rules | `Install-PSResource InjectionHunter` | `Invoke-ScriptAnalyzer -CustomRulePath <InjectionHunter path>` | InjectionHunter (Microsoft, PSGallery) flags `Invoke-Expression`, `Add-Type`, dangerous methods, injection-prone pipelines. Wire as CustomRulePath into PSScriptAnalyzer and VS Code. |
| secrets | gitleaks / trufflehog (repo scan); PSScriptAnalyzer password rules (PSAvoidUsingPlainTextForPassword) | brew | `gitleaks detect --no-banner` | Catches tenant IDs, client secrets in scripts, and Bicep/ARM parameter files. |
| iac-policy | PSRule (module stable 2.9.0; v3.0.0 in beta) + PSRule for Azure 1.47.0 | `Install-PSResource PSRule` | `Invoke-PSRule -InputPath .` | Rule engine for Bicep/ARM/objects with CI emitters (GitHub Actions/Azure Pipelines); monthly Azure baselines (`Azure.GA_2025_12`). |
| data-quality | Pester data validation over CSV/JSON inputs | Pester | `Invoke-Pester` | Ops validation pattern: assert file schemas, null-free required columns, referential checks before imports. |
| db-migration | Pester + dbatools validation tests for SQL schema/data | `Install-PSResource dbatools` | `Invoke-Pester` | Classic pattern: export production schema, run `Get-DbaDbTable` assertions; see `references/data-sql-databases.md`. |
| ci-pipeline | Pester `TestResult` output: `OutputFormat` `NUnitXml` or `JUnitXml`, `OutputPath`, `Enabled` | Pester | `Invoke-Pester -Configuration $config` | Publish NUnit2.5/JUnit4 XML in Azure DevOps, GitHub Actions, TeamCity; coverlet-style coverage stats via PassThru result object. |
| flakiness | Process discipline: mocks over sleeps, `Run.Shuffle`, Pester 6 parallel runner | Pester | `Invoke-Pester` | Ops flake sources: live API rate limits, DC latency. Mock everything remote at unit level; quarantine flaky tests to the nightly stage. |
| authz | Pester tests asserting role/permission matrices (mocked Graph/Entra cmdlets, e.g. `Mock Invoke-MgGraphRequest`), plus `$PSCmdlet.ShouldProcess`/`-WhatIf` assertions for destructive functions | Pester | `Invoke-Pester` | Assert which Graph/Entra calls run per role by mocking the cmdlets and checking `Should-Invoke` call counts/filters; assert destructive functions honor `SupportsShouldProcess` so `-WhatIf` performs no writes. |

### Not applicable

| TYPE ID | Reason |
|---|---|
| type-check | No static type system for typical PowerShell; rely on PSScriptAnalyzer parse errors and Pester tests. |
| component | No component model; module/function granularity is covered by unit. |
| contract | No Pact-style consumer contract tooling in the PowerShell ecosystem. |
| acceptance-bdd | No maintained Gherkin runner for PowerShell. |
| property-based | No mainstream tooling; the ecosystem has no QuickCheck equivalent. |
| fuzz | No mainstream tooling; the ecosystem has no QuickCheck equivalent. |
| metamorphic | No mainstream tooling; the ecosystem has no QuickCheck equivalent. |
| combinatorial | No mainstream tooling; the ecosystem has no QuickCheck equivalent. |
| differential | No mainstream tooling; the ecosystem has no QuickCheck equivalent. |
| model-based | No mainstream tooling; the ecosystem has no QuickCheck equivalent. |
| mutation | No maintained PowerShell mutation tester. |
| benchmark | Load belongs to the system under test, not the management scripts; use `Measure-Command` ad hoc, or the language reference of the target service. |
| load | Load belongs to the system under test, not the management scripts; use `Measure-Command` ad hoc, or the language reference of the target service. |
| chaos | No mainstream fault-injection harness; do controlled failure drills manually. |
| accessibility | Not applicable to scripts; if building a web UI, see web references. |
| visual-regression | Not applicable to scripts; if building a web UI, see web references. |
| cross-browser | Not applicable to scripts; if building a web UI, see web references. |
| i18n | No established tooling; pin `LC_ALL`/`$env:LANG` in CI so formatting stays deterministic. |
| sca | No PowerShell-specific vulnerability database; treat module supply chain with pinned versions (`PSResourceGet` + private feed) and rely on the `sca` row of other references for the host stack. |
| dast | Dynamic app testing runs against services, not scripts. |
| container-scan | Image scanning is covered by `references/infra-iac-containers-ci.md`. |
| docs-examples | Comment-based help is asserted in the smoke suite; no separate tool. |
| notebook | Repo-level tooling, language-agnostic. |
| link-check | Repo-level tooling, language-agnostic. |
| exploratory | Human-led activities; not tool-runnable. |
| usability | Human-led activities; not tool-runnable. |

## Recommended default stack

1. Pester 6 (6.2.0) for unit/integration/ops validation; keep Pester 5 syntax compatibility until the suite is migrated (`Should.DisableV5` off during migration, on after).
2. PSScriptAnalyzer 1.25.0 on every PR, with InjectionHunter rules merged in for security-sensitive scripts.
3. Mock remote APIs (Graph, Intune, Exchange, WMI) with `Mock`/`Should-Invoke`; use `InModuleScope` and `TestDrive:` for module-internal and filesystem isolation.
4. PSRule + PSRule for Azure for Bicep/ARM policy checks; gitleaks for secrets.
5. CI: `TestResult.OutputFormat NUnitXml` (or `JUnitXml`) + code coverage; run the matrix PowerShell 7.4+ and Windows PowerShell 5.1.

## Config snippets

Pester 6 CI configuration:

```powershell
$config = New-PesterConfiguration
$config.Run.Path = 'tests'
$config.Run.Shuffle = $true
$config.CodeCoverage.Enabled = $true
$config.CodeCoverage.Path = 'src/*.psm1'
$config.CodeCoverage.CoveragePercentTarget = 80
$config.TestResult.Enabled = $true
$config.TestResult.OutputFormat = 'NUnitXml'   # or 'JUnitXml'
$config.TestResult.OutputPath = 'test-results.xml'
Invoke-Pester -Configuration $config
```

Mocking Graph/Intune calls:

```powershell
Describe 'Set-IntuneCompliance' {
    BeforeAll {
        Mock Invoke-RestMethod { @{ id = 'policy-1'; displayName = 'Baseline' } } `
            -ParameterFilter { $Uri -like 'https://graph.microsoft.com/*' }
    }

    It 'posts the compliance policy and asserts the call' {
        Set-IntuneCompliance -Name 'Baseline'
        Should-Invoke Invoke-RestMethod -Exactly 1 -ParameterFilter {
            $Method -eq 'Post' -and $Uri -like '*deviceCompliancePolicies*'
        }
    }
}
```

PSScriptAnalyzer settings (`.PSScriptAnalyzerSettings.psd1`):

```powershell
@{
    IncludeDefaultRules = $true
    CustomRulePath      = "$PSScriptRoot/rules/InjectionHunter.psd1"
    Rules = @{
        PSUseConsistentIndentation = @{ Enable = $true }
        PSAvoidUsingPlainTextForPassword = @{ Enable = $true }
    }
}
```

GitHub Actions version matrix:

```yaml
strategy:
  matrix:
    ps7:  { shell: pwsh }
    ps51: { shell: powershell }
steps:
  - shell: ${{ matrix.shell }}
    run: Invoke-Pester -Configuration (New-PesterConfiguration)
```

## Gotchas

- Pester 5 to 6: v6 is a syntax-changing major (dash-style `Should-Be` assertions), but v5 syntax still ships; migrate incrementally and flip `Should.DisableV5` when done. Pester 5 is maintenance-mode (5.9.1), tested only on Windows PowerShell 5.1 and PowerShell 7.4+.
- Edition matrix: modules must be tested on both PowerShell 7.4+ and Windows PowerShell 5.1 (the `powershell` shell in CI); `Import-Module -UseWindowsPowerShell` is a compat shim for cross-edition calls, not a substitute for real 5.1 tests. Pester 6's parallel runner now works on 5.1, the slowest edition.
- Mocking remote APIs: mock `Invoke-RestMethod`/`Invoke-Command` at unit level; only the integration stage should touch live sandboxes, and never production tenants. Regulated-context rule: any test data touching client PII stays mocked or synthetic (GLBA/SEC Reg S-P).
- Pester 5.9.0 narrowed tested PS versions; if you still run 5.x on Windows PowerShell 3/4 you are unsupported.
- Coverage excludes: always exclude `.Tests.ps1` from `CodeCoverage.Path`, and note coverage of proxies/dynamic code (steppable pipelines) can be misleading in v5.
- InjectionHunter is version 1.0.0 (2017) and still current; treat its rules as a floor, not a ceiling, and add repo-specific custom rules.
- PSRule module has been on 2.9.0 (stable) since 2023 with v3.0.0 in beta; pin the module version in CI (`ps-rule.lock.json`) because rule baselines change monthly via PSRule for Azure.

## Sources

- https://pester.dev/docs/v5/usage/test-results and https://pester.dev/docs/v5/introduction/installation
- https://github.com/pester/Pester/releases (6.2.0, 6.0.0, 5.9.x notes)
- https://github.com/PowerShell/PSScriptAnalyzer/releases
- https://www.powershellgallery.com/packages/InjectionHunter/1.0.0
- https://devblogs.microsoft.com/powershell/powershell-injection-hunter-security-auditing-for-powershell-scripts/
- https://github.com/microsoft/PSRule/releases and https://github.com/Azure/PSRule.Rules.Azure/releases
- https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/import-module (UseWindowsPowerShell)

Verified (2026-10-14): Pester 6.2.0/6.0.0/5.9.1 versions, maintenance-mode status, Should-* assertions, Run.Shuffle, BeforeContainer chain, TestResult NUnitXml/JUnitXml, coverage config (GitHub releases + pester.dev); PSScriptAnalyzer 1.25.0 (GitHub + PSGallery); InjectionHunter 1.0.0 and CustomRulePath integration (PSGallery + PowerShell Team blog); PSRule 2.9.0 stable/v3 beta, PSRule for Azure 1.47.0 (GitHub + PSGallery). `SupportsShouldProcess`/`$PSCmdlet.ShouldProcess`/`-WhatIf` semantics (Microsoft Learn "Everything you wanted to know about ShouldProcess"). From memory, mark [unverified]: dbatools current version (pattern is standard practice, module version not checked this pass).
