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


def _run_hook(script: str, payload, cwd=None):
    """Invoke a hook exactly as Claude Code does: JSON on stdin, read stdout."""
    return subprocess.run(
        [sys.executable, str(HOOKS_DIR / script)],
        input=payload if isinstance(payload, str) else json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=cwd,
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

    def test_gate_is_inert_when_the_db_has_no_run_row(self):
        """KNOWN GAP, asserted so it cannot rot silently.

        Conditions (a) evidence, (b) verified finding, (f) docs drift and
        (g) verifier coverage all key off _run_written_paths(), which reads
        atlas_db run rows by session_id and fails open to [] on any miss.
        No run row means code_changed is False, which means those four
        conditions are skipped and the gate passes on uncommitted code.

        A session whose telemetry never landed therefore gets a gate that
        enforces only "the docs files exist". That is the skipped-reads-as-
        passed failure mode. This test documents the real behavior; flip it
        to assert "block" if the gate gains a git-derived fallback.
        """
        repo = _mkrepo()
        Path(repo, "app.py").write_text("1\n", encoding="utf-8")
        res = _run_hook(
            "completion_gate.py", {"cwd": repo, "session_id": "no-such-run"}, cwd=repo
        )
        self.assertEqual(res.returncode, 0)
        self.assertEqual(
            res.stdout.strip(), "", "gate behavior changed: update this test"
        )

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


if __name__ == "__main__":
    unittest.main()
