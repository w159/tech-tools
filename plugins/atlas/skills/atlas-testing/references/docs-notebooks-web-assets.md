# Testing documentation, notebooks, and web assets

Covers Markdown/MDX, Jupyter notebooks, CSS/SCSS, HTML, and web performance budgets. These artifacts ship to users but are rarely exercised by the app's test suite, so they rot silently: broken links, dead code examples, notebooks that no longer run, CSS regressions. The testing answer is cheap static gates plus selective execution of embedded examples. Mutation testing does not exist for Markdown or CSS; what replaces it is stated explicitly below.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
| --- | --- | --- | --- | --- |
| static-lint | Markdown: markdownlint-cli2. Prose: Vale 3.x (3.24 current). CSS/SCSS: stylelint. HTML: html-validate. Notebooks: nbqa (runs ruff/flake8/black on notebook code cells) | npm i -D markdownlint-cli2 stylelint html-validate; vale brew; nbqa pip | markdownlint-cli2 "docs/**/*.md"; vale docs/; stylelint "src/**/*.css"; npx html-validate dist/*.html; nbqa ruff notebooks/ | Vale lints MDX natively since 3.18 and reads .ipynb as a first-class format since 3.21 (markdown cells as Markdown, outputs skipped). markdownlint-cli2 supports mdx via config globbing |
| link-check | lychee (fast, Rust, primary); markdown-link-check (fallback, Node) | lychee brew or cargo; markdown-link-check npm | lychee docs/ --offline --exclude-mail; markdown-link-check README.md | lychee supports markdown, HTML, MDX, and websites; has official GitHub Action (lycheeverse/lychee-action); offline mode for local, online for CI on a schedule |
| docs-examples | pytest --doctest-glob (Python docstrings/fenced code); sphinx doctest; fenced code-block extraction runner; MDX compile check | pytest; sphinx | pytest --doctest-glob="*.md"; python -c "import mdx..." compile loop | For each fenced block with a language tag: extract to temp file and run that language's test runner (tsc --noEmit for ts, pytest for py). Use a sandbox; examples may have side effects |
| notebook | nbmake (pytest plugin, executes notebooks with nbclient), nbval (replay and compare stored outputs), papermill (parameterized runs) | pip install pytest nbmake; pip install nbval; pip install papermill | pytest --nbmake notebooks/; pytest --nbval notebooks/ | nbmake 1.5.5 current; cell timeouts via --nbmake-timeout; tags raises-exception / skip-execution; parallel with pytest-xdist. nbval: strict by default, --nbval-lax only checks cells marked #NBVAL_CHECK_OUTPUT. testbook (unit test functions inside notebooks) exists but moves slowly; prefer extracting logic to .py and testing that [unverified archival status] |
| unit | extracted notebook logic: move the function to a .py module, unit test with pytest normally | none | pytest | The most reliable pattern for notebook code; testbook-style in-notebook tests are the fallback when extraction is not possible |
| snapshot-approval | nbval output comparison; visual regression for CSS (pointer row below) | none | pytest --nbval strict mode | Treat stored notebook outputs as snapshots; sanitize nondeterministic output with --nbval-sanitize-with regex file |
| smoke | build the docs site (next build, vite build, sphinx-build -W, jb build) and compile every .mdx | site toolchain | npm run build; sphinx-build -W -b html . _build | MDX compile failures (bad JSX, broken imports) surface here; -W treats warnings as errors for Sphinx |
| visual-regression | Playwright screenshot diff, reg-suit, BackstopJS | playwright npm | playwright screenshot + diff against committed baselines | Full treatment lives in types-nonfunctional.md; for CSS the minimum is screenshots of key pages at fixed viewports in CI |
| accessibility | axe-core on rendered HTML | @axe-core/playwright or axe html | playwright + AxeBuilder().analyze() | html-validate catches structural issues only; run axe in CI on built pages. Full a11y guidance: types-nonfunctional.md |
| coverage | CSS coverage: Chrome DevTools Coverage tab or Puppeteer/Playwright Coverage API | none (browser API) | script: page.coverage.startCSSCoverage() | Shows % of shipped CSS actually used; prune dead selectors. JS coverage analog exists; notebooks: no meaningful coverage metric |
| cross-browser | render docs pages in Chromium/Firefox/WebKit via Playwright matrix | playwright npm | CI matrix job | Only needed when docs ship nontrivial CSS/JS; pointer: types-nonfunctional.md |
| benchmark | Lighthouse CI (0.15.x) with Lighthouse 12.x assertions and budgets | npm i -g @lhci/cli | lhci autorun; lhci assert --budgetsFile=budget.json | Enforces Core Web Vitals and resource-size budgets in CI; see config snippet |
| mutation | n/a for Markdown/CSS/HTML. Replacements: for docs, link-check + doctests + vale catch rot; for CSS, visual-regression + stylelint catch breakage; for notebooks, nbmake/nbval catch breakage | | | |

Not applicable (with reason): property-based, fuzz, metamorphic, combinatorial, differential, model-based (no semantic execution surface); contract (API contracts live in types-functional.md); e2e, component, api, integration (app tests, other files); chaos, load (Lighthouse budgets are the only perf gate here; full load: types-nonfunctional.md); i18n (docs multilingual linting is tool-specific; treat per project); exploratory, usability (human-led; usability review of docs is a manual pass, say so in gaps output); secrets/sast/sca (types-security.md); data-quality/db-migration (data file). i18n note: if docs have translations, link-check per-locale and lint prose per-locale; no dedicated canonical tool.

## Recommended default stack

- Markdown repo: markdownlint-cli2 + Vale in pre-commit; lychee in CI (online, scheduled weekly to avoid rate-limit flakiness in every PR); pytest --doctest-glob for python examples; site build (or per-file mdx compile) as the smoke gate.
- MDX (Next.js/Starlight): Vale 3.18+ (native MDX, lints JSX children as prose) + markdownlint-cli2 + a CI step compiling every .mdx with @mdx-js/mdx compile() or the framework build; fenced ts/tsx blocks checked with tsc --noEmit on extracted files.
- Notebooks: nbstripout on pre-commit to keep diffs clean; nbmake in CI to prove execution; nbval where stored outputs are the documentation (reference notebooks); papermill for parameterized scenario runs; move nontrivial logic into .py modules tested with pytest.
- CSS/SCSS: stylelint in pre-commit; Playwright screenshots of key pages with pixel-diff in PR; CSS coverage script quarterly to prune dead rules.
- HTML: html-validate in CI on built output; axe-core on key pages; W3C Nu checker (vnu.jar) as an independent batch check.
- Performance: Lighthouse CI in CI with budget.json; run 3-5 collections and use median aggregation to cut variance.

## Config snippets

markdownlint-cli2 (.markdownlint-cli2.jsonc):

```json
{
  "config": {
    "line-length": { "line_length": 120 },
    "no-inline-html": { "allowed_elements": ["details", "summary"] }
  },
  "globs": ["**/*.md", "**/*.mdx"]
}
```

Vale (.vale.ini; 3.x):

```ini
StylesPath = styles
MinAlertLevel = warning
Packages = Google

[*.{md,mdx}]
BasedOnStyles = Vale, Google
```

```sh
vale sync        # downloads configured packages
vale docs/
```

Vale rules are testable since 3.24: a rule can carry its own tests blocks (input + want), and `vale test --coverage` fails rules with no test case.

lychee (link check):

```sh
lychee docs/ --offline                    # local/PR: no network, catches broken internal anchors
lychee docs/ --max-retries 2 --format json  # scheduled CI: online
```

pytest doctests for Markdown:

```ini
# pytest.ini
[pytest]
addopts = --doctest-glob="docs/*.md" --doctest-modules
```

Fenced code-block extraction runner (concept; keep it generic and sandboxed):

```python
import json, pathlib, subprocess, tempfile

blocks = json.loads(subprocess.check_output(
    ["python", "scripts/extract_code_blocks.py", "docs/"]))  # {lang: [code, ...]}
for lang, codes in blocks.items():
    runner = {"ts": ["npx", "tsc", "--noEmit"], "py": ["python", "-c"]}[lang]
    for code in codes:
        with tempfile.NamedTemporaryFile(suffix={"ts": ".ts", "py": ".py"}[lang]) as f:
            f.write(code.encode()); f.flush()
            subprocess.run(runner + ([f.name] if lang == "ts" else []), check=True)
```

MDX compile check:

```js
// scripts/check-mdx.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { compile } from "@mdx-js/mdx";
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(`${d}/${e.name}`)
  : e.name.endsWith(".mdx") ? [`${d}/${e.name}`] : []);
for (const f of walk(process.argv[2])) {
  await compile(readFileSync(f), { jsx: false });  // throws on bad JSX/imports
}
```

nbmake + nbval in CI:

```sh
pytest --nbmake --nbmake-timeout=600 notebooks/ -n auto   # executes; xdist parallel
pytest --nbval --nbval-sanitize-with sanitize.cfg notebooks/   # compares stored outputs
```

```yaml
# .pre-commit-config.yaml entry
- repo: https://github.com/kynan/nbstripout
  rev: master
  hooks: [{id: nbstripout}]
```

stylelint (.stylelintrc.json):

```json
{
  "extends": ["stylelint-config-standard"],
  "rules": { "selector-class-pattern": null, "no-descending-specificity": null }
}
```

html-validate + W3C Nu + axe:

```sh
npx html-validate "dist/**/*.html"
java -jar vnu.jar --skip-non-html dist/     # W3C Nu validator (vnu.jar from validator.github.io/validator)
```

```js
import AxeBuilder from "@axe-core/playwright";
const results = await new AxeBuilder({ page }).analyze();
if (results.violations.length) throw new Error(JSON.stringify(results.violations));
```

CSS coverage script (Playwright):

```js
const client = await page.context().newCDPSession(page);
await client.send("CSS.startRuleUsageTracking");
await page.goto("http://localhost:3000");
const { ruleUsage } = await client.send("CSS.stopRuleUsageTracking");
const used = ruleUsage.filter(r => r.used);
console.log(`CSS rules used: ${used.length}/${ruleUsage.length}`);
```

Lighthouse CI budgets (.lighthouserc.json + budget.json):

```json
{
  "ci": {
    "collect": { "url": ["http://localhost:3000/"], "numberOfRuns": 3 },
    "assert": { "budgetsFile": "./budget.json" },
    "upload": { "target": "temporary-public-storage" }
  }
}
```

```json
[
  {
    "path": "/*",
    "resourceSizes": [
      { "resourceType": "script", "budget": 300 },
      { "resourceType": "total", "budget": 1500 }
    ],
    "timings": [
      { "metric": "first-contentful-paint", "budget": 2000 },
      { "metric": "largest-contentful-paint", "budget": 2500 },
      { "metric": "cumulative-layout-shift", "budget": 0.1 }
    ]
  }
]
```

Note: budget.json takes precedence over inline assertions; do not configure both for one run.

## Gotchas

- PR vs nightly: markdownlint, Vale, stylelint, html-validate, nbmake, mdx compile, site build, LHCI on fast subset: every PR. lychee online, W3C Nu batch, full link crawl, full notebook suite (long-running notebooks), visual-diff full-page sets: scheduled or nightly. Online link checks in every PR will rate-limit (GitHub 429s) and create flaky failures.
- Vale 3.x requires `vale sync` for styles packages in CI; cache the StylesPath. Vale config sections match globs; an .mdx file that matches no section is linted by nothing.
- lychee --offline in PR checks internal anchors and relative paths only; schedule the online run. Exclude mailto: and example.com domains.
- Notebooks: nondeterminism (dates, random seeds, network, GPU availability) is the main flake source. Use fixed seeds, freeze dates, sanitize outputs (nbval sanitize file or nbmake mocking), and tag long/cells-that-throw with raise-exception / skip-execution metadata.
- Committed notebook outputs bloat diffs and may contain PII from real data runs; strip on commit (nbstripout) unless outputs are documentation, in which case review outputs like code.
- papermill shines for parameterized scenario notebooks (per-client report generation); failures there are data problems, so run against masked data only (see data file for PII masking).
- doctest-glob is strict about exact output; prefer writing examples whose output is deterministic or use ellipsis. Never let docs examples hit real APIs; sandbox them.
- MDX: compile() catches syntax but not broken internal component imports; the framework build (next build, vite build) is the real gate. Run both: compile check for fast feedback, build as smoke.
- Lighthouse numbers vary run to run; use numberOfRuns 3+ and aggregationMethod median for critical metrics; budgets as warnings first, promote to error after a stable week. LHCI lab scores can diverge from field data; do not treat budget pass as UX proof.
- CSS coverage only reflects pages actually loaded during measurement; run it against the sitemap top pages, and interpret as "at least this much is dead", not an exact number.
- html-validate and vnu.jar overlap; pick one for CI (html-validate, faster) and keep vnu.jar as a quarterly independent audit.
- axe-core automated checks cover maybe 30-40% of WCAG success criteria; manual keyboard/screen-reader passes are still required (human-led; see types-nonfunctional.md).

## Sources

- markdownlint-cli2: https://github.com/DavidAnson/markdownlint-cli2
- Vale: https://vale.sh/ and https://github.com/vale-cli/vale
- lychee: https://github.com/lycheeverse/lychee
- markdown-link-check: https://github.com/tcort/markdown-link-check
- nbmake: https://github.com/treebeardtech/nbmake
- nbval: https://github.com/computationalmodelling/nbval
- papermill: https://github.com/nteract/papermill
- testbook: https://github.com/nteract/testbook
- nbstripout: https://github.com/kynan/nbstripout
- pytest doctest: https://docs.pytest.org/en/stable/how-to/doctest.html
- sphinx doctest: https://www.sphinx-doc.org/en/master/usage/extensions/doctest.html
- MDX: https://mdxjs.com/
- stylelint: https://stylelint.io/
- html-validate: https://html-validate.org/
- W3C Nu validator: https://validator.github.io/validator/
- axe-core: https://github.com/dequelabs/axe-core
- Lighthouse CI: https://github.com/GoogleChrome/lighthouse-ci
- Lighthouse budgets: https://developer.chrome.com/docs/lighthouse/performance/performance-budgets
- Playwright screenshots: https://playwright.dev/docs/screenshots
- reg-suit: https://github.com/reg-viz/reg-suit
- BackstopJS: https://github.com/garris/BackstopJS

Verified: 2026-10-14. Confirmed via web: Vale current version 3.24.0 with the `vale test` rule test runner and --coverage; native MDX parsing since 3.18 (JSX children linted as prose), Jupyter .ipynb as a first-class format since 3.21, Sphinx/MyST/Quarto support (3.18), Hunspell-based spelling (3.22); lychee active (lychee-lib 0.22.x), MDX support, GitHub Action; nbmake 1.5.5 (pytest plugin, nbclient, --nbmake-timeout, raises-exception/skip-execution tags, xdist parallelism, nbstripout recommendation) from PyPI/GitHub; nbval flags (--nbval, --nbval-lax, --nbval-sanitize-with, --current-env, xdist with --dist loadscope) from README; testbook exists but activity is low [archival status unverified]; Lighthouse CI v0.15.1 (upgrades to Lighthouse 12.6.1), assertions vs budgetsFile (budget file takes precedence), presets, aggregationMethod median/pessimistic, numberOfRuns from repo releases and issue discussion; container-structure-test and hadolint verified in the infra file. markdownlint-cli2, stylelint, html-validate, axe-core, Playwright coverage API, W3C vnu.jar, sphinx doctest, nbstripout, papermill: from memory, established tools, no version numbers asserted; the fenced-block extraction and MDX compile scripts are illustrative and should be adapted to the project's toolchain.