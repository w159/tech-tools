# CodeQL Code Scanning

Sourced from the codeql skill. Procedural guidance for configuring and running CodeQL code
scanning through GitHub Actions workflows and the standalone CodeQL CLI.

## When to Load This Reference

- Creating or customizing a `codeql.yml` GitHub Actions workflow
- Choosing between default setup and advanced setup for code scanning
- Configuring CodeQL language matrix, build modes, or query suites
- Running CodeQL CLI locally
- Understanding or interpreting SARIF output from CodeQL
- Troubleshooting CodeQL analysis failures
- Setting up CodeQL for monorepos with per-component scanning

## Supported Languages

| Language | Identifier | Alternatives |
|---|---|---|
| C/C++ | `c-cpp` | `c`, `cpp` |
| C# | `csharp` | -- |
| Go | `go` | -- |
| Java/Kotlin | `java-kotlin` | `java`, `kotlin` |
| JavaScript/TypeScript | `javascript-typescript` | `javascript`, `typescript` |
| Python | `python` | -- |
| Ruby | `ruby` | -- |
| Rust | `rust` | -- |
| Swift | `swift` | -- |
| GitHub Actions | `actions` | -- |

## Core Workflow -- GitHub Actions

### Step 1: Choose Setup Type

- **Default setup** -- Enable from Settings -> Advanced Security -> CodeQL analysis.
  Best for getting started quickly. Uses `none` build mode for most languages.
- **Advanced setup** -- Create `.github/workflows/codeql.yml` for full control.

To switch from default to advanced: disable default setup first, then commit the workflow file.

### Step 2: Configure Workflow Triggers

```yaml
on:
  push:
    branches: [main, protected]
  pull_request:
    branches: [main]
  schedule:
    - cron: '30 6 * * 1'  # Weekly Monday 6:30 UTC
```

To skip documentation-only PRs:
```yaml
on:
  pull_request:
    paths-ignore:
      - '**/*.md'
      - '**/*.txt'
```

### Step 3: Configure Permissions

```yaml
permissions:
  security-events: write   # Required to upload SARIF results
  contents: read            # Required to checkout code
  actions: read             # Required for private repos
```

### Step 4: Configure Language Matrix

```yaml
jobs:
  analyze:
    name: Analyze (${{ matrix.language }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - language: javascript-typescript
            build-mode: none
          - language: python
            build-mode: none
```

For compiled languages: `none` / `autobuild` / `manual` build modes.

### Step 5: Configure CodeQL Init and Analysis

```yaml
steps:
  - name: Checkout repository
    uses: actions/checkout@v4

  - name: Initialize CodeQL
    uses: github/codeql-action/init@v4
    with:
      languages: ${{ matrix.language }}
      build-mode: ${{ matrix.build-mode }}
      queries: security-extended
      dependency-caching: true

  - name: Perform CodeQL Analysis
    uses: github/codeql-action/analyze@v4
    with:
      category: "/language:${{ matrix.language }}"
```

Query suite options: `security-extended`, `security-and-quality`, or custom packs via `packs:`.

### Step 6: Monorepo Configuration

```yaml
category: "/language:${{ matrix.language }}/component:frontend"
```

CodeQL config file (`.github/codeql/codeql-config.yml`):
```yaml
paths:
  - apps/
  - services/
paths-ignore:
  - node_modules/
  - '**/test/**'
```

Reference it: `config-file: .github/codeql/codeql-config.yml`

### Step 7: Manual Build Steps (Compiled Languages)

```yaml
- if: matrix.build-mode == 'manual'
  name: Build
  run: |
    make bootstrap
    make release
```

## Core Workflow -- CodeQL CLI

### Install

```bash
# Download bundle from https://github.com/github/codeql-action/releases
# Extract and add to PATH
export PATH="$HOME/codeql:$PATH"
codeql resolve packs && codeql resolve languages
```

Always use the CodeQL bundle (includes CLI + precompiled queries), not standalone CLI.

### Create Database

```bash
codeql database create codeql-db \
  --language=javascript-typescript \
  --source-root=src
```

### Analyze Database

```bash
codeql database analyze codeql-db \
  javascript-code-scanning.qls \
  --format=sarif-latest \
  --sarif-category=javascript \
  --output=results.sarif
```

### Upload Results to GitHub

```bash
codeql github upload-results \
  --repository=owner/repo \
  --ref=refs/heads/main \
  --commit=<commit-sha> \
  --sarif=results.sarif
```

Requires `GITHUB_TOKEN` with `security-events: write`.

## Alert Management

- **Standard severity:** `Error`, `Warning`, `Note`
- **Security severity:** `Critical`, `High`, `Medium`, `Low` (derived from CVSS; takes
  display precedence)
- Copilot Autofix generates fix suggestions for CodeQL alerts in PRs automatically.
- Check fails by default for `error`/`critical`/`high` severity alerts.

## Custom Queries and Packs

```yaml
- uses: github/codeql-action/init@v4
  with:
    packs: |
      my-org/my-security-queries@1.0.0
      codeql/javascript-queries:AlertSuppression.ql
```

```bash
codeql pack init my-org/my-queries
codeql pack install
codeql pack publish
```

## Troubleshooting

| Problem | Solution |
|---|---|
| Workflow not triggering | Verify `on:` triggers; check `paths`/`branches` filters; workflow must exist on target branch |
| `Resource not accessible` | Add `security-events: write` and `contents: read` |
| Autobuild failure | Switch to `build-mode: manual` with explicit build commands |
| No source code seen | Verify `--source-root`, build command, and language identifier |
| Fewer lines scanned | Switch from `none` to `autobuild`/`manual` |
| Cache miss every run | Verify `dependency-caching: true` on `init` action |
| Out of disk/memory | Use larger runners; reduce scope via `paths` config |
| SARIF upload fails | Token needs `security-events: write`; check 10 MB file size limit |
| Two CodeQL workflows | Disable default setup if using advanced setup |

## Hardware Requirements (Self-Hosted Runners)

| Codebase Size | RAM | CPU |
|---|---|---|
| Small (<100K LOC) | 8 GB+ | 2 cores |
| Medium (100K-1M LOC) | 16 GB+ | 4-8 cores |
| Large (>1M LOC) | 64 GB+ | 8 cores |

All sizes: SSD with >=14 GB free disk space.
