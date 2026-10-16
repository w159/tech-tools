"""Scope resolver: table rows, matrix invariants, omp parity, determinism."""

import json
import random
import re
import subprocess
import sys
import unittest
from pathlib import Path

ATLAS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ATLAS / "scripts"))
sys.path.insert(0, str(ATLAS / "hooks"))
import _test_isolation  # noqa: F401,E402
import atlas_resolve as ar  # noqa: E402

MATRIX = json.loads((ATLAS / "contracts" / "scope-matrix.json").read_text())


def _fm_effort(role):
    m = re.search(
        r"^effort:\s*(\S+)", (ATLAS / "agents" / f"{role}.md").read_text(), re.M
    )
    return m.group(1)


ROWS = [
    # (class, effort) -> [(role, count, effort, tools_profile)], isolation
    ("implement", "low", [("implementer", 1, "low", "edit")], "shared"),
    (
        "implement",
        "medium",
        [("implementer", 2, "low", "edit"), ("verifier", 1, "low", "exec")],
        "worktree",
    ),
    (
        "fix",
        "high",
        [
            ("explorer", 2, "low", "read"),
            ("implementer", 1, "low", "edit"),
            ("verifier", 1, "low", "exec"),
        ],
        "worktree",
    ),
    (
        "verify",
        "high",
        [
            ("verifier", 2, "low", "exec"),
            ("completeness-critic", 1, "low", "read"),
        ],
        "shared",
    ),
    ("docs", "low", [("docs-curator", 1, "low", "edit")], "shared"),
    ("ui-test", "medium", [("ui-runtime-tester", 2, "low", "exec")], "shared"),
]


class Resolve(unittest.TestCase):
    def test_rows(self):
        for cls, eff, team, iso in ROWS:
            r = ar.resolve(cls, eff)
            got = [
                (t["role"], t["count"], t["effort"], t["tools_profile"])
                for t in r["team"]
            ]
            self.assertEqual(got, team, (cls, eff))
            self.assertEqual(r["isolation"], iso)

    def test_invariants(self):
        for cls, levels in MATRIX["classes"].items():
            self.assertEqual(sorted(levels), ["high", "low", "medium"], cls)
            for eff, cell in levels.items():
                total = sum(t["count"] for t in cell["team"])
                self.assertLessEqual(cell["max_parallel"], 5)
                self.assertLessEqual(
                    max(t["count"] for t in cell["team"]), cell["max_parallel"]
                )
                self.assertIn(cell["isolation"], ("worktree", "shared"))
                for t in cell["team"]:
                    self.assertTrue(
                        (ATLAS / "agents" / f"{t['role']}.md").exists(), t["role"]
                    )
                    self.assertEqual(
                        t["effort"], _fm_effort(t["role"]), (cls, eff, t["role"])
                    )
                self.assertGreater(total, 0)

    def test_unknown_raises(self):
        with self.assertRaises(ValueError):
            ar.resolve("nope", "low")
        with self.assertRaises(ValueError):
            ar.resolve("fix", "extreme")

    def test_deterministic(self):
        paths = ["b/x.py", "a/y.py", "./a/y.py", "c//z.py"]
        outs = set()
        for _ in range(100):
            random.shuffle(paths)
            outs.add(json.dumps(ar.resolve("fix", "high", paths), sort_keys=True))
        self.assertEqual(len(outs), 1)
        self.assertEqual(
            json.loads(outs.pop())["file_scope"], ["a/y.py", "b/x.py", "c/z.py"]
        )

    def test_omp_thinking_parity(self):
        """Every matrix role's omp thinking level equals its effort; omp 'off' is allowed only for a Claude 'low'."""
        src = (ATLAS / "omp" / "atlas-agents.ts").read_text()
        block = re.search(r"ATLAS_THINKING_LEVELS[^{]*\{(.*?)\n\};", src, re.S).group(1)
        omp = dict(re.findall(r'"?([\w-]+)"?:\s*"(\w+)"', block))
        for cls, levels in MATRIX["classes"].items():
            for cell in levels.values():
                for t in cell["team"]:
                    lvl = omp[t["role"]]
                    self.assertTrue(
                        lvl == t["effort"] or (lvl == "off" and t["effort"] == "low"),
                        (t["role"], lvl),
                    )
        self.assertEqual(omp["implementer"], _fm_effort("implementer"))

    def test_tripwire_advisory(self):
        sys.path.insert(0, str(ATLAS / "hooks"))
        import dispatch_tripwire as dt

        note = dt._scope_problem(
            {"prompt": "SCOPE: fix/low", "subagent_type": "atlas:verifier"}
        )
        self.assertIn("DENY", note)
        self.assertEqual(
            dt._scope_problem(
                {"prompt": "SCOPE: fix/low", "subagent_type": "atlas:implementer"}
            ),
            "",
        )
        self.assertEqual(
            dt._scope_problem({"prompt": "no scope line", "subagent_type": "x"}), ""
        )
        self.assertIn(
            "atlas_resolve.py",
            dt._scope_problem({"prompt": "no scope line", "subagent_type": "atlas:x"}),
        )

    def test_cli(self):
        out = subprocess.run(
            [
                sys.executable,
                str(ATLAS / "scripts" / "atlas_resolve.py"),
                "fix",
                "low",
                "--paths",
                "b,a",
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        self.assertEqual(json.loads(out), ar.resolve("fix", "low", ["b", "a"]))

    def test_aliases(self):
        self.assertEqual(ar.resolve("explore", "med"), ar.resolve("audit", "medium"))
        self.assertEqual(ar.resolve("feature", "hi"), ar.resolve("implement", "high"))
        self.assertEqual(ar.resolve("research", "lo")["task_class"], "audit")
        with self.assertRaises(ValueError):
            ar.resolve("nope", "med")


if __name__ == "__main__":
    unittest.main()
