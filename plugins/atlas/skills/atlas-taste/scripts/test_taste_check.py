#!/usr/bin/env python3
"""Tests for taste_check.py: each rule has a case that fails when the rule is removed."""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[2] / "scripts"))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import taste_check  # noqa: E402

STD = """---
title: Design system
applies_to:
  - src/**/*.css
  - src/**/*.tsx
tokens:
  - src/tokens.css
icon_library: lib-icons
allow_raw_values_in:
  - src/legacy/**
last_updated: 2026-11-24
---
## Rule
Use tokens.
"""
TOKENS = """:root {
  --brand: #123456;
  --space-2: 8px;
  --space-4: 1rem;
  --radius-md: 6px;
}
"""


class Fixture(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.put("docs/standards/design-system.md", STD)
        self.put("src/tokens.css", TOKENS)

    def put(self, rel, text):
        p = Path(self.root, rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def check(self):
        code, findings = taste_check.run_check(self.root)
        return code, findings

    def msgs(self, level=None):
        return [f for f in self.check()[1] if level in (None, f["level"])]


class RuleTests(Fixture):
    def test_off_token_hex_is_flagged_with_line(self):
        self.put("src/a.css", ".a {\n  color: #ff0000;\n}\n")
        code, findings = self.check()
        self.assertEqual(code, 1)
        hit = [f for f in findings if f["level"] == "FAIL"]
        self.assertEqual((hit[0]["file"], hit[0]["line"]), ("src/a.css", 2))

    def test_hex_equal_to_token_passes_case_insensitively(self):
        self.put("src/a.css", ".a { color: #123456; border-color: #123456; }\n")
        self.put("src/b.css", ".b { color: #123456; }\n")
        self.assertEqual(self.check()[0], 0)

    def test_rgb_equal_to_token_passes(self):
        self.put("src/a.css", ".a { color: rgb(18, 52, 86); }\n")
        self.assertEqual(self.check()[0], 0)

    def test_allow_raw_values_in_is_skipped(self):
        self.put("src/legacy/old.css", ".a { color: #ff0000; }\n")
        self.assertEqual(self.check()[0], 0)

    def test_token_file_itself_is_never_scanned(self):
        self.assertEqual([f for f in self.msgs() if f["file"] == "src/tokens.css"], [])

    def test_wrong_icon_import_is_flagged(self):
        self.put("src/A.tsx", "import { Pencil } from 'other-icons';\n")
        code, findings = self.check()
        self.assertEqual(code, 1)
        self.assertIn("other-icons", findings[-1]["message"])

    def test_declared_icon_library_passes(self):
        self.put("src/A.tsx", "import { Pencil } from 'lib-icons';\nimport x from 'lib-icons/sub';\n")
        self.assertEqual(self.check()[0], 0)

    def test_off_scale_spacing_and_radius_warn_only(self):
        self.put("src/a.css", ".a { padding: 13px; border-radius: 9px; margin: 8px; gap: 1rem; }\n")
        code, findings = self.check()
        self.assertEqual(code, 0)
        self.assertEqual(sorted(f["message"].split()[0] for f in findings if f["level"] == "WARN"), ["radius", "spacing"])

    def test_scale_not_checked_when_tokens_define_none(self):
        self.put("src/tokens.css", ":root { --brand: #123456; }\n")
        self.put("src/a.css", ".a { padding: 13px; }\n")
        self.assertEqual([f for f in self.msgs("WARN") if "scale" in f["message"]], [])

    def test_missing_standard_exits_2(self):
        os.remove(os.path.join(self.root, "docs/standards/design-system.md"))
        self.assertEqual(taste_check.run_check(self.root)[0], 2)
        self.assertEqual(taste_check.main(["--root", self.root]), 2)

    def test_json_tokens_are_parsed(self):
        self.put("docs/standards/design-system.md", STD.replace("src/tokens.css", "tokens.json"))
        os.remove(os.path.join(self.root, "src/tokens.css"))
        self.put("tokens.json", json.dumps({"color": {"brand": {"$value": "#abcdef"}}, "space": {"2": {"value": "8px"}}}))
        self.put("src/a.css", ".a { color: #abcdef; padding: 8px; }\n")
        self.assertEqual(self.check(), (0, []))
        self.put("src/b.css", ".b { color: #123456; }\n")  # the old css token value is no longer a token
        self.assertEqual(self.check()[0], 1)

    def test_unsupported_token_format_warns_not_crashes(self):
        self.put("docs/standards/design-system.md", STD.replace("src/tokens.css", "tokens.scss"))
        os.remove(os.path.join(self.root, "src/tokens.css"))
        self.put("tokens.scss", "$brand: #123456;\n")
        code, findings = self.check()
        self.assertEqual(code, 0)
        self.assertTrue(any("unsupported token format" in f["message"] for f in findings))

    def test_json_flag_output(self):
        self.put("src/a.css", ".a { color: #ff0000; }\n")
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = taste_check.main(["--root", self.root, "--json"])
        data = json.loads(buf.getvalue())
        self.assertEqual((code, data["exit"], data["findings"][0]["level"]), (1, 1, "FAIL"))


class GateTests(Fixture):
    def gate(self):
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = taste_check.gate(self.root)
        return code, buf.getvalue()

    def armed(self):
        return os.path.exists(os.path.join(self.root, taste_check.ARMED))

    def test_unarmed_gate_is_silent_even_with_fails(self):
        self.put("src/a.css", ".a { color: #ff0000; }\n")
        self.assertEqual(self.gate(), (0, ""))

    def test_armed_gate_blocks_with_fail_list_and_counts_rounds(self):
        self.put("src/a.css", ".a { color: #ff0000; }\n")
        taste_check.arm(self.root, 3)
        code, out = self.gate()
        data = json.loads(out)
        self.assertEqual((code, data["decision"]), (0, "block"))
        self.assertIn("src/a.css:1", data["reason"])
        self.assertIn("round 1 of 3", data["reason"])
        self.assertIn("round 2 of 3", json.loads(self.gate()[1])["reason"])

    def test_gate_gives_up_after_max_rounds_and_disarms(self):
        self.put("src/a.css", ".a { color: #ff0000; }\n")
        taste_check.arm(self.root, 2)
        self.gate()
        out = json.loads(self.gate()[1])
        self.assertNotIn("decision", out)
        self.assertIn("gate gave up: 1 FAILs open", out["systemMessage"])
        self.assertFalse(self.armed())
        self.assertEqual(self.gate(), (0, ""))

    def test_gate_disarms_when_clean(self):
        taste_check.arm(self.root, 5)
        self.assertEqual(self.gate(), (0, ""))
        self.assertFalse(self.armed())

    def test_gate_never_launches_a_browser(self):
        self.assertNotIn("taste_browser", Path(taste_check.__file__).read_text())


if __name__ == "__main__":
    unittest.main()
