---
description: Review code changes for security, performance, and correctness
argument-hint: "<PR URL, diff, or file path>"
---

# /review

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../CONNECTORS.md).

Review code changes with a structured lens on security, performance, correctness, and maintainability.

## Usage

```
/review <PR URL or file path>
```

Review the provided code changes: @$1

If no specific file or URL is provided, ask what to review.

## How It Works

```
+-----------------------------------------------------------------+
|                      CODE REVIEW                                   |
+-----------------------------------------------------------------+
|  STANDALONE (always works)                                       |
|  [x] Paste a diff, PR URL, or point to files                      |
|  [x] Security audit (OWASP top 10, injection, auth)               |
|  [x] Performance review (N+1, memory leaks, complexity)           |
|  [x] Correctness (edge cases, error handling, race conditions)    |
|  [x] Style (naming, structure, readability)                        |
|  [x] Actionable suggestions with code examples                    |
+-----------------------------------------------------------------+
|  SUPERCHARGED (when you connect your tools)                      |
|  + Source control: Pull PR diff automatically                    |
|  + Project tracker: Link findings to tickets                     |
|  + Knowledge base: Check against team coding standards           |
+-----------------------------------------------------------------+
```

## Output

```markdown
## Code Review: [PR title or file]

### Summary
[1-2 sentence overview of the changes and overall quality]

### Critical Issues
| # | File | Line | Issue | Severity |
|---|------|------|-------|----------|
| 1 | [file] | [line] | [description] | [RED] Critical |

### Suggestions
| # | File | Line | Suggestion | Category |
|---|------|------|------------|----------|
| 1 | [file] | [line] | [description] | Performance |

### What Looks Good
- [Positive observations]

### Verdict
[Approve / Request Changes / Needs Discussion]
```

## Review Checklist

See the **code-review** skill for detailed guidance on security patterns, performance anti-patterns, and maintainability heuristics.

I check for:
- **Security**: SQL injection, XSS, auth bypass, secrets in code, insecure deserialization
- **Performance**: N+1 queries, unnecessary allocations, algorithmic complexity, missing indexes
- **Correctness**: Edge cases, null handling, race conditions, error propagation
- **Maintainability**: Naming clarity, single responsibility, test coverage, documentation

## If Connectors Available

If **~~source control** is connected:
- Pull the PR diff automatically from the URL
- Check CI status and test results

If **~~project tracker** is connected:
- Link findings to related tickets
- Verify the PR addresses the stated requirements

If **~~knowledge base** is connected:
- Check changes against team coding standards and style guides

## Tips

1. **Provide context**  -  "This is a hot path" or "This handles PII" helps me focus.
2. **Specify concerns**  -  "Focus on security" narrows the review.
3. **Include tests**  -  I'll check test coverage and quality too.
