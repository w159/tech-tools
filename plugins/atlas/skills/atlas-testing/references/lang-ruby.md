# Ruby testing

Language-specific tooling for testing Ruby (and Rails) code. For type definitions and procedures see `workflow.md`. Versions verified 2026-10-14 unless marked `[unverified]`.

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
| --- | --- | --- | --- | --- |
| static-lint | RuboCop 1.92.0 + `rubocop-rspec` extension | `gem install rubocop rubocop-rspec` | `rubocop` (autocorrect: `rubocop -A`) | Also handles layout as formatter; `rubocop-rails` for Rails conventions. |
| type-check | optional Sorbet or Steep `[unverified minor versions]` | `gem install sorbet` / `steep` | `srb tc` / `steep check` | Not universal in Ruby codebases; treat as opt-in. mutant has Sorbet integration docs. |
| unit | RSpec (rspec-core, 3.13.x) or Minitest (stdlib, 6.0.6) | `gem install rspec` | `rspec` / `rake test` | RSpec dominant; Minitest ships with Ruby and Rails and is faster to start. Test data: FactoryBot (`factory_bot_rails`) factories over fixtures. |
| integration | Rails request specs with real ActiveRecord database (transactions or truncation) | rails framework specs | `bundle exec rspec spec/requests` | Full stack minus browser; use test DB per CI service. |
| component | RSpec view specs, mailer specs, ViewComponent/Stimulus component specs | rails framework specs | `bundle exec rspec spec/views spec/components` | Component isolation without full app boot; fixture partials render in context. |
| api | Rails request specs (JSON endpoints) or rspec-api-mockup style; contract via Pact Ruby | none | `bundle exec rspec spec/requests` | Assert status codes, JSON schemas; use Warden/Devise test helpers for auth context. |
| contract | pact-ruby (Ruby core, still shipped as pact-ruby standalone executables; ecosystem strategy is Rust core) | `gem 'pact'` | consumer tests via `Pact.service_consumer` | Ruby core receives maintenance updates (Nov 2024 notes); new projects often use pact-go/pact-js consumers or sbmt-pact for V3/V4 `[unverified]`. |
| e2e | Capybara (3.4x `[unverified minor]`) + system specs (RSpec `type: :system`) with Playwright or Selenium driver | `gem install capybara`, `capybara-playwright-driver` | `bundle exec rspec spec/system` | Rails system specs configure `driven_by`; Cuprite (ferrum) is the pure-Ruby Chrome driver `[unverified status]`. |
| smoke | RSpec metadata tags (`type: :smoke`) + `rspec --tag smoke` | none | `bundle exec rspec --tag smoke` | Keep a small tag set for deploy gating. |
| regression | full suite | none | `bundle exec rspec` | Random ordering per default in RSpec: fix seed in CI for reproducibility. |
| acceptance-bdd | Cucumber Ruby | `gem 'cucumber'` | `bundle exec cucumber` | Gherkin + step defs; wire to Capybara for browser journeys. |
| snapshot-approval | VCR cassettes for external HTTP; n/a first-class for DOM snapshots | `gem 'vcr'`, `gem 'webmock'` | used inside specs | VCR+WebMock record/replay external APIs; commit cassettes. DOM: prefer golden fixtures or Playwright-side snapshots. |
| characterization | full suite + VCR/golden outputs | none | n/a | Pin legacy behavior before refactor; see `types-test-quality.md`. |
| property-based | prop_check 1.0.2 (QuickCheck-style with shrinking) or rantly 0.4.x `[unverified minor]` | `gem 'prop_check'` / `gem 'rantly'` | used inside RSpec/Minitest | prop_check: modern, shrinking, `forall` DSL; rantly: older, maintained by rantly-rb, works with RSpec/Minitest/test-unit extensions. |
| fuzz | n/a first-class (no maintained Ruby fuzzer); use property-based generation instead | n/a | n/a | For parser security, fuzz the logic ported to a compiled language or drive the HTTP API with a fuzzer. |
| metamorphic | implement as prop_check properties (invariant transforms) | none | n/a | |
| combinatorial | prop_check generators over tuples / RSpec shared examples matrices | none | n/a | |
| differential | tests comparing implementations (old gem vs new module) | none | n/a | |
| model-based | n/a first-class; state machines via prop_check remain experimental `[unverified]` | n/a | n/a | |
| mutation | mutant v0.17.0 (active 2026; free for open source repos, commercial subscription for private code) | `gem install mutant-rspec` or `mutant-minitest` | `mutant run --use rspec --usage opensource 'MyClass*'` | Open-source usage flag required; incremental mode for CI; Rails support verified on 7.2 to 8.1 with DB isolation. Licensing matters for closed-source repos. |
| coverage | SimpleCov 1.3.2 | `gem 'simplecov'` | started in spec/spec_helper.rb | Use JSON/HTML reporters; enforce branch coverage via rspec-retry-free CI gate. |
| flakiness | rspec-retry / minitest-retry `[unverified minor]`; Capybara default waiting | `gem 'rspec-retry'` | retry flaky tags | Capybara hides async flakes by auto-waiting; keep `Capybara.default_max_wait_time` sane; fix seeds (`SEED=`). |
| benchmark | benchmark-ips 2.15.1 | `gem 'benchmark-ips'` | `rake benchmark` | Statistical ips comparisons; nightly only; microbenchmarks in Ruby are noise-heavy. |
| load | language-agnostic (k6, vegeta) | n/a | n/a | see `types-nonfunctional.md`. |
| chaos | n/a first-class | n/a | n/a | Fault injection via WebMock failure modes for dependency outages. |
| accessibility | language-agnostic (axe-core via Playwright in system specs) | n/a | n/a | see `types-nonfunctional.md`. |
| visual-regression | language-agnostic (Playwright screenshots) | n/a | n/a | see `types-nonfunctional.md`. |
| cross-browser | language-agnostic | n/a | n/a | Capybara+Playwright drives real browsers. |
| i18n | Rails i18n specs: assert keys present per locale | none | `bundle exec rspec spec/i18n` | Use i18n-tasks gem `[unverified minor]` for missing/unused key analysis. |
| sast | Brakeman 8.1.0 | `gem 'brakeman'` | `brakeman -q -o brakeman.json` | Rails-focused static analysis: SQLi, mass assignment, unsafe render. |
| sca | bundler-audit (advisory DB) + Gemfile.lock pinning | `gem install bundler-audit` | `bundle audit check --update` | Complement with `bundle outdated` / Renovate for upgrade hygiene. |
| secrets | gitleaks (language-agnostic) | binary | `gitleaks detect --redact` | see `types-security.md`. |
| dast | language-agnostic | n/a | n/a | see `types-security.md`. |
| iac-policy | cross-ref `infra-iac-containers-ci.md` | n/a | n/a | |
| container-scan | cross-ref `infra-iac-containers-ci.md` | n/a | n/a | |
| authz | policy-gem specs (Pundit/ActionPolicy `[unverified]`) in unit tests | none | `bundle exec rspec` | Enumerate role x scope in shared examples. |
| data-quality | cross-ref `data-sql-databases.md` | n/a | n/a | |
| db-migration | ActiveRecord migration tests (`migration spec` with `ActiveRecord::Migration[...]`) or standalone schema task | none | `bundle exec rspec spec/db` | Assert up/down round trip on a database-maintained CI service or transaction-wrapped. |
| docs-examples | n/a first-class (yard-doctest exists `[unverified status]`) | n/a | n/a | Prefer examples extracted from specs. |
| notebook | n/a (iruby kernels rare) | n/a | n/a | see `docs-notebooks-web-assets.md`. |
| link-check | language-agnostic | n/a | n/a | see `docs-notebooks-web-assets.md`. |
| ci-pipeline | GitHub Actions setup-ruby/bundle-install with caching; parallel via parallel_tests `[unverified minor]` | workflow YAML | `bundle exec parallel_rspec spec/` | Cache gems by lockfile hash; SimpleCov report upload; Brakeman and bundler-audit separate job. |
| exploratory | human-led | n/a | n/a | see `types-functional.md`. |
| usability | human-led | n/a | n/a | see `types-functional.md`. |

## Recommended default stack

RSpec + FactoryBot for unit and request specs, Capybara with Playwright for system tests, VCR/WebMock for external HTTP, prop_check for properties where input domains are structured, SimpleCov coverage, RuboCop + Brakeman + bundler-audit as static and supply-chain gates, mutant on a scheduled cadence for critical modules (mind the commercial license for private repos), benchmark-ips only where perf regressions matter.

Why: RSpec is the dominant Ruby ecosystem convention with the widest gem support (factory_bot, VCR, rspec-retry, mutant integration), and every static tool above is language-specific rather than generic SAST, catching Rails-specific vulnerability classes Brakeman is built for.

## Config snippets

Gemfile (test group):

```ruby
group :test do
  gem "rspec-rails"
  gem "factory_bot_rails"
  gem "capybara"
  gem "capybara-playwright-driver"
  gem "vcr"
  gem "webmock"
  gem "prop_check"
  gem "simplecov", require: false
  gem "rspec-retry"
  gem "mutant-rspec" # OSS repos: also add `gem "mutant"` runner config
  gem "brakeman", require: false
  gem "bundler-audit", require: false
end
```

spec/spec_helper.rb (SimpleCov, VCR, prop_check wiring):

```ruby
require "simplecov"
SimpleCov.start do
  add_filter "/spec/"
  enable_coverage :branch
  minimum_coverage line: 90, branch: 70
end
require "vcr"
VCR.configure do |c|
  c.cassette_library_dir = "spec/cassettes"
  c.hook_into :webmock
end
```

.rspec:

```
--require spec_helper
--format documentation
--color
```

CLI gates:

```bash
bundle exec rspec --tag ~smoke
bundle exec rspec --tag smoke           # deploy gate
bundle exec brakeman -q -o brakeman.json
bundle audit check --update
gitleaks detect --redact
mutant run --use rspec --require ./config/environment 'Billing*'
```

## Gotchas

- mutant is free for open-source repos only; private commercial code needs a subscription. Use `--usage opensource` correctly or expect license errors. Its Rails support is CI-verified for 7.2/8.0/8.1 with per-worker database isolation.
- VCR recordings can hide breaking upstream changes; set expiration/re-record intervals (`re_record_interval`) and keep cassettes reviewed.
- Capybara auto-waits, but seed data races still leak through: use FactoryBot transaction-wrapped creation, and `use_transactional_fixtures = true` (or per-test transactions) with JS-driver caveat (system specs need a real transaction strategy: truncation per table or database cleaner equivalents).
- RSpec randomizes order by default; pin `--order random --seed X` in CI logs so flakes replay deterministically.
- WebMock stubs only Ruby HTTP libraries: native binaries called by gems bypass it (use VCR's matching on allowed hosts or disable network in CI).
- prop_check shrinks but Ruby's slowness caps useful test counts; keep `forall` runs under a few hundred executions in PR CI, more nightly.
- Brakeman reports confidence levels: gate CI on high-confidence findings, review medium weekly.
- SimpleCov merges only within one process; parallel_tests requires a command-line merge step before uploading reports.
- For Rails 7.1+, system specs prefer Playwright driver over Selenium for stability; Cuprite/ferrum is an option but check current maintenance before adopting.

## Sources

- https://github.com/mbj/mutant (v0.17.0, licensing table, Rails support matrix) and https://github.com/mbj/mutant/releases
- https://rubygems.org/gems/prop_check (1.0.2, 2025-03)
- https://github.com/rantly-rb/rantly (Ruby 3.2+, extensions for RSpec/Minitest)
- https://rspec.info, https://github.com/rspec/rspec-core
- https://rubygems.org (simplecov, capybara, vcr, webmock, factory_bot, rubocop, brakeman, bundler-audit)
- https://docs.pact.io/wrapper_implementations (Ruby shared core / pact-ruby standalone)
- https://docs.pact.io/blog/2024/12/19/pact-2024-end-of-year-wrapup (pact-ruby updates, sbmt-pact)

Verified: confirmed 2026-10-14 via web: mutant v0.17.0 (rubygems; mutant-rspec 0.17.0) with OSS/commercial licensing split, Rails 7.2-8.1 support, Ruby 3.2-4.0 support; prop_check 1.0.2; RuboCop 1.92.0, Brakeman 8.1.0, SimpleCov 1.3.2, Minitest 6.0.6, benchmark-ips 2.15.1, rspec-core 3.13.6 (rubygems); rantly active repo (Ruby 3.2+); pact-ruby standalone wrapper model and 2024 maintenance activity. From memory, flagged unverified: Capybara/FactoryBot/VCR/WebMock/rspec-retry/i18n-tasks minor versions, Cuprite status, sbmt-pact details, yard-doctest status.