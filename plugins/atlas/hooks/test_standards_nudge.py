"""standards_nudge: docs/standards/*.md rules are injected once per (session, agent) for governed files."""

import os as _o
import sys as _s

_s.path.insert(
    0, _o.path.join(_o.path.dirname(_o.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402
import io
import json
import os
import sys
import tempfile
import unittest
import uuid
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import standards_nudge  # noqa: E402

BLOCK = """---
title: Tables
applies_to:
  - "src/pages/**"
  - src/components/**/*Table*
last_updated: 2026-11-24
---
## Rule
- Every row has an icon.
## Why
because
"""
INLINE = """---
title: Naming
applies_to: ["lib/*.py", 'api/**']
---
## Rule
- Use snake case.
"""


def _root(files):
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, ".git"))
    for name, body in files.items():
        path = os.path.join(root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(body)
    return root


def _fire(root, rel, sid=None, agent=None, tool="Edit"):
    sid = sid or uuid.uuid4().hex  # fresh session per call unless a test pins one
    payload = {
        "session_id": sid,
        "tool_name": tool,
        "cwd": root,
        "hook_event_name": "PreToolUse",
        "tool_input": {"file_path": os.path.join(root, rel)},
    }
    if agent:
        payload["agent_id"] = agent
    out = io.StringIO()
    with (
        mock.patch.object(sys, "stdin", io.StringIO(json.dumps(payload))),
        mock.patch.object(sys, "stdout", out),
    ):
        rc = standards_nudge.main()
    assert rc == 0
    return json.loads(out.getvalue())["hookSpecificOutput"]["additionalContext"] if out.getvalue() else ""


class StandardsNudgeTest(unittest.TestCase):
    def setUp(self):
        self.root = _root({"docs/standards/tables.md": BLOCK, "docs/standards/naming.md": INLINE})

    def test_no_standards_dir_is_silent_and_reads_nothing(self):
        root = _root({"src/a.py": ""})
        with mock.patch.object(standards_nudge.Path, "glob", side_effect=AssertionError("scanned")):
            self.assertEqual(_fire(root, "src/pages/a.tsx"), "")

    def test_block_list_glob_matches(self):
        msg = _fire(self.root, "src/pages/x/Orders.tsx")
        self.assertIn("docs/standards/tables.md governs src/pages/x/Orders.tsx:", msg)
        self.assertIn("Every row has an icon.", msg)
        self.assertNotIn("because", msg)
        self.assertIn("Decision log", msg)
        fenced = msg.split("</recalled-memory>")[0]
        self.assertIn('<recalled-memory untrusted="true">', fenced)
        self.assertIn("Every row has an icon.", fenced)
        self.assertIn("Decision log", msg.split("</recalled-memory>")[1])  # tail stays outside

    def test_unquoted_block_item_matches(self):
        self.assertIn("tables.md", _fire(self.root, "src/components/a/OrderTable.tsx"))

    def test_inline_list_glob_matches(self):
        msg = _fire(self.root, "lib/mod.py")
        self.assertIn("naming.md", msg)
        self.assertNotIn("tables.md", msg)
        self.assertIn("naming.md", _fire(self.root, "api/v1/x.ts", sid="s2"))

    def test_non_matching_path_is_silent(self):
        self.assertEqual(_fire(self.root, "README.md"), "")

    def test_repeat_same_session_and_agent_is_silent(self):
        self.assertNotEqual(_fire(self.root, "src/pages/a.tsx", sid="r1", agent="A"), "")
        self.assertEqual(_fire(self.root, "src/pages/b.tsx", sid="r1", agent="A"), "")

    def test_other_agent_gets_its_own_injection(self):
        _fire(self.root, "src/pages/a.tsx", sid="r2")
        self.assertNotEqual(_fire(self.root, "src/pages/a.tsx", sid="r2", agent="sub1"), "")

    def test_edit_inside_standards_is_silent(self):
        root = _root({"docs/standards/wide.md": '---\napplies_to: ["docs/**"]\n---\n## Rule\nx\n'})
        self.assertNotEqual(_fire(root, "docs/other.md"), "")  # glob really matches docs
        self.assertEqual(_fire(root, "docs/standards/wide.md"), "")

    def test_readme_in_standards_is_not_a_standard(self):
        root = _root({"docs/standards/README.md": BLOCK})
        self.assertEqual(_fire(root, "src/pages/a.tsx"), "")

    def test_malformed_frontmatter_is_silent(self):
        root = _root(
            {
                "docs/standards/a.md": "---\napplies_to: [\n## Rule\nx",
                "docs/standards/b.md": "no frontmatter at all",
                "docs/standards/c.md": "---\napplies_to:\n---\n## Rule\nx\n",
            }
        )
        self.assertEqual(_fire(root, "src/pages/a.tsx"), "")

    def test_rule_truncated_at_cap(self):
        long = "---\napplies_to: [\"z/**\"]\n---\n## Rule\n" + "x" * 3000 + "\n## Why\nTAILMARK\n"
        root = _root({"docs/standards/long.md": long})
        msg = _fire(root, "z/a.py")
        self.assertLess(len(msg), standards_nudge.RULE_CAP + 700)  # cap plus fence, preamble and tail
        self.assertNotIn("x" * (standards_nudge.RULE_CAP + 1), msg)
        self.assertNotIn("TAILMARK", msg)
        self.assertIn("...", msg)

    def test_ctx_patch_path_field_is_read(self):
        payload = {
            "session_id": "cp",
            "tool_name": "mcp__lean-ctx__ctx_patch",
            "cwd": self.root,
            "hook_event_name": "PreToolUse",
            "tool_input": {"path": "src/pages/a.tsx"},
        }
        out = io.StringIO()
        with (
            mock.patch.object(sys, "stdin", io.StringIO(json.dumps(payload))),
            mock.patch.object(sys, "stdout", out),
        ):
            standards_nudge.main()
        self.assertIn("tables.md", out.getvalue())


if __name__ == "__main__":
    unittest.main()
