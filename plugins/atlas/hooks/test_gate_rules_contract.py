"""Contract: the dispatch tripwire, the completion gate (m) delegation predicate and
the delegation prewarn must give one verdict for the same path or command.

Table-driven: each row is asked of all three hooks. Definitions live in
scripts/atlas_scope.py; a hook that re-implements one drifts and fails here.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, HERE)
import _test_isolation  # noqa: F401,E402

import atlas_scope  # noqa: E402
import completion_gate_core as cg  # noqa: E402
import delegation_prewarn  # noqa: E402
import dispatch_tripwire_core as tw  # noqa: E402

SCRATCHPAD = "/tmp/claude-0/-home-user-proj/abc123/scratchpad/fire.py"

# (label, path, is_target_code). {root} is the project root.
PATH_ROWS = (
    ("tmp scratch .py", "/tmp/scratch_job.py", False),
    ("session scratchpad", SCRATCHPAD, False),
    ("repo app.py", "{root}/app.py", True),
    ("repo docs/x.md", "{root}/docs/x.md", False),
    ("repo .atlas/x.json", "{root}/.atlas/x.json", False),
    ("outside .md", "/mnt/project-files/notes.md", False),
    ("outside .py", "/mnt/project-files/notes.py", False),
    ("outside task-notes", "/mnt/project-files/.task-notes/id/working-notes.md", False),
)

# (label, command, counted_as_inline_op). Verification is never counted.
COMMAND_ROWS = (
    ("pytest -q", "pytest -q", False),
    ("python3 -m pytest", "python3 -m pytest", False),
    ("unittest discover", "python3 -m unittest discover -s hooks", False),
    ("npm test", "npm test", False),
    ("bun test", "bun test", False),
    ("ruff check", "ruff check .", False),
    ("tsc --noEmit", "tsc --noEmit", False),
    ("cd && pytest | tail", "cd plugins/atlas && pytest -q 2>&1 | tail -5", False),
    ("sed -i", "sed -i s/a/b/ app.py", True),
    ("python3 app.py", "python3 app.py", True),
    ("echo > f.py", "echo x > f.py", True),
    ("ruff --fix", "ruff check --fix .", True),
    ("pytest && rm", "pytest -q && rm -rf build", True),
)


class GateRulesContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Not under /tmp: scratch roots are exempt everywhere, a /tmp repo would hide app.py.
        cls.root = os.path.realpath(
            tempfile.mkdtemp(prefix="gate-rules-", dir=os.path.expanduser("~"))
        )
        subprocess.run(["git", "init", "-q", cls.root], check=True)
        cls.prev = os.getcwd()
        os.chdir(cls.root)

    @classmethod
    def tearDownClass(cls):
        os.chdir(cls.prev)
        shutil.rmtree(cls.root, ignore_errors=True)

    def test_paths_one_verdict(self):
        exempt = cg._delegation_exempt()
        for label, raw, want in PATH_ROWS:
            path = raw.format(root=self.root)
            with self.subTest(label):
                tripwire = not tw._is_orchestration_path(path)
                gate = cg._is_delegation_code(path, *exempt)
                warn = delegation_prewarn.should_warn(
                    {
                        "tool_name": "Edit",
                        "tool_input": {"file_path": path},
                        "session_id": "s",
                    }
                )
                scope = atlas_scope.is_target_code(path, self.root)
                self.assertEqual(
                    (tripwire, gate, warn, scope),
                    (want,) * 4,
                    f"{path}: tripwire={tripwire} gate={gate} prewarn={warn} scope={scope}",
                )

    def test_commands_one_verdict(self):
        for label, command, counted in COMMAND_ROWS:
            with self.subTest(label):
                tripwire = not tw._is_read_only_call("Bash", {"command": command})
                scope = not atlas_scope.is_verification_command(command)
                self.assertEqual(
                    (tripwire, scope),
                    (counted,) * 2,
                    f"{command}: tripwire counted={tripwire} scope counted={scope}",
                )


if __name__ == "__main__":
    unittest.main()
