"""atlas_mod_gate.py: passes on the real tree, fails on each injected load fault.

The faults go into a temp copy of the plugin (hooks.json, mod/, contracts/, omp/,
types/); the real mod/ is never written. Skipped when bun is absent.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ATLAS = os.path.dirname(HERE)
GATE = os.path.join(HERE, "atlas_mod_gate.py")
COPIED = ("hooks/hooks.json", "mod", "contracts", "omp", "types", "package.json", "bunfig.toml")


def _gate(root, *flags):
    p = subprocess.run([sys.executable, GATE, "--root", root, *flags], capture_output=True, text=True, timeout=900)
    return p.returncode, p.stdout + p.stderr


@unittest.skipUnless(shutil.which("bun"), "bun not installed")
class ModGateTests(unittest.TestCase):
    def _copy(self):
        tmp = tempfile.mkdtemp(prefix="mod-gate-test-")
        self.addCleanup(shutil.rmtree, tmp, True)
        dst = os.path.join(tmp, "atlas")
        for rel in COPIED:
            src = os.path.join(ATLAS, rel)
            if not os.path.exists(src):
                continue
            to = os.path.join(dst, rel)
            os.makedirs(os.path.dirname(to), exist_ok=True)
            if os.path.isdir(src):
                shutil.copytree(src, to, ignore=shutil.ignore_patterns("node_modules", "__pycache__"))
            else:
                shutil.copy2(src, to)
        return dst

    def test_real_tree_passes(self):
        rc, out = _gate(ATLAS)
        self.assertEqual(rc, 0, out)
        self.assertIn("PASS load+render register.ts", out)

    def test_untouched_copy_passes(self):
        rc, out = _gate(self._copy())
        self.assertEqual(rc, 0, out)

    def test_top_level_throw_fails(self):
        dst = self._copy()
        with open(os.path.join(dst, "mod", "usage.ts"), "a", encoding="utf-8") as f:
            f.write("\nthrow new Error('injected top-level throw');\n")
        rc, out = _gate(dst)
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL load+render register.ts", out)
        self.assertIn("injected top-level throw", out)

    def test_broken_import_fails(self):
        dst = self._copy()
        path = os.path.join(dst, "mod", "usage.ts")
        with open(path, encoding="utf-8") as f:
            src = f.read()
        with open(path, "w", encoding="utf-8") as f:
            f.write("import './does-not-exist-injected';\n" + src)
        rc, out = _gate(dst)
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL bundle register.ts", out)
        self.assertIn("does-not-exist-injected", out)

    def test_missing_module_entry_fails(self):
        dst = self._copy()
        os.remove(os.path.join(dst, "mod", "register.ts"))
        rc, out = _gate(dst)
        self.assertEqual(rc, 1, out)
        self.assertIn("FAIL modules-exist", out)

    @unittest.skipUnless(shutil.which("claude"), "claude CLI not installed")
    def test_live_host_check_fails_on_host_rejected_module(self):
        # The host refuses `$.env.get(<variable>)`; the offline load accepts it. --live must catch it.
        dst = self._copy()
        with open(os.path.join(dst, "mod", "usage.ts"), "a", encoding="utf-8") as f:
            f.write("\nexport function injectedHostFault($: any, n: string) { return $.env.get(n); }\n")
        rc, out = _gate(dst, "--live")
        self.assertEqual(rc, 1, out)
        self.assertIn("PASS load+render register.ts", out)
        self.assertIn("FAIL live claude plugin test", out)


if __name__ == "__main__":
    unittest.main()
