# Security Review

Sourced from the security-review skill. AI-powered codebase security scanner that reasons
about code like a security researcher -- tracing data flows, understanding component
interactions, and catching vulnerabilities that pattern-matching tools miss.

## When to Use

- Scanning a codebase or file for security vulnerabilities
- Running a security review or vulnerability check
- Checking for SQL injection, XSS, command injection, or other injection flaws
- Finding exposed API keys, hardcoded secrets, or credentials in code
- Auditing dependencies for known CVEs
- Reviewing authentication, authorization, or access control logic
- Detecting insecure cryptography or weak randomness
- Performing a data flow analysis to trace user input to dangerous sinks
- Any phrasing like "is my code secure?", "scan this file", or "check my repo for vulnerabilities"

## How This Skill Works

Unlike traditional static analysis tools that match patterns, this skill:
1. Reads code like a security researcher -- understanding context, intent, and data flow
2. Traces across files -- following how user input moves through the application
3. Self-verifies findings -- re-examines each result to filter false positives
4. Assigns severity ratings -- CRITICAL / HIGH / MEDIUM / LOW / INFO
5. Proposes targeted patches -- every finding includes a concrete fix
6. Requires human approval -- nothing is auto-applied

## Execution Workflow

### Step 1 -- Scope Resolution

Determine what to scan:
- If a path was provided, scan only that scope; otherwise scan the entire project.
- Identify the language(s) and framework(s) in use (check package.json, requirements.txt,
  go.mod, Cargo.toml, pom.xml, Gemfile, composer.json, etc.).

### Step 2 -- Dependency Audit

Before scanning source code, audit dependencies (fast wins):
- Node.js: check `package.json` + `package-lock.json` for known vulnerable packages.
- Python: check `requirements.txt` / `pyproject.toml` / `Pipfile`.
- Java: check `pom.xml` / `build.gradle`.
- Ruby: check `Gemfile.lock`. Rust: `Cargo.toml`. Go: `go.sum`.
- Flag packages with known CVEs, deprecated crypto libs, or suspiciously old pinned versions.

### Step 3 -- Secrets and Exposure Scan

Scan ALL files (config, env, CI/CD, Dockerfiles, IaC) for:
- Hardcoded API keys, tokens, passwords, private keys
- `.env` files accidentally committed
- Secrets in comments or debug logs
- Cloud credentials (AWS, GCP, Azure, Stripe, Twilio, etc.)
- Database connection strings with credentials embedded

### Step 4 -- Vulnerability Deep Scan

Reason about the code -- do not just pattern-match.

**Injection Flaws**
- SQL Injection: raw queries with string interpolation, ORM misuse, second-order SQLi
- XSS: unescaped output, dangerouslySetInnerHTML, innerHTML, template injection
- Command Injection: exec/spawn/system with user input
- LDAP, XPath, Header, Log injection

**Authentication and Access Control**
- Missing authentication on sensitive endpoints
- Broken object-level authorization (BOLA/IDOR)
- JWT weaknesses (alg:none, weak secrets, no expiry validation)
- Session fixation, missing CSRF protection
- Privilege escalation paths, mass assignment / parameter pollution

**Data Handling**
- Sensitive data in logs, error messages, or API responses
- Missing encryption at rest or in transit
- Insecure deserialization, path traversal, XXE, SSRF

**Cryptography**
- Use of MD5, SHA1, DES for security purposes
- Hardcoded IVs or salts
- Weak random number generation (Math.random() for tokens)
- Missing TLS certificate validation

**Business Logic**
- Race conditions (TOCTOU)
- Integer overflow in financial calculations
- Missing rate limiting on sensitive endpoints
- Predictable resource identifiers

### Step 5 -- Cross-File Data Flow Analysis

After the per-file scan:
- Trace user-controlled input from entry points (HTTP params, headers, body, file uploads)
  to sinks (DB queries, exec calls, HTML output, file writes).
- Identify vulnerabilities that only appear when looking at multiple files together.
- Check for insecure trust boundaries between services or modules.

### Step 6 -- Self-Verification Pass

For each finding:
1. Re-read the relevant code with fresh eyes.
2. Ask: "Is this actually exploitable, or is there sanitization I missed?"
3. Check if a framework or middleware already handles this upstream.
4. Downgrade or discard findings that are not genuine vulnerabilities.
5. Assign final severity: CRITICAL / HIGH / MEDIUM / LOW / INFO.

### Step 7 -- Generate Security Report

Output a full report structured as:
- Findings summary table (counts by severity, confidence)
- Findings grouped by category (not by file)
- Each finding: severity, file:line, vulnerable snippet, risk explanation, confidence

### Step 8 -- Propose Patches

For every CRITICAL and HIGH finding:
- Show the vulnerable code (before)
- Show the fixed code (after)
- Explain what changed and why
- Preserve the original code style, variable names, and structure

Explicitly state: "Review each patch before applying. Nothing has been changed yet."

## Output Rules

- Always produce a findings summary table first (counts by severity).
- Never auto-apply any patch -- present patches for human review only.
- Always include a confidence rating per finding (High / Medium / Low).
- Group findings by category, not by file.
- Be specific -- include file path, line number, and the exact vulnerable code snippet.
- Explain the risk in plain English -- what could an attacker do with this?
- If the codebase is clean, say so clearly with what was scanned.
