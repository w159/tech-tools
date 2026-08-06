"""Atlas behavioral contract -- the deterministic replacement for a verifier subagent.

Every assertion here is something an adversarial atlas:verifier used to be
dispatched to check by hand: did the change actually land, does the hook really
behave that way, do the docs still match the code. A test run answers all of it
in under a second and cannot hallucinate, get captured by a hook, or return a
narrative instead of a verdict.

Run this as the verification step. Dispatch a verifier subagent only for a claim
no test can express.

Stdlib only, no network, no fixtures.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOKS_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = HOOKS_DIR.parent
REPO_ROOT = PLUGIN_ROOT.parent.parent
HOOKS_JSON = HOOKS_DIR / "hooks.json"
OUTPUT_STYLE = PLUGIN_ROOT / "output-styles" / "atlas-orchestrator.md"

GIT_ENV = dict(
    os.environ,
    GIT_AUTHOR_NAME="t",
    GIT_AUTHOR_EMAIL="t@t",
    GIT_COMMITTER_NAME="t",
    GIT_COMMITTER_EMAIL="t@t",
)


def _hooks_config() -> dict:
    return json.loads(HOOKS_JSON.read_text(encoding="utf-8"))["hooks"]


def _commands_for(event: str) -> list:
    """Every command string bound to one lifecycle event."""
    out = []
    for matcher in _hooks_config().get(event, []):
        for hook in matcher.get("hooks", []):
            out.append(hook.get("command", ""))
    return out


def _script_paths() -> list:
    """Resolve every ${CLAUDE_PLUGIN_ROOT}-relative script hooks.json references."""
    paths = []
    for event in _hooks_config():
        for cmd in _commands_for(event):
            for token in cmd.split():
                token = token.strip('"')
                if token.endswith((".py", ".sh")):
                    paths.append(
                        Path(token.replace("${CLAUDE_PLUGIN_ROOT}", str(PLUGIN_ROOT)))
                    )
    return paths


def _run_hook(script: str, payload, cwd=None, db=None):
    """Invoke a hook exactly as Claude Code does: JSON on stdin, read stdout.

    `db` points ATLAS_DB at a throwaway sqlite file so a test never reads or
    writes the developer's real ~/.atlas/atlas.db.
    """
    env = dict(os.environ)
    if db is not None:
        env["ATLAS_DB"] = str(db)
    return subprocess.run(
        [sys.executable, str(HOOKS_DIR / script)],
        input=payload if isinstance(payload, str) else json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
    )


def _mkrepo(with_docs=True):
    """A throwaway git repo with one committed code file and a docs/ tree."""
    tmp = tempfile.mkdtemp()
    subprocess.run(["git", "init", "-q", tmp], check=True, capture_output=True)
    if with_docs:
        os.makedirs(os.path.join(tmp, "docs"), exist_ok=True)
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            Path(tmp, "docs", name).write_text("# %s\n" % name, encoding="utf-8")
    Path(tmp, "README.md").write_text("# readme\n", encoding="utf-8")
    Path(tmp, "app.py").write_text("0\n", encoding="utf-8")
    subprocess.run(["git", "-C", tmp, "add", "-A"], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", tmp, "commit", "-qm", "init"],
        check=True,
        capture_output=True,
        env=GIT_ENV,
    )
    return tmp


def _mkorchestrating_repo(session_id, with_telemetry):
    """A throwaway repo plus its own atlas.db, with this session flagged
    orchestrating -- the only state in which the gate evaluates anything.

    with_telemetry=True logs one non-write tool call, so the run's "wrote no
    files" is real data. False leaves the run with nothing logged at all, which
    is the telemetry-never-landed case the git fallback exists for.
    """
    repo = _mkrepo()
    db = os.path.join(repo, "atlas.db")
    sys.path.insert(0, str(PLUGIN_ROOT / "scripts"))
    import atlas_db

    conn = atlas_db.connect(db)
    atlas_db.init(conn)
    rid = atlas_db.mark_orchestrating(conn, session_id, cwd=repo)
    if with_telemetry:
        atlas_db.log_event(conn, rid, "Read", "main", 0, path="app.py")
    conn.close()
    return repo, db


class WiringContract(unittest.TestCase):
    """hooks.json is internally consistent and points at real files."""

    def test_hooks_json_parses(self):
        self.assertIsInstance(_hooks_config(), dict)

    def test_every_referenced_script_exists(self):
        missing = [str(p) for p in _script_paths() if not p.is_file()]
        self.assertEqual(missing, [], "hooks.json references missing scripts")

    def test_no_hook_creates_skills_or_commands(self):
        """Auto-generated skills were removed; nothing may recreate them.

        Guards the user's absolute rule: no hook writes a SKILL.md.
        """
        for path in HOOKS_DIR.glob("*.py"):
            if path.name.startswith("test_"):
                continue
            body = path.read_text(encoding="utf-8")
            self.assertNotIn("SKILL.md", body, "%s writes a skill file" % path.name)
            self.assertNotIn(
                "skill_factory", body, "%s calls the skill factory" % path.name
            )
        self.assertNotIn("auto_skill", json.dumps(_hooks_config()))

    def test_no_script_writes_a_skill_either(self):
        """The rule covers scripts, not just hooks.

        auto_skill.py was unwired in 5.5.0 but scripts/skill_factory.py -- the
        thing that actually wrote the SKILL.md files -- survived, callable by
        anything. Deleted in 5.6.0; this keeps it deleted.
        """
        self.assertFalse(
            (PLUGIN_ROOT / "scripts" / "skill_factory.py").exists(),
            "the skill factory is back",
        )
        # Reading SKILL.md is fine (the asset auditor inventories them). Writing
        # one is the banned act, so look for a write on a SKILL.md line.
        for path in (PLUGIN_ROOT / "scripts").glob("*.py"):
            if path.name.startswith("test_"):
                continue
            for lineno, line in enumerate(
                path.read_text(encoding="utf-8").splitlines(), 1
            ):
                if "SKILL.md" not in line:
                    continue
                self.assertNotRegex(
                    line,
                    r"write_text|writelines|\.write\(|open\([^)]*['\"][wa]",
                    "%s:%d writes a skill file" % (path.name, lineno),
                )

    def test_subagent_stop_injects_no_instructions(self):
        """A hook that speaks on SubagentStop hijacks the agent's final reply.

        Measured: four of six dispatches answered the nudge instead of their
        task. Only silent capture hooks may bind here.
        """
        allowed = {"ingest_session.py", "memory_capture.py"}
        bound = {
            Path(c.split()[-1].strip('"')).name for c in _commands_for("SubagentStop")
        }
        self.assertTrue(
            bound <= allowed,
            "instruction-injecting hook bound to SubagentStop: %s" % (bound - allowed),
        )


class CompletionGateContract(unittest.TestCase):
    """The Stop gate speaks only when it blocks."""

    def test_silent_when_run_shipped_no_code(self):
        """A research-only run must pass with EMPTY output.

        Narrating on a pass forces another assistant turn, which is what
        buried the user's decision points.
        """
        repo = _mkrepo()
        res = _run_hook(
            "completion_gate.py", {"cwd": repo, "session_id": "s1"}, cwd=repo
        )
        self.assertEqual(res.returncode, 0)
        self.assertEqual(res.stdout.strip(), "", "gate narrated on a passing run")

    def test_gate_falls_back_to_git_when_the_db_has_no_run_row(self):
        """Closed gap: a session whose telemetry never landed is still gated.

        Conditions (a), (b), (f) and (g) key off _run_written_paths(). With no
        run row there is no data to trust, so the gate reads the git working
        tree instead. Without this fallback such a session got a gate that
        enforced only "the docs files exist" -- the skipped-reads-as-passed
        failure mode -- and unverified code shipped through the hole.
        """
        repo, db = _mkorchestrating_repo(session_id="no-such-run", with_telemetry=False)
        Path(repo, "app.py").write_text("1\n", encoding="utf-8")
        res = _run_hook(
            "completion_gate.py",
            {"cwd": repo, "session_id": "no-such-run"},
            cwd=repo,
            db=db,
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("Definition-of-done gate", res.stdout)

    def test_gate_trusts_a_run_row_that_reports_no_writes(self):
        """The fallback must not resurrect the dirty-tree false block.

        A run row saying "this run wrote nothing" is real data. An unrelated
        dirty tree from an earlier session is not this run's problem.
        """
        repo, db = _mkorchestrating_repo(session_id="s-quiet", with_telemetry=True)
        Path(repo, "app.py").write_text("1\n", encoding="utf-8")
        res = _run_hook(
            "completion_gate.py",
            {"cwd": repo, "session_id": "s-quiet"},
            cwd=repo,
            db=db,
        )
        self.assertEqual(res.stdout.strip(), "", "dirty tree blocked a quiet run")

    def test_a_block_is_recorded_as_a_friction_event(self):
        """A gate block must be measurable, not just printed and forgotten.

        facets.gate_block_count is derived from these rows; before this it was
        permanently NULL because nothing ever wrote one.
        """
        import sqlite3

        repo, db = _mkorchestrating_repo(session_id="s-block", with_telemetry=False)
        Path(repo, "app.py").write_text("1\n", encoding="utf-8")
        _run_hook(
            "completion_gate.py",
            {"cwd": repo, "session_id": "s-block"},
            cwd=repo,
            db=db,
        )
        conn = sqlite3.connect(db)
        rows = conn.execute(
            "SELECT category, snippet FROM friction_events WHERE session_id=?",
            ("s-block",),
        ).fetchall()
        conn.close()
        self.assertEqual([r[0] for r in rows], ["gate_block"])
        self.assertIn("conditions:", rows[0][1])

    def test_no_docs_tree_is_a_noop(self):
        repo = _mkrepo(with_docs=False)
        res = _run_hook(
            "completion_gate.py", {"cwd": repo, "session_id": "s3"}, cwd=repo
        )
        self.assertEqual(res.stdout.strip(), "")


class DocsDriftWatchContract(unittest.TestCase):
    """Drift is surfaced at edit time, not only at Stop."""

    def test_warns_on_first_drifting_code_edit(self):
        repo = _mkrepo()
        Path(repo, "app.py").write_text("1\n", encoding="utf-8")
        res = _run_hook(
            "docs_drift_watch.py",
            {
                "cwd": repo,
                "session_id": "s1",
                "tool_input": {"file_path": os.path.join(repo, "app.py")},
            },
            cwd=repo,
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("docs drift", res.stdout)

    def test_silent_on_docs_edit(self):
        repo = _mkrepo()
        target = os.path.join(repo, "docs", "CHANGELOG.md")
        Path(target).write_text("# CHANGELOG\nx\n", encoding="utf-8")
        res = _run_hook(
            "docs_drift_watch.py",
            {
                "cwd": repo,
                "session_id": "s1",
                "tool_input": {"file_path": target},
            },
            cwd=repo,
        )
        self.assertEqual(res.stdout.strip(), "")

    def test_new_session_warns_despite_inherited_streak(self):
        """Debounce is session-scoped: a stale counter cannot silence a new run."""
        repo = _mkrepo()
        state = Path(repo, ".atlas", ".run")
        state.mkdir(parents=True, exist_ok=True)
        (state / "docs_drift_watch.json").write_text(
            json.dumps({"session_id": "old", "streak": 3}), encoding="utf-8"
        )
        Path(repo, "app.py").write_text("1\n", encoding="utf-8")
        res = _run_hook(
            "docs_drift_watch.py",
            {
                "cwd": repo,
                "session_id": "brand-new",
                "tool_input": {"file_path": os.path.join(repo, "app.py")},
            },
            cwd=repo,
        )
        self.assertIn("docs drift", res.stdout, "stale streak silenced a new session")


class FailOpenContract(unittest.TestCase):
    """No hook may ever wedge a session or emit a traceback."""

    BAD_INPUTS = ("", "not json{{{", "[1,2,3]", "null")

    def test_every_hook_survives_garbage_stdin(self):
        for path in sorted(HOOKS_DIR.glob("*.py")):
            if path.name.startswith("test_"):
                continue
            for payload in self.BAD_INPUTS:
                with self.subTest(hook=path.name, payload=payload[:12]):
                    res = _run_hook(path.name, payload)
                    self.assertEqual(res.returncode, 0, "%s exited nonzero" % path.name)
                    self.assertNotIn("Traceback", res.stderr)


class OutputStyleContract(unittest.TestCase):
    """The reporting rules the user asked for are actually present."""

    def test_done_is_terminal_rule_present(self):
        body = OUTPUT_STYLE.read_text(encoding="utf-8")
        self.assertIn("Done is terminal", body)
        self.assertIn("forbidden", body)

    def test_length_budget_and_decision_rules_present(self):
        body = OUTPUT_STYLE.read_text(encoding="utf-8")
        self.assertIn("Length budget", body)
        self.assertIn("DECISION NEEDED", body)

    def test_style_file_is_plain_ascii(self):
        """The file must obey the ASCII rule it declares (phase glyphs excepted)."""
        banned = "–—‘’“”…"
        body = OUTPUT_STYLE.read_text(encoding="utf-8")
        hits = sorted({c for c in body if c in banned})
        self.assertEqual(hits, [], "banned punctuation in output style: %r" % hits)


class DocsMatchCodeContract(unittest.TestCase):
    """docs/ is the SSOT: the hook tables must match hooks.json exactly."""

    def _distinct_scripts(self):
        return {p.name for p in _script_paths()}

    def test_readme_lists_every_wired_hook(self):
        readme = (PLUGIN_ROOT / "README.md").read_text(encoding="utf-8")
        missing = [s for s in self._distinct_scripts() if s not in readme]
        self.assertEqual(missing, [], "hooks wired but undocumented in README")

    def test_readme_lists_no_removed_hook(self):
        readme = (PLUGIN_ROOT / "README.md").read_text(encoding="utf-8")
        self.assertNotIn("auto_skill.py", readme, "README documents a deleted hook")


class GitignoreSecretContract(unittest.TestCase):
    """Secret shapes stay ignored inside allowlisted folders.

    The allowlist (`!docs/**`, `!.atlas/**`, `!plugins/**`) re-admits anything
    matched only by an earlier rule, so every secret pattern has to sit in the
    terminal block at the bottom of .gitignore. Probing with git check-ignore is
    the only honest check: reading the file cannot tell which rule wins.
    """

    PROBES = (
        "docs/decisions/secret.key",
        "docs/decisions/foo.pem",
        "docs/decisions/id_rsa",
        "docs/decisions/id_ecdsa",
        "docs/decisions/credentials.json",
        "docs/decisions/.git-credentials",
        "docs/audits/secret.key",
        "docs/audits/secrets.yml",
        "docs/specs/id_rsa",
        "docs/specs/app.jks",
        "docs/specs/key.p8",
        "docs/decisions/vault.jceks",
        "docs/decisions/auth.keytab",
        "docs/decisions/x.p7b",
        "docs/decisions/db.pgdump",
        "docs/decisions/db.dmp",
        "docs/decisions/dump.rdb",
        "docs/audits/db.bacpac",
        "docs/specs/db.sqlite",
        ".atlas/findings/db.sqlite3",
        ".atlas/findings/id_rsa",
        "plugins/atlas/private.pem",
        "plugins/atlas/x.db",
        "plugins/atlas/.env",
    )

    def test_secret_shapes_are_ignored_under_every_allowlisted_tree(self):
        leaked = [
            p
            for p in self.PROBES
            if subprocess.run(
                ["git", "-C", str(REPO_ROOT), "check-ignore", "-q", p]
            ).returncode
            != 0
        ]
        self.assertEqual(leaked, [], "these secret shapes are trackable: %s" % leaked)

    def test_real_docs_are_still_trackable(self):
        """The blanket patterns must not swallow the docs they sit next to."""
        for path in ("docs/CHANGELOG.md", "README.md", ".atlas/findings/INDEX.md"):
            self.assertNotEqual(
                subprocess.run(
                    ["git", "-C", str(REPO_ROOT), "check-ignore", "-q", path]
                ).returncode,
                0,
                "%s is ignored: an over-broad secret pattern" % path,
            )


class InstalledParityContract(unittest.TestCase):
    """The repo is not what runs. The installed plugin cache is.

    A whole session was spent verifying hook fixes against the working tree
    while the live system executed an older cached copy: auto_skill.py still
    wired, nudge.py still bound to SubagentStop, docs_drift_watch.py absent.
    Every test above passed the entire time. This asserts the two trees agree
    so that gap is visible instead of silent.

    Skips when no install is present (CI, fresh clone) rather than failing.
    """

    def _installed_root(self):
        version = json.loads(
            (PLUGIN_ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        )["version"]
        cache = Path.home() / ".claude/plugins/cache/tech-tools/atlas" / version
        return cache if (cache / "hooks" / "hooks.json").is_file() else None

    def test_installed_version_matches_manifest(self):
        root = self._installed_root()
        if root is None:
            self.skipTest("atlas not installed at the manifest version")
        self.assertTrue(root.is_dir())

    def test_installed_hook_bindings_match_repo(self):
        root = self._installed_root()
        if root is None:
            self.skipTest("atlas not installed at the manifest version")
        installed = json.loads(
            (root / "hooks" / "hooks.json").read_text(encoding="utf-8")
        )["hooks"]
        self.assertEqual(
            installed,
            _hooks_config(),
            "installed hook wiring differs from the repo: reinstall the plugin",
        )

    def test_installed_hook_files_match_repo(self):
        root = self._installed_root()
        if root is None:
            self.skipTest("atlas not installed at the manifest version")
        drift = []
        for path in sorted(HOOKS_DIR.glob("*.py")):
            if path.name.startswith("test_"):
                continue
            mirror = root / "hooks" / path.name
            if not mirror.is_file():
                drift.append("%s missing from install" % path.name)
            elif mirror.read_bytes() != path.read_bytes():
                drift.append("%s differs from install" % path.name)
        self.assertEqual(drift, [], "reinstall the plugin: %s" % drift)


AGENTS_DIR = PLUGIN_ROOT / "agents"

# The reasoning-depth lever for a plugin agent. Confirmed against the CLI's own
# validator strings ("has invalid effort '...'. Valid options: ... or an integer");
# there is no `thinking` frontmatter key, so effort is the only knob.
VALID_EFFORT = {"low", "medium", "high", "xhigh"}

# Subagents execute a spec the orchestrator already wrote. Opus is the orchestrator's
# tier; a subagent that needs it is a symptom of an underspecified prompt.
MAX_MODEL = {"haiku", "sonnet"}

# Only the roles that render an independent verdict against evidence they were not
# handed get medium. Everything else executes a clear spec at low.
MEDIUM_EFFORT_ROLES = {"verifier", "completeness-critic", "rls-privilege-audit"}


def _agent_files() -> list:
    return sorted(AGENTS_DIR.glob("*.md"))


def _frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    head = text.split("\n---\n", 1)[0][4:]
    out = {}
    for line in head.split("\n"):
        if ":" in line and not line.startswith((" ", "\t", "#")):
            k, _, v = line.partition(":")
            out[k.strip()] = v.strip().strip("\"'")
    return out


class AgentTierContract(unittest.TestCase):
    """Model, effort, and tool-routing guarantees for every shipped atlas agent."""

    def test_agents_exist(self):
        self.assertGreaterEqual(len(_agent_files()), 12)

    def test_every_agent_declares_a_valid_effort(self):
        bad = [
            "%s: %r" % (p.name, _frontmatter(p).get("effort"))
            for p in _agent_files()
            if _frontmatter(p).get("effort") not in VALID_EFFORT
        ]
        self.assertEqual(bad, [], "agents missing/invalid effort: %s" % bad)

    def test_no_agent_exceeds_sonnet(self):
        bad = [
            "%s: %s" % (p.name, _frontmatter(p).get("model"))
            for p in _agent_files()
            if _frontmatter(p).get("model") not in MAX_MODEL
        ]
        self.assertEqual(
            bad, [], "opus is the orchestrator's tier, not a subagent's: %s" % bad
        )

    def test_only_verdict_roles_get_medium_effort(self):
        bad = []
        for path in _agent_files():
            fm = _frontmatter(path)
            expected = "medium" if fm.get("name") in MEDIUM_EFFORT_ROLES else "low"
            if fm.get("effort") != expected:
                bad.append("%s: %s (want %s)" % (path.name, fm.get("effort"), expected))
        self.assertEqual(bad, [], "effort tier drift: %s" % bad)

    def test_no_agent_restricts_tools_and_locks_out_mcp(self):
        """A `tools:` allowlist silently excludes every mcp__* tool. Use disallowedTools."""
        bad = [p.name for p in _agent_files() if "tools" in _frontmatter(p)]
        self.assertEqual(
            bad, [], "`tools:` allowlist locks these agents out of MCP: %s" % bad
        )

    def test_every_agent_routes_to_concrete_mcp_tools(self):
        """Prose like "use serena" is why no agent ever called it. Names must be callable."""
        bad = []
        for path in _agent_files():
            body = path.read_text(encoding="utf-8")
            if "ToolSearch" not in body:
                bad.append("%s: no ToolSearch instruction" % path.name)
            if not any(
                t in body for t in ("ctx_batch_execute", "ctx_execute", "ctx_compose")
            ):
                bad.append("%s: names no context-mode/lean-ctx tool" % path.name)
        self.assertEqual(bad, [], "agents with no concrete tool routing: %s" % bad)

    def test_code_agents_name_serena_symbol_tools(self):
        needs_symbols = {
            "explorer",
            "implementer",
            "verifier",
            "planner",
            "docs-auditor",
        }
        bad = []
        for path in _agent_files():
            fm = _frontmatter(path)
            if fm.get("name") not in needs_symbols:
                continue
            body = path.read_text(encoding="utf-8")
            if not any(t in body for t in ("find_symbol", "get_symbols_overview")):
                bad.append(path.name)
        self.assertEqual(bad, [], "code agents with no serena symbol routing: %s" % bad)


if __name__ == "__main__":
    unittest.main()
