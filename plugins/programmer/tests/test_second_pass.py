"""Second-pass regressions: false positives measured on a real corpus, and LIT001 run time."""

from __future__ import annotations

import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

from principles.engine import scan  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def found(self, src, rule, name="m.py"):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(textwrap.dedent(src).lstrip("\n"))
        res = scan(p, {}, only=[rule])
        self.assertEqual(res.errors, [])
        return [f.line for f in res.findings]


class Lit001Speed(Base):
    def test_many_numbers_scan_in_linear_time(self):
        # get_source_segment re-split the whole file for every int literal: 8000 lines took 50 s
        body = "".join(f"    x = x * {i + 2} + 7\n" for i in range(8000))
        p = self.root / "big.py"
        p.write_text("def f(x):\n" + body + "    return x\n")
        start = time.monotonic()
        res = scan(p, {}, only=["LIT001"])
        elapsed = time.monotonic() - start
        self.assertGreater(len(res.findings), 15000)
        self.assertLess(elapsed, 5.0)

    def test_octal_still_exempt_and_decimal_still_flagged(self):
        lines = self.found(
            """
            import os
            def f(p):
                os.chmod(p, 0o644)
                return p * 42
        """,
            "LIT001",
        )
        self.assertEqual(lines, [4])


class Cfg001(Base):
    def test_loopback_and_reserved_hosts_are_not_endpoints(self):
        lines = self.found(
            """
            def urls(port):
                a = f"http://127.0.0.1:{port}/v1"
                b = "http://localhost:8080"
                c = "http://evil.test/x"
                d = "http://[::1]:9000/x"
                return a, b, c, d
        """,
            "CFG001",
        )
        self.assertEqual(lines, [])

    def test_env_and_config_fallback_default_is_configuration(self):
        lines = self.found(
            """
            import os
            def base(pin):
                a = os.environ.get("OLLAMA_HOST") or "http://ollama.internal:11434"
                b = os.getenv("API_URL", "https://api.vendor.io")
                c = pin.get("install_url") or "https://vendor.dev"
                return a, b, c
        """,
            "CFG001",
        )
        self.assertEqual(lines, [])

    def test_documentation_links_are_not_endpoints(self):
        lines = self.found(
            """
            TOOLS = {"x": {"docs_url": "https://github.com/a/b", "homepage": "https://a.dev"}}
            def hint(err):
                return err("missing", install_cmd="https://vendor.dev")
        """,
            "CFG001",
        )
        self.assertEqual(lines, [])

    def test_hardcoded_service_endpoint_still_flagged(self):
        lines = self.found(
            """
            import requests
            def fetch():
                return requests.get("https://api.vendor.io/v2/items")
        """,
            "CFG001",
        )
        self.assertEqual(lines, [3])


class Dem001(Base):
    def test_string_method_chains_are_not_navigation(self):
        lines = self.found(
            """
            def f(node, head, out):
                a = node.stdout.strip().lstrip("v").split(".")
                b = head.splitlines()[0].strip().rstrip(".!").upper()
                c = out.replace("a", "b").replace("c", "d").replace("e", "f").replace("g", "h")
                return a, b, c
        """,
            "DEM001",
        )
        self.assertEqual(lines, [])

    def test_mock_configuration_is_not_navigation(self):
        lines = self.found(
            """
            def f(cm, m):
                cm.__enter__.return_value.read.return_value = b"x"
                return m.load_snapshot.call_args.kwargs.get("root")
        """,
            "DEM001",
        )
        self.assertEqual(lines, [])

    def test_object_graph_navigation_still_flagged(self):
        lines = self.found(
            """
            def f(order):
                return order.customer.address.city.name
        """,
            "DEM001",
        )
        self.assertEqual(lines, [2])


class Sec001(Base):
    def test_module_string_constant_is_not_injection(self):
        lines = self.found(
            """
            GOOD_KINDS = "kind NOT IN ('error','metric')"
            def f(c):
                return c.execute("SELECT MAX(ts) FROM scores WHERE %s" % GOOD_KINDS)
        """,
            "SEC001",
        )
        self.assertEqual(lines, [])

    def test_loop_over_literal_table_names_is_not_injection(self):
        lines = self.found(
            """
            TABLES = ("events", "dispatches")
            def f(conn):
                for t in TABLES:
                    conn.execute(f"DELETE FROM {t} WHERE run_id = ?", (1,))
                for tbl in ("a", "b"):
                    conn.execute(f"SELECT COUNT(*) FROM {tbl}")
        """,
            "SEC001",
        )
        self.assertEqual(lines, [])

    def test_pairs_conditional_constant_and_joined_columns_are_not_injection(self):
        lines = self.found(
            """
            COLUMNS = ("metric", "verdict")
            def f(conn, hit):
                for col, decl in (("metric", "TEXT"), ("verdict", "TEXT")):
                    conn.execute(f"ALTER TABLE t ADD COLUMN {col} {decl}")
                c = "hits" if hit else "misses"
                conn.execute("UPDATE m SET %s=%s+1" % (c, c))
                conn.execute("INSERT INTO t(" + ",".join(COLUMNS) + ") VALUES(?,?)", (1, 2))
            """,
            "SEC001",
        )
        self.assertEqual(lines, [])

    def test_untrusted_name_still_flagged(self):
        lines = self.found(
            """
            def f(conn, name):
                for t in ("a", "b"):
                    t = name
                    conn.execute(f"DELETE FROM {t}")
                return conn.execute("SELECT * FROM x WHERE id = %s" % name)
        """,
            "SEC001",
        )
        self.assertEqual(lines, [4, 5])


if __name__ == "__main__":
    unittest.main()
