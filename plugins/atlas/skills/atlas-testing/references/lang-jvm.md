# JVM testing (Java and Kotlin)

Language-specific tooling for testing Java and Kotlin code on the JVM. For type definitions and procedures see `workflow.md`. Versions verified 2026-10-14 unless marked `[unverified]`.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install (dependency coordinates) | Run | Notes |
| --- | --- | --- | --- | --- |
| static-lint | detekt 1.23.x `[unverified minor]` (Kotlin), SpotBugs 4.9.x `[unverified minor]`, Error Prone (+NullAway for nullability) | `io.gitlab.arturbosch.detekt` plugin / `com.github.spotbugs` plugin / `com.google.errorprone` deps | `./gradlew detekt`, `./gradlew spotbugsMain` | JUnit docs recommend Error Prone + NullAway to check JSpecify nullability used since JUnit 6. |
| type-check | javac / kotlinc strict; no separate tool | none | `./gradlew compileJava compileKotlin` | Enable Werror/compiler strictness via Gradle JavaCompile options. |
| unit | JUnit 6 (6.1.3 current; 6.0.0 GA 2025-09-30) + AssertJ + Mockito 5.x `[unverified minor]` / MockK 1.14.x | `org.junit:junit-bom:6.1.3`, `org.assertj:assertj-core`, `org.mockito:mockito-core` / `io.mockk:mockk` | `./gradlew test` | JUnit 6 baseline: Java 17, Kotlin 2.2 (wiki says 2.1), single version across Platform/Jupiter/Vintage; Vintage deprecated. Nearly drop-in from 5.x. |
| integration | Testcontainers (org.testcontainers, 2.0.5) | `org.testcontainers:junit-jupiter`, `...:postgresql` modules | part of gradle test | Per-class containers or reusable singleton containers; Docker required. |
| component | Spring Boot test slices: `@WebMvcTest`, `@DataJpaTest`, `@JsonTest` | `org.springframework.boot:spring-boot-starter-test` | `./gradlew test` | Slice loads only relevant beans; fast; use `@Import` for collaborators. |
| api | `@SpringBootTest` + `MockMvc` or `TestRestTemplate`; JUnit 5 provider tests via Pact | spring-boot-starter-test | `./gradlew test` | Full context for contract verification and security config. |
| contract | Pact JVM 4.7.5 (active, Aug 2026) | `au.com.dius.pact.consumer:junit5`, `au.com.dius.pact.provider:junit5` / `spring` | `./gradlew test` | V4 spec, Kotlin consumer DSL, Spock module, plugins; Broker workflows via `pact-broker` tasks/annotations. |
| e2e | language-agnostic (Playwright, Selenium via JVM is legacy choice) | n/a | n/a | Prefer driving Playwright from TS/Python; Selenium ok when JVM-locked. |
| smoke | JUnit `@Tag("smoke")` + Gradle test filtering | none | `./gradlew test --tests '*' -DexcludeTags=smoke` | Surefire/Failsafe 3.x+ required under JUnit 6. |
| regression | full suite + PIT history (incremental) | none | `./gradlew test` | Keep suite deterministic; see `types-test-quality.md`. |
| acceptance-bdd | Cucumber-JVM (`io.cucumber:cucumber-junit-platform-engine`) | cucumber-jvm deps | `./gradlew cucumberTest` | Gherkin + step defs; parallel via configuration-parameter. |
| snapshot-approval | approvaltests-java `[unverified minor]` | `com.approvaltests:approvaltests` | part of test run | Snapshot/approve pattern; alternative: build golden files with AssertJ. |
| characterization | golden files + full suite | none | n/a | Pin legacy behavior before refactoring; see `types-test-quality.md`. |
| property-based | jqwik 1.9.x `[unverified minor]` | `net.jqwik:jqwik` | `./gradlew test` | Integrates with JUnit Platform; shrinks failing cases; Kotlin via jqwik-kotlin. |
| fuzz | Jazzer v0.30.0 (libFuzzer for JVM, CI flags 2026) | `com.code-intelligence:jazzer-junit5` or Jazzer distribution | `jazzer --cp=... <fuzz_class>` | Coverage-guided; hooks for expression injection, unsafe deserialization; OSS-Fuzz supported. |
| metamorphic | implement as jqwik properties (invariant transforms) | none | n/a | e.g. serialize/parse round trip. |
| combinatorial | jqwik combinators over exhaustive arbitraries | none | n/a | Prefer jqwik over hand-rolled cartesian loops. |
| differential | tests comparing implementations | none | n/a | Useful for ORM/serialization parity across versions. |
| model-based | jqwik stateful properties (chains API) `[unverified API]`; check ArchUnit for structural invariants (see static-lint row below) | none | n/a | Model state transitions then assert invariants after random command sequences. |
| mutation | PIT (pitest) 1.30.1 | pitest-maven / pitest Gradle plugin | `mvn org.pitest:pitest-maven:mutationCoverage` / `./gradlew pitest` | Line-coverage-filtered mutants; history feature for incremental runs; flaky-test-tolerant timeout model. |
| coverage | JaCoCo 0.8.15 | `org.jacoco` agent via Gradle/Maven plugins | `./gradlew jacocoTestReport` | Line/branch coverage; XML for CI gates; PIT uses it as an engine prerequisite. |
| flakiness | JUnit 6 + retries via extension, Testcontainers singleton containers | none | rerun with fixed seed | Use JUnit deterministic ordering defaults; detect via repeated `-Dtests.seed` reruns. |
| benchmark | JMH 1.37 `[unverified minor]` | `org.openjdk.jmh:jmh-core` + annotation processor | `./gradlew jmh` or maven-shade + exec | Always fork JVMs, warmups, profilers; never gate on wall-clock in unit runs. |
| load | Gatling 3.x `[unverified minor]` | `io.gatling:gatling-http` / gatling Gradle plugin | `./gradlew gatlingRun` | Scala DSL scenarios; reports as HTML; nightly or pre-release only. |
| chaos | no canonical JVM tool; chaos-monkey-spring-boot `[unverified status]` | optional dep | run in staging | Kill latency and errors in Spring apps; treat as experiment, not gate. |
| accessibility | language-agnostic (axe-core via Playwright) | n/a | n/a | see `types-nonfunctional.md`. |
| visual-regression | language-agnostic (Playwright screenshots) | n/a | n/a | see `types-nonfunctional.md`. |
| cross-browser | language-agnostic | n/a | n/a | see `types-nonfunctional.md`. |
| i18n | no canonical tool; unit-test ResourceBundle completeness | none | `./gradlew test` | Assert all locales resolve keys, formats, plural rules. |
| sast | SpotBugs + Error Prone; optional semgrep `[unverified]` | plugins | `./gradlew spotbugsMain` |OWASP checker plugin for SpotBugs adds security rules. |
| sca | OWASP dependency-check (`org.owasp.dependencycheck` plugin) | Gradle/Maven plugin | `./gradlew dependencyCheckAnalyze` | NVD-backed SBOM analysis; complement with Gradle versions or Renovate for upgrades. |
| secrets | gitleaks (language-agnostic) | binary | `gitleaks detect --redact` | see `types-security.md`. |
| dast | language-agnostic | n/a | n/a | see `types-security.md`. |
| iac-policy | cross-ref `infra-iac-containers-ci.md` | n/a | n/a | |
| container-scan | cross-ref `infra-iac-containers-ci.md` (trivy for images) | n/a | n/a | |
| authz | Spring Security Test: `@WithMockUser`/`@WithSecurityContext` in MockMvc tests | spring-security-test | `./gradlew test` | Enumerate roles x endpoints; ArchUnit can enforce that controllers stay behind security config. |
| data-quality | cross-ref `data-sql-databases.md` | n/a | n/a | |
| db-migration | Flyway/Liquibase verified with Testcontainers (tempdbs per module) | testcontainers + flyway deps | `./gradlew test` | Assert migrations apply on empty and prod-like databases. |
| docs-examples | n/a first-class (javadoc snippets not executed); JUnit-based tutorials require separate runners | n/a | n/a | Prefer code samples extracted from real tests. |
| notebook | n/a | n/a | n/a | see `docs-notebooks-web-assets.md`. |
| link-check | language-agnostic | n/a | n/a | see `docs-notebooks-web-assets.md`. |
| ci-pipeline | GitHub Actions `actions/setup-java` + Gradle/Maven caching | workflow YAML | test, jacoco, pitest (nightly), gatling (nightly) | Surefire 3.x+ for JUnit 6; parallelize with Gradle max-workers and JUnit parallel config. |
| exploratory | human-led | n/a | n/a | see `types-functional.md`. |
| usability | human-led | n/a | n/a | see `types-functional.md`. |

Structural/architecture checks also worth wiring as static tests: ArchUnit 1.4.x `[unverified minor]` (`com.tngtech.archunit:archunit-junit5`) enforces layering and package rules as JUnit tests.

## Recommended default stack

JUnit 6 (JUnit Platform) with AssertJ assertions and Mockito (Java) or MockK (Kotlin) for unit work; Spring Boot test slices for component isolation; Testcontainers for integration; Pact JVM where services talk over HTTP/messages; jqwik for properties; Jazzer nightly on parsers; PIT for mutation scores on money- and authorization-critical modules; JaCoCo for coverage reporting; detekt + SpotBugs + Error Prone as static gates; OWASP dependency-check for dependencies; Gatling for load; Kotest 6.2.6 (Kotlin-first: specs, assertions, and property testing on the JUnit Platform) when the codebase is Kotlin-first.

Why: single JUnit Platform entry point for all test types, everything above actively maintained (Pact JVM 4.7.5 and PIT 1.30.1 shipped in 2026, JUnit 6.0.0 shipped Sept 2025 with a near drop-in upgrade path), and Spring Boot's slices give component isolation without container spin-up.

## Config snippets

Gradle: JUnit 6 BOM + basic deps (Kotlin DSL):

```kotlin
dependencies {
    implementation(platform("org.junit:junit-bom:6.1.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.assertj:assertj-core")
    testImplementation("org.mockito:mockito-core") // Kotlin: io.mockk:mockk
    testImplementation("org.testcontainers:junit-jupiter")
    testImplementation("org.testcontainers:postgresql")
    testImplementation("net.jqwik:jqwik")
    testImplementation("au.com.dius.pact.consumer:junit5")
    testImplementation("com.code-intelligence:jazzer-junit5")
}

tasks.test {
    useJUnitPlatform()
    excludeTags("slow", "smoke")
    finalizedBy(tasks.jacocoTestReport)
}
```

pitest (Maven snippet; keep scope narrow for CI speed):

```xml
<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>1.30.1</version>
  <configuration>
    <targetClasses><param>com.henssler.finance.*</param></targetClasses>
    <targetTests><param>com.henssler.finance.*</param></targetTests>
    <mutators><mutator>DEFAULTS</mutator></mutators>
    <coverageThreshold>70</coverageThreshold>
    <mutationThreshold>60</mutationThreshold>
  </configuration>
</plugin>
```

Jazzer quickstart (standalone fuzz target class):

```java
import com.code_intelligence.jazzer.api.FuzzedDataProvider;
class ParseFuzz {
  static void fuzzerTestOneInput(FuzzedDataProvider data) {
    byte[] raw = data.consumeRemainingAsBytes();
    Parser.parse(raw); // must not throw internal exceptions
  }
}
```

JaCoCo + dependency-check (Gradle):

```kotlin
plugins { jacoco; id("org.owasp.dependencycheck") }
jacoco { toolVersion = "0.8.15" }
tasks.dependencyCheckAnalyze { reports.xml.required = true }
```

## Gotchas

- JUnit 6 requires Java 17+ (Kotlin 2.1/2.2 per release notes vs wiki) and one version number for Platform/Jupiter/Vintage; Vintage is deprecated and JUnit 4 tests should migrate or run elsewhere. `junit-platform-runner` and `junit-platform-suite-commons` were removed.
- Surefire/Failsafe below 3.0.0 no longer works with JUnit 6; bump plugins when you bump JUnit.
- PIT mutates bytecode: annotation processors (Lombok, MapStruct, Quarkus Jacoco extension) sometimes interfere; PIT auto-disables the Quarkus Jacoco extension (1.25.6+).
- Spring test slices are context-cached; @SpringBootTest per test class is slow. Use @WebMvcTest/@DataJpaTest unless full context is needed, and share Testcontainers via singleton containers.
- Gatling runs in a Scala runtime: treat its scenarios as a separate CI module, do not mix into the unit build.
- Jazzer findings are crashes, not test failures; keep a crash/ corpus directory in git and replay seeds in normal JUnit runs.
- MockK's relaxed mocks and Mockito's inline mock maker require matching Java agent config in newer JDKs (bytecode-agent warnings); set `-XX:+EnableDynamicAgentLoading` deliberately or upgrade configs.
- OWASP dependency-check is NVD-rate-limited; cache the database between CI runs or the job crawls.
- Coverage thresholds: keep line-coverage gates in CI and run PIT with its own thresholds on the changed modules only (history feature) to stay fast.
- Pact JVM supports spec v4 with plugins; verification runs need your provider reachable; use `pact.provider.junit` annotations or the Spring module.

## Sources

- https://docs.junit.org/6.0.0/release-notes and https://docs.junit.org/6.1.3/ (JUnit 6 GA 2025-09-30, baselines)
- https://github.com/junit-team/junit-framework/wiki/Upgrading-to-JUnit-6.0
- https://github.com/pact-foundation/pact-jvm/releases (4.7.5) and https://docs.pact.io/implementation_guides/jvm/changelog
- https://github.com/CodeIntelligenceTesting/jazzer/releases (v0.30.0)
- https://github.com/hcoles/pitest/releases (1.30.1) and https://mvnrepository.com/artifact/org.pitest/pitest
- https://github.com/kotest/kotest/releases (6.2.6, Oct 2026)
- https://jqwik.net (property testing), https://assertj.github.io
- https://site.mockito.org, https://mockk.io
- https://testcontainers.com
- https://www.jacoco.org/jacoco, https://www.gatling.io
- https://jeremylong.github.io/DependencyCheck, https://spotbugs.github.io, https://errorprone.info, https://detekt.dev
- https://cucumber.io/docs/cdd (Cucumber-JVM)

Verified: confirmed 2026-10-14 via web: JUnit 6.0.0 GA (2025-09-30, Java 17 baseline, 6.1.3 current), Pact JVM 4.7.5 active (Aug 2026), Jazzer v0.30.0, PIT 1.30.1, Kotest 6.2.6, MockK 1.14.x line, JaCoCo 0.8.15, Testcontainers 2.0.5, Pact Ruby standalone wrapper model. From memory, flagged unverified: AssertJ/Mockito/jqwik/JMH/Gatling/detekt/SpotBugs/ArchUnit/approvaltests/chaos-monkey minor versions.