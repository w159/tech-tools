# Non-functional testing: benchmark, load, chaos, accessibility, visual-regression, cross-browser, i18n, usability (TYPE IDs: `benchmark`, `load`, `chaos`, `accessibility`, `visual-regression`, `cross-browser`, `i18n`, `usability`)

## Definition

Tests that assert on qualities other than functional correctness: speed, capacity under load, resilience to failure, accessibility conformance, visual fidelity, browser compatibility, localization, and real-user usability. Each needs its own oracle and its own runtime tier; most are too slow or too environment-sensitive for every PR.

## Benchmark (TYPE ID: `benchmark`)

Oracle = **comparison against a recorded baseline** (statistically checked), never a wall-clock guess. Run on quiet, pinned-CPU machines; benchmarks on shared CI runners are noise.

| Language | Tool (verified 2026-10-14 unless noted) | Notes |
|---|---|---|
| Python | pytest-benchmark | Per-test baselines with machine-readable storage; `--benchmark-autosave`, comparison in CI against saved JSON. |
| JS / TS | Vitest bench (built on tinybench) | `*.bench.ts` files run with `vitest bench`; result comparison like unit-test output. |
| .NET | BenchmarkDotNet | The .NET standard: statistical rigor, outlier detection, alloc columns; auto baselines for method comparisons. |
| Go | `go test -bench` (built in) | `-benchmem`, `b.ReportAllocs()`; `benchstat` (golang.org/x/perf) for before/after significance. |
| Rust | criterion | Statistical comparison vs previous run, noise thresholds, HTML charts; the Rust default. |
| JVM | JMH | The only JVM harness worth trusting (warmup, forked JVMs, blackhole); JUnit integration via jmhb/jmh-gradle-plugin. |
| Anything CLI | hyperfine | For shell scripts and binaries: warmup runs, statistical summary, `--export-json` comparisons. |

Rules: benchmark only stable internals (release builds, no debug/interpreter overhead); assert a **regression percentage** (fail if >10-20% slower than baseline) rather than absolute numbers; run the benchmark suite on a schedule or on perf-sensitive PRs only.

## Load testing (TYPE ID: `load`)

Oracle = **defined service-level thresholds** (p95/p99 latency, error rate, throughput) asserted by the tool or checked after the run. Distinguish five profiles and record which one a test is:

| Profile | Shape | Question it answers |
|---|---|---|
| Load | Expected peak traffic, sustained | Does the system meet SLOs at today's peak? |
| Stress | Ramping beyond expected until failure | Where and how does it break - graceful degradation or collapse? |
| Soak | Moderate load, hours (4-24h) | Memory leaks, connection/fd leaks, log growth, slow degradation |
| Spike | Idle then sharp burst, repeat | Autoscaling behavior, warm-up costs, queue overflow |
| Breakpoint | Steadily increasing until error rate explodes | Maximum capacity number, used for capacity planning |

| Tool | Language/config | Status (verified 2026-10-14 unless noted) | Notes |
|---|---|---|---|
| k6 (Grafana) | JavaScript test scripts | Active | `stages`/`scenarios` cover all five profiles; thresholds fail the run; good CLI/CI fit; k6 Cloud for distributed load. |
| Locust | Python | Active | Write scenarios in Python (reuse your app's models); distributed workers. |
| Gatling | Scala/Java DSL | Active | High-performance async core; enterprise + OSS editions; rich reports. |
| Artillery | YAML/JS | Active | Quick YAML scenarios; `arrivalRate`/`rampTo` phases for spike/ramp profiles. |
| Apache JMeter | GUI + XML | Active (long history) | Broadest protocol support (JDBC, LDAP, JMS); heaviest footprint; version in the 5.6.x line [unverified exact]. |
| NBomber | C#/.NET | Active | The .NET-native option; scenarios as C# code. |
| Azure App Testing (formerly Azure Load Testing) | Managed service running JMeter/Locust/Playwright scripts | Current per microsoft.com: Azure Load Testing is now Azure App Testing, same capabilities, up to 400 engine instances / ~100k virtual users / 24h tests | Managed distributed load; use when you need multi-region load without hosting generators. Earlier retirement-announcement rumors [unverified] - the service exists under the new name as of 2026-10-14. |

Strategy: load tests never run per-PR. Run load profile nightly or weekly against a production-like environment with monitoring attached (generator metrics alone lie); assert thresholds in CI on smoke-scale runs only. Alert if p99 drifts between scheduled runs - that trend is the capacity signal.

## Chaos engineering (TYPE ID: `chaos`)

Oracle = **the system's stated resilience behavior holds under injected failure** (retries succeed, circuit breaker opens, no data loss, failover completes within X). Hypothesis: "if dependency Y loses 30% of packets, requests still complete"; experiment: inject; abort condition: error budget breached.

| Tool | Scope | Notes |
|---|---|---|
| Toxiproxy (Shopify) | TCP proxies between test code and dependencies | The integration-test staple: add latency, bandwidth limits, connection resets, timeouts per proxy; small, deterministic, embeddable in CI. Best default for app-level fault injection. |
| Chaos Mesh | Kubernetes (CRD-based) | Pod kill, network delay/partition, disk IO stress, kernel faults; scheduled experiments with selectors. |
| LitmusChaos | Kubernetes | Chaos workflows/experiments library, GitOps-friendly; heavier operational surface. |
| Azure Chaos Studio | Azure managed fault injection | VM/process/network faults plus service-level faults for Azure resources; use for Azure-hosted estate with guardrails/role separation. |
| Polly Simmy (`.NET`) / app-level fault injection libs | In-process | Inject exceptions/latency at the HTTP client / dependency interface; pairs with resilience-policy tests. |

Strategy: start with Toxiproxy-style dependency failures in integration tests (fast, deterministic); move to Chaos Mesh/Litmus/Chaos Studio experiments in staging. Every chaos experiment needs: a hypothesis, a steady-state metric, an abort condition, and a written rollback. Never run destructive chaos on production without explicit human approval; in regulated estate, chaos runs are change events - log them.

## Accessibility testing (TYPE ID: `accessibility`)

Oracle = **axe-core rule conformance scoped to WCAG 2.2 Level AA**, plus manual review for what automation cannot see. WCAG 2.2 is a W3C Recommendation (Oct 2023).

| Tool | Layer | Notes |
|---|---|---|
| axe-core | Rule engine (Deque) | The engine everything below uses. Rules carry tags: `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`, `best-practice` - verified against axe-core API docs. Run with `runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] }` for AA coverage incl. 2.2. |
| @axe-core/playwright | Playwright integration | `AxeBuilder` per page/component; assert zero violations in e2e flows. |
| jest-axe | jest + jsdom/component tests | Cheapest tier: catch missing labels/roles at render time. |
| pa11y | CLI/CI page scans | Standalone crawler-style audits; good for a whole-site nightly scan. |
| Lighthouse CI | CI perf+a11y audit | Scores a11y category; note Lighthouse CI tooling itself is lightly maintained [unverified]; keep it as a trend signal, not the gate. |
| Accessibility Insights (Microsoft) | Guided manual assessment | FastPass (automated + tab stops) and full assessment; produces the evidence artifact for audit. |

What automation **cannot** catch (say this in every report): screen-reader experience quality, logical focus order under real keyboard use, meaningful link/button text ("click here"), cognitive load, content readability, contrast of dynamic overlays in real interaction, and whether a flow is actually usable. Automated axe checks cover roughly 30-40% of WCAG success criteria; pair them with periodic manual keyboard + screen-reader passes (Accessibility Insights assessment) and record both.

CI strategy: jest-axe on components per PR; @axe-core/playwright with AA tags on critical flows per PR or nightly; pa11y/Lighthouse site-wide nightly. Treat new violations as build failures; budget existing ones in an issue with an owner.

## Visual regression (TYPE ID: `visual-regression`)

Oracle = **pixel or DOM snapshot diff against an approved baseline**. Reviewer approves intentional changes; unexpected diffs fail.

| Tool | Notes (verified 2026-10-14 unless noted) |
|---|---|
| Playwright `toHaveScreenshot` | Built-in: `expect(page).toHaveScreenshot()` with per-test maxDiffPixelRatio/mask options; baselines committed per browser. The zero-infrastructure default. |
| Chromatic | Storybook's hosted service (Storybook maintainers); catches interaction + visual regressions with UI review workflow; paid for commercial use. |
| Percy (BrowserStack) | Hosted, SDK integrations, visual review UI. |
| BackstopJS | Self-hosted CLI (Puppeteer/Playwright); CI-friendly; niche now but maintained [status -unverified]. |
| Loki | Storybook-only diff runner; lightweight [maintenance status -unverified]. |

Rules: fix the rendering environment (fonts, animations off, deterministic time via fakes) or diffs are noise; use `mask` regions for dynamic content; component/story-level tests are far more stable than full-page; full-page screenshots nightly, components per PR.

## Cross-browser testing (TYPE ID: `cross-browser`)

Oracle = the functional/accessibility suite passes on each target browser matrix.

- Playwright projects: run the same suite across Chromium, Firefox, WebKit via `projects` config; WebKit coverage is the cheap proxy for Safari. Full matrix on PR smoke (or one browser), full matrix nightly.
- BrowserStack Automate / Sauce Labs: hosted real-browser grids (including real Safari/iOS); wire into CI when local WebKit emulation is not enough or for IE-legacy/enterprise targets.
- Keep the target matrix explicit and dated (client platforms matter: this estate serves advisors on macOS/iOS - include Safari/iOS explicitly).

## Internationalization (TYPE ID: `i18n`)

Oracle = **behavior invariants under locale change**, plus catalog conformance:

- **Pseudo-localization**: transform source strings (accents, padding `!!...!!`, doubled characters) into a fake locale; if padding is truncated or text overflows a layout, the UI is hard-coded-length sensitive. Tools: @formatjs pseudo-localization utilities for JS; frameworks (Android/iOS/.NET) have built-in pseudo-locale modes.
- **RTL**: run the suite in an RTL locale (ar, he) - Playwright can set `locale` and dir; assert layout mirroring and that bidi text does not corrupt numbers/codes.
- **ICU message tests**: pluralization/select rules per language - generate all plural categories for supported locales (CLDR categories vary: en has one/other, ru has four); assert the compiled message renders for each. Test placeholders survive translation by asserting ICU syntax validity of every catalog file in CI.
- Keep tests locale-independent: never assert on user-visible translated strings in shared functional tests; use translation keys or inject a deterministic test locale.

## Usability testing (TYPE ID: `usability`)

Human-led; no automation oracle. Say so in test-plan docs: scripted task sessions with representative users (advisors doing a review workflow), think-aloud protocol, measure task completion/time/error count; findings feed backlog items, not CI. Lightweight continuous proxy: record session analytics on task funnels in production (with consent and data-minimization per Reg S-P) and watch drop-off steps.

## PR vs nightly strategy

| Stage | Runs |
|---|---|
| PR | jest-axe; a11y-tagged e2e on critical flows; component visual snapshots; single-browser functional suite; unit benchmarks only if perf-sensitive path touched |
| Nightly | Full benchmark suite with regression assertion; load profile (rotating: load/stress/soak/spike/breakpoint weekly mix); site-wide pa11y/Lighthouse; full-page visual diffs; full browser matrix; Toxiproxy integration suite |
| Weekly / scheduled | Soak (4-24h); chaos experiment in staging; manual a11y keyboard/screen-reader pass on changed flows; cross-browser on hosted real devices |

## Interpreting results and thresholds

- Benchmarks: report delta % vs baseline with the tool's statistical check; fail > agreed regression bound. Never compare across machines.
- Load: every run names its profile and thresholds; a "pass" without p95/p99/error-rate numbers is not evidence. Track capacity (breakpoint result) as a trend.
- Chaos: pass = steady-state metric held + system auto-recovered within target; record aborted experiments as aborted, not passed.
- A11y: violations per page with WCAG tags; zero new violations is the gate; manual review findings tracked as issues. Report the automation/manual split honestly (audit evidence).
- Visual: diffs reviewed and approved/rejected within a day, or baselines rot.

## Regulated-data priority (Henssler Financial)

- Accessibility conformance on the client/advisor portal is both UX and legal risk (ADA/WCAG exposure); keep the automated+manual evidence trail.
- Load/soak tests against environments holding client data: use synthetic fixtures; if load scripts replay captured traffic, sanitize it first (PII under Reg S-P/GLBA).
- Chaos runs that touch data stores need change-management logging; tie experiment records to the incident-response evidence set (supports FTC Safeguards monitoring and Reg S-P amended incident-response expectations).

## Sources

- Benchmarks: https://pytest-benchmark.readthedocs.io/ ; https://vitest.dev/guide/features.html#benchmarking ; https://benchmarkdotnet.org/ ; https://golang.org/pkg/testing/#hdr-Benchmarks ; https://github.com/bheisler/criterion.rs ; https://github.com/openjdk/jmh ; https://github.com/sharkdp/hyperfine
- Load: https://grafana.com/docs/k6/ ; https://locust.io/ ; https://gatling.io/ ; https://artillery.io/ ; https://jmeter.apache.org/ ; https://github.com/NBomber/NBomber ; https://azure.microsoft.com/en-us/products/app-testing (Azure App Testing / Azure Load Testing FAQ)
- Chaos: https://github.com/Shopify/toxiproxy ; https://chaos-mesh.org/ ; https://litmuschaos.io/ ; https://learn.microsoft.com/azure/chaos-studio/
- A11y: https://www.deque.com/axe/core-documentation/api-documentation/ (axe tags incl. `wcag22aa`) ; https://github.com/dequelabs/axe-core-npm (@axe-core/playwright, jest-axe) ; https://pa11y.org/ ; https://accessibilityinsights.io/ ; https://www.w3.org/TR/WCAG22/
- Visual: https://playwright.dev/docs/test-snapshots ; https://www.chromatic.com/ ; https://percy.io/ ; https://github.com/garris/BackstopJS ; https://github.com/oblador/loki
- Cross-browser: https://playwright.dev/docs/browsers ; https://www.browserstack.com/ ; https://saucelabs.com/
- i18n: https://formatjs.io/docs/guides/pseudo-localization/ ; https://cldr.unicode.org/ (plural rules)

Verified: 2026-10-14 via web search/fetch - axe-core tag table including `wcag22aa` (Deque API docs), Azure Load Testing now Azure App Testing (microsoft.com FAQ: same capabilities, JMeter/Locust/Playwright support, engine/virtual-user/duration limits), WCAG 2.2 Recommendation status (W3C); also checked via registries this pass: k6 v2.3.0 (GitHub), Locust 2.46.7 (PyPI), tinybench 6.2.2 (npm), hyperfine 1.20.0 (GitHub). From memory / not re-verified: [unverified] exact current versions of pytest-benchmark, BenchmarkDotNet, criterion, JMH, JMeter (5.6.x line), NBomber, Toxiproxy, Chaos Mesh, LitmusChaos, BackstopJS and Loki maintenance status, Lighthouse CI maintenance status, @formatjs pseudo-localization tool specifics, Chromatic/Percy commercial terms.
