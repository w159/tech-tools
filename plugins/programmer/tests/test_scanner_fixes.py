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

    def test_r1_reporting_method_on_any_receiver_is_handling(self):
        for call in ("hc.warn('x', e)", "console.error(e)", "self.out.info(e)"):
            src = f"def f():\n    try:\n        pass\n    except Exception as e:\n        {call}\n"
            self.assertEqual(self.rules(src, "ERR001"), [], call)

    def test_r1_numeric_log_still_flagged(self):
        for call in ("math.log(1)", "np.log(1)", "numpy.log(2)"):
            src = f"import math, numpy, numpy as np\ndef f():\n    try:\n        pass\n    except Exception:\n        return {call}\n"
            self.assertEqual(self.rules(src, "ERR001"), ["ERR001"], call)

    def test_r2_log_receiver_matches_whole_token(self):
        for recv, want in (("blog", 1), ("self.catalog", 1), ("log", 0), ("self._logger", 0), ("self.audit_log", 0)):
            src = f"def f(blog=None):\n    try:\n        pass\n    except Exception:\n        {recv}.log('x')\n"
            self.assertEqual(len(self.rules(src, "ERR001")), want, recv)

    def test_r3_pragma_and_other_sql_keywords_flagged(self):
        for sql in ("PRAGMA table_info({t})", "WITH x AS (SELECT 1) {t}", "EXEC sp_{t}", "TRUNCATE {t}", "REPLACE INTO {t}", "MERGE {t}"):
            src = f'def f(cur, t):\n    cur.execute(f"{sql}")\n'
            self.assertEqual(self.rules(src, "SEC001"), ["SEC001"], sql)

    def test_r4_stderr_print_not_a_broken_window(self):
        src = 'import sys\ndef f():\n    print("warn", file=sys.stderr)\n'
        self.assertEqual(self.rules(src, "WIN001"), [])
        self.assertEqual(self.rules('def f():\n    print("x", file=out)\n', "WIN001"), ["WIN001"])

    def test_win001_todo_prose_not_a_marker(self):
        for c in ("# why the TODO tree is missing", "# the XXX column holds ids", "# a FIXME-free build"):
            self.assertEqual(self.rules(f"{c}\nX = 1\n", "WIN001"), [], c)

    def test_win001_todo_marker_forms_still_flagged(self):
        for c in ("# TODO", "# TODO fix", "#TODO: fix", "# FIXME(jerry): fix", "x = 1  # HACK: temp", "x = 1  # see note, XXX: bad", "## XXX later"):
            self.assertEqual(self.rules(f"{c}\n", "WIN001"), ["WIN001"], c)

    def test_win001_shebang_script_print_is_program_output(self):
        src = '#!/usr/bin/env python3\nimport json\ndef emit(d):\n    print(json.dumps(d))\n'
        self.assertEqual(self.rules(src, "WIN001"), [])

    def test_win001_library_print_still_flagged(self):
        self.assertEqual(self.rules('def emit(d):\n    print(d)\n', "WIN001"), ["WIN001"])
        self.assertEqual(self.rules('# !/usr/bin/env python3\ndef emit(d):\n    print(d)\n', "WIN001"), ["WIN001"])

    def test_win001_shebang_script_still_flags_debugger(self):
        self.assertEqual(self.rules('#!/usr/bin/env python3\ndef f():\n    breakpoint()\n', "WIN001"), ["WIN001"])

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


class ScannerFixesRound2(Base):
    def _git(self, *a):
        subprocess.run([*GIT, *a], cwd=self.root, check=True, capture_output=True)

    def test_f5_added_line_starting_plus_plus_is_not_a_file_header(self):
        old = 'def a():\n    """doc\n    """\n\n\ndef pad():\n    return 1\n\n\ndef b():\n    return 2\n'
        self.write("m.py", old)
        self._git("init", "-q")
        self._git("add", ".")
        self._git("commit", "-q", "-m", "init")
        new = old.replace('    """doc\n', '    """doc\n++ note\n').replace("return 2", 'password = "Qwerty123456!"\n    return 2')
        p = self.write("m.py", new)
        full = scan(p, {}, only=["SEC002"])
        self.assertEqual([f.rule for f in full.findings], ["SEC002"])
        diffed = scan(p, {}, only=["SEC002"], diff_ref="HEAD")
        self.assertEqual([f.rule for f in diffed.findings], ["SEC002"])

    def test_f6_walrus_secret_flagged(self):
        self.assertEqual(self.rules('if (client_secret := "Z9QWERTY12345678"):\n    pass\n', "SEC002"), ["SEC002"])

    def test_f7_tuple_unpacking_secret_flagged(self):
        self.assertEqual(self.rules('db_password, db_user = "hunter2hunter2", "svc"\n', "SEC002"), ["SEC002"])
        self.assertEqual(self.rules('db_user, db_password = "svc", "hunter2hunter2"\n', "SEC002"), ["SEC002"])
        self.assertEqual(self.rules('a, b = "hunter2hunter2", "svc"\n', "SEC002"), [])

    def test_f8_uppercase_digit_secret_flagged_but_env_names_exempt(self):
        self.assertEqual(self.rules('CLIENT_SECRET = "ABCDEF1234567890"\n', "SEC002"), ["SEC002"])
        for v in ("DB_PASSWORD", "API_KEY", "MY_SERVICE_API_TOKEN_NAME"):
            self.assertEqual(self.rules(f'CLIENT_SECRET = "{v}"\n', "SEC002"), [], v)

    def test_f9_augmented_assignment_sql_flagged(self):
        src = """
            def f(cur, user):
                sql = "SELECT * FROM users WHERE name = '"
                sql += user + "'"
                cur.execute(sql)
        """
        self.assertEqual(self.rules(src, "SEC001"), ["SEC001"])

    def test_f11_sql_keyword_inside_prose_not_flagged(self):
        src = 'def f(bot, name):\n    bot.execute(f"Please create a backup of {name}")\n'
        self.assertEqual(self.rules(src, "SEC001"), [])

    def test_f11_sql_structure_mid_text_still_flagged(self):
        for sql in ("run: select a from {t}", "do insert into {t} values (1)", "x update {t} set a = 1", "now delete from {t}"):
            src = f'def f(cur, t):\n    cur.execute(f"{sql}")\n'
            self.assertEqual(self.rules(src, "SEC001"), ["SEC001"], sql)

    def test_f11_dynamic_fragment_without_keyword_unchanged(self):
        src = 'def f(cur, prefix, w):\n    cur.execute(f"{prefix} {w}")\n'
        self.assertEqual(self.rules(src, "SEC001"), [])

    def test_f12_posonly_vararg_kwarg_shadow_module_state(self):
        for sig, body in (("_CACHE, key, value, /", "_CACHE[key] = value"), ("*_CACHE", "_CACHE[0] = 1"), ("**_CACHE", "_CACHE['a'] = 1")):
            src = f"_CACHE = {{}}\ndef fn({sig}):\n    {body}\n"
            self.assertEqual(self.rules(src, "STATE001"), [], sig)

    def test_f12_real_module_mutation_still_flagged(self):
        self.assertEqual(self.rules("_CACHE = {}\ndef fn(key, /):\n    _CACHE[key] = 1\n", "STATE001"), ["STATE001"])

    def test_f13_close_on_other_object_does_not_release(self):
        src = """
            def f(path, other):
                f = open(path)
                try:
                    other.close()
                finally:
                    other.close()
                return f.read()
        """
        self.assertEqual(self.rules(src, "RES001"), ["RES001"])

    def test_f13_close_on_bound_name_still_releases(self):
        src = """
            def f(path):
                f = open(path)
                try:
                    return f.read()
                finally:
                    f.close()
        """
        self.assertEqual(self.rules(src, "RES001"), [])


class ScannerFixesRound3(Base):
    def test_res_assigned_then_with_name_is_released(self):
        for acquire in ("urlopen(url)", "open(url)"):
            src = f"""
                from urllib.request import urlopen
                def f(url):
                    resp = {acquire}
                    with resp:
                        return resp.read()
            """
            self.assertEqual(self.rules(src, "RES001"), [], acquire)

    def test_res_with_on_other_name_still_flagged(self):
        src = """
            def f(path, other):
                fh = open(path)
                with other:
                    return fh.read()
        """
        self.assertEqual(self.rules(src, "RES001"), ["RES001"])

    def test_dry_nested_function_is_not_a_copy_of_its_enclosing_function(self):
        src = """
            def render_week(days, out):
                def section(items, buf):
                    for item in items:
                        if item.visible and item.owner:
                            buf.append(item.title.strip().upper())
                            buf.append(item.owner.strip().lower())
                            buf.append(str(item.count + item.extra))
                    return buf
                total = []
                for day in days:
                    total = section(day.items, total)
                out.write("\\n".join(total))
                return total
        """
        self.assertEqual(self.rules(src, "DRY001"), [])

    def test_sec_placeholder_join_and_int_constant_are_safe(self):
        src = """
            SCHEMA_VERSION = 2
            def f(conn, ids, n):
                marks = ",".join("?" for _ in ids)
                conn.execute(f"DELETE FROM t WHERE id IN ({marks})", ids)
                conn.execute(f"DELETE FROM t WHERE id IN ({','.join('?' * n)})", ids)
                conn.execute("DELETE FROM t WHERE id IN ({})".format(", ".join(["?"] * n)), ids)
                conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        """
        self.assertEqual(self.rules(src, "SEC001"), [])

    def test_sec_str_variable_interpolation_still_flagged(self):
        src = """
            SCHEMA_VERSION = 2
            def f(conn, table, ids):
                marks = ",".join("?" for _ in ids)
                conn.execute(f"DELETE FROM {table} WHERE id IN ({marks})", ids)
        """
        self.assertEqual(self.rules(src, "SEC001"), ["SEC001"])
        self.assertEqual(self.rules('def f(conn, v):\n    conn.execute(f"PRAGMA user_version={v}")\n', "SEC001"), ["SEC001"])

    def test_sec_unsafe_calls_flagged(self):
        cases = {
            'import os\ndef f(x):\n    os.system("ls " + x)\n': 1,
            'import subprocess\ndef f(x):\n    subprocess.run(f"ls {x}", shell=True)\n': 1,
            'def f(x):\n    return eval(x)\n': 1,
            'import pickle\ndef f(b):\n    return pickle.loads(b)\n': 1,
            'import yaml\ndef f(s):\n    return yaml.load(s)\n': 1,
            'import yaml\ndef f(s):\n    return yaml.load(s, Loader=yaml.FullLoader)\n': 1,
            'import requests\ndef f(u):\n    return requests.get(u, verify=False)\n': 1,
        }
        for src, n in cases.items():
            self.assertEqual(self.rules(src, "SEC001"), ["SEC001"] * n, src)

    def test_sec_safe_calls_not_flagged(self):
        cases = [
            'import os\ndef f():\n    os.system("ls -l")\n',
            'import subprocess\ndef f(x):\n    subprocess.run(["ls", x])\n',
            'import subprocess\ndef f(x):\n    subprocess.run(f"ls {x}")\n',
            'import subprocess\ndef f():\n    subprocess.run("ls -l", shell=True)\n',
            'def f():\n    return eval("1 + 2")\n',
            'import ast\ndef f(x):\n    return ast.literal_eval(x)\n',
            'def f(model):\n    return model.eval()\n',
            'import yaml\ndef f(s):\n    return yaml.load(s, Loader=yaml.SafeLoader)\n',
            'import yaml\ndef f(s):\n    return yaml.safe_load(s)\n',
            'import requests\ndef f(u):\n    return requests.get(u, verify=True)\n',
        ]
        for src in cases:
            self.assertEqual(self.rules(src, "SEC001"), [], src)

    def test_state_mutable_default_argument_flagged(self):
        for default in ("[]", "{}", "set()", "dict()", "list()", "{1, 2}", "[x for x in range(3)]"):
            src = f"def f(a, b={default}):\n    return b\n"
            self.assertEqual(self.rules(src, "STATE001"), ["STATE001"], default)
        self.assertEqual(self.rules("def f(*, b=[]):\n    return b\n", "STATE001"), ["STATE001"])

    def test_state_immutable_defaults_not_flagged(self):
        for default in ("None", "()", "0", '"x"', "frozenset()", "(1, 2)"):
            self.assertEqual(self.rules(f"def f(b={default}):\n    return b\n", "STATE001"), [], default)

    def test_lit_octal_mode_mask_not_magic(self):
        src = "import os\ndef f(p):\n    os.chmod(p, os.stat(p).st_mode & ~0o077)\n    return os.umask(0o022) & 0o777\n"
        self.assertEqual(self.rules(src, "LIT001"), [])

    def test_lit_decimal_still_magic(self):
        self.assertEqual(self.rules("def f(x):\n    return x * 63\n", "LIT001"), ["LIT001"])


if __name__ == "__main__":
    unittest.main()
