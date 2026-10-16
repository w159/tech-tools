# .NET (C#, Razor/Blazor, ASP.NET Core) testing reference

How .NET maps to the atlas-testing taxonomy. TYPE IDs are the canonical ids from `references/taxonomy.md`; gap output references rows here. Version floor unless noted: xUnit v3 and MSTest 4 target .NET 8+ / .NET Framework 4.7.2+/4.6.2+ respectively.

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
|---|---|---|---|---|
| static-lint | Roslyn analyzers (built-in NetAnalyzers); xUnit analyzers 2.2.0; NSubstitute.Analyzers 1.0.17; StyleCop.Analyzers 1.2.0-beta [unverified version] | SDK built-in; NuGet packages | `dotnet build` | Analyzer warnings surface at build time; enable `<EnforceCodeStyleInBuild>` and treat analyzer warnings as errors in CI. |
| type-check | C# compiler + nullable reference types | SDK | `dotnet build -warnaserror` | `<Nullable>enable</Nullable>`, `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`; the compiler is the type-check gate. |
| unit | xUnit v3 4.0.2 (or NUnit 5.0.0, MSTest 4.5.1) | NuGet `xunit.v3` | `dotnet test` | xUnit v2 is in maintenance mode; v3 added Native AOT support and full test parallelization (4.0). Microsoft.Testing.Platform (MTP) is the default runner surface; VSTest is no longer supported with MTP on .NET 10 SDK+. Choose one framework per repo; do not mix runners. |
| integration | xUnit v3 + WebApplicationFactory (`Microsoft.AspNetCore.Mvc.Testing`) + Testcontainers .NET 4.16.0 | NuGet | `dotnet test --filter Category=Integration` | WebApplicationFactory hosts the app in-memory; Testcontainers boots real SQL Server/Postgres/Redis per test class. Requires Docker on CI runners. |
| component | bUnit 2.11.3 (Blazor/Razor components) | NuGet `bUnit` | `dotnet test` | Semantic HTML diffing, JSInterop mocking, parameterized renders. Requires .NET 8+ for the 2.x line. |
| api | WebApplicationFactory endpoint tests; WireMock.Net or Testcontainers for external HTTP | NuGet | `dotnet test` | Minimal-API and controller tests over `HttpClient` against the in-memory host; the fastest trustworthy API layer check. |
| contract | PactNet 5.0.1 (Pact spec v4, FFI-based; matching rules need the Pact plugins feature) | NuGet `PactNet` | `dotnet test --filter Contract` | Consumer-driven contracts published from test runs; provider verification in CI. v4 spec needs plugins for some matchers. |
| e2e | Playwright for .NET 1.63.0 | NuGet `Microsoft.Playwright` (+ `Microsoft.Playwright.Xunit.v3` or `.MSTest.v4` adapters) | `playwright.ps1 test` / `dotnet test` | Chromium/WebKit/Firefox bundled via `playwright.ps1 install`; trace viewer for failures. |
| smoke | Filtered xUnit/MSTest trait subset + Playwright smoke project | n/a | `dotnet test --filter Category=Smoke` | App boots, health endpoint, one happy-path E2E per release surface. |
| regression | Full suite (unit + integration) on every PR; E2E nightly | n/a | `dotnet test` | Bugs get a failing regression case first; xUnit parallelization (4.0) keeps runtime sane. |
| flakiness | Microsoft.Testing.Extensions.Retry 2.3.3 (MTP) + NUnit `[Retry]`/`[Repeat]` | NuGet | `dotnet test -- --retry-failed-tests 3` | MTP retry reruns failed tests and reports separate flaky/retried counts (2.4.0+); NUnit `[Retry(n)]` reruns a single test method on assertion failure. Pair with randomized test order to surface order-dependent flakiness. |
| acceptance-bdd | Reqnroll 3.3.4 (SpecFlow successor) | NuGet `Reqnroll` | `dotnet test` | Supports xUnit v3, MSTest 4, NUnit 4, TUnit backends; Gherkin features + step definitions. |
| snapshot-approval | Verify 33.3.3 (+ Verify.Xunit 31.12.5 / Verify.MSTest / Verify.NUnit) | NuGet | `dotnet test` | Object/JSON/HTML/PDF snapshots with scrubbers. Licensing note: source stays MIT, but official binary releases from August 2026 expect a small subscription for commercial organizations/government; verify current terms (issue #1731) before adopting in a commercial repo. |
| characterization | Verify snapshots over wrapped legacy outputs | NuGet | `dotnet test` | Golden-file the legacy behavior before refactor; approval workflow handles review. |
| combinatorial | xUnit v3 Theory (`InlineData`/`MemberData`/`ClassData`); NUnit `[Combinatorial]`/`[Pairwise]` | Bundled with framework | `dotnet test` | Prefer `MemberData` for non-trivial tuples; keep data generators side-effect free. |
| property-based | FsCheck 3.4.0 (`FsCheck.Xunit`, `FsCheck.Xunit.v3`, `FsCheck.NUnit`); CsCheck 4.9.1 | NuGet | `dotnet test` | FsCheck for F# and C# with shrinking; CsCheck is C#-first with PCG-based generation/shrinking and no Arb boilerplate. |
| model-based | CsCheck `SampleModelBased`; FsCheck state-machine properties | NuGet | `dotnet test` | Both ship model-based support; CsCheck also has built-in metamorphic/parallel/equality testing. |
| metamorphic | CsCheck `SampleMetamorphic` | NuGet | `dotnet test` | Run the same transformation two ways and assert equality; useful for financial calculations (rebalancing, FX conversion) where a model is hard. |
| differential | FsCheck 3.4.0 / CsCheck 4.9.1 comparing two implementations on generated inputs | NuGet | `dotnet test` | Run the old and new implementation (or two libraries) against the same FsCheck/CsCheck-generated inputs and assert equal outputs; see `references/types-input-generation.md` for generator setup. |
| fuzz | SharpFuzz v2.2.0 (libFuzzer for .NET) | NuGet / `dotnet tool` | standalone fuzz target binary | Runs libFuzzer in-process on .NET assemblies; nightly or targeted on parsers/deserializers, not PR gates. |
| mutation | Stryker.NET: `dotnet-stryker` 5.0.0 (needs .NET 10 tool runtime) or 4.16.0 | `dotnet tool install -g dotnet-stryker` | `dotnet stryker` | Nightly mutation run with HTML dashboard; PRs use incremental runs only. Mutation score gates assertions, not builds. |
| coverage | coverlet 10.1.0 (collector/msbuild/console/MTP variants) | NuGet `coverlet.collector` | `dotnet test --collect:"XPlat Code Coverage"` | coverlet.MTP publishes MTP coverage messages; enforce per-project thresholds; Cobertura output for CI reporters. |
| benchmark | BenchmarkDotNet 0.15.8 (0.16.0 in preview) | NuGet | `dotnet run -c Release -- --filter *` | Statistical rigor, memory diagnoser, disassembly; run on dedicated CI agents, never shared runners. Roslyn analyzers catch misuse at compile time (BDN15xx). |
| load | NBomber 6.7.0 | NuGet | `dotnet run --project LoadTests` | Scenario-based load/stress/soak in C#/F#; nightly against a staging environment, never production. |
| accessibility | Playwright .NET ARIA snapshots + axe-core injected via script | NuGet `Microsoft.Playwright` | via Playwright run | Playwright removed its `Page.Accessibility` API (v1.57); use axe-core (`axe.min.js` injection) or Deque's axe packages and assert on violations. |
| visual-regression | Playwright screenshot assertions (`toHaveScreenshot`, ARIA snapshots) | NuGet | via Playwright run | Pin browser versions; Playwright ships deterministic builds (Chromium 153 / Firefox 155 / WebKit 26.6 era). |
| cross-browser | Playwright .NET (Chromium, Firefox, WebKit) | NuGet | `--browser` matrix in CI | Run the E2E suite across all three engines nightly; Chromium-only on PRs. |
| i18n | xUnit Theory over `CultureInfo` + resource-file tests; `dotnet test` matrix with culture env | Bundled | `dotnet test` | Cover currency/number/date formatting and Razor localized strings; see `references/types-nonfunctional.md` for the i18n checklist. |
| sast | Roslyn analyzers + SonarCloud/SonarQube or Semgrep; DevSkim | CLI/service | CI job | Security rules ride on the analyzers (`CA2100` SQL injection etc.); SonarQube adds taint analysis. |
| sca | NuGet Audit (built into restore) + `dotnet list package --vulnerable --include-transitive`; NU1901-NU1904 warnings | SDK built-in (.NET 8+; NuGetAuditMode=all default on net10.0) | `dotnet restore` / `dotnet list package --vulnerable --include-transitive` | Configure `NuGetAuditLevel` (low/moderate/high/critical) and `NuGetAuditSuppress` for triaged advisories; treat NU1903/NU1904 as errors in a dedicated audit pipeline. Microsoft Learn documents the full CI pattern. |
| secrets | gitleaks (repo-wide) | `brew install gitleaks` | `gitleaks detect --no-banner` | Also catches committed `appsettings` secrets and publish profiles. |
| authz | ASP.NET Core authorization-policy unit tests (`IAuthorizationService` + `ClaimsPrincipal`) + WebApplicationFactory with a test auth handler | Bundled | `dotnet test` | Policy tests are the compliance-critical row for regulated data: assert roles/claims map to allowed operations, and E2E asserts redirects for anonymous users. |
| db-migration | EF Core migrations applied in Testcontainers (`dotnet ef database update` or `Migrate()` at fixture startup) | NuGet | `dotnet test --filter Category=Migration` | Prove every migration runs on a fresh container AND on the production-shaped schema snapshot; pair with `dotnet ef migrations has-pending-model-changes` in CI. |
| ci-pipeline | MTP exit codes + result writers; JUnit/TRX/CTRF loggers for GitHub Actions/Azure DevOps | NuGet loggers | `dotnet test` in CI | MTP is the primary runner story going forward; VSTest-dependent tooling needs `Microsoft.NET.Test.Sdk` pinned or `UseVSTest`. |

### Not applicable

| TYPE ID | Reason |
|---|---|
| chaos | No mainstream .NET-native chaos tooling; for Azure-hosted systems use Azure Chaos Studio (ops layer), see `references/infra-iac-containers-ci.md`. |
| dast | OWASP ZAP runs against the deployed app, not the codebase; cross-reference the web/infra reference files. |
| iac-policy | Bicep/Terraform policy testing lives in `references/infra-iac-containers-ci.md` (PSRule, Checkov). |
| container-scan | Trivy/Grype scan images, not C# code; see `references/infra-iac-containers-ci.md`. |
| data-quality | Dataset validation belongs to the data reference; not a .NET-code concern. |
| docs-examples | No established doc-example runner for C#; keep README snippets verified manually or via a tiny xUnit test. |
| notebook | .NET Interactive notebooks are not a production surface here. |
| link-check | Repo-level tooling, language-agnostic. |
| exploratory | Human-led activities; not tool-runnable. |
| usability | Human-led activities; not tool-runnable. |

## Recommended default stack

1. xUnit v3 (4.x) as the unit framework, NSubstitute 6.x for mocks, Shouldly 4.3.0 or AwesomeAssertions (FluentAssertions 7/8 fork, Apache 2.0) for assertions. FluentAssertions v8+ moved to the Xceed Community License: free for non-commercial use, paid for commercial; v7 remains Apache 2.0 with bugfix-only maintenance. Pick the fork that matches your license position and stay on it.
2. WebApplicationFactory + Testcontainers for integration; bUnit for Blazor components.
3. Verify for snapshot/approval testing (note the 2026 commercial-binaries licensing change; Shouldly's `ShouldMatchApproved` is the fallback).
4. coverlet for coverage, Stryker.NET nightly for mutation, BenchmarkDotNet for benchmarks, NBomber for load.
5. Playwright .NET for E2E/visual/cross-browser; Reqnroll only where BDD scenarios are a real team artifact.
6. Moq remains widely deployed (4.21.0, releases resumed in 2026) but carries the 2023 SponsorLink telemetry controversy; prefer NSubstitute for new projects.

## Config snippets

xUnit v3 test project (`Test.csproj`):

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="xunit.v3" Version="4.0.2" />
    <PackageReference Include="Shouldly" Version="4.3.0" />
    <PackageReference Include="NSubstitute" Version="6.2.0" />
    <PackageReference Include="coverlet.collector" Version="10.1.0" />
  </ItemGroup>
</Project>
```

Testcontainers + WebApplicationFactory integration fixture:

```csharp
public sealed class PostgresFixture : IAsyncLifetime
{
    public PostgreSqlContainer Db { get; } = new PostgreSqlBuilder()
        .WithImage("postgres:17-alpine").Build();

    public Task InitializeAsync() => Db.StartAsync();
    public Task DisposeAsync() => Db.DisposeAsync();
}
```

Stryker config (`stryker-config.json`):

```json
{
  "stryker-config": {
    "project": "Payments.csproj",
    "reporters": ["html", "progress"],
    "threshold-high": 85,
    "threshold-low": 70,
    "threshold-break": 60
  }
}
```

NuGet audit hardening (`Directory.Build.props`):

```xml
<PropertyGroup>
  <NuGetAudit>true</NuGetAudit>
  <NuGetAuditMode>all</NuGetAuditMode>
  <NuGetAuditLevel>high</NuGetAuditLevel>
</PropertyGroup>
```

## Gotchas

- Runner migration: xUnit v3 4.0 and MTP v2 dropped VSTest support on .NET 10 SDK+; if your CI parses TRX/JUnit via VSTest loggers, either move to MTP result writers or pin `Microsoft.NET.Test.Sdk`.
- Assertion-library licensing: FluentAssertions 8 is licensed (Xceed) for commercial use; AwesomeAssertions and Shouldly are the Apache 2.0 paths. Decide once per repo; mixing forks causes dependency conflicts.
- Verify 31.x is the current line, but the project announced commercial licensing for official binaries (commercial orgs/government) from August 2026; review before adoption in a regulated commercial repo.
- bUnit 2.x requires .NET 8+; .NET Framework Blazor tests must stay on the 1.x line.
- Testcontainers needs a Docker-capable CI runner and pins image tags explicitly (best practice since 4.10); use reuse mode only for local dev, never CI.
- Stryker on large solutions is slow: scope by project and run nightly; the 5.0 tool requires the .NET 10 SDK runtime.
- Moq SponsorLink history: pin 4.21.x consciously, audit the dependency, or standardize on NSubstitute.
- Financial-calculation and authz tests are the must-have set for regulated (GLBA/SEC) repos: property-based/metamorphic tests on money math (CsCheck `Faster`/`SampleMetamorphic`), authorization policy tests, and audit-log assertions.

## Sources

- https://xunit.net/releases/v3/4.0.2
- https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-migration-v3-v4
- https://github.com/fluentassertions/fluentassertions/releases + https://xceed.com/fluent-assertions-faq/
- https://github.com/AwesomeAssertions/AwesomeAssertions
- https://github.com/shouldly/shouldly/releases
- https://github.com/nsubstitute/NSubstitute/releases
- https://github.com/bUnit-dev/bUnit/releases
- https://github.com/testcontainers/testcontainers-dotnet/releases
- https://github.com/VerifyTests/Verify/releases
- https://github.com/fscheck/FsCheck/releases and https://www.nuget.org/packages/CsCheck/
- https://github.com/Metalnem/sharpfuzz/releases
- https://www.nuget.org/packages/dotnet-stryker and https://github.com/stryker-mutator/stryker-net/releases
- https://github.com/coverlet-coverage/coverlet/releases
- https://github.com/dotnet/BenchmarkDotNet/releases
- https://www.nuget.org/packages/NBomber/
- https://github.com/microsoft/playwright-dotnet and https://www.nuget.org/packages/Microsoft.Playwright.MSTest.v4
- https://github.com/reqnroll/Reqnroll/releases
- https://github.com/pact-foundation/pact-net/releases
- https://learn.microsoft.com/nuget/concepts/auditing-packages and https://learn.microsoft.com/nuget/reference/errors-and-warnings/nu1901-nu1904
- https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests

Verified (2026-10-14): xunit.v3 4.0.2 + analyzers 2.2.0 + MTP v2/VSTest-on-.NET-10 guidance (xunit.net); NUnit 5.0.0 and MSTest 4.5.1 (NuGet flat container); FluentAssertions license split and AwesomeAssertions/Shouldly status (Xceed FAQ, release pages; v7 = Apache 2.0, v8 = Xceed Community License per repo LICENSE files); NSubstitute 6.2.0; bUnit 2.11.3; Testcontainers 4.16.0; Verify 33.3.3 + Verify.Xunit 31.12.5; FsCheck 3.4.0; CsCheck 4.9.1; SharpFuzz 2.2.0; dotnet-stryker 5.0.0/4.16.0; coverlet 10.1.0; BenchmarkDotNet 0.15.8; NBomber 6.7.0; Playwright 1.63.0 incl. adapters and Accessibility API removal; Reqnroll 3.3.4; PactNet 5.0.1; NuGet Audit properties/NU1901-1904 (Microsoft Learn). Microsoft.Testing.Extensions.Retry 2.3.3 and `--retry-failed-tests` (Microsoft Learn, NuGet Gallery); NUnit `[Retry]`/`RetryExceptions` (NUnit Docs). From memory, mark [unverified]: StyleCop.Analyzers exact version; Verify commercial-license...
