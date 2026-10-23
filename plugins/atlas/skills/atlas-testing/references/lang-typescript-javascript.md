# TypeScript / JavaScript Testing

Covers React/Vue/Svelte frontends, Node/Bun/Deno services, Next.js apps, and Vite-based monorepos. Deep dives in `types-*.md`; infra/CI in `infra-iac-containers-ci.md`.

Regulated context (FTC Safeguards, SEC Reg S-P, GLBA): prioritize authz/middleware tests, financial-calculation property tests, and coverage gates; keep client-data out of snapshot files.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
|---|---|---|---|---|
| static-lint | ESLint 10.12.0 + typescript-eslint 8.71.2; Biome 2.5.15; oxlint 1.88.0 | `npm i -D eslint typescript-eslint` | `npx eslint .` | One lint gate: ESLint+typescript-eslint is the safe default; oxlint as fast pre-commit pass; Biome if you want lint+format in one |
| type-check | `tsc --noEmit` | in deps | `npx tsc --noEmit` | CI gate separate from the bundler's transpile; bundlers never type-check |
| unit | Vitest 5.0.4 (v4.0 stable 2025-10-22); Jest 30.5.2; node:test (Node 20+); bun test; deno test | `npm i -D vitest` | `npx vitest run` | Vitest default for Vite apps (v4+ removed `workspace` option, use `projects`; rewritten module mocking). Jest 30 for legacy. node:test for zero-dep Node libs; bun/deno test only if the app runs on that runtime |
| integration | Vitest + testcontainers 12.2.1 (node) | `npm i -D testcontainers` | `npx vitest run -t integration` | Real PostgreSQL/Redis per suite via containers; module-scoped containers |
| component | Testing Library (@testing-library/react 16.3.3, /vue 8.1.0, /svelte 5.4.2) + Vitest jsdom; Storybook 10.6.2 addon-vitest | `npm i -D @testing-library/react jsdom` | `npx vitest run` | Playwright experimental CT packages were removed (Playwright 1.63+, Aug 2026): CT is now story-gallery + `mount()` fixture on plain @playwright/test. Storybook: prefer addon-vitest over the Jest-based test-runner (test-runner stays for webpack/rspack/Angular) |
| api | supertest 7.3.1 (Express/Nest) or plain fetch against app | `npm i -D supertest` | in vitest | NestJS testing module builds on supertest; assert status + schema, not just 200 |
| contract | @pact-foundation/pact 17.1.4 | `npm i -D @pact-foundation/pact` | via vitest/jest adapter | Consumer contracts + provider verification in CI; broker for teams |
| e2e | @playwright/test 1.64.1; Cypress 16.2.0 | `npm i -D @playwright/test && npx playwright install` | `npx playwright test` | Playwright preferred (multi-browser, traces); Cypress acceptable for existing suites, chromium-first |
| smoke | Playwright or Vitest filtered subset | none | `npx playwright test --grep @smoke` | Tag critical-path tests; PR gate |
| regression | bug-repro specs in Vitest/Playwright | none | `npx vitest run -t regression` | Every user-reported bug gets a failing test first |
| acceptance-bdd | @cucumber/cucumber 13.3.0 | `npm i -D @cucumber/cucumber` | `npx cucumber-js` | Gherkin for business-facing scenarios; otherwise skip BDD entirely |
| snapshot-approval | Vitest snapshots/inline; Playwright `toHaveScreenshot`; Storybook visual | none | `npx vitest run -u` | Vitest 4+ fails obsolete snapshots on CI by default; keep PII out of snapshots |
| characterization | Vitest snapshot pinning (pattern) | none | custom | Pin current outputs of legacy modules before refactor; diff = spec |
| property-based | fast-check 4.10.2 | `npm i -D fast-check` | in vitest | Money math, parsers, reducers; set a fixed seed in CI for reproducibility |
| fuzz | @jazzer.js/core 4.0.0 | `npm i -D @jazzer.js/core` | `npx jazzer <fuzz-target>` (or Jest runner) | Coverage-guided; Apache-2.0 again since Dec 2024; nightly on parsers/validators |
| metamorphic | fast-check (pattern) | none | custom | Relations like `round-trip(x) == x`; see `types-input-generation.md` |
| combinatorial | fast-check (pattern) | none | custom | `tuple`, `shuffledSubarray`, `option` combinators; see `types-input-generation.md` |
| differential | fast-check (pattern) | none | custom | One property comparing two implementations on shared inputs |
| model-based | fast-check `fc.commands` (pattern) | none | custom | Model-based sequences against a state model; see `types-input-generation.md` |
| mutation | @stryker-mutator/core 10.0.0 | `npm i -D @stryker-mutator/core @stryker-mutator/vitest-runner` | `npx stryker run` | Nightly on core modules only; vitest runner available; details in `types-mutation.md` |
| coverage | @vitest/coverage-v8 5.0.4; c8 12.0.0 standalone | `npm i -D @vitest/coverage-v8` | `npx vitest run --coverage` | v8 provider default; thresholds in vitest config; c8 for non-Vitest scripts. Node's builtin V8 coverage is the engine |
| flakiness | Vitest retries (sparingly) + Playwright `retries` + seed control | none | `npx playwright test --repeat-each=3` | Retry masks bugs: use CI flake detection (repeat runs) instead; random order via Vitest seed. Test-impact/affected runs via turbo/nx below |
| benchmark | Vitest bench mode (tinybench 6.2.2) | in vitest | `npx vitest bench` | `*.bench.ts` files; compare against baseline in CI |
| load | k6 2.3.0 (Go binary, JS scripts); Artillery 2.0.34 | `brew install k6` / `npm i -D artillery` | `k6 run load.js` / `npx artillery run load.yml` | k6 scripts are JS but run in the k6 runtime (not Node); nightly against staging only |
| accessibility | axe-core 4.14.0 + @axe-core/playwright 4.13.0 | `npm i -D @axe-core/playwright` | in Playwright specs | `new AxeBuilder({ page }).analyze()` per page; Storybook a11y addon for components |
| visual-regression | Playwright `toHaveScreenshot`; Storybook visual tests; Chromatic (SaaS) | none | `npx playwright test` | Assert on element screenshots, not full page, to cut noise |
| cross-browser | Playwright (chromium/firefox/webkit) | none | `npx playwright test --project=webkit` | PR: chromium; nightly: full matrix; WebKit approximates Safari |
| i18n | react-intl / i18next catalog tests (pattern) | per lib | custom | Assert key completeness and plural rules per locale; render locale-formatted money |
| sast | eslint-plugin-security + Semgrep 1.181.x (CodeQL optional) | `npm i -D eslint-plugin-security` | `npx semgrep ci` | Nightly semgrep/CodeQL; keep no-unsanitized rules on for DOM apps |
| sca | npm/pnpm audit + osv-scanner 2.7.0 | none | `npm audit --omit=dev && osv-scanner -r .` | Audit runtime deps separately from dev; lockfile committed |
| secrets | gitleaks 8.30.x | `brew install gitleaks` | `gitleaks detect --no-git` | Pre-commit + CI; JS repos leak .env and hardcoded tokens in fixtures |
| authz | middleware/guard unit tests + forged-token API tests (pattern) | none | in vitest/supertest | Highest priority: one allow and one deny test per role per protected route; test Next.js middleware/NextAuth policies directly |
| data-quality | zod/valibot schema tests at boundaries (pattern) | `npm i -D zod` | in vitest | Validate API/queue/form inputs with property tests on schemas |
| db-migration | Prisma/Drizzle migrate tests via testcontainers PostgreSQL (pattern) | `npm i -D testcontainers` | in vitest | Apply all migrations on a fresh container, seed, assert schema; more in `data-sql-databases.md` |
| docs-examples | runnable examples as vitest files, imported by docs (pattern) | none | `npx vitest run docs` | Keep README/MDX snippets as real test files; checker-style type tests with `expect-type` where useful |
| ci-pipeline | GitHub Actions + actionlint; turbo 2.11.8 / nx 23.3.0 affected runs | none | `npx turbo run test --filter=...[origin/main]` / `npx nx affected -t test` | Affected-only runs keep monorepo PR CI fast; actionlint lints workflows |
| exploratory | human-led | none | none | Findings become regression specs |
| usability | human-led | none | none | Not automatable |

### Not applicable

- chaos: infrastructure-level concern; chaos tooling (containers, k8s) lives in `infra-iac-containers-ci.md` / `types-nonfunctional.md`.
- dast: external scanner (OWASP ZAP) against the deployed app; see `types-security.md`.
- iac-policy: Terraform/Bicep policy testing lives in `infra-iac-containers-ci.md`.
- container-scan: scan built images (trivy/grype), not JS; see `infra-iac-containers-ci.md`.
- notebook: notebooks are Python-domain; see `docs-notebooks-web-assets.md`.
- link-check: language-independent; lychee and friends in `docs-notebooks-web-assets.md`.

## Recommended default stack

For a Next.js/Vite app in a monorepo:

1. **Vitest 5 as the single unit/component/integration runner**; projects for browser-mode suites (Vitest 4 removed the `workspace` option in favor of `projects`).
2. **Testing Library + jsdom** for components; **Storybook + addon-vitest** where stories already exist (a11y and coverage come free in the widget).
3. **MSW 3** for network mocking at the service layer, respx-equivalent for outbound calls.
4. **Playwright** for e2e, smoke, visual, and a11y; chromium on PR, full browser matrix nightly.
5. **fast-check** on all money/date/parse functions; **StrykerJS nightly** scoped to `src/domain`.
6. **ESLint + typescript-eslint** gate, `tsc --noEmit` gate, coverage thresholds via @vitest/coverage-v8.
7. **turbo/nx affected** so PR pipelines only test changed packages; k6 nightly against staging.

Rationale: one runner family (Vitest + Playwright) minimizes config drift; fast-check and authz tests target the regulated-firm failure classes: wrong numbers and wrong permissions. Jest 30 remains the choice only for legacy CRA/webpack setups; node:test for dependency-free CLI packages.

## Config snippets

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.{ts,tsx}'] } },
      { test: { name: 'storybook' } }, // added by @storybook/addon-vitest setup
    ],
    coverage: {
      provider: 'v8',
      thresholds: { lines: 90, branches: 85 },
    },
  },
})
```

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  retries: process.env.CI ? 1 : 0,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } }, // nightly matrix
  ],
  webServer: { command: 'npm run dev', reuseExistingServer: !process.env.CI },
})
```

```ts
// e2e/checkout.a11y.spec.ts
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('checkout has no critical a11y violations', async ({ page }) => {
  await page.goto('/checkout')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.filter(v => v.impact === 'critical')).toEqual([])
})
```

## Gotchas

- **Vitest 4+**: `workspace` option is removed, use `projects`; module mocking was rewritten; obsolete snapshots fail on CI; artifact/report defaults moved to `.vitest/`. Read the v4 migration guide before upgrading from 3.
- **Playwright CT**: the `@playwright/experimental-ct-*` packages are removed (Playwright 1.63+). Component testing is now a story gallery served by your own dev server plus the built-in `mount()` fixture; stay on 1.62 only while porting.
- **Storybook**: `@storybook/addon-vitest` (browser-mode, Vitest-based) replaces the Jest-based test-runner for Vite frameworks; the test-runner remains only for webpack/rspack/Angular setups.
- **Next.js**: Server Components cannot run in jsdom; test them via e2e or route handlers, unit-test client components and middleware. Next 16 + Vite-based Storybook needs `@storybook/nextjs-vite`.
- **Bundlers do not type-check**: always run `tsc --noEmit` in CI even when Vite/SWC compile happily.
- **ESM packages under Jest 30** still need `transformIgnorePatterns` surgery; this is the usual reason new projects pick Vitest.
- **c8 12 / Vitest coverage require Node >= 20.19** (yargs 18 baseline); pin CI Node accordingly.
- **k6 scripts run in the k6 runtime**, not Node: no npm filesystem/net modules; Artillery is Node-native if you need shared code.
- **Coverage thresholds**: exclude generated files, config, and e2e specs, or the numbers lie.
- **Monorepo**: gate PRs on `turbo run test --filter=...[origin/main]` (or `nx affected -t test`) plus a nightly full run; do not run the whole graph per PR.
- **fast-check**: set a fixed seed (via config or `fc.configureGlobal`) so CI failures reproduce; cache nothing, failures are printed with the seed.
- **Snapshots**: never snapshot API responses containing client PII; assert schemas instead (regulated-data rule).

## Sources

- Vitest: https://vitest.dev/ and v4 migration guide: https://vitest.dev/guide/migration
- Jest: https://jestjs.io/
- node:test: https://nodejs.org/api/test.html
- Playwright: https://playwright.dev/docs/intro ; component testing: https://playwright.dev/docs/test-components
- Cypress: https://docs.cypress.io/
- Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Storybook testing (addon-vitest, test-runner migration): https://storybook.js.org/docs/writing-tests
- MSW: https://mswjs.io/
- fast-check: https://fast-check.dev/
- Jazzer.js: https://github.com/CodeIntelligenceTesting/jazzer.js
- StrykerJS: https://stryker-mutator.io/
- c8: https://github.com/bcoe/c8
- Pact JS: https://docs.pact.io/implementation_guides/javascript
- supertest: https://github.com/ladjs/supertest
- k6: https://grafana.com/docs/k6/latest/
- Artillery: https://www.artillery.io/docs
- axe-core / @axe-core/playwright: https://github.com/dequelabs/axe-core-npm
- testcontainers-node: https://node.testcontainers.org/
- typescript-eslint: https://typescript-eslint.io/
- Biome: https://biomejs.dev/ ; oxlint: https://oxc.rs/
- turbo affected: https://turborepo.com/docs ; nx affected: https://nx.dev/ci/features/affected

Verified: on 2026-10-14, versions from npm registry `latest` and GitHub releases: vitest 5.0.4, @vitest/coverage-v8 5.0.4, jest 30.5.2, @playwright/test 1.64.1, cypress 16.2.0, @testing-library/react 16.3.3, @testing-library/vue 8.1.0, @testing-library/svelte 5.4.2, storybook 10.6.2, @storybook/addon-vitest 10.6.2, @storybook/test-runner 0.26.0, @stryker-mutator/core 10.0.0, fast-check 4.10.2, @jazzer.js/core 4.0.0, c8 12.0.0, eslint 10.12.0, typescript-eslint 8.71.2, @biomejs/biome 2.5.15, oxlint 1.88.0, @pact-foundation/pact 17.1.4, supertest 7.3.1, artillery 2.0.34, axe-core 4.14.0, @axe-core/playwright 4.13.0, msw 3.0.3, next 16.4.1, vite 8.3.4, @cucumber/cucumber 13.3.0, turbo 2.11.8, nx 23.3.0, tinybench 6.2.2, testcontainers 12.2.1; k6 v2.3.0, osv-scanner v2.7.0, semgrep v1.181.0, gitleaks v8.30.1 from GitHub releases. Vitest 4 stable (2025-10-22) and its breaking changes confirmed from the vitest-dev/vitest v4.0.0 release notes and v4 migration guide. Playwright experimental-ct removal and the story-gallery/mount() replacement confirmed from playwright.dev component-testing docs and microsoft/playwright PR #42168. Storybook addon-vitest vs test-runner split confirmed from Storybook's migration guide (Vite-only support for the addon). Jazzer.js maintenance/licensing (Apache-2.0 since Dec 2024) confirmed from its releases and google/oss-fuzz issue #11652. c8 health confirmed via npm/Snyk metadata. node:test/bun test/deno test capabilities stated from memory of stable runtimes, without version claims.
