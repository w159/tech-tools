# MCP Security Audit

Sourced from the mcp-security-audit skill. Audit MCP server configurations for security
issues -- secrets exposure, shell injection, unpinned dependencies, and unapproved servers.

## Overview

MCP servers give agents direct tool access to external systems. A misconfigured `.mcp.json`
can expose credentials, allow shell injection, or connect to untrusted servers.

```
.mcp.json -> Parse Servers -> Check Each Server:
  1. Secrets in args/env?
  2. Shell injection patterns?
  3. Unpinned versions (@latest)?
  4. Dangerous commands (eval, bash -c)?
  5. Server on approved list?
-> Generate Report
```

## When to Use

- Reviewing any `.mcp.json` file in a project
- Onboarding a new MCP server to a project
- Auditing all MCP servers in a monorepo or plugin marketplace
- Pre-commit checks for MCP configuration changes
- Security review of agent tool configurations

## Audit Check 1: Hardcoded Secrets

```python
SECRET_PATTERNS = [
    (r'(?i)(api[_-]?key|token|secret|password|credential)\s*[:=]\s*["\'][^"\']{8,}', "Hardcoded secret"),
    (r'(?i)Bearer\s+[A-Za-z0-9\-._~+/]+=*', "Hardcoded bearer token"),
    (r'(?i)(ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{30,}', "GitHub token"),
    (r'sk-[A-Za-z0-9]{20,}', "OpenAI API key"),
    (r'AKIA[0-9A-Z]{16}', "AWS access key"),
    (r'-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----', "Private key"),
]
```

Good practice -- use env var references:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["server.js"],
      "env": { "API_KEY": "${MY_API_KEY}", "DB_URL": "${DATABASE_URL}" }
    }
  }
}
```

Bad -- hardcoded credentials:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["server.js", "--api-key", "sk-abc123realkey456"],
      "env": { "DB_URL": "postgresql://admin:password123@prod-db:5432/main" }
    }
  }
}
```

## Audit Check 2: Shell Injection Patterns

```python
DANGEROUS_PATTERNS = [
    (r'\$\(', "Command substitution $(...)"),
    (r'`[^`]+`', "Backtick command substitution"),
    (r';\s*\w', "Command chaining with semicolon"),
    (r'\|\s*\w', "Pipe to another command"),
    (r'&&\s*\w', "Command chaining with &&"),
    (r'(?i)eval\s', "eval usage"),
    (r'(?i)bash\s+-c\s', "bash -c execution"),
    (r'(?i)sh\s+-c\s', "sh -c execution"),
    (r'>\s*/dev/tcp/', "TCP redirect (reverse shell pattern)"),
    (r'curl\s+.*\|\s*(ba)?sh', "curl pipe to shell"),
]
```

## Audit Check 3: Unpinned Dependencies

Flag MCP servers using `@latest` in their package references.

Good -- pinned version:
```json
{ "args": ["-y", "my-mcp-server@2.1.0"] }
```

Bad -- unpinned:
```json
{ "args": ["-y", "my-mcp-server@latest"] }
```

Also flag: `npx` without `-y` flag (may prompt interactively in CI).

## Full Audit Runner

```python
def audit_mcp_config(mcp_path: str) -> dict:
    path = Path(mcp_path)
    if not path.exists():
        return {"error": f"{mcp_path} not found"}

    config = json.loads(path.read_text(encoding="utf-8"))
    servers = config.get("mcpServers", {})
    total_findings = []

    # Run secrets check on the whole config
    config_level_findings = check_secrets(config)
    total_findings.extend(config_level_findings)

    for name, server_config in servers.items():
        if not isinstance(server_config, dict):
            continue
        findings = []
        findings.extend(check_shell_injection(server_config))
        findings.extend(check_pinned_versions(server_config))
        total_findings.extend(findings)

    return {
        "total_servers": len(servers),
        "total_findings": len(total_findings),
        "by_severity": count_by_severity(total_findings),
        "passed": len(total_findings) == 0,
    }
```

## Output Format

```
MCP Security Audit -- .mcp.json
===============================
Servers scanned: 5
Findings: 3 (1 CRITICAL, 1 HIGH, 1 MEDIUM)

[CRITICAL] my-api-server: Hardcoded secret found in MCP configuration
  Fix: Use environment variable references: ${ENV_VAR_NAME}

[HIGH] data-processor: Dangerous pattern in MCP server args: bash -c execution
  Fix: Use direct command execution, not shell interpolation

[MEDIUM] analytics: Unpinned dependency: analytics-mcp@latest
  Fix: Pin to specific version: analytics-mcp@2.1.0
```

## Related Resources

- [MCP Specification](https://modelcontextprotocol.io/)
- [OWASP ASI-02: Insecure Tool Use](https://owasp.org/www-project-agentic-ai-threats/)
