# PHP Testing

Covers PHPUnit/Pest projects, Laravel applications, and Symfony services. Deep dives in `types-*.md`; database specifics in `data-sql-databases.md`; infra/CI in `infra-iac-containers-ci.md`.

Regulated context (FTC Safeguards, SEC Reg S-P, GLBA): prioritize Policy/Gate (authz) tests, financial-calculation property and regression tests, and coverage gates; Psalm taint analysis is cheap insurance on request handling.

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
|---|---|---|---|---|
| static-lint | PHP-CS-Fixer 3.95.x (or PHP_CodeSniffer); Rector 2.7.0 for upgrades | `composer require --dev friendsofphp/php-cs-fixer` | `vendor/bin/php-cs-fixer fix --dry-run --diff` | Rector in CI as `rector process src --dry-run` flags upgrade opportunities without applying them |
| type-check | PHPStan 2.3.1 (or Psalm 6.x, 7.0-rc published 2026-10) | `composer require --dev phpstan/phpstan` | `vendor/bin/phpstan analyse src --level=max` | One primary; Psalm also does taint analysis (security). Baseline legacy errors, tighten over time |
| unit | PHPUnit 13.4.2 (PHP >= 8.4; 12.x for PHP 8.3) or Pest 5.3.2 | `composer require --dev phpunit/phpunit` | `vendor/bin/phpunit` | PHPUnit 13: new array assertions, sealed test doubles; Pest 5 is a layer over PHPUnit with a nicer API |
| integration | PHPUnit/Pest + real DB (docker compose or RefreshDatabase) | none | `vendor/bin/phpunit --group integration` | Laravel `RefreshDatabase` per test; Symfony test kernel; containerized Postgres for non-framework code |
| api | Laravel HTTP tests (`postJson`) / Symfony WebTestCase | none | `vendor/bin/phpunit tests/Feature` | `$this->postJson('/api/x', $data)->assertStatus(200)`; assert JSON schema, not just status |
| contract | Pact PHP (pact-foundation/pact-php); schemathesis via CI if OpenAPI exists | `composer require --dev pact-foundation/pact-php` | in PHPUnit | Consumer/provider contracts; schemathesis runs from CI regardless of language |
| e2e | Laravel Dusk 8.7.2 (Chrome) or Playwright from CI | `composer require --dev laravel/dusk` | `php artisan dusk` | Dusk is Laravel-native but Chromium-only; Playwright (JS runner in CI) for multi-browser; keep selectors data-testid based |
| smoke | PHPUnit groups | none | `vendor/bin/phpunit --group smoke` | Tag critical-path tests; PR gate |
| regression | bug-repro tests in PHPUnit/Pest | none | `vendor/bin/phpunit --group regression` | Every production bug gets a failing test first |
| acceptance-bdd | Behat 4.0.0 | `composer require --dev behat/behat` | `vendor/bin/behat` | Gherkin + Mink contexts; Behat 4 released 2026-09; Codeception 5.3.7 as alternative all-in-one |
| snapshot-approval | spatie/phpunit-snapshot-assertions 5.4.0 (or approvaltests-php) | `composer require --dev spatie/phpunit-snapshot-assertions` | `vendor/bin/phpunit` | Review snapshot diffs like code; never snapshot PII payloads |
| characterization | PHPUnit golden files (pattern) | none | custom | Pin legacy calculator output to files before refactoring; diff is the spec |
| property-based | Eris 1.2.1 | `composer require --dev giorgiosironi/eris` | `vendor/bin/phpunit` | PHPUnit extension with generators; smaller ecosystem than Hypothesis but actively maintained |
| fuzz | n/a (see below) | none | none | No mainstream coverage-guided PHP fuzzer; use Eris with random seeds in CI plus external ZAP |
| metamorphic | Eris (pattern) | none | custom | Relations like `serialize/unserialize` round-trips; see `types-input-generation.md` |
| combinatorial | Eris (pattern) | none | custom | `tuple`, `choose`, `bind` generators; see `types-input-generation.md` |
| differential | Eris (pattern) | none | custom | One generator feeding old and new implementations |
| model-based | Eris sequence generators (pattern) | none | custom | Model command sequences manually; no first-class stateful engine |
| mutation | Infection 0.35.8 | `composer require --dev infection/infection` | `vendor/bin/infection --min-msi=80` | Needs PCOV or Xdebug; nightly on money/authz modules; details in `types-mutation.md` |
| coverage | php-code-coverage via PHPUnit `--coverage-clover` with PCOV (or Xdebug) | `pecl install pcov` | `vendor/bin/phpunit --coverage-clover coverage.xml` | PCOV is much faster than Xdebug; Xdebug stays for debugging, PCOV for CI coverage |
| flakiness | PHPUnit `--order-by=random` + Repeat/Retry attributes | none | `vendor/bin/phpunit --order-by=random` | PHPUnit 13 has `#[Repeat]` and `#[Retry]` attributes plus CLI repeat/retry options; run order-random CI jobs to expose order coupling |
| benchmark | PHPBench 1.7.0 | `composer require --dev phpbench/phpbench` | `vendor/bin/phpbench run` | Baseline comparisons for hot paths (pricing engine) |
| load | n/a (see below) | none | none | External k6/Artillery hit HTTP endpoints regardless of server language; see `types-nonfunctional.md` |
| chaos | n/a (see below) | none | none | Infrastructure-level; `infra-iac-containers-ci.md` / `types-nonfunctional.md` |
| accessibility | n/a (see below) | none | none | Frontend concern; server-rendered pages get a11y checks via Playwright/axe in CI; see `lang-typescript-javascript.md` |
| visual-regression | Dusk screenshots + CI image diff (pattern) | none | `php artisan dusk` | Or Playwright screenshot baselines from the JS runner; compare in CI |
| cross-browser | Dusk via Selenium for Firefox (limited); Playwright from CI preferred | none | CI matrix | Chrome-first apps: chromium on PR, webkit/firefox nightly via Playwright |
| i18n | Laravel translation assertions / `trans()` key tests (pattern) | none | in PHPUnit/Pest | Assert key completeness per locale and locale-formatted money output |
| sast | Psalm `--taint-analysis` (+ Semgrep 1.181.x nightly) | none | `vendor/bin/psalm --taint-analysis` | Taint analysis on request handlers catches injection paths; semgrep for broader rules |
| sca | composer audit (builtin, Composer 2.10.x) | none | `composer audit` | Reads composer.lock; fails on known CVEs; add to every CI run |
| secrets | gitleaks 8.30.x (repo-level) | `brew install gitleaks` | `gitleaks detect --no-git` | PHP repos leak .env dumps and API keys in fixtures; pre-commit + CI |
| authz | Laravel Policy/Gate tests, Symfony Voter tests | none | `vendor/bin/phpunit tests/Unit/Policies` | Highest priority: `$this->assertFalse($user->can('update', $household))` for every role pair; one allow and one deny per policy method |
| data-quality | Laravel validation rule tests / symfony/assert (pattern) | none | in PHPUnit/Pest | Assert validation rejects bad inputs and normalizes good ones |
| db-migration | run migrations on fresh schema in tests (Laravel `migrate:fresh`, doctrine/migrations 3.9.x) | none | in test bootstrap | Apply every migration from empty on the test DB; catch drift before deploy |
| docs-examples | n/a (see below) | none | none | No mainstream PHP doctest; keep examples as Pest tests referenced from docs instead |
| notebook | n/a | none | none | Notebooks are Python-domain |
| link-check | n/a | none | none | Language-independent; lychee in `docs-notebooks-web-assets.md` |
| ci-pipeline | GitHub Actions + shivammathur/setup-php + actionlint | none | in CI | PHP 8.4/8.5 matrix; run phpstan, psalm, phpunit, composer audit as parallel jobs |
| exploratory | human-led | none | none | Findings become regression tests |
| usability | human-led | none | none | Not automatable |

### Not applicable

- component: PHP renders server-side (Blade/Twig); view behavior is exercised by api/HTTP tests. Frontend component testing lives in `lang-typescript-javascript.md`.
- fuzz: no maintained coverage-guided fuzzer for PHP; nearest substitutes are Eris randomized CI runs and external DAST. See `types-input-generation.md`.
- load: load generators are language-independent (k6/Artillery); see `types-nonfunctional.md`.
- chaos: infrastructure concern; see `infra-iac-containers-ci.md`.
- accessibility: UI concern; run axe via the e2e runner (JS) instead; see `lang-typescript-javascript.md`.
- dast: OWASP ZAP from CI against the deployed test env; see `types-security.md`.
- iac-policy: Terraform/Bicep checks live in `infra-iac-containers-ci.md`.
- container-scan: trivy/grype on images; see `infra-iac-containers-ci.md`.
- docs-examples: no mainstream doctest for PHP; represent examples as real Pest/PHPUnit tests.
- notebook: notebooks are Python-domain.
- link-check: lychee and docs tooling in `docs-notebooks-web-assets.md`.

## Recommended default stack

For a Laravel 13 service:

1. **Pest 5 (or PHPUnit 13) as the single runner**; Pest gives the same PHPUnit power with less ceremony; keep `phpunit.xml` as the shared config.
2. **PHPStan at level max on `app/`** with a baseline for legacy code; Rector as a dry-run CI check before each PHP upgrade.
3. **PCOV for coverage** (`--coverage-clover`, thresholds in CI); Xdebug only for local debugging.
4. **HTTP tests + Policy/Gate tests** for the API surface: every endpoint tested through `postJson`, every policy with allow/deny per role. This is the authz backbone for a regulated firm.
5. **Eris property tests on money/date functions; Infection nightly** scoped to `app/Domain`.
6. **composer audit + Psalm taint analysis in every CI run**; ZAP baseline nightly.
7. **Dusk for smoke e2e** (or Playwright from CI when multi-browser matters); Behat only where Gherkin is a business requirement; ParaTest 7.27.1 (`vendor/bin/paratest`) to parallelize locally and in CI.

Rationale: PHPUnit's fixture/HTTP-test model plus Laravel policy tests give precise authz coverage; PCOV keeps coverage cheap; Infection on the domain layer catches assertions that never really assert.

## Config snippets

```xml
<!-- phpunit.xml -->
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         bootstrap="vendor/autoload.php" colors="true" cacheDirectory=".phpunit.cache">
  <testsuites>
    <testsuite name="Unit"><directory>tests/Unit</directory></testsuite>
    <testsuite name="Feature"><directory>tests/Feature</directory></testsuite>
  </testsuites>
  <source>
    <include><directory>app</directory></include>
  </source>
  <php>
    <env name="APP_ENV" value="testing"/>
    <env name="DB_CONNECTION" value="sqlite"/>
    <env name="DB_DATABASE" value=":memory:"/>
  </php>
</phpunit>
```

```neon
# phpstan.neon
parameters:
  level: max
  paths:
    - app
  excludePaths:
    - app/Console (adjust to taste)
  reportUnmatchedIgnoredErrors: true
```

```php
// tests/Unit/Policies/HouseholdPolicyTest.php (Pest style)
it('denies non owners from updating a household', function () {
    $user = User::factory()->create();
    $household = Household::factory()->create();
    expect($user->can('update', $household))->toBeFalse();
});
```

## Gotchas

- **PHPUnit 13 requires PHP >= 8.4**; stay on PHPUnit 12.5 for PHP 8.3 and clear its deprecation warnings before upgrading.
- **Infection needs a coverage driver**: install PCOV for CI speed; Xdebug's coverage mode is 5-10x slower.
- **PHPStan level max on legacy code produces noise**: commit a `phpstan-baseline.neon`, then shrink it each sprint; `reportUnmatchedIgnoredErrors` keeps the baseline honest.
- **Pest and PHPUnit coexist** (Pest extends PHPUnit), but do not mix the two styles inside one test file.
- **Dusk pins chromedriver versions**: prefer `php artisan dusk:chrome-driver --detect` or move e2e to Playwright from CI to avoid driver drift.
- **ParaTest and test-order**: parallel runs assume isolated tests; fix shared-state leaks before enabling, and keep one order-random CI job.
- **composer audit reads composer.lock**: run it on the committed lockfile in CI, and on `--locked` in release pipelines.
- **Sqlite test DB hides MySQL/Postgres-only SQL errors**: keep an integration group running against a containerized Postgres.
- **Do not snapshot PII** (household names, account numbers) in golden files; assert schemas or masked values instead (Reg S-P discipline).
- **Psalm 7.0 is at RC** (2026-10); pin 6.x on stable pipelines until 7.0 final.

## Sources

- PHPUnit 13 announcement: https://phpunit.de/announcements/phpunit-13.html ; manual: https://docs.phpunit.de/en/13.4/
- Pest: https://pestphp.com/
- Infection: https://infection.github.io/
- PHPStan: https://phpstan.org/
- Psalm: https://psalm.dev/
- Rector: https://getrector.com/
- Laravel testing: https://laravel.com/docs/testing ; Dusk: https://laravel.com/docs/dusk
- Symfony testing: https://symfony.com/doc/current/testing.html
- Behat: https://behat.org/ ; Codeception: https://codeception.com/
- Eris: https://github.com/giorgiosironi/eris
- ParaTest: https://github.com/brianium/paratest
- PHPBench: https://phpbench.readthedocs.io/
- PHP-CS-Fixer: https://cs.symfony.com/
- composer audit: https://getcomposer.org/doc/03-cli.md#audit
- PCOV: https://pecl.php.net/package/pcov ; Xdebug: https://xdebug.org/
- Pact PHP: https://docs.pact.io/implementation_guides/php

Verified: on 2026-10-14, versions from Packagist p2 data (with release dates): phpunit/phpunit 13.4.2 (2026-10-12), pestphp/pest 5.3.2, infection/infection 0.35.8, phpstan/phpstan 2.3.1, vimeo/psalm 7.0.0-rc2 (2026-10-09; 6.x is the current stable line), rector/rector 2.7.0, laravel/framework v13.36.0, laravel/dusk v8.7.2, symfony/framework-bundle v8.1.9, giorgiosironi/eris 1.2.1, brianium/paratest v7.27.1, behat/behat v4.0.0, codeception/codeception 5.3.7, phpbench/phpbench 1.7.0, friendsofphp/php-cs-fixer 3.95.27, doctrine/migrations 3.9.8, spatie/phpunit-snapshot-assertions 5.4.0, composer/composer 2.10.3; semgrep v1.181.0 and gitleaks v8.30.1 from GitHub releases. PHPUnit 13 requirements (PHP 8.4+), the new array assertions, sealed test doubles, and the flaky-test Repeat/Retry support confirmed from phpunit.de announcements and the PHPUnit 13.4 manual table of contents. Command syntax (phpstan analyse, psalm --taint-analysis, composer audit, paratest, rector --dry-run) from the linked docs. Pest 5 minor-version capabilities not individually re-read (version verified via Packagist only); nothing else carried an unverified flag.
