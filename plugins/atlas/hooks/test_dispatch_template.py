"""The canonical dispatch template in subagent-kit.md must pass atlas's own dispatch tripwire.

The template is what the orchestrator copies; if the tripwire denies it, every dispatch built from it is
denied. Set ATLAS_TEMPLATE_FILE to check another copy of the kit (e.g. an older revision).
"""

import os as _iso_os
import sys as _iso_sys

_HERE = _iso_os.path.dirname(_iso_os.path.abspath(__file__))
_iso_sys.path.insert(0, _iso_os.path.join(_HERE, "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

import os
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

KIT = (
    Path(__file__).resolve().parent.parent
    / "skills"
    / "atlas-orchestrate"
    / "references"
    / "subagent-kit.md"
)
AGENT = "atlas:explorer"


def extract_template(text):
    """The fenced block that opens with `ROLE:` and carries the GOAL:/TOOLS: spec."""
    for m in re.finditer(r"```[^\n]*\n(.*?)\n```", text, re.S):
        if re.search(r"(?m)^ROLE:", m.group(1)) and re.search(
            r"(?m)^GOAL:", m.group(1)
        ):
            return m.group(1)
    raise AssertionError("no fenced dispatch template (ROLE:/GOAL:) in the kit")


def fill(template):
    """Replace the angle-bracket placeholders with concrete values."""
    out = template.replace("SCOPE: <class>/<effort>", "SCOPE: audit/medium")
    out = re.sub(r"(?m)^(GOAL:).*$", r"\1 map the auth call path.", out)
    # Remaining `<...>` placeholders after a label become one concrete word each.
    return re.sub(r"<[^<>\n]*>", "concrete", out)


class DispatchTemplateTripwireTest(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, _HERE)
        import dispatch_tripwire

        self.dt = dispatch_tripwire
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_TOOLKIT_LOAD"}
        p = patch.dict(os.environ, env, clear=True)
        p.start()
        self.addCleanup(p.stop)
        path = Path(os.environ.get("ATLAS_TEMPLATE_FILE") or KIT)
        self.prompt = fill(extract_template(path.read_text(encoding="utf-8")))
        self.tinput = {"subagent_type": AGENT, "prompt": self.prompt}

    def test_toolkit_gap_clear(self):
        self.assertIsNone(self.dt._toolkit_gap(self.tinput))

    def test_scope_line_resolves_for_role(self):
        self.assertEqual(self.dt._scope_problem(self.tinput), "")

    def test_spec_bounded_and_single_goal(self):
        self.assertIsNone(self.dt._unbounded_dispatch(self.tinput))

    def test_exactly_one_goal_and_one_tools_block(self):
        self.assertEqual(len(re.findall(r"(?im)^[ \t]*GOAL[ \t]*:", self.prompt)), 1)
        self.assertEqual(len(re.findall(r"(?m)^TOOLS[^\n]*:", self.prompt)), 1)


if __name__ == "__main__":
    unittest.main()
