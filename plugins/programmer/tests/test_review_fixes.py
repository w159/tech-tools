"""Regression tests for the PR review findings (git handling, suppression, baseline, exit codes, hook, 3.9)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
sys.path.insert(0, str(PLUGIN / "scripts"))
SCANNER = PLUGIN / "scripts" / "principles"
HOOK = PLUGIN / "hooks" / "scan_on_edit.py"

VIOLATION = textwrap.dedent('''
    def run(cur, user_id):
        cur.execute(f"SELECT * FROM t WHERE id = {user_id}")
''').lstrip()
GIT = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]


def cli(*args, cwd=None):
    return subprocess.run([sys.executable, str(SCANNER), *args], capture_output=True, text=True, cwd=cwd)


def scan_json(*args):
    return json.loads(cli("scan", *args, "--format", "json").stdout)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return p

    def git(self, *args):
        subprocess.run(GIT + ["-C", str(self.root), *args], check=True, capture_output=True)

    def init_repo(self, **files):
        self.git("init", "-q")
        for rel, text in files.items():
            self.write(rel, text)
        self.git("add", "-A")
        self.git("commit", "-qm", "base")


class Py39(Base):
    def test_dry001_does_not_use_bisect_key(self):
        # bisect key= needs 3.10+; fail on any interpreter if it is passed
        import bisect
        from principles import rules_repo
        from principles.core import Module

        def strict(real):
            def f(a, x, *args, **kw):
                if "key" in kw:
                    raise TypeError("key= is 3.10+")
                return real(a, x, *args, **kw)
            return f

        p = self.write("m.py", "def f(a):\n    return a + 1\n")
        mod = Module(self.root, p, p.read_text(), False)
        with mock.patch.object(bisect, "bisect_left", strict(bisect.bisect_left)), \
                mock.patch.object(bisect, "bisect_right", strict(bisect.bisect_right)):
            self.assertTrue(rules_repo._normalized_tokens(mod, 1, 2))


class DiffMode(Base):
    def test_non_ascii_and_space_paths(self):
        names = ["café.py", "a b.py"]
        self.init_repo(**{n: "x = 1\n" for n in names})
        for n in names:
            self.write(n, "x = 1\n" + VIOLATION)
        out = cli("scan", str(self.root), "--diff").stdout
        for n in names:
            self.assertIn(f"{n}:3: SEC001", out)

    def test_untracked_path_with_space(self):
        self.init_repo(**{"seed.py": "x = 1\n"})
        self.write("new file.py", VIOLATION)
        self.assertIn("new file.py:2: SEC001", cli("scan", str(self.root), "--diff").stdout)

    def test_user_git_config_does_not_break_parsing(self):
        self.init_repo(**{"old.py": "x = 1\n"})
        self.git("config", "diff.mnemonicPrefix", "true")
        self.write("old.py", "x = 1\n" + VIOLATION)
        self.assertIn("old.py:3: SEC001", cli("scan", str(self.root), "--diff").stdout)

    def test_single_file_target(self):
        self.init_repo(**{"old.py": "x = 1\n"})
        p = self.write("old.py", "x = 1\n" + VIOLATION)
        r = cli("scan", str(p), "--diff")
        self.assertIn("old.py:3: SEC001", r.stdout, r.stderr)
        self.assertNotIn("Traceback", r.stderr)

    def test_option_like_ref_rejected(self):
        self.init_repo(**{"old.py": "x = 1\n"})
        r = cli("scan", str(self.root), "--diff=--output=pwned.txt")
        self.assertEqual(r.returncode, 2)
        self.assertIn("invalid --diff ref", r.stderr)
        self.assertFalse((self.root / "pwned.txt").exists())


class Suppression(Base):
    def run_scan(self, text):
        self.write("a.py", text)
        return scan_json(str(self.root))

    def test_malformed_bracket_suppresses_nothing(self):
        for bad in ("ignore[a-b]", "ignore[]", "ignore[SEC001"):
            d = self.run_scan(VIOLATION.replace("}\")", f"}}\")  # principles: {bad}"))
            self.assertEqual([f["rule"] for f in d["findings"]], ["SEC001"], bad)

    def test_lowercase_rule_matches_only_named(self):
        d = self.run_scan(VIOLATION.replace("}\")", "}\")  # principles: ignore[sec001]"))
        self.assertEqual(d["findings"], [])
        d = self.run_scan(VIOLATION.replace("}\")", "}\")  # principles: ignore[fn002]"))
        self.assertEqual([f["rule"] for f in d["findings"]], ["SEC001"])

    def test_trailing_comment_on_previous_line_does_not_suppress(self):
        d = self.run_scan(VIOLATION.replace("user_id):", "user_id):  # principles: ignore"))
        self.assertEqual([f["rule"] for f in d["findings"]], ["SEC001"])

    def test_standalone_comment_above_suppresses(self):
        d = self.run_scan(VIOLATION.replace("    cur.", "    # principles: ignore[SEC001]\n    cur."))
        self.assertEqual(d["findings"], [])


class Baseline(Base):
    def test_new_identical_copy_is_not_hidden(self):
        self.write("bad.py", VIOLATION)
        base = self.root / "baseline.json"
        cli("scan", str(self.root), "--write-baseline", str(base))
        self.write("bad.py", VIOLATION + "\n\n" + VIOLATION.replace("def run", "def run2"))
        d = scan_json(str(self.root), "--baseline", str(base))
        self.assertEqual((len(d["findings"]), d["baselined"]), (1, 1))

    def test_malformed_baseline_is_clean_error(self):
        self.write("bad.py", VIOLATION)
        base = self.write("b.json", '{"findings":[{}]}')
        r = cli("scan", str(self.root), "--baseline", str(base))
        self.assertEqual(r.returncode, 2)
        self.assertIn("malformed baseline", r.stderr)
        self.assertNotIn("Traceback", r.stderr)


class ParseErrors(Base):
    def test_exit_code_and_sarif_notifications(self):
        self.write("ok.py", "x = 1\n")
        self.write("broken.py", "def f(:\n")
        self.assertEqual(cli("scan", str(self.root)).returncode, 2)
        sarif = json.loads(cli("scan", str(self.root), "--format", "sarif").stdout)
        inv = sarif["runs"][0]["invocations"][0]
        self.assertFalse(inv["executionSuccessful"])
        note = inv["toolExecutionNotifications"][0]
        self.assertEqual(note["locations"][0]["physicalLocation"]["artifactLocation"]["uri"], "broken.py")


class Hook(Base):
    def run_hook(self, payload):
        env = dict(os.environ, PROGRAMMER_SCAN_ON_EDIT="1")
        return subprocess.run([sys.executable, str(HOOK)], input=payload, capture_output=True, text=True, env=env)

    def test_malformed_payloads_exit_zero(self):
        for payload in ("[]", '"s"', '{"tool_input":"x"}', '{"tool_input":{"file_path":5}}', "null"):
            r = self.run_hook(payload)
            self.assertEqual((r.returncode, r.stdout), (0, ""), payload)

    def test_config_loaded_from_project_root(self):
        self.write(".principles.toml", 'disable = ["SEC001"]\n')
        f = self.write("sub/bad.py", VIOLATION)
        r = self.run_hook(json.dumps({"tool_input": {"file_path": str(f)}}))
        if sys.version_info >= (3, 11):  # config needs tomllib
            self.assertEqual((r.returncode, r.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
