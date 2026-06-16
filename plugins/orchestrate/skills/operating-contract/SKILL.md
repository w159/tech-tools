---
name: operating-contract
description: Shared engineering operating contract for the orchestrate plugin - the verify-loop (research, document, implement, verify, report), anti-hallucination grounding, and conduct standards that every orc-* command applies. Invoke to inject these standards into the current task; the orc-* commands also pull it in automatically.
---

Apply this Operating Contract to the current task and for the rest of the session.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/references/operating-contract.md"
```

If the contract did not load above, read `skills/orchestrate/references/operating-contract.md` and apply it before proceeding.
