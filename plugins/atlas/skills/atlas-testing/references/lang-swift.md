# Swift testing reference

How Swift (iOS, macOS, server-side Swift Package Manager) maps to the atlas-testing taxonomy. TYPE IDs are the canonical ids from `references/taxonomy.md`; gap output references rows here. Simulator builds and Xcode test runs are executed via the atlas-test-xcode skill.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
|---|---|---|---|---|
| static-lint | SwiftLint 0.65.1; swift-format 604.0.0 | `brew install swiftlint` | `swiftlint`, `swift-format lint -r .` | Run SwiftLint first (configurable rules), swift-format second (Apple canonical style, version tracks toolchain). swift-format also runs as an Xcode build phase. |
| type-check | Swift 6.4 toolchain (`swift-6.4.0` released Sep 2026) | Ships with Xcode / swift.org toolchain | `swift build` (SPM) or `xcodebuild build` | Compile-time checking is the gate: enable strict concurrency, `SWIFT_STRICT_CONCURRENCY=complete` where applicable, and treat warnings as errors in CI. No separate type checker exists; the compiler is it. |
| unit | Swift Testing (bundled with Xcode 16+/Swift 6+; `swift-testing` 6.4.1) | Bundled; add as SPM dep only for pre-Xcode-16 | `swift test` (SPM), `xcodebuild test` (Xcode) | `@Test`, `#expect`, `#require`, `Issue.record`, parameterized `@Test(arguments:)`, traits, suites. Xcode 27 enables XCTest interoperability by default (limited mode); promote to complete/strict mode in the test plan. Keep XCTest for UI automation, performance metrics, and ObjC-exception tests. |
| integration | Swift Testing + XCTest; URLProtocol stubs / URLStubs for the network layer | Pointfree URLStubbing or hand-rolled URLProtocol | `swift test --filter Integration` | Real-container integration is rare for iOS apps; most integration tests fake the network with `URLProtocol` and exercise the full app/feature layer. Server-side Swift (Vapor etc.) tests against a live instance. |
| component | ViewInspector 0.10.5 (SwiftUI); XCTest for UIKit view controllers | SPM/CocoaPods test-target only | via `swift test` / `xcodebuild test` | ViewInspector introspects SwiftUI view trees, state (`@State`, `@Binding`, `@Observable`), and triggers callbacks. Tracks new iOS releases closely (iOS 26/27 support current). Do not add to the main target. |
| api | URLSession tests via `URLProtocol` mocking; contract tools absent | stdlib | `swift test` | No mainstream Pact-for-Swift. For service teams, API behavior is covered by stub-based API-layer tests; true contract testing lives in the backend repo (see `references/types-functional.md`). |
| contract | Not applicable (see Not applicable list) | | | |
| e2e | XCUITest (ships with Xcode 27) | Bundled | `xcodebuild test -destination 'platform=iOS Simulator,...'` | UI automation only exists in XCTest; do not migrate XCUITest suites to Swift Testing. Route simulator/xcodebuild execution to the atlas-test-xcode skill. |
| smoke | Swift Testing suite tagged or filtered as smoke | Bundled | `xcodebuild test -only-testing:...SmokeTests` or `swift test --filter Smoke` | Small app-launch + critical-path set; run on every CI build, not nightly. |
| regression | Full suite re-run before release; Swift Testing regression traits | Bundled | `swift test` / `xcodebuild test` | Bugs get a failing parameterized case first; keep cases cheap and parallel. |
| snapshot-approval | pointfree swift-snapshot-testing 1.19.6 | SPM `pointfreeco/swift-snapshot-testing` | via `xcodebuild test` / `swift test` | View, VC, image, and Codable snapshots; records Swift Testing attachments natively (1.19+). Uses local diff tools during review; pass `record:` explicitly rather than a global recording flag. |
| characterization | swift-snapshot-testing for output goldens; plain Swift Testing for wrapped-legacy behavior | Same | `swift test` | Wrap untested legacy code with snapshot/golden output before refactoring. |
| combinatorial | Swift Testing parameterized tests (zip/cross-product argument collections) | Bundled | `swift test` | `@Test(arguments:)` accepts multiple collections; Swift Testing pairs them combinatorially and runs cases in parallel. |
| property-based | SwiftCheck 0.12.0 (typelift; last release 2019, stale) | SPM `typelift/SwiftCheck` | via `swift test` | Shrinks failing inputs; fine for parser/model invariants. Effectively unmaintained (no release since 2019); pin the version and expect toolchain fixes on your side. |
| mutation | Muter (effectively unmaintained; last tagged release years old, near-zero commit activity as of 2026) | `brew install muter-mutation-testing/formulae/muter` | `muter` | Treat as archived: expect toolchain breakage with Swift 6. Prefer mutation-review practice (coverage-guided assertion review) and keep any Muter runs strictly nightly/offline. Do not block PRs on it. |
| coverage | xccov (bundled with Xcode), llvm-cov (SPM) | Bundled | `xcodebuild test -enableCodeCoverage YES` then `xccov view --report <xcresult>`; SPM: `swift test --enable-code-coverage`, profdata under `.build/debug/codecov` | Enforce per-target minimums in CI rather than a global number. |
| flakiness | xcodebuild retries (`-retry-tests-on-failure`, `-test-iterations`), Swift Testing time-limit traits | Bundled | `xcodebuild test -retry-tests-on-failure -test-iterations 3` | Simulator flake sources: keyboard/focus, animations, network reachability. Fix root causes; retries are a CI bandage. |
| benchmark | XCTest performance APIs: `XCTMetric`, `XCTOSSignpostMetric`, `measure { }` | Bundled (XCTest only) | via `xcodebuild test` | Performance measurement is XCTest-only, another reason to keep an XCTest target alive. Compare against baselines committed per device model. |
| accessibility | `XCUIApplication.performAccessibilityAudit(for:_:)` (XCUITest) | Bundled | inside XCUITest run | iOS 17+. Audit types (contrast, element detection, hit region, etc.) can be selected; use the issue handler to skip known-acceptable findings. Also audit colors in CI via snapshots. |
| visual-regression | pointfree swift-snapshot-testing (screen/VC/image) | Same as snapshot-approval | via test run | Same tooling as snapshot-approval; pin simulator model + OS to avoid pixel noise. |
| i18n | Xcode scheme launch arguments (`-AppleLanguages (ar)`) and pseudo-localization; localized-string unit tests | Bundled | via `xcodebuild test` | Run the smoke suite under a pseudo/localized language in the nightly job; assert keys resolve for all tables in unit tests. |
| sast | Xcode static analyzer; Semgrep (Swift support); SonarQube | Xcode setting / semgrep CLI | `xcodebuild` static analysis or `semgrep --config auto .` | Static analyzer runs inside builds; enable analyze schemes in CI. SwiftLint is style, not SAST. |
| sca | No first-class SwiftPM vulnerability scanner. Use GitHub Dependabot (CocoaPods/SPM support varies), Snyk, or check advisories manually | n/a | n/a | Marked `could` priority; no equivalent of `dotnet list package --vulnerable` exists for SwiftPM. Keep dependencies pinned and reviewed. |
| secrets | gitleaks (language-agnostic repo scan) | `brew install gitleaks` | `gitleaks detect --no-banner` | Catches keys in Info.plist, entitlements, and test fixtures; run in CI. |
| db-migration | Core Data/GRDB migration tests via Swift Testing | Bundled / SPM | `swift test` | Load a store from a prior schema version fixture and assert the migration completes. Critical for any shipped app with local persistence. |
| ci-pipeline | GitHub Actions (`swiftlang/setup-swift`, macOS runners), Xcode Cloud, Fastlane | n/a | n/a | Gate PRs on lint + unit + smoke; nightly runs UI, mutation review, benchmarks, i18n. |

### Not applicable

| TYPE ID | Reason |
|---|---|
| contract | No mature Pact/contract tooling for Swift; contract verification happens in the API's own repo. |
| acceptance-bdd | No maintained Cucumber-equivalent; spec-style is Quick/Nimble but not BDD acceptance. |
| metamorphic | No mainstream tooling; only SwiftCheck covers a slice (property-based). |
| differential | No mainstream tooling; only SwiftCheck covers a slice (property-based). |
| model-based | No mainstream tooling; only SwiftCheck covers a slice (property-based). |
| fuzz | No libFuzzer/AFL harness for Swift in practice. |
| load | iOS/macOS clients are not load targets; backend load testing belongs to the service stack. |
| chaos | No mainstream fault-injection tooling for Apple platforms. |
| cross-browser | Not web (unless using WKWebView-backed surfaces; then see web references). |
| dast | Not web (unless using WKWebView-backed surfaces; then see web references). |
| iac-policy | Infrastructure concerns; see `references/infra-iac-containers-ci.md`. |
| container-scan | Infrastructure concerns; see `references/infra-iac-containers-ci.md`. |
| data-quality | No established Swift-specific practice; use repo-level tooling. |
| docs-examples | No established Swift-specific practice; use repo-level tooling. |
| notebook | No established Swift-specific practice; use repo-level tooling. |
| link-check | No established Swift-specific practice; use repo-level tooling. |
| exploratory | Human-led activities; not tool-runnable. |
| usability | Human-led activities; not tool-runnable. |

## Recommended default stack

1. Swift Testing as the primary framework for new unit/parameterized/component tests; keep an XCTest target for XCUITest, performance metrics, and anything interoperability cannot carry.
2. pointfree swift-snapshot-testing for SwiftUI view regressions and goldens.
3. ViewInspector for SwiftUI component state assertions where snapshots are too coarse.
4. SwiftLint + swift-format on PR; strict-concurrency compiler settings as warnings-as-errors.
5. xcodebuild with code coverage + xccov thresholds in CI; -retry-tests-on-failure for flake management (with flake tracking).
6. Nightly: full XCUITest suite, accessibility audits via performAccessibilityAudit, benchmarks (XCTMetric), i18n smoke under pseudo-localization.
7. Muter only as an occasional audit; do not wire it into PR gates.

## Config snippets

Swift Testing parameterized test:

```swift
import Testing
@testable import App

struct CurrencyFormatterTests {
    @Test(arguments: ["en_US", "de_DE", "ja_JP"], [0, 1234.5, -1])
    func formatsAmount(locale: String, amount: Decimal) {
        #expect(CurrencyFormatter(locale: locale).string(from: amount) != nil)
    }
}
```

Xcode coverage + retry from CI:

```bash
xcodebuild test \
  -project App.xcodeproj -scheme App \
  -destination 'platform=iOS Simulator,name=iPhone 17,OS=latest' \
  -enableCodeCoverage YES \
  -retry-tests-on-failure -test-iterations 3 \
  -resultBundlePath Test.xcresult
xccov view --report Test.xcresult
```

SwiftLint config (`.swiftlint.yml`):

```yaml
opt_in_rules:
  - accessibility_label_for_image
  - empty_count
line_length:
  warning: 120
excluded:
  - .build
```

## Gotchas

- Simulator variance: snapshot tests differ across simulator models and OS versions; pin the destination and generate goldens on the same CI image used for runs.
- Swift Testing vs XCTest split: parameterized tests, exit tests (`#expect(processExitsWith:)`, macOS/Linux/FreeBSD/Windows only, not iOS), and parallel-by-default belong to Swift Testing; XCUITest and XCTMetric stay in XCTest. Xcode 27 interop defaults to limited mode; consider strict mode after migration.
- Swift Testing tests run in parallel by default; tests that mutate global state (Core Data stack, singletons) need `.serialized` traits or isolation.
- xcodebuild timing: UI tests dominate CI time; keep PR pipelines to smoke + unit, push full UI suites to nightly.
- Regulated-data projects (client PII): prioritize authz/permission tests and data-at-rest (Core Data encryption) migration tests over UI pixel tests.
- swift-format versions track the toolchain (604 = Swift 6.4); do not pin a swift-format version older than the toolchain.

## Sources

- https://developer.apple.com/documentation/testing
- https://developer.apple.com/documentation/xcuiautomation/xcuiapplication/performaccessibilityaudit(for:_:)
- https://github.com/swiftlang/swift-testing/releases
- https://github.com/pointfreeco/swift-snapshot-testing/releases
- https://github.com/nalexn/ViewInspector/releases
- https://github.com/typelift/SwiftCheck/releases
- https://github.com/muter-mutation-testing/muter (releases, SPI maintenance score)
- https://github.com/realm/SwiftLint/releases
- https://github.com/swiftlang/swift-format/releases
- https://formulae.brew.sh/formula/swiftlint

Verified (2026-10-14): Swift Testing bundled status, interoperability modes, parameterized and exit tests, 6.4.0 release (GitHub releases); swift-snapshot-testing 1.19.6, ViewInspector 0.10.5, SwiftCheck 0.12.0, SwiftLint 0.65.1, swift-format 604.0.0, Muter maintenance status (GitHub/Swift Package Index/Homebrew); performAccessibilityAudit signature (Apple docs); xccov/`-retry-tests-on-failure` usage from Apple tooling documentation. From memory, mark [unverified]: exact Xcode 27 build numbers, Snyk SwiftPM coverage details.
