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

    def test_agents_load_symbol_toolset_up_front(self):
        """Per-tool ToolSearch mid-task loses to Grep: by then the agent has fallen back.

        One batched `select:` covering all three servers, loaded before the first
        Read/Grep/Bash. Measured failure this guards: 12 subagent runs that loaded
        serena alone, hit `KeyError: 'languages'`, and had nothing else in reach.
        """
        bad = []
        for path in _agent_files():
            body = path.read_text(encoding="utf-8")
            starts = [
                i
                for i, _ in enumerate(body)
                if body.startswith('ToolSearch("select:', i)
            ]
            if not starts:
                bad.append("%s: no up-front batched toolset load" % path.name)
                continue
            select = body[starts[0] : body.index('")', starts[0])]
            if select.count("mcp__serena__") < 3:
                bad.append("%s: loads serena tools one at a time" % path.name)
            if "mcp__lean-ctx__" not in select:
                bad.append("%s: select loads no lean-ctx tool" % path.name)
            if "context-mode" not in select:
                bad.append("%s: select loads no context-mode tool" % path.name)
        self.assertEqual(
            bad, [], "agents not loading the full toolset up front: %s" % bad
        )

    def test_agents_name_lean_ctx_not_bash_as_the_serena_fallback(self):
        """The measured defect: serena dies, the agent drops to Bash grep/cat/sed.

        Across the last 12 recorded subagent runs, every serena call failed
        (`No active project`, `KeyError: 'languages'`) and the agents fell back to
        378 Bash calls -- 61 grep, 25 cat, 15 sed -- against 8 MCP calls total, with
        zero lean-ctx calls because lean-ctx was never loaded. The agent spec must
        name lean-ctx as the fallback and Bash-as-reader as the defect.
        """
        bad = []
        for path in _agent_files():
            body = path.read_text(encoding="utf-8")
            if "lean-ctx is the fallback" not in body:
                bad.append("%s: no serena-down fallback to lean-ctx" % path.name)
            if "`Bash grep`" not in body:
                bad.append("%s: does not rule out Bash grep/cat/sed" % path.name)
        self.assertEqual(bad, [], "agents with an unusable fallback ladder: %s" % bad)

    def test_dispatch_template_names_lean_ctx_in_its_tools_block(self):
        """The orchestrator copies this template into every dispatch. If the template
        omits lean-ctx, so does the dispatch, and the subagent never loads it."""
        kit = (
            PLUGIN_ROOT
            / "skills"
            / "atlas-orchestrate"
            / "references"
            / "subagent-kit.md"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "mcp__lean-ctx__", kit, "dispatch template names no lean-ctx tool"
        )
        self.assertIn(
            "ToolSearch first",
            kit,
            "dispatch template does not order the up-front ToolSearch",
        )

    def test_agents_do_not_name_context_excluded_serena_tools(self):
        """The claude-code context excludes these; naming them guarantees a failed call.

        Empirically: every recorded search_for_pattern call errored for this reason.
        """
        excluded = (
            "search_for_pattern",
            "read_file",
            "create_text_file",
            "execute_shell_command",
            "find_file",
            "list_dir",
        )
        bad = []
        for path in _agent_files():
            body = path.read_text(encoding="utf-8")
            for tool in excluded:
                if tool in body:
                    bad.append("%s: names context-excluded %s" % (path.name, tool))
        self.assertEqual(bad, [], "agents naming excluded serena tools: %s" % bad)

    def test_dispatch_brief_overrides_serena_interactive_mode(self):
        """serena's default modes include `interactive`, which tells subagents to stop and
        ask the user questions they cannot ask. No switch_modes tool exists in the
        claude-code context, so the dispatch brief must carry the counter-instruction."""
        kit = (
            PLUGIN_ROOT
            / "skills"
            / "atlas-orchestrate"
            / "references"
            / "subagent-kit.md"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "NON-INTERACTIVE", kit, "dispatch brief has no non-interactive clause"
        )
        self.assertIn(
            "proceed without asking questions",
            kit,
            "brief does not invoke serena's documented interactive-mode escape hatch",
        )

    def test_no_atlas_file_routes_to_a_nonexistent_serena_tool(self):
        """Naming a tool serena does not have is a guaranteed failed call.

        atlas-handoff told agents to call `prepare_for_new_conversation` for
        months; no such tool exists in serena 1.6. Same defect shape as "tools
        named in prose are not callable" -- caught here instead of at runtime.
        A mention is allowed only on a line that says the tool is gone.
        """
        gone = (
            "prepare_for_new_conversation",
            "think_about_task_adherence",
            "think_about_whether_you_are_done",
            "think_about_collected_information",
            "summarize_changes",
            "switch_modes",
        )
        bad = []
        for path in sorted(PLUGIN_ROOT.rglob("*.md")):
            # A changelog's job is to record removals; naming a tool it dropped is
            # the entry, not a route to it.
            if path.name == "CHANGELOG.md":
                continue
            for lineno, line in enumerate(
                path.read_text(encoding="utf-8").splitlines(), 1
            ):
                for tool in gone:
                    if tool not in line:
                        continue
                    # A line disclaiming the tool is the documentation of its absence.
                    if any(
                        w in line for w in ("no ", "No ", "not exist", "gone", "fails")
                    ):
                        continue
                    bad.append(
                        "%s:%d routes to nonexistent %s"
                        % (path.relative_to(PLUGIN_ROOT), lineno, tool)
                    )
        self.assertEqual(
            bad, [], "atlas names serena tools that do not exist: %s" % bad
        )


class SerenaHealContract(unittest.TestCase):
    """A `.serena/project.yml` without `languages:` takes every symbol tool down.

    Serena >= 1.6 lists `languages` in ProjectConfig.FIELDS_WITHOUT_DEFAULTS, so a
    pre-1.6 config raises `KeyError: 'languages'` on activation and every later call
    answers `No active project ... known projects: []`. That is the single cause behind
    every failed serena call in the recorded subagent transcripts.
    """

    def _boot(self):
        sys.path.insert(0, str(HOOKS_DIR))
        import session_boot

        return session_boot

    def _project(self, tmp, body):
        root = Path(tmp)
        (root / ".serena").mkdir()
        (root / ".serena" / "project.yml").write_text(body, encoding="utf-8")
        (root / "app.py").write_text("x = 1\n", encoding="utf-8")
        return root

    def test_adds_languages_when_missing(self):
        boot = self._boot()
        with tempfile.TemporaryDirectory() as tmp:
            root = self._project(tmp, 'project_name: "demo"\nencoding: "utf-8"\n')
            msg = boot.heal_serena_project(str(root))
            text = (root / ".serena" / "project.yml").read_text(encoding="utf-8")
            self.assertIsNotNone(msg, "heal reported nothing on a broken config")
            self.assertIn("languages:", text)
            self.assertIn("python", text)

    def test_is_idempotent(self):
        boot = self._boot()
        with tempfile.TemporaryDirectory() as tmp:
            root = self._project(tmp, 'project_name: "demo"\nlanguages: ["python"]\n')
            before = (root / ".serena" / "project.yml").read_text(encoding="utf-8")
            self.assertIsNone(boot.heal_serena_project(str(root)))
            self.assertEqual(
                before, (root / ".serena" / "project.yml").read_text(encoding="utf-8")
            )

    def test_language_servers_key_does_not_count_as_languages(self):
        """The pre-1.6 key is `language_servers:`. Substring-matching it would leave
        the config broken while reporting it healthy."""
        boot = self._boot()
        with tempfile.TemporaryDirectory() as tmp:
            root = self._project(tmp, 'project_name: "demo"\nlanguage_servers: []\n')
            self.assertIsNotNone(boot.heal_serena_project(str(root)))
            self.assertIn(
                "languages:",
                (root / ".serena" / "project.yml").read_text(encoding="utf-8"),
            )

    def test_no_config_is_left_alone(self):
        """serena's own onboarding owns config creation; inventing one invites drift."""
        boot = self._boot()
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(boot.heal_serena_project(tmp))
            self.assertFalse((Path(tmp) / ".serena").exists())

    def test_unreadable_config_fails_open(self):
        boot = self._boot()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / ".serena").mkdir()
            (root / ".serena" / "project.yml").write_text("x", encoding="utf-8")
            os.chmod(root / ".serena" / "project.yml", 0o000)
            try:
                self.assertIsNone(boot.heal_serena_project(str(root)))
            finally:
                os.chmod(root / ".serena" / "project.yml", 0o644)

    def test_shipped_repo_config_is_valid(self):
        """This repo's own config must not be the one that breaks its subagents."""
        cfg = REPO_ROOT / ".serena" / "project.yml"
        if not cfg.exists():
            self.skipTest("no serena project config in this checkout")
        lines = cfg.read_text(encoding="utf-8").splitlines()
        self.assertTrue(
            any(ln.startswith("languages:") for ln in lines),
            "%s has no top-level languages: key -- serena will refuse to load it" % cfg,
        )


if __name__ == "__main__":
    unittest.main()


class InsightRemediationContract(unittest.TestCase):
    """Invariants for the defects named in the 2026-08-18 usage-insight report.

    Each assertion is a specific regression the report measured, encoded so it
    cannot silently come back: verdicts that never reach findings.json, a
    closeout gate that orders fresh dispatches at session end, a handoff skill
    with no preflight, and a connector that gets swept endpoint by endpoint
    while holding a stale credential.
    """

    def test_verifier_has_a_write_path_for_its_verdict(self):
        """atlas:verifier has Write disallowed. Without an explicit Bash write
        path its verdict can only be prose, which gate condition (b) cannot
        see -- the measured cause of repeated re-dispatch."""
        text = (PLUGIN_ROOT / "agents" / "verifier.md").read_text(encoding="utf-8")
        self.assertIn("disallowedTools", text)
        self.assertIn("atlas_finding.py", text)
        self.assertIn("findings.json", text)
        self.assertIn("MANDATORY", text)

    def test_finding_cli_exists_and_is_executable_by_python(self):
        cli = PLUGIN_ROOT / "scripts" / "atlas_finding.py"
        self.assertTrue(cli.is_file())
        r = subprocess.run(
            [sys.executable, str(cli), "--help"], capture_output=True, text=True
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("--status", r.stdout)

    def test_handoff_skill_runs_the_gate_preflight_before_the_summary(self):
        """The report's single most repeated failure: a handoff request that
        the Stop gate turns into a fresh remediation wave. The preflight has to
        come before the summary body, not after it."""
        text = (
            PLUGIN_ROOT / "skills" / "atlas-handoff" / "SKILL.md"
        ).read_text(encoding="utf-8")
        self.assertIn("preflight", text.lower())
        preflight_at = text.lower().index("preflight")
        summary_at = text.index("Produce a session handoff")
        self.assertLess(
            preflight_at,
            summary_at,
            "gate preflight must precede the handoff body, or it is not front-loaded",
        )
        self.assertIn("findings.json", text)
        self.assertIn("atlas_finding.py", text)

    def test_gate_block_orders_the_inline_fix_before_any_dispatch(self):
        """A block reason that leads with 'dispatch' is what dies at session
        end. Records that are merely unwritten get written inline."""
        text = (HOOKS_DIR / "completion_gate.py").read_text(encoding="utf-8")
        self.assertIn("SMALLEST deterministic action", text)
        self.assertIn("atlas_finding.py", text)
        smallest = text.index("SMALLEST deterministic action")
        dispatch_only = text.index("Dispatch a specialist ONLY when")
        self.assertLess(smallest, dispatch_only)

    def test_connector_credential_watch_is_wired_on_mcp_responses(self):
        cmds = _commands_for("PostToolUse")
        self.assertTrue(
            any("connector_credential_watch.py" in c for c in cmds),
            "connector_credential_watch.py must be bound to PostToolUse",
        )
        matchers = [
            m.get("matcher", "")
            for m in _hooks_config()["PostToolUse"]
            if any(
                "connector_credential_watch.py" in h.get("command", "")
                for h in m.get("hooks", [])
            )
        ]
        self.assertEqual(len(matchers), 1)
        matcher = matchers[0]
        # Must NOT be a blanket mcp__ sweep: lean-ctx/context-mode/serena return
        # file content, and this repo's own sources contain "Invalid Token".
        self.assertNotEqual(matcher, "mcp__.*")
        self.assertIn("mcp__plugin_atlas_", matcher)
        for content_server in ("lean-ctx", "context-mode", "serena", "context7"):
            self.assertNotIn(content_server, matcher)

    def test_tripwire_brackets_verifier_dispatches(self):
        text = (HOOKS_DIR / "dispatch_tripwire.py").read_text(encoding="utf-8")
        self.assertIn("_is_verifier", text)
        self.assertIn("_stash_findings_count", text)
        self.assertIn("_verdict_missing", text)

    def test_nudge_is_silent_when_memory_was_already_captured(self):
        """additionalContext on Stop costs a whole extra model turn. A hook that
        only announces success must not emit."""
        text = (HOOKS_DIR / "nudge.py").read_text(encoding="utf-8")
        self.assertNotIn("Self-improvement complete", text)


class NoNestedSubagentsContract(unittest.TestCase):
    """Subagents launching subagents forks work out of the orchestrator's view.
    Two independent layers must hold, so a change to either alone cannot
    reopen the hole."""

    def test_every_agent_disallows_agent_and_task(self):
        missing = []
        for path in sorted((PLUGIN_ROOT / "agents").glob("*.md")):
            fm = _frontmatter(path)
            declared = fm.get("disallowedTools", "")
            for tool in ("Agent", "Task"):
                if tool not in declared:
                    missing.append("%s -> %s" % (path.name, tool))
        self.assertEqual(missing, [], "agents that can still dispatch: %s" % missing)

    def test_every_agent_spec_says_it_does_not_dispatch(self):
        """Frontmatter is the belt; the prose stops the agent burning turns
        fighting a deny it did not expect."""
        missing = [
            p.name
            for p in sorted((PLUGIN_ROOT / "agents").glob("*.md"))
            if "You do not dispatch" not in p.read_text(encoding="utf-8")
        ]
        self.assertEqual(missing, [])

    def test_hook_denies_a_dispatch_from_a_subagent_transcript(self):
        payload = {
            "session_id": "agent-deadbeef",
            "hook_event_name": "PreToolUse",
            "tool_name": "Agent",
            "transcript_path": "/x/projects/p/sess/subagents/agent-deadbeef.jsonl",
            "tool_input": {"subagent_type": "atlas:explorer", "prompt": "ToolSearch()"},
        }
        r = subprocess.run(
            [sys.executable, str(HOOKS_DIR / "dispatch_tripwire.py")],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
        )
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)["hookSpecificOutput"]
        self.assertEqual(out["permissionDecision"], "deny")

    def test_the_deny_precedes_the_drift_kill_switch_and_the_db(self):
        """Placement is the whole trick: a subagent's session has no run row, so
        anything after current_run_id() would return early and never deny."""
        src = (HOOKS_DIR / "dispatch_tripwire.py").read_text(encoding="utf-8")
        body = src[src.index("def main():") :]
        deny_at = body.index("_deny_nested_dispatch")
        self.assertLess(deny_at, body.index('ATLAS_TRIPWIRE", "on"'))
        self.assertLess(deny_at, body.index("import atlas_db"))


class RightSizedDelegationContract(unittest.TestCase):
    """Always delegate, but do not send a squad after a one-file change."""

    def test_a_test_run_can_pair_an_implementer(self):
        """Condition (g) must accept a deterministic test, not only a verifier
        dispatch -- otherwise every task costs two subagents by construction."""
        src = (HOOKS_DIR / "completion_gate.py").read_text(encoding="utf-8")
        self.assertIn("_test_verified_this_run", src)
        self.assertIn("_unpaired_implementer_dispatches(session)", src)
        self.assertIn("_test_verified_this_run(root, session)", src)

    def test_orchestrate_skill_documents_the_wave_ladder(self):
        text = (
            PLUGIN_ROOT / "skills" / "atlas-orchestrate" / "SKILL.md"
        ).read_text(encoding="utf-8")
        self.assertIn("Right-size the wave", text)
        self.assertIn("Subagents never dispatch subagents", text)
        # The old absolute rule forced a verifier dispatch onto every task.
        self.assertNotIn(
            "every `atlas:implementer` dispatch MUST be followed by an "
            "`atlas:verifier` dispatch",
            text,
        )

    def test_small_change_still_gets_a_subagent(self):
        """Right-sizing must never be read as 'do it inline'."""
        text = (
            PLUGIN_ROOT / "skills" / "atlas-orchestrate" / "SKILL.md"
        ).read_text(encoding="utf-8")
        self.assertIn("a one-line change is still an `atlas:implementer` dispatch", text)

    def test_deny_tier_excludes_the_orchestrator_sanctioned_writes(self):
        """The gate orders docs//.atlas/ writes at closeout. Counting them
        against the inline budget would deny the remediation it just demanded."""
        src = (HOOKS_DIR / "dispatch_tripwire.py").read_text(encoding="utf-8")
        self.assertIn("unsanctioned_inline_ops_since_last_dispatch", src)
        self.assertNotIn(
            "atlas_db.inline_ops_since_last_dispatch(conn, run_id)\n    except",
            src,
        )
