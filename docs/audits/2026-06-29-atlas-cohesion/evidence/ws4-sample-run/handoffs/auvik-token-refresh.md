# Harden Auvik token refresh
HIGH severity in `package.json:14`. Refresh path lacks retry/backoff.
Acceptance: exponential backoff + jitter; verifier confirms 3 retries. Lead: backend-architect.
