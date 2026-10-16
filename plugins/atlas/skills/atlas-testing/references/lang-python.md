# Python Testing

Covers pytest-based projects, FastAPI backends, and data/notebook work. Deep dives live in `types-*.md`; database specifics in `data-sql-databases.md`; infra/CI in `infra-iac-containers-ci.md`; notebooks/docs in `docs-notebooks-web-assets.md`.

Regulated context (FTC Safeguards, SEC Reg S-P, GLBA): prioritize authz tests, financial-calculation property and regression tests, and coverage gates over raw speed tooling.

## Contents

- At a glance
- Recommended default stack
- Config snippets
- Gotchas
- Sources

## At a glance

| TYPE ID | Tool (current version) | Install | Run | Notes |
|---|---|---|---|---|
| static-lint | ruff 0.17.0 | `uv add --dev ruff` | `uvx ruff check .` / `uvx ruff format .` | Lint plus format in one tool; replaces flake8/isort/black. `S` rules carry bandit-style checks |
| type-check | mypy 2.4.0; pyright 1.1.414; pyrefly 1.3.2; ty 0.0.87 | `uv add --dev mypy` | `uvx mypy src` / `uvx pyrefly check` / `uvx ty check` | mypy and pyright are production-stable; pyrefly 1.x is stable (Meta, adopted by Google 2026-10); ty is beta (Astral). Pick ONE as the CI gate; run others as editors/second opinions |
| unit | pytest 9.1.1 (+ pytest-mock 3.16.0, freezegun 1.5.5, time-machine 3.5.1, factory_boy 3.3.3) | `uv add --dev pytest pytest-mock` | `uv run pytest -q` | Ecosystem covers mocking, time control, fixtures; doctests via `pytest --doctest-modules` |
| integration | pytest 9 + testcontainers-python 4.15.0 | `uv add --dev testcontainers` | `uv run pytest -m integration` | Real Postgres/Redis containers; module-scoped fixtures keep xdist workers safe |
| api | FastAPI 0.143.x TestClient (httpx) + respx 0.23.1 | `uv add --dev httpx respx` | `uv run pytest tests/api` | TestClient is an httpx transport over the ASGI app; respx mocks outbound httpx calls |
| contract | schemathesis 4.31.1 | `uv add --dev schemathesis` | `uv run st run http://127.0.0.1:8000/openapi.json` | OpenAPI-driven property testing of the live app; nightly in CI |
| e2e | Playwright for Python 1.64.0 | `uv add --dev pytest-playwright` | `uv run pytest tests/e2e --headed` | Chromium/Firefox/WebKit; browsers via `playwright install` |
| smoke | pytest markers | none | `uv run pytest -m smoke` | `smoke` marker in pyproject; run on PR as fast gate |
| regression | pytest + pytest-regressions; bug-repro tests | `uv add --dev pytest-regressions` | `uv run pytest -m regression` | Pin financial outputs with `data_regression`; every production bug gets a repro test first |
| acceptance-bdd | pytest-bdd 9.0.0 (or behave 1.3.3) | `uv add --dev pytest-bdd` | `uv run pytest tests/bdd` | Gherkin feature files mapped to pytest fixtures; behave if you want a standalone runner |
| snapshot-approval | syrupy 6.1.1 | `uv add --dev syrupy` | `uv run pytest --snapshot-update` | Amber snapshots; review diffs like code |
| characterization | approvaltests 19.1.1 | `uv add --dev approvaltests` | `uv run pytest tests/characterization` | Approve legacy money-math output before refactoring |
| property-based | hypothesis 6.169.3 | `uv add --dev hypothesis` | via `@given` in pytest | First choice for money math, date logic, parsers; keeps a failing-example DB in `.hypothesis/` |
| fuzz | atheris 3.1.0 | `uv add --dev atheris` | `python -m atheris <corpus>` | libFuzzer-style coverage-guided fuzzing for CPython; C-extension and parser code; CI nightly or OSS-Fuzz |
| metamorphic | Hypothesis (pattern) | none | custom | Relations such as `serialize(parse(x)) == x`; see `types-input-generation.md` |
| combinatorial | Hypothesis (pattern) | none | custom | `composite` strategies and `st.data()` for pairwise-style sampling; see `types-input-generation.md` |
| differential | Hypothesis (pattern) | none | custom | One `@given` test comparing old vs new implementation on the same inputs |
| model-based | hypothesis.stateful | none | `uv run pytest tests/stateful.py` | `RuleBasedStateMachine` for API/session models |
| mutation | mutmut 3.8.0 or cosmic-ray 8.7.0 | `uv add --dev mutmut` | `uvx mutmut run` | Nightly on money/authz modules only; details in `types-mutation.md` |
| coverage | coverage.py 7.16.2 + pytest-cov 7.1.0 | `uv add --dev pytest-cov` | `uv run pytest --cov --cov-branch` | Always `--cov-branch`; set `fail_under` in pyproject |
| flakiness | pytest-randomly 5.0.0 + pytest-xdist 3.8.0 | `uv add --dev pytest-randomly pytest-xdist` | `uv run pytest -n auto` | Random test order plus recorded seed exposes order coupling; repeat seeds in CI to confirm |
| benchmark | pytest-benchmark 5.3.0 | `uv add --dev pytest-benchmark` | `uv run pytest --benchmark-only` | Compare against saved baselines; fail PR on big regressions |
| load | locust 2.46.7 | `uv add --dev locust` (or pipx) | `uv run locust -f locustfile.py --headless -u 200 -r 10 --run-time 5m` | Python locustfiles; nightly against a staging clone, never production |
| chaos | chaostoolkit 1.21.4 | `uv add --dev chaostoolkit` | `uv run chaos run experiment.json` | Experiments as declarative JSON/YAML; most apps do not need it; see `types-nonfunctional.md` |
| accessibility | axe via Playwright (axe-core engine) | `uv add --dev pytest-playwright` | run axe script inside pytest page | Only when Python drives the browser; frontend-first a11y lives in `lang-typescript-javascript.md` |
| visual-regression | pytest-playwright screenshots | none | `page.screenshot()` + CI image diff | Assert screenshot baselines per viewport in e2e specs |
| cross-browser | Playwright for Python | none | `uv run pytest --browser chromium --browser firefox --browser webkit` | PR: chromium only; nightly: full matrix |
| i18n | pytest + gettext/Babel fixtures | `uv add --dev babel` | custom fixtures | Test plural rules, locale money formatting, date parsing per locale |
| sast | bandit 1.9.4 (+ semgrep 1.181.x) | `uv add --dev bandit` | `uvx bandit -r src` | semgrep for cross-language and custom rules; nightly |
| sca | pip-audit 2.10.1 | `uvx pip-audit` | `uvx pip-audit -r requirements.txt` | OSV backend; audit the exported lockfile, not just the environment |
| secrets | detect-secrets 1.5.0 / gitleaks 8.30.x | `pipx install detect-secrets` | `gitleaks detect --no-git` | Pre-commit hook; language-agnostic but Python repos leak .env and notebook outputs |
| dast | OWASP ZAP (external, language-independent) | docker | `docker run ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t <url>` | Nightly baseline scan of the deployed test env; see `types-security.md` |
| authz | FastAPI `dependency_overrides` + pytest | none | override `get_current_user` per role | Highest priority: one test per role per protected route: allow and deny. Combine with httpx/TestClient |
| data-quality | pytest + pandas/pydantic checks (pattern) | none | custom | Validate pipeline invariants (sums reconcile, no nulls in key columns); DB rules in `data-sql-databases.md` |
| db-migration | pytest-alembic 0.13.1 | `uv add --dev pytest-alembic` | `uv run pytest tests/alembic` | Upgrades, downgrades, and upgrade-from-empty for every migration |
| docs-examples | pytest `--doctest-glob='*.md'` | none | `uv run pytest --doctest-glob='*.md' docs/` | Executable README/ Sphinx examples; Sphinx `doctest` builder alternative |
| notebook | nbmake 1.5.5 (or nbval 0.11.0) | `uv add --dev nbmake` | `uv run pytest --nbmake notebooks/` | nbmake executes notebooks as tests; nbval compares cell outputs; more in `docs-notebooks-web-assets.md` |
| link-check | Sphinx linkcheck builder | none | `uv run sphinx-build -b linkcheck docs docs/_build` | For Sphinx docs; otherwise lychee (see `docs-notebooks-web-assets.md`) |
| ci-pipeline | GitHub Actions + actionlint | none | run actionlint in CI | uv-based setup (`astral-sh/setup-uv`); lint the workflow itself |
| exploratory | human-led | none | none | Session notes feed new regression tests; no tool substitutes a human |
| usability | human-led | none | none | Not automatable; record findings as issues |

### Not applicable

- component: Python server-side repos have no UI components; app-level isolation is covered by api (TestClient) and integration. Frontend component tests live in `lang-typescript-javascript.md`.
- iac-policy: language-independent; Terraform/Bicep policy testing lives in `infra-iac-containers-ci.md`.
- container-scan: scan images, not language code; trivy/grype in `infra-iac-containers-ci.md`.

## Recommended default stack

For a uv-managed FastAPI service:

1. **pytest 9 + pytest-cov + pytest-xdist + pytest-randomly** as the single runner; markers separate `smoke`, `integration`, `regression`.
2. **mypy (or pyrefly) in strict mode on `src/`** as the merge gate; pyrefly is now stable and dramatically faster on big repos; ty stays a second opinion until it leaves beta.
3. **ruff** for lint and format with bandit rules (`S`) enabled.
4. **Hypothesis on every money/date/parse function**; property tests find boundary bugs example tests never sample.
5. **TestClient + dependency_overrides** for API and authz; testcontainers for real Postgres paths.
6. **schemathesis nightly** against the OpenAPI schema; pip-audit + bandit + ZAP baseline in nightly CI.
7. **Playwright for e2e** (chromium on PR, full matrix nightly); mutmut nightly scoped to `src/money` and authz modules.

Rationale: one runner keeps CI boring; Hypothesis and authz overrides attack the two failure classes that cost a regulated firm the most: wrong numbers and wrong permissions.

## Config snippets

```toml
# pyproject.toml
[tool.pytest.ini_options]
addopts = "-ra --strict-markers"
testpaths = ["tests"]
markers = [
  "smoke: fast PR gate",
  "integration: needs docker",
  "regression: bug repros and pinned outputs",
]
filterwarnings = ["error::DeprecationWarning"]

[tool.coverage.run]
branch = true
source = ["src", "tests"]

[tool.coverage.report]
fail_under = 90

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "S"]  # S = flake8-bandit rules

[tool.mypy]
strict = true
files = ["src"]
```

```python
# tests/conftest.py - authz via FastAPI dependency overrides
from fastapi.testclient import TestClient
from app.main import app, get_current_user

def client_as(user):
    app.dependency_overrides[get_current_user] = lambda: user
    yield TestClient(app)
    app.dependency_overrides.clear()
```

## Gotchas

- TestClient needs **httpx** installed explicitly; older tutorials still assume requests.
- pytest-asyncio and anyio both provide async plugins; FastAPI/Starlette projects commonly use anyio. Do not enable both for the same tests.
- `--doctest-modules` imports every module; scope it to `src` or docs only.
- pytest-xdist plus coverage needs pytest-cov's combined mode (plain coverage.py misses worker data).
- Hypothesis stores failing examples in `.hypothesis/`; cache it in CI for stable reproductions, and set a `deadline` wide enough for slow CI runners.
- freezegun is broader but slower; time-machine is faster but works at a lower level. Pick one per repo.
- pip-audit environment mode audits what is installed; lockfile mode (`-r requirements.txt` from `uv export`) is what a release actually ships.
- mutmut 3 runs pytest per mutant: nightly, scoped directories only, or it will dominate CI minutes.
- Playwright browser binaries are large; cache `~/.cache/ms-playwright` in CI.
- k6-style load must hit a staging clone: load tests against shared client data violate change-control discipline.
- Python 3.13+ free-threaded builds: some C-extension test tooling still lags; keep CI on the GIL build unless the project targets free-threading.

## Sources

- pytest: https://docs.pytest.org/
- coverage.py: https://coverage.readthedocs.io/
- Hypothesis: https://hypothesis.readthedocs.io/
- schemathesis: https://schemathesis.readthedocs.io/
- Playwright for Python: https://playwright.dev/python/docs/intro
- testcontainers-python: https://testcontainers-python.readthedocs.io/
- pip-audit: https://github.com/pypa/pip-audit
- bandit: https://bandit.readthedocs.io/
- locust: https://docs.locust.io/
- syrupy: https://syrupy.readthedocs.io/
- mutmut: https://github.com/boxed/mutmut
- pytest-bdd: https://pytest-bdd.readthedocs.io/
- uv: https://docs.astral.sh/uv/
- ty: https://docs.astral.sh/ty/
- pyrefly: https://pyrefly.org/
- FastAPI testing (dependency_overrides): https://fastapi.tiangolo.com/tutorial/testing/

Verified: on 2026-10-14, all versions in the At a glance table came from PyPI JSON release data (upload timestamps included): pytest 9.1.1, pytest-cov 7.1.0, pytest-xdist 3.8.0, pytest-bdd 9.0.0, pytest-benchmark 5.3.0, pytest-randomly 5.0.0, hypothesis 6.169.3, schemathesis 4.31.1, atheris 3.1.0, mutmut 3.8.0, cosmic-ray 8.7.0, coverage 7.16.2, ruff 0.17.0, mypy 2.4.0, pyright 1.1.414, pyrefly 1.3.2, ty 0.0.87, bandit 1.9.4, pip-audit 2.10.1, locust 2.46.7, playwright 1.64.0, nbval 0.11.0, nbmake 1.5.5, testcontainers 4.15.0, syrupy 6.1.1, freezegun 1.5.5, time-machine 3.5.1, factory_boy 3.3.3, respx 0.23.1, approvaltests 19.1.1, behave 1.3.3, chaostoolkit 1.21.4, pytest-alembic 0.13.1, detect-secrets 1.5.0, fastapi 0.143.1, uv 0.13.1; semgrep and gitleaks from GitHub releases (v1.181.0, v8.30.1). pyrefly stability (v1.0 May 2026, Google adoption October 2026) and ty beta status confirmed via pyrefly.org, astral-sh/ty README, and web search. Command syntax and config keys are from the linked docs; anything not doc-confirmed would be marked [unverified] and none needed to be.
