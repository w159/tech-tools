"""Regression tests for the scanner defects found in review (P1-P18)."""

from __future__ import annotations

import json
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

from principles import __version__, rules_file  # noqa: E402
from principles.engine import scan  # noqa: E402

GIT = ["git", "-c", "user.email=t@t", "-c", "user.name=t"]


def cli(*args, cwd=None):
    return subprocess.run([sys.executable, str(SCANNER), *args], capture_output=True, text=True, cwd=cwd)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, rel, text, raw=False):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if raw:
            p.write_bytes(text)
        else:
            p.write_text(textwrap.dedent(text).lstrip("\n"))
        return p

    def rules(self, src, only=None, name="m.py"):
        p = self.write(name, src)
        res = scan(p, {}, only=[only] if only else None)
        self.assertEqual(res.errors, [])
        return [f.rule for f in res.findings]


class Parsing(Base):
    def test_p1_utf8_bom_file_is_scanned(self):
        p = self.write("bom.py", b'\xef\xbb\xbfpassword="hunter2hunter2"\n', raw=True)
        r = cli("scan", str(p), "--format", "json")
        data = json.loads(r.stdout)
        self.assertEqual(data["errors"], [])
        self.assertEqual([f["rule"] for f in data["findings"]], ["SEC002"])
        self.assertEqual(r.returncode, 1)

    def test_p2_deep_expression_does_not_crash(self):
        p = self.write("deep.py", "def f():\n    return 1" + " + 1" * 5000 + "\n")
        r = cli("scan", str(p), "--format", "json")
        self.assertNotIn("Traceback", r.stderr)
        self.assertEqual(json.loads(r.stdout)["errors"], [])

    def test_p2_rule_crash_becomes_per_file_error(self):
        self.write("a.py", "def f(a, b, c, d, e, f):\n    return a\n")
        self.write("b.py", "def g():\n    return 1\n")
        with mock.patch.dict(rules_file.FILE_CHECKS, {"FN001": mock.Mock(side_effect=RecursionError("boom"))}):
            res = scan(self.root, {})
        self.assertEqual(sorted(e["path"] for e in res.errors), ["a.py", "b.py"])
        self.assertIn("FN001", res.errors[0]["error"])
        self.assertIn("FN002", [f.rule for f in res.findings])  # other rules still report

    def test_p15_non_python_file_target_is_noted(self):
        p = self.write("notes.txt", "hello\n")
        r = cli("scan", str(p))
        self.assertEqual(r.returncode, 0)
        self.assertIn("not a Python file", r.stderr)

    def test_p16_version_matches_plugin_json(self):
        meta = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())
        self.assertEqual(__version__, meta["version"])


class Cli(Base):
    def test_p9_write_baseline_still_fails_on_parse_error(self):
        self.write("broken.py", "def f(:\n")
        base = self.root / "base.json"
        r = cli("scan", str(self.root), "--write-baseline", str(base))
        self.assertEqual(r.returncode, 2)
        self.assertTrue(base.is_file())

    def test_p9_write_baseline_clean_exits_zero(self):
        self.write("ok.py", "def f():\n    return 1\n")
        r = cli("scan", str(self.root), "--write-baseline", str(self.root / "base.json"))
        self.assertEqual(r.returncode, 0)


class TestClassification(Base):
    LEAK = 'password = "hunter2hunter2"\n'

    def setUp(self):
        super().setUp()
        subprocess.run(GIT + ["-C", str(self.root), "init", "-q"], check=True, capture_output=True)
        self.write("proj/tests/helper.py", self.LEAK)
        self.write("proj/app.py", self.LEAK)

    def paths(self, target):
        return sorted(f.path for f in scan(self.root / target, {}).findings)

    def test_p8_tests_dir_classified_the_same_from_any_target(self):
        self.assertEqual(self.paths("proj"), ["app.py"])
        self.assertEqual(self.paths("proj/tests"), [])
        self.assertEqual(self.paths("proj/tests/helper.py"), [])

    def test_p8_hook_agrees_with_full_scan(self):
        import os
        env = {**os.environ, "PROGRAMMER_SCAN_ON_EDIT": "1"}
        ev = json.dumps({"tool_input": {"file_path": str(self.root / "proj/tests/helper.py")}})
        r = subprocess.run([sys.executable, str(HOOK)], input=ev, capture_output=True, text=True, env=env)
        self.assertEqual((r.returncode, r.stdout), (0, ""))


class Rules(Base):
    def test_p3_secret_prefix_modifier_not_flagged(self):
        self.assertEqual(self.rules('secret_mode = "production_mode"\n', "SEC002"), [])
        self.assertEqual(self.rules('token_bucket_policy = "leaky_variant"\n', "SEC002"), [])

    def test_p3_secret_suffix_still_flagged(self):
        for name in ("password", "db_password", "API_TOKEN", "api_key", "client_secret", "SECRET_KEY", "dbPassword"):
            self.assertEqual(self.rules(f'{name} = "hunter2hunter2"\n', "SEC002"), ["SEC002"], name)

    def test_p4_non_sql_fstring_not_flagged(self):
        self.assertEqual(self.rules('def f(runner, t):\n    runner.execute(f"make {t}")\n', "SEC001"), [])

    def test_p4_sql_still_flagged(self):
        src = 'def f(cur, t):\n    cur.execute(f"SELECT * FROM x WHERE a = {t}")\n    cur.execute("DELETE FROM x WHERE a = %s" % t)\n'
        self.assertEqual(self.rules(src, "SEC001"), ["SEC001", "SEC001"])

    def test_p5_open_inside_other_call_is_flagged(self):
        self.assertEqual(self.rules("import json\ndef f(p):\n    return json.load(open(p))\n", "RES001"), ["RES001"])

    def test_p5_managed_wrappers_stay_exempt(self):
        src = "from contextlib import closing\ndef f(p):\n    with closing(open(p)) as h:\n        return h.read()\n"
        self.assertEqual(self.rules(src, "RES001"), [])

    def test_p6_url_keyword_is_flagged(self):
        src = 'import requests\ndef f():\n    return requests.get(url="https://api.example.com/v1/items")\n'
        self.assertEqual(self.rules(src, "CFG001"), ["CFG001"])

    def test_p7_guard_on_same_attr_does_not_exempt_decrement(self):
        src = """
            class S:
                def has_stock(self):
                    if self.count > 0:
                        self.count -= 1
                    return True
        """
        self.assertEqual(self.rules(src, "CQS001"), ["CQS001"])

    def test_p7_lazy_init_stays_exempt(self):
        src = """
            class S:
                def get_conn(self):
                    if self._conn is None:
                        self._conn = object()
                    return self._conn
        """
        self.assertEqual(self.rules(src, "CQS001"), [])

    def test_p10_local_shadowing_module_list_not_flagged(self):
        src = "items = []\ndef f():\n    items = []\n    items.append(1)\n    return items\n"
        self.assertEqual(self.rules(src, "STATE001"), [])

    def test_p10_real_module_mutation_flagged(self):
        self.assertEqual(self.rules("items = []\ndef f():\n    items.append(1)\n", "STATE001"), ["STATE001"])

    def test_p11_math_log_is_not_logging(self):
        src = "import math\ndef f():\n    try:\n        pass\n    except Exception:\n        return math.log(1)\n"
        self.assertEqual(self.rules(src, "ERR001"), ["ERR001"])

    def test_p11_logger_receivers_count(self):
        for call in ("logger.exception('x')", "self.log.error('x')", "logging.getLogger(__name__).warning('x')", "traceback.print_exc()"):
            src = f"def f():\n    try:\n        pass\n    except Exception:\n        {call}\n"
            self.assertEqual(self.rules(src, "ERR001"), [], call)

    def test_p13_constant_arithmetic_in_named_constant(self):
        self.assertEqual(self.rules("TIMEOUT_SECS = 60 * 60\n", "LIT001"), [])

    def test_p13_arithmetic_with_variable_still_flagged(self):
        self.assertEqual(self.rules("def f(x):\n    return x * 60\n", "LIT001"), ["LIT001"])

    def test_p14_dotted_sleep_exempt(self):
        self.assertEqual(self.rules("import time\ndef f():\n    time.sleep(0.5)\n", "LIT001"), [])

    def test_p18_main_string_is_not_a_script(self):
        src = 'MSG = "__name__ is __main__"\ndef f():\n    print("hi")\n'
        self.assertEqual(self.rules(src, "WIN001"), ["WIN001"])

    def test_p18_real_main_guard_is_a_script(self):
        src = 'def f():\n    print("hi")\nif __name__ == "__main__":\n    f()\n'
        self.assertEqual(self.rules(src, "WIN001"), [])


if __name__ == "__main__":
    unittest.main()
