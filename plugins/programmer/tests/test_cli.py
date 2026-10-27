"""CLI behavior: exit codes, output formats, config, suppression, baseline, diff mode, error paths."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
SCANNER = PLUGIN / "scripts" / "principles"

VIOLATION = textwrap.dedent('''
    def run(cur, user_id):
        cur.execute(f"SELECT * FROM t WHERE id = {user_id}")
''').lstrip()


def cli(*args, cwd=None):
    return subprocess.run([sys.executable, str(SCANNER), *args], capture_output=True, text=True, cwd=cwd)


class Cli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return p

    def test_exit_codes(self):
        self.write("ok.py", "def f(x):\n    return x\n")
        self.assertEqual(cli("scan", str(self.root)).returncode, 0)
        self.write("bad.py", VIOLATION)
        r = cli("scan", str(self.root))
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("bad.py:2: SEC001 [error]", r.stdout)
        self.assertEqual(cli("scan", str(self.root), "--fail-on", "never").returncode, 0)

    def test_fail_on_warning(self):
        self.write("w.py", "def f(a, b, c, d, e):\n    return a\n")
        self.assertEqual(cli("scan", str(self.root)).returncode, 0)
        self.assertEqual(cli("scan", str(self.root), "--fail-on", "warning").returncode, 1)

    def test_missing_target_and_unknown_rule(self):
        r = cli("scan", str(self.root / "nope"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("target not found", r.stderr)
        r = cli("scan", str(self.root), "--rules", "NOPE1")
        self.assertEqual(r.returncode, 2)
        self.assertIn("unknown rule", r.stderr)

    def test_parse_error_is_reported_not_fatal(self):
        self.write("broken.py", "def f(:\n")
        self.write("bad.py", VIOLATION)
        data = json.loads(cli("scan", str(self.root), "--format", "json").stdout)
        self.assertEqual([e["path"] for e in data["errors"]], ["broken.py"])
        self.assertEqual([f["rule"] for f in data["findings"]], ["SEC001"])

    def test_json_shape(self):
        self.write("bad.py", VIOLATION)
        data = json.loads(cli("scan", str(self.root), "--format", "json").stdout)
        f = data["findings"][0]
        for key in ("rule", "path", "line", "end_line", "message", "severity", "principle", "source", "snippet", "fingerprint"):
            self.assertIn(key, f)
        self.assertEqual(data["summary"], {"SEC001": 1})

    def test_sarif_shape(self):
        self.write("bad.py", VIOLATION)
        log = json.loads(cli("scan", str(self.root), "--format", "sarif").stdout)
        self.assertEqual(log["version"], "2.1.0")
        run = log["runs"][0]
        ids = [r["id"] for r in run["tool"]["driver"]["rules"]]
        res = run["results"][0]
        self.assertEqual(res["ruleId"], "SEC001")
        self.assertEqual(ids[res["ruleIndex"]], "SEC001")
        self.assertEqual(res["level"], "error")
        loc = res["locations"][0]["physicalLocation"]
        self.assertEqual(loc["artifactLocation"]["uri"], "bad.py")
        self.assertEqual(loc["region"]["startLine"], 2)
        self.assertTrue(run["originalUriBaseIds"]["SRCROOT"]["uri"].startswith("file://"))

    def test_inline_and_file_suppression(self):
        self.write("a.py", VIOLATION.replace("}\")", "}\")  # principles: ignore[SEC001] fixture"))
        self.write("b.py", "# principles: ignore-file[SEC001]\n" + VIOLATION)
        self.write("c.py", VIOLATION.replace("}\")", "}\")  # principles: ignore[FN002] wrong rule"))
        data = json.loads(cli("scan", str(self.root), "--format", "json").stdout)
        self.assertEqual([f["path"] for f in data["findings"]], ["c.py"])
        self.assertEqual(data["suppressed"], 2)

    def test_config_thresholds_and_disable(self):
        self.write("w.py", "def f(a, b, c, d, e):\n    return a\n")
        self.write(".principles.toml", '[rules.FN002]\nmax_params = 5\n')
        self.assertNotIn("FN002", cli("scan", str(self.root)).stdout)
        self.write(".principles.toml", 'disable = ["FN002"]\n')
        self.assertNotIn("FN002", cli("scan", str(self.root), "--fail-on", "warning").stdout)
        self.write(".principles.toml", '')
        self.assertIn("FN002", cli("scan", str(self.root)).stdout)

    def test_pyproject_config(self):
        self.write("w.py", "def f(a, b, c, d, e):\n    return a\n")
        self.write("pyproject.toml", '[tool.principles.rules.FN002]\nmax_params = 6\n')
        self.assertNotIn("FN002", cli("scan", str(self.root)).stdout)

    def test_baseline_hides_known_and_shows_new(self):
        self.write("bad.py", VIOLATION)
        base = self.root / "baseline.json"
        self.assertEqual(cli("scan", str(self.root), "--write-baseline", str(base)).returncode, 0)
        # moving the line down keeps the fingerprint
        self.write("bad.py", "\n\n" + VIOLATION)
        r = cli("scan", str(self.root), "--baseline", str(base))
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("1 baselined", r.stdout)
        self.write("new.py", VIOLATION)
        r = cli("scan", str(self.root), "--baseline", str(base))
        self.assertEqual(r.returncode, 1)
        self.assertIn("new.py:2: SEC001", r.stdout)

    def test_diff_mode_reports_only_changed_lines(self):
        git = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.write("old.py", VIOLATION)
        subprocess.run(git + ["-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(git + ["-C", str(self.root), "commit", "-qm", "base"], check=True)
        self.write("old.py", VIOLATION + "\n\ndef g(a, b, c, d, e):\n    return a\n")
        self.write("fresh.py", VIOLATION)
        out = cli("scan", str(self.root), "--diff").stdout
        self.assertIn("old.py:5: FN002", out)
        self.assertIn("fresh.py:2: SEC001", out)
        self.assertNotIn("old.py:2: SEC001", out)

    def test_diff_outside_git_is_a_clean_error(self):
        self.write("bad.py", VIOLATION)
        r = cli("scan", str(self.root), "--diff")
        self.assertEqual(r.returncode, 2)
        self.assertIn("git failed", r.stderr)

    def test_single_file_target(self):
        p = self.write("bad.py", VIOLATION)
        r = cli("scan", str(p))
        self.assertEqual(r.returncode, 1)
        self.assertIn("bad.py:2: SEC001", r.stdout)

    def test_explain_and_rules(self):
        r = cli("explain", "dem001")
        self.assertEqual(json.loads(r.stdout)["id"], "DEM001")
        self.assertEqual(len(cli("rules").stdout.strip().splitlines()), 20)


if __name__ == "__main__":
    unittest.main()
