# Atlas plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename and rebuild the `orchestrate` plugin into `atlas`: one token across plugin/commands/agents/skills, a `/atlas` architect plus SessionStart boot, claude-mem and context-mode integration, a read-only capability discovery engine, and a self-improvement nudge layer, with all hooks auto-loaded.

**Architecture:** In-place rename of `plugins/orchestrate/` to `plugins/atlas/`. Hooks move to plugin root and auto-load via `hooks/hooks.json`. Commands gain the `atlas-` filename prefix; agents drop `orc-` and become `atlas:<role>`; the core skill becomes `atlas-engine`. New architect/discovery/self-improvement layers are added on top.

**Tech Stack:** Claude Code plugin (markdown commands/agents/skills, JSON manifests), Python 3 hook and discovery scripts, bash hooks, git for history-preserving renames.

**Verification base:** Run `node test-mcp-tools.mjs` is NOT applicable (that harness is for MCP servers). Plugin verification is: frontmatter parse, ASCII sweep, stale-token grep, `plugin-dev:plugin-validator`, `plugin-dev:skill-reviewer`, and manual resolution checks.

---

## Phase 0: Prep and cleanup

### Task 0: Strip cruft and gitignore it

**Files:**
- Delete: `plugins/orchestrate/.DS_Store`, `plugins/orchestrate/skills/orchestrate/.DS_Store`, `plugins/orchestrate/skills/orchestrate/hooks/__pycache__/`
- Modify: repo `.gitignore`

- [ ] **Step 1: Remove cruft from the working tree and git index**

```bash
cd "/Users/jerry/Library/Mobile Documents/com~apple~CloudDocs/Projects/Agentic/tech-tools"
find plugins/orchestrate -name .DS_Store -delete
find plugins/orchestrate -name __pycache__ -type d -exec rm -rf {} +
git rm -r --cached --ignore-unmatch "plugins/orchestrate/**/.DS_Store" "plugins/orchestrate/**/__pycache__" 2>/dev/null || true
```

- [ ] **Step 2: Ensure .gitignore covers them**

Confirm `.gitignore` contains `**/.DS_Store` and `**/__pycache__/`. Add if missing (do not duplicate).

- [ ] **Step 3: Verify**

```bash
git status --short | grep -E '\.DS_Store|__pycache__' && echo "STILL TRACKED" || echo "CLEAN"
```
Expected: `CLEAN`

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore(atlas): remove committed cruft and gitignore it"
```

---

## Phase 1: Directory and skill renames (history-preserving)

### Task 1: Rename the plugin directory

- [ ] **Step 1: git mv the plugin root**

```bash
git mv plugins/orchestrate plugins/atlas
```

- [ ] **Step 2: Verify**

```bash
test -d plugins/atlas && test ! -d plugins/orchestrate && echo OK
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor(atlas): rename plugin dir orchestrate -> atlas"
```

### Task 2: Rename the core skill and lift hooks/scripts to plugin root

**Files:**
- Move: `plugins/atlas/skills/orchestrate/` to `plugins/atlas/skills/atlas-engine/`
- Move: `plugins/atlas/skills/atlas-engine/hooks/*` to `plugins/atlas/hooks/`
- Move: `plugins/atlas/skills/atlas-engine/scripts/install_hooks.py` to `plugins/atlas/scripts/install_hooks.py`

- [ ] **Step 1: Rename skill dir**

```bash
git mv plugins/atlas/skills/orchestrate plugins/atlas/skills/atlas-engine
```

- [ ] **Step 2: Lift hooks and scripts to plugin root**

```bash
mkdir -p plugins/atlas/hooks plugins/atlas/scripts
git mv plugins/atlas/skills/atlas-engine/hooks/bash_guard.py plugins/atlas/hooks/bash_guard.py
git mv plugins/atlas/skills/atlas-engine/hooks/completion_gate.py plugins/atlas/hooks/completion_gate.py
git mv plugins/atlas/skills/atlas-engine/hooks/format_after_edit.py plugins/atlas/hooks/format_after_edit.py
git mv plugins/atlas/skills/atlas-engine/hooks/prompt_optimizer.py plugins/atlas/hooks/prompt_optimizer.py
git mv plugins/atlas/skills/atlas-engine/hooks/validate-readonly-query.sh plugins/atlas/hooks/validate-readonly-query.sh
git mv plugins/atlas/skills/atlas-engine/scripts/install_hooks.py plugins/atlas/scripts/install_hooks.py
rmdir plugins/atlas/skills/atlas-engine/hooks plugins/atlas/skills/atlas-engine/scripts 2>/dev/null || true
```

- [ ] **Step 3: Update the skill's frontmatter name**

In `plugins/atlas/skills/atlas-engine/SKILL.md`, change frontmatter `name: orchestrate` to `name: atlas-engine`. Update the skill body's self-references from "orchestrate skill" to "atlas-engine skill" and any hook/script paths that pointed at `skills/orchestrate/hooks/...` to the new plugin-root `hooks/...` / `scripts/...` paths.

- [ ] **Step 4: Verify**

```bash
ls plugins/atlas/hooks/ && grep -n "name:" plugins/atlas/skills/atlas-engine/SKILL.md | head -1
```
Expected: 5 hook files listed; `name: atlas-engine`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(atlas): rename core skill to atlas-engine, lift hooks/scripts to plugin root"
```

---

## Phase 2: Retoken commands

### Task 3: Rename the 14 command files to atlas- prefix

- [ ] **Step 1: git mv each command**

```bash
cd plugins/atlas/commands
for f in component db-audit debug feature frontend gitignore grafana handoff harden m365 prompt readme refactor vendor-assessment; do
  git mv "orc-$f.md" "atlas-$f.md"
done
cd - >/dev/null
```

- [ ] **Step 2: Verify rename**

```bash
ls plugins/atlas/commands/ | grep -c '^atlas-'
ls plugins/atlas/commands/ | grep -c '^orc-' || true
```
Expected: 14 atlas- files; 0 orc- files.

- [ ] **Step 3: Retoken in-file references**

In every `plugins/atlas/commands/atlas-*.md`, update agent references `orc-<role>` to `atlas:<role>` (e.g. `orc-explorer` to `atlas:explorer`), and any mention of "the orchestrate skill" to "the atlas-engine skill", and any `/orc-<verb>` cross-links to `/atlas-<verb>`. Do not change methodology text. Use this mapping for agent names: completeness-critic, db-prober, docs-auditor, docs-curator, explorer, implementer, planner, ui-runtime-tester, ux-accuracy-oracle, ux-cartographer, ux-fuzzer, ux-persona, ux-reporter, verifier (each prefixed `atlas:`).

- [ ] **Step 4: Verify no stale tokens in commands**

```bash
grep -rnE 'orc-[a-z]|/orc-|orchestrate skill' plugins/atlas/commands/ || echo "NONE"
```
Expected: `NONE`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(atlas): retoken commands to atlas- prefix and atlas: agent refs"
```

---

## Phase 3: Retoken agents

### Task 4: Rename the 14 agent files and name fields

- [ ] **Step 1: git mv each agent**

```bash
cd plugins/atlas/agents
for r in completeness-critic db-prober docs-auditor docs-curator explorer implementer planner ui-runtime-tester ux-accuracy-oracle ux-cartographer ux-fuzzer ux-persona ux-reporter verifier; do
  git mv "orc-$r.md" "$r.md"
done
cd - >/dev/null
```

- [ ] **Step 2: Update each agent's frontmatter name**

In each `plugins/atlas/agents/<role>.md`, change frontmatter `name: orc-<role>` to `name: <role>`. Update each agent's self-description from "for the orchestrate skill" to "for the atlas plugin" and any cross-references to sibling agents from `orc-<role>` to `atlas:<role>`.

- [ ] **Step 3: Verify**

```bash
ls plugins/atlas/agents/ | grep -c '^orc-' || true
grep -rn 'name: orc-' plugins/atlas/agents/ || echo "NONE"
```
Expected: 0 orc- files; `NONE`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(atlas): rename agents (drop orc-), namespaced as atlas:<role>"
```

---

## Phase 4: Retoken references and the engine skill body

### Task 5: Sweep references for stale tokens

**Files:** `plugins/atlas/skills/atlas-engine/references/*.md`

- [ ] **Step 1: Find stale tokens**

```bash
grep -rlnE 'orc-[a-z]|orchestrate' plugins/atlas/skills/atlas-engine/references/
```

- [ ] **Step 2: Retoken**

In each flagged reference, replace `orc-<role>` agent mentions with `atlas:<role>`, "orchestrate skill" with "atlas-engine skill", and the plugin name "orchestrate" with "atlas". Preserve the generic English verb "orchestrate" where it is used as a plain verb, not a name.

- [ ] **Step 3: Verify**

```bash
grep -rnE 'orc-[a-z]' plugins/atlas/skills/atlas-engine/references/ || echo "NONE"
```
Expected: `NONE`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(atlas): retoken atlas-engine references"
```

---

## Phase 5: New architect layer

### Task 6: SessionStart boot hook

**Files:**
- Create: `plugins/atlas/hooks/session_boot.py`

- [ ] **Step 1: Write the hook**

```python
#!/usr/bin/env python3
"""Atlas SessionStart boot. Fast, idempotent, crash-proof.

Emits additionalContext pointing at the operating contract and capability
routing, reports whether claude-mem and context-mode are present, and surfaces
a one-line ready status. Never blocks session start: any error exits 0 silently.
"""
import json
import shutil
import sys


def has_cmd(name):
    return shutil.which(name) is not None


def detect_dep(module_marker):
    # best-effort, no imports of the dep itself
    try:
        import importlib.util
        return importlib.util.find_spec(module_marker) is not None
    except Exception:
        return False


def main():
    try:
        _ = sys.stdin.read()  # consume stdin; payload unused for boot
    except Exception:
        pass

    mem = detect_dep("claude_mem") or has_cmd("claude-mem")
    ctx = detect_dep("context_mode") or has_cmd("context-mode")

    lines = [
        "Atlas runtime active. Operating contract and atlas-engine methodology apply:",
        "research -> theory -> test -> validate -> implement -> test -> verify, evidence before any done claim.",
        "Invoke the atlas-engine skill for multi-step/whole-codebase work; route subagents via atlas:<role>.",
        f"Memory (claude-mem): {'available' if mem else 'absent - run /atlas to install for self-improvement'}.",
        f"Context protection (context-mode): {'available' if ctx else 'absent - run /atlas to install for large-output work'}.",
    ]
    out = {
        "additionalContext": "\n".join(lines)[:9000],
        "systemMessage": "Atlas ready" + ("" if (mem and ctx) else " (run /atlas to complete setup)"),
    }
    sys.stdout.write(json.dumps(out))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
```

- [ ] **Step 2: Make executable and smoke-test**

```bash
chmod +x plugins/atlas/hooks/session_boot.py
echo '{"hook_event_name":"SessionStart","cwd":"."}' | python3 plugins/atlas/hooks/session_boot.py; echo "exit=$?"
```
Expected: a JSON object with `additionalContext` and `systemMessage`; `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(atlas): SessionStart boot hook"
```

### Task 7: Self-improvement nudge hook

**Files:**
- Create: `plugins/atlas/hooks/nudge.py`

- [ ] **Step 1: Write the hook**

```python
#!/usr/bin/env python3
"""Atlas self-improvement nudge. Fires on Stop and SubagentStop.

Rate-limited and non-blocking: returns additionalContext only, never exit 2.
Encourages capturing a lesson to claude-mem / .agents and a light docs-drift
check. Self-throttles via a timestamp marker so it fires at most once per
window. Any error exits 0 silently.
"""
import json
import os
import sys
import time

WINDOW_SECONDS = 900  # at most once per 15 minutes


def marker_path(cwd):
    base = os.path.join(cwd or ".", ".claude")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        base = "/tmp"
    return os.path.join(base, ".atlas_nudge")


def throttled(path):
    try:
        last = os.path.getmtime(path)
        if (time.time() - last) < WINDOW_SECONDS:
            return True
    except Exception:
        pass
    try:
        with open(path, "w") as f:
            f.write(str(time.time()))
    except Exception:
        pass
    return False


def main():
    raw = ""
    try:
        raw = sys.stdin.read()
    except Exception:
        pass
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        payload = {}
    cwd = payload.get("cwd", ".")

    if throttled(marker_path(cwd)):
        sys.exit(0)

    msg = (
        "Atlas self-improvement check: if this turn produced a reusable decision, "
        "fix, or gotcha, capture it (claude-mem observation_add or a note under "
        ".agents/) so the next session starts ahead. If you changed behavior or "
        "structure, confirm docs/ still matches (CHANGELOG/ROADMAP/architecture)."
    )
    sys.stdout.write(json.dumps({"additionalContext": msg}))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
```

- [ ] **Step 2: Make executable and smoke-test (twice for throttle)**

```bash
chmod +x plugins/atlas/hooks/nudge.py
echo '{"hook_event_name":"Stop","cwd":"/tmp/atlas-test"}' | python3 plugins/atlas/hooks/nudge.py; echo " first=$?"
echo '{"hook_event_name":"Stop","cwd":"/tmp/atlas-test"}' | python3 plugins/atlas/hooks/nudge.py; echo "second=$?"
```
Expected: first call prints JSON with `additionalContext`; second call prints nothing (throttled); both `=0`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(atlas): self-improvement nudge hook (Stop/SubagentStop, throttled)"
```

### Task 8: Auto-load hooks.json

**Files:**
- Create: `plugins/atlas/hooks/hooks.json`

- [ ] **Step 1: Write hooks.json**

```json
{
  "description": "Atlas automation: boot, guards, formatting, prompt optimization, completion gate, self-improvement nudge.",
  "hooks": {
    "SessionStart": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session_boot.py" } ] }
    ],
    "UserPromptSubmit": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/prompt_optimizer.py" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/bash_guard.py" },
        { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/validate-readonly-query.sh" }
      ] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit", "hooks": [ { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/format_after_edit.py" } ] }
    ],
    "Stop": [
      { "matcher": "*", "hooks": [
        { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/completion_gate.py" },
        { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/nudge.py" }
      ] }
    ],
    "SubagentStop": [
      { "matcher": "*", "hooks": [ { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/nudge.py" } ] }
    ]
  }
}
```

- [ ] **Step 2: Validate JSON and that referenced scripts exist**

```bash
python3 -c "import json; d=json.load(open('plugins/atlas/hooks/hooks.json')); print('events:', list(d['hooks'].keys()))"
for s in session_boot.py prompt_optimizer.py bash_guard.py validate-readonly-query.sh format_after_edit.py completion_gate.py nudge.py; do
  test -f "plugins/atlas/hooks/$s" && echo "ok $s" || echo "MISSING $s"
done
```
Expected: events listed; every script `ok`.

- [ ] **Step 3: Verify the existing hook scripts accept stdin and exit 0 with empty/benign payloads**

```bash
for s in bash_guard.py completion_gate.py format_after_edit.py prompt_optimizer.py; do
  echo '{}' | python3 "plugins/atlas/hooks/$s" >/dev/null 2>&1; echo "$s exit=$?"
done
echo '{}' | bash plugins/atlas/hooks/validate-readonly-query.sh >/dev/null 2>&1; echo "validate-readonly exit=$?"
```
Expected: each exits 0 (or its documented blocking code only on a genuinely unsafe payload, not on `{}`). If any crashes on empty input, fix the script to fail safe.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(atlas): plugin-level hooks.json auto-loading all hooks"
```

### Task 9: The /atlas architect command

**Files:**
- Create: `plugins/atlas/commands/atlas.md`

- [ ] **Step 1: Write the command**

Frontmatter (quote the description; it contains a colon) plus body:

```markdown
---
description: "Atlas architect: boot the workspace - verify/install claude-mem and context-mode, scan the project, recommend skills/plugins/MCP to install (confirm before installing), wire hooks, write project config, and seed docs/ SSOT."
argument-hint: "[optional focus: deps | discover | hooks | config | all]"
---

# /atlas - architect and configure this workspace

You are the Atlas architect. Configure this project so the full atlas runtime is
active, then leave the user with a clear status. Use the operating-contract
standards. Confirm before any install or write outside docs/ and .claude/.

Run these stages (skip to the one named in $ARGUMENTS if given; default all):

## 1. Dependencies (claude-mem + context-mode)
- Detect whether claude-mem and context-mode are installed.
- If missing, show the exact install command and ask for confirmation before
  running it. Do not install silently. claude-mem and context-mode are required
  for the memory and large-output-protection layers.
- Re-detect and report the result.

## 2. Discover capabilities
- Run `${CLAUDE_PLUGIN_ROOT}/scripts/discover_capabilities.py` (read-only) against
  the project root.
- Present the ranked recommendation list it returns (skill / plugin / MCP, with a
  one-line reason and the exact install command per item).
- Ask which to install. Install only confirmed items. Never auto-install.

## 3. Hooks
- Plugin install auto-loads `hooks/hooks.json`. Verify the hooks are active and
  report. If running outside a plugin install, offer to run
  `${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py`.

## 4. Project config
- Write or update `.claude/atlas.local.md` (YAML frontmatter) recording: detected
  stack, installed capabilities, nudge window, and any project-specific routing.
  Show the diff and confirm before writing.

## 5. Seed docs/ SSOT
- If docs/ is missing the SSOT scaffold (CHANGELOG, ROADMAP, architecture), offer
  to seed it per the docs-ssot reference. Confirm before creating files.

## 6. Report
- Print a compact status: deps state, capabilities installed/declined, hooks
  active, config path, docs/ state. End with the next recommended command.
```

- [ ] **Step 2: Validate frontmatter parses**

```bash
python3 - <<'PY'
import yaml, re, pathlib
t = pathlib.Path("plugins/atlas/commands/atlas.md").read_text()
fm = re.match(r"^---\n(.*?)\n---", t, re.S).group(1)
print("ok:", list(yaml.safe_load(fm).keys()))
PY
```
Expected: `ok: ['description', 'argument-hint']`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(atlas): /atlas architect command"
```

---

## Phase 6: Discovery engine

### Task 10: Capability catalog

**Files:**
- Create: `plugins/atlas/skills/atlas-engine/references/capability-catalog.md`

- [ ] **Step 1: Write the catalog**

A markdown table mapping detection signal to recommended asset, asset type, reason, and install command. Seed with at least these rows (extend as needed): many third-party imports -> context7 MCP; frontend (package.json with react/vue/svelte) -> playwright MCP + ui-ux-pro-max skill; `*.tf` -> terraform/IaC skill; Dockerfiles/k8s manifests -> container tooling; large/long command output patterns -> context-mode; cross-session work -> claude-mem; `*.sql`/Prisma/Drizzle -> db prober usage note; Microsoft stack (`*.ps1`, Graph SDK) -> microsoft-docs MCP; CI files -> ci-aware review. Each row must include the exact install command (e.g. `claude plugin install ...` or `claude mcp add ...`).

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(atlas): capability catalog reference"
```

### Task 11: Discovery script

**Files:**
- Create: `plugins/atlas/scripts/discover_capabilities.py`

- [ ] **Step 1: Write the script (read-only scan -> ranked JSON + human table)**

```python
#!/usr/bin/env python3
"""Atlas capability discovery. Strictly read-only.

Scans a project for stack signals and emits ranked recommendations (skills,
plugins, MCP servers) with reasons and exact install commands. Never installs
anything. Prints a human table and a JSON block. Exits 0 always.
"""
import json
import os
import sys

# signal -> recommendation
RULES = [
    {"id": "context7", "type": "mcp", "reason": "Project uses many third-party libraries; live docs reduce guesswork.",
     "cmd": "claude mcp add context7 -- npx -y @upstash/context7-mcp",
     "match": lambda f, c: c["dep_count"] >= 8},
    {"id": "playwright", "type": "mcp", "reason": "Frontend project; browser tests and runtime UI checks.",
     "cmd": "claude mcp add playwright -- npx -y @playwright/mcp@latest",
     "match": lambda f, c: c["frontend"]},
    {"id": "ui-ux-pro-max", "type": "skill", "reason": "Frontend project; design-system and UX guidance.",
     "cmd": "claude plugin install ui-ux-pro-max",
     "match": lambda f, c: c["frontend"]},
    {"id": "context-mode", "type": "plugin", "reason": "Large outputs/logs present; protect the context window.",
     "cmd": "claude plugin install context-mode",
     "match": lambda f, c: c["has_logs"] or c["big_files"]},
    {"id": "claude-mem", "type": "plugin", "reason": "Multi-session codebase; persist lessons across sessions.",
     "cmd": "claude plugin install claude-mem",
     "match": lambda f, c: True},
    {"id": "terraform", "type": "skill", "reason": "Terraform/IaC files found.",
     "cmd": "claude plugin install <iac-skill>",
     "match": lambda f, c: c["terraform"]},
]

SKIP_DIRS = {".git", "node_modules", ".venv", ".venv.nosync.noindex", "dist", "build", "__pycache__", ".next"}


def scan(root):
    ctx = {"dep_count": 0, "frontend": False, "terraform": False,
           "has_logs": False, "big_files": False, "files": 0}
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS]
        for fn in fns:
            ctx["files"] += 1
            low = fn.lower()
            if low.endswith(".tf"):
                ctx["terraform"] = True
            if low.endswith(".log"):
                ctx["has_logs"] = True
            if fn == "package.json":
                p = os.path.join(dp, fn)
                try:
                    pkg = json.load(open(p))
                    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
                    ctx["dep_count"] = max(ctx["dep_count"], len(deps))
                    if any(k in deps for k in ("react", "vue", "svelte", "next", "@angular/core")):
                        ctx["frontend"] = True
                except Exception:
                    pass
            try:
                if os.path.getsize(os.path.join(dp, fn)) > 1_000_000:
                    ctx["big_files"] = True
            except Exception:
                pass
    return ctx


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    ctx = scan(root)
    recs = []
    for r in RULES:
        try:
            if r["match"](None, ctx):
                recs.append({"id": r["id"], "type": r["type"], "reason": r["reason"], "command": r["cmd"]})
        except Exception:
            pass
    print("Atlas capability recommendations:")
    print(f"  scanned {ctx['files']} files under {os.path.abspath(root)}")
    for r in recs:
        print(f"  [{r['type']:6}] {r['id']:16} - {r['reason']}")
        print(f"           install: {r['command']}")
    print("\nJSON:")
    print(json.dumps({"context": ctx, "recommendations": recs}, indent=2))
    sys.exit(0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test against the repo root**

```bash
chmod +x plugins/atlas/scripts/discover_capabilities.py
python3 plugins/atlas/scripts/discover_capabilities.py . | head -20; echo "exit=$?"
```
Expected: a recommendations table including claude-mem; valid JSON; `exit=0`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(atlas): read-only capability discovery script"
```

---

## Phase 7: Architect and self-improvement skills

### Task 12: atlas-architect skill

**Files:**
- Create: `plugins/atlas/skills/atlas-architect/SKILL.md`

- [ ] **Step 1: Write the skill**

Frontmatter `name: atlas-architect` with a quoted description covering: when to use (boot/configure a project, set up memory + context-mode, discover capabilities). Body documents the same six stages as the `/atlas` command (dependencies, discovery, hooks, config, docs seed, report), the recommend-then-confirm rule, references `scripts/discover_capabilities.py` and `references/capability-catalog.md`, and the `.claude/atlas.local.md` config schema. Keep it the methodology that the `/atlas` command and SessionStart boot both lean on.

- [ ] **Step 2: Validate frontmatter parses (reuse the yaml check from Task 9 Step 2 with this path)**

Expected: keys include `name`, `description`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(atlas): atlas-architect skill"
```

### Task 13: self-improving skill

**Files:**
- Create: `plugins/atlas/skills/self-improving/SKILL.md`
- Source: `plugins/atlas/skills/atlas-engine/references/self-improving.md`

- [ ] **Step 1: Write the skill from the reference**

Frontmatter `name: self-improving`, quoted description (when to use: capture a lesson, surface a past lesson, improve tooling across sessions). Body: the capture format (Decision/Pattern/Error/Constraint), where it goes (claude-mem observation_add + committed `.agents/` notes), how the nudge hook ties in, and the look-back-on-resume loop (query claude-mem before re-deriving). Reference the existing `references/self-improving.md` for the long form rather than duplicating it wholesale.

- [ ] **Step 2: Validate frontmatter parses**

Expected: keys include `name`, `description`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(atlas): self-improving skill"
```

---

## Phase 8: Manifests, marketplace, README

### Task 14: plugin.json

**Files:**
- Modify: `plugins/atlas/.claude-plugin/plugin.json`

- [ ] **Step 1: Update fields**

Set `name` to `atlas`, `version` to `1.0.0`, repath `homepage` and `repository` to `plugins/atlas`. Rewrite `description` to describe the architect (`/atlas`), the SessionStart boot, claude-mem + context-mode integration, the capability discovery engine, the self-improvement nudge, the 14-agent squad, and the `/atlas-*` command library. Rewrite `keywords` to include: atlas, architect, self-improving, claude-mem, context-mode, capability-discovery, subagents, hooks, verification, docs-as-code (keep the still-accurate existing ones).

- [ ] **Step 2: Validate JSON**

```bash
python3 -c "import json; d=json.load(open('plugins/atlas/.claude-plugin/plugin.json')); print(d['name'], d['version'])"
```
Expected: `atlas 1.0.0`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore(atlas): plugin.json -> atlas 1.0.0 with new layers"
```

### Task 15: marketplace.json

**Files:**
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Update the entry**

In the `plugins` array, change the `orchestrate` entry: `name` to `atlas`, `source` to `./plugins/atlas`, `description` and `keywords` to match plugin.json.

- [ ] **Step 2: Validate JSON and entry**

```bash
python3 -c "import json; d=json.load(open('.claude-plugin/marketplace.json')); names=[p['name'] for p in d['plugins']]; print('atlas' in names, 'orchestrate' not in names, len(names))"
```
Expected: `True True 12`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore(atlas): marketplace entry orchestrate -> atlas"
```

### Task 16: README

**Files:**
- Modify: `plugins/atlas/README.md`

- [ ] **Step 1: Rewrite**

Rewrite for the atlas token. Cover: what Atlas is (architect + engine + self-improvement), the `/atlas` boot and SessionStart auto-load, the recommend-then-confirm discovery, claude-mem + context-mode dependence, the command table (`/atlas` plus 14 `/atlas-*`), the agent list (`atlas:<role>`), the 4 skills, and the 7 hooks. Counts must be exact: 15 commands, 14 agents, 4 skills, 7 hooks. ASCII only, no AI-tell phrasing.

- [ ] **Step 2: Verify counts referenced match the tree**

```bash
echo "commands: $(ls plugins/atlas/commands/*.md | wc -l)"
echo "agents:   $(ls plugins/atlas/agents/*.md | wc -l)"
echo "skills:   $(ls -d plugins/atlas/skills/*/ | wc -l)"
echo "hooks:    $(ls plugins/atlas/hooks/*.py plugins/atlas/hooks/*.sh | wc -l)"
```
Expected: commands 15, agents 14, skills 4, hooks 7.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs(atlas): rewrite README for atlas"
```

---

## Phase 9: Whole-plugin verification

### Task 17: Frontmatter, ASCII, and stale-token sweeps

- [ ] **Step 1: Frontmatter parse across all command/agent/skill files**

```bash
python3 - <<'PY'
import yaml, re, pathlib, sys
bad=[]
for p in pathlib.Path("plugins/atlas").rglob("*.md"):
    t=p.read_text(errors="replace")
    m=re.match(r"^---\n(.*?)\n---", t, re.S)
    if not m:
        continue
    try:
        yaml.safe_load(m.group(1))
    except Exception as e:
        bad.append((str(p), str(e).splitlines()[0]))
print("PARSE FAILURES:", len(bad))
for b in bad: print(" ", b)
sys.exit(1 if bad else 0)
PY
```
Expected: `PARSE FAILURES: 0`.

- [ ] **Step 2: ASCII-only sweep (writing-style rule)**

```bash
grep -rlnP '[\x{2013}\x{2014}\x{2018}\x{2019}\x{201C}\x{201D}\x{2026}]' plugins/atlas/ || echo "ASCII CLEAN"
```
Expected: `ASCII CLEAN`. Fix any flagged file by replacing the smart character with its ASCII equivalent.

- [ ] **Step 3: Stale-token sweep across the whole repo**

```bash
grep -rnE 'orc-[a-z]|orchestrate:orc|skills/orchestrate|plugins/orchestrate' --include='*.md' --include='*.json' --include='*.py' . | grep -v 'docs/superpowers/' || echo "NO STALE TOKENS"
```
Expected: `NO STALE TOKENS` (the spec/plan under docs/superpowers/ are allowed to mention history).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix(atlas): clear frontmatter/ASCII/stale-token issues from sweep" || echo "nothing to fix"
```

### Task 18: Agent-based validation

- [ ] **Step 1: Run plugin-dev:plugin-validator**

Dispatch `plugin-dev:plugin-validator` against `plugins/atlas/`. Address any structural or manifest findings, recommit.

- [ ] **Step 2: Run plugin-dev:skill-reviewer**

Dispatch `plugin-dev:skill-reviewer` against the 4 skills (`atlas-engine`, `atlas-architect`, `operating-contract`, `self-improving`). Address description/triggering findings, recommit.

- [ ] **Step 3: Adversarial verification**

Dispatch `atlas:verifier` (or `general-purpose`) to independently confirm: `/atlas` and two `/atlas-*` commands resolve by filename; one agent resolves as `atlas:<role>`; `hooks.json` parses and references existing scripts; `session_boot.py` and `nudge.py` exit 0 with no creds. Require evidence (command + output) per claim.

### Task 19: Final manual resolution check

- [ ] **Step 1: Confirm structure end-to-end**

```bash
ls plugins/atlas/commands/atlas.md plugins/atlas/commands/atlas-feature.md
ls plugins/atlas/agents/explorer.md
test -f plugins/atlas/hooks/hooks.json && echo "hooks.json present"
python3 plugins/atlas/scripts/discover_capabilities.py . >/dev/null && echo "discovery ok"
```
Expected: all paths exist; `hooks.json present`; `discovery ok`.

- [ ] **Step 2: Final commit / branch status**

```bash
git status --short && git log --oneline atlas-plugin -15
```
Expected: clean tree; the task commits present.

---

## Notes for the executor

- iCloud caution: use `git mv` for every rename (done above). Do not bulk filesystem-move.
- Never run `npm install` under this repo path. None of these tasks require it.
- The existing hook scripts (`bash_guard.py`, `completion_gate.py`, `format_after_edit.py`, `prompt_optimizer.py`, `validate-readonly-query.sh`) keep their behavior; only their location changed. If any crashes on `{}` stdin, patch it to fail safe (exit 0) - that is in scope.
- Do not change the methodology text of the 14 commands/agents beyond retokening and reference updates.
